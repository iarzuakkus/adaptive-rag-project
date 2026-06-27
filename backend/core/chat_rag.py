"""
Dosya: core/chat_rag.py

Görev:
- Chat V1 için RAG akışını yönetir.
- Retriever'dan ilgili chunk'ları alır.
- Prompt oluşturur.
- LLMService üzerinden Gemini cevabı üretir.
- Cevapla birlikte kaynakları, source_id/chunk_id bilgileriyle döndürür.

Not:
Bu dosya mevcut core/rag.py dosyasını bozmamak için ayrı tutuldu.

Önemli düzeltme:
- Frontend'e zengin kaynak/chunk bilgisi döndürülür.
- Ancak LLM prompt'una eski sürümdeki gibi sade chunk verisi gönderilir.
- Böylece source_id, chunk_id, metadata, text, chunk_text gibi ek alanlar prompt'u gereksiz büyütmez.
"""

from typing import Any, Optional

from prompts.rag_prompt import SYSTEM_INSTRUCTION, build_rag_prompt
from services.llm_service import LLMService


def _as_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pick_first(*values, default=None):
    for value in values:
        if value is not None and value != "":
            return value

    return default


def normalize_chunk(item: Any, index: int) -> dict:
    """
    Retriever'dan dönen farklı veri tiplerini ortak chunk formatına çevirir.

    Bu fonksiyon source_id ve chunk_id alanlarını korur.
    Çünkü frontend kaynak detayı ve highlight işlemleri bu alanlara ihtiyaç duyar.
    """

    if isinstance(item, str):
        chunk_id = f"chunk-{index}"
        text = item.strip()

        return {
            "id": chunk_id,
            "source_id": None,
            "chunk_id": chunk_id,
            "title": "Bilinmeyen kaynak",
            "url": "",
            "domain": "",
            "content": text,
            "text": text,
            "chunk_text": text,
            "chunk_index": index - 1,
            "score": None,
            "metadata": {},
        }

    if isinstance(item, dict):
        metadata = item.get("metadata") or {}

        content = _pick_first(
            item.get("content"),
            item.get("text"),
            item.get("chunk_text"),
            item.get("chunk"),
            item.get("page_content"),
            metadata.get("content"),
            metadata.get("text"),
            metadata.get("chunk_text"),
            default="",
        )

        text = str(content).strip() if content is not None else ""

        title = _pick_first(
            item.get("title"),
            item.get("page_title"),
            item.get("source_title"),
            metadata.get("title"),
            metadata.get("page_title"),
            metadata.get("source_title"),
            default="Başlıksız kaynak",
        )

        url = _pick_first(
            item.get("url"),
            item.get("page_url"),
            item.get("source_url"),
            metadata.get("url"),
            metadata.get("page_url"),
            metadata.get("source_url"),
            default="",
        )

        domain = _pick_first(
            item.get("domain"),
            metadata.get("domain"),
            default="",
        )

        source_id = _pick_first(
            item.get("source_id"),
            metadata.get("source_id"),
            default=None,
        )

        chunk_id = _pick_first(
            item.get("chunk_id"),
            metadata.get("chunk_id"),
            item.get("id"),
            metadata.get("id"),
            default=f"chunk-{index}",
        )

        item_id = _pick_first(
            item.get("id"),
            item.get("chunk_id"),
            metadata.get("id"),
            metadata.get("chunk_id"),
            default=chunk_id,
        )

        chunk_index = _pick_first(
            item.get("chunk_index"),
            metadata.get("chunk_index"),
            default=index - 1,
        )

        raw_score = _pick_first(
            item.get("score"),
            item.get("similarity"),
            item.get("distance"),
            item.get("relevance"),
            default=None,
        )

        score = _as_float(raw_score)

        return {
            "id": item_id,
            "source_id": source_id,
            "chunk_id": chunk_id,
            "title": title,
            "url": url,
            "domain": domain,
            "content": text,
            "text": text,
            "chunk_text": text,
            "chunk_index": chunk_index,
            "score": score,
            "metadata": {
                **metadata,
                "source_id": source_id,
                "chunk_id": chunk_id,
                "title": title,
                "url": url,
                "domain": domain,
                "chunk_index": chunk_index,
            },
        }

    content = getattr(item, "content", "") or getattr(item, "text", "")
    text = str(content).strip() if content is not None else ""
    chunk_id = getattr(item, "chunk_id", f"chunk-{index}")

    return {
        "id": getattr(item, "id", chunk_id),
        "source_id": getattr(item, "source_id", None),
        "chunk_id": chunk_id,
        "title": getattr(item, "title", "Bilinmeyen kaynak"),
        "url": getattr(item, "url", ""),
        "domain": getattr(item, "domain", ""),
        "content": text,
        "text": text,
        "chunk_text": text,
        "chunk_index": getattr(item, "chunk_index", index - 1),
        "score": _as_float(getattr(item, "score", None)),
        "metadata": {},
    }


