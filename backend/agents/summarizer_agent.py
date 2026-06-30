"""
Dosya: agents/summarizer_agent.py

Görev:
- Kaynak içeriklerinden LLM destekli başlık ve özet üretir.
- LLMService üzerinden Gemini ile haberleşir.
- JSON çıktıyı güvenli şekilde parse eder.
- Kaynak detay ekranı için 3-4 başlıklı özet alanını normalize eder.
- LLM hata verirse servis katmanının fallback kullanabilmesi için hatayı yukarı taşır.
"""

import json
import re
from typing import Any

from services.llm_service import LLMService
from prompts.summary_prompt import (
    SOURCE_SUMMARY_SYSTEM_INSTRUCTION,
    build_source_summary_prompt,
)


def _extract_json_object(text: str) -> dict[str, Any]:
    """
    LLM bazen JSON etrafına açıklama veya markdown ekleyebilir.
    Bu fonksiyon ilk JSON objesini güvenli şekilde ayıklamaya çalışır.
    """

    if not text:
        raise ValueError("LLM boş cevap döndürdü.")

    clean_text = text.strip()

    if clean_text.startswith("```"):
        clean_text = re.sub(r"^```json\s*", "", clean_text)
        clean_text = re.sub(r"^```\s*", "", clean_text)
        clean_text = re.sub(r"\s*```$", "", clean_text)

    try:
        parsed = json.loads(clean_text)

        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", clean_text)

    if not match:
        raise ValueError("LLM cevabında JSON obje bulunamadı.")

    parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("LLM JSON cevabı obje formatında değil.")

    return parsed


def _clean_text(value: Any, max_length: int) -> str:
    text = str(value or "").strip()
    text = " ".join(text.split())

    if len(text) <= max_length:
        return text

    return text[:max_length].rstrip() + "..."


def _normalize_summary_section(section: Any, index: int) -> dict[str, str] | None:
    """
    LLM'den gelen tek bir başlıklı özet bloğunu güvenli hale getirir.

    Beklenen format:
    {
      "title": "...",
      "content": "..."
    }
    """

    if not section:
        return None

    if isinstance(section, str):
        content = _clean_text(section, 520)

        if not content:
            return None

        return {
            "title": f"Başlık {index + 1}",
            "content": content,
        }

    if not isinstance(section, dict):
        return None

    title = (
        section.get("title")
        or section.get("heading")
        or section.get("header")
        or section.get("name")
        or section.get("label")
        or f"Başlık {index + 1}"
    )

    content = (
        section.get("content")
        or section.get("text")
        or section.get("summary")
        or section.get("description")
        or section.get("body")
        or ""
    )

    title = _clean_text(title, 80)
    content = _clean_text(content, 520)

    if not content:
        return None

    return {
        "title": title or f"Başlık {index + 1}",
        "content": content,
    }


def _extract_sections_from_object(value: dict[str, Any]) -> list[Any]:
    """
    LLM başlıklı özeti dict içinde farklı isimlerle döndürürse listeye çevirir.
    """

    possible_list_keys = [
        "summary_sections",
        "detail_sections",
        "sections",
        "headings",
        "items",
    ]

    for key in possible_list_keys:
        if isinstance(value.get(key), list):
            return value.get(key) or []

    sections: list[dict[str, Any]] = []

    for title, content in value.items():
        if isinstance(content, str):
            sections.append({
                "title": title,
                "content": content,
            })

        elif isinstance(content, dict):
            sections.append({
                "title": content.get("title") or content.get("heading") or title,
                "content": (
                    content.get("content")
                    or content.get("text")
                    or content.get("summary")
                    or content.get("description")
                    or ""
                ),
            })

    return sections


def _normalize_summary_sections(parsed: dict[str, Any]) -> list[dict[str, str]]:
    """
    LLM JSON çıktısından 3-4 başlıklı özet alanını çıkarır.

    Öncelik:
    - summary_sections
    - detail_sections
    - sections
    - structured_summary
    - heading_summary
    - summary_by_headings
    """

    candidates = [
        parsed.get("summary_sections"),
        parsed.get("detail_sections"),
        parsed.get("sections"),
        parsed.get("structured_summary"),
        parsed.get("structuredSummary"),
        parsed.get("llm_summary_sections"),
        parsed.get("llmSummarySections"),
        parsed.get("heading_summary"),
        parsed.get("headingSummary"),
        parsed.get("summary_by_headings"),
        parsed.get("summaryByHeadings"),
    ]

    raw_sections: list[Any] = []

    for candidate in candidates:
        if not candidate:
            continue

        if isinstance(candidate, list):
            raw_sections = candidate
            break

        if isinstance(candidate, dict):
            extracted = _extract_sections_from_object(candidate)

            if extracted:
                raw_sections = extracted
                break

    normalized_sections: list[dict[str, str]] = []

    for index, section in enumerate(raw_sections):
        normalized_section = _normalize_summary_section(section, index)

        if normalized_section:
            normalized_sections.append(normalized_section)

        if len(normalized_sections) >= 4:
            break

    return normalized_sections


def generate_source_summary_with_llm(
    *,
    original_title: str,
    url: str,
    domain: str,
    content: str,
) -> dict[str, Any]:
    """
    Kaynak için LLM destekli başlık, kısa özet, geniş özet ve başlıklı detay özeti üretir.
    """

    if not content or not content.strip():
        raise ValueError("Özet üretmek için kaynak içeriği boş olamaz.")

    prompt = build_source_summary_prompt(
        original_title=original_title,
        url=url,
        domain=domain,
        content=content,
    )

    llm = LLMService()

    response_text = llm.generate_text(
        prompt=prompt,
        system_instruction=SOURCE_SUMMARY_SYSTEM_INSTRUCTION,
        temperature=0.2,
        max_output_tokens=1300,
    )

    parsed = _extract_json_object(response_text)

    llm_title = _clean_text(
        parsed.get("llm_title") or parsed.get("title") or original_title,
        120,
    )

    short_summary = _clean_text(
        parsed.get("short_summary") or parsed.get("summary"),
        520,
    )

    long_summary = _clean_text(
        parsed.get("long_summary") or parsed.get("detail_summary") or short_summary,
        1200,
    )

    summary_sections = _normalize_summary_sections(parsed)

    if not llm_title:
        llm_title = original_title or domain or "Başlıksız kaynak"

    if not short_summary:
        short_summary = "Bu kaynak için kısa özet oluşturulamadı."

    if not long_summary:
        long_summary = short_summary

    return {
        "llm_title": llm_title,
        "short_summary": short_summary,
        "long_summary": long_summary,
        "summary": short_summary,
        "summary_sections": summary_sections,
        "detail_sections": summary_sections,
    }