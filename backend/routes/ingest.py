from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from urllib.parse import urlparse
import uuid

from services.quality_control_service import apply_quality_control
from services.chunking_service import semantic_chunk_blocks
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
    Bu metinler sayfa içeriği olmadığı için vector store'a eklenmemeli.
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


def enrich_chunks(
    chunks: list[dict],
    title: str,
    url: str,
    source_id: str,
    scanned_at: str,
) -> list[dict]:
    """
    Chunk'lara kaynak metadata bilgisi ekler.

    Her ingest isteği tek bir kaynak olarak kabul edilir.
    Bu kaynak source_id ile temsil edilir.
    Her chunk ise ayrı chunk_id taşır.
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
            "url": url,
            "domain": domain,
            "summary": "",
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
                "url": url,
                "domain": domain,
                "chunk_index": index,
                "source": "web_page",
                "scanned_at": scanned_at,
            },
        })

    return enriched


@router.post("/ingest")
def ingest(data: IngestRequest):
    print("\n" + "=" * 80)
    print("YENİ INGEST İSTEĞİ")
    print("=" * 80)

    source_id = make_source_id()
    scanned_at = now_iso()
    domain = extract_domain(data.url)

    print("Source ID:", source_id)
    print("Title:", data.title)
    print("URL:", data.url)
    print("Domain:", domain)
    print("Scanned At:", scanned_at)
    print("Gelen blok sayısı:", len(data.blocks))

    raw_blocks = [block.model_dump() for block in data.blocks]

    raw_blocks = [
        block for block in raw_blocks
        if not is_extension_noise(block.get("text", ""))
    ]

    qc_result = apply_quality_control(raw_blocks)

    clean_blocks = qc_result["blocks"]
    qc_stats = qc_result["stats"]

    print("\nQUALITY CONTROL")
    print("-" * 40)
    print("Toplam blok:", qc_stats["total_blocks"])
    print("Düşük kalite elenen:", qc_stats["removed_low_quality"])
    print("Tekrar elenen:", qc_stats["removed_duplicates"])
    print("Kalan blok:", qc_stats["kept_blocks"])

    raw_chunks = semantic_chunk_blocks(clean_blocks)

    chunks = enrich_chunks(
        chunks=raw_chunks,
        title=data.title,
        url=data.url,
        source_id=source_id,
        scanned_at=scanned_at,
    )

    print("\nSEMANTIC CHUNKING")
    print("-" * 40)
    print("Oluşturulan ham chunk sayısı:", len(raw_chunks))
    print("Kaydedilecek temiz chunk sayısı:", len(chunks))

    for chunk in chunks[:3]:
        print("\n" + "=" * 80)
        print(f"Source ID: {chunk['source_id']}")
        print(f"Chunk ID: {chunk['chunk_id']}")
        print(f"Title: {chunk['title']}")
        print(f"URL: {chunk['url']}")
        print(f"Domain: {chunk['domain']}")
        print(f"Chunk Index: {chunk['chunk_index']}")
        print(f"Sentence Count: {chunk['sentence_count']}")
        print(f"Character Count: {chunk['char_count']}")
        print("-" * 80)
        print(chunk["content"])

    chunk_texts = [chunk["content"] for chunk in chunks]

    if chunk_texts:
        chunk_embeddings = generate_embeddings(chunk_texts)
        vector_store.add_documents(chunks, chunk_embeddings)
    else:
        print("\nEmbedding üretilmedi: kaydedilecek temiz chunk yok.")

    print("\nVECTOR STORE")
    print("-" * 40)
    print("Kayıtlı doküman sayısı:", len(vector_store.documents))
    print("FAISS index.ntotal:", vector_store.index.ntotal)

    print("\nINGEST TAMAMLANDI")
    print("=" * 80)

    return {
        "success": True,
        "source": {
            "source_id": source_id,
            "title": data.title,
            "url": data.url,
            "domain": domain,
            "summary": "",
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