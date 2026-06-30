"""
Dosya: services/research_service.py

Görev:
- Taranan kaynaklardan araştırma önerileri üretir.
- Kaynak başlığı, özet, uzun özet ve başlıklı özet alanlarını analiz için hazırlar.
- LLM agent katmanını çağırır.
- LLM başarısız olursa mock veri üretmeden, mevcut kaynak içeriğinden fallback öneriler oluşturur.
- Üretilen önerilerin query alanlarıyla web search çalıştırır.
- Web search sonucu bulunan gerçek URL'leri öneri kartlarına bağlar.

Not:
- Bu servis endpoint katmanı değildir.
- Endpoint backend/routes/research.py içindedir.
- LLM çağrısı agents/research_agent.py üzerinden yapılır.
- Web search çağrısı services/web_search_service.py üzerinden yapılır.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
import re
import uuid


MAX_CONTEXT_CHARS = 9000
MAX_SOURCE_TEXT_CHARS = 1800
DEFAULT_LIMIT = 5
MIN_LIMIT = 3
MAX_LIMIT = 5
WEB_RESULTS_PER_RECOMMENDATION = 5


def clean_text(value: Any, max_length: int | None = None) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)

    if max_length and len(text) > max_length:
        return text[:max_length].strip() + "..."

    return text


def safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value

    return []


def normalize_limit(limit: int | None) -> int:
    try:
        value = int(limit or DEFAULT_LIMIT)
    except Exception:
        value = DEFAULT_LIMIT

    return max(MIN_LIMIT, min(value, MAX_LIMIT))


def make_recommendation_id(prefix: str = "rec") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


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
    normalized_sources = []

    for source in sources:
        if not isinstance(source, dict):
            continue

        normalized = normalize_source(source)

        if source_has_content(normalized):
            normalized_sources.append(normalized)

    return normalized_sources


def build_sections_text(sections: list[dict[str, str]]) -> str:
    parts = []

    for section in sections:
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
    context_parts = []

    for index, source in enumerate(sources):
        source_text = build_source_text(source, index)

        if source_text:
            context_parts.append(source_text)

    context = "\n\n---\n\n".join(context_parts)

    return clean_text(context, MAX_CONTEXT_CHARS)


def extract_keywords_from_sources(sources: list[dict[str, Any]], limit: int = 8) -> list[str]:
    text_parts = []

    for source in sources:
        text_parts.append(source.get("title") or "")
        text_parts.append(source.get("summary") or "")

        for section in source.get("summary_sections") or []:
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


def build_fallback_recommendations(
    sources: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """
    LLM çalışmazsa mock üretmek yerine mevcut kaynakların içeriğinden
    araştırma yönleri çıkarır.
    """

    keywords = extract_keywords_from_sources(sources)
    first_source = sources[0] if sources else {}
    first_title = clean_text(first_source.get("title") or "mevcut konu", 120)

    keyword_text = ", ".join(keywords[:4]) if keywords else first_title
    search_query_base = " ".join(keywords[:5]) if keywords else first_title

    templates = [
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

    recommendations = []

    for item in templates[:limit]:
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


def normalize_recommendation(item: dict[str, Any], index: int) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    title = clean_text(
        item.get("title")
        or item.get("heading")
        or item.get("query_title")
        or item.get("search_title")
        or "",
        180,
    )

    summary = clean_text(
        item.get("summary")
        or item.get("description")
        or item.get("snippet")
        or item.get("content")
        or "",
        500,
    )

    reason = clean_text(
        item.get("reason")
        or item.get("why")
        or item.get("why_recommended")
        or item.get("recommendation_reason")
        or "",
        500,
    )

    query = clean_text(
        item.get("query")
        or item.get("search_query")
        or item.get("searchQuery")
        or item.get("keyword")
        or "",
        240,
    )

    url = clean_text(
        item.get("url")
        or item.get("source_url")
        or item.get("page_url")
        or item.get("target_url")
        or "",
        500,
    )

    domain = clean_text(
        item.get("domain")
        or item.get("site")
        or item.get("hostname")
        or "",
        140,
    )

    recommendation_type = clean_text(
        item.get("type")
        or item.get("category")
        or item.get("label")
        or "Öneri",
        80,
    )

    if not title and not summary and not query and not url:
        return None

    return {
        "id": clean_text(item.get("id") or item.get("recommendation_id") or "") or make_recommendation_id(),
        "title": title or f"Araştırma önerisi {index + 1}",
        "summary": summary or "Bu öneri için açıklama oluşturulamadı.",
        "reason": reason or "Bu öneri mevcut kaynak bağlamına göre üretildi.",
        "url": url,
        "domain": domain or "Araştırma önerisi",
        "query": query,
        "type": recommendation_type,
    }


def normalize_recommendations(
    recommendations: Any,
    limit: int,
) -> list[dict[str, Any]]:
    if isinstance(recommendations, dict):
        for key in ["recommendations", "items", "results", "sources", "recommended_sources"]:
            if isinstance(recommendations.get(key), list):
                recommendations = recommendations.get(key)
                break

    if not isinstance(recommendations, list):
        return []

    normalized = []

    for index, item in enumerate(recommendations):
        normalized_item = normalize_recommendation(item, index)

        if normalized_item:
            normalized.append(normalized_item)

        if len(normalized) >= limit:
            break

    return normalized


async def call_research_agent(
    context: str,
    sources: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """
    research_agent.py henüz hazır değilse veya LLM hata verirse boş liste döner.
    Service fallback önerileri kendisi üretir.
    """

    try:
        from agents.research_agent import generate_recommendations_with_llm
    except Exception as error:
        print("[RESEARCH SERVICE] research_agent import edilemedi:", error)
        return []

    try:
        result = await generate_recommendations_with_llm(
            context=context,
            sources=sources,
            limit=limit,
        )

        return normalize_recommendations(result, limit)
    except Exception as error:
        print("[RESEARCH SERVICE] LLM öneri üretimi başarısız:", error)
        return []


async def search_web_for_recommendation(
    recommendation: dict[str, Any],
) -> dict[str, Any]:
    """
    Tek bir önerinin query alanı için web search yapar.
    İlk sonucu önerinin ana URL'si olarak bağlar.
    """

    query = clean_text(recommendation.get("query"), 260)

    if not query:
        return recommendation

    try:
        from services.web_search_service import web_search
    except Exception as error:
        print("[RESEARCH SERVICE] web_search_service import edilemedi:", error)
        return recommendation

    try:
        search_result = await web_search(
            query=query,
            max_results=WEB_RESULTS_PER_RECOMMENDATION,
            provider="auto",
        )
    except Exception as error:
        print("[RESEARCH SERVICE] Web search hatası:", error)
        return recommendation

    results = search_result.get("results") or []

    if not results:
        recommendation["web_search_status"] = search_result.get("status") or "no_results"
        recommendation["web_search_provider"] = search_result.get("provider") or ""
        recommendation["related_results"] = []
        return recommendation

    primary_result = results[0]

    recommendation["url"] = primary_result.get("url") or recommendation.get("url") or ""
    recommendation["domain"] = primary_result.get("domain") or recommendation.get("domain") or "Araştırma önerisi"
    recommendation["web_result_title"] = primary_result.get("title") or ""
    recommendation["web_result_snippet"] = primary_result.get("snippet") or primary_result.get("summary") or ""
    recommendation["web_search_status"] = "ok"
    recommendation["web_search_provider"] = search_result.get("provider") or primary_result.get("provider") or ""
    recommendation["related_results"] = results[1:WEB_RESULTS_PER_RECOMMENDATION]

    return recommendation


async def enrich_recommendations_with_web_search(
    recommendations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Öneri listesindeki query alanlarını kullanarak gerçek web kaynaklarını bulur.
    """

    enriched_recommendations = []

    for recommendation in recommendations:
        enriched = await search_web_for_recommendation(recommendation)
        enriched_recommendations.append(enriched)

    return enriched_recommendations


