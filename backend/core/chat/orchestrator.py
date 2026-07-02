"""
Dosya: core/chat/orchestrator.py

Görev:
- Chat akışının ana yöneticisidir.
- Kullanıcı mesajının intent bilgisini alır.
- Kaynak gösterme isteğini yönetir.
- Öneri oluşturma isteğini yönetir.
- Doğal dilde not oluşturma isteğini yönetir.
- Normal sorularda RAG akışını çalıştırır.
"""

import asyncio
import json
from typing import Any, Optional

import core.vector_store as vector_store_module

from prompts.rag_prompt import (
    SYSTEM_INSTRUCTION,
    build_rag_prompt,
)
from services.llm_service import LLMService
from services.note_service import generate_note_from_inputs

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

    raise RuntimeError(
        f"RAG prompt oluşturulamadı: {last_error}"
    )


def _is_valid_question(question: str) -> bool:
    return bool(question and question.strip())


def _normalize_top_k(top_k: int) -> int:
    if not isinstance(top_k, int) or top_k <= 0:
        return 5

    return top_k


def _detect_chat_intent_result(
    question: str,
) -> dict:
    """
    Kullanıcının mesajındaki intent bilgisini algılar.
    """

    return detect_chat_intent(
        question=question,
        has_previous_answer=True,
        has_previous_chunks=True,
    )


def _get_intent_confidence(
    intent_result: dict,
) -> float:
    try:
        return float(
            intent_result.get("confidence")
            or 0.0
        )
    except (TypeError, ValueError):
        return 0.0


def _is_recommendation_request_intent(
    intent_result: dict,
    min_confidence: float = 0.55,
) -> bool:
    """
    Öneri oluşturma intent'ini kontrol eder.
    """

    if not isinstance(intent_result, dict):
        return False

    intent = str(
        intent_result.get("intent")
        or ""
    ).strip().lower()

    return (
        intent == "recommendation_request"
        and _get_intent_confidence(intent_result)
        >= min_confidence
    )


def _is_note_generation_request_intent(
    intent_result: dict,
    min_confidence: float = 0.55,
) -> bool:
    """
    Not oluşturma intent'ini kontrol eder.
    """

    if not isinstance(intent_result, dict):
        return False

    intent = str(
        intent_result.get("intent")
        or ""
    ).strip().lower()

    return (
        intent == "note_generation_request"
        and _get_intent_confidence(intent_result)
        >= min_confidence
    )


def _build_recommendation_action(
    intent_result: dict,
) -> dict:
    """
    Frontend'in öneri üretimini tetiklemesi için action oluşturur.
    """

    raw_action = {}

    if (
        isinstance(intent_result, dict)
        and isinstance(
            intent_result.get("action"),
            dict,
        )
    ):
        raw_action = intent_result.get("action") or {}

    mode = str(
        raw_action.get("mode")
        or "refresh"
    ).strip().lower()

    if mode not in {"refresh", "expand"}:
        mode = "refresh"

    return {
        "type": "generate_recommendations",
        "reason": str(
            raw_action.get("reason")
            or "chat_natural_language_request"
        ).strip(),
        "mode": mode,
        "generation_mode": mode,
        "open_panel": (
            raw_action.get("open_panel", True)
            is not False
        ),
        "show_in_chat": (
            raw_action.get("show_in_chat", True)
            is not False
        ),
        "skip_auto_cooldown": True,
        "force_reload_sources": True,
    }


def _build_recommendation_request_response(
    intent_result: dict,
) -> dict:
    """
    Doğal dilde öneri isteğine frontend action'ı döndürür.
    """

    action = _build_recommendation_action(
        intent_result
    )

    return {
        "answer": (
            "Mevcut kaynaklarına göre yeni öneriler "
            "hazırlıyorum. Öneriler sekmesinde de "
            "görebilirsin."
        ),
        "sources": [],
        "chunks": [],
        "actions": [action],
        "source_count": 0,
        "status": "success",
        "answer_type": "recommendation_request",
        "intent": intent_result,
    }


