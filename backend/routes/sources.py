"""
Dosya: routes/sources.py

Görev:
- Vector store içinde kayıtlı olan taranmış kaynakları frontend'e sunar.
- Kaynak listesini döndürür.
- Kaynakları zaman çizelgesine göre gruplar.
- Tekil kaynak detayını getirir.
- Kaynağa ait chunk listesini döndürür.
- Tekil chunk detayını getirir.
- Kaynak silme işlemini backend tarafında gerçek olarak uygular.

Endpoint'ler:
- GET /sources
- GET /sources/timeline
- GET /sources/{source_id}
- DELETE /sources/{source_id}
- GET /sources/{source_id}/chunks
- GET /sources/{source_id}/chunks/{chunk_id}

Frontend'e taşınan temel alanlar:
- source_id
- title
- llm_title
- original_title
- url
- domain
- summary
- short_summary
- long_summary
- summary_status
- scanned_at
- chunk_count
- status

Not:
- Bu dosya kaynak verisini üretmez.
- Kaynak verisini vector_store.py üzerinden okur.
- Eksik alanları frontend bozulmasın diye normalize eder.
- Silme işlemi sadece frontend kartını kaldırmaz; ilgili source_id'ye ait tüm chunk'ları vector store'dan siler.
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime, date, timedelta
from typing import Any

from core.vector_store import vector_store


router = APIRouter()


def parse_datetime(value: str | None) -> datetime | None:
    """
    ISO formatındaki tarih bilgisini datetime nesnesine çevirir.
    Hatalı veya boş tarih gelirse None döndürür.
    """

    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def normalize_source(source: dict[str, Any]) -> dict[str, Any]:
    """
    Frontend'e gönderilecek kaynak bilgisini güvenli hale getirir.

    Amaç:
    - Eski kaynaklarda eksik alan olsa bile frontend'in bozulmasını engellemek.
    - Yeni LLM alanlarını standart şekilde taşımak.
    - Kart ve detay ekranının aynı veri yapısıyla çalışmasını sağlamak.
    """

    title = (
        source.get("llm_title")
        or source.get("title")
        or source.get("original_title")
        or "Başlıksız kaynak"
    )

    original_title = (
        source.get("original_title")
        or source.get("title")
        or ""
    )

    short_summary = (
        source.get("short_summary")
        or source.get("summary")
        or "Bu kaynak için kısa özet henüz oluşturulmadı."
    )

    long_summary = (
        source.get("long_summary")
        or source.get("detail_summary")
        or source.get("summary")
        or short_summary
    )

    summary = (
        source.get("summary")
        or short_summary
    )

    return {
        **source,
        "title": title,
        "llm_title": source.get("llm_title") or title,
        "original_title": original_title,
        "summary": summary,
        "short_summary": short_summary,
        "long_summary": long_summary,
        "summary_status": source.get("summary_status") or "unknown",
        "url": source.get("url") or "",
        "domain": source.get("domain") or "",
        "scanned_at": source.get("scanned_at") or "",
        "chunk_count": source.get("chunk_count") or len(source.get("chunks", [])),
        "status": source.get("status") or "ready",
    }


def normalize_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    """
    Chunk detayını frontend ve ileride highlight işlemleri için güvenli hale getirir.
    """

    title = (
        chunk.get("llm_title")
        or chunk.get("title")
        or chunk.get("original_title")
        or "Başlıksız kaynak"
    )

    text = (
        chunk.get("text")
        or chunk.get("content")
        or ""
    )

    short_summary = (
        chunk.get("short_summary")
        or chunk.get("summary")
        or ""
    )

    long_summary = (
        chunk.get("long_summary")
        or chunk.get("summary")
        or short_summary
    )

    return {
        **chunk,
        "title": title,
        "llm_title": chunk.get("llm_title") or title,
        "original_title": chunk.get("original_title") or "",
        "summary": chunk.get("summary") or short_summary,
        "short_summary": short_summary,
        "long_summary": long_summary,
        "summary_status": chunk.get("summary_status") or "unknown",
        "text": text,
        "content": chunk.get("content") or text,
        "url": chunk.get("url") or "",
        "domain": chunk.get("domain") or "",
        "chunk_index": chunk.get("chunk_index", 0),
    }


def get_timeline_group(scanned_at: str | None) -> str:
    """
    Kaynağın taranma tarihine göre zaman çizelgesi grubunu belirler.
    """

    scanned_datetime = parse_datetime(scanned_at)

    if not scanned_datetime:
        return "Tarihi bilinmeyen"

    scanned_date = scanned_datetime.date()
    today = date.today()
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())

    if scanned_date == today:
        return "Bugün"

    if scanned_date == yesterday:
        return "Dün"

    if scanned_date >= week_start:
        return "Bu hafta"

    return "Daha eski"


def build_timeline(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Kaynak listesini zaman gruplarına ayırır.
    """

    groups = {
        "Bugün": [],
        "Dün": [],
        "Bu hafta": [],
        "Daha eski": [],
        "Tarihi bilinmeyen": [],
    }

    for source in sources:
        group_name = get_timeline_group(source.get("scanned_at"))
        groups[group_name].append(source)

    timeline = []

    for group_name, items in groups.items():
        if not items:
            continue

        sorted_items = sorted(
            items,
            key=lambda item: item.get("scanned_at") or "",
            reverse=True,
        )

        timeline.append({
            "group": group_name,
            "count": len(sorted_items),
            "items": sorted_items,
        })

    return timeline


