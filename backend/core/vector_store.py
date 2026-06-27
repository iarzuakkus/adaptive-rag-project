import faiss
import numpy as np
import uuid
from datetime import datetime
from urllib.parse import urlparse


class VectorStore:
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index = faiss.IndexFlatIP(dimension)
        self.documents = []

        print("\nVECTOR STORE INIT")
        print("-" * 40)
        print("Store object id:", id(self))
        print("Dimension:", self.dimension)

    def _now_iso(self) -> str:
        return datetime.now().isoformat(timespec="seconds")

    def _make_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid.uuid4().hex[:12]}"

    def _extract_domain(self, url: str) -> str:
        if not url:
            return ""

        try:
            parsed = urlparse(url)
            return parsed.netloc.replace("www.", "")
        except Exception:
            return ""

    def _public_document(self, document: dict) -> dict:
        """
        Embedding gibi iç kullanım alanlarını frontend'e veya route katmanına sızdırmamak için
        temizlenmiş chunk döndürür.
        """
        item = document.copy()
        item.pop("_embedding", None)
        return item

    def _prepare_document(self, chunk: dict, embedding: list[float], fallback_source_ids: dict) -> dict:
        now = self._now_iso()

        item = chunk.copy()

        url = item.get("url") or item.get("page_url") or ""
        title = item.get("title") or item.get("page_title") or "Başlıksız kaynak"

        source_key = url or title or "unknown_source"

        if not item.get("source_id"):
            if source_key not in fallback_source_ids:
                fallback_source_ids[source_key] = self._make_id("src")
            item["source_id"] = fallback_source_ids[source_key]

        if not item.get("chunk_id"):
            item["chunk_id"] = self._make_id("chk")

        item["title"] = title
        item["url"] = url
        item["domain"] = item.get("domain") or self._extract_domain(url)
        item["summary"] = item.get("summary") or ""
        item["status"] = item.get("status") or "ready"
        item["chunk_index"] = item.get("chunk_index", 0)
        item["scanned_at"] = item.get("scanned_at") or item.get("created_at") or now
        item["created_at"] = item.get("created_at") or now

        if not item.get("text"):
            item["text"] = item.get("content") or ""

        item["_embedding"] = np.array(embedding, dtype="float32").tolist()

        return item

    def add_documents(self, chunks: list[dict], embeddings: list[list[float]]):
        print("\nVECTOR STORE ADD DOCUMENTS")
        print("-" * 40)
        print("Store object id:", id(self))
        print("Gelen chunk sayısı:", len(chunks) if chunks else 0)
        print("Gelen embedding sayısı:", len(embeddings) if embeddings else 0)
        print("Ekleme öncesi FAISS index.ntotal:", self.index.ntotal)
        print("Ekleme öncesi documents:", len(self.documents))

        if not chunks or not embeddings:
            print("Ekleme yapılmadı: chunks veya embeddings boş.")
            return

        if len(chunks) != len(embeddings):
            raise ValueError(
                f"Chunk ve embedding sayısı eşleşmiyor. chunks={len(chunks)}, embeddings={len(embeddings)}"
            )

        vectors = np.array(embeddings).astype("float32")

        if vectors.ndim != 2:
            raise ValueError(f"Embedding matrisi 2 boyutlu olmalı. Gelen shape: {vectors.shape}")

        if vectors.shape[1] != self.dimension:
            raise ValueError(
                f"Embedding boyutu hatalı. Beklenen={self.dimension}, Gelen={vectors.shape[1]}"
            )

        fallback_source_ids = {}

        prepared_documents = []

        for chunk, embedding in zip(chunks, embeddings):
            prepared_document = self._prepare_document(
                chunk=chunk,
                embedding=embedding,
                fallback_source_ids=fallback_source_ids,
            )
            prepared_documents.append(prepared_document)

        self.index.add(vectors)
        self.documents.extend(prepared_documents)

        print("Ekleme sonrası FAISS index.ntotal:", self.index.ntotal)
        print("Ekleme sonrası documents:", len(self.documents))

    def search(self, query_embedding: list[float], top_k: int = 5) -> list[dict]:
        print("\nVECTOR STORE SEARCH")
        print("-" * 40)
        print("Store object id:", id(self))
        print("FAISS index.ntotal:", self.index.ntotal)
        print("Documents count:", len(self.documents))
        print("Top k:", top_k)

        if self.index.ntotal == 0:
            print("Arama yapılamadı: FAISS index boş.")
            return []

        if not query_embedding:
            print("Arama yapılamadı: query_embedding boş.")
            return []

        query_vector = np.array([query_embedding]).astype("float32")

        print("Query vector shape:", query_vector.shape)

        if query_vector.shape[1] != self.dimension:
            raise ValueError(
                f"Query embedding boyutu hatalı. Beklenen={self.dimension}, Gelen={query_vector.shape[1]}"
            )

        safe_top_k = min(top_k, self.index.ntotal)

        scores, indices = self.index.search(query_vector, safe_top_k)

        print("FAISS scores:", scores[0].tolist())
        print("FAISS indices:", indices[0].tolist())

        results = []

        for score, index in zip(scores[0], indices[0]):
            if index == -1:
                continue

            if index >= len(self.documents):
                print(f"Uyarı: index documents dışında kaldı. index={index}, documents={len(self.documents)}")
                continue

            item = self._public_document(self.documents[index])
            item["score"] = float(score)
            results.append(item)

        print("Dönen sonuç sayısı:", len(results))

        return results

    def get_all_documents(self, include_embeddings: bool = False) -> list[dict]:
        if include_embeddings:
            return [document.copy() for document in self.documents]

        return [self._public_document(document) for document in self.documents]

    def get_sources(self) -> list[dict]:
        sources = {}

        for document in self.documents:
            source_id = document.get("source_id")

            if not source_id:
                continue

            if source_id not in sources:
                sources[source_id] = {
                    "source_id": source_id,
                    "title": document.get("title") or "Başlıksız kaynak",
                    "url": document.get("url") or "",
                    "domain": document.get("domain") or self._extract_domain(document.get("url") or ""),
                    "summary": document.get("summary") or "",
                    "scanned_at": document.get("scanned_at") or "",
                    "chunk_count": 0,
                    "status": document.get("status") or "ready",
                }

            sources[source_id]["chunk_count"] += 1

            if document.get("summary") and not sources[source_id].get("summary"):
                sources[source_id]["summary"] = document.get("summary")

        return sorted(
            sources.values(),
            key=lambda source: source.get("scanned_at") or "",
            reverse=True,
        )

    def get_source_detail(self, source_id: str) -> dict | None:
        source_documents = [
            document for document in self.documents
            if document.get("source_id") == source_id
        ]

        if not source_documents:
            return None

        first_document = source_documents[0]

        chunks = []

        for document in source_documents:
            public_document = self._public_document(document)

            chunks.append({
                "chunk_id": public_document.get("chunk_id"),
                "source_id": public_document.get("source_id"),
                "title": public_document.get("title"),
                "url": public_document.get("url"),
                "text": public_document.get("text") or "",
                "chunk_index": public_document.get("chunk_index", 0),
                "created_at": public_document.get("created_at"),
            })

        chunks = sorted(
            chunks,
            key=lambda chunk: chunk.get("chunk_index", 0),
        )

        return {
            "source_id": source_id,
            "title": first_document.get("title") or "Başlıksız kaynak",
            "url": first_document.get("url") or "",
            "domain": first_document.get("domain") or self._extract_domain(first_document.get("url") or ""),
            "summary": first_document.get("summary") or "",
            "scanned_at": first_document.get("scanned_at") or "",
            "chunk_count": len(chunks),
            "status": first_document.get("status") or "ready",
            "chunks": chunks,
        }

    def get_source_chunks(self, source_id: str) -> list[dict]:
        detail = self.get_source_detail(source_id)

        if not detail:
            return []

        return detail.get("chunks", [])

    def get_chunk_detail(self, source_id: str, chunk_id: str) -> dict | None:
        for document in self.documents:
            if document.get("source_id") == source_id and document.get("chunk_id") == chunk_id:
                return self._public_document(document)

        return None

    def update_source_summary(self, source_id: str, summary: str) -> bool:
        updated = False

        for document in self.documents:
            if document.get("source_id") == source_id:
                document["summary"] = summary
                updated = True

        return updated

    def delete_source(self, source_id: str) -> dict:
        print("\nVECTOR STORE DELETE SOURCE")
        print("-" * 40)
        print("Silinecek source_id:", source_id)
        print("Silme öncesi documents:", len(self.documents))
        print("Silme öncesi FAISS index.ntotal:", self.index.ntotal)

        before_count = len(self.documents)

        remaining_documents = [
            document for document in self.documents
            if document.get("source_id") != source_id
        ]

        deleted_count = before_count - len(remaining_documents)

        if deleted_count == 0:
            print("Silinecek kaynak bulunamadı.")

            return {
                "deleted": False,
                "source_id": source_id,
                "deleted_chunks": 0,
                "remaining_chunks": len(self.documents),
                "index_ntotal": self.index.ntotal,
            }

        self.documents = remaining_documents
        rebuild_result = self.rebuild_index()

        print("Silme sonrası documents:", len(self.documents))
        print("Silme sonrası FAISS index.ntotal:", self.index.ntotal)

        return {
            "deleted": True,
            "source_id": source_id,
            "deleted_chunks": deleted_count,
            "remaining_chunks": len(self.documents),
            "index_ntotal": rebuild_result.get("index_ntotal", self.index.ntotal),
        }

    def rebuild_index(self) -> dict:
        print("\nVECTOR STORE REBUILD INDEX")
        print("-" * 40)
        print("Rebuild öncesi documents:", len(self.documents))

        new_index = faiss.IndexFlatIP(self.dimension)

        valid_documents = []
        vectors = []

        for document in self.documents:
            embedding = document.get("_embedding")

            if embedding is None:
                print("Uyarı: embedding olmayan document atlandı:", document.get("chunk_id"))
                continue

            vector = np.array(embedding).astype("float32")

            if vector.ndim != 1:
                print("Uyarı: embedding 1 boyutlu değil, document atlandı:", document.get("chunk_id"))
                continue

            if vector.shape[0] != self.dimension:
                print(
                    "Uyarı: embedding boyutu hatalı, document atlandı:",
                    document.get("chunk_id"),
                    "Beklenen:",
                    self.dimension,
                    "Gelen:",
                    vector.shape[0],
                )
                continue

            valid_documents.append(document)
            vectors.append(vector)

        if vectors:
            matrix = np.array(vectors).astype("float32")
            new_index.add(matrix)

        self.index = new_index
        self.documents = valid_documents

        print("Rebuild sonrası documents:", len(self.documents))
        print("Rebuild sonrası FAISS index.ntotal:", self.index.ntotal)

        return {
            "documents": len(self.documents),
            "index_ntotal": self.index.ntotal,
        }

    def count(self) -> int:
        return len(self.documents)

    def clear(self):
        self.index = faiss.IndexFlatIP(self.dimension)
        self.documents = []


