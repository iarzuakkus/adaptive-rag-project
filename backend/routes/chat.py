"""
Dosya: routes/chat.py

Görev:
- Extension tarafındaki chat ekranından gelen soruları alır.
- RAG pipeline üzerinden cevap üretir.
- Cevapla birlikte kullanılan kaynakları frontend'e döndürür.
"""

from typing import Optional, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.chat_rag import answer_chat


router = APIRouter(
    prefix="/chat",
    tags=["Chat"],
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)
    page_url: Optional[str] = None
    top_k: int = 5


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]
    source_count: int
    status: str
    error: Optional[str] = None


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest):
    """
    Chat V1 endpoint.

    Örnek request:
    {
        "question": "Bu sayfa ne anlatıyor?",
        "page_url": "https://example.com",
        "top_k": 5
    }
    """

    result = answer_chat(
        question=request.question,
        page_url=request.page_url,
        top_k=request.top_k,
    )

    return result