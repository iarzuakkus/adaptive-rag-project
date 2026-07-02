"""
Dosya: services/personal_note_vector_service.py

Görev:
- Kullanıcının kişisel notlarını semantik chunk'lara ayırır.
- Her chunk için ayrı embedding üretir.
- Kişisel not chunk'larını mevcut FAISS vector store'a kaydeder.
- Aynı note_id tekrar gönderildiğinde eski chunk'ları silip günceller.
- Kişisel not silindiğinde ilgili bütün vector kayıtlarını kaldırır.
- Oturum kapanırken ilgili kişisel not chunk'larını topluca temizler.

Not:
- Kişisel notlar semantic search ve RAG tarafından bulunabilir.
- Bir kişisel nota ait bütün chunk'lar aynı source_id altında tutulur.
- Kaynaklar sekmesinde web kaynağı olarak gösterilmez.
- Vector store bellekte çalıştığı için backend yeniden
  başlatıldığında vector kayıtları temizlenir.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from core.embeddings import generate_embeddings
from core.vector_store import vector_store
from services.chunking_service import semantic_chunk_blocks


MAX_NOTE_LENGTH = 8_000
MAX_TITLE_LENGTH = 180

PERSONAL_NOTE_MAX_CHARS = 900
PERSONAL_NOTE_MIN_CHARS = 250
PERSONAL_NOTE_SIMILARITY_THRESHOLD = 0.55


def clean_text(
    value: Any,
    max_length: int | None = None,
) -> str:
    """
    Gelen değeri güvenli bir metne dönüştürür.

    max_length verilmişse metin belirlenen uzunlukta kesilir.
    """

    text = str(value or "").strip()

    if max_length and len(text) > max_length:
        return text[:max_length].rstrip()

    return text


def now_iso() -> str:
    """
    Güncel zamanı ISO formatında döndürür.
    """

    return datetime.now().isoformat(
        timespec="seconds"
    )


def build_personal_note_source_id(
    note_id: str,
) -> str:
    """
    Aynı kişisel notun bütün chunk'larını ortak bir source_id
    altında toplamak için kararlı bir kimlik oluşturur.

    Aynı source_id:
    - not güncellemesinde eski chunk'ların bulunmasını,
    - not silinmesinde bütün chunk'ların kaldırılmasını sağlar.
    """

    safe_note_id = clean_text(
        note_id,
        240,
    )

    if not safe_note_id:
        raise ValueError(
            "note_id boş olamaz."
        )

    return f"personal_note_{safe_note_id}"


def build_personal_note_chunk_id(
    note_id: str,
    chunk_index: int,
) -> str:
    """
    Kişisel notun her semantik parçası için benzersiz ve
    kararlı bir chunk_id oluşturur.
    """

    source_id = build_personal_note_source_id(
        note_id
    )

    return (
        f"{source_id}_chk_"
        f"{chunk_index:04d}"
    )


def build_personal_note_url(
    note_id: str,
) -> str:
    """
    Kişisel notlar için gerçek bir web adresi yerine dahili
    kaynak referansı oluşturur.

    Bu değer kişisel notun web kaynağı olarak listelenmesine
    neden olmaz. Ancak chat ve prompt katmanlarının boş URL
    nedeniyle notu yok saymasını önlemeye yardımcı olur.
    """

    safe_note_id = clean_text(
        note_id,
        240,
    )

    return (
        "memorai://personal-note/"
        f"{safe_note_id}"
    )


def build_embedding_text(
    title: str,
    chunk_text: str,
) -> str:
    """
    Başlığın semantic aramaya katkı sağlaması için her chunk
    embedding'ine başlık ve ilgili chunk metni birlikte gönderilir.
    """

    safe_title = clean_text(
        title,
        MAX_TITLE_LENGTH,
    )

    safe_chunk_text = clean_text(
        chunk_text,
        MAX_NOTE_LENGTH,
    )

    if safe_title:
        return (
            f"{safe_title}\n\n"
            f"{safe_chunk_text}"
        )

    return safe_chunk_text


def create_fallback_chunk(
    text: str,
) -> dict[str, Any]:
    """
    Semantik chunk servisi herhangi bir sonuç üretmezse kişisel
    notun tamamen kaybolmaması için tek parçalık chunk oluşturur.
    """

    safe_text = clean_text(
        text,
        MAX_NOTE_LENGTH,
    )

    return {
        "chunk_id": 0,
        "text": safe_text,
        "char_count": len(safe_text),
        "sentence_count": 1,
        "sources": [
            {
                "block_index": 0,
                "type": "personal_note",
            }
        ],
    }


def create_personal_note_chunks(
    text: str,
) -> list[dict[str, Any]]:
    """
    Kişisel not metnini mevcut semantic chunking servisini
    kullanarak anlamlı parçalara böler.

    Bölme kararında:
    - cümle embedding benzerliği,
    - minimum chunk uzunluğu,
    - maksimum chunk uzunluğu

    birlikte değerlendirilir.
    """

    safe_text = clean_text(
        text,
        MAX_NOTE_LENGTH,
    )

    if not safe_text:
        return []

    blocks = [
        {
            "text": safe_text,
            "type": "personal_note",
        }
    ]

    semantic_chunks = semantic_chunk_blocks(
        blocks=blocks,
        max_chars=PERSONAL_NOTE_MAX_CHARS,
        min_chars=PERSONAL_NOTE_MIN_CHARS,
        similarity_threshold=(
            PERSONAL_NOTE_SIMILARITY_THRESHOLD
        ),
    )

    semantic_chunks = [
        chunk
        for chunk in semantic_chunks
        if clean_text(chunk.get("text"))
    ]

    if semantic_chunks:
        return semantic_chunks

    return [
        create_fallback_chunk(safe_text)
    ]


def build_personal_note_documents(
    note_id: str,
    title: str,
    text: str,
    session_id: str = "",
    created_at: str = "",
) -> list[dict[str, Any]]:
    """
    Kişisel notu semantik chunk'lara ayırır ve her chunk için
    vector store'a uygun document yapısı üretir.
    """

    safe_note_id = clean_text(
        note_id,
        240,
    )

    safe_title = (
        clean_text(
            title,
            MAX_TITLE_LENGTH,
        )
        or "Kişisel not"
    )

    safe_text = clean_text(
        text,
        MAX_NOTE_LENGTH,
    )

    safe_session_id = clean_text(
        session_id,
        240,
    )

    safe_created_at = (
        clean_text(created_at, 100)
        or now_iso()
    )

    if not safe_note_id:
        raise ValueError(
            "note_id boş olamaz."
        )

    if not safe_text:
        raise ValueError(
            "Kişisel not metni boş olamaz."
        )

    source_id = build_personal_note_source_id(
        safe_note_id
    )

    personal_note_url = build_personal_note_url(
        safe_note_id
    )

    semantic_chunks = create_personal_note_chunks(
        safe_text
    )

    if not semantic_chunks:
        raise ValueError(
            "Kişisel not için semantik chunk üretilemedi."
        )

    chunk_count = len(semantic_chunks)
    documents = []

    for chunk_index, semantic_chunk in enumerate(
        semantic_chunks
    ):
        chunk_text = clean_text(
            semantic_chunk.get("text"),
            MAX_NOTE_LENGTH,
        )

        if not chunk_text:
            continue

        chunk_id = build_personal_note_chunk_id(
            note_id=safe_note_id,
            chunk_index=chunk_index,
        )

        short_summary = clean_text(
            chunk_text,
            240,
        )

        sentence_count = int(
            semantic_chunk.get("sentence_count")
            or 0
        )

        char_count = int(
            semantic_chunk.get("char_count")
            or len(chunk_text)
        )

        chunk_sources = (
            semantic_chunk.get("sources")
            if isinstance(
                semantic_chunk.get("sources"),
                list,
            )
            else []
        )

        document = {
            "id": chunk_id,
            "source_id": source_id,
            "chunk_id": chunk_id,

            "document_type": "personal_note",
            "source_type": "personal_note",
            "source": "personal_note",

            "note_id": safe_note_id,
            "session_id": safe_session_id,

            "title": safe_title,
            "llm_title": safe_title,
            "original_title": safe_title,

            "url": personal_note_url,
            "domain": "Kişisel not",

            "summary": short_summary,
            "short_summary": short_summary,
            "long_summary": chunk_text,
            "summary_sections": [],
            "detail_sections": [],
            "summary_status": "personal_note",

            "status": "ready",

            "content": chunk_text,
            "text": chunk_text,
            "chunk_text": chunk_text,

            "chunk_index": chunk_index,
            "chunk_count": chunk_count,

            "sentence_count": sentence_count,
            "char_count": char_count,
            "sources": chunk_sources,

            "scanned_at": safe_created_at,
            "created_at": safe_created_at,

            "metadata": {
                "source_id": source_id,
                "chunk_id": chunk_id,

                "document_type": "personal_note",
                "source_type": "personal_note",
                "source": "personal_note",

                "note_id": safe_note_id,
                "session_id": safe_session_id,

                "title": safe_title,
                "llm_title": safe_title,
                "original_title": safe_title,

                "url": personal_note_url,
                "domain": "Kişisel not",

                "summary": short_summary,
                "short_summary": short_summary,
                "long_summary": chunk_text,
                "summary_sections": [],
                "detail_sections": [],
                "summary_status": "personal_note",

                "chunk_index": chunk_index,
                "chunk_count": chunk_count,

                "sentence_count": sentence_count,
                "char_count": char_count,
                "sources": chunk_sources,

                "scanned_at": safe_created_at,
                "created_at": safe_created_at,
            },
        }

        documents.append(document)

    if not documents:
        raise ValueError(
            "Kişisel not için geçerli document oluşturulamadı."
        )

    return documents


def upsert_personal_note_vector(
    note_id: str,
    title: str,
    text: str,
    session_id: str = "",
    created_at: str = "",
) -> dict[str, Any]:
    """
    Kişisel notu semantik chunk'lara ayırarak vector store'a ekler.

    Aynı note_id daha önce kaydedilmişse aynı source_id altındaki
    bütün eski chunk'lar önce silinir. Ardından yeni chunk'lar ve
    embedding'ler kaydedilir.
    """

    documents = build_personal_note_documents(
        note_id=note_id,
        title=title,
        text=text,
        session_id=session_id,
        created_at=created_at,
    )

    source_id = documents[0]["source_id"]

    existing_documents = [
        item
        for item in vector_store.documents
        if item.get("source_id") == source_id
    ]

    replaced = bool(existing_documents)

    if replaced:
        vector_store.delete_source(
            source_id
        )

    embedding_texts = [
        build_embedding_text(
            title=document["title"],
            chunk_text=document["text"],
        )
        for document in documents
    ]

    embeddings = generate_embeddings(
        embedding_texts
    )

    if len(embeddings) != len(documents):
        raise RuntimeError(
            "Kişisel not chunk ve embedding sayıları "
            "birbiriyle eşleşmiyor."
        )

    vector_store.add_documents(
        chunks=documents,
        embeddings=embeddings,
    )

    return {
        "success": True,
        "status": "ok",
        "action": (
            "updated"
            if replaced
            else "created"
        ),

        "note_id": documents[0]["note_id"],
        "source_id": source_id,

        "chunk_id": documents[0]["chunk_id"],
        "chunk_ids": [
            document["chunk_id"]
            for document in documents
        ],
        "chunk_count": len(documents),

        "document_type": "personal_note",

        "stored_documents": len(
            vector_store.documents
        ),

        "index_ntotal": (
            vector_store.index.ntotal
        ),

        "created_at": documents[0]["created_at"],
    }


def delete_personal_note_vector(
    note_id: str,
) -> dict[str, Any]:
    """
    Kişisel nota ait bütün semantic chunk ve embedding
    kayıtlarını vector store'dan siler.
    """

    safe_note_id = clean_text(
        note_id,
        240,
    )

    if not safe_note_id:
        raise ValueError(
            "note_id boş olamaz."
        )

    source_id = build_personal_note_source_id(
        safe_note_id
    )

    delete_result = vector_store.delete_source(
        source_id
    )

    return {
        "success": True,

        "status": (
            "deleted"
            if delete_result.get("deleted")
            else "not_found"
        ),

        "note_id": safe_note_id,
        "source_id": source_id,

        "deleted": bool(
            delete_result.get("deleted")
        ),

        "deleted_chunks": int(
            delete_result.get("deleted_chunks")
            or 0
        ),

        "remaining_documents": len(
            vector_store.documents
        ),

        "index_ntotal": (
            vector_store.index.ntotal
        ),
    }


def delete_personal_notes_for_session(
    session_id: str = "",
    note_ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Oturum kapanırken o oturuma ait kişisel not chunk'larını
    vector store'dan toplu olarak siler.

    session_id bulunamazsa frontend'den gönderilen note_ids
    listesi yedek eşleştirme olarak kullanılır.
    """

    safe_session_id = clean_text(
        session_id,
        240,
    )

    safe_note_ids = {
        clean_text(note_id, 240)
        for note_id in (note_ids or [])
        if clean_text(note_id, 240)
    }

    if not safe_session_id and not safe_note_ids:
        raise ValueError(
            "Toplu kişisel not temizliği için session_id "
            "veya note_ids gereklidir."
        )

    print("\nPERSONAL NOTE SESSION CLEANUP")
    print("-" * 40)
    print("Session ID:", safe_session_id)
    print(
        "Gönderilen note ID sayısı:",
        len(safe_note_ids),
    )
    print(
        "Temizlik öncesi documents:",
        len(vector_store.documents),
    )
    print(
        "Temizlik öncesi index.ntotal:",
        vector_store.index.ntotal,
    )

    remaining_documents = []
    deleted_note_ids = []
    deleted_documents = 0

    for document in vector_store.documents:
        metadata = (
            document.get("metadata")
            or {}
        )

        document_type = clean_text(
            document.get("document_type")
            or metadata.get("document_type")
        ).lower()

        document_note_id = clean_text(
            document.get("note_id")
            or metadata.get("note_id"),
            240,
        )

        document_session_id = clean_text(
            document.get("session_id")
            or metadata.get("session_id"),
            240,
        )

        is_personal_note = (
            document_type == "personal_note"
        )

        matches_session = bool(
            safe_session_id
            and document_session_id
            == safe_session_id
        )

        matches_note_id = bool(
            document_note_id
            and document_note_id
            in safe_note_ids
        )

        should_delete = (
            is_personal_note
            and (
                matches_session
                or matches_note_id
            )
        )

        if should_delete:
            deleted_documents += 1

            if document_note_id:
                deleted_note_ids.append(
                    document_note_id
                )

            continue

        remaining_documents.append(
            document
        )

    if deleted_documents:
        vector_store.documents = (
            remaining_documents
        )

        rebuild_result = (
            vector_store.rebuild_index()
        )
    else:
        rebuild_result = {
            "documents": len(
                vector_store.documents
            ),
            "index_ntotal": (
                vector_store.index.ntotal
            ),
        }

    unique_deleted_note_ids = list(
        dict.fromkeys(deleted_note_ids)
    )

    print(
        "Silinen document:",
        deleted_documents,
    )
    print(
        "Silinen kişisel not:",
        len(unique_deleted_note_ids),
    )
    print(
        "Temizlik sonrası documents:",
        len(vector_store.documents),
    )
    print(
        "Temizlik sonrası index.ntotal:",
        vector_store.index.ntotal,
    )

    return {
        "success": True,

        "status": (
            "deleted"
            if deleted_documents
            else "not_found"
        ),

        "session_id": safe_session_id,
        "deleted": deleted_documents > 0,

        "deleted_documents": (
            deleted_documents
        ),

        "deleted_note_count": len(
            unique_deleted_note_ids
        ),

        "deleted_note_ids": (
            unique_deleted_note_ids
        ),

        "remaining_documents": len(
            vector_store.documents
        ),

        "index_ntotal": rebuild_result.get(
            "index_ntotal",
            vector_store.index.ntotal,
        ),
    }