def _get_note_action(
    intent_result: dict,
) -> dict:
    """
    Intent sonucundaki not oluşturma ayarlarını döndürür.
    """

    if not isinstance(intent_result, dict):
        return {}

    action = intent_result.get("action")

    if not isinstance(action, dict):
        return {}

    return action


def _infer_note_type(
    question: str,
) -> str:
    """
    Kullanıcının ifadesinden not tipini belirler.
    """

    normalized_question = str(
        question or ""
    ).strip().lower()

    if (
        "ders notu" in normalized_question
        or "çalışma notu" in normalized_question
        or "calisma notu" in normalized_question
    ):
        return "lecture_note"

    if (
        "özet not" in normalized_question
        or "ozet not" in normalized_question
        or "kısa özet" in normalized_question
        or "kisa ozet" in normalized_question
    ):
        return "summary_note"

    return "research_note"


def _get_vector_store_documents() -> list[dict]:
    """
    Bellekte bulunan bütün vector store documentlerini döndürür.
    """

    store = getattr(
        vector_store_module,
        "vector_store",
        None,
    )

    documents = getattr(
        store,
        "documents",
        [],
    )

    if not isinstance(documents, list):
        return []

    return [
        document
        for document in documents
        if isinstance(document, dict)
    ]


def _normalize_url(value: Any) -> str:
    """
    URL karşılaştırması için URL'yi sadeleştirir.
    """

    return (
        str(value or "")
        .strip()
        .rstrip("/")
        .lower()
    )


def _get_chunk_url(
    chunk: dict,
) -> str:
    metadata = chunk.get("metadata") or {}

    return str(
        chunk.get("url")
        or chunk.get("page_url")
        or metadata.get("url")
        or metadata.get("page_url")
        or ""
    ).strip()


def _get_note_chunks(
    question: str,
    note_scope: str,
    top_k: int,
    page_url: Optional[str],
    page_title: Optional[str],
    retrieval_scope: str,
) -> list[dict]:
    """
    Not üretiminde kullanılacak chunk listesini hazırlar.

    active_page:
    Vector store içinden yalnızca aktif sayfanın chunk'larını alır.

    all_sources:
    Vector store'daki bütün documentleri alır.

    retrieved_sources:
    Soruyla semantik olarak ilgili chunk'ları getirir.
    """

    all_documents = _get_vector_store_documents()

    if note_scope == "active_page" and page_url:
        normalized_page_url = _normalize_url(
            page_url
        )

        page_documents = [
            document
            for document in all_documents
            if _normalize_url(
                _get_chunk_url(document)
            ) == normalized_page_url
        ]

        if page_documents:
            return page_documents[:80]

    if note_scope == "all_sources":
        return all_documents[:100]

    retrieval_query = str(
        question or ""
    ).strip()

    return retrieve_relevant_chunks(
        question=retrieval_query,
        top_k=max(top_k, 12),
        page_url=page_url,
        page_title=page_title,
        scope=retrieval_scope,
    )


def _is_personal_note_chunk(
    chunk: dict,
) -> bool:
    """
    Chunk'ın kişisel not olup olmadığını belirler.
    """

    metadata = chunk.get("metadata") or {}

    document_type = str(
        chunk.get("document_type")
        or metadata.get("document_type")
        or ""
    ).strip().lower()

    source_type = str(
        chunk.get("source_type")
        or chunk.get("source")
        or metadata.get("source_type")
        or metadata.get("source")
        or ""
    ).strip().lower()

    source_id = str(
        chunk.get("source_id")
        or metadata.get("source_id")
        or ""
    ).strip().lower()

    note_id = str(
        chunk.get("note_id")
        or metadata.get("note_id")
        or ""
    ).strip()

    return bool(
        document_type == "personal_note"
        or source_type == "personal_note"
        or source_id.startswith("personal_note_")
        or note_id
    )


def _get_chunk_text(
    chunk: dict,
) -> str:
    metadata = chunk.get("metadata") or {}

    return str(
        chunk.get("content")
        or chunk.get("text")
        or chunk.get("chunk_text")
        or metadata.get("content")
        or metadata.get("text")
        or ""
    ).strip()