def build_source_payload(chunks: list[dict]) -> list[dict]:
    """
    Chat cevabıyla frontend'e dönecek kaynak listesini hazırlar.
    """

    sources = []

    for index, chunk in enumerate(chunks, start=1):
        sources.append({
            "source_id": chunk.get("source_id"),
            "chunk_id": chunk.get("chunk_id"),
            "title": chunk.get("title") or "Başlıksız kaynak",
            "url": chunk.get("url") or "",
            "domain": chunk.get("domain") or "",
            "chunk_text": chunk.get("chunk_text") or chunk.get("content") or "",
            "chunk_index": chunk.get("chunk_index", index - 1),
            "score": chunk.get("score"),
            "rank": index,
        })

    return sources


def build_action_payload(sources: list[dict]) -> list[dict]:
    """
    İleride frontend'in çalıştırabileceği kaynak aksiyonlarını üretir.
    """

    actions = []

    for source in sources:
        source_id = source.get("source_id")
        chunk_id = source.get("chunk_id")
        url = source.get("url")

        if source_id:
            actions.append({
                "action_type": "show_source",
                "source_id": source_id,
                "chunk_id": chunk_id,
                "url": url,
            })

        if source_id and chunk_id:
            actions.append({
                "action_type": "highlight_chunk",
                "source_id": source_id,
                "chunk_id": chunk_id,
                "url": url,
            })

    return actions


def build_prompt_chunks(chunks: list[dict], max_content_length: int = 1000) -> list[dict]:
    """
    LLM prompt'una gönderilecek sade chunk listesini üretir.

    Frontend için source_id, chunk_id, domain, metadata gibi alanları koruyoruz.
    Ancak LLM'e eski çalışan sürümdeki gibi sade veri gönderiyoruz:

    - id
    - title
    - url
    - content
    - score

    Böylece prompt gereksiz büyümez.
    """

    prompt_chunks = []

    for index, chunk in enumerate(chunks, start=1):
        content = (
            chunk.get("content")
            or chunk.get("text")
            or chunk.get("chunk_text")
            or ""
        )

        cleaned_content = str(content).strip()

        if not cleaned_content:
            continue

        if len(cleaned_content) > max_content_length:
            cleaned_content = cleaned_content[:max_content_length].strip() + "..."

        prompt_chunks.append({
            "id": chunk.get("id") or chunk.get("chunk_id") or f"chunk-{index}",
            "title": chunk.get("title") or "Başlıksız kaynak",
            "url": chunk.get("url") or "",
            "content": cleaned_content,
            "score": chunk.get("score"),
        })

    return prompt_chunks


