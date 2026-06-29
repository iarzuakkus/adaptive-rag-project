"""
Dosya: core/chat/payload_builder.py

Görev:
- Retriever'dan gelen ham chunk verilerini ortak formata çevirir.
- Chat cevabıyla frontend'e dönecek kaynak listesini hazırlar.
- Sayfa üzerinde highlight için kullanılacak chunk payload'unu üretir.
- Frontend aksiyonlarını hazırlar.
- LLM prompt'una gönderilecek sade chunk listesini üretir.
- LLM cevabıyla en çok örtüşen chunk'ı öne alır.

Not:
- Bu dosya sadece veri dönüştürme ve payload hazırlama işinden sorumludur.
- Retriever çağırmaz.
- LLM çağırmaz.
- Chat akışını yönetmez.
"""

from typing import Any, Optional


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
    Çünkü frontend sayfa üstünde highlight işlemi için bu alanlara ihtiyaç duyar.
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
            "answer_match_score": chunk.get("answer_match_score"),
            "is_primary_chunk": chunk.get("is_primary_chunk") is True,
            "rank": index,
        })

    return sources


def build_chunk_payload(chunks: list[dict], max_text_length: int = 1800) -> list[dict]:
    """
    Frontend'e dönecek sade chunk listesini hazırlar.

    Bu alan gerçek web sayfası üzerinde highlight yapmak için kullanılacak.

    Beklenen frontend kullanımı:
    - chunk.text sayfada aranır.
    - eşleşen DOM bloğu highlight edilir.
    """

    payload = []

    for index, chunk in enumerate(chunks, start=1):
        text = (
            chunk.get("text")
            or chunk.get("content")
            or chunk.get("chunk_text")
            or ""
        )

        cleaned_text = str(text).strip()

        if not cleaned_text:
            continue

        if len(cleaned_text) > max_text_length:
            cleaned_text = cleaned_text[:max_text_length].strip() + "..."

        payload.append({
            "chunk_id": chunk.get("chunk_id") or chunk.get("id") or f"chunk-{index}",
            "source_id": chunk.get("source_id"),
            "text": cleaned_text,
            "title": chunk.get("title") or "Başlıksız kaynak",
            "url": chunk.get("url") or "",
            "domain": chunk.get("domain") or "",
            "chunk_index": chunk.get("chunk_index", index - 1),
            "score": chunk.get("score"),
            "answer_match_score": chunk.get("answer_match_score"),
            "is_primary_chunk": chunk.get("is_primary_chunk") is True,
        })

    return payload


def build_action_payload(sources: list[dict], chunks: list[dict]) -> list[dict]:
    """
    Frontend'in ileride çalıştırabileceği aksiyonları üretir.

    Not:
    Sayfa üstünde highlight için asıl veri chunks alanıdır.
    Bu actions alanı yardımcıdır.
    """

    actions = []

    if chunks:
        primary_chunk = chunks[0]

        actions.append({
            "action_type": "highlight_page_chunks",
            "type": "highlight_page_chunks",
            "label": "Sayfada göster",
            "chunk_ids": [
                chunk.get("chunk_id")
                for chunk in chunks
                if chunk.get("chunk_id")
            ],
            "primary_chunk_id": primary_chunk.get("chunk_id"),
        })

    for source in sources:
        source_id = source.get("source_id")
        chunk_id = source.get("chunk_id")
        url = source.get("url")

        if source_id:
            actions.append({
                "action_type": "show_source",
                "type": "show_source",
                "source_id": source_id,
                "chunk_id": chunk_id,
                "url": url,
            })

    return actions


