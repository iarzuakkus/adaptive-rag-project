"""
Dosya: core/retriever.py

Görev:
- Kullanıcı sorusunu embedding'e çevirir.
- Vector store içinde tüm taranmış kaynaklar arasında semantik arama yapar.
- Chat RAG için standart kaynak/chunk listesi döndürür.

Temel mantık:
- page_url / page_title bilgisi frontend tarafından gönderilebilir.
- Ancak bu sürümde retriever bu bilgileri katı filtre olarak kullanmaz.
- Kullanıcı "bu sayfa" dese bile kaynakları URL'ye göre kilitlemez.
- En alakalı chunk'lar tamamen embedding benzerliğine göre seçilir.

Önemli:
- LLM destekli kaynak özet alanları korunur:
  llm_title, short_summary, long_summary, summary_status
- Widget UI metinleri filtrelenir.
- Ancak "MemorAI" veya "Adaptive RAG" gibi ürün/proje isimleri tek başına filtrelenmez.
"""

from typing import Any, Optional

from core.embeddings import generate_embedding
import core.vector_store as vector_store


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


def _normalize_item(item: Any, index: int) -> dict:
    """
    Vector store'dan dönen tek sonucu standart chunk formatına çevirir.

    Standart dönüş:
    - id
    - source_id
    - chunk_id
    - title
    - llm_title
    - url
    - domain
    - short_summary
    - long_summary
    - summary_status
    - content
    - text
    - chunk_text
    - chunk_index
    - score
    - metadata
    """

    if isinstance(item, str):
        chunk_id = f"chunk-{index}"
        text = item.strip()

        return {
            "id": chunk_id,
            "source_id": None,
            "chunk_id": chunk_id,
            "title": "Bilinmeyen kaynak",
            "llm_title": "Bilinmeyen kaynak",
            "url": "",
            "domain": "",
            "short_summary": "",
            "long_summary": "",
            "summary_status": "unknown",
            "content": text,
            "text": text,
            "chunk_text": text,
            "chunk_index": index - 1,
            "score": None,
            "metadata": {},
        }

    if isinstance(item, tuple):
        content = item[0] if len(item) > 0 else ""
        score = item[1] if len(item) > 1 else None

        if isinstance(content, dict):
            normalized = _normalize_item(content, index)
            normalized["score"] = _as_float(score)
            return normalized

        chunk_id = f"chunk-{index}"
        text = str(content).strip()

        return {
            "id": chunk_id,
            "source_id": None,
            "chunk_id": chunk_id,
            "title": "Bilinmeyen kaynak",
            "llm_title": "Bilinmeyen kaynak",
            "url": "",
            "domain": "",
            "short_summary": "",
            "long_summary": "",
            "summary_status": "unknown",
            "content": text,
            "text": text,
            "chunk_text": text,
            "chunk_index": index - 1,
            "score": _as_float(score),
            "metadata": {},
        }

    if isinstance(item, dict):
        metadata = item.get("metadata") or item.get("meta") or {}

        content = _pick_first(
            item.get("content"),
            item.get("text"),
            item.get("chunk_text"),
            item.get("chunk"),
            item.get("page_content"),
            item.get("document"),
            metadata.get("content"),
            metadata.get("text"),
            metadata.get("chunk_text"),
            default="",
        )

        title = _pick_first(
            item.get("title"),
            item.get("page_title"),
            item.get("source_title"),
            metadata.get("title"),
            metadata.get("page_title"),
            metadata.get("source_title"),
            default="Başlıksız kaynak",
        )

        llm_title = _pick_first(
            item.get("llm_title"),
            metadata.get("llm_title"),
            title,
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

        safe_score = _as_float(raw_score)

        short_summary = _pick_first(
            item.get("short_summary"),
            metadata.get("short_summary"),
            default="",
        )

        long_summary = _pick_first(
            item.get("long_summary"),
            metadata.get("long_summary"),
            default="",
        )

        summary_status = _pick_first(
            item.get("summary_status"),
            metadata.get("summary_status"),
            default="unknown",
        )

        text = str(content).strip() if content is not None else ""

        return {
            "id": item_id,
            "source_id": source_id,
            "chunk_id": chunk_id,
            "title": title,
            "llm_title": llm_title,
            "url": url,
            "domain": domain,
            "short_summary": short_summary,
            "long_summary": long_summary,
            "summary_status": summary_status,
            "content": text,
            "text": text,
            "chunk_text": text,
            "chunk_index": chunk_index,
            "score": safe_score,
            "metadata": {
                **metadata,
                "source_id": source_id,
                "chunk_id": chunk_id,
                "title": title,
                "llm_title": llm_title,
                "url": url,
                "domain": domain,
                "short_summary": short_summary,
                "long_summary": long_summary,
                "summary_status": summary_status,
                "chunk_index": chunk_index,
            },
        }

    content = getattr(item, "content", "") or getattr(item, "text", "")
    text = str(content).strip() if content is not None else ""

    chunk_id = getattr(item, "chunk_id", f"chunk-{index}")
    title = getattr(item, "title", "Bilinmeyen kaynak")
    llm_title = getattr(item, "llm_title", title)

    return {
        "id": getattr(item, "id", chunk_id),
        "source_id": getattr(item, "source_id", None),
        "chunk_id": chunk_id,
        "title": title,
        "llm_title": llm_title,
        "url": getattr(item, "url", ""),
        "domain": getattr(item, "domain", ""),
        "short_summary": getattr(item, "short_summary", ""),
        "long_summary": getattr(item, "long_summary", ""),
        "summary_status": getattr(item, "summary_status", "unknown"),
        "content": text,
        "text": text,
        "chunk_text": text,
        "chunk_index": getattr(item, "chunk_index", index - 1),
        "score": _as_float(getattr(item, "score", None)),
        "metadata": {},
    }


def _is_widget_chunk(content: str) -> bool:
    """
    Extension widget'ına ait metinleri kesin olarak filtreler.

    Dikkat:
    Burada "memorai" veya "adaptive rag" gibi genel ürün isimleri filtrelenmez.
    Çünkü kullanıcı kendi proje dokümanlarını da tarayabilir.
    """

    if not content:
        return True

    lower_text = content.strip().lower()

    blocked_phrases = [
        "sayfayı tara butonuyla",
        "sayfayi tara butonuyla",
        "elle tarama aktif",
        "mevcut sayfayı kaynaklara ekleyebilirsin",
        "mevcut sayfayi kaynaklara ekleyebilirsin",
        "bu sayfayı tara",
        "bu sayfayi tara",
        "kaynaklara ekleyebilirsin",
        "rag-widget",
        "notlara ekle",
        "kaynaklar sekmesi",
        "chat sekmesi",
        "sayfayı kaynaklara ekle",
        "sayfayi kaynaklara ekle",
    ]

    return any(phrase in lower_text for phrase in blocked_phrases)


def _is_soft_low_quality_chunk(content: str) -> bool:
    """
    Kaynakça/dipnot gibi zayıf metinleri mümkünse eler.
    """

    if not content:
        return True

    text = content.strip()
    lower_text = text.lower()

    if len(text) < 50:
        return True

    citation_markers = [
        "erişim tarihi",
        "erisim tarihi",
        "kaynağından arşivlendi",
        "kaynagindan arsivlendi",
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


def _convert_raw_results(raw_results: Any) -> list:
    """
    Vector store'dan gelen farklı sonuç formatlarını listeye çevirir.
    """

    if raw_results is None:
        return []

    if isinstance(raw_results, dict):
        if "results" in raw_results:
            return raw_results["results"]

        if "chunks" in raw_results:
            return raw_results["chunks"]

        if "sources" in raw_results:
            return raw_results["sources"]

        if "documents" in raw_results:
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

                safe_id = ids[index] if index < len(ids) else None

                chunk_id = (
                    metadata.get("chunk_id")
                    or metadata.get("id")
                    or safe_id
                    or f"chunk-{index + 1}"
                )

                title = (
                    metadata.get("title")
                    or metadata.get("page_title")
                    or metadata.get("source_title")
                    or "Başlıksız kaynak"
                )

                llm_title = (
                    metadata.get("llm_title")
                    or title
                )

                converted.append({
                    "id": chunk_id,
                    "source_id": metadata.get("source_id"),
                    "chunk_id": chunk_id,
                    "title": title,
                    "llm_title": llm_title,
                    "url": metadata.get("url") or metadata.get("page_url") or metadata.get("source_url") or "",
                    "domain": metadata.get("domain") or "",
                    "short_summary": metadata.get("short_summary") or "",
                    "long_summary": metadata.get("long_summary") or "",
                    "summary_status": metadata.get("summary_status") or "unknown",
                    "content": document,
                    "text": document,
                    "chunk_text": document,
                    "chunk_index": metadata.get("chunk_index", index),
                    "score": distances[index] if index < len(distances) else None,
                    "metadata": metadata,
                })

            return converted

        return [raw_results]

    if isinstance(raw_results, list):
        return raw_results

    try:
        return list(raw_results)
    except TypeError:
        return [raw_results]


def _apply_score_filter(results: list[dict]) -> list[dict]:
    """
    En iyi semantic skorun çok altında kalan sonuçları eler.
    Bu filtre URL filtresi değildir; sadece semantik olarak çok zayıf sonuçları azaltır.

    Not:
    Projede FAISS IndexFlatIP + normalize embedding kullanıldığı için yüksek skor daha iyidir.
    """

    scores = [
        _as_float(item.get("score"))
        for item in results
        if _as_float(item.get("score")) is not None
    ]

    if not scores:
        return results

    best_score = max(scores)

    if best_score <= 0:
        return results

    relative_threshold = best_score * 0.45

    filtered = [
        item for item in results
        if item.get("score") is None
        or _as_float(item.get("score")) is None
        or _as_float(item.get("score")) >= relative_threshold
    ]

    return filtered if filtered else results


def _sort_results(results: list[dict]) -> list[dict]:
    """
    Sonuçları semantic score'a göre sıralar.
    Aktif sayfa için ekstra avantaj verilmez.
    """

    def rank_value(item: dict) -> float:
        return _as_float(item.get("score")) or 0.0

    return sorted(results, key=rank_value, reverse=True)


def _dedupe_results(results: list[dict]) -> list[dict]:
    """
    Aynı chunk'ın tekrar dönmesini engeller.
    Önce chunk_id kullanır, yoksa url + içerik önizlemesine düşer.
    """

    seen = set()
    unique_results = []

    for item in results:
        chunk_id = item.get("chunk_id")
        source_id = item.get("source_id")

        if source_id and chunk_id:
            key = (source_id, chunk_id)
        else:
            key = (
                item.get("url") or "",
                item.get("title") or "",
                (item.get("content") or "")[:120],
            )

        if key in seen:
            continue

        seen.add(key)
        unique_results.append(item)

    return unique_results


def _normalize_results(
    raw_results: Any,
    top_k: int,
) -> list[dict]:
    """
    Vector store sonucunu temizler.
    Burada URL, aktif sayfa veya scope filtresi uygulanmaz.
    """

    raw_list = _convert_raw_results(raw_results)

    print("RETRIEVER RAW RESULT COUNT:", len(raw_list))

    normalized = [
        _normalize_item(item, index)
        for index, item in enumerate(raw_list, start=1)
    ]

    normalized = [
        item for item in normalized
        if item.get("content")
        and item.get("content").strip()
    ]

    print("RETRIEVER NORMALIZED COUNT:", len(normalized))

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

    results = soft_filtered if soft_filtered else hard_filtered

    results = _apply_score_filter(results)
    results = _sort_results(results)
    results = _dedupe_results(results)

    print("RETRIEVER FINAL COUNT:", len(results))

    return results[:top_k]


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
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> list[dict]:
    """
    Chat RAG tarafından çağrılan ana fonksiyon.

    Not:
    page_url, page_title ve scope parametreleri geriye uyumluluk için alınır.
    Bu sürümde retrieval filtresi olarak kullanılmaz.
    """

    if not question or not question.strip():
        return []

    safe_top_k = top_k if isinstance(top_k, int) and top_k > 0 else 5

    query_embedding = generate_embedding(question)

    print("\nRETRIEVER QUERY")
    print("-" * 40)
    print("QUERY:", question)
    print("QUERY PAGE URL:", page_url)
    print("QUERY PAGE TITLE:", page_title)
    print("QUERY SCOPE:", scope)
    print("QUERY EMBEDDING TYPE:", type(query_embedding))
    print("QUERY EMBEDDING LENGTH:", len(query_embedding))
    print("QUERY EMBEDDING PREVIEW:", query_embedding[:5])

    candidate_k = max(safe_top_k * 6, 30)

    raw_results = _call_vector_store_with_embedding(
        query_embedding=query_embedding,
        top_k=candidate_k,
    )

    results = _normalize_results(
        raw_results=raw_results,
        top_k=safe_top_k,
    )

    print("\nRETRIEVER RETURN SOURCES")
    print("-" * 40)

    for item in results:
        print({
            "source_id": item.get("source_id"),
            "chunk_id": item.get("chunk_id"),
            "title": item.get("title"),
            "llm_title": item.get("llm_title"),
            "url": item.get("url"),
            "chunk_index": item.get("chunk_index"),
            "score": item.get("score"),
            "summary_status": item.get("summary_status"),
        })

    return results


def search(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> list[dict]:
    return retrieve_relevant_chunks(
        question=question,
        top_k=top_k,
        page_url=page_url,
        page_title=page_title,
        scope=scope,
    )


def retrieve(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> list[dict]:
    return retrieve_relevant_chunks(
        question=question,
        top_k=top_k,
        page_url=page_url,
        page_title=page_title,
        scope=scope,
    )