"""
Dosya: routes/notes.py

Görev:
- Yapılandırılmış not oluşturma endpointini yönetir.
- Frontend'den seçilen kaynakları, kişisel notları ve not tipini alır.
- Verileri note_service katmanına gönderir.
- Üretilen yapılandırılmış notu frontend'e döndürür.
- Kişisel notları embedding üreterek vector store'a kaydeder.
- Silinen kişisel notların vector store kayıtlarını kaldırır.
- Oturum kapanırken ilgili kişisel notları vector store'dan toplu siler.

Endpointler:
- POST   /notes/generate
- POST   /notes/personal
- POST   /notes/personal/clear-session
- DELETE /notes/personal/{note_id}
"""

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from services.note_service import generate_note_from_inputs
from services.personal_note_vector_service import (
    delete_personal_note_vector,
    delete_personal_notes_for_session,
    upsert_personal_note_vector,
)


router = APIRouter(
    prefix="/notes",
    tags=["notes"],
)


class NoteSourceChunk(BaseModel):
    """
    Kaynağa ait tek bir metin parçasını temsil eder.

    Frontend isterse kaynak özetine ek olarak chunk metinlerini de
    gönderebilir.
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

    summary_sections: list[dict[str, Any]] = Field(
        default_factory=list
    )

    chunks: list[NoteSourceChunk] = Field(
        default_factory=list
    )

    source_type: str = ""
    scanned_at: str = ""


class PersonalNoteInput(BaseModel):
    """
    Oluşturulacak araştırma notunda kullanılacak kişisel notu
    temsil eder.
    """

    note_id: str = ""
    title: str = ""
    text: str = ""
    created_at: str = ""


class PersonalNoteVectorRequest(BaseModel):
    """
    Vector store'a kaydedilecek kişisel not isteği.
    """

    note_id: str
    title: str = "Kişisel not"
    text: str
    session_id: str = ""
    created_at: str = ""

    @model_validator(mode="after")
    def validate_personal_note(self):
        self.note_id = str(
            self.note_id or ""
        ).strip()

        self.title = str(
            self.title or "Kişisel not"
        ).strip()

        self.text = str(
            self.text or ""
        ).strip()

        self.session_id = str(
            self.session_id or ""
        ).strip()

        self.created_at = str(
            self.created_at or ""
        ).strip()

        if not self.note_id:
            raise ValueError(
                "Kişisel not için note_id zorunludur."
            )

        if not self.text:
            raise ValueError(
                "Kişisel not metni boş olamaz."
            )

        return self


class ClearPersonalNotesRequest(BaseModel):
    """
    Oturum kapanırken vector store'dan temizlenecek
    kişisel notları temsil eder.

    session_id veya note_ids alanlarından en az biri
    gönderilmelidir.
    """

    session_id: str = ""

    note_ids: list[str] = Field(
        default_factory=list
    )

    @model_validator(mode="after")
    def validate_cleanup_input(self):
        self.session_id = str(
            self.session_id or ""
        ).strip()

        normalized_note_ids = []

        for note_id in self.note_ids:
            safe_note_id = str(
                note_id or ""
            ).strip()

            if safe_note_id:
                normalized_note_ids.append(
                    safe_note_id
                )

        self.note_ids = list(
            dict.fromkeys(normalized_note_ids)
        )

        if not self.session_id and not self.note_ids:
            raise ValueError(
                "Temizlik için session_id veya note_ids "
                "alanlarından en az biri gereklidir."
            )

        return self


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

    sources: list[NoteSource] = Field(
        default_factory=list
    )

    personal_notes: list[PersonalNoteInput] = Field(
        default_factory=list
    )

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
                "Not oluşturmak için en az bir kaynak veya "
                "kişisel not seçilmelidir."
            )

        return self


def _normalize_source(
    source: NoteSource,
) -> dict[str, Any]:
    """
    Pydantic modelini service katmanında kullanılacak
    dict yapısına dönüştürür.
    """

    source_data = source.model_dump()

    normalized_chunks = []

    for chunk in source.chunks:
        chunk_data = chunk.model_dump()

        normalized_text = str(
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
                "content": str(
                    chunk_data.get("content")
                    or normalized_text
                ).strip(),
            }
        )

    source_data["chunks"] = normalized_chunks

    return source_data


def _normalize_personal_note(
    personal_note: PersonalNoteInput,
) -> dict[str, Any]:
    """
    Kişisel not modelini service katmanına uygun
    dict yapısına dönüştürür.
    """

    note_data = personal_note.model_dump()

    note_data["note_id"] = str(
        note_data.get("note_id") or ""
    ).strip()

    note_data["text"] = str(
        note_data.get("text") or ""
    ).strip()

    note_data["title"] = str(
        note_data.get("title") or "Kişisel not"
    ).strip()

    note_data["created_at"] = str(
        note_data.get("created_at") or ""
    ).strip()

    return note_data


@router.post("/generate")
async def generate_note(
    request: GenerateNoteRequest,
):
    """
    Seçilen kaynaklardan ve kişisel notlardan
    yapılandırılmış not üretir.

    Not tipleri:
    - research_note:
      Genel araştırma notu oluşturur.

    - lecture_note:
      Ders çalışma düzenine uygun başlıklandırılmış
      not oluşturur.

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
        source_count=(
            request.source_count
            or len(sources)
        ),
        personal_note_count=(
            request.personal_note_count
            or len(personal_notes)
        ),
        session_id=request.session_id,
        force=request.force,
    )

    return result