def build_llm_error_fallback_answer(chunks: list[dict]) -> str:
    """
    LLM hata verdiğinde kaynaklardan kısa fallback cevap üretir.
    Böylece retriever kaynak bulduğu halde kullanıcı tamamen boş hata görmez.
    """

    fallback_parts = []

    for index, chunk in enumerate(chunks[:3], start=1):
        title = chunk.get("title") or "Başlıksız kaynak"
        content = (
            chunk.get("content")
            or chunk.get("text")
            or chunk.get("chunk_text")
            or ""
        )

        cleaned_content = content.strip()

        if not cleaned_content:
            continue

        if len(cleaned_content) > 420:
            cleaned_content = cleaned_content[:420].strip() + "..."

        fallback_parts.append(
            f"{index}. {title}\n{cleaned_content}"
        )

    if fallback_parts:
        return (
            "Kaynaklar bulundu ancak dil modeli şu anda cevap üretemedi. "
            "Aşağıda bulunan kaynak parçalarından çıkarılabilecek en ilgili içerikleri gösteriyorum:\n\n"
            + "\n\n".join(fallback_parts)
        )

    return (
        "Kaynaklar bulundu ancak dil modeli şu anda cevap üretemedi. "
        "Ayrıca gösterilebilecek temiz kaynak parçası bulunamadı."
    )


def _normalize_scope(scope: Optional[str]) -> str:
    """
    Scope değerini güvenli hale getirir.
    """

    if not scope:
        return "auto"

    cleaned_scope = str(scope).strip().lower()

    if not cleaned_scope:
        return "auto"

    return cleaned_scope


def _call_retriever_function(
    func,
    question: str,
    top_k: int,
    page_url: Optional[str],
    page_title: Optional[str],
    scope: str,
):
    """
    Mevcut retriever fonksiyonunu güvenli şekilde çağırır.
    """

    call_patterns = [
        lambda: func(
            question=question,
            top_k=top_k,
            page_url=page_url,
            page_title=page_title,
            scope=scope,
        ),
        lambda: func(
            query=question,
            top_k=top_k,
            page_url=page_url,
            page_title=page_title,
            scope=scope,
        ),
        lambda: func(
            question=question,
            top_k=top_k,
            page_url=page_url,
            page_title=page_title,
        ),
        lambda: func(
            query=question,
            top_k=top_k,
            page_url=page_url,
            page_title=page_title,
        ),
        lambda: func(
            question=question,
            top_k=top_k,
            page_url=page_url,
            scope=scope,
        ),
        lambda: func(
            query=question,
            top_k=top_k,
            page_url=page_url,
            scope=scope,
        ),
        lambda: func(question=question, top_k=top_k, page_url=page_url),
        lambda: func(question, top_k=top_k, page_url=page_url),
        lambda: func(query=question, top_k=top_k, page_url=page_url),
        lambda: func(question=question, top_k=top_k),
        lambda: func(question, top_k=top_k),
        lambda: func(query=question, top_k=top_k),
        lambda: func(question),
    ]

    last_error = None

    for call in call_patterns:
        try:
            return call()
        except TypeError as exc:
            last_error = exc

    raise RuntimeError(f"Retriever fonksiyonu çağrılamadı: {last_error}")


