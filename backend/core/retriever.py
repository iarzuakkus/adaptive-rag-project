"""
Dosya: core/retriever.py

Görev:
- Kullanıcı sorusunu embedding'e çevirir.
- Vector store içinde en alakalı chunk'ları arar.
- Chat RAG için standart kaynak listesi döndürür.
"""

from typing import Any, Optional

from core.embeddings import generate_embedding
import core.vector_store as vector_store


def _normalize_item(item: Any, index: int) -> dict:
    """
    Vector store'dan dönen tek sonucu standart chunk formatına çevirir.
    """

    if isinstance(item, str):
        return {
            "id": f"chunk-{index}",
            "title": "Bilinmeyen kaynak",
            "url": "",
            "content": item,
            "score": None,
        }

    if isinstance(item, tuple):
        content = item[0] if len(item) > 0 else ""
        score = item[1] if len(item) > 1 else None

        if isinstance(content, dict):
            normalized = _normalize_item(content, index)
            normalized["score"] = score
            return normalized

        return {
            "id": f"chunk-{index}",
            "title": "Bilinmeyen kaynak",
            "url": "",
            "content": str(content),
            "score": score,
        }

    if isinstance(item, dict):
        metadata = item.get("metadata") or item.get("meta") or {}

        content = (
            item.get("content")
            or item.get("text")
            or item.get("chunk")
            or item.get("page_content")
            or item.get("document")
            or metadata.get("content")
            or metadata.get("text")
            or ""
        )

        title = (
            item.get("title")
            or item.get("page_title")
            or item.get("source_title")
            or metadata.get("title")
            or metadata.get("page_title")
            or "Başlıksız kaynak"
        )

        url = (
            item.get("url")
            or item.get("page_url")
            or item.get("source_url")
            or metadata.get("url")
            or metadata.get("page_url")
            or ""
        )

        item_id = (
            item.get("id")
            or item.get("chunk_id")
            or metadata.get("id")
            or metadata.get("chunk_id")
            or f"chunk-{index}"
        )

        score = (
            item.get("score")
            if item.get("score") is not None
            else item.get("similarity")
            if item.get("similarity") is not None
            else item.get("distance")
            if item.get("distance") is not None
            else item.get("relevance")
        )

        return {
            "id": item_id,
            "title": title,
            "url": url,
            "content": content,
            "score": score,
            "metadata": metadata,
        }

    return {
        "id": f"chunk-{index}",
        "title": getattr(item, "title", "Bilinmeyen kaynak"),
        "url": getattr(item, "url", ""),
        "content": getattr(item, "content", "") or getattr(item, "text", ""),
        "score": getattr(item, "score", None),
    }


def _is_widget_chunk(content: str) -> bool:
    """
    Extension widget'ına ait metinleri kesin olarak filtreler.
    Bunlar hiçbir zaman kaynak olarak kullanılmamalı.
    """

    if not content:
        return True

    lower_text = content.strip().lower()

    blocked_phrases = [
        "sayfayı tara butonuyla",
        "elle tarama aktif",
        "mevcut sayfayı kaynaklara ekleyebilirsin",
        "bu sayfayı tara",
        "kaynaklara ekleyebilirsin",
        "adaptive rag",
        "notlara ekle",
        "kaynaklar sekmesi",
    ]

    return any(phrase in lower_text for phrase in blocked_phrases)


def _is_soft_low_quality_chunk(content: str) -> bool:
    """
    Kaynakça/dipnot gibi zayıf metinleri işaretler.
    Bu filtre kesin değil; eğer tüm sonuçları elerse fallback yapılır.
    """

    if not content:
        return True

    text = content.strip()
    lower_text = text.lower()

    if len(text) < 50:
        return True

    citation_markers = [
        "erişim tarihi",
        "kaynağından arşivlendi",
        "isbn",
        "issn",
        "doi",
    ]

    citation_count = sum(
        1 for marker in citation_markers
        if marker in lower_text
    )

    if text.startswith("^") and citation_count >= 1:
        return True

    if citation_count >= 2:
        return True

    return False


