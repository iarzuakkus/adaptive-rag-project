"""
Dosya: services/source_summary_service.py

Görev:
- Taranan bir kaynağın chunk içeriklerinden kullanıcıya gösterilecek kaynak metadata'sı üretir.
- Kaynak kartı için kısa özet hazırlar.
- Kaynak detay ekranı için başlıklı detay özeti hazırlar.
- Kaynak detay ekranı için geniş özet hazırlar.
- Kaynağın kullanıcıya daha anlamlı görünmesi için LLM destekli başlık üretir.
- LLM hata verirse sistemi bozmadan güvenli fallback üretir.

Bu dosya frontend tarafından doğrudan çağrılmaz.
ingest.py -> source_summary_service.py -> summarizer_agent.py -> llm_service.py akışıyla çalışır.
"""

from typing import Any

from agents.summarizer_agent import generate_source_summary_with_llm


def build_source_context(chunks: list[dict], max_chars: int = 6000) -> str:
    """
    Kaynak özetleme için chunk içeriklerinden tek bir bağlam metni oluşturur.

    Çok uzun sayfalarda LLM'e tüm metni göndermek yerine ilk anlamlı parçalar seçilir.
    Böylece hem token kullanımı azalır hem de ingest süresi kontrol altında kalır.
    """

    texts: list[str] = []
    total_length = 0

    for chunk in chunks:
        text = (
            chunk.get("content")
            or chunk.get("text")
            or chunk.get("chunk_text")
            or ""
        ).strip()

        if not text:
            continue

        remaining_chars = max_chars - total_length

        if remaining_chars <= 0:
            break

        selected_text = text[:remaining_chars]

        texts.append(selected_text)
        total_length += len(selected_text)

    return "\n\n".join(texts).strip()


def fallback_title(original_title: str, domain: str) -> str:
    """
    LLM çalışmazsa kullanılacak güvenli kaynak başlığı.
    """

    title = (original_title or "").strip()

    if title:
        return title[:120]

    if domain:
        return domain[:120]

    return "Başlıksız kaynak"


def fallback_summary(context: str) -> str:
    """
    LLM çalışmazsa kullanılacak basit kaynak özeti.
    """

    clean = " ".join((context or "").split())

    if not clean:
        return "Bu kaynak için özet oluşturulamadı."

    return clean[:420] + ("..." if len(clean) > 420 else "")


def clean_text(value: Any, max_length: int) -> str:
    """
    Metin alanlarını güvenli ve kısa hale getirir.
    """

    cleaned = " ".join(str(value or "").split())

    if len(cleaned) <= max_length:
        return cleaned

    return cleaned[:max_length].rstrip() + "..."


def split_sentences(text: str) -> list[str]:
    """
    Fallback başlıklı özet üretmek için basit cümle ayrıştırması yapar.
    """

    clean = " ".join((text or "").split())

    if not clean:
        return []

    separators = [". ", "? ", "! "]

    sentences = [clean]

    for separator in separators:
        next_sentences: list[str] = []

        for sentence in sentences:
            parts = sentence.split(separator)

            for index, part in enumerate(parts):
                value = part.strip()

                if not value:
                    continue

                if index < len(parts) - 1:
                    value = value + separator.strip()

                next_sentences.append(value)

        sentences = next_sentences

    return [sentence.strip() for sentence in sentences if len(sentence.strip()) > 20]


def fallback_summary_sections(context: str, safe_summary: str) -> list[dict[str, str]]:
    """
    LLM başlıklı özet döndürmezse kullanılacak güvenli detay özeti.

    Not:
    - Bu fallback LLM kadar iyi başlık üretmez.
    - Asıl hedef summarizer_agent.py içinde LLM'e summary_sections ürettirmektir.
    """

    clean_context = " ".join((context or "").split())
    base_text = clean_context or safe_summary

    if not base_text:
        return [
            {
                "title": "Genel özet",
                "content": "Bu kaynak için başlıklı özet oluşturulamadı.",
            }
        ]

    sentences = split_sentences(base_text)

    if len(sentences) < 3:
        return [
            {
                "title": "Genel özet",
                "content": clean_text(base_text, 520),
            }
        ]

    selected_sentences = sentences[:8]

    groups = [
        selected_sentences[0:2],
        selected_sentences[2:4],
        selected_sentences[4:6],
        selected_sentences[6:8],
    ]

    fallback_titles = [
        "Genel çerçeve",
        "Öne çıkan bilgiler",
        "Detaylar",
        "Sonuç ve çıkarım",
    ]

    sections: list[dict[str, str]] = []

    for index, group in enumerate(groups):
        content = " ".join(group).strip()

        if not content:
            continue

        sections.append({
            "title": fallback_titles[index],
            "content": clean_text(content, 520),
        })

    if not sections:
        sections.append({
            "title": "Genel özet",
            "content": clean_text(base_text, 520),
        })

    return sections[:4]


def normalize_summary_section(section: Any, index: int) -> dict[str, str] | None:
    """
    LLM'den gelen tek bir başlıklı özet bloğunu standart formata çevirir.

    Kabul edilen örnekler:
    - {"title": "...", "content": "..."}
    - {"heading": "...", "summary": "..."}
    - {"name": "...", "description": "..."}
    - "Düz metin"
    """

    if not section:
        return None

    if isinstance(section, str):
        content = clean_text(section, 520)

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

    title = clean_text(title, 80)
    content = clean_text(content, 520)

    if not content:
        return None

    return {
        "title": title or f"Başlık {index + 1}",
        "content": content,
    }


