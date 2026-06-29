"""
Dosya: core/chat/retriever_adapter.py

Görev:
- Chat akışı için retriever katmanını yönetir.
- backend/core/retriever.py içindeki uygun arama fonksiyonunu bulur.
- Mevcut retriever fonksiyonlarının farklı parametre yapılarına uyum sağlar.
- Retriever'dan dönen ham sonuçları normalize ederek ortak chunk formatına çevirir.

Not:
- Bu dosya LLM çağırmaz.
- Prompt oluşturmaz.
- Frontend payload hazırlamaz.
- Sadece kaynak/chunk getirme işinden sorumludur.
"""

from typing import Optional

from core.chat.payload_builder import normalize_chunk


def normalize_scope(scope: Optional[str]) -> str:
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

    Sebep:
    Proje geliştikçe retriever fonksiyonlarının imzası değişmiş olabilir.
    Bu yüzden farklı çağrı kombinasyonlarını sırayla deneriz.
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


def _extract_result_list(raw_results):
    """
    Retriever'dan dönen farklı cevap yapılarını listeye çevirir.
    """

    if raw_results is None:
        return []

    if isinstance(raw_results, dict):
        if "chunks" in raw_results:
            raw_results = raw_results["chunks"]
        elif "results" in raw_results:
            raw_results = raw_results["results"]
        elif "sources" in raw_results:
            raw_results = raw_results["sources"]
        else:
            raw_results = [raw_results]

    if isinstance(raw_results, list):
        return raw_results

    try:
        return list(raw_results)
    except TypeError:
        return [raw_results]


def retrieve_relevant_chunks(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> list[dict]:
    """
    backend/core/retriever.py içindeki uygun retrieve/search fonksiyonunu çağırır.

    Dönen sonuçlar normalize edilmiş chunk listesi olur.
    """

    try:
        import core.retriever as retriever_module
    except Exception as exc:
        raise RuntimeError(f"core.retriever import edilemedi: {exc}") from exc

    normalized_scope = normalize_scope(scope)

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
            "backend/core/retriever.py içinde retrieve_relevant_chunks, "
            "search veya retrieve fonksiyonu olmalı."
        )

    raw_result_list = _extract_result_list(raw_results)

    normalized_chunks = [
        normalize_chunk(item, index)
        for index, item in enumerate(raw_result_list, start=1)
    ]

    normalized_chunks = [
        chunk for chunk in normalized_chunks
        if chunk.get("content") and chunk.get("content").strip()
    ]

    return normalized_chunks[:top_k]