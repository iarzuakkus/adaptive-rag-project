from fastapi import APIRouter

router = APIRouter()

@router.post("/pdf")
def handle_pdf():
    return {"message": "PDF endpoint hazır"}