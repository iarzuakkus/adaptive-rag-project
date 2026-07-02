"""
Dosya: services/note_service.py

Görev:
- Seçilen kaynaklardan ve kişisel notlardan yapılandırılmış not üretir.
- Route katmanından gelen verileri normalize eder.
- Not oluşturma bağlamını hazırlar.
- agents/note_agent.py içindeki LLM agentını çağırır.
- Agent veya LLM başarısız olursa fallback not üretir.
- Frontend notes-store yapısıyla uyumlu response döndürür.

Not:
- Bu dosya endpoint değildir.
- Endpoint backend/routes/notes.py içindedir.
- Gemini çağrısı doğrudan burada yapılmaz.
- LLM çağrısı agents/note_agent.py üzerinden gerçekleştirilir.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4
import inspect


NOTE_TYPE_LABELS = {
    "research_note": "Genel not",
    "lecture_note": "Ders notu",
    "summary_note": "Özet",
}

VALID_NOTE_TYPES = set(NOTE_TYPE_LABELS.keys())

MAX_SOURCES = 20
MAX_PERSONAL_NOTES = 20
MAX_SOURCE_CONTEXT_CHARS = 12_000
MAX_TOTAL_CONTEXT_CHARS = 32_000
MAX_PERSONAL_NOTE_CHARS = 4_000


def clean_text(value: Any, max_length: int | None = None) -> str:
    """
    Değeri güvenli ve temiz bir metne dönüştürür.
    """

    if value is None:
        return ""

    text = str(value).strip()

    if max_length and len(text) > max_length:
        return text[:max_length].rstrip()

    return text


def safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value

    return []


def create_note_id() -> str:
    return f"generated_note_{uuid4()}"


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalize_note_type(note_type: str | None) -> str:
    safe_note_type = clean_text(note_type, 40).lower()

    if safe_note_type in VALID_NOTE_TYPES:
        return safe_note_type

    return "research_note"


def normalize_chunk(raw_chunk: Any, index: int = 0) -> dict[str, Any] | None:
    """
    Kaynak chunk verisini standart yapıya dönüştürür.
    """

    if isinstance(raw_chunk, str):
        text = clean_text(raw_chunk)

        if not text:
            return None

        return {
            "chunk_id": f"chunk_{index + 1}",
            "text": text,
            "score": None,
            "metadata": {},
        }

    if not isinstance(raw_chunk, dict):
        return None

    text = clean_text(
        raw_chunk.get("text")
        or raw_chunk.get("content")
        or raw_chunk.get("chunk_text")
    )

    if not text:
        return None

    score = raw_chunk.get("score")

    try:
        normalized_score = float(score) if score is not None else None
    except (TypeError, ValueError):
        normalized_score = None

    metadata = raw_chunk.get("metadata")

    if not isinstance(metadata, dict):
        metadata = {}

    return {
        "chunk_id": clean_text(
            raw_chunk.get("chunk_id")
            or raw_chunk.get("id")
            or f"chunk_{index + 1}"
        ),
        "text": text,
        "score": normalized_score,
        "metadata": metadata,
    }


def normalize_summary_sections(raw_sections: Any) -> list[dict[str, Any]]:
    """
    Kaynak özet bölümlerini normalize eder.
    """

    sections = []

    for index, raw_section in enumerate(safe_list(raw_sections)):
        if not isinstance(raw_section, dict):
            continue

        heading = clean_text(
            raw_section.get("heading")
            or raw_section.get("title")
            or raw_section.get("name")
            or f"Bölüm {index + 1}"
        )

        raw_bullets = (
            raw_section.get("bullets")
            or raw_section.get("items")
            or raw_section.get("points")
            or []
        )

        bullets = [
            clean_text(item)
            for item in safe_list(raw_bullets)
            if clean_text(item)
        ]

        text = clean_text(
            raw_section.get("text")
            or raw_section.get("content")
            or raw_section.get("summary")
        )

        if not heading and not bullets and not text:
            continue

        sections.append(
            {
                "heading": heading,
                "bullets": bullets,
                "text": text,
            }
        )

    return sections


def normalize_source(
    raw_source: Any,
    index: int = 0,
) -> dict[str, Any] | None:
    """
    Not üretiminde kullanılacak kaynağı standart yapıya dönüştürür.
    """

    if not isinstance(raw_source, dict):
        return None

    source_id = clean_text(
        raw_source.get("source_id")
        or raw_source.get("sourceId")
        or raw_source.get("id")
        or raw_source.get("url")
        or f"source_{index + 1}"
    )

    title = clean_text(
        raw_source.get("title")
        or raw_source.get("page_title")
        or raw_source.get("pageTitle")
        or raw_source.get("name")
        or f"Kaynak {index + 1}"
    )

    url = clean_text(
        raw_source.get("url")
        or raw_source.get("page_url")
        or raw_source.get("pageUrl")
    )

    domain = clean_text(raw_source.get("domain"))

    summary = clean_text(raw_source.get("summary"))
    short_summary = clean_text(
        raw_source.get("short_summary")
        or raw_source.get("shortSummary")
    )
    long_summary = clean_text(
        raw_source.get("long_summary")
        or raw_source.get("longSummary")
    )

    summary_sections = normalize_summary_sections(
        raw_source.get("summary_sections")
        or raw_source.get("summarySections")
    )

    chunks = []

    for chunk_index, raw_chunk in enumerate(
        safe_list(
            raw_source.get("chunks")
            or raw_source.get("block_chunks")
            or raw_source.get("blockChunks")
        )
    ):
        normalized_chunk = normalize_chunk(
            raw_chunk,
            chunk_index,
        )

        if normalized_chunk:
            chunks.append(normalized_chunk)

    source_type = clean_text(
        raw_source.get("source_type")
        or raw_source.get("sourceType")
        or raw_source.get("type")
        or "web"
    )

    scanned_at = clean_text(
        raw_source.get("scanned_at")
        or raw_source.get("scannedAt")
        or raw_source.get("created_at")
        or raw_source.get("createdAt")
    )

    has_content = bool(
        summary
        or short_summary
        or long_summary
        or summary_sections
        or chunks
    )

    if not has_content:
        return None

    return {
        "source_id": source_id,
        "title": title,
        "url": url,
        "domain": domain,
        "summary": summary,
        "short_summary": short_summary,
        "long_summary": long_summary,
        "summary_sections": summary_sections,
        "chunks": chunks,
        "source_type": source_type,
        "scanned_at": scanned_at,
    }


def normalize_sources(
    sources: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """
    Kaynak listesini normalize eder ve tekrarları kaldırır.
    """

    normalized_sources = []
    seen = set()

    for index, raw_source in enumerate(safe_list(sources)[:MAX_SOURCES]):
        source = normalize_source(raw_source, index)

        if not source:
            continue

        unique_key = (
            source.get("source_id")
            or source.get("url")
            or source.get("title")
        )

        normalized_key = clean_text(unique_key).lower()

        if normalized_key in seen:
            continue

        seen.add(normalized_key)
        normalized_sources.append(source)

    return normalized_sources


def normalize_personal_note(
    raw_note: Any,
    index: int = 0,
) -> dict[str, Any] | None:
    """
    Kullanıcının kişisel notunu standart yapıya dönüştürür.
    """

    if not isinstance(raw_note, dict):
        return None

    text = clean_text(
        raw_note.get("text")
        or raw_note.get("note")
        or raw_note.get("body"),
        MAX_PERSONAL_NOTE_CHARS,
    )

    if not text:
        return None

    note_id = clean_text(
        raw_note.get("note_id")
        or raw_note.get("noteId")
        or raw_note.get("id")
        or f"personal_note_{index + 1}"
    )

    title = clean_text(
        raw_note.get("title")
        or f"Kişisel not {index + 1}",
        160,
    )

    created_at = clean_text(
        raw_note.get("created_at")
        or raw_note.get("createdAt")
    )

    return {
        "note_id": note_id,
        "title": title,
        "text": text,
        "created_at": created_at,
    }


def normalize_personal_notes(
    personal_notes: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """
    Kişisel not listesini normalize eder ve tekrarları kaldırır.
    """

    normalized_notes = []
    seen = set()

    for index, raw_note in enumerate(
        safe_list(personal_notes)[:MAX_PERSONAL_NOTES]
    ):
        note = normalize_personal_note(raw_note, index)

        if not note:
            continue

        unique_key = clean_text(
            note.get("note_id")
            or f"{note.get('title')}::{note.get('text')}"
        ).lower()

        if unique_key in seen:
            continue

        seen.add(unique_key)
        normalized_notes.append(note)

    return normalized_notes


def build_summary_sections_text(
    sections: list[dict[str, Any]],
) -> str:
    lines = []

    for section in sections:
        heading = clean_text(section.get("heading"))
        text = clean_text(section.get("text"))
        bullets = [
            clean_text(item)
            for item in safe_list(section.get("bullets"))
            if clean_text(item)
        ]

        if heading:
            lines.append(heading)

        if text:
            lines.append(text)

        for bullet in bullets:
            lines.append(f"- {bullet}")

    return "\n".join(lines).strip()


def build_source_content(source: dict[str, Any]) -> str:
    """
    Kaynağın agent tarafından kullanılacak metin bağlamını oluşturur.
    """

    content_parts = []

    long_summary = clean_text(source.get("long_summary"))
    summary = clean_text(source.get("summary"))
    short_summary = clean_text(source.get("short_summary"))

    if long_summary:
        content_parts.append(long_summary)
    elif summary:
        content_parts.append(summary)
    elif short_summary:
        content_parts.append(short_summary)

    section_text = build_summary_sections_text(
        safe_list(source.get("summary_sections"))
    )

    if section_text:
        content_parts.append(section_text)

    chunk_texts = []

    for chunk in safe_list(source.get("chunks")):
        if not isinstance(chunk, dict):
            continue

        chunk_text = clean_text(chunk.get("text"))

        if chunk_text:
            chunk_texts.append(chunk_text)

    if chunk_texts:
        content_parts.append("\n\n".join(chunk_texts))

    combined = "\n\n".join(
        part
        for part in content_parts
        if clean_text(part)
    )

    return clean_text(
        combined,
        MAX_SOURCE_CONTEXT_CHARS,
    )


def build_note_context(
    note_type: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
    language: str = "tr",
) -> str:
    """
    Agent için kaynak ve kişisel notlardan tek bir bağlam oluşturur.
    """

    lines = [
        f"NOT TİPİ: {NOTE_TYPE_LABELS.get(note_type, 'Genel not')}",
        f"DİL: {clean_text(language) or 'tr'}",
        "",
    ]

    if sources:
        lines.append("KAYNAKLAR")
        lines.append("")

        for index, source in enumerate(sources, start=1):
            source_content = build_source_content(source)

            lines.append(
                f"[KAYNAK {index}] {source.get('title') or 'Başlıksız kaynak'}"
            )

            if source.get("url"):
                lines.append(f"URL: {source['url']}")

            if source_content:
                lines.append(source_content)

            lines.append("")

    if personal_notes:
        lines.append("KİŞİSEL NOTLAR")
        lines.append("")

        for index, note in enumerate(personal_notes, start=1):
            lines.append(
                f"[KİŞİSEL NOT {index}] "
                f"{note.get('title') or 'Kişisel not'}"
            )
            lines.append(note.get("text") or "")
            lines.append("")

    context = "\n".join(lines).strip()

    return clean_text(
        context,
        MAX_TOTAL_CONTEXT_CHARS,
    )


async def call_note_agent(
    context: str,
    note_type: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
    custom_title: str = "",
    language: str = "tr",
) -> dict[str, Any]:
    """
    agents/note_agent.py içindeki not üretim fonksiyonunu çağırır.

    Agent henüz hazır değilse veya hata verirse boş dict döndürür.
    Service katmanı daha sonra fallback not üretir.
    """

    try:
        from agents.note_agent import generate_note_with_llm
    except Exception as error:
        print(
            "[NOTE SERVICE] note_agent import edilemedi:",
            error,
        )
        return {}

    try:
        signature = inspect.signature(generate_note_with_llm)

        possible_arguments = {
            "context": context,
            "note_type": note_type,
            "sources": sources,
            "personal_notes": personal_notes,
            "custom_title": custom_title,
            "language": language,
        }

        kwargs = {
            key: value
            for key, value in possible_arguments.items()
            if key in signature.parameters
        }

        result = generate_note_with_llm(**kwargs)

        if inspect.isawaitable(result):
            result = await result

        if not isinstance(result, dict):
            print(
                "[NOTE SERVICE] Agent dict dışında cevap döndürdü."
            )
            return {}

        if isinstance(result.get("note"), dict):
            return result["note"]

        return result

    except Exception as error:
        print(
            "[NOTE SERVICE] LLM not üretimi başarısız:",
            error,
        )
        return {}


def normalize_bullets(raw_bullets: Any) -> list[str]:
    bullets = []

    for bullet in safe_list(raw_bullets):
        text = clean_text(bullet)

        if text:
            bullets.append(text)

    return bullets


def normalize_sections(raw_sections: Any) -> list[dict[str, Any]]:
    """
    Agent tarafından üretilen ana konu bölümlerini normalize eder.
    """

    sections = []

    for index, raw_section in enumerate(safe_list(raw_sections)):
        if not isinstance(raw_section, dict):
            continue

        heading = clean_text(
            raw_section.get("heading")
            or raw_section.get("title")
            or f"Başlık {index + 1}"
        )

        bullets = normalize_bullets(
            raw_section.get("bullets")
            or raw_section.get("items")
            or raw_section.get("points")
        )

        text = clean_text(
            raw_section.get("text")
            or raw_section.get("content")
        )

        if text and not bullets:
            bullets = [text]

        if not heading and not bullets:
            continue

        sections.append(
            {
                "heading": heading or f"Başlık {index + 1}",
                "bullets": bullets,
            }
        )

    return sections


def build_default_title(
    note_type: str,
    custom_title: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
) -> str:
    custom_title = clean_text(custom_title, 180)

    if custom_title:
        return custom_title

    base_title = ""

    if sources:
        base_title = clean_text(sources[0].get("title"), 120)
    elif personal_notes:
        base_title = clean_text(
            personal_notes[0].get("title"),
            120,
        )

    if not base_title:
        base_title = "Araştırma"

    if note_type == "lecture_note":
        return f"{base_title} ders notu"

    if note_type == "summary_note":
        return f"{base_title} özeti"

    return f"{base_title} araştırma notu"


def build_fallback_summary(
    note_type: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
) -> str:
    input_titles = [
        clean_text(source.get("title"))
        for source in sources
        if clean_text(source.get("title"))
    ]

    input_titles.extend(
        clean_text(note.get("title"))
        for note in personal_notes
        if clean_text(note.get("title"))
    )

    readable_inputs = ", ".join(input_titles[:4])

    if not readable_inputs:
        readable_inputs = "Seçili içerikler"

    if note_type == "lecture_note":
        return (
            f"{readable_inputs} kullanılarak ders çalışmaya uygun, "
            "başlıklandırılmış ve maddelendirilmiş bir not hazırlandı."
        )

    if note_type == "summary_note":
        return (
            f"{readable_inputs} kullanılarak kısa ve hızlı okunabilir "
            "bir özet oluşturuldu."
        )

    return (
        f"{readable_inputs} kullanılarak kaynak ve kişisel notları "
        "birleştiren düzenli bir araştırma notu oluşturuldu."
    )


def build_fallback_sections(
    note_type: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    sections = []

    for source in sources:
        source_title = clean_text(
            source.get("title"),
            150,
        ) or "Kaynak"

        source_content = build_source_content(source)

        if not source_content:
            continue

        paragraphs = [
            clean_text(paragraph)
            for paragraph in source_content.split("\n")
            if clean_text(paragraph)
        ]

        bullets = paragraphs[:4]

        if bullets:
            sections.append(
                {
                    "heading": source_title,
                    "bullets": bullets,
                }
            )

    if personal_notes:
        sections.append(
            {
                "heading": "Kişisel notlardan öne çıkanlar",
                "bullets": [
                    clean_text(note.get("text"), 500)
                    for note in personal_notes[:5]
                    if clean_text(note.get("text"))
                ],
            }
        )

    if sections:
        return sections

    if note_type == "lecture_note":
        return [
            {
                "heading": "Temel kavramlar",
                "bullets": [
                    "Seçili içeriklerdeki temel bilgiler ders notu düzeninde bir araya getirildi."
                ],
            }
        ]

    if note_type == "summary_note":
        return [
            {
                "heading": "Kısa özet",
                "bullets": [
                    "Seçili içeriklerde öne çıkan temel noktalar özetlendi."
                ],
            }
        ]

    return [
        {
            "heading": "Araştırmanın genel çerçevesi",
            "bullets": [
                "Seçili kaynaklar ve kişisel notlar ortak konu çerçevesinde düzenlendi."
            ],
        }
    ]


def build_default_source_notes(
    sources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        {
            "source_id": source.get("source_id") or "",
            "source_title": source.get("title") or "Kaynak",
            "source_url": source.get("url") or "",
            "note": (
                f"{source.get('title') or 'Bu kaynak'}, "
                "oluşturulan notun temel girdilerinden biri olarak kullanıldı."
            ),
        }
        for source in sources
    ]


def build_default_personal_notes(
    personal_notes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        {
            "note_id": note.get("note_id") or "",
            "title": note.get("title") or "Kişisel not",
            "text": note.get("text") or "",
        }
        for note in personal_notes
    ]


def build_manual_note_text(
    personal_notes: list[dict[str, Any]],
) -> str:
    parts = []

    for index, note in enumerate(personal_notes, start=1):
        parts.append(
            f"{index}. {note.get('title') or 'Kişisel not'}\n"
            f"{note.get('text') or ''}"
        )

    return "\n\n".join(parts)


def build_fallback_note(
    note_type: str,
    custom_title: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
    session_id: str = "",
) -> dict[str, Any]:
    """
    LLM çalışmadığında kullanılacak güvenli not çıktısı.
    """

    summary = build_fallback_summary(
        note_type=note_type,
        sources=sources,
        personal_notes=personal_notes,
    )

    sections = build_fallback_sections(
        note_type=note_type,
        sources=sources,
        personal_notes=personal_notes,
    )

    insights = [
        "Notun kapsamı seçilen kaynaklar ve kişisel notlarla sınırlandırılmıştır.",
        "Kaynaklardan gelen bilgiler ile kullanıcının kendi notları aynı yapı altında birleştirilmiştir.",
    ]

    return {
        "id": create_note_id(),
        "session_id": clean_text(session_id),
        "title": build_default_title(
            note_type=note_type,
            custom_title=custom_title,
            sources=sources,
            personal_notes=personal_notes,
        ),
        "summary": summary,
        "note_type": note_type,
        "note_type_label": NOTE_TYPE_LABELS[note_type],
        "source_ids": [
            source.get("source_id") or ""
            for source in sources
        ],
        "personal_note_ids": [
            note.get("note_id") or ""
            for note in personal_notes
        ],
        "source_count": len(sources),
        "personal_note_count": len(personal_notes),
        "input_count": len(sources) + len(personal_notes),
        "section_count": len(sections),
        "created_at": now_iso(),
        "content": {
            "short_summary": summary,
            "sections": sections,
            "insights": insights,
            "source_notes": build_default_source_notes(sources),
            "personal_notes": build_default_personal_notes(
                personal_notes
            ),
            "conclusion": (
                "Seçili içerikler düzenlenerek tekrar kullanılabilir "
                "ve dışa aktarılabilir bir not yapısına dönüştürülmüştür."
            ),
        },
        "manual_note": build_manual_note_text(personal_notes),
        "is_manual": False,
    }


def normalize_generated_note(
    raw_note: dict[str, Any],
    note_type: str,
    custom_title: str,
    sources: list[dict[str, Any]],
    personal_notes: list[dict[str, Any]],
    session_id: str = "",
) -> dict[str, Any]:
    """
    Agent çıktısını frontend notes-store yapısına dönüştürür.
    """

    fallback_note = build_fallback_note(
        note_type=note_type,
        custom_title=custom_title,
        sources=sources,
        personal_notes=personal_notes,
        session_id=session_id,
    )

    content = raw_note.get("content")

    if not isinstance(content, dict):
        content = {}

    title = clean_text(
        custom_title
        or raw_note.get("title")
        or fallback_note["title"],
        180,
    )

    summary = clean_text(
        raw_note.get("summary")
        or raw_note.get("short_summary")
        or raw_note.get("shortSummary")
        or content.get("short_summary")
        or content.get("shortSummary")
        or fallback_note["summary"]
    )

    sections = normalize_sections(
        content.get("sections")
        or raw_note.get("sections")
    )

    if not sections:
        sections = fallback_note["content"]["sections"]

    insights = normalize_bullets(
        content.get("insights")
        or raw_note.get("insights")
        or raw_note.get("important_insights")
    )

    if not insights:
        insights = fallback_note["content"]["insights"]

    source_notes = (
        content.get("source_notes")
        or content.get("sourceNotes")
        or raw_note.get("source_notes")
        or raw_note.get("sourceNotes")
    )

    if not isinstance(source_notes, list) or not source_notes:
        source_notes = build_default_source_notes(sources)

    generated_personal_notes = (
        content.get("personal_notes")
        or content.get("personalNotes")
        or raw_note.get("personal_notes")
        or raw_note.get("personalNotes")
    )

    if (
        not isinstance(generated_personal_notes, list)
        or not generated_personal_notes
    ):
        generated_personal_notes = build_default_personal_notes(
            personal_notes
        )

    conclusion = clean_text(
        content.get("conclusion")
        or raw_note.get("conclusion")
        or fallback_note["content"]["conclusion"]
    )

    return {
        "id": clean_text(
            raw_note.get("id")
            or raw_note.get("note_id")
            or create_note_id()
        ),
        "session_id": clean_text(
            raw_note.get("session_id")
            or session_id
        ),
        "title": title,
        "summary": summary,
        "note_type": note_type,
        "note_type_label": clean_text(
            raw_note.get("note_type_label")
            or raw_note.get("noteTypeLabel")
            or NOTE_TYPE_LABELS[note_type]
        ),
        "source_ids": [
            source.get("source_id") or ""
            for source in sources
        ],
        "personal_note_ids": [
            note.get("note_id") or ""
            for note in personal_notes
        ],
        "source_count": len(sources),
        "personal_note_count": len(personal_notes),
        "input_count": len(sources) + len(personal_notes),
        "section_count": len(sections),
        "created_at": clean_text(
            raw_note.get("created_at")
            or raw_note.get("createdAt")
            or now_iso()
        ),
        "content": {
            "short_summary": summary,
            "sections": sections,
            "insights": insights,
            "source_notes": source_notes,
            "personal_notes": generated_personal_notes,
            "conclusion": conclusion,
        },
        "manual_note": clean_text(
            raw_note.get("manual_note")
            or raw_note.get("manualNote")
            or build_manual_note_text(personal_notes)
        ),
        "is_manual": False,
    }


def build_empty_response(
    note_type: str,
) -> dict[str, Any]:
    return {
        "success": False,
        "status": "empty",
        "message": (
            "Not oluşturmak için en az bir kaynak veya "
            "kişisel not gereklidir."
        ),
        "note_type": note_type,
        "note": None,
        "generated_at": now_iso(),
    }


def build_success_response(
    note: dict[str, Any],
    source: str,
    force: bool,
) -> dict[str, Any]:
    return {
        "success": True,
        "status": "ok",
        "source": source,
        "force": bool(force),
        "note": note,
        "source_count": note.get("source_count", 0),
        "personal_note_count": note.get(
            "personal_note_count",
            0,
        ),
        "input_count": note.get("input_count", 0),
        "generated_at": note.get("created_at") or now_iso(),
    }


async def generate_note_from_inputs(
    note_type: str,
    custom_title: str = "",
    language: str = "tr",
    sources: list[dict[str, Any]] | None = None,
    personal_notes: list[dict[str, Any]] | None = None,
    source_count: int = 0,
    personal_note_count: int = 0,
    session_id: str = "",
    force: bool = False,
    **extra_payload: Any,
) -> dict[str, Any]:
    """
    Kaynaklardan ve kişisel notlardan yapılandırılmış not üretir.

    Akış:
    1. Girdiler normalize edilir.
    2. Agent bağlamı oluşturulur.
    3. note_agent çağrılır.
    4. Agent başarısızsa fallback not oluşturulur.
    5. Frontend ile uyumlu response döndürülür.
    """

    safe_note_type = normalize_note_type(note_type)
    safe_custom_title = clean_text(custom_title, 180)
    safe_language = clean_text(language, 20) or "tr"

    normalized_sources = normalize_sources(sources)
    normalized_personal_notes = normalize_personal_notes(
        personal_notes
    )

    analyzed_source_count = (
        len(normalized_sources)
        or int(source_count or 0)
    )

    analyzed_personal_note_count = (
        len(normalized_personal_notes)
        or int(personal_note_count or 0)
    )

    if (
        not normalized_sources
        and not normalized_personal_notes
    ):
        return build_empty_response(safe_note_type)

    context = build_note_context(
        note_type=safe_note_type,
        sources=normalized_sources,
        personal_notes=normalized_personal_notes,
        language=safe_language,
    )

    agent_note = await call_note_agent(
        context=context,
        note_type=safe_note_type,
        sources=normalized_sources,
        personal_notes=normalized_personal_notes,
        custom_title=safe_custom_title,
        language=safe_language,
    )

    response_source = "llm"

    if agent_note:
        note = normalize_generated_note(
            raw_note=agent_note,
            note_type=safe_note_type,
            custom_title=safe_custom_title,
            sources=normalized_sources,
            personal_notes=normalized_personal_notes,
            session_id=session_id,
        )
    else:
        note = build_fallback_note(
            note_type=safe_note_type,
            custom_title=safe_custom_title,
            sources=normalized_sources,
            personal_notes=normalized_personal_notes,
            session_id=session_id,
        )

        response_source = "fallback"

    note["source_count"] = analyzed_source_count
    note["personal_note_count"] = analyzed_personal_note_count
    note["input_count"] = (
        analyzed_source_count
        + analyzed_personal_note_count
    )

    return build_success_response(
        note=note,
        source=response_source,
        force=force,
    )