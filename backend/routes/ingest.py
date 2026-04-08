from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

router = APIRouter()

class IngestRequest(BaseModel):
    title: str
    url: str
    content: str
    chunks: List[str]

@router.post("/ingest")
def ingest(data: IngestRequest):
    print("Yeni veri geldi:")
    print("Title:", data.title)
    print("URL:", data.url)
    print("Chunk sayısı:", len(data.chunks))

    return {
        "success": True,
        "message": "Veri alındı"
    }