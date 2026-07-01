"""
Dosya: routes/research.py

Görev:
- Araştırma ve öneri üretme endpointlerini yönetir.
- Kaynaklar sekmesindeki Öneriler paneli için backend API sağlar.
- Frontend'den gelen kaynak özetlerini research_service katmanına gönderir.
- Öneri oluştur / yenile modlarını ayırır.
- Expand modunda mevcut önerileri tekrar etmemek için exclude alanlarını service'e aktarır.

Endpointler:
- GET  /research/recommendations
- POST /research/recommendations
"""

from datetime import datetime
from typing import Any, Optional, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.research_service import generate_recommendations_from_sources


router = APIRouter()


_RECOMMENDATION_CACHE: dict[str, Any] = {
    "recommendations": [],
    "source_count": 0,
    "analyzed_sources": 0,
    "generated_at": "",
    "mode": "refresh",
    "generation_mode": "refresh",
}


class RecommendationSource(BaseModel):
    source_id: str = ""
    title: str = ""
    url: str = ""
    domain: str = ""
    summary: str = ""
    short_summary: str = ""
    long_summary: str = ""
    summary_sections: list[dict[str, Any]] = Field(default_factory=list)
    scanned_at: str = ""


class ExcludedRecommendation(BaseModel):
    title: str = ""
    url: str = ""
    query: str = ""
    domain: str = ""


class RecommendationRequest(BaseModel):
    sources: list[RecommendationSource] = Field(default_factory=list)
    source_count: int = 0
    force: bool = False
    limit: Optional[int] = 5

    mode: Literal["refresh", "expand"] = "refresh"
    generation_mode: Optional[Literal["refresh", "expand"]] = None
    reason: str = ""

    exclude_recommendations: list[ExcludedRecommendation] = Field(default_factory=list)
    exclude_urls: list[str] = Field(default_factory=list)
    exclude_queries: list[str] = Field(default_factory=list)
    exclude_titles: list[str] = Field(default_factory=list)
    exclude_domains: list[str] = Field(default_factory=list)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _cache_result(result: dict[str, Any], request: RecommendationRequest) -> None:
    """
    POST ile üretilen son önerileri GET endpoint'i için bellekte tutar.

    Not:
    - GET endpoint'i LLM çalıştırmaz.
    - Boş öneri dönerse mevcut cache silinmez.
    """

    if not isinstance(result, dict):
        return

    recommendations = result.get("recommendations")

    if not isinstance(recommendations, list) or not recommendations:
        return

    _RECOMMENDATION_CACHE.clear()
    _RECOMMENDATION_CACHE.update(
        {
            **result,
            "recommendations": recommendations,
            "source_count": int(result.get("source_count") or request.source_count or 0),
            "analyzed_sources": int(
                result.get("analyzed_sources")
                or result.get("source_count")
                or request.source_count
                or 0
            ),
            "generated_at": result.get("generated_at") or _now_iso(),
            "mode": request.mode,
            "generation_mode": request.generation_mode or request.mode,
        }
    )


@router.get("/research/recommendations")
async def get_recommendations():
    """
    Mevcut önerileri döndürür.

    Bu endpoint öneri üretmez, LLM çağırmaz, web search çalıştırmaz.
    Yenile butonu bu endpoint'i kullanmalıdır.
    """

    recommendations = _RECOMMENDATION_CACHE.get("recommendations") or []

    return {
        "success": True,
        "status": "ok",
        "source": "cache",
        "recommendations": recommendations,
        "source_count": _RECOMMENDATION_CACHE.get("source_count", 0),
        "analyzed_sources": _RECOMMENDATION_CACHE.get("analyzed_sources", 0),
        "generated_at": _RECOMMENDATION_CACHE.get("generated_at", ""),
        "mode": "refresh",
        "generation_mode": "refresh",
        "cached": bool(recommendations),
    }


@router.post("/research/recommendations")
async def create_recommendations(request: RecommendationRequest):
    """
    Taranan kaynaklara göre araştırma önerileri üretir.

    Frontend bu endpoint'e kaynak listesini gönderir.
    Service katmanı bu kaynaklardan konu çıkarımı yapar ve öneri kartları döndürür.

    mode:
    - refresh:
      Mevcut kaynak bağlamına göre önerileri günceller.

    - expand:
      Mevcut önerilerden farklı yeni öneriler üretmeye çalışır.
      exclude_* alanları bu modda özellikle önemlidir.
    """

    sources = [source.model_dump() for source in request.sources]
    exclude_recommendations = [
        recommendation.model_dump()
        for recommendation in request.exclude_recommendations
    ]

    result = await generate_recommendations_from_sources(
        sources=sources,
        source_count=request.source_count,
        force=request.force,
        limit=request.limit or 5,
        mode=request.mode,
        generation_mode=request.generation_mode,
        reason=request.reason,
        exclude_recommendations=exclude_recommendations,
        exclude_urls=request.exclude_urls,
        exclude_queries=request.exclude_queries,
        exclude_titles=request.exclude_titles,
        exclude_domains=request.exclude_domains,
    )

    _cache_result(result, request)

    return result
