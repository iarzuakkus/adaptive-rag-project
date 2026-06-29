"""
Dosya: core/chat/orchestrator.py

Görev:
- Chat akışının ana yöneticisidir.
- Kullanıcı mesajının intent bilgisini alır.
- Kaynak gösterme isteği varsa RAG çalıştırmadan frontend'e highlight aksiyonu döndürür.
- Normal sorularda retriever, prompt builder ve LLM akışını çalıştırır.
- LLM'in döndürdüğü JSON içinden answer ve used_context_indexes alanlarını ayırır.
- used_context_indexes bilgisine göre cevabı destekleyen chunk'ı öne alır.
- Response builder ile standart cevap döndürür.

Not:
- routes/chat.py doğrudan burayı çağırmaz.
- Geriye uyumluluk için core/chat_rag.py içinden answer_chat buraya yönlendirilir.
"""

import json
from typing import Optional

from prompts.rag_prompt import SYSTEM_INSTRUCTION, build_rag_prompt
from services.llm_service import LLMService

from core.chat.intent_detector import detect_chat_intent
from core.chat.chat_types import is_source_navigation_intent
from core.chat.retriever_adapter import (
    normalize_scope,
    retrieve_relevant_chunks,
)
from core.chat.payload_builder import (
    build_action_payload,
    build_chunk_payload,
    build_prompt_chunks,
    build_source_payload,
)
from core.chat.response_builder import (
    build_empty_question_response,
    build_llm_error_response,
    build_no_sources_response,
    build_prompt_error_response,
    build_retriever_error_response,
    build_source_navigation_response,
    build_success_response,
)


def _call_build_rag_prompt(
    question: str,
    chunks: list[dict],
    page_url: Optional[str],
    page_title: Optional[str],
    scope: str,
) -> str:
    """
    Prompt builder fonksiyonunu güvenli şekilde çağırır.
    """

    call_patterns = [
        lambda: build_rag_prompt(
            question=question,
            chunks=chunks,
            page_url=page_url,
            page_title=page_title,
            scope=scope,
        ),
        lambda: build_rag_prompt(
            question=question,
            chunks=chunks,
            page_title=page_title,
            scope=scope,
        ),
        lambda: build_rag_prompt(
            question=question,
            chunks=chunks,
            scope=scope,
        ),
        lambda: build_rag_prompt(
            question=question,
            chunks=chunks,
        ),
    ]

    last_error = None

    for call in call_patterns:
        try:
            return call()
        except TypeError as exc:
            last_error = exc

    raise RuntimeError(f"RAG prompt oluşturulamadı: {last_error}")


def _is_valid_question(question: str) -> bool:
    return bool(question and question.strip())


def _normalize_top_k(top_k: int) -> int:
    if not isinstance(top_k, int) or top_k <= 0:
        return 5

    return top_k


def _should_run_source_navigation(question: str) -> dict | None:
    """
    Kullanıcının mesajı önceki cevabın kaynağını gösterme isteği mi kontrol eder.
    """

    intent_result = detect_chat_intent(
        question=question,
        has_previous_answer=True,
        has_previous_chunks=True,
    )

    if is_source_navigation_intent(intent_result):
        return intent_result

    return None


