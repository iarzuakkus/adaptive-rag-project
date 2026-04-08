from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class QueryRequest(BaseModel):
    question: str

@router.post("/query")
def query(data: QueryRequest):
    return {
        "answer": f"Sorun alındı: {data.question}"
    }