vector_store = VectorStore()


def add_documents(chunks: list[dict], embeddings: list[list[float]]):
    return vector_store.add_documents(chunks, embeddings)


def search(query_embedding: list[float], top_k: int = 5) -> list[dict]:
    return vector_store.search(query_embedding, top_k)


def search_similar_chunks(query_embedding: list[float], top_k: int = 5) -> list[dict]:
    return vector_store.search(query_embedding, top_k)


def get_document_count() -> int:
    return vector_store.count()


def get_all_documents(include_embeddings: bool = False) -> list[dict]:
    return vector_store.get_all_documents(include_embeddings=include_embeddings)


def get_sources() -> list[dict]:
    return vector_store.get_sources()


def get_source_detail(source_id: str) -> dict | None:
    return vector_store.get_source_detail(source_id)


def get_source_chunks(source_id: str) -> list[dict]:
    return vector_store.get_source_chunks(source_id)


def get_chunk_detail(source_id: str, chunk_id: str) -> dict | None:
    return vector_store.get_chunk_detail(source_id, chunk_id)


def update_source_summary(source_id: str, summary: str) -> bool:
    return vector_store.update_source_summary(source_id, summary)


def delete_source(source_id: str) -> dict:
    return vector_store.delete_source(source_id)


def rebuild_index() -> dict:
    return vector_store.rebuild_index()


def clear_store():
    vector_store.clear()