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
    ]

    return any(phrase in lower_text for phrase in noise_phrases)


def enrich_chunks(chunks: list[dict], title: str, url: str) -> list[dict]:
    """
    Chunk'lara kaynak metadata bilgisi ekler.
    Böylece chat cevabında source title/url boş gelmez.
    """

    enriched = []

    for index, chunk in enumerate(chunks):
        text = chunk.get("text") or chunk.get("content") or ""

        if is_extension_noise(text):
            continue

        enriched.append({
            "id": chunk.get("id") or chunk.get("chunk_id") or index,
            "chunk_id": chunk.get("chunk_id", index),
            "title": title,
            "url": url,
            "content": text,
            "text": text,
            "sentence_count": chunk.get("sentence_count", 0),
            "char_count": chunk.get("char_count", len(text)),
            "metadata": {
                "title": title,
                "url": url,
                "chunk_id": chunk.get("chunk_id", index),
                "source": "web_page",
            },
        })

    return enriched


@router.post("/ingest")
def ingest(data: IngestRequest):
    print("\n" + "=" * 80)
    print("YENİ INGEST İSTEĞİ")
    print("=" * 80)

    print("Title:", data.title)
    print("URL:", data.url)
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
    )

    print("\nSEMANTIC CHUNKING")
    print("-" * 40)
    print("Oluşturulan ham chunk sayısı:", len(raw_chunks))
    print("Kaydedilecek temiz chunk sayısı:", len(chunks))

    for chunk in chunks[:3]:
        print("\n" + "=" * 80)
        print(f"Chunk ID: {chunk['chunk_id']}")
        print(f"Title: {chunk['title']}")
        print(f"URL: {chunk['url']}")
        print(f"Sentence Count: {chunk['sentence_count']}")
        print(f"Character Count: {chunk['char_count']}")
        print("-" * 80)
        print(chunk["content"])

    chunk_texts = [chunk["content"] for chunk in chunks]

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
        },
    }