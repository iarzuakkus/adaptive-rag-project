"""
Dosya: routes/research.py

Görev:
- Araştırma ve öneri üretme endpointlerini yönetir.
- Kaynaklar sekmesindeki Öneriler paneli için backend API sağlar.
- Frontend'den gelen kaynak özetlerini research_service katmanına gönderir.

Endpointler:
- POST /research/recommendations
"""

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.research_service import generate_recommendations_from_sources


router = APIRouter()


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


class RecommendationRequest(BaseModel):
    sources: list[RecommendationSource] = Field(default_factory=list)
    source_count: int = 0
    force: bool = False
    limit: Optional[int] = 5


@router.post("/research/recommendations")
async def create_recommendations(request: RecommendationRequest):
    """
    Taranan kaynaklara göre araştırma önerileri üretir.

    Frontend bu endpoint'e kaynak listesini gönderir.
    Service katmanı bu kaynaklardan konu çıkarımı yapar ve öneri kartları döndürür.
    """

    sources = [source.model_dump() for source in request.sources]

    result = await generate_recommendations_from_sources(
        sources=sources,
        source_count=request.source_count,
        force=request.force,
        limit=request.limit or 5
    )

    return result