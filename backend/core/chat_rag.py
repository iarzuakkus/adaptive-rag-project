"""
Dosya: core/chat_rag.py

Görev:
- Chat V1 için RAG akışını yönetir.
- Retriever'dan ilgili chunk'ları alır.
- Prompt oluşturur.
- LLMService üzerinden Gemini cevabı üretir.
- Cevapla birlikte kaynakları döndürür.

Not:
Bu dosya mevcut core/rag.py dosyasını bozmamak için ayrı tutuldu.
"""

from typing import Any, Optional

from prompts.rag_prompt import SYSTEM_INSTRUCTION, build_rag_prompt
from services.llm_service import LLMService


def normalize_chunk(item: Any, index: int) -> dict:
    """
    Retriever'dan dönen farklı veri tiplerini ortak chunk formatına çevirir.
    """

    if isinstance(item, str):
        return {
            "id": f"chunk-{index}",
            "title": "Bilinmeyen kaynak",
            "url": "",
            "content": item,
            "score": None,
        }

    if isinstance(item, dict):
        score = (
            item.get("score")
            if item.get("score") is not None
            else item.get("similarity")
            if item.get("similarity") is not None
            else item.get("distance")
        )

        return {
            "id": item.get("id") or item.get("chunk_id") or f"chunk-{index}",
            "title": item.get("title") or item.get("page_title") or item.get("source_title") or "Başlıksız kaynak",
            "url": item.get("url") or item.get("page_url") or item.get("source_url") or "",
            "content": item.get("content") or item.get("text") or item.get("chunk") or item.get("page_content") or "",
            "score": score,
        }

    return {
        "id": f"chunk-{index}",
        "title": getattr(item, "title", "Bilinmeyen kaynak"),
        "url": getattr(item, "url", ""),
        "content": getattr(item, "content", "") or getattr(item, "text", ""),
        "score": getattr(item, "score", None),
    }


def _call_retriever_function(
    func,
    question: str,
    top_k: int,
    page_url: Optional[str],
):
    """
    Mevcut retriever fonksiyonunu güvenli şekilde çağırır.
    """

    call_patterns = [
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
) -> list[dict]:
    """
    backend/core/retriever.py içindeki retrieve fonksiyonunu çağırır.
    """

    try:
        import core.retriever as retriever_module
    except Exception as exc:
        raise RuntimeError(f"core.retriever import edilemedi: {exc}") from exc

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
        raw_results = list(raw_results)

    normalized_chunks = [
        normalize_chunk(item, index)
        for index, item in enumerate(raw_results, start=1)
    ]

    normalized_chunks = [
        chunk for chunk in normalized_chunks
        if chunk.get("content") and chunk.get("content").strip()
    ]

    return normalized_chunks[:top_k]


def answer_chat(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
) -> dict:
    """
    Chat endpoint'i tarafından çağrılacak ana fonksiyon.
    """

    if not question or not question.strip():
        return {
            "answer": "Lütfen bir soru yaz.",
            "sources": [],
            "source_count": 0,
            "status": "empty_question",
            "error": None,
        }

    try:
        chunks = retrieve_relevant_chunks(
            question=question,
            top_k=top_k,
            page_url=page_url,
        )
    except Exception as exc:
        return {
            "answer": (
                "LLM bağlantısı hazır ancak retriever bağlantısı kurulamadı. "
                "Bu yüzden henüz kaynaklı cevap üretemiyorum."
            ),
            "sources": [],
            "source_count": 0,
            "status": "retriever_error",
            "error": str(exc),
        }

    if not chunks:
        return {
            "answer": (
                "Bu soru için uygun kaynak bulunamadı. "
                "Önce sayfayı taraman veya daha fazla kaynak eklemen gerekebilir."
            ),
            "sources": [],
            "source_count": 0,
            "status": "no_sources",
            "error": None,
        }

    prompt = build_rag_prompt(
        question=question,
        chunks=chunks,
    )

    try:
        llm = LLMService()

        answer = llm.generate_text(
            prompt=prompt,
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.2,
            max_output_tokens=1200,
        )

    except Exception as exc:
        return {
            "answer": (
                "Kaynaklar bulundu ancak dil modeli cevabı üretirken hata oluştu."
            ),
            "sources": chunks,
            "source_count": len(chunks),
            "status": "llm_error",
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
        "sources": chunks,
        "source_count": len(chunks),
        "status": "success",
        "error": None,
    }