"""
Dosya: services/research/fallback_recommendations.py

Görev:
- LLM öneri üretimi başarısız olduğunda mevcut kaynaklardan fallback öneriler üretir.
- Mock veri üretmez.
- Kaynak başlığı, özetleri ve anahtar kelimeleri kullanarak araştırma yönleri çıkarır.

Not:
- Bu dosya LLM çağırmaz.
- Bu dosya web search çağırmaz.
- Sadece mevcut kaynak içeriğinden öneri iskeleti üretir.
"""

from __future__ import annotations

from typing import Any
import uuid

from services.research.source_context import extract_keywords_from_sources
from services.research.url_filters import clean_text, safe_list


def make_recommendation_id(prefix: str = "rec") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def get_first_source_title(sources: list[dict[str, Any]]) -> str:
    for source in safe_list(sources):
        if not isinstance(source, dict):
            continue

        title = clean_text(source.get("title"), 120)

        if title:
            return title

    return "mevcut konu"


def build_keyword_text(keywords: list[str], fallback: str) -> str:
    if keywords:
        return ", ".join(keywords[:4])

    return fallback


def build_search_query_base(keywords: list[str], fallback: str) -> str:
    if keywords:
        return " ".join(keywords[:5])

    return fallback


def build_fallback_templates(
    first_title: str,
    keyword_text: str,
    search_query_base: str,
) -> list[dict[str, str]]:
    return [
        {
            "title": f"{first_title} için temel kavramları derinleştir",
            "summary": (
                "Mevcut kaynaklarda geçen ana kavramları daha sistemli anlamak için "
                "konunun temel tanımlarını, alt başlıklarını ve ilişkili kavramlarını araştır."
            ),
            "reason": (
                f"Taranan kaynaklarda {keyword_text} gibi tekrar eden kavramlar öne çıkıyor. "
                "Bu kavramlar araştırmanın ana eksenini güçlendirebilir."
            ),
            "query": f"{search_query_base} temel kavramlar açıklama",
            "type": "Kavram araştırması",
        },
        {
            "title": f"{first_title} hakkında güncel kaynakları karşılaştır",
            "summary": (
                "Konuyu yalnızca tek bir kaynağa bağlı kalmadan farklı kaynaklardaki anlatımlar, "
                "örnekler ve açıklamalar üzerinden karşılaştır."
            ),
            "reason": (
                "Mevcut kaynaklar araştırma başlangıcı için yeterli görünüyor; ancak farklı "
                "kaynaklarla desteklenirse cevapların güvenilirliği artar."
            ),
            "query": f"{search_query_base} karşılaştırmalı kaynaklar",
            "type": "Karşılaştırmalı araştırma",
        },
        {
            "title": f"{first_title} için örnekler ve uygulamalar bul",
            "summary": (
                "Kaynaklarda geçen bilgilerin pratik örnekler, kullanım alanları veya gerçek "
                "dünya karşılıklarıyla desteklenmesi araştırmayı daha anlaşılır hale getirir."
            ),
            "reason": (
                "Taranan içerik açıklayıcı bilgiler içeriyor; örnek ve uygulama odaklı kaynaklar "
                "konuyu daha somut hale getirebilir."
            ),
            "query": f"{search_query_base} örnekler uygulamalar",
            "type": "Örnek odaklı araştırma",
        },
        {
            "title": f"{first_title} konusunda sık sorulan soruları çıkar",
            "summary": (
                "Kullanıcının daha sonra sorabileceği alt soruları belirlemek için konuyla ilgili "
                "sık sorulan sorular, problem başlıkları ve açıklayıcı içerikler incelenebilir."
            ),
            "reason": (
                "Bu öneri, mevcut kaynaklardan sonra chat tarafında daha güçlü takip soruları "
                "üretmek için kullanılabilir."
            ),
            "query": f"{search_query_base} sık sorulan sorular",
            "type": "Soru üretimi",
        },
        {
            "title": f"{first_title} için ileri okuma listesi oluştur",
            "summary": (
                "Araştırmayı büyütmek için akademik, teknik veya detaylı açıklama içeren ileri "
                "seviye kaynaklar bulunabilir."
            ),
            "reason": (
                "Mevcut kaynaklar temel bağlamı kuruyor; ileri okuma kaynakları bilgi hafızasını "
                "daha değerli hale getirebilir."
            ),
            "query": f"{search_query_base} detaylı rehber ileri okuma",
            "type": "İleri okuma",
        },
    ]