@router.get("/sources")
def list_sources():
    """
    Tüm taranmış kaynakları listeler.

    Frontend kaynaklar sekmesi bu endpoint üzerinden beslenir.
    """

    sources = [
        normalize_source(source)
        for source in vector_store.get_sources()
    ]

    return {
        "success": True,
        "count": len(sources),
        "sources": sources,
    }


@router.get("/sources/timeline")
def get_sources_timeline():
    """
    Taranan kaynakları zamana göre gruplar.

    Gruplar:
    - Bugün
    - Dün
    - Bu hafta
    - Daha eski
    - Tarihi bilinmeyen
    """

    sources = [
        normalize_source(source)
        for source in vector_store.get_sources()
    ]

    timeline = build_timeline(sources)

    return {
        "success": True,
        "count": len(sources),
        "timeline": timeline,
    }


@router.get("/sources/{source_id}")
def get_source_detail(source_id: str):
    """
    Tek bir kaynağın detayını getirir.

    Dönen veri:
    - source metadata
    - kısa özet
    - geniş özet
    - chunk listesi
    """

    detail = vector_store.get_source_detail(source_id)

    if not detail:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "message": "Kaynak bulunamadı.",
                "source_id": source_id,
            },
        )

    normalized_detail = normalize_source(detail)

    normalized_detail["chunks"] = [
        normalize_chunk(chunk)
        for chunk in detail.get("chunks", [])
    ]

    return {
        "success": True,
        "source": normalized_detail,
    }


@router.delete("/sources/{source_id}")
def delete_source(source_id: str):
    """
    Kaynağı vector store'dan gerçek olarak siler.

    Sadece frontend kartını kaldırmaz.
    İlgili source_id'ye ait tüm chunk'ları siler.
    Sonra FAISS index'i kalan chunk embeddingleriyle yeniden kurar.
    """

    delete_result = vector_store.delete_source(source_id)

    if not delete_result.get("deleted"):
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "message": "Silinecek kaynak bulunamadı.",
                "source_id": source_id,
                "result": delete_result,
            },
        )

    return {
        "success": True,
        "message": "Kaynak başarıyla silindi.",
        "result": delete_result,
    }


@router.get("/sources/{source_id}/chunks")
def get_source_chunks(source_id: str):
    """
    Bir kaynağa ait chunk listesini getirir.

    Highlight, detay ekranı ve notlara aktarma tarafında kullanılabilir.
    """

    detail = vector_store.get_source_detail(source_id)

    if not detail:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "message": "Kaynak bulunamadı.",
                "source_id": source_id,
            },
        )

    chunks = [
        normalize_chunk(chunk)
        for chunk in detail.get("chunks", [])
    ]

    return {
        "success": True,
        "source_id": source_id,
        "count": len(chunks),
        "chunks": chunks,
    }


@router.get("/sources/{source_id}/chunks/{chunk_id}")
def get_chunk_detail(source_id: str, chunk_id: str):
    """
    Tek bir chunk detayını getirir.

    İleride highlight için kullanılacak:
    - source_id
    - chunk_id
    - text
    - url
    """

    chunk = vector_store.get_chunk_detail(source_id, chunk_id)

    if not chunk:
        raise HTTPException(
            status_code=404,
            detail={
                "success": False,
                "message": "Chunk bulunamadı.",
                "source_id": source_id,
                "chunk_id": chunk_id,
            },
        )

    return {
        "success": True,
        "chunk": normalize_chunk(chunk),
    }