def _get_chunk_title(
    chunk: dict,
) -> str:
    metadata = chunk.get("metadata") or {}

    return str(
        chunk.get("title")
        or chunk.get("llm_title")
        or metadata.get("title")
        or metadata.get("llm_title")
        or "Başlıksız kaynak"
    ).strip()


def _get_chunk_source_id(
    chunk: dict,
) -> str:
    metadata = chunk.get("metadata") or {}

    return str(
        chunk.get("source_id")
        or metadata.get("source_id")
        or chunk.get("url")
        or metadata.get("url")
        or chunk.get("title")
        or ""
    ).strip()


def _get_chunk_index(
    chunk: dict,
    fallback: int,
) -> int:
    metadata = chunk.get("metadata") or {}

    raw_index = (
        chunk.get("chunk_index")
        if chunk.get("chunk_index") is not None
        else metadata.get("chunk_index")
    )

    try:
        return int(raw_index)
    except (TypeError, ValueError):
        return fallback


def _chunks_to_note_inputs(
    chunks: list[dict],
) -> tuple[list[dict], list[dict]]:
    """
    Retriever veya vector store chunk'larını note_service girdisine
    dönüştürür.

    Aynı kaynağa ait web chunk'ları tek kaynak altında gruplanır.
    Aynı kişisel nota ait chunk'lar tek not metni olarak birleştirilir.
    """

    source_groups: dict[str, dict] = {}
    personal_note_groups: dict[str, dict] = {}

    for fallback_index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            continue

        text = _get_chunk_text(chunk)

        if not text:
            continue

        metadata = chunk.get("metadata") or {}
        title = _get_chunk_title(chunk)
        source_id = _get_chunk_source_id(chunk)
        chunk_index = _get_chunk_index(
            chunk,
            fallback_index,
        )

        if _is_personal_note_chunk(chunk):
            note_id = str(
                chunk.get("note_id")
                or metadata.get("note_id")
                or source_id
                or f"personal_note_{fallback_index}"
            ).strip()

            if note_id not in personal_note_groups:
                personal_note_groups[note_id] = {
                    "note_id": note_id,
                    "title": title or "Kişisel not",
                    "created_at": str(
                        chunk.get("created_at")
                        or metadata.get("created_at")
                        or ""
                    ).strip(),
                    "parts": [],
                }

            personal_note_groups[note_id]["parts"].append(
                {
                    "index": chunk_index,
                    "text": text,
                }
            )

            continue

        group_key = (
            source_id
            or _get_chunk_url(chunk)
            or title
            or f"source_{fallback_index}"
        )

        if group_key not in source_groups:
            source_groups[group_key] = {
                "source_id": source_id or group_key,
                "title": title,
                "url": _get_chunk_url(chunk),
                "domain": str(
                    chunk.get("domain")
                    or metadata.get("domain")
                    or ""
                ).strip(),
                "summary": str(
                    chunk.get("summary")
                    or metadata.get("summary")
                    or ""
                ).strip(),
                "short_summary": str(
                    chunk.get("short_summary")
                    or metadata.get("short_summary")
                    or ""
                ).strip(),
                "long_summary": str(
                    chunk.get("long_summary")
                    or metadata.get("long_summary")
                    or ""
                ).strip(),
                "summary_sections": (
                    chunk.get("summary_sections")
                    or metadata.get("summary_sections")
                    or []
                ),
                "source_type": str(
                    chunk.get("source_type")
                    or metadata.get("source_type")
                    or "web"
                ).strip(),
                "chunks": [],
            }

        source_groups[group_key]["chunks"].append(
            {
                "chunk_id": (
                    chunk.get("chunk_id")
                    or metadata.get("chunk_id")
                    or f"chunk_{fallback_index}"
                ),
                "text": text,
                "score": chunk.get("score"),
                "chunk_index": chunk_index,
                "metadata": metadata,
            }
        )

    sources = list(source_groups.values())

    for source in sources:
        source["chunks"].sort(
            key=lambda item: item.get(
                "chunk_index",
                0,
            )
        )

    personal_notes = []

    for note_group in personal_note_groups.values():
        parts = sorted(
            note_group.pop("parts"),
            key=lambda item: item.get(
                "index",
                0,
            ),
        )

        unique_texts = []
        seen_texts = set()

        for part in parts:
            part_text = str(
                part.get("text")
                or ""
            ).strip()

            if not part_text:
                continue

            if part_text in seen_texts:
                continue

            seen_texts.add(part_text)
            unique_texts.append(part_text)

        if not unique_texts:
            continue

        personal_notes.append(
            {
                **note_group,
                "text": "\n\n".join(
                    unique_texts
                ),
            }
        )

    return sources, personal_notes


