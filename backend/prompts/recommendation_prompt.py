"""
Dosya: prompts/recommendation_prompt.py

Görev:
- MemorAI öneri sistemi için LLM prompt'u üretir.
- Taranan kaynak bağlamına göre araştırma önerileri oluşturulmasını ister.
- LLM'den yalnızca geçerli JSON formatında cevap dönmesini bekler.

Not:
- Bu dosya LLM çağırmaz.
- Sadece prompt metni üretir.
- LLM çağrısı agents/research_agent.py içinde yapılır.
"""


from typing import Any


def clean_text(value: Any, max_length: int | None = None) -> str:
    text = str(value or "").strip()
    text = " ".join(text.split())

    if max_length and len(text) > max_length:
        return text[:max_length].strip() + "..."

    return text


def normalize_limit(limit: int | None) -> int:
    try:
        value = int(limit or 5)
    except Exception:
        value = 5

    return max(3, min(value, 5))


def build_source_overview(sources: list[dict[str, Any]]) -> str:
    if not sources:
        return "Kaynak özeti yok."

    lines = []

    for index, source in enumerate(sources[:8]):
        title = clean_text(source.get("title"), 140)
        domain = clean_text(source.get("domain"), 100)
        summary = clean_text(
            source.get("summary")
            or source.get("short_summary")
            or source.get("long_summary"),
            500,
        )

        section_titles = []

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

        if summary:
            parts.append(f"Özet: {summary}")

        if section_titles:
            parts.append("Başlıklı özet konuları: " + ", ".join(section_titles[:4]))

        lines.append("\n".join(parts))

    return "\n\n".join(lines)


def build_recommendation_prompt(
    context: str,
    sources: list[dict[str, Any]] | None = None,
    limit: int = 5,
) -> str:
    safe_limit = normalize_limit(limit)
    safe_context = clean_text(context, 9000)
    source_overview = build_source_overview(sources or [])

    return f"""
Sen MemorAI adlı kişisel araştırma asistanının araştırma öneri ajanısın.

Kullanıcının taradığı web kaynakları aşağıda verilmiştir. Görevin, bu kaynaklara göre araştırmayı genişletecek {safe_limit} adet öneri üretmektir.

Temel hedef:
Kullanıcının mevcut kaynaklardan sonra hangi yeni konuları, hangi arama sorgularını veya hangi kaynak türlerini araştırabileceğini önermek.

Kurallar:
- Sadece verilen kaynak bağlamına dayan.
- Kaynaklarda hiç geçmeyen alakasız konular önerme.
- Gerçek URL bilmiyorsan URL uydurma.
- Gerçek URL yoksa "url" alanını boş string olarak bırak.
- Her öneri birbirinden farklı olmalı.
- Öneriler kullanıcının araştırmasını derinleştirmeli.
- Öneriler kısa, anlaşılır ve uygulanabilir olmalı.
- Her öneride bir arama sorgusu üret.
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
- Kavram araştırması
- Karşılaştırmalı araştırma
- Örnek odaklı araştırma
- İleri okuma
- Soru üretimi
- Güncel kaynak araştırması
- Teknik detay araştırması
- Kaynak genişletme

Kaynak genel görünümü:
{source_overview}

Detaylı kaynak bağlamı:
{safe_context}
""".strip()