def _build_rag_payloads(
    chunks: list[dict],
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """
    Normalized chunk listesinden frontend ve prompt payload'larını üretir.
    """

    sources = build_source_payload(chunks)
    chunk_payload = build_chunk_payload(chunks)
    actions = build_action_payload(sources, chunk_payload)
    prompt_chunks = build_prompt_chunks(chunks)

    return sources, chunk_payload, actions, prompt_chunks


def _build_frontend_payloads(
    chunks: list[dict],
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    LLM cevabından sonra frontend'e dönecek payload'ları yeniden üretir.

    Çünkü used_context_indexes ile chunk sırası değişmiş olabilir.
    """

    sources = build_source_payload(chunks)
    chunk_payload = build_chunk_payload(chunks)
    actions = build_action_payload(sources, chunk_payload)

    return sources, chunk_payload, actions


def _generate_llm_answer(prompt: str) -> str:
    """
    RAG prompt'unu LLM'e gönderir ve raw cevabı döndürür.

    Not:
    rag_prompt.py artık raw cevabın JSON olmasını ister.
    """

    llm = LLMService()

    return llm.generate_text(
        prompt=prompt,
        system_instruction=SYSTEM_INSTRUCTION,
        temperature=0.2,
        max_output_tokens=900,
    )


def _extract_json_from_text(text: str) -> dict:
    """
    LLM'den gelen JSON cevabı güvenli şekilde parse eder.

    LLM bazen JSON'u doğrudan, bazen markdown code block içinde döndürebilir.
    Bu fonksiyon ikisini de tolere eder.
    """

    if not text:
        return {}

    cleaned = str(text).strip()

    if cleaned.startswith("```"):
        cleaned = (
            cleaned
            .replace("```json", "")
            .replace("```JSON", "")
            .replace("```", "")
            .strip()
        )

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    start_index = cleaned.find("{")
    end_index = cleaned.rfind("}")

    if start_index == -1 or end_index == -1 or end_index <= start_index:
        return {}

    try:
        parsed = json.loads(cleaned[start_index:end_index + 1])
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _normalize_used_context_indexes(
    raw_indexes,
    chunk_count: int,
) -> list[int]:
    """
    LLM'den gelen used_context_indexes alanını güvenli hale getirir.

    Beklenen:
    - 1 tabanlı index listesi
    - Örnek: [1], [2, 3]
    """

    if not isinstance(raw_indexes, list):
        return []

    normalized_indexes = []
    seen = set()

    for raw_index in raw_indexes:
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue

        if index < 1 or index > chunk_count:
            continue

        if index in seen:
            continue

        seen.add(index)
        normalized_indexes.append(index)

    return normalized_indexes


def _parse_llm_rag_response(raw_answer: str) -> dict:
    """
    LLM'in RAG cevabını parse eder.

    Yeni beklenen format:
    {
      "answer": "...",
      "used_context_indexes": [1],
      "confidence": 0.8
    }

    Eğer JSON parse edilemezse sistem bozulmasın diye raw metni answer kabul eder.
    """

    parsed = _extract_json_from_text(raw_answer)

    if not parsed:
        return {
            "answer": str(raw_answer or "").strip(),
            "used_context_indexes": [],
            "confidence": 0.0,
            "raw": raw_answer,
            "parsed": False,
        }

    answer = str(parsed.get("answer") or "").strip()

    if not answer:
        answer = str(raw_answer or "").strip()

    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    confidence = max(0.0, min(confidence, 1.0))

    return {
        "answer": answer,
        "used_context_indexes": parsed.get("used_context_indexes", []),
        "confidence": confidence,
        "raw": raw_answer,
        "parsed": True,
    }


def _prioritize_chunks_by_used_context_indexes(
    chunks: list[dict],
    used_context_indexes: list[int],
) -> list[dict]:
    """
    LLM'in kullandığını söylediği bağlam parçalarını listenin başına alır.

    Örnek:
    chunks = [chunk1, chunk2, chunk3]
    used_context_indexes = [2]
    dönüş = [chunk2, chunk1, chunk3]

    Böylece frontend source_navigation sırasında chunks[0] ile doğru bölüme gider.
    """

    if not isinstance(chunks, list) or not chunks:
        return []

    if not used_context_indexes:
        return chunks

    index_rank = {
        context_index: rank
        for rank, context_index in enumerate(used_context_indexes)
    }

    enriched_chunks = []

    for original_index, chunk in enumerate(chunks, start=1):
        if not isinstance(chunk, dict):
            continue

        enriched_chunks.append({
            **chunk,
            "context_index": original_index,
            "used_by_answer": original_index in index_rank,
            "is_primary_chunk": False,
        })

    if not enriched_chunks:
        return chunks

    enriched_chunks.sort(
        key=lambda chunk: (
            0 if chunk.get("context_index") in index_rank else 1,
            index_rank.get(chunk.get("context_index"), 9999),
            chunk.get("context_index") or 9999,
        )
    )

    prioritized_chunks = []

    for index, chunk in enumerate(enriched_chunks):
        prioritized_chunks.append({
            **chunk,
            "is_primary_chunk": index == 0,
        })

    print("[CHAT RAG] LLM kullanılan context index seçimi:", {
        "used_context_indexes": used_context_indexes,
        "primary_context_index": prioritized_chunks[0].get("context_index"),
        "primary_chunk_id": prioritized_chunks[0].get("chunk_id"),
        "primary_title": prioritized_chunks[0].get("title"),
    })

    return prioritized_chunks


def answer_chat(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> dict:
    """
    Chat endpoint'i tarafından çağrılacak ana fonksiyon.

    Akış:
    1. Boş soru kontrol edilir.
    2. Intent algılanır.
    3. Kaynak gösterme isteği varsa RAG çalışmadan response döner.
    4. Normal soruysa retriever çalışır.
    5. Prompt hazırlanır.
    6. LLM JSON cevabı üretilir.
    7. answer ve used_context_indexes ayrılır.
    8. used_context_indexes bilgisine göre primary chunk başa alınır.
    9. Kaynak/chunk/action bilgileriyle birlikte response döner.
    """

    if not _is_valid_question(question):
        return build_empty_question_response()

    normalized_scope = normalize_scope(scope)
    safe_top_k = _normalize_top_k(top_k)

    source_navigation_intent = _should_run_source_navigation(question)

    if source_navigation_intent:
        return build_source_navigation_response(source_navigation_intent)

    try:
        chunks = retrieve_relevant_chunks(
            question=question,
            top_k=safe_top_k,
            page_url=page_url,
            page_title=page_title,
            scope=normalized_scope,
        )
    except Exception as exc:
        return build_retriever_error_response(exc)

    sources, chunk_payload, actions, prompt_chunks = _build_rag_payloads(chunks)

    if not chunks:
        return build_no_sources_response()

    try:
        prompt = _call_build_rag_prompt(
            question=question,
            chunks=prompt_chunks,
            page_url=page_url,
            page_title=page_title,
            scope=normalized_scope,
        )

        print("\nCHAT RAG PROMPT DEBUG")
        print("-" * 40)
        print("Original chunks:", len(chunks))
        print("Prompt chunks:", len(prompt_chunks))
        print("Frontend chunks:", len(chunk_payload))
        print("Prompt length:", len(prompt))

    except Exception as exc:
        return build_prompt_error_response(
            error=exc,
            sources=sources,
            chunks=chunk_payload,
            actions=actions,
        )

    try:
        raw_llm_answer = _generate_llm_answer(prompt)
    except Exception as exc:
        return build_llm_error_response(
            error=exc,
            original_chunks=chunks,
            sources=sources,
            chunks=chunk_payload,
            actions=actions,
        )

    parsed_llm_response = _parse_llm_rag_response(raw_llm_answer)

    answer = parsed_llm_response.get("answer") or ""
    raw_used_context_indexes = parsed_llm_response.get("used_context_indexes", [])

    used_context_indexes = _normalize_used_context_indexes(
        raw_indexes=raw_used_context_indexes,
        chunk_count=len(chunks),
    )

    prioritized_chunks = _prioritize_chunks_by_used_context_indexes(
        chunks=chunks,
        used_context_indexes=used_context_indexes,
    )

    final_sources, final_chunk_payload, final_actions = _build_frontend_payloads(
        prioritized_chunks
    )

    print("[CHAT RAG] Parsed LLM response:", {
        "parsed": parsed_llm_response.get("parsed"),
        "confidence": parsed_llm_response.get("confidence"),
        "used_context_indexes": used_context_indexes,
        "answer_preview": answer[:180],
    })

    return build_success_response(
        answer=answer,
        sources=final_sources,
        chunks=final_chunk_payload,
        actions=final_actions,
    )