from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from typing import Optional

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

    # sadece paragraf olanları al
    paragraph_blocks = [
    b.text for b in data.blocks if (b.type or "paragraph") == "paragraph"
    ]

    print("Paragraf sayısı:", len(paragraph_blocks))

    # burada chunking yapılacak (şimdilik basit bırakıyoruz)
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
        "blocks": len(data.blocks),
        "chunks": len(chunks)
    }