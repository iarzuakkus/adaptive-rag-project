"""
Dosya: services/research/recommendation_normalizer.py

Görev:
- LLM, fallback veya farklı kaynaklardan gelen önerileri standart öneri formatına çevirir.
- title, summary, reason, query, url, domain, type alanlarını normalize eder.
- Expand modunda mevcut öneri tekrarlarını exclude_payload ile filtreler.

Not:
- Bu dosya LLM çağırmaz.
- Bu dosya web search çağırmaz.
- Sadece öneri verisini temizler, standartlaştırır ve filtreler.
"""

from __future__ import annotations

from typing import Any
import uuid

from services.research.url_filters import (
    clean_text,
    filter_recommendations_by_excludes,
    get_item_domain,
    safe_list,
)


def make_recommendation_id(prefix: str = "rec") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def normalize_recommendation(
    item: dict[str, Any],
    index: int,
) -> dict[str, Any] | None:
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
        or get_item_domain({"url": url})
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
        "id": clean_text(
            item.get("id")
            or item.get("recommendation_id")
            or item.get("recommendationId")
            or "",
            120,
        ) or make_recommendation_id(),
        "title": title or f"Araştırma önerisi {index + 1}",
        "summary": summary or "Bu öneri için açıklama oluşturulamadı.",
        "reason": reason or "Bu öneri mevcut kaynak bağlamına göre üretildi.",
        "url": url,
        "domain": domain or "Araştırma önerisi",
        "query": query,
        "type": recommendation_type,
    }


def extract_recommendation_list(value: Any) -> list[Any]:
    if isinstance(value, dict):
        for key in [
            "recommendations",
            "items",
            "results",
            "sources",
            "recommended_sources",
        ]:
            if isinstance(value.get(key), list):
                return value.get(key) or []

    if isinstance(value, list):
        return value

    return []


def normalize_recommendations(
    recommendations: Any,
    limit: int,
    mode: str = "refresh",
    exclude_payload: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    raw_items = extract_recommendation_list(recommendations)

    if not raw_items:
        return []

    normalized: list[dict[str, Any]] = []

    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue

        normalized_item = normalize_recommendation(item, index)

        if normalized_item:
            normalized.append(normalized_item)

    if mode == "expand":
        normalized = filter_recommendations_by_excludes(
            recommendations=normalized,
            exclude_payload=exclude_payload,
        )

    safe_limit = max(1, int(limit or 5))

    return normalized[:safe_limit]


def merge_recommendation_lists(
    primary: list[dict[str, Any]],
    secondary: list[dict[str, Any]],
    limit: int,
    mode: str = "refresh",
    exclude_payload: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """
    Birincil ve ikincil öneri listelerini tekrarları azaltarak birleştirir.

    Kullanım:
    - LLM az öneri döndürürse fallback önerilerle tamamlamak için kullanılabilir.
    - Expand modunda exclude alanları korunur.
    """

    combined = []

    for item in safe_list(primary) + safe_list(secondary):
        if isinstance(item, dict):
            combined.append(item)

    normalized = normalize_recommendations(
        recommendations=combined,
        limit=max(limit * 2, limit),
        mode=mode,
        exclude_payload=exclude_payload,
    )

    seen_keys = set()
    unique_items: list[dict[str, Any]] = []

    for item in normalized:
        key = build_recommendation_unique_key(item)

        if key in seen_keys:
            continue

        seen_keys.add(key)
        unique_items.append(item)

        if len(unique_items) >= limit:
            break

    return unique_items


def build_recommendation_unique_key(item: dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""

    url = clean_text(item.get("url"), 500).lower()
    title = clean_text(item.get("title"), 180).lower()
    query = clean_text(item.get("query"), 240).lower()
    domain = clean_text(item.get("domain"), 140).lower()

    if url:
        return f"url::{url}"

    if query:
        return f"query::{query}"

    if title and domain:
        return f"title-domain::{title}::{domain}"

    return f"title::{title}"