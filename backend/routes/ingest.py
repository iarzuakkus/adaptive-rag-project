from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class IngestRequest(BaseModel):
    title: str
    url: str
    content: str
    chunks: Optional[List[str]] = None

@router.post("/ingest")
def ingest(data: IngestRequest):
    chunks = data.chunks if data.chunks is not None else [data.content]

    print("Yeni veri geldi:")
    print("Title:", data.title)
    print("URL:", data.url)
    print("Chunk sayısı:", len(chunks))

    return {
        "success": True,
        "message": "Veri alındı",
        "chunk_count": len(chunks)
    }