def _build_note_generation_response(
    question: str,
    intent_result: dict,
    top_k: int,
    page_url: Optional[str],
    page_title: Optional[str],
    retrieval_scope: str,
) -> dict:
    """
    Not üretme intent'i için kaynakları toplar, note_service'i
    çağırır ve frontend action'ı oluşturur.
    """

    action_settings = _get_note_action(
        intent_result
    )

    note_scope = str(
        action_settings.get("scope")
        or "retrieved_sources"
    ).strip().lower()

    if note_scope not in {
        "retrieved_sources",
        "active_page",
        "all_sources",
    }:
        note_scope = "retrieved_sources"

    custom_title = str(
        action_settings.get("title")
        or ""
    ).strip()

    note_type = _infer_note_type(
        question
    )

    try:
        raw_chunks = _get_note_chunks(
            question=question,
            note_scope=note_scope,
            top_k=top_k,
            page_url=page_url,
            page_title=page_title,
            retrieval_scope=retrieval_scope,
        )
    except Exception as exc:
        return build_retriever_error_response(
            exc
        )

    sources, personal_notes = (
        _chunks_to_note_inputs(
            raw_chunks
        )
    )

    if not sources and not personal_notes:
        return {
            "answer": (
                "Not oluşturmak için kullanılabilecek "
                "bir kaynak veya kişisel not bulamadım."
            ),
            "sources": [],
            "chunks": [],
            "actions": [],
            "source_count": 0,
            "status": "no_sources",
            "error": None,
            "answer_type": "note_generation_request",
            "intent": intent_result,
        }

    try:
        note_result = asyncio.run(
            generate_note_from_inputs(
                note_type=note_type,
                custom_title=custom_title,
                language="tr",
                sources=sources,
                personal_notes=personal_notes,
                source_count=len(sources),
                personal_note_count=len(
                    personal_notes
                ),
                force=True,
            )
        )
    except Exception as exc:
        return {
            "answer": (
                "Not oluşturulurken bir hata oluştu."
            ),
            "sources": [],
            "chunks": [],
            "actions": [],
            "source_count": 0,
            "status": "error",
            "error": str(exc),
            "answer_type": "note_generation_request",
            "intent": intent_result,
        }

    note = note_result.get("note")

    if (
        not note_result.get("success")
        or not isinstance(note, dict)
    ):
        return {
            "answer": (
                note_result.get("message")
                or "Not oluşturulamadı."
            ),
            "sources": [],
            "chunks": [],
            "actions": [],
            "source_count": 0,
            "status": (
                note_result.get("status")
                or "error"
            ),
            "error": None,
            "answer_type": "note_generation_request",
            "intent": intent_result,
        }

    frontend_sources = build_source_payload(
        raw_chunks
    )

    frontend_chunks = build_chunk_payload(
        raw_chunks
    )

    note_action = {
        "type": "save_generated_note",
        "action_type": "save_generated_note",
        "reason": (
            "chat_natural_language_request"
        ),
        "note": note,
        "open_panel": (
            action_settings.get(
                "open_panel",
                True,
            )
            is not False
        ),
        "show_in_chat": (
            action_settings.get(
                "show_in_chat",
                True,
            )
            is not False
        ),
        "target_tab": "notes",
        "refresh_notes": True,
    }

    note_title = str(
        note.get("title")
        or "Yeni not"
    ).strip()

    input_count = int(
        note.get("input_count")
        or len(sources)
        + len(personal_notes)
    )

    return {
        "answer": (
            f"“{note_title}” başlıklı not oluşturuldu. "
            f"{input_count} içerik notun hazırlanmasında kullanıldı."
        ),
        "sources": frontend_sources,
        "chunks": frontend_chunks,
        "actions": [note_action],
        "source_count": len(
            frontend_sources
        ),
        "status": "success",
        "error": None,
        "answer_type": "note_generation_request",
        "intent": intent_result,
    }


