"""
Dosya: services/web_search_service.py

Görev:
- Araştırma önerileri için web search işlemini yönetir.
- Tavily veya Brave Search API üzerinden arama yapar.
- Sonuçları frontend'in kullanabileceği standart formata çevirir.
- Aynı domain / aynı URL tekrarlarını temizler.

Desteklenen provider'lar:
- Tavily: TAVILY_API_KEY
- Brave Search: BRAVE_SEARCH_API_KEY

Not:
- API key yoksa hata fırlatmaz, boş sonuç döner.
- Bu servis öneri üretmez; sadece verilen query ile web araması yapar.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime
from pathlib import Path
import asyncio
import json
import os
import re


def load_environment() -> None:
    """
    backend/.env içindeki API key değerlerini yükler.

    Önce python-dotenv varsa onu kullanır.
    Yoksa basit manuel .env okuyucu ile devam eder.
    """

    try:
        from dotenv import load_dotenv

        backend_env_path = Path(__file__).resolve().parents[1] / ".env"
        root_env_path = Path.cwd() / ".env"

        if backend_env_path.exists():
            load_dotenv(backend_env_path)

        if root_env_path.exists():
            load_dotenv(root_env_path)

        return
    except Exception:
        pass

    possible_env_paths = [
        Path(__file__).resolve().parents[1] / ".env",
        Path.cwd() / ".env",
    ]

    for env_path in possible_env_paths:
        if not env_path.exists():
            continue

        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                clean_line = line.strip()

                if not clean_line:
                    continue

                if clean_line.startswith("#"):
                    continue

                if "=" not in clean_line:
                    continue

                key, value = clean_line.split("=", 1)

                key = key.strip()
                value = value.strip().strip('"').strip("'")

                if key and key not in os.environ:
                    os.environ[key] = value
        except Exception as error:
            print("[WEB SEARCH SERVICE] .env okunamadı:", error)


load_environment()


TAVILY_SEARCH_URL = "https://api.tavily.com/search"
BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"

DEFAULT_TIMEOUT_SECONDS = 15
DEFAULT_MAX_RESULTS = 5
MAX_RESULTS_LIMIT = 8


def clean_text(value: Any, max_length: int | None = None) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)

    if max_length and len(text) > max_length:
        return text[:max_length].strip() + "..."

    return text


def normalize_max_results(max_results: int | None) -> int:
    try:
        value = int(max_results or DEFAULT_MAX_RESULTS)
    except Exception:
        value = DEFAULT_MAX_RESULTS

    return max(1, min(value, MAX_RESULTS_LIMIT))


def has_tavily_key() -> bool:
    return bool(os.getenv("TAVILY_API_KEY", "").strip())


def has_brave_key() -> bool:
    return bool(os.getenv("BRAVE_SEARCH_API_KEY", "").strip())


def has_any_search_key(provider: str = "auto") -> bool:
    safe_provider = clean_text(provider).lower() or "auto"

    if safe_provider == "tavily":
        return has_tavily_key()

    if safe_provider == "brave":
        return has_brave_key()

    return has_tavily_key() or has_brave_key()


def get_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        return parsed.netloc.replace("www.", "")
    except Exception:
        return ""


def normalize_url(url: str) -> str:
    value = clean_text(url, 800)

    if not value:
        return ""

    try:
        parsed = urlparse(value)

        if parsed.scheme not in {"http", "https"}:
            return ""

        return value
    except Exception:
        return ""


def is_valid_result(result: dict[str, Any]) -> bool:
    url = normalize_url(result.get("url") or "")

    if not url:
        return False

    title = clean_text(result.get("title") or "")
    snippet = clean_text(result.get("snippet") or result.get("summary") or "")

    return bool(title or snippet)


def normalize_result(
    item: dict[str, Any],
    provider: str,
    query: str,
    index: int,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    url = normalize_url(
        item.get("url")
        or item.get("link")
        or item.get("href")
        or ""
    )

    if not url:
        return None

    title = clean_text(
        item.get("title")
        or item.get("name")
        or item.get("heading")
        or "Başlıksız kaynak",
        180,
    )

    snippet = clean_text(
        item.get("content")
        or item.get("snippet")
        or item.get("description")
        or item.get("summary")
        or "",
        520,
    )

    domain = clean_text(
        item.get("domain")
        or item.get("site")
        or item.get("hostname")
        or get_domain(url),
        140,
    )

    normalized = {
        "id": f"web_{provider}_{index + 1}",
        "title": title,
        "url": url,
        "domain": domain,
        "snippet": snippet,
        "summary": snippet,
        "query": query,
        "provider": provider,
    }

    if not is_valid_result(normalized):
        return None

    return normalized


def dedupe_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_urls = set()
    seen_domains = set()
    unique_results = []

    for result in results:
        url = normalize_url(result.get("url") or "")
        domain = get_domain(url)

        if not url:
            continue

        normalized_url_key = url.rstrip("/").lower()

        if normalized_url_key in seen_urls:
            continue

        if domain and domain in seen_domains:
            continue

        seen_urls.add(normalized_url_key)

        if domain:
            seen_domains.add(domain)

        unique_results.append(result)

    return unique_results


def post_json_sync(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")

    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            **(headers or {}),
        },
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            response_text = response.read().decode("utf-8")
            return json.loads(response_text) if response_text else {}
    except HTTPError as error:
        error_text = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"Web search POST isteği başarısız. Status: {error.code}, Response: {error_text}"
        ) from error
    except URLError as error:
        raise RuntimeError(f"Web search bağlantı hatası: {error}") from error


def get_json_sync(
    url: str,
    headers: dict[str, str] | None = None,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    request = Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "MemorAI/1.0",
            **(headers or {}),
        },
    )

    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            response_text = response.read().decode("utf-8")
            return json.loads(response_text) if response_text else {}
    except HTTPError as error:
        error_text = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(
            f"Web search GET isteği başarısız. Status: {error.code}, Response: {error_text}"
        ) from error
    except URLError as error:
        raise RuntimeError(f"Web search bağlantı hatası: {error}") from error


async def run_in_thread(callback, *args, **kwargs):
    return await asyncio.to_thread(callback, *args, **kwargs)


async def search_with_tavily(
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS,
) -> list[dict[str, Any]]:
    api_key = os.getenv("TAVILY_API_KEY", "").strip()

    if not api_key:
        return []

    safe_query = clean_text(query, 300)

    if not safe_query:
        return []

    safe_max_results = normalize_max_results(max_results)

    payload = {
        "api_key": api_key,
        "query": safe_query,
        "search_depth": "basic",
        "include_answer": False,
        "include_raw_content": False,
        "include_images": False,
        "max_results": safe_max_results,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    data = await run_in_thread(
        post_json_sync,
        TAVILY_SEARCH_URL,
        payload,
        headers,
        DEFAULT_TIMEOUT_SECONDS,
    )

    raw_results = data.get("results") or []

    if not isinstance(raw_results, list):
        return []

    normalized_results = []

    for index, item in enumerate(raw_results):
        normalized = normalize_result(
            item=item,
            provider="tavily",
            query=safe_query,
            index=index,
        )

        if normalized:
            normalized_results.append(normalized)

    return dedupe_results(normalized_results)[:safe_max_results]


async def search_with_brave(
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS,
) -> list[dict[str, Any]]:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()

    if not api_key:
        return []

    safe_query = clean_text(query, 300)

    if not safe_query:
        return []

    safe_max_results = normalize_max_results(max_results)

    params = urlencode(
        {
            "q": safe_query,
            "count": safe_max_results,
            "search_lang": "tr",
            "country": "TR",
            "safesearch": "moderate",
        }
    )

    url = f"{BRAVE_SEARCH_URL}?{params}"

    headers = {
        "X-Subscription-Token": api_key,
    }

    data = await run_in_thread(
        get_json_sync,
        url,
        headers,
        DEFAULT_TIMEOUT_SECONDS,
    )

    web_data = data.get("web") or {}
    raw_results = web_data.get("results") or []

    if not isinstance(raw_results, list):
        return []

    normalized_results = []

    for index, item in enumerate(raw_results):
        normalized = normalize_result(
            item=item,
            provider="brave",
            query=safe_query,
            index=index,
        )

        if normalized:
            normalized_results.append(normalized)

    return dedupe_results(normalized_results)[:safe_max_results]


async def web_search(
    query: str,
    max_results: int = DEFAULT_MAX_RESULTS,
    provider: str = "auto",
) -> dict[str, Any]:
    """
    Verilen query için web araması yapar.

    provider:
    - auto
    - tavily
    - brave
    """

    safe_query = clean_text(query, 300)
    safe_max_results = normalize_max_results(max_results)
    provider = clean_text(provider).lower() or "auto"

    if not safe_query:
        return {
            "success": True,
            "status": "empty_query",
            "provider": "",
            "query": "",
            "results": [],
            "result_count": 0,
            "searched_at": datetime.now().isoformat(timespec="seconds"),
        }

    if not has_any_search_key(provider):
        return {
            "success": True,
            "status": "no_api_key",
            "provider": provider,
            "query": safe_query,
            "results": [],
            "result_count": 0,
            "message": "TAVILY_API_KEY veya BRAVE_SEARCH_API_KEY bulunamadı.",
            "searched_at": datetime.now().isoformat(timespec="seconds"),
        }

    errors = []

    if provider in {"auto", "tavily"}:
        try:
            tavily_results = await search_with_tavily(
                query=safe_query,
                max_results=safe_max_results,
            )

            if tavily_results:
                return {
                    "success": True,
                    "status": "ok",
                    "provider": "tavily",
                    "query": safe_query,
                    "results": tavily_results,
                    "result_count": len(tavily_results),
                    "searched_at": datetime.now().isoformat(timespec="seconds"),
                }
        except Exception as error:
            print("[WEB SEARCH SERVICE] Tavily arama hatası:", error)
            errors.append(f"Tavily: {error}")

    if provider in {"auto", "brave"}:
        try:
            brave_results = await search_with_brave(
                query=safe_query,
                max_results=safe_max_results,
            )

            if brave_results:
                return {
                    "success": True,
                    "status": "ok",
                    "provider": "brave",
                    "query": safe_query,
                    "results": brave_results,
                    "result_count": len(brave_results),
                    "searched_at": datetime.now().isoformat(timespec="seconds"),
                }
        except Exception as error:
            print("[WEB SEARCH SERVICE] Brave arama hatası:", error)
            errors.append(f"Brave: {error}")

    return {
        "success": True,
        "status": "no_results",
        "provider": provider,
        "query": safe_query,
        "results": [],
        "result_count": 0,
        "errors": errors,
        "searched_at": datetime.now().isoformat(timespec="seconds"),
    }


async def web_search_many(
    queries: list[str],
    max_results_per_query: int = DEFAULT_MAX_RESULTS,
    provider: str = "auto",
) -> list[dict[str, Any]]:
    """
    Birden fazla query için web search yapar.
    Aynı URL ve aynı domain tekrarlarını temizler.
    """

    all_results = []
    seen_queries = set()

    for query in queries:
        safe_query = clean_text(query, 300)

        if not safe_query:
            continue

        query_key = safe_query.lower()

        if query_key in seen_queries:
            continue

        seen_queries.add(query_key)

        search_result = await web_search(
            query=safe_query,
            max_results=max_results_per_query,
            provider=provider,
        )

        for item in search_result.get("results") or []:
            all_results.append(item)

    return dedupe_results(all_results)