@router.post("/personal")
def save_personal_note_to_vector_store(
    request: PersonalNoteVectorRequest,
):
    """
    Kişisel notu embedding üreterek vector store'a
    kaydeder.

    Aynı note_id daha önce kaydedilmişse mevcut kayıt
    silinir ve yeni içerikle tekrar oluşturulur.
    """

    try:
        return upsert_personal_note_vector(
            note_id=request.note_id,
            title=request.title,
            text=request.text,
            session_id=request.session_id,
            created_at=request.created_at,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    except Exception as error:
        print(
            "[NOTES ROUTE] Kişisel not vector store'a "
            "kaydedilemedi:",
            error,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Kişisel not vector hafızaya "
                "kaydedilemedi."
            ),
        ) from error


@router.post("/personal/clear-session")
def clear_personal_notes_from_session(
    request: ClearPersonalNotesRequest,
):
    """
    Oturum kapanırken ilgili kişisel notların tüm
    vector kayıtlarını toplu olarak siler.

    Silme eşleştirmesi:
    - session_id
    - note_ids

    alanlarından biri veya ikisi üzerinden yapılabilir.
    """

    try:
        return delete_personal_notes_for_session(
            session_id=request.session_id,
            note_ids=request.note_ids,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    except Exception as error:
        print(
            "[NOTES ROUTE] Oturum kişisel notları "
            "temizlenemedi:",
            error,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Oturuma ait kişisel notlar vector "
                "hafızadan temizlenemedi."
            ),
        ) from error


@router.delete("/personal/{note_id}")
def remove_personal_note_from_vector_store(
    note_id: str,
):
    """
    Belirtilen kişisel nota ait embedding ve doküman
    kaydını vector store'dan siler.
    """

    safe_note_id = str(
        note_id or ""
    ).strip()

    if not safe_note_id:
        raise HTTPException(
            status_code=400,
            detail="note_id boş olamaz.",
        )

    try:
        return delete_personal_note_vector(
            note_id=safe_note_id,
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        ) from error

    except Exception as error:
        print(
            "[NOTES ROUTE] Kişisel not vector store'dan "
            "silinemedi:",
            error,
        )

        raise HTTPException(
            status_code=500,
            detail=(
                "Kişisel not vector hafızadan "
                "silinemedi."
            ),
        ) from error