def _build_rag_payloads(
    chunks: list[dict],
) -> tuple[
    list[dict],
    list[dict],
    list[dict],
    list[dict],
]:
    """
    Frontend ve prompt payload'larını oluşturur.
    """

    sources = build_source_payload(chunks)
    chunk_payload = build_chunk_payload(chunks)
    actions = build_action_payload(
        sources,
        chunk_payload,
    )
    prompt_chunks = build_prompt_chunks(chunks)

    return (
        sources,
        chunk_payload,
        actions,
        prompt_chunks,
    )


def _build_frontend_payloads(
    chunks: list[dict],
) -> tuple[
    list[dict],
    list[dict],
    list[dict],
]:
    """
    LLM cevabından sonra frontend payload'larını oluşturur.
    """

    sources = build_source_payload(chunks)
    chunk_payload = build_chunk_payload(chunks)
    actions = build_action_payload(
        sources,
        chunk_payload,
    )

    return (
        sources,
        chunk_payload,
        actions,
    )


def _generate_llm_answer(
    prompt: str,
) -> str:
    """
    RAG prompt'unu LLM'e gönderir.
    """

    llm = LLMService()

    return llm.generate_text(
        prompt=prompt,
        system_instruction=SYSTEM_INSTRUCTION,
        temperature=0.2,
        max_output_tokens=900,
    )


def _extract_json_from_text(
    text: str,
) -> dict:
    """
    LLM'den gelen JSON cevabı parse eder.
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

        return (
            parsed
            if isinstance(parsed, dict)
            else {}
        )
    except json.JSONDecodeError:
        pass

    start_index = cleaned.find("{")
    end_index = cleaned.rfind("}")

    if (
        start_index == -1
        or end_index == -1
        or end_index <= start_index
    ):
        return {}

    try:
        parsed = json.loads(
            cleaned[
                start_index:end_index + 1
            ]
        )

        return (
            parsed
            if isinstance(parsed, dict)
            else {}
        )
    except json.JSONDecodeError:
        return {}


def _normalize_used_context_indexes(
    raw_indexes,
    chunk_count: int,
) -> list[int]:
    """
    used_context_indexes listesini güvenli hale getirir.
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


def _parse_llm_rag_response(
    raw_answer: str,
) -> dict:
    """
    LLM'in RAG cevabını parse eder.
    """

    parsed = _extract_json_from_text(
        raw_answer
    )

    if not parsed:
        return {
            "answer": str(
                raw_answer or ""
            ).strip(),
            "used_context_indexes": [],
            "confidence": 0.0,
            "raw": raw_answer,
            "parsed": False,
        }

    answer = str(
        parsed.get("answer")
        or ""
    ).strip()

    if not answer:
        answer = str(
            raw_answer or ""
        ).strip()

    try:
        confidence = float(
            parsed.get("confidence", 0.0)
        )
    except (TypeError, ValueError):
        confidence = 0.0

    confidence = max(
        0.0,
        min(confidence, 1.0),
    )

    return {
        "answer": answer,
        "used_context_indexes": (
            parsed.get(
                "used_context_indexes",
                [],
            )
        ),
        "confidence": confidence,
        "raw": raw_answer,
        "parsed": True,
    }


