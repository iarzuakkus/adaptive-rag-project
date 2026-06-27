"""
Dosya: services/source_summary_service.py

Görev:
- Taranan bir kaynağın chunk içeriklerinden kullanıcıya gösterilecek kaynak metadata'sı üretir.
- Kaynak kartı için kısa özet hazırlar.
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


def normalize_metadata(metadata: dict[str, Any], safe_title: str, safe_summary: str) -> dict[str, Any]:
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
        or short_summary
        or safe_summary
    )

    llm_title = " ".join(str(llm_title).split())[:120]
    short_summary = " ".join(str(short_summary).split())[:520]
    long_summary = " ".join(str(long_summary).split())[:1200]

    return {
        "llm_title": llm_title or safe_title,
        "short_summary": short_summary or safe_summary,
        "long_summary": long_summary or safe_summary,
        "summary": short_summary or safe_summary,
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
    - long_summary: Detay ekranında gösterilecek geniş özet
    - summary: Geriye dönük uyumluluk için kısa özetin karşılığı
    - summary_status: Özetin LLM ile mi fallback ile mi üretildiğini belirtir
    """

    context = build_source_context(chunks)

    safe_title = fallback_title(original_title, domain)
    safe_summary = fallback_summary(context)

    if not context:
        return {
            "llm_title": safe_title,
            "short_summary": safe_summary,
            "long_summary": safe_summary,
            "summary": safe_summary,
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
        )

        return {
            **normalized,
            "summary_status": "llm_generated",
        }

    except Exception as error:
        print("[SOURCE SUMMARY] LLM özet üretimi başarısız. Fallback kullanılacak:", error)

        return {
            "llm_title": safe_title,
            "short_summary": safe_summary,
            "long_summary": safe_summary,
            "summary": safe_summary,
            "summary_status": "fallback_llm_error",
            "summary_error": str(error),
        }