"""
Dosya: services/research/web_enrichment.py

Görev:
- Önerilerin query alanlarıyla web search çalıştırır.
- Web search sonucu bulunan gerçek URL'leri öneri kartlarına bağlar.
- Daha önce taranmış kaynak URL'lerini tekrar öneri olarak döndürmez.
- Expand modunda mevcut öneri URL, başlık ve domain tekrarlarını filtreler.

Not:
- Bu dosya öneri üretmez.
- Bu dosya LLM çağırmaz.
- Sadece üretilmiş önerileri gerçek web sonuçlarıyla zenginleştirir.
"""

from __future__ import annotations

from typing import Any

from services.research.url_filters import (
    clean_text,
    filter_web_results,
    get_item_domain,
    safe_list,
)


WEB_RESULTS_PER_RECOMMENDATION = 5


async def search_web_for_recommendation(
    recommendation: dict[str, Any],
    existing_source_urls: list[str] | None = None,
    exclude_payload: dict[str, list[str]] | None = None,
    max_results: int = WEB_RESULTS_PER_RECOMMENDATION,
) -> dict[str, Any]:
    """
    Tek bir önerinin query alanı için web search yapar.

    Filtreler:
    - Daha önce taranmış kaynaklar
    - Expand modunda mevcut öneri URL'leri
    - Expand modunda mevcut öneri domainleri
    - Expand modunda mevcut öneri başlıkları
    """

    if not isinstance(recommendation, dict):
        return recommendation

    query = clean_text(recommendation.get("query"), 260)
    safe_existing_source_urls = safe_list(existing_source_urls)
    safe_exclude_payload = exclude_payload or {}

    if not query:
        recommendation["web_search_status"] = "missing_query"
        recommendation["web_search_provider"] = ""
        recommendation["related_results"] = []
        recommendation["filtered_existing_source_count"] = 0
        recommendation["filtered_excluded_count"] = 0

        return recommendation

    try:
        from services.web_search_service import web_search
    except Exception as error:
        print("[RESEARCH WEB ENRICHMENT] web_search_service import edilemedi:", error)

        recommendation["web_search_status"] = "web_search_import_error"
        recommendation["web_search_provider"] = ""
        recommendation["related_results"] = []
        recommendation["filtered_existing_source_count"] = 0
        recommendation["filtered_excluded_count"] = 0

        return recommendation

    try:
        search_result = await web_search(
            query=query,
            max_results=max_results,
            provider="auto",
        )
    except Exception as error:
        print("[RESEARCH WEB ENRICHMENT] Web search hatası:", error)

        recommendation["web_search_status"] = "web_search_error"
        recommendation["web_search_provider"] = ""
        recommendation["related_results"] = []
        recommendation["filtered_existing_source_count"] = 0
        recommendation["filtered_excluded_count"] = 0

        return recommendation

    raw_results = search_result.get("results") or []

    results, filter_stats = filter_web_results(
        results=raw_results,
        existing_source_urls=safe_existing_source_urls,
        exclude_payload=safe_exclude_payload,
    )

    if not results:
        recommendation["web_search_status"] = search_result.get("status") or "no_results"
        recommendation["web_search_provider"] = search_result.get("provider") or ""
        recommendation["related_results"] = []
        recommendation["web_filter_stats"] = filter_stats
        recommendation["filtered_existing_source_count"] = filter_stats.get("removed_count", 0)
        recommendation["filtered_excluded_count"] = filter_stats.get("removed_count", 0)

        return recommendation

    primary_result = results[0]
    primary_url = clean_text(primary_result.get("url"), 800)

    recommendation["url"] = primary_url or recommendation.get("url") or ""
    recommendation["domain"] = (
        primary_result.get("domain")
        or get_item_domain(primary_result)
        or recommendation.get("domain")
        or "Araştırma önerisi"
    )
    recommendation["web_result_title"] = primary_result.get("title") or ""
    recommendation["web_result_snippet"] = (
        primary_result.get("snippet")
        or primary_result.get("summary")
        or ""
    )
    recommendation["web_search_status"] = "ok"
    recommendation["web_search_provider"] = (
        search_result.get("provider")
        or primary_result.get("provider")
        or ""
    )
    recommendation["related_results"] = results[1:max_results]
    recommendation["web_filter_stats"] = filter_stats
    recommendation["filtered_existing_source_count"] = filter_stats.get("removed_count", 0)
    recommendation["filtered_excluded_count"] = filter_stats.get("removed_count", 0)

    return recommendation


async def enrich_recommendations_with_web_search(
    recommendations: list[dict[str, Any]],
    existing_source_urls: list[str] | None = None,
    exclude_payload: dict[str, list[str]] | None = None,
    max_results_per_recommendation: int = WEB_RESULTS_PER_RECOMMENDATION,
) -> list[dict[str, Any]]:
    """
    Öneri listesindeki query alanlarını kullanarak gerçek web kaynaklarını bulur.

    Dönen her öneri şunları içerebilir:
    - url
    - domain
    - web_result_title
    - web_result_snippet
    - web_search_status
    - web_search_provider
    - related_results
    - web_filter_stats
    """

    enriched_recommendations: list[dict[str, Any]] = []

    for recommendation in safe_list(recommendations):
        if not isinstance(recommendation, dict):
            continue

        enriched = await search_web_for_recommendation(
            recommendation=recommendation,
            existing_source_urls=existing_source_urls,
            exclude_payload=exclude_payload,
            max_results=max_results_per_recommendation,
        )

        enriched_recommendations.append(enriched)

    return enriched_recommendations


def count_web_found_recommendations(
    recommendations: list[dict[str, Any]],
) -> int:
    count = 0

    for recommendation in safe_list(recommendations):
        if not isinstance(recommendation, dict):
            continue

        if recommendation.get("url"):
            count += 1

    return count


def count_filtered_web_results(
    recommendations: list[dict[str, Any]],
) -> int:
    total = 0

    for recommendation in safe_list(recommendations):
        if not isinstance(recommendation, dict):
            continue

        stats = recommendation.get("web_filter_stats") or {}

        if isinstance(stats, dict):
            total += int(stats.get("removed_count") or 0)

    return total