def extract_summary_sections_from_object(value: dict[str, Any]) -> list[Any]:
    """
    Dict olarak gelen başlıklı özet yapısını listeye çevirir.
    """

    if not isinstance(value, dict):
        return []

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


def normalize_summary_sections(
    metadata: dict[str, Any],
    context: str,
    safe_summary: str,
) -> list[dict[str, str]]:
    """
    LLM'den gelen başlıklı özet alanlarını normalize eder.

    Öncelik:
    1. summary_sections
    2. detail_sections
    3. structured_summary
    4. llm_summary_sections
    5. heading_summary
    6. summary_by_headings
    7. fallback_summary_sections
    """

    candidates = [
        metadata.get("summary_sections"),
        metadata.get("detail_sections"),
        metadata.get("structured_summary"),
        metadata.get("structuredSummary"),
        metadata.get("llm_summary_sections"),
        metadata.get("llmSummarySections"),
        metadata.get("heading_summary"),
        metadata.get("headingSummary"),
        metadata.get("summary_by_headings"),
        metadata.get("summaryByHeadings"),
    ]

    raw_sections: list[Any] = []

    for candidate in candidates:
        if not candidate:
            continue

        if isinstance(candidate, list):
            raw_sections = candidate
            break

        if isinstance(candidate, dict):
            extracted = extract_summary_sections_from_object(candidate)

            if extracted:
                raw_sections = extracted
                break

    normalized_sections: list[dict[str, str]] = []

    for index, section in enumerate(raw_sections):
        normalized_section = normalize_summary_section(section, index)

        if normalized_section:
            normalized_sections.append(normalized_section)

        if len(normalized_sections) >= 4:
            break

    if normalized_sections:
        return normalized_sections

    return fallback_summary_sections(context, safe_summary)


def normalize_metadata(
    metadata: dict[str, Any],
    safe_title: str,
    safe_summary: str,
    context: str,
) -> dict[str, Any]:
    """
    LLM'den gelen metadata alanlarını güvenli hale getirir.
    Eksik alan varsa fallback değerleriyle tamamlar.
    """

    llm_title = (
        metadata.get("llm_title")
        or metadata.get("title")
        or safe_title
    )

    short_summary = (
        metadata.get("short_summary")
        or metadata.get("summary")
        or safe_summary
    )

    long_summary = (
        metadata.get("long_summary")
        or metadata.get("detail_summary")
        or metadata.get("extended_summary")
        or short_summary
        or safe_summary
    )

    llm_title = clean_text(llm_title, 120)
    short_summary = clean_text(short_summary, 520)
    long_summary = clean_text(long_summary, 1200)

    summary_sections = normalize_summary_sections(
        metadata=metadata,
        context=context,
        safe_summary=safe_summary,
    )

    return {
        "llm_title": llm_title or safe_title,
        "short_summary": short_summary or safe_summary,
        "long_summary": long_summary or safe_summary,
        "summary": short_summary or safe_summary,
        "summary_sections": summary_sections,
        "detail_sections": summary_sections,
    }


def generate_source_metadata(
    *,
    original_title: str,
    url: str,
    domain: str,
    chunks: list[dict],
) -> dict[str, Any]:
    """
    Kaynak için kullanıcıya gösterilecek metadata üretir.

    Dönen alanlar:
    - llm_title: Kart ve detayda gösterilecek temiz başlık
    - short_summary: Kartta gösterilecek kısa özet
    - long_summary: Geriye dönük uyumluluk için geniş özet
    - summary_sections: Detay ekranında gösterilecek 3-4 başlıklı özet
    - detail_sections: summary_sections ile aynı alan, frontend uyumluluğu için
    - summary: Geriye dönük uyumluluk için kısa özetin karşılığı
    - summary_status: Özetin LLM ile mi fallback ile mi üretildiğini belirtir
    """

    context = build_source_context(chunks)

    safe_title = fallback_title(original_title, domain)
    safe_summary = fallback_summary(context)

    if not context:
        summary_sections = fallback_summary_sections(context, safe_summary)

        return {
            "llm_title": safe_title,
            "short_summary": safe_summary,
            "long_summary": safe_summary,
            "summary": safe_summary,
            "summary_sections": summary_sections,
            "detail_sections": summary_sections,
            "summary_status": "fallback_empty_context",
        }

    try:
        llm_metadata = generate_source_summary_with_llm(
            original_title=original_title,
            url=url,
            domain=domain,
            content=context,
        )

        normalized = normalize_metadata(
            metadata=llm_metadata,
            safe_title=safe_title,
            safe_summary=safe_summary,
            context=context,
        )

        return {
            **normalized,
            "summary_status": "llm_generated",
        }

    except Exception as error:
        print("[SOURCE SUMMARY] LLM özet üretimi başarısız. Fallback kullanılacak:", error)

        summary_sections = fallback_summary_sections(context, safe_summary)

        return {
            "llm_title": safe_title,
            "short_summary": safe_summary,
            "long_summary": safe_summary,
            "summary": safe_summary,
            "summary_sections": summary_sections,
            "detail_sections": summary_sections,
            "summary_status": "fallback_llm_error",
            "summary_error": str(error),
        }