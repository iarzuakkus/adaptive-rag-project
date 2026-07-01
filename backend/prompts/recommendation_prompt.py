"""
Dosya: prompts/recommendation_prompt.py

Görev:
- MemorAI öneri sistemi için LLM prompt'u üretir.
- Taranan kaynak bağlamına göre araştırma önerileri oluşturulmasını ister.
- Refresh ve expand modlarını ayırır.
- Expand modunda mevcut önerileri tekrar etmemesi için LLM'e exclude bilgisi verir.
- LLM'den yalnızca geçerli JSON formatında cevap dönmesini bekler.

Not:
- Bu dosya LLM çağırmaz.
- Sadece prompt metni üretir.
- LLM çağrısı agents/research_agent.py içinde yapılır.
"""

from __future__ import annotations

from typing import Any


def clean_text(value: Any, max_length: int | None = None) -> str:
    text = str(value or "").strip()
    text = " ".join(text.split())

    if max_length and len(text) > max_length:
        return text[:max_length].strip() + "..."

    return text


def safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value

    return []


def normalize_limit(limit: int | None) -> int:
    try:
        value = int(limit or 5)
    except Exception:
        value = 5

    return max(3, min(value, 5))


def normalize_generation_mode(
    mode: str | None = None,
    generation_mode: str | None = None,
) -> str:
    raw_mode = clean_text(generation_mode or mode or "refresh", 40).lower()

    if raw_mode == "expand":
        return "expand"

    return "refresh"


def get_source_url(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("url")
        or source.get("source_url")
        or source.get("page_url")
        or "",
        500,
    )


def build_source_overview(sources: list[dict[str, Any]]) -> str:
    if not sources:
        return "Kaynak özeti yok."

    lines: list[str] = []

    for index, source in enumerate(sources[:8]):
        if not isinstance(source, dict):
            continue

        title = clean_text(source.get("title"), 140)
        domain = clean_text(source.get("domain"), 100)
        url = get_source_url(source)

        summary = clean_text(
            source.get("summary")
            or source.get("short_summary")
            or source.get("long_summary"),
            500,
        )

        section_titles: list[str] = []

        for section in source.get("summary_sections") or []:
            if not isinstance(section, dict):
                continue

            section_title = clean_text(section.get("title"), 80)

            if section_title:
                section_titles.append(section_title)

        parts = [
            f"{index + 1}. Kaynak başlığı: {title or 'Başlıksız kaynak'}"
        ]

        if domain:
            parts.append(f"Domain: {domain}")

        if url:
            parts.append(f"Taranmış URL: {url}")

        if summary:
            parts.append(f"Özet: {summary}")

        if section_titles:
            parts.append("Başlıklı özet konuları: " + ", ".join(section_titles[:4]))

        lines.append("\n".join(parts))

    return "\n\n".join(lines) if lines else "Kaynak özeti yok."


def build_existing_urls_text(sources: list[dict[str, Any]]) -> str:
    urls: list[str] = []

    for source in sources:
        if not isinstance(source, dict):
            continue

        url = get_source_url(source)

        if url:
            urls.append(url)

    if not urls:
        return "Taranmış URL listesi yok."

    return "\n".join(f"- {url}" for url in urls[:20])


def build_exclude_text(exclude_payload: dict[str, list[str]] | None = None) -> str:
    excludes = exclude_payload or {}

    exclude_titles = safe_list(excludes.get("exclude_titles"))[:12]
    exclude_queries = safe_list(excludes.get("exclude_queries"))[:12]
    exclude_domains = safe_list(excludes.get("exclude_domains"))[:12]
    exclude_urls = safe_list(excludes.get("exclude_urls"))[:12]

    parts: list[str] = []

    if exclude_titles:
        parts.append("Tekrar edilmemesi gereken mevcut öneri başlıkları:")
        parts.extend(
            f"- {clean_text(title, 220)}"
            for title in exclude_titles
            if clean_text(title)
        )

    if exclude_queries:
        parts.append("Tekrar edilmemesi gereken mevcut arama sorguları:")
        parts.extend(
            f"- {clean_text(query, 220)}"
            for query in exclude_queries
            if clean_text(query)
        )

    if exclude_domains:
        parts.append("Mümkünse tekrar edilmemesi gereken mevcut domainler:")
        parts.extend(
            f"- {clean_text(domain, 180)}"
            for domain in exclude_domains
            if clean_text(domain)
        )

    if exclude_urls:
        parts.append("Tekrar önerilmemesi gereken URL'ler:")
        parts.extend(
            f"- {clean_text(url, 320)}"
            for url in exclude_urls
            if clean_text(url)
        )

    if not parts:
        return "Mevcut öneri dışlama listesi yok."

    return "\n".join(parts)


def build_mode_instruction(mode: str) -> str:
    if mode == "expand":
        return """
Bu istek ÖNERİ OLUŞTUR modundadır.

Bu modda temel amaç:
- Mevcut önerileri yenilemek değil, onlardan farklı yeni araştırma yönleri üretmek.
- Kullanıcıya farklı siteler, farklı kaynak türleri ve farklı arama sorguları önermek.
- Aynı önerileri küçük kelime değişiklikleriyle tekrar üretmemek.
- Daha önce önerilmiş başlık, query, URL ve domain bilgilerini mümkün olduğunca tekrar etmemek.
- Araştırmayı genişleten alternatif, eleştirel, teknik, güncel veya vaka odaklı kaynak yönleri önermek.
""".strip()

    return """
Bu istek YENİLE modundadır.

Bu modda temel amaç:
- Mevcut kaynak bağlamına göre önerileri güncellemek.
- Kullanıcının taradığı kaynaklarla en alakalı yeni araştırma adımlarını üretmek.
- Kaynak bağlamı değiştiyse öneri listesini yeni bağlama göre tazelemek.
""".strip()


