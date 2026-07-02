"""
Dosya: core/chat/retriever_adapter.py

Görev:
- Chat akışı için retriever katmanını yönetir.
- backend/core/retriever.py içindeki uygun arama fonksiyonunu bulur.
- Mevcut retriever fonksiyonlarının farklı parametre yapılarına uyum sağlar.
- Retriever'dan dönen ham sonuçları normalize ederek ortak chunk formatına çevirir.
- Aktif sayfa filtresinden bağımsız olarak kişisel notları da aramaya dahil eder.

Not:
- Bu dosya LLM çağırmaz.
- Prompt oluşturmaz.
- Frontend payload hazırlamaz.
- Sadece kaynak/chunk getirme işinden sorumludur.
"""

from typing import Any, Callable, Optional

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
    func: Callable,
    question: str,
    top_k: int,
    page_url: Optional[str],
    page_title: Optional[str],
    scope: str,
):
    """
    Mevcut retriever fonksiyonunu güvenli şekilde çağırır.

    Proje geliştikçe retriever fonksiyonlarının imzası değişmiş
    olabilir. Bu nedenle farklı çağrı biçimleri sırayla denenir.
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
        lambda: func(
            question=question,
            top_k=top_k,
            page_url=page_url,
        ),
        lambda: func(
            question,
            top_k=top_k,
            page_url=page_url,
        ),
        lambda: func(
            query=question,
            top_k=top_k,
            page_url=page_url,
        ),
        lambda: func(
            question=question,
            top_k=top_k,
        ),
        lambda: func(
            question,
            top_k=top_k,
        ),
        lambda: func(
            query=question,
            top_k=top_k,
        ),
        lambda: func(question),
    ]

    last_error = None

    for call in call_patterns:
        try:
            return call()
        except TypeError as exc:
            last_error = exc

    raise RuntimeError(
        f"Retriever fonksiyonu çağrılamadı: {last_error}"
    )


def _extract_result_list(raw_results) -> list:
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


def _find_retriever_function(
    retriever_module,
) -> Callable:
    """
    core.retriever içindeki kullanılabilir arama fonksiyonunu bulur.
    """

    possible_function_names = [
        "retrieve_relevant_chunks",
        "retrieve_chunks",
        "semantic_search",
        "search_similar_chunks",
        "search_chunks",
        "search",
        "retrieve",
    ]

    for function_name in possible_function_names:
        func = getattr(
            retriever_module,
            function_name,
            None,
        )

        if callable(func):
            return func

    raise RuntimeError(
        "Uygun retriever fonksiyonu bulunamadı. "
        "backend/core/retriever.py içinde "
        "retrieve_relevant_chunks, search veya retrieve "
        "fonksiyonu olmalı."
    )


def _get_metadata(item: Any) -> dict:
    """
    Ham retriever sonucunun metadata alanını güvenli biçimde döndürür.
    """

    if not isinstance(item, dict):
        return {}

    metadata = item.get("metadata")

    if isinstance(metadata, dict):
        return metadata

    return {}


def _is_personal_note(item: Any) -> bool:
    """
    Ham retriever sonucunun kişisel not olup olmadığını belirler.
    """

    if not isinstance(item, dict):
        return False

    metadata = _get_metadata(item)

    document_type = str(
        item.get("document_type")
        or item.get("source_type")
        or metadata.get("document_type")
        or metadata.get("source_type")
        or ""
    ).strip().lower()

    source_type = str(
        item.get("source")
        or metadata.get("source")
        or ""
    ).strip().lower()

    source_id = str(
        item.get("source_id")
        or metadata.get("source_id")
        or ""
    ).strip().lower()

    return bool(
        document_type == "personal_note"
        or source_type == "personal_note"
        or source_id.startswith("personal_note_")
    )


def _get_raw_score(item: Any) -> float:
    """
    Retriever sonucundaki benzerlik skorunu normalize eder.
    """

    if not isinstance(item, dict):
        return 0.0

    raw_score = (
        item.get("score")
        or item.get("similarity")
        or item.get("similarity_score")
        or item.get("relevance_score")
        or 0.0
    )

    try:
        return float(raw_score)
    except (TypeError, ValueError):
        return 0.0


def _normalize_result(
    item: Any,
    index: int,
) -> dict:
    """
    Ham sonucu ortak chat chunk formatına çevirir.

    Kişisel not alanları normalize_chunk tarafından korunmasa bile
    burada tekrar eklenir.
    """

    normalized = normalize_chunk(
        item,
        index,
    )

    if not isinstance(normalized, dict):
        return {}

    if isinstance(item, dict):
        metadata = _get_metadata(item)

        normalized["score"] = _get_raw_score(item)

        if _is_personal_note(item):
            normalized["document_type"] = "personal_note"
            normalized["source_type"] = "personal_note"
            normalized["source"] = "personal_note"

            normalized["note_id"] = str(
                item.get("note_id")
                or metadata.get("note_id")
                or ""
            ).strip()

            normalized["source_id"] = str(
                item.get("source_id")
                or metadata.get("source_id")
                or normalized.get("source_id")
                or ""
            ).strip()

            normalized["title"] = str(
                item.get("title")
                or metadata.get("title")
                or normalized.get("title")
                or "Kişisel not"
            ).strip()

            normalized["url"] = ""

    return normalized


def _chunk_identity(chunk: dict) -> str:
    """
    Aynı chunk'ın iki aramadan birden gelmesi halinde tekrarları önler.
    """

    chunk_id = str(
        chunk.get("chunk_id")
        or ""
    ).strip()

    if chunk_id:
        return f"chunk:{chunk_id}"

    source_id = str(
        chunk.get("source_id")
        or ""
    ).strip()

    content = str(
        chunk.get("content")
        or chunk.get("text")
        or ""
    ).strip()

    return f"fallback:{source_id}:{content[:240]}"


def _merge_chunks(
    scoped_chunks: list[dict],
    personal_note_chunks: list[dict],
    top_k: int,
) -> list[dict]:
    """
    Normal kaynak sonuçları ile kişisel not sonuçlarını birleştirir.

    Aynı kayıt tekrar eklenmez ve sonuçlar semantic score değerine
    göre sıralanır.
    """

    merged = []
    seen = set()

    for chunk in [
        *scoped_chunks,
        *personal_note_chunks,
    ]:
        if not chunk:
            continue

        content = str(
            chunk.get("content")
            or chunk.get("text")
            or ""
        ).strip()

        if not content:
            continue

        identity = _chunk_identity(chunk)

        if identity in seen:
            continue

        seen.add(identity)
        merged.append(chunk)

    merged.sort(
        key=lambda chunk: float(
            chunk.get("score") or 0.0
        ),
        reverse=True,
    )

    return merged[:top_k]


def retrieve_relevant_chunks(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> list[dict]:
    """
    Chat sorusu için ilgili web kaynaklarını ve kişisel notları getirir.

    İki ayrı retrieval yapılır:

    1. Mevcut scope ve aktif sayfa bilgileriyle normal arama.
    2. Sayfa filtresi olmadan genel hafıza araması.

    İkinci aramadan yalnızca kişisel notlar alınır. Böylece kişisel
    notlar aktif sayfanın URL filtresinden etkilenmez.
    """

    if not str(question or "").strip():
        return []

    try:
        import core.retriever as retriever_module
    except Exception as exc:
        raise RuntimeError(
            f"core.retriever import edilemedi: {exc}"
        ) from exc

    normalized_scope = normalize_scope(scope)

    retriever_function = _find_retriever_function(
        retriever_module
    )

    scoped_raw_results = _call_retriever_function(
        func=retriever_function,
        question=question,
        top_k=top_k,
        page_url=page_url,
        page_title=page_title,
        scope=normalized_scope,
    )

    scoped_result_list = _extract_result_list(
        scoped_raw_results
    )

    personal_note_result_list = []

    try:
        global_top_k = max(
            top_k * 4,
            20,
        )

        global_raw_results = _call_retriever_function(
            func=retriever_function,
            question=question,
            top_k=global_top_k,
            page_url=None,
            page_title=None,
            scope="all",
        )

        global_result_list = _extract_result_list(
            global_raw_results
        )

        personal_note_result_list = [
            item
            for item in global_result_list
            if _is_personal_note(item)
        ]

    except Exception as exc:
        print(
            "[RETRIEVER ADAPTER] Kişisel not genel araması "
            "çalıştırılamadı:",
            exc,
        )

    scoped_chunks = [
        _normalize_result(item, index)
        for index, item in enumerate(
            scoped_result_list,
            start=1,
        )
    ]

    personal_note_chunks = [
        _normalize_result(item, index)
        for index, item in enumerate(
            personal_note_result_list,
            start=len(scoped_chunks) + 1,
        )
    ]

    return _merge_chunks(
        scoped_chunks=scoped_chunks,
        personal_note_chunks=personal_note_chunks,
        top_k=top_k,
    )