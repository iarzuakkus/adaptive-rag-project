"""
Dosya: services/research/source_context.py

Görev:
- Frontend veya route üzerinden gelen kaynak listesini normalize eder.
- Kaynak başlığı, URL, domain, özet ve başlıklı özet alanlarını standartlaştırır.
- LLM/research agent için kısa ama anlamlı araştırma context'i oluşturur.

Not:
- Bu dosya LLM çağırmaz.
- Bu dosya web search çağırmaz.
- Sadece kaynakları analiz için hazırlar.
"""

from __future__ import annotations

from typing import Any

from services.research.url_filters import clean_text, safe_list


MAX_CONTEXT_CHARS = 9000
MAX_SOURCE_TEXT_CHARS = 1800


def get_source_title(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("llm_title")
        or source.get("title")
        or source.get("original_title")
        or source.get("source_title")
        or "Başlıksız kaynak",
        180,
    )


def get_source_url(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("url")
        or source.get("source_url")
        or source.get("page_url")
        or "",
        500,
    )


def get_source_domain(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("domain")
        or source.get("site")
        or source.get("hostname")
        or "",
        120,
    )


def get_source_summary(source: dict[str, Any]) -> str:
    summary = (
        source.get("summary")
        or source.get("short_summary")
        or source.get("long_summary")
        or ""
    )

    return clean_text(summary, 900)


def get_source_long_summary(source: dict[str, Any]) -> str:
    long_summary = (
        source.get("long_summary")
        or source.get("detail_summary")
        or source.get("summary")
        or source.get("short_summary")
        or ""
    )

    return clean_text(long_summary, 1200)


def normalize_summary_sections(source: dict[str, Any]) -> list[dict[str, str]]:
    raw_sections = (
        source.get("summary_sections")
        or source.get("detail_sections")
        or source.get("structured_summary")
        or []
    )

    if isinstance(raw_sections, dict):
        if isinstance(raw_sections.get("summary_sections"), list):
            raw_sections = raw_sections.get("summary_sections")
        elif isinstance(raw_sections.get("sections"), list):
            raw_sections = raw_sections.get("sections")
        else:
            raw_sections = [
                {
                    "title": title,
                    "content": content,
                }
                for title, content in raw_sections.items()
            ]

    if not isinstance(raw_sections, list):
        return []

    sections: list[dict[str, str]] = []

    for index, section in enumerate(raw_sections):
        if isinstance(section, str):
            title = f"Başlık {index + 1}"
            content = section
        elif isinstance(section, dict):
            title = (
                section.get("title")
                or section.get("heading")
                or section.get("header")
                or f"Başlık {index + 1}"
            )
            content = (
                section.get("content")
                or section.get("text")
                or section.get("summary")
                or section.get("description")
                or ""
            )
        else:
            continue

        clean_title = clean_text(title, 120)
        clean_content = clean_text(content, 700)

        if clean_content:
            sections.append(
                {
                    "title": clean_title or f"Başlık {index + 1}",
                    "content": clean_content,
                }
            )

    return sections[:4]


def normalize_source(source: dict[str, Any]) -> dict[str, Any]:
    summary_sections = normalize_summary_sections(source)

    return {
        "source_id": clean_text(source.get("source_id") or source.get("sourceId") or ""),
        "title": get_source_title(source),
        "url": get_source_url(source),
        "domain": get_source_domain(source),
        "summary": get_source_summary(source),
        "long_summary": get_source_long_summary(source),
        "summary_sections": summary_sections,
        "scanned_at": clean_text(source.get("scanned_at") or source.get("scannedAt") or ""),
    }


def source_has_content(source: dict[str, Any]) -> bool:
    return bool(
        source.get("title")
        or source.get("summary")
        or source.get("long_summary")
        or source.get("summary_sections")
    )


def normalize_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_sources: list[dict[str, Any]] = []

    for source in safe_list(sources):
        if not isinstance(source, dict):
            continue

        normalized = normalize_source(source)

        if source_has_content(normalized):
            normalized_sources.append(normalized)

    return normalized_sources


def build_sections_text(sections: list[dict[str, str]]) -> str:
    parts: list[str] = []

    for section in safe_list(sections):
        if not isinstance(section, dict):
            continue

        title = clean_text(section.get("title"), 100)
        content = clean_text(section.get("content"), 450)

        if not content:
            continue

        if title:
            parts.append(f"- {title}: {content}")
        else:
            parts.append(f"- {content}")

    return "\n".join(parts)


def build_source_text(source: dict[str, Any], index: int) -> str:
    title = clean_text(source.get("title"), 180)
    domain = clean_text(source.get("domain"), 120)
    url = clean_text(source.get("url"), 500)
    summary = clean_text(source.get("summary"), 700)
    long_summary = clean_text(source.get("long_summary"), 900)
    sections_text = build_sections_text(source.get("summary_sections") or [])

    parts = [
        f"Kaynak {index + 1}",
        f"Başlık: {title}",
    ]

    if domain:
        parts.append(f"Domain: {domain}")

    if url:
        parts.append(f"URL: {url}")

    if summary:
        parts.append(f"Kısa özet: {summary}")

    if long_summary and long_summary != summary:
        parts.append(f"Detay özet: {long_summary}")

    if sections_text:
        parts.append(f"Başlıklı özetler:\n{sections_text}")

    return clean_text("\n".join(parts), MAX_SOURCE_TEXT_CHARS)


def build_research_context(sources: list[dict[str, Any]]) -> str:
    context_parts: list[str] = []

    for index, source in enumerate(safe_list(sources)):
        if not isinstance(source, dict):
            continue

        source_text = build_source_text(source, index)

        if source_text:
            context_parts.append(source_text)

    context = "\n\n---\n\n".join(context_parts)

    return clean_text(context, MAX_CONTEXT_CHARS)


def extract_keywords_from_sources(
    sources: list[dict[str, Any]],
    limit: int = 8,
) -> list[str]:
    """
    Fallback öneri üretimi için kaynaklardan basit anahtar kelime çıkarır.

    Not:
    - Daha gelişmiş NLP yapılmaz.
    - Amaç LLM çalışmadığında mock yerine mevcut içerikten anlamlı query üretmektir.
    """

    import re

    text_parts: list[str] = []

    for source in safe_list(sources):
        if not isinstance(source, dict):
            continue

        text_parts.append(source.get("title") or "")
        text_parts.append(source.get("summary") or "")

        for section in source.get("summary_sections") or []:
            if not isinstance(section, dict):
                continue

            text_parts.append(section.get("title") or "")
            text_parts.append(section.get("content") or "")

    text = clean_text(" ".join(text_parts)).lower()

    words = re.findall(r"[a-zA-ZğüşöçıİĞÜŞÖÇ0-9]{4,}", text)

    stopwords = {
        "olan",
        "olarak",
        "için",
        "daha",
        "veya",
        "gibi",
        "sonra",
        "önemli",
        "kaynak",
        "bilgi",
        "sayfa",
        "konu",
        "özet",
        "başlık",
        "the",
        "and",
        "with",
        "from",
        "that",
        "this",
        "data",
        "page",
        "source",
    }

    frequency: dict[str, int] = {}

    for word in words:
        if word in stopwords:
            continue

        frequency[word] = frequency.get(word, 0) + 1

    sorted_words = sorted(
        frequency.items(),
        key=lambda item: item[1],
        reverse=True,
    )

    return [word for word, _count in sorted_words[:limit]]