def build_type_options(mode: str) -> str:
    base_types = [
        "Kavram araştırması",
        "Karşılaştırmalı araştırma",
        "Örnek odaklı araştırma",
        "İleri okuma",
        "Soru üretimi",
        "Güncel kaynak araştırması",
        "Teknik detay araştırması",
        "Kaynak genişletme",
    ]

    expand_types = [
        "Alternatif kaynak",
        "Eleştirel araştırma",
        "Vaka araştırması",
        "Akademik araştırma",
        "Farklı bakış açısı",
    ]

    if mode == "expand":
        type_options = base_types + expand_types
    else:
        type_options = base_types

    return "\n".join(f"- {item}" for item in type_options)


def build_recommendation_prompt(
    context: str,
    sources: list[dict[str, Any]] | None = None,
    limit: int = 5,
    mode: str = "refresh",
    generation_mode: str | None = None,
    exclude_payload: dict[str, list[str]] | None = None,
) -> str:
    safe_limit = normalize_limit(limit)
    safe_sources = sources or []
    safe_context = clean_text(context, 9000)
    safe_mode = normalize_generation_mode(mode=mode, generation_mode=generation_mode)

    source_overview = build_source_overview(safe_sources)
    existing_urls_text = build_existing_urls_text(safe_sources)
    exclude_text = build_exclude_text(exclude_payload)
    mode_instruction = build_mode_instruction(safe_mode)
    type_options = build_type_options(safe_mode)

    return f"""
Sen MemorAI adlı kişisel araştırma asistanının araştırma öneri ajanısın.

Kullanıcının taradığı web kaynakları aşağıda verilmiştir. Görevin, bu kaynaklara göre araştırmayı geliştirecek {safe_limit} adet öneri üretmektir.

Mod:
{mode_instruction}

Temel hedef:
Kullanıcının mevcut kaynaklardan sonra hangi yeni konuları, hangi arama sorgularını veya hangi kaynak türlerini araştırabileceğini önermek.

Çok önemli tekrar önleme kuralları:
- Kullanıcının daha önce taradığı kaynakları tekrar önerme.
- Aşağıdaki "Taranmış URL listesi" içinde bulunan URL'leri öneri olarak döndürme.
- Aynı sayfanın farklı görünen URL hallerini de önerme.
- www farkı, sondaki slash farkı, utm parametreleri veya aynı path'e sahip URL'ler aynı kaynak sayılır.
- Mevcut kaynağın başlığını birebir arama sorgusu olarak verme.
- Öneriler, mevcut kaynakların aynısı değil; bu kaynakları genişleten yeni araştırma yönleri olmalı.
- Bir kaynak Wikipedia ise, aynı Wikipedia sayfasını tekrar önerme. Bunun yerine akademik, teknik, açıklayıcı, karşılaştırmalı veya farklı bakış açısı sunan kaynak türleri öner.

Expand modu için ek tekrar önleme kuralları:
- Eğer mod "expand" ise mevcut öneri başlıklarını tekrar etme.
- Eğer mod "expand" ise mevcut öneri arama sorgularını tekrar etme.
- Eğer mod "expand" ise aynı öneriyi eş anlamlı kelimelerle tekrar üretme.
- Eğer mod "expand" ise mümkün olduğunca farklı kaynak türleri, farklı domainler ve farklı araştırma açıları öner.
- Eğer mod "expand" ise öneriler araştırmayı yatay veya derinlemesine genişletmeli.

Genel kurallar:
- Sadece verilen kaynak bağlamına dayan.
- Kaynaklarda hiç geçmeyen alakasız konular önerme.
- Gerçek URL bilmiyorsan URL uydurma.
- Gerçek URL yoksa "url" alanını boş string olarak bırak.
- Her öneri birbirinden farklı olmalı.
- Öneriler kullanıcının araştırmasını derinleştirmeli veya genişletmeli.
- Öneriler kısa, anlaşılır ve uygulanabilir olmalı.
- Her öneride bir arama sorgusu üret.
- Arama sorgusu, mevcut sayfayı tekrar bulmaya değil, araştırmayı genişletmeye yönelik olmalı.
- Cevabı yalnızca geçerli JSON olarak döndür.
- Markdown kullanma.
- JSON dışında açıklama yazma.

Dönüş formatı kesinlikle şu yapıda olmalı:

{{
  "recommendations": [
    {{
      "title": "Araştırma önerisi başlığı",
      "summary": "Bu öneride ne araştırılacağını açıklayan 1-2 cümlelik kısa metin.",
      "reason": "Bu önerinin mevcut kaynaklarla neden ilişkili olduğunu açıklayan kısa gerekçe.",
      "query": "Bu öneri için kullanılabilecek arama sorgusu",
      "url": "",
      "domain": "Araştırma önerisi",
      "type": "Kavram araştırması"
    }}
  ]
}}

"type" alanı şu seçeneklerden biri olabilir:
{type_options}

Taranmış URL listesi:
{existing_urls_text}

Mevcut öneri dışlama listesi:
{exclude_text}

Kaynak genel görünümü:
{source_overview}

Detaylı kaynak bağlamı:
{safe_context}
""".strip()