def _prioritize_chunks_by_used_context_indexes(
    chunks: list[dict],
    used_context_indexes: list[int],
) -> list[dict]:
    """
    LLM'in kullandığı chunk'ları listenin başına alır.
    """

    if not isinstance(chunks, list) or not chunks:
        return []

    if not used_context_indexes:
        return chunks

    index_rank = {
        context_index: rank
        for rank, context_index
        in enumerate(used_context_indexes)
    }

    enriched_chunks = []

    for original_index, chunk in enumerate(
        chunks,
        start=1,
    ):
        if not isinstance(chunk, dict):
            continue

        enriched_chunks.append(
            {
                **chunk,
                "context_index": original_index,
                "used_by_answer": (
                    original_index
                    in index_rank
                ),
                "is_primary_chunk": False,
            }
        )

    if not enriched_chunks:
        return chunks

    enriched_chunks.sort(
        key=lambda chunk: (
            (
                0
                if chunk.get("context_index")
                in index_rank
                else 1
            ),
            index_rank.get(
                chunk.get("context_index"),
                9999,
            ),
            chunk.get("context_index")
            or 9999,
        )
    )

    prioritized_chunks = []

    for index, chunk in enumerate(
        enriched_chunks
    ):
        prioritized_chunks.append(
            {
                **chunk,
                "is_primary_chunk": (
                    index == 0
                ),
            }
        )

    return prioritized_chunks


def answer_chat(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> dict:
    """
    Chat endpoint'i tarafından çağrılan ana fonksiyon.
    """

    if not _is_valid_question(question):
        return build_empty_question_response()

    normalized_scope = normalize_scope(scope)
    safe_top_k = _normalize_top_k(top_k)

    intent_result = (
        _detect_chat_intent_result(
            question
        )
    )

    if is_source_navigation_intent(
        intent_result
    ):
        return build_source_navigation_response(
            intent_result
        )

    if _is_recommendation_request_intent(
        intent_result
    ):
        return (
            _build_recommendation_request_response(
                intent_result
            )
        )

    if _is_note_generation_request_intent(
        intent_result
    ):
        return _build_note_generation_response(
            question=question,
            intent_result=intent_result,
            top_k=safe_top_k,
            page_url=page_url,
            page_title=page_title,
            retrieval_scope=normalized_scope,
        )

    try:
        chunks = retrieve_relevant_chunks(
            question=question,
            top_k=safe_top_k,
            page_url=page_url,
            page_title=page_title,
            scope=normalized_scope,
        )
    except Exception as exc:
        return build_retriever_error_response(
            exc
        )

    (
        sources,
        chunk_payload,
        actions,
        prompt_chunks,
    ) = _build_rag_payloads(chunks)

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
        print(
            "Prompt chunks:",
            len(prompt_chunks),
        )
        print(
            "Frontend chunks:",
            len(chunk_payload),
        )
        print(
            "Prompt length:",
            len(prompt),
        )

    except Exception as exc:
        return build_prompt_error_response(
            error=exc,
            sources=sources,
            chunks=chunk_payload,
            actions=actions,
        )

    try:
        raw_llm_answer = _generate_llm_answer(
            prompt
        )
    except Exception as exc:
        return build_llm_error_response(
            error=exc,
            original_chunks=chunks,
            sources=sources,
            chunks=chunk_payload,
            actions=actions,
        )

    parsed_llm_response = (
        _parse_llm_rag_response(
            raw_llm_answer
        )
    )

    answer = (
        parsed_llm_response.get("answer")
        or ""
    )

    raw_used_context_indexes = (
        parsed_llm_response.get(
            "used_context_indexes",
            [],
        )
    )

    used_context_indexes = (
        _normalize_used_context_indexes(
            raw_indexes=(
                raw_used_context_indexes
            ),
            chunk_count=len(chunks),
        )
    )

    prioritized_chunks = (
        _prioritize_chunks_by_used_context_indexes(
            chunks=chunks,
            used_context_indexes=(
                used_context_indexes
            ),
        )
    )

    (
        final_sources,
        final_chunk_payload,
        final_actions,
    ) = _build_frontend_payloads(
        prioritized_chunks
    )

    return build_success_response(
        answer=answer,
        sources=final_sources,
        chunks=final_chunk_payload,
        actions=final_actions,
    )