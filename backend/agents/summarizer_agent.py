"""
Dosya: agents/summarizer_agent.py

Görev:
- Kaynak içeriklerinden LLM destekli başlık ve özet üretir.
- LLMService üzerinden Gemini ile haberleşir.
- JSON çıktıyı güvenli şekilde parse eder.
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


def generate_source_summary_with_llm(
    *,
    original_title: str,
    url: str,
    domain: str,
    content: str,
) -> dict[str, str]:
    """
    Kaynak için LLM destekli başlık, kısa özet ve geniş özet üretir.
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
        max_output_tokens=900,
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
    }