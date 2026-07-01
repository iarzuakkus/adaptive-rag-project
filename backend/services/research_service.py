"""
Dosya: services/research_service.py

Görev:
- Taranan kaynaklardan araştırma önerileri üretir.
- Ana öneri üretim akışını yönetir.
- Kaynakları normalize eder.
- LLM agent katmanını çağırır.
- LLM başarısız olursa fallback öneriler üretir.
- Önerileri web search ile gerçek kaynaklara bağlar.
- Daha önce taranmış kaynakları tekrar önermez.
- Expand modunda mevcut önerileri tekrar etmemeye çalışır.

Not:
- Bu servis endpoint katmanı değildir.
- Endpoint backend/routes/research.py içindedir.
- LLM çağrısı agents/research_agent.py üzerinden yapılır.
- Web search çağrısı services/web_search_service.py üzerinden yapılır.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
import inspect

from services.research.fallback_recommendations import build_fallback_recommendations
from services.research.recommendation_normalizer import (
    merge_recommendation_lists,
    normalize_recommendations,
)
from services.research.source_context import (
    build_research_context,
    normalize_sources,
)
from services.research.url_filters import (
    build_exclude_payload,
    clean_text,
    filter_recommendations_by_excludes,
    get_existing_source_urls,
    safe_list,
)
from services.research.web_enrichment import (
    count_filtered_web_results,
    count_web_found_recommendations,
    enrich_recommendations_with_web_search,
)


DEFAULT_LIMIT = 5
MIN_LIMIT = 3
MAX_LIMIT = 5


def normalize_limit(limit: int | None) -> int:
    try:
        value = int(limit or DEFAULT_LIMIT)
    except Exception:
        value = DEFAULT_LIMIT

    return max(MIN_LIMIT, min(value, MAX_LIMIT))


def normalize_generation_mode(
    mode: str | None = None,
    generation_mode: str | None = None,
) -> str:
    raw_mode = clean_text(generation_mode or mode or "refresh", 40).lower()

    if raw_mode == "expand":
        return "expand"

    return "refresh"


def build_request_exclude_payload(
    exclude_recommendations: list[dict[str, Any]] | None = None,
    exclude_urls: list[str] | None = None,
    exclude_queries: list[str] | None = None,
    exclude_titles: list[str] | None = None,
    exclude_domains: list[str] | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> dict[str, list[str]]:
    payload = {
        "exclude_recommendations": safe_list(exclude_recommendations),
        "exclude_urls": safe_list(exclude_urls),
        "exclude_queries": safe_list(exclude_queries),
        "exclude_titles": safe_list(exclude_titles),
        "exclude_domains": safe_list(exclude_domains),
    }

    if isinstance(extra_payload, dict):
        payload["exclude_recommendations"].extend(
            safe_list(extra_payload.get("exclude_recommendations"))
        )
        payload["exclude_urls"].extend(
            safe_list(extra_payload.get("exclude_urls"))
        )
        payload["exclude_queries"].extend(
            safe_list(extra_payload.get("exclude_queries"))
        )
        payload["exclude_titles"].extend(
            safe_list(extra_payload.get("exclude_titles"))
        )
        payload["exclude_domains"].extend(
            safe_list(extra_payload.get("exclude_domains"))
        )

    return build_exclude_payload(payload)


def extend_exclude_payload_with_existing_sources(
    exclude_payload: dict[str, list[str]],
    existing_source_urls: list[str],
) -> dict[str, list[str]]:
    """
    Daha önce taranmış kaynak URL'lerini final filtreye ekler.

    Not:
    - Mevcut kaynak domainlerini dışlamıyoruz.
    - Aynı domainden farklı ve değerli sayfalar önerilebilir.
    - Sadece birebir taranmış URL tekrarını engelliyoruz.
    """

    return build_exclude_payload(
        {
            "exclude_urls": [
                *safe_list(exclude_payload.get("exclude_urls")),
                *safe_list(existing_source_urls),
            ],
            "exclude_queries": safe_list(exclude_payload.get("exclude_queries")),
            "exclude_titles": safe_list(exclude_payload.get("exclude_titles")),
            "exclude_domains": safe_list(exclude_payload.get("exclude_domains")),
            "exclude_recommendations": [],
        }
    )


async def call_research_agent(
    context: str,
    sources: list[dict[str, Any]],
    limit: int,
    mode: str = "refresh",
    exclude_payload: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """
    research_agent.py henüz hazır değilse veya LLM hata verirse boş liste döner.
    Service fallback önerileri kendisi üretir.

    Agent ileride mode veya exclude_payload desteklerse otomatik olarak gönderilir.
    """

    try:
        from agents.research_agent import generate_recommendations_with_llm
    except Exception as error:
        print("[RESEARCH SERVICE] research_agent import edilemedi:", error)
        return []

    try:
        signature = inspect.signature(generate_recommendations_with_llm)

        kwargs: dict[str, Any] = {
            "context": context,
            "sources": sources,
            "limit": limit,
        }

        if "mode" in signature.parameters:
            kwargs["mode"] = mode

        if "generation_mode" in signature.parameters:
            kwargs["generation_mode"] = mode

        if "exclude_payload" in signature.parameters:
            kwargs["exclude_payload"] = exclude_payload or {}

        result = await generate_recommendations_with_llm(**kwargs)

        return normalize_recommendations(
            recommendations=result,
            limit=limit,
            mode=mode,
            exclude_payload=exclude_payload,
        )
    except Exception as error:
        print("[RESEARCH SERVICE] LLM öneri üretimi başarısız:", error)
        return []


def complete_recommendations_with_fallback(
    recommendations: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    limit: int,
    mode: str,
    exclude_payload: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], bool]:
    """
    LLM az öneri döndürürse fallback önerilerle listeyi tamamlar.
    """

    if len(recommendations) >= limit:
        return recommendations[:limit], False

    fallback_recommendations = build_fallback_recommendations(
        sources=sources,
        limit=limit,
        mode=mode,
        exclude_payload=exclude_payload,
    )

    merged = merge_recommendation_lists(
        primary=recommendations,
        secondary=fallback_recommendations,
        limit=limit,
        mode=mode,
        exclude_payload=exclude_payload,
    )

    used_fallback = len(merged) > len(recommendations)

    return merged, used_fallback


def build_empty_response(source_count: int = 0, mode: str = "refresh") -> dict[str, Any]:
    return {
        "success": True,
        "status": "empty",
        "message": "Öneri üretmek için analiz edilecek kaynak bulunamadı.",
        "mode": mode,
        "generation_mode": mode,
        "recommendations": [],
        "source_count": 0,
        "analyzed_sources": int(source_count or 0),
        "web_search": False,
        "web_found_count": 0,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def build_success_response(
    recommendations: list[dict[str, Any]],
    analyzed_source_count: int,
    source: str,
    force: bool,
    mode: str,
    reason: str,
    existing_source_urls: list[str],
    exclude_payload: dict[str, list[str]],
) -> dict[str, Any]:
    web_found_count = count_web_found_recommendations(recommendations)
    filtered_web_result_count = count_filtered_web_results(recommendations)

    return {
        "success": True,
        "status": "ok",
        "source": source,
        "force": bool(force),
        "mode": mode,
        "generation_mode": mode,
        "reason": reason,
        "recommendations": recommendations,
        "source_count": analyzed_source_count,
        "analyzed_sources": analyzed_source_count,
        "web_search": True,
        "web_found_count": web_found_count,
        "excluded_existing_source_urls": len(existing_source_urls),
        "excluded_recommendation_urls": len(exclude_payload.get("exclude_urls") or []),
        "excluded_recommendation_queries": len(exclude_payload.get("exclude_queries") or []),
        "excluded_recommendation_titles": len(exclude_payload.get("exclude_titles") or []),
        "excluded_recommendation_domains": len(exclude_payload.get("exclude_domains") or []),
        "filtered_web_result_count": filtered_web_result_count,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


async def generate_recommendations_from_sources(
    sources: list[dict[str, Any]],
    source_count: int = 0,
    force: bool = False,
    limit: int = DEFAULT_LIMIT,
    mode: str = "refresh",
    generation_mode: str | None = None,
    reason: str = "",
    exclude_recommendations: list[dict[str, Any]] | None = None,
    exclude_urls: list[str] | None = None,
    exclude_queries: list[str] | None = None,
    exclude_titles: list[str] | None = None,
    exclude_domains: list[str] | None = None,
    **extra_payload: Any,
) -> dict[str, Any]:
    """
    Kaynak listesine göre araştırma önerileri üretir.

    mode:
    - refresh:
      Mevcut kaynak bağlamına göre önerileri günceller.

    - expand:
      Mevcut önerilerden farklı kaynaklar bulmaya çalışır.
      Frontend'den gelen exclude_* alanları dikkate alınır.
    """

    safe_limit = normalize_limit(limit)
    safe_mode = normalize_generation_mode(mode=mode, generation_mode=generation_mode)
    safe_reason = clean_text(reason or extra_payload.get("reason") or "", 120)

    normalized_sources = normalize_sources(sources)
    analyzed_source_count = len(normalized_sources) or int(source_count or 0)

    if not normalized_sources:
        return build_empty_response(
            source_count=analyzed_source_count,
            mode=safe_mode,
        )

    request_exclude_payload = build_request_exclude_payload(
        exclude_recommendations=exclude_recommendations,
        exclude_urls=exclude_urls,
        exclude_queries=exclude_queries,
        exclude_titles=exclude_titles,
        exclude_domains=exclude_domains,
        extra_payload=extra_payload,
    )

    existing_source_urls = get_existing_source_urls(normalized_sources)

    effective_exclude_payload = extend_exclude_payload_with_existing_sources(
        exclude_payload=request_exclude_payload,
        existing_source_urls=existing_source_urls,
    )

    context = build_research_context(normalized_sources)

    recommendations = await call_research_agent(
        context=context,
        sources=normalized_sources,
        limit=safe_limit,
        mode=safe_mode,
        exclude_payload=effective_exclude_payload,
    )

    recommendations = filter_recommendations_by_excludes(
        recommendations=recommendations,
        exclude_payload=effective_exclude_payload,
    )

    source = "llm"

    if not recommendations:
        recommendations = build_fallback_recommendations(
            sources=normalized_sources,
            limit=safe_limit,
            mode=safe_mode,
            exclude_payload=effective_exclude_payload,
        )

        recommendations = normalize_recommendations(
            recommendations=recommendations,
            limit=safe_limit,
            mode=safe_mode,
            exclude_payload=effective_exclude_payload,
        )

        recommendations = filter_recommendations_by_excludes(
            recommendations=recommendations,
            exclude_payload=effective_exclude_payload,
        )

        source = "fallback"
    else:
        recommendations, used_fallback = complete_recommendations_with_fallback(
            recommendations=recommendations,
            sources=normalized_sources,
            limit=safe_limit,
            mode=safe_mode,
            exclude_payload=effective_exclude_payload,
        )

        if used_fallback:
            source = "llm+fallback"

    recommendations = await enrich_recommendations_with_web_search(
        recommendations=recommendations,
        existing_source_urls=existing_source_urls,
        exclude_payload=effective_exclude_payload,
    )

    recommendations = filter_recommendations_by_excludes(
        recommendations=recommendations,
        exclude_payload=effective_exclude_payload,
    )

    recommendations = recommendations[:safe_limit]

    return build_success_response(
        recommendations=recommendations,
        analyzed_source_count=analyzed_source_count,
        source=source,
        force=force,
        mode=safe_mode,
        reason=safe_reason,
        existing_source_urls=existing_source_urls,
        exclude_payload=request_exclude_payload,
    )