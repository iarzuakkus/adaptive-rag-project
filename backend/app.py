from fastapi import FastAPI
from routes.ingest import router as ingest_router
from routes.pdf import router as pdf_router
from routes.query import router as query_router

app = FastAPI()

app.include_router(ingest_router)
app.include_router(pdf_router)
app.include_router(query_router)

@app.get("/")
def root():
    return {"message": "Adaptive RAG backend çalışıyor"}



# python -m uvicorn app:app --reload