async def generate_recommendations_from_sources(
    sources: list[dict[str, Any]],
    source_count: int = 0,
    force: bool = False,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """
    Kaynak listesine göre araştırma önerileri üretir.
    """

    safe_limit = normalize_limit(limit)
    normalized_sources = normalize_sources(sources)

    analyzed_source_count = len(normalized_sources) or int(source_count or 0)

    if not normalized_sources:
        return {
            "success": True,
            "status": "empty",
            "message": "Öneri üretmek için analiz edilecek kaynak bulunamadı.",
            "recommendations": [],
            "source_count": 0,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }

    context = build_research_context(normalized_sources)

    recommendations = await call_research_agent(
        context=context,
        sources=normalized_sources,
        limit=safe_limit,
    )

    source = "llm"

    if not recommendations:
        recommendations = build_fallback_recommendations(
            sources=normalized_sources,
            limit=safe_limit,
        )
        source = "fallback"

    recommendations = await enrich_recommendations_with_web_search(recommendations)

    web_found_count = len(
        [
            recommendation
            for recommendation in recommendations
            if recommendation.get("url")
        ]
    )

    return {
        "success": True,
        "status": "ok",
        "source": source,
        "force": bool(force),
        "recommendations": recommendations,
        "source_count": analyzed_source_count,
        "analyzed_sources": analyzed_source_count,
        "web_search": True,
        "web_found_count": web_found_count,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }