from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

from services.quality_control_service import apply_quality_control

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
    print("Yeni veri geldi:")
    print("Title:", data.title)
    print("URL:", data.url)
    print("Block sayısı:", len(data.blocks))

    raw_blocks = [block.model_dump() for block in data.blocks]

    qc_result = apply_quality_control(raw_blocks)

    clean_blocks = qc_result["blocks"]
    qc_stats = qc_result["stats"]

    print("QC toplam blok:", qc_stats["total_blocks"])
    print("QC düşük kalite elenen:", qc_stats["removed_low_quality"])
    print("QC tekrar elenen:", qc_stats["removed_duplicates"])
    print("QC kalan blok:", qc_stats["kept_blocks"])

    paragraph_blocks = [
        block["text"]
        for block in clean_blocks
        if (block.get("type") or "paragraph") == "paragraph"
    ]

    print("Temiz paragraf sayısı:", len(paragraph_blocks))

    chunks = []

    for text in paragraph_blocks:
        words = text.split()
        chunk_size = 100

        for i in range(0, len(words), chunk_size):
            chunk = " ".join(words[i:i + chunk_size])
            chunks.append(chunk)

    print("Chunk sayısı:", len(chunks))

    return {
        "success": True,
        "title": data.title,
        "url": data.url,
        "quality_control": qc_stats,
        "blocks": {
            "raw": len(data.blocks),
            "clean": len(clean_blocks)
        },
        "chunks": len(chunks)
    }