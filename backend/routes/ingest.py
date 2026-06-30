"""
Dosya: routes/ingest.py

Görev:
- Extension tarafından taranan web sayfası bloklarını backend'e alır.
- Sayfa içeriğindeki eklenti arayüz gürültülerini temizler.
- Kalite kontrol uygular.
- Temiz içerikleri semantic chunk'lara böler.
- Her tarama için source_id, her chunk için chunk_id üretir.
- Kaynak için LLM destekli başlık, kısa özet ve başlıklı detay özeti üretir.
- Chunk metadata'sına kaynak bilgilerini ekler.
- Embedding üretip chunk'ları vector store'a kaydeder.

Bu dosya test dosyası değildir.
Kaynakların sisteme giriş yaptığı ana backend route dosyasıdır.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any, List, Optional
from datetime import datetime
from urllib.parse import urlparse
import uuid

from services.quality_control_service import apply_quality_control
from services.chunking_service import semantic_chunk_blocks
from services.source_summary_service import generate_source_metadata
from core.embeddings import generate_embeddings
from core.vector_store import vector_store


router = APIRouter()


class Block(BaseModel):
    type: Optional[str] = "paragraph"
    text: str


class IngestRequest(BaseModel):
    title: str
    url: str
    blocks: List[Block]


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def make_source_id() -> str:
    return f"src_{uuid.uuid4().hex[:12]}"


def make_chunk_id(source_id: str, index: int) -> str:
    return f"{source_id}_chk_{index:04d}"


def extract_domain(url: str) -> str:
    if not url:
        return ""

    try:
        parsed = urlparse(url)
        return parsed.netloc.replace("www.", "")
    except Exception:
        return ""


def is_extension_noise(text: str) -> bool:
    """
    Extension widget'ından veya eklenti arayüzünden gelen metinleri ayıklar.
    Bu metinler gerçek sayfa içeriği olmadığı için vector store'a eklenmemelidir.
    """

    if not text:
        return True

    lower_text = text.strip().lower()

    noise_phrases = [
        "sayfayı tara butonuyla",
        "elle tarama aktif",
        "mevcut sayfayı kaynaklara ekleyebilirsin",
        "bu sayfayı tara",
        "kaynaklara ekleyebilirsin",
        "araştırma hafızana ekleyebilirsin",
        "notlara ekle",
        "kaynaklar sekmesi",
        "chat sekmesi",
        "adaptive rag",
        "rag-widget",
        "memorai",
    ]

    return any(phrase in lower_text for phrase in noise_phrases)


def normalize_summary_sections(value: Any) -> list[dict[str, str]]:
    """
    source_summary_service.py tarafından üretilen başlıklı özet alanını
    ingest içinde güvenli hale getirir.

    Beklenen format:
    [
      {"title": "...", "content": "..."}
    ]
    """

    if not isinstance(value, list):
        return []

    sections: list[dict[str, str]] = []

    for index, item in enumerate(value):
        if isinstance(item, str):
            content = " ".join(item.split())

            if not content:
                continue

            sections.append({
                "title": f"Başlık {index + 1}",
                "content": content[:520],
            })

            continue

        if not isinstance(item, dict):
            continue

        title = (
            item.get("title")
            or item.get("heading")
            or item.get("header")
            or item.get("name")
            or item.get("label")
            or f"Başlık {index + 1}"
        )

        content = (
            item.get("content")
            or item.get("text")
            or item.get("summary")
            or item.get("description")
            or item.get("body")
            or ""
        )

        title = " ".join(str(title or "").split())[:80]
        content = " ".join(str(content or "").split())[:520]

        if not content:
            continue

        sections.append({
            "title": title or f"Başlık {index + 1}",
            "content": content,
        })

        if len(sections) >= 4:
            break

    return sections


def enrich_chunks(
    chunks: list[dict],
    title: str,
    url: str,
    source_id: str,
    scanned_at: str,
) -> list[dict]:
    """
    Chunk'lara temel kaynak metadata bilgisi ekler.

    Bu aşamada henüz LLM başlığı ve özetleri eklenmez.
    LLM metadata'sı daha sonra apply_source_metadata_to_chunks ile eklenir.
    """

    enriched = []
    domain = extract_domain(url)

    for index, chunk in enumerate(chunks):
        text = chunk.get("text") or chunk.get("content") or ""

        if is_extension_noise(text):
            continue

        clean_text = text.strip()

        if not clean_text:
            continue

        chunk_id = chunk.get("chunk_id") or make_chunk_id(source_id, index)

        enriched.append({
            "id": chunk_id,
            "source_id": source_id,
            "chunk_id": chunk_id,
            "title": title or "Başlıksız kaynak",
            "original_title": title or "",
            "url": url,
            "domain": domain,
            "summary": "",
            "short_summary": "",
            "long_summary": "",
            "summary_sections": [],
            "detail_sections": [],
            "llm_title": "",
            "summary_status": "not_generated",
            "status": "ready",
            "content": clean_text,
            "text": clean_text,
            "chunk_index": index,
            "sentence_count": chunk.get("sentence_count", 0),
            "char_count": chunk.get("char_count", len(clean_text)),
            "scanned_at": scanned_at,
            "created_at": scanned_at,
            "metadata": {
                "source_id": source_id,
                "chunk_id": chunk_id,
                "title": title or "Başlıksız kaynak",
                "original_title": title or "",
                "url": url,
                "domain": domain,
                "summary": "",
                "short_summary": "",
                "long_summary": "",
                "summary_sections": [],
                "detail_sections": [],
                "llm_title": "",
                "summary_status": "not_generated",
                "chunk_index": index,
                "source": "web_page",
                "scanned_at": scanned_at,
            },
        })

    return enriched


def apply_source_metadata_to_chunks(
    chunks: list[dict],
    source_metadata: dict,
    original_title: str,
) -> list[dict]:
    """
    LLM veya fallback ile üretilen kaynak metadata'sını tüm chunk'lara işler.
    Böylece /sources, /chat ve retriever çıktıları aynı kaynak bilgilerini taşıyabilir.
    """

    llm_title = source_metadata.get("llm_title") or original_title or "Başlıksız kaynak"
    short_summary = source_metadata.get("short_summary") or ""
    long_summary = source_metadata.get("long_summary") or short_summary
    summary = source_metadata.get("summary") or short_summary
    summary_status = source_metadata.get("summary_status", "unknown")

    summary_sections = normalize_summary_sections(
        source_metadata.get("summary_sections")
        or source_metadata.get("detail_sections")
        or []
    )

    for chunk in chunks:
        chunk["title"] = llm_title
        chunk["llm_title"] = llm_title
        chunk["original_title"] = original_title or ""
        chunk["summary"] = summary
        chunk["short_summary"] = short_summary
        chunk["long_summary"] = long_summary
        chunk["summary_sections"] = summary_sections
        chunk["detail_sections"] = summary_sections
        chunk["summary_status"] = summary_status

        chunk_metadata = chunk.setdefault("metadata", {})

        chunk_metadata["title"] = llm_title
        chunk_metadata["llm_title"] = llm_title
        chunk_metadata["original_title"] = original_title or ""
        chunk_metadata["summary"] = summary
        chunk_metadata["short_summary"] = short_summary
        chunk_metadata["long_summary"] = long_summary
        chunk_metadata["summary_sections"] = summary_sections
        chunk_metadata["detail_sections"] = summary_sections
        chunk_metadata["summary_status"] = summary_status

    return chunks


def build_empty_source_metadata(title: str, domain: str) -> dict:
    """
    Hiç temiz chunk oluşmazsa kullanılacak güvenli kaynak metadata'sı.
    """

    safe_title = title or domain or "Başlıksız kaynak"
    safe_summary = "Bu kaynak için özet oluşturulamadı çünkü temiz içerik bulunamadı."

    summary_sections = [
        {
            "title": "İçerik bulunamadı",
            "content": safe_summary,
        }
    ]

    return {
        "llm_title": safe_title,
        "short_summary": safe_summary,
        "long_summary": safe_summary,
        "summary": safe_summary,
        "summary_sections": summary_sections,
        "detail_sections": summary_sections,
        "summary_status": "fallback_empty_chunks",
    }


@router.post("/ingest")
def ingest(data: IngestRequest):
    source_id = make_source_id()
    scanned_at = now_iso()
    domain = extract_domain(data.url)

    print("\n" + "=" * 80)
    print("[INGEST] Yeni kaynak alındı")
    print("=" * 80)
    print("[INGEST] Source ID:", source_id)
    print("[INGEST] Title:", data.title)
    print("[INGEST] URL:", data.url)
    print("[INGEST] Domain:", domain)
    print("[INGEST] Gelen blok sayısı:", len(data.blocks))

    raw_blocks = [block.model_dump() for block in data.blocks]

    raw_blocks = [
        block
        for block in raw_blocks
        if not is_extension_noise(block.get("text", ""))
    ]

    qc_result = apply_quality_control(raw_blocks)

    clean_blocks = qc_result["blocks"]
    qc_stats = qc_result["stats"]

    raw_chunks = semantic_chunk_blocks(clean_blocks)

    chunks = enrich_chunks(
        chunks=raw_chunks,
        title=data.title,
        url=data.url,
        source_id=source_id,
        scanned_at=scanned_at,
    )

    print("[INGEST] Kalite kontrol sonrası blok:", len(clean_blocks))
    print("[INGEST] Ham chunk sayısı:", len(raw_chunks))
    print("[INGEST] Kaydedilecek temiz chunk sayısı:", len(chunks))

    if chunks:
        source_metadata = generate_source_metadata(
            original_title=data.title,
            url=data.url,
            domain=domain,
            chunks=chunks,
        )
    else:
        source_metadata = build_empty_source_metadata(data.title, domain)

    source_metadata["summary_sections"] = normalize_summary_sections(
        source_metadata.get("summary_sections")
        or source_metadata.get("detail_sections")
        or []
    )

    source_metadata["detail_sections"] = source_metadata["summary_sections"]

    chunks = apply_source_metadata_to_chunks(
        chunks=chunks,
        source_metadata=source_metadata,
        original_title=data.title,
    )

    llm_title = source_metadata.get("llm_title") or data.title or "Başlıksız kaynak"
    short_summary = source_metadata.get("short_summary") or ""
    long_summary = source_metadata.get("long_summary") or short_summary
    summary = source_metadata.get("summary") or short_summary
    summary_sections = source_metadata.get("summary_sections") or []
    summary_status = source_metadata.get("summary_status", "unknown")

    print("[INGEST] Kaynak başlığı:", llm_title)
    print("[INGEST] Özet durumu:", summary_status)
    print("[INGEST] Başlıklı özet sayısı:", len(summary_sections))

    chunk_texts = [chunk["content"] for chunk in chunks]

    if chunk_texts:
        chunk_embeddings = generate_embeddings(chunk_texts)
        vector_store.add_documents(chunks, chunk_embeddings)
        print("[INGEST] Vector store'a kaydedilen chunk:", len(chunks))
    else:
        print("[INGEST] Embedding üretilmedi: kaydedilecek temiz chunk yok.")

    print("[INGEST] Toplam doküman:", len(vector_store.documents))
    print("[INGEST] FAISS index.ntotal:", vector_store.index.ntotal)
    print("[INGEST] Tamamlandı")
    print("=" * 80)

    return {
        "success": True,
        "source": {
            "source_id": source_id,
            "title": llm_title,
            "llm_title": llm_title,
            "original_title": data.title,
            "url": data.url,
            "domain": domain,
            "summary": summary,
            "short_summary": short_summary,
            "long_summary": long_summary,
            "summary_sections": summary_sections,
            "detail_sections": summary_sections,
            "summary_status": summary_status,
            "scanned_at": scanned_at,
            "chunk_count": len(chunks),
            "status": "ready",
        },
        "quality_control": qc_stats,
        "blocks": {
            "raw": len(data.blocks),
            "after_noise_filter": len(raw_blocks),
            "clean": len(clean_blocks),
        },
        "chunks": {
            "raw_count": len(raw_chunks),
            "count": len(chunks),
            "items": chunks,
        },
        "vector_store": {
            "stored_documents": len(vector_store.documents),
            "index_ntotal": vector_store.index.ntotal,
        },
    }