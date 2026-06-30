"""
Dosya: app.py

Görev:
- Adaptive RAG backend uygulamasını başlatır.
- Tüm FastAPI route dosyalarını ana uygulamaya bağlar.
- Chrome extension tarafının backend'e istek atabilmesi için CORS ayarlarını yapar.

Çalıştırma:
backend klasörünün içindeyken:

python -m uvicorn app:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.ingest import router as ingest_router
from routes.pdf import router as pdf_router
from routes.query import router as query_router
from routes.chat import router as chat_router
from routes.sources import router as sources_router
from routes.research import router as research_router


app = FastAPI(
    title="Adaptive RAG Backend",
    description="Chrome extension için sayfa ingest, PDF, query, sources, research ve Chat RAG backend servisi.",
    version="1.0.0",
)


# Chrome extension ve local geliştirme ortamı için CORS ayarı
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Route bağlantıları
app.include_router(ingest_router)
app.include_router(pdf_router)
app.include_router(query_router)
app.include_router(chat_router)
app.include_router(sources_router)
app.include_router(research_router)


@app.get("/")
def root():
    return {
        "message": "Adaptive RAG backend çalışıyor",
        "status": "ok",
        "docs": "/docs",
        "modules": [
            "ingest",
            "pdf",
            "query",
            "chat",
            "sources",
            "research",
        ],
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "adaptive-rag-backend",
        "modules": {
            "ingest": True,
            "pdf": True,
            "query": True,
            "chat": True,
            "sources": True,
            "research": True,
        },
    }


# Backend'i çalıştırmak için:
# cd backend
# python -m uvicorn app:app --reload --port 8000