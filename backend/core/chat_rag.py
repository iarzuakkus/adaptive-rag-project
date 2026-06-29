"""
Dosya: core/chat_rag.py

Görev:
- Chat V1 için geriye uyumlu giriş noktası sağlar.
- routes/chat.py dosyasının mevcut import yapısını bozmaz.
- Gerçek chat akışını core/chat/orchestrator.py dosyasına devreder.

Not:
Bu dosya bilinçli olarak küçük tutulur.
Yeni chat özellikleri doğrudan burada büyütülmez.
"""

from typing import Optional

from core.chat.orchestrator import answer_chat as orchestrator_answer_chat


def answer_chat(
    question: str,
    top_k: int = 5,
    page_url: Optional[str] = None,
    page_title: Optional[str] = None,
    scope: Optional[str] = "auto",
) -> dict:
    """
    Chat endpoint'i tarafından çağrılan geriye uyumlu fonksiyon.

    Asıl iş:
    - intent algılama
    - source navigation
    - retriever
    - RAG prompt
    - LLM cevabı
    - response payload

    core/chat/orchestrator.py içinde yapılır.
    """

    return orchestrator_answer_chat(
        question=question,
        top_k=top_k,
        page_url=page_url,
        page_title=page_title,
        scope=scope,
    )