def _normalize_results(
    raw_results: Any,
    top_k: int,
    page_url: Optional[str] = None,
) -> list[dict]:
    """
    Vector store'dan gelen farklı sonuç formatlarını listeye çevirir.

    Filtre mantığı:
    - Widget metinleri kesin silinir.
    - Kaynakça/dipnot metinleri mümkünse silinir.
    - Eğer tüm sonuçlar silinirse, boş dönmek yerine kullanılabilir ham sonuçlardan devam edilir.
    """

    if raw_results is None:
        print("RETRIEVER RAW RESULT COUNT: 0")
        return []

    if isinstance(raw_results, dict):
        if "results" in raw_results:
            raw_results = raw_results["results"]

        elif "chunks" in raw_results:
            raw_results = raw_results["chunks"]

        elif "sources" in raw_results:
            raw_results = raw_results["sources"]

        elif "documents" in raw_results:
            documents = raw_results.get("documents") or []
            metadatas = raw_results.get("metadatas") or []
            ids = raw_results.get("ids") or []
            distances = raw_results.get("distances") or []

            if documents and isinstance(documents[0], list):
                documents = documents[0]

            if metadatas and isinstance(metadatas[0], list):
                metadatas = metadatas[0]

            if ids and isinstance(ids[0], list):
                ids = ids[0]

            if distances and isinstance(distances[0], list):
                distances = distances[0]

            converted = []

            for index, document in enumerate(documents):
                metadata = (
                    metadatas[index]
                    if index < len(metadatas) and metadatas[index]
                    else {}
                )

                converted.append({
                    "id": ids[index] if index < len(ids) else f"chunk-{index + 1}",
                    "title": metadata.get("title") or metadata.get("page_title") or "Başlıksız kaynak",
                    "url": metadata.get("url") or metadata.get("page_url") or "",
                    "content": document,
                    "score": distances[index] if index < len(distances) else None,
                    "metadata": metadata,
                })

            raw_results = converted

        else:
            raw_results = [raw_results]

    if not isinstance(raw_results, list):
        raw_results = list(raw_results)

    print("RETRIEVER RAW RESULT COUNT:", len(raw_results))

    normalized = [
        _normalize_item(item, index)
        for index, item in enumerate(raw_results, start=1)
    ]

    normalized = [
        item for item in normalized
        if item.get("content")
        and item.get("content").strip()
    ]

    print("RETRIEVER NORMALIZED COUNT:", len(normalized))

    if page_url:
        filtered_by_url = [
            item for item in normalized
            if item.get("url") == page_url
        ]

        if filtered_by_url:
            normalized = filtered_by_url

    hard_filtered = [
        item for item in normalized
        if not _is_widget_chunk(item.get("content", ""))
    ]

    print("RETRIEVER HARD FILTERED COUNT:", len(hard_filtered))

    if not hard_filtered:
        hard_filtered = normalized

    soft_filtered = [
        item for item in hard_filtered
        if not _is_soft_low_quality_chunk(item.get("content", ""))
    ]

    print("RETRIEVER SOFT FILTERED COUNT:", len(soft_filtered))

    final_results = soft_filtered if soft_filtered else hard_filtered

    print("RETRIEVER FINAL COUNT:", len(final_results))

    return final_results[:top_k]


def _call_vector_store_with_embedding(
    query_embedding: list[float],
    top_k: int,
):
    """
    Vector store aramasını sadece embedding ile yapar.
    Düz metin soru asla buraya gönderilmez.
    """

    possible_function_names = [
        "search_similar_chunks",
        "similarity_search",
        "semantic_search",
        "search_chunks",
        "query_vector_store",
        "query",
        "search",
    ]

    last_error = None

    for function_name in possible_function_names:
        func = getattr(vector_store, function_name, None)

        if not callable(func):
            continue

        call_patterns = [
            lambda: func(query_embedding=query_embedding, top_k=top_k),
            lambda: func(embedding=query_embedding, top_k=top_k),
            lambda: func(vector=query_embedding, top_k=top_k),
            lambda: func(query_vector=query_embedding, top_k=top_k),
            lambda: func(query_embedding, top_k=top_k),
            lambda: func(query_embedding, top_k),
            lambda: func(query_embedding),
        ]

        for call in call_patterns:
            try:
                result = call()

                if result is not None:
                    print(f"Vector store fonksiyonu kullanıldı: {function_name}")
                    return result

            except (TypeError, ValueError) as exc:
                last_error = exc
                continue

    raise RuntimeError(
        "Vector store embedding ile çağrılamadı. "
        f"Son hata: {last_error}"
    )


def retrieve_relevant_chunks(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
) -> list[dict]:
    """
    Chat RAG tarafından çağrılan ana fonksiyon.
    """

    if not question or not question.strip():
        return []

    query_embedding = generate_embedding(question)

    print("QUERY:", question)
    print("QUERY EMBEDDING TYPE:", type(query_embedding))
    print("QUERY EMBEDDING LENGTH:", len(query_embedding))
    print("QUERY EMBEDDING PREVIEW:", query_embedding[:5])

    candidate_k = max(top_k * 4, 20)

    raw_results = _call_vector_store_with_embedding(
        query_embedding=query_embedding,
        top_k=candidate_k,
    )

    return _normalize_results(
        raw_results=raw_results,
        top_k=top_k,
        page_url=page_url,
    )


def search(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
) -> list[dict]:
    return retrieve_relevant_chunks(
        question=question,
        top_k=top_k,
        page_url=page_url,
    )


def retrieve(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
) -> list[dict]:
    return retrieve_relevant_chunks(
        question=question,
        top_k=top_k,
        page_url=page_url,
    )