def build_prompt_chunks(chunks: list[dict], max_content_length: int = 1000) -> list[dict]:
    """
    LLM prompt'una gönderilecek sade chunk listesini üretir.

    Frontend için source_id, chunk_id, domain, metadata gibi alanları koruyoruz.
    Ancak LLM'e sade veri gönderiyoruz:

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


def _normalize_match_text(text: str) -> str:
    """
    Cevap/chunk eşleştirme için metni sadeleştirir.
    """

    return (
        str(text or "")
        .replace("\n", " ")
        .replace("\r", " ")
        .replace("\t", " ")
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
        .lower()
        .strip()
    )


def _extract_match_words(text: str) -> list[str]:
    """
    Cevap/chunk örtüşmesi için anlamlı kelimeleri çıkarır.
    """

    stop_words = {
        "ve",
        "veya",
        "ile",
        "için",
        "icin",
        "bir",
        "bu",
        "şu",
        "su",
        "da",
        "de",
        "ki",
        "mi",
        "ne",
        "olan",
        "olarak",
        "gibi",
        "daha",
        "çok",
        "cok",
        "ama",
        "fakat",
        "ancak",
        "ise",
        "the",
        "and",
        "for",
        "with",
        "this",
        "that",
        "from",
        "was",
        "were",
        "are",
        "is",
    }

    normalized = _normalize_match_text(text)

    raw_words = normalized.split(" ")
    cleaned_words = []

    for word in raw_words:
        cleaned = "".join(
            character
            for character in word
            if character.isalnum()
        )

        if len(cleaned) <= 3:
            continue

        if cleaned in stop_words:
            continue

        cleaned_words.append(cleaned)

    return cleaned_words


def _get_chunk_match_text(chunk: dict) -> str:
    """
    Chunk içinden eşleştirmede kullanılacak metni alır.
    """

    if not isinstance(chunk, dict):
        return ""

    return str(
        chunk.get("content")
        or chunk.get("text")
        or chunk.get("chunk_text")
        or ""
    )


def score_chunk_against_answer(chunk: dict, answer: str) -> float:
    """
    Bir chunk'ın LLM cevabıyla ne kadar örtüştüğünü hesaplar.

    Amaç:
    - Cevap hangi chunk'tan üretilmişse onu chunks[0] konumuna taşımak.
    - Frontend doğal dilde "kaynak göster" dediğinde doğru chunk'a gidebilsin.

    Not:
    Bu skor semantik embedding değildir.
    Hafif ve hızlı bir kelime/ifade örtüşme skorudur.
    """

    chunk_text = _get_chunk_match_text(chunk)
    normalized_chunk = _normalize_match_text(chunk_text)
    normalized_answer = _normalize_match_text(answer)

    if not normalized_chunk or not normalized_answer:
        return 0.0

    answer_words = list(dict.fromkeys(_extract_match_words(normalized_answer)))
    chunk_words = set(_extract_match_words(normalized_chunk))

    if not answer_words or not chunk_words:
        return 0.0

    matched_words = [
        word
        for word in answer_words
        if word in chunk_words or word in normalized_chunk
    ]

    word_score = len(matched_words) / max(len(answer_words), 1)

    phrase_score = 0.0

    if len(answer_words) >= 3:
        windows = []

        for index in range(0, max(len(answer_words) - 2, 0)):
            phrase = " ".join(answer_words[index:index + 3])

            if len(phrase.strip()) > 0:
                windows.append(phrase)

        if windows:
            matched_phrases = [
                phrase
                for phrase in windows
                if phrase in normalized_chunk
            ]

            phrase_score = len(matched_phrases) / max(len(windows), 1)

    retriever_score = _as_float(chunk.get("score")) or 0.0

    if retriever_score < 0:
        retriever_score = 0.0

    if retriever_score > 1:
        retriever_score = 1.0

    final_score = (
        word_score * 0.72
        + phrase_score * 0.18
        + retriever_score * 0.10
    )

    return round(final_score, 6)


def prioritize_chunks_by_answer(
    chunks: list[dict],
    answer: str,
) -> list[dict]:
    """
    LLM cevabıyla en çok örtüşen chunk'ı listenin başına alır.

    Böylece frontend:
    - source_navigation geldiğinde
    - window.AdaptiveRagLastChatChunks[0] üzerinden
    doğru kaynağa gitmeye çalışır.
    """

    if not isinstance(chunks, list) or not chunks:
        return []

    if not answer or not str(answer).strip():
        return chunks

    scored_chunks = []

    for original_index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            continue

        score = score_chunk_against_answer(chunk, answer)

        enriched_chunk = {
            **chunk,
            "answer_match_score": score,
            "is_primary_chunk": False,
            "original_rank": original_index + 1,
        }

        scored_chunks.append(enriched_chunk)

    if not scored_chunks:
        return chunks

    has_meaningful_score = any(
        (chunk.get("answer_match_score") or 0) > 0
        for chunk in scored_chunks
    )

    if not has_meaningful_score:
        return chunks

    scored_chunks.sort(
        key=lambda chunk: (
            chunk.get("answer_match_score") or 0,
            -(chunk.get("original_rank") or 9999),
        ),
        reverse=True,
    )

    prioritized_chunks = []

    for index, chunk in enumerate(scored_chunks):
        prioritized_chunks.append({
            **chunk,
            "is_primary_chunk": index == 0,
        })

    print("[CHAT PAYLOAD] Cevaba göre primary chunk seçildi:", {
        "primary_chunk_id": prioritized_chunks[0].get("chunk_id"),
        "answer_match_score": prioritized_chunks[0].get("answer_match_score"),
        "title": prioritized_chunks[0].get("title"),
        "original_rank": prioritized_chunks[0].get("original_rank"),
    })

    return prioritized_chunks