def build_fallback_recommendations(
    sources: list[dict[str, Any]],
    limit: int,
    mode: str = "refresh",
    exclude_payload: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """
    LLM çalışmazsa mevcut kaynakların içeriğinden araştırma önerileri çıkarır.

    mode:
    - refresh: mevcut bağlama göre standart öneriler üretir.
    - expand: araştırmayı genişletecek daha alternatif öneriler üretir.

    Not:
    - exclude_payload burada doğrudan filtrelenmez.
    - Nihai filtreleme recommendation_normalizer veya web_enrichment sonrasında yapılır.
    - Parametre burada gelecekte genişletme için tutulur.
    """

    safe_limit = max(1, int(limit or 5))
    safe_mode = "expand" if mode == "expand" else "refresh"

    keywords = extract_keywords_from_sources(sources)
    first_title = get_first_source_title(sources)

    keyword_text = build_keyword_text(keywords, first_title)
    search_query_base = build_search_query_base(keywords, first_title)

    if safe_mode == "expand":
        templates = build_expand_fallback_templates(
            first_title=first_title,
            keyword_text=keyword_text,
            search_query_base=search_query_base,
        )
    else:
        templates = build_fallback_templates(
            first_title=first_title,
            keyword_text=keyword_text,
            search_query_base=search_query_base,
        )

    recommendations: list[dict[str, Any]] = []

    for item in templates[:safe_limit]:
        recommendations.append(
            {
                "id": make_recommendation_id("fallback_rec"),
                "title": item["title"],
                "summary": item["summary"],
                "reason": item["reason"],
                "url": "",
                "domain": "Araştırma önerisi",
                "query": item["query"],
                "type": item["type"],
            }
        )

    return recommendations


def build_expand_fallback_templates(
    first_title: str,
    keyword_text: str,
    search_query_base: str,
) -> list[dict[str, str]]:
    """
    Öneri oluştur butonu için daha farklı/alternatif araştırma yönleri üretir.
    Bu şablonlar mevcut önerileri yenilemekten çok araştırmayı genişletmeye odaklanır.
    """

    return [
        {
            "title": f"{first_title} için farklı bakış açıları bul",
            "summary": (
                "Mevcut kaynakların anlattığı konuyu farklı uzmanlık alanları, farklı yorumlar "
                "ve alternatif açıklamalar üzerinden genişlet."
            ),
            "reason": (
                f"Mevcut bağlamda {keyword_text} öne çıkıyor. Farklı kaynak türleriyle konu "
                "tek bir anlatım çizgisine sıkışmadan genişletilebilir."
            ),
            "query": f"{search_query_base} farklı bakış açıları alternatif açıklamalar",
            "type": "Alternatif kaynak",
        },
        {
            "title": f"{first_title} için akademik veya teknik kaynaklar ara",
            "summary": (
                "Konunun daha güvenilir ve detaylı taraflarını görmek için akademik, teknik "
                "veya uzman kaynaklara dayanan içerikler incelenebilir."
            ),
            "reason": (
                "Mevcut öneriler genel kaynaklara yakın kalabilir. Bu öneri, araştırmayı daha "
                "derin ve kaynak değeri yüksek içeriklere taşır."
            ),
            "query": f"{search_query_base} akademik teknik kaynak araştırma",
            "type": "Derin araştırma",
        },
        {
            "title": f"{first_title} için karşıt görüş ve eleştirileri incele",
            "summary": (
                "Konuyu daha dengeli anlamak için yalnızca destekleyici kaynaklar değil, "
                "eleştirel yaklaşımlar ve karşılaştırmalı değerlendirmeler de araştırılabilir."
            ),
            "reason": (
                "Araştırma hafızasının güçlü olması için aynı bilgiyi tekrar eden kaynaklar yerine "
                "konuya yeni açı kazandıran içerikler eklemek daha faydalıdır."
            ),
            "query": f"{search_query_base} eleştiri karşıt görüş değerlendirme",
            "type": "Eleştirel araştırma",
        },
        {
            "title": f"{first_title} için örnek olaylar ve vaka çalışmaları bul",
            "summary": (
                "Konunun gerçek dünyadaki karşılıklarını görmek için örnek olaylar, vaka analizleri "
                "ve uygulama odaklı kaynaklar incelenebilir."
            ),
            "reason": (
                "Mevcut kaynaklar kavramsal bilgi veriyorsa, vaka çalışmaları konuyu daha somut "
                "ve kullanılabilir hale getirir."
            ),
            "query": f"{search_query_base} örnek olay vaka çalışması uygulama",
            "type": "Vaka araştırması",
        },
        {
            "title": f"{first_title} için güncel gelişmeleri takip et",
            "summary": (
                "Konuyla ilgili yeni yayınlar, güncel tartışmalar, raporlar veya son gelişmeler "
                "araştırılarak bilgi hafızası güncel tutulabilir."
            ),
            "reason": (
                "Öneri oluştur butonu araştırmayı genişletmek için kullanıldığı için, mevcut "
                "önerilerden farklı olarak güncel ve yeni kaynaklara yönelmek değerlidir."
            ),
            "query": f"{search_query_base} güncel gelişmeler yeni kaynaklar",
            "type": "Güncel araştırma",
        },
    ]