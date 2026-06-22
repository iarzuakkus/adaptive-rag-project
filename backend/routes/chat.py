"""
Dosya: routes/chat.py

Görev:
- Extension tarafındaki chat ekranından gelen soruları alır.
- RAG pipeline üzerinden cevap üretir.
- Cevapla birlikte kullanılan kaynakları frontend'e döndürür.
- Extension tarafından otomatik gönderilen aktif sayfa bağlamını alır:
  page_url, page_title, scope.
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

    # Extension bu alanları otomatik gönderecek.
    # Kullanıcı chat ekranında sadece doğal dilde soru soracak.
    page_url: Optional[str] = None
    page_title: Optional[str] = None

    # auto:
    # - "bu sayfa" gibi sorularda current_page
    # - "taradığım kaynaklar" gibi sorularda all_sources
    # - konu bazlı sorularda topic_sources gibi yorumlanacak.
    scope: Optional[str] = "auto"

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
    Chat endpoint.

    Örnek request:
    {
        "question": "Bu sayfa ne anlatıyor?",
        "page_url": "https://example.com",
        "page_title": "Örnek Sayfa Başlığı",
        "scope": "auto",
        "top_k": 5
    }

    Not:
    Kullanıcı page_url, page_title veya scope yazmaz.
    Bu bilgiler extension tarafından arka planda otomatik gönderilir.
    """

    result = answer_chat(
        question=request.question,
        top_k=request.top_k,
        page_url=request.page_url,
        page_title=request.page_title,
        scope=request.scope,
    )

    return result