def retrieve_relevant_chunks(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> list[dict]:
    """
    backend/core/retriever.py içindeki retrieve fonksiyonunu çağırır.
    """

    try:
        import core.retriever as retriever_module
    except Exception as exc:
        raise RuntimeError(f"core.retriever import edilemedi: {exc}") from exc

    normalized_scope = _normalize_scope(scope)

    possible_function_names = [
        "retrieve_relevant_chunks",
        "retrieve_chunks",
        "semantic_search",
        "search_similar_chunks",
        "search_chunks",
        "search",
        "retrieve",
    ]

    raw_results = None

    for function_name in possible_function_names:
        func = getattr(retriever_module, function_name, None)

        if callable(func):
            raw_results = _call_retriever_function(
                func=func,
                question=question,
                top_k=top_k,
                page_url=page_url,
                page_title=page_title,
                scope=normalized_scope,
            )
            break

    if raw_results is None:
        raise RuntimeError(
            "Uygun retriever fonksiyonu bulunamadı. "
            "backend/core/retriever.py içinde retrieve_relevant_chunks, search veya retrieve fonksiyonu olmalı."
        )

    if isinstance(raw_results, dict):
        if "chunks" in raw_results:
            raw_results = raw_results["chunks"]
        elif "results" in raw_results:
            raw_results = raw_results["results"]
        elif "sources" in raw_results:
            raw_results = raw_results["sources"]
        else:
            raw_results = [raw_results]

    if not isinstance(raw_results, list):
        try:
            raw_results = list(raw_results)
        except TypeError:
            raw_results = [raw_results]

    normalized_chunks = [
        normalize_chunk(item, index)
        for index, item in enumerate(raw_results, start=1)
    ]

    normalized_chunks = [
        chunk for chunk in normalized_chunks
        if chunk.get("content") and chunk.get("content").strip()
    ]

    return normalized_chunks[:top_k]


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


def answer_chat(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> dict:
    """
    Chat endpoint'i tarafından çağrılacak ana fonksiyon.
    """

    if not question or not question.strip():
        return {
            "answer": "Lütfen bir soru yaz.",
            "sources": [],
            "chunks": [],
            "actions": [],
            "source_count": 0,
            "status": "empty_question",
            "error": None,
        }

    normalized_scope = _normalize_scope(scope)

    safe_top_k = top_k

    if not isinstance(safe_top_k, int) or safe_top_k <= 0:
        safe_top_k = 5

    try:
        chunks = retrieve_relevant_chunks(
            question=question,
            top_k=safe_top_k,
            page_url=page_url,
            page_title=page_title,
            scope=normalized_scope,
        )
    except Exception as exc:
        return {
            "answer": (
                "LLM bağlantısı hazır ancak retriever bağlantısı kurulamadı. "
                "Bu yüzden henüz kaynaklı cevap üretemiyorum."
            ),
            "sources": [],
            "chunks": [],
            "actions": [],
            "source_count": 0,
            "status": "retriever_error",
            "error": str(exc),
        }

    sources = build_source_payload(chunks)
    actions = build_action_payload(sources)

    if not chunks:
        return {
            "answer": (
                "Bu soru için uygun kaynak bulunamadı. "
                "Önce sayfayı taraman veya daha fazla kaynak eklemen gerekebilir."
            ),
            "sources": [],
            "chunks": [],
            "actions": [],
            "source_count": 0,
            "status": "no_sources",
            "error": None,
        }

    prompt_chunks = build_prompt_chunks(chunks)

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
        print("Prompt length:", len(prompt))

    except Exception as exc:
        return {
            "answer": "Kaynaklar bulundu ancak RAG prompt'u oluşturulurken hata oluştu.",
            "sources": sources,
            "chunks": chunks,
            "actions": actions,
            "source_count": len(sources),
            "status": "prompt_error",
            "error": str(exc),
        }

    try:
        llm = LLMService()

        answer = llm.generate_text(
            prompt=prompt,
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.2,
            max_output_tokens=900,
        )

    except Exception as exc:
        fallback_answer = build_llm_error_fallback_answer(chunks)

        return {
            "answer": fallback_answer,
            "sources": sources,
            "chunks": chunks,
            "actions": actions,
            "source_count": len(sources),
            "status": "llm_error_with_sources",
            "error": str(exc),
        }

    if not answer or not answer.strip():
        answer = (
            "Bu soru için kaynaklar bulundu ancak model boş cevap döndürdü. "
            "Bulunan kaynaklar sayfanın ana metninden çok kaynakça, dipnot veya zayıf içerik parçaları olabilir. "
            "Bu nedenle daha net cevap için sayfanın ana içerik kısmının daha temiz taranması gerekir."
        )

    return {
        "answer": answer.strip(),
        "sources": sources,
        "chunks": chunks,
        "actions": actions,
        "source_count": len(sources),
        "status": "success",
        "error": None,
    }