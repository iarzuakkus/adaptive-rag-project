from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

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


@router.post("/ingest")
def ingest(data: IngestRequest):
    print("\n" + "=" * 80)
    print("YENİ INGEST İSTEĞİ")
    print("=" * 80)

    print("Title:", data.title)
    print("URL:", data.url)
    print("Gelen blok sayısı:", len(data.blocks))

    raw_blocks = [block.model_dump() for block in data.blocks]

    qc_result = apply_quality_control(raw_blocks)

    clean_blocks = qc_result["blocks"]
    qc_stats = qc_result["stats"]

    print("\nQUALITY CONTROL")
    print("-" * 40)
    print("Toplam blok:", qc_stats["total_blocks"])
    print("Düşük kalite elenen:", qc_stats["removed_low_quality"])
    print("Tekrar elenen:", qc_stats["removed_duplicates"])
    print("Kalan blok:", qc_stats["kept_blocks"])

    chunks = semantic_chunk_blocks(clean_blocks)

    print("\nSEMANTIC CHUNKING")
    print("-" * 40)
    print("Oluşturulan chunk sayısı:", len(chunks))

    for chunk in chunks[:3]:
        print("\n" + "=" * 80)
        print(f"Chunk ID: {chunk['chunk_id']}")
        print(f"Sentence Count: {chunk['sentence_count']}")
        print(f"Character Count: {chunk['char_count']}")
        print("-" * 80)
        print(chunk["text"])

    chunk_texts = [chunk["text"] for chunk in chunks]

    if chunk_texts:
        chunk_embeddings = generate_embeddings(chunk_texts)
        vector_store.add_documents(chunks, chunk_embeddings)

    print("\nVECTOR STORE")
    print("-" * 40)
    print("Kayıtlı doküman sayısı:", len(vector_store.documents))

    print("\nINGEST TAMAMLANDI")
    print("=" * 80)

    return {
        "success": True,
        "title": data.title,
        "url": data.url,
        "quality_control": qc_stats,
        "blocks": {
            "raw": len(data.blocks),
            "clean": len(clean_blocks)
        },
        "chunks": {
            "count": len(chunks),
            "items": chunks
        },
        "vector_store": {
            "stored_documents": len(vector_store.documents)
        }
    }