from fastapi import APIRouter, HTTPException
from datetime import datetime, date, timedelta
from typing import Any

from core.vector_store import vector_store

router = APIRouter()


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def get_timeline_group(scanned_at: str | None) -> str:
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

    Frontend kaynaklar sekmesi bu endpoint üzerinden beslenecek.
    """

    sources = vector_store.get_sources()

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

    sources = vector_store.get_sources()
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
    - summary
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

    return {
        "success": True,
        "source": detail,
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

    Highlight, detay ekranı ve notlara aktarma tarafında kullanılacak.
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

    return {
        "success": True,
        "source_id": source_id,
        "count": len(detail.get("chunks", [])),
        "chunks": detail.get("chunks", []),
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
        "chunk": chunk,
    }