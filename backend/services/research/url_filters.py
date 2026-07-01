"""
Dosya: services/research/url_filters.py

Görev:
- URL karşılaştırma işlemlerini yönetir.
- Aynı sayfanın farklı URL varyasyonlarını tek forma indirger.
- Daha önce taranmış kaynakları web search sonuçlarından çıkarır.
- Expand modunda mevcut öneri URL, başlık, query ve domain tekrarlarını filtreler.

Not:
- Bu dosya LLM çağırmaz.
- Bu dosya web search çağırmaz.
- Sadece karşılaştırma ve filtreleme yardımcılarını içerir.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse, unquote
import re


TRACKING_QUERY_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "utm_name",
    "utm_reader",
    "utm_viz_id",
    "utm_pubreferrer",
    "fbclid",
    "gclid",
    "dclid",
    "mc_cid",
    "mc_eid",
    "igshid",
    "ref",
    "ref_src",
}


GENERIC_RECOMMENDATION_DOMAINS = {
    "araştırma önerisi",
    "arastirma onerisi",
    "kaynak önerisi",
    "kaynak onerisi",
    "öneri",
    "oneri",
    "research recommendation",
    "recommendation",
}


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


def normalize_text_for_compare(value: Any) -> str:
    text = clean_text(value).lower()

    replacements = {
        "ı": "i",
        "ğ": "g",
        "ü": "u",
        "ş": "s",
        "ö": "o",
        "ç": "c",
        "İ": "i",
        "Ğ": "g",
        "Ü": "u",
        "Ş": "s",
        "Ö": "o",
        "Ç": "c",
    }

    for original, replacement in replacements.items():
        text = text.replace(original, replacement)

    text = re.sub(r"[^\w\s\-.:/]", " ", text)
    text = re.sub(r"\s+", " ", text)

    return text.strip()


def normalize_domain_for_compare(value: Any) -> str:
    raw_value = clean_text(value, 500)

    if not raw_value:
        return ""

    try:
        if raw_value.startswith("//"):
            raw_value = f"https:{raw_value}"
        elif not re.match(r"^https?://", raw_value, re.IGNORECASE):
            raw_value = f"https://{raw_value}"

        parsed = urlparse(raw_value)
        domain = parsed.netloc or parsed.path
    except Exception:
        domain = raw_value

    domain = domain.lower().strip()

    if domain.startswith("www."):
        domain = domain[4:]

    if domain.endswith(":80"):
        domain = domain[:-3]

    if domain.endswith(":443"):
        domain = domain[:-4]

    return domain.strip("/")


def is_generic_recommendation_domain(value: Any) -> bool:
    normalized_text = normalize_text_for_compare(value)
    normalized_domain = normalize_domain_for_compare(value)

    return (
        normalized_text in GENERIC_RECOMMENDATION_DOMAINS
        or normalized_domain in GENERIC_RECOMMENDATION_DOMAINS
    )


def looks_like_real_domain(value: Any) -> bool:
    domain = normalize_domain_for_compare(value)

    if not domain:
        return False

    if is_generic_recommendation_domain(domain):
        return False

    return "." in domain and " " not in domain


def normalize_url_for_compare(url: Any) -> str:
    """
    Aynı sayfanın farklı görünen URL hallerini tek karşılaştırma formuna indirger.

    Örnek:
    - https://www.example.com/page
    - https://example.com/page/
    - https://example.com/page?utm_source=x

    Aynı kabul edilir.
    """

    raw_url = clean_text(url, 1200)

    if not raw_url:
        return ""

    try:
        if raw_url.startswith("//"):
            raw_url = f"https:{raw_url}"
        elif not re.match(r"^https?://", raw_url, re.IGNORECASE):
            raw_url = f"https://{raw_url}"

        parsed = urlparse(raw_url)
        netloc = normalize_domain_for_compare(parsed.netloc)

        path = unquote(parsed.path or "").strip()

        if path != "/":
            path = path.rstrip("/")

        if not path:
            path = "/"

        query_items = []

        for key, value in parse_qsl(parsed.query, keep_blank_values=False):
            clean_key = key.lower().strip()

            if clean_key in TRACKING_QUERY_PARAMS:
                continue

            query_items.append((clean_key, value.strip()))

        query_items.sort(key=lambda item: item[0])
        query = urlencode(query_items, doseq=True)

        return urlunparse(("", netloc, path, "", query, ""))
    except Exception:
        return raw_url.lower().rstrip("/")


def get_item_url(item: dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""

    return clean_text(
        item.get("url")
        or item.get("source_url")
        or item.get("page_url")
        or item.get("target_url")
        or "",
        1000,
    )


def get_item_title(item: dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""

    return clean_text(
        item.get("title")
        or item.get("heading")
        or item.get("query_title")
        or item.get("search_title")
        or "",
        300,
    )


def get_item_query(item: dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""

    return clean_text(
        item.get("query")
        or item.get("search_query")
        or item.get("searchQuery")
        or item.get("keyword")
        or "",
        300,
    )


def get_item_domain(item: dict[str, Any]) -> str:
    if not isinstance(item, dict):
        return ""

    url = get_item_url(item)

    return clean_text(
        item.get("domain")
        or item.get("site")
        or item.get("hostname")
        or normalize_domain_for_compare(url)
        or "",
        300,
    )


def get_existing_source_urls(sources: list[dict[str, Any]]) -> list[str]:
    urls = []

    for source in safe_list(sources):
        if not isinstance(source, dict):
            continue

        url = get_item_url(source)

        if url:
            urls.append(url)

    return urls


def is_same_url(first_url: Any, second_url: Any) -> bool:
    normalized_first = normalize_url_for_compare(first_url)
    normalized_second = normalize_url_for_compare(second_url)

    if not normalized_first or not normalized_second:
        return False

    if normalized_first == normalized_second:
        return True

    try:
        first_parts = urlparse(normalized_first)
        second_parts = urlparse(normalized_second)

        same_domain = first_parts.netloc == second_parts.netloc
        same_path = first_parts.path.rstrip("/") == second_parts.path.rstrip("/")

        return bool(same_domain and same_path)
    except Exception:
        return False


def is_existing_source_url(candidate_url: Any, existing_source_urls: list[str]) -> bool:
    for source_url in safe_list(existing_source_urls):
        if is_same_url(candidate_url, source_url):
            return True

    return False


def unique_clean_values(values: list[Any], max_length: int = 500) -> list[str]:
    normalized_seen = set()
    cleaned_values = []

    for value in safe_list(values):
        cleaned = clean_text(value, max_length)

        if not cleaned:
            continue

        normalized = normalize_text_for_compare(cleaned)

        if normalized in normalized_seen:
            continue

        normalized_seen.add(normalized)
        cleaned_values.append(cleaned)

    return cleaned_values


def build_exclude_payload(payload: dict[str, Any] | None = None) -> dict[str, list[str]]:
    """
    Frontend'den gelen exclude alanlarını standartlaştırır.

    Beklenen alanlar:
    - exclude_recommendations
    - exclude_urls
    - exclude_queries
    - exclude_titles
    - exclude_domains

    Önemli:
    - "Araştırma önerisi" gibi gerçek domain olmayan placeholder değerleri
      exclude_domains içine alınmaz.
    """

    payload = payload or {}

    exclude_urls = list(safe_list(payload.get("exclude_urls")))
    exclude_queries = list(safe_list(payload.get("exclude_queries")))
    exclude_titles = list(safe_list(payload.get("exclude_titles")))
    exclude_domains = list(safe_list(payload.get("exclude_domains")))

    for item in safe_list(payload.get("exclude_recommendations")):
        if not isinstance(item, dict):
            continue

        title = get_item_title(item)
        url = get_item_url(item)
        query = get_item_query(item)
        domain = get_item_domain(item)

        if title:
            exclude_titles.append(title)

        if url:
            exclude_urls.append(url)

        if query:
            exclude_queries.append(query)

        if domain and looks_like_real_domain(domain):
            exclude_domains.append(domain)

    real_exclude_domains = [
        domain
        for domain in exclude_domains
        if looks_like_real_domain(domain)
    ]

    return {
        "exclude_urls": unique_clean_values(exclude_urls, max_length=1000),
        "exclude_queries": unique_clean_values(exclude_queries, max_length=300),
        "exclude_titles": unique_clean_values(exclude_titles, max_length=300),
        "exclude_domains": unique_clean_values(real_exclude_domains, max_length=300),
    }


def is_excluded_url(candidate_url: Any, exclude_urls: list[str]) -> bool:
    for exclude_url in safe_list(exclude_urls):
        if is_same_url(candidate_url, exclude_url):
            return True

    return False


def is_excluded_domain(candidate_domain: Any, exclude_domains: list[str]) -> bool:
    if not looks_like_real_domain(candidate_domain):
        return False

    normalized_candidate = normalize_domain_for_compare(candidate_domain)

    if not normalized_candidate:
        return False

    for domain in safe_list(exclude_domains):
        if not looks_like_real_domain(domain):
            continue

        normalized_domain = normalize_domain_for_compare(domain)

        if not normalized_domain:
            continue

        if normalized_candidate == normalized_domain:
            return True

    return False


def is_excluded_text(candidate_text: Any, exclude_texts: list[str]) -> bool:
    normalized_candidate = normalize_text_for_compare(candidate_text)

    if not normalized_candidate:
        return False

    for text in safe_list(exclude_texts):
        normalized_text = normalize_text_for_compare(text)

        if not normalized_text:
            continue

        if normalized_candidate == normalized_text:
            return True

    return False


def is_recommendation_excluded(
    recommendation: dict[str, Any],
    exclude_payload: dict[str, list[str]] | None = None,
) -> bool:
    if not isinstance(recommendation, dict):
        return True

    excludes = exclude_payload or {}

    url = get_item_url(recommendation)
    title = get_item_title(recommendation)
    query = get_item_query(recommendation)
    domain = get_item_domain(recommendation)

    if url and is_excluded_url(url, excludes.get("exclude_urls") or []):
        return True

    if domain and is_excluded_domain(domain, excludes.get("exclude_domains") or []):
        return True

    if title and is_excluded_text(title, excludes.get("exclude_titles") or []):
        return True

    if query and is_excluded_text(query, excludes.get("exclude_queries") or []):
        return True

    return False


def filter_recommendations_by_excludes(
    recommendations: list[dict[str, Any]],
    exclude_payload: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    filtered = []

    for recommendation in safe_list(recommendations):
        if not isinstance(recommendation, dict):
            continue

        if is_recommendation_excluded(recommendation, exclude_payload):
            continue

        filtered.append(recommendation)

    return filtered


def is_web_result_excluded(
    result: dict[str, Any],
    existing_source_urls: list[str] | None = None,
    exclude_payload: dict[str, list[str]] | None = None,
) -> bool:
    if not isinstance(result, dict):
        return True

    existing_source_urls = existing_source_urls or []
    excludes = exclude_payload or {}

    url = get_item_url(result)
    title = get_item_title(result)
    domain = get_item_domain(result)

    if not url:
        return True

    if is_existing_source_url(url, existing_source_urls):
        return True

    if is_excluded_url(url, excludes.get("exclude_urls") or []):
        return True

    if domain and is_excluded_domain(domain, excludes.get("exclude_domains") or []):
        return True

    if title and is_excluded_text(title, excludes.get("exclude_titles") or []):
        return True

    return False


def filter_web_results(
    results: list[dict[str, Any]],
    existing_source_urls: list[str] | None = None,
    exclude_payload: dict[str, list[str]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """
    Web search sonuçlarını filtreler.

    Dönen değer:
    (
      filtrelenmiş_sonuçlar,
      {
        "raw_count": 5,
        "filtered_count": 3,
        "removed_count": 2
      }
    )
    """

    filtered_results = []
    seen_urls = set()

    raw_count = 0
    duplicate_count = 0
    removed_count = 0

    for result in safe_list(results):
        if not isinstance(result, dict):
            continue

        raw_count += 1

        url = get_item_url(result)
        normalized_url = normalize_url_for_compare(url)

        if not normalized_url:
            removed_count += 1
            continue

        if normalized_url in seen_urls:
            duplicate_count += 1
            continue

        if is_web_result_excluded(
            result=result,
            existing_source_urls=existing_source_urls,
            exclude_payload=exclude_payload,
        ):
            removed_count += 1
            continue

        seen_urls.add(normalized_url)
        filtered_results.append(result)

    stats = {
        "raw_count": raw_count,
        "filtered_count": len(filtered_results),
        "removed_count": removed_count,
        "duplicate_count": duplicate_count,
    }

    return filtered_results, stats