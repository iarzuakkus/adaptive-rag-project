"""
Dosya: agents/note_agent.py

Görev:
- Seçili kaynaklardan ve kişisel notlardan LLM destekli not üretir.
- prompts/note_prompt.py üzerinden not promptunu oluşturur.
- services/llm_service.py üzerinden Gemini'yi çağırır.
- LLM cevabını JSON olarak ayrıştırır.
- Service katmanının normalize edebileceği dict yapısı döndürür.

Not:
- Bu dosya endpoint değildir.
- Endpoint: routes/notes.py
- Servis: services/note_service.py
- Prompt: prompts/note_prompt.py
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from services.llm_service import LLMService


NOTE_TYPE_LABELS = {
    "research_note": "Genel not",
    "lecture_note": "Ders notu",
    "summary_note": "Özet",
}

VALID_NOTE_TYPES = set(NOTE_TYPE_LABELS.keys())


def clean_text(
    value: Any,
    max_length: int | None = None,
) -> str:
    """
    Değeri güvenli bir metne dönüştürür.
    """

    text = str(value or "").strip()

    if max_length and len(text) > max_length:
        return text[:max_length].rstrip()

    return text


def safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value

    return []


def normalize_note_type(note_type: str | None) -> str:
    safe_note_type = clean_text(
        note_type,
        40,
    ).lower()

    if safe_note_type in VALID_NOTE_TYPES:
        return safe_note_type

    return "research_note"


def load_prompt_components():
    """
    note_prompt.py içindeki prompt bileşenlerini yükler.

    Prompt dosyası eksik veya hatalıysa exception üretir.
    Bu exception service katmanı tarafından yakalanır ve fallback
    not üretimi devreye girer.
    """

    try:
        from prompts.note_prompt import (
            SYSTEM_INSTRUCTION,
            build_note_prompt,
        )
    except Exception as error:
        raise RuntimeError(
            "prompts/note_prompt.py yüklenemedi. "
            "SYSTEM_INSTRUCTION ve build_note_prompt tanımlı olmalıdır."
        ) from error

    if not callable(build_note_prompt):
        raise RuntimeError(
            "prompts.note_prompt.build_note_prompt çağrılabilir değil."
        )

    return SYSTEM_INSTRUCTION, build_note_prompt


def extract_json_text(text: str) -> str:
    """
    LLM cevabı içindeki JSON bölümünü ayıklar.

    Desteklenen durumlar:
    - Doğrudan JSON object
    - ```json kod bloğu
    - JSON öncesi veya sonrası açıklama
    """

    value = clean_text(text)

    if not value:
        return ""

    fenced_match = re.search(
        r"```(?:json)?\s*(.*?)```",
        value,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if fenced_match:
        value = fenced_match.group(1).strip()

    if value.startswith("{") and value.endswith("}"):
        return value

    object_start = value.find("{")
    object_end = value.rfind("}")

    if (
        object_start != -1
        and object_end != -1
        and object_end > object_start
    ):
        return value[object_start:object_end + 1]

    return value


def clean_json_text(json_text: str) -> str:
    """
    Sık görülen küçük LLM JSON hatalarını düzeltir.
    """

    cleaned = str(json_text or "")

    cleaned = (
        cleaned
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\ufeff", "")
    )

    # Son elemandan sonra bırakılmış virgülleri kaldırır.
    cleaned = re.sub(
        r",\s*([}\]])",
        r"\1",
        cleaned,
    )

    return cleaned.strip()


def parse_json_response(text: str) -> dict[str, Any]:
    """
    LLM cevabını dict olarak ayrıştırır.
    """

    json_text = extract_json_text(text)

    if not json_text:
        return {}

    parse_attempts = [
        json_text,
        clean_json_text(json_text),
    ]

    for candidate in parse_attempts:
        try:
            parsed = json.loads(candidate)

            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
        except Exception:
            continue

    print(
        "[NOTE AGENT] JSON parse edilemedi. "
        f"Ham cevap: {clean_text(text, 1600)}"
    )

    return {}


def get_note_object(
    parsed_response: dict[str, Any],
) -> dict[str, Any]:
    """
    LLM response içindeki gerçek not objesini bulur.

    Kabul edilen yapılar:
    {
        "note": {...}
    }

    veya doğrudan:
    {
        "title": "...",
        "content": {...}
    }
    """

    if not isinstance(parsed_response, dict):
        return {}

    nested_note = parsed_response.get("note")

    if isinstance(nested_note, dict):
        return nested_note

    result = parsed_response.get("result")

    if isinstance(result, dict):
        nested_result_note = result.get("note")

        if isinstance(nested_result_note, dict):
            return nested_result_note

        if (
            result.get("title")
            or result.get("summary")
            or result.get("content")
        ):
            return result

    data = parsed_response.get("data")

    if isinstance(data, dict):
        nested_data_note = data.get("note")

        if isinstance(nested_data_note, dict):
            return nested_data_note

    if (
        parsed_response.get("title")
        or parsed_response.get("summary")
        or parsed_response.get("content")
        or parsed_response.get("sections")
    ):
        return parsed_response

    return {}


def normalize_string_list(value: Any) -> list[str]:
    """
    LLM'den gelen string listelerini temizler.
    """

    normalized_items = []

    for item in safe_list(value):
        if isinstance(item, str):
            text = clean_text(item)

            if text:
                normalized_items.append(text)

            continue

        if isinstance(item, dict):
            text = clean_text(
                item.get("text")
                or item.get("content")
                or item.get("value")
                or item.get("title")
            )

            if text:
                normalized_items.append(text)

    return normalized_items


def normalize_sections(value: Any) -> list[dict[str, Any]]:
    """
    Agent çıktısındaki ana konu bölümlerini temizler.

    Service katmanında tekrar normalizasyon yapılır ancak agent
    seviyesinde de hatalı alanları azaltmak için temel kontrol uygulanır.
    """

    sections = []

    for index, raw_section in enumerate(safe_list(value)):
        if not isinstance(raw_section, dict):
            continue

        heading = clean_text(
            raw_section.get("heading")
            or raw_section.get("title")
            or raw_section.get("name")
            or f"Başlık {index + 1}",
            180,
        )

        bullets = normalize_string_list(
            raw_section.get("bullets")
            or raw_section.get("items")
            or raw_section.get("points")
        )

        section_text = clean_text(
            raw_section.get("text")
            or raw_section.get("content")
        )

        if section_text and not bullets:
            bullets = [section_text]

        if not heading and not bullets:
            continue

        sections.append(
            {
                "heading": heading or f"Başlık {index + 1}",
                "bullets": bullets,
            }
        )

    return sections


def normalize_source_notes(value: Any) -> list[dict[str, Any]]:
    """
    Kaynaklarla ilişkili notları normalize eder.
    """

    source_notes = []

    for raw_note in safe_list(value):
        if not isinstance(raw_note, dict):
            continue

        source_title = clean_text(
            raw_note.get("source_title")
            or raw_note.get("sourceTitle")
            or raw_note.get("title")
            or "Kaynak",
            180,
        )

        note_text = clean_text(
            raw_note.get("note")
            or raw_note.get("text")
            or raw_note.get("summary"),
            1200,
        )

        if not note_text:
            continue

        source_notes.append(
            {
                "source_id": clean_text(
                    raw_note.get("source_id")
                    or raw_note.get("sourceId")
                    or raw_note.get("id")
                ),
                "source_title": source_title,
                "source_url": clean_text(
                    raw_note.get("source_url")
                    or raw_note.get("sourceUrl")
                    or raw_note.get("url"),
                    1000,
                ),
                "note": note_text,
            }
        )

    return source_notes


def normalize_personal_notes(value: Any) -> list[dict[str, Any]]:
    """
    LLM çıktısındaki kişisel notları normalize eder.
    """

    personal_notes = []

    for index, raw_note in enumerate(safe_list(value)):
        if not isinstance(raw_note, dict):
            continue

        text = clean_text(
            raw_note.get("text")
            or raw_note.get("note")
            or raw_note.get("content"),
            4000,
        )

        if not text:
            continue

        personal_notes.append(
            {
                "note_id": clean_text(
                    raw_note.get("note_id")
                    or raw_note.get("noteId")
                    or raw_note.get("id")
                ),
                "title": clean_text(
                    raw_note.get("title")
                    or f"Kişisel not {index + 1}",
                    180,
                ),
                "text": text,
            }
        )

    return personal_notes


def normalize_note_output(
    raw_note: dict[str, Any],
    note_type: str,
    custom_title: str = "",
) -> dict[str, Any]:
    """
    LLM tarafından döndürülen notu service katmanına uygun hâle getirir.

    Service katmanı kaynak ID, tarih, adet ve fallback alanlarını daha
    sonra tamamlar.
    """

    if not isinstance(raw_note, dict):
        return {}

    raw_content = raw_note.get("content")

    if not isinstance(raw_content, dict):
        raw_content = {}

    title = clean_text(
        custom_title
        or raw_note.get("title")
        or raw_note.get("note_title")
        or raw_note.get("noteTitle"),
        180,
    )

    summary = clean_text(
        raw_note.get("summary")
        or raw_note.get("short_summary")
        or raw_note.get("shortSummary")
        or raw_content.get("short_summary")
        or raw_content.get("shortSummary"),
        2400,
    )

    sections = normalize_sections(
        raw_content.get("sections")
        or raw_note.get("sections")
        or raw_note.get("topics")
    )

    insights = normalize_string_list(
        raw_content.get("insights")
        or raw_note.get("insights")
        or raw_note.get("important_insights")
        or raw_note.get("importantInsights")
    )

    source_notes = normalize_source_notes(
        raw_content.get("source_notes")
        or raw_content.get("sourceNotes")
        or raw_note.get("source_notes")
        or raw_note.get("sourceNotes")
    )

    personal_notes = normalize_personal_notes(
        raw_content.get("personal_notes")
        or raw_content.get("personalNotes")
        or raw_note.get("personal_notes")
        or raw_note.get("personalNotes")
    )

    conclusion = clean_text(
        raw_content.get("conclusion")
        or raw_note.get("conclusion"),
        2400,
    )

    manual_note = clean_text(
        raw_note.get("manual_note")
        or raw_note.get("manualNote"),
        8000,
    )

    has_meaningful_content = bool(
        title
        or summary
        or sections
        or insights
        or conclusion
    )

    if not has_meaningful_content:
        return {}

    return {
        "title": title,
        "summary": summary,
        "note_type": note_type,
        "note_type_label": clean_text(
            raw_note.get("note_type_label")
            or raw_note.get("noteTypeLabel")
            or NOTE_TYPE_LABELS[note_type],
            100,
        ),
        "content": {
            "short_summary": summary,
            "sections": sections,
            "insights": insights,
            "source_notes": source_notes,
            "personal_notes": personal_notes,
            "conclusion": conclusion,
        },
        "manual_note": manual_note,
        "is_manual": False,
    }


def get_generation_settings(
    note_type: str,
) -> dict[str, Any]:
    """
    Not tipine göre LLM üretim ayarlarını belirler.
    """

    if note_type == "summary_note":
        return {
            "temperature": 0.15,
            "max_output_tokens": 1800,
        }

    if note_type == "lecture_note":
        return {
            "temperature": 0.2,
            "max_output_tokens": 3000,
        }

    return {
        "temperature": 0.25,
        "max_output_tokens": 3200,
    }


async def call_llm(
    prompt: str,
    system_instruction: str,
    note_type: str,
) -> str:
    """
    LLMService üzerinden Gemini çağrısı yapar.

    LLMService.generate_text senkron çalıştığı için FastAPI event
    loop'unu bloklamaması amacıyla asyncio.to_thread kullanılır.
    """

    if not clean_text(prompt):
        raise ValueError("Not üretim promptu boş olamaz.")

    settings = get_generation_settings(note_type)

    service = LLMService()

    return await asyncio.to_thread(
        service.generate_text,
        prompt,
        system_instruction,
        settings["temperature"],
        settings["max_output_tokens"],
    )


async def generate_note_with_llm(
    context: str,
    note_type: str = "research_note",
    sources: list[dict[str, Any]] | None = None,
    personal_notes: list[dict[str, Any]] | None = None,
    custom_title: str = "",
    language: str = "tr",
) -> dict[str, Any]:
    """
    Kaynak ve kişisel not bağlamından yapılandırılmış not üretir.

    Dönüş:
    - Başarılıysa normalize edilmiş not dict'i
    - Hata veya geçersiz cevap durumunda boş dict

    Boş dict dönmesi durumunda note_service fallback not üretir.
    """

    safe_note_type = normalize_note_type(note_type)
    safe_sources = safe_list(sources)
    safe_personal_notes = safe_list(personal_notes)
    safe_custom_title = clean_text(custom_title, 180)
    safe_language = clean_text(language, 20) or "tr"
    safe_context = clean_text(context)

    if not safe_context:
        print(
            "[NOTE AGENT] Not üretimi için bağlam bulunamadı."
        )
        return {}

    try:
        (
            system_instruction,
            prompt_builder,
        ) = load_prompt_components()

        prompt = prompt_builder(
            context=safe_context,
            note_type=safe_note_type,
            sources=safe_sources,
            personal_notes=safe_personal_notes,
            custom_title=safe_custom_title,
            language=safe_language,
        )
    except Exception as error:
        print(
            "[NOTE AGENT] Prompt oluşturulamadı:",
            error,
        )
        return {}

    try:
        llm_response = await call_llm(
            prompt=prompt,
            system_instruction=system_instruction,
            note_type=safe_note_type,
        )
    except Exception as error:
        print(
            "[NOTE AGENT] LLM çağrısı başarısız:",
            error,
        )
        return {}

    parsed_response = parse_json_response(llm_response)
    raw_note = get_note_object(parsed_response)

    if not raw_note:
        print(
            "[NOTE AGENT] LLM geçerli not objesi döndürmedi."
        )
        return {}

    normalized_note = normalize_note_output(
        raw_note=raw_note,
        note_type=safe_note_type,
        custom_title=safe_custom_title,
    )

    if not normalized_note:
        print(
            "[NOTE AGENT] LLM not çıktısı normalize edilemedi."
        )
        return {}

    return normalized_note