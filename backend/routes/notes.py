"""
Dosya: routes/notes.py

Görev:
- Not oluşturma endpointlerini yönetir.
- Frontend'den seçilen kaynakları, kişisel notları ve not tipini alır.
- Verileri note_service katmanına gönderir.
- Üretilen yapılandırılmış notu frontend'e döndürür.

Endpointler:
- POST /notes/generate
"""

from typing import Any, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator

from services.note_service import generate_note_from_inputs


router = APIRouter(
    prefix="/notes",
    tags=["notes"],
)


class NoteSourceChunk(BaseModel):
    """
    Kaynağa ait tek bir metin parçasını temsil eder.

    Frontend isterse kaynak özetine ek olarak chunk metinlerini de gönderebilir.
    """

    chunk_id: str = ""
    text: str = ""
    content: str = ""
    score: Optional[float] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class NoteSource(BaseModel):
    """
    Not üretiminde kullanılacak taranmış kaynağı temsil eder.
    """

    source_id: str = ""
    title: str = ""
    url: str = ""
    domain: str = ""

    summary: str = ""
    short_summary: str = ""
    long_summary: str = ""

    summary_sections: list[dict[str, Any]] = Field(default_factory=list)
    chunks: list[NoteSourceChunk] = Field(default_factory=list)

    source_type: str = ""
    scanned_at: str = ""


class PersonalNoteInput(BaseModel):
    """
    Kullanıcının Notlar sekmesinden seçtiği kişisel notu temsil eder.
    """

    note_id: str = ""
    title: str = ""
    text: str = ""
    created_at: str = ""


class GenerateNoteRequest(BaseModel):
    """
    Yapılandırılmış not oluşturma isteği.
    """

    note_type: Literal[
        "research_note",
        "lecture_note",
        "summary_note",
    ] = "research_note"

    custom_title: str = ""
    language: str = "tr"

    sources: list[NoteSource] = Field(default_factory=list)
    personal_notes: list[PersonalNoteInput] = Field(default_factory=list)

    source_count: int = 0
    personal_note_count: int = 0

    session_id: str = ""
    force: bool = False

    @model_validator(mode="after")
    def validate_note_inputs(self):
        """
        En az bir kaynak veya kişisel not seçilmiş olmalıdır.
        """

        if not self.sources and not self.personal_notes:
            raise ValueError(
                "Not oluşturmak için en az bir kaynak veya kişisel not seçilmelidir."
            )

        return self


def _normalize_source(source: NoteSource) -> dict[str, Any]:
    """
    Pydantic modelini service katmanında kullanılacak dict yapısına dönüştürür.
    """

    source_data = source.model_dump()

    normalized_chunks = []

    for chunk in source.chunks:
        chunk_data = chunk.model_dump()

        normalized_text = (
            chunk_data.get("text")
            or chunk_data.get("content")
            or ""
        ).strip()

        if not normalized_text:
            continue

        normalized_chunks.append(
            {
                **chunk_data,
                "text": normalized_text,
            }
        )

    source_data["chunks"] = normalized_chunks

    return source_data


def _normalize_personal_note(
    personal_note: PersonalNoteInput,
) -> dict[str, Any]:
    """
    Kişisel not modelini service katmanına uygun dict yapısına dönüştürür.
    """

    note_data = personal_note.model_dump()

    note_data["text"] = str(
        note_data.get("text") or ""
    ).strip()

    note_data["title"] = str(
        note_data.get("title") or "Kişisel not"
    ).strip()

    return note_data


@router.post("/generate")
async def generate_note(request: GenerateNoteRequest):
    """
    Seçilen kaynaklardan ve kişisel notlardan yapılandırılmış not üretir.

    Not tipleri:
    - research_note:
      Genel araştırma notu oluşturur.

    - lecture_note:
      Ders çalışma düzenine uygun başlıklandırılmış not oluşturur.

    - summary_note:
      Daha kısa ve hızlı okunabilir bir özet üretir.
    """

    sources = [
        _normalize_source(source)
        for source in request.sources
    ]

    personal_notes = [
        _normalize_personal_note(personal_note)
        for personal_note in request.personal_notes
    ]

    result = await generate_note_from_inputs(
        note_type=request.note_type,
        custom_title=request.custom_title,
        language=request.language,
        sources=sources,
        personal_notes=personal_notes,
        source_count=request.source_count or len(sources),
        personal_note_count=(
            request.personal_note_count
            or len(personal_notes)
        ),
        session_id=request.session_id,
        force=request.force,
    )

    return result