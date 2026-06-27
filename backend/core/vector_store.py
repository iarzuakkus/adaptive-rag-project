""" Dosya: core/vector_store.py 
Görev: 
- Chunk dokümanlarını ve embedding vektörlerini bellekte yönetir. 
- FAISS IndexFlatIP kullanarak semantic search yapar. 
- Taranan kaynakları source_id bazında gruplayarak kaynak listesi üretir. 
- Tekil kaynak detayı, chunk listesi ve chunk detayı döndürür. 
- Kaynak silme işleminden sonra FAISS index'ini yeniden kurar. 
- Chunk metadata içindeki LLM başlığı, kısa özet ve geniş özet alanlarını korur. Saklanan temel alanlar: 
- source_id 
- chunk_id 
- title 
- llm_title 
- original_title 
- url 
- domain 
- summary 
- short_summary 
- long_summary 
- summary_status 
- content 
- text 
- scanned_at 
- created_at 
- _embedding 
Not: 
- _embedding alanı iç kullanım içindir. 
- Frontend veya route katmanına dönerken _embedding gizlenir. 
- Bu store şu an bellekte çalışır; backend yeniden başlatıldığında kayıtlar sıfırlanır. 
- İleride kalıcı veritabanı veya dosya tabanlı storage ile değiştirilebilir. 
"""
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

    def _normalize_title(self, document: dict) -> str:
        return (
            document.get("llm_title")
            or document.get("title")
            or document.get("original_title")
            or document.get("page_title")
            or "Başlıksız kaynak"
        )

    def _normalize_original_title(self, document: dict) -> str:
        return (
            document.get("original_title")
            or document.get("page_title")
            or document.get("title")
            or ""
        )

    def _normalize_summary_fields(self, document: dict) -> dict:
        short_summary = (
            document.get("short_summary")
            or document.get("summary")
            or ""
        )

        long_summary = (
            document.get("long_summary")
            or document.get("detail_summary")
            or document.get("summary")
            or short_summary
            or ""
        )

        summary = (
            document.get("summary")
            or short_summary
            or ""
        )

        return {
            "summary": summary,
            "short_summary": short_summary,
            "long_summary": long_summary,
            "summary_status": document.get("summary_status") or "unknown",
        }

    def _prepare_document(
        self,
        chunk: dict,
        embedding: list[float],
        fallback_source_ids: dict,
    ) -> dict:
        """
        Vector store'a eklenecek chunk dokümanını standart hale getirir.

        Bu aşamada:
        - source_id yoksa üretilir.
        - chunk_id yoksa üretilir.
        - LLM başlığı ve özet alanları korunur.
        - metadata alanı frontend ve retriever için güncellenir.
        - embedding dokümanın içine _embedding olarak eklenir.
        """

        now = self._now_iso()

        item = chunk.copy()

        url = item.get("url") or item.get("page_url") or ""
        domain = item.get("domain") or self._extract_domain(url)

        original_title = self._normalize_original_title(item)
        llm_title = self._normalize_title(item)

        source_key = url or original_title or llm_title or "unknown_source"

        if not item.get("source_id"):
            if source_key not in fallback_source_ids:
                fallback_source_ids[source_key] = self._make_id("src")
            item["source_id"] = fallback_source_ids[source_key]

        if not item.get("chunk_id"):
            item["chunk_id"] = self._make_id("chk")

        summary_fields = self._normalize_summary_fields(item)

        item["title"] = llm_title
        item["llm_title"] = llm_title
        item["original_title"] = original_title
        item["url"] = url
        item["domain"] = domain
        item["summary"] = summary_fields["summary"]
        item["short_summary"] = summary_fields["short_summary"]
        item["long_summary"] = summary_fields["long_summary"]
        item["summary_status"] = summary_fields["summary_status"]
        item["status"] = item.get("status") or "ready"
        item["chunk_index"] = item.get("chunk_index", 0)
        item["scanned_at"] = item.get("scanned_at") or item.get("created_at") or now
        item["created_at"] = item.get("created_at") or now

        if not item.get("text"):
            item["text"] = item.get("content") or ""

        if not item.get("content"):
            item["content"] = item.get("text") or ""

        metadata = item.get("metadata") or {}

        metadata["source_id"] = item["source_id"]
        metadata["chunk_id"] = item["chunk_id"]
        metadata["title"] = llm_title
        metadata["llm_title"] = llm_title
        metadata["original_title"] = original_title
        metadata["url"] = url
        metadata["domain"] = domain
        metadata["summary"] = summary_fields["summary"]
        metadata["short_summary"] = summary_fields["short_summary"]
        metadata["long_summary"] = summary_fields["long_summary"]
        metadata["summary_status"] = summary_fields["summary_status"]
        metadata["chunk_index"] = item["chunk_index"]
        metadata["source"] = metadata.get("source") or "web_page"
        metadata["scanned_at"] = item["scanned_at"]

        item["metadata"] = metadata
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
            raise ValueError(
                f"Embedding matrisi 2 boyutlu olmalı. Gelen shape: {vectors.shape}"
            )

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
                print(
                    f"Uyarı: index documents dışında kaldı. index={index}, documents={len(self.documents)}"
                )
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
        """
        Vector store içindeki chunk'ları source_id bazında gruplayarak
        frontend kaynak kartları için kaynak listesi üretir.
        """

        sources = {}

        for document in self.documents:
            source_id = document.get("source_id")

            if not source_id:
                continue

            title = self._normalize_title(document)
            original_title = self._normalize_original_title(document)
            summary_fields = self._normalize_summary_fields(document)

            if source_id not in sources:
                sources[source_id] = {
                    "source_id": source_id,
                    "title": title,
                    "llm_title": title,
                    "original_title": original_title,
                    "url": document.get("url") or "",
                    "domain": document.get("domain") or self._extract_domain(document.get("url") or ""),
                    "summary": summary_fields["summary"],
                    "short_summary": summary_fields["short_summary"],
                    "long_summary": summary_fields["long_summary"],
                    "summary_status": summary_fields["summary_status"],
                    "scanned_at": document.get("scanned_at") or "",
                    "chunk_count": 0,
                    "status": document.get("status") or "ready",
                }

            sources[source_id]["chunk_count"] += 1

            if title and sources[source_id].get("title") == "Başlıksız kaynak":
                sources[source_id]["title"] = title
                sources[source_id]["llm_title"] = title

            if original_title and not sources[source_id].get("original_title"):
                sources[source_id]["original_title"] = original_title

            if summary_fields["summary"] and not sources[source_id].get("summary"):
                sources[source_id]["summary"] = summary_fields["summary"]

            if summary_fields["short_summary"] and not sources[source_id].get("short_summary"):
                sources[source_id]["short_summary"] = summary_fields["short_summary"]

            if summary_fields["long_summary"] and not sources[source_id].get("long_summary"):
                sources[source_id]["long_summary"] = summary_fields["long_summary"]

            if (
                summary_fields["summary_status"]
                and sources[source_id].get("summary_status") == "unknown"
            ):
                sources[source_id]["summary_status"] = summary_fields["summary_status"]

        return sorted(
            sources.values(),
            key=lambda source: source.get("scanned_at") or "",
            reverse=True,
        )

    def get_source_detail(self, source_id: str) -> dict | None:
        """
        Tek bir kaynağın detayını döndürür.

        Detay ekranı için:
        - LLM başlığı
        - kısa özet
        - geniş özet
        - chunk listesi
        birlikte döner.
        """

        source_documents = [
            document
            for document in self.documents
            if document.get("source_id") == source_id
        ]

        if not source_documents:
            return None

        first_document = source_documents[0]

        title = self._normalize_title(first_document)
        original_title = self._normalize_original_title(first_document)
        summary_fields = self._normalize_summary_fields(first_document)

        chunks = []

        for document in source_documents:
            public_document = self._public_document(document)
            chunk_summary_fields = self._normalize_summary_fields(public_document)

            chunks.append({
                "chunk_id": public_document.get("chunk_id"),
                "source_id": public_document.get("source_id"),
                "title": self._normalize_title(public_document),
                "llm_title": public_document.get("llm_title") or self._normalize_title(public_document),
                "original_title": self._normalize_original_title(public_document),
                "url": public_document.get("url"),
                "domain": public_document.get("domain") or "",
                "summary": chunk_summary_fields["summary"],
                "short_summary": chunk_summary_fields["short_summary"],
                "long_summary": chunk_summary_fields["long_summary"],
                "summary_status": chunk_summary_fields["summary_status"],
                "text": public_document.get("text") or public_document.get("content") or "",
                "content": public_document.get("content") or public_document.get("text") or "",
                "chunk_index": public_document.get("chunk_index", 0),
                "created_at": public_document.get("created_at"),
                "scanned_at": public_document.get("scanned_at"),
            })

        chunks = sorted(
            chunks,
            key=lambda chunk: chunk.get("chunk_index", 0),
        )

        return {
            "source_id": source_id,
            "title": title,
            "llm_title": title,
            "original_title": original_title,
            "url": first_document.get("url") or "",
            "domain": first_document.get("domain") or self._extract_domain(first_document.get("url") or ""),
            "summary": summary_fields["summary"],
            "short_summary": summary_fields["short_summary"],
            "long_summary": summary_fields["long_summary"],
            "summary_status": summary_fields["summary_status"],
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
            if (
                document.get("source_id") == source_id
                and document.get("chunk_id") == chunk_id
            ):
                return self._public_document(document)

        return None

    def update_source_summary(self, source_id: str, summary: str) -> bool:
        """
        Bir kaynağa ait tüm chunk'ların özet bilgisini günceller.
        Geriye dönük uyumluluk için summary ve short_summary birlikte güncellenir.
        """

        updated = False

        for document in self.documents:
            if document.get("source_id") == source_id:
                document["summary"] = summary
                document["short_summary"] = summary

                if not document.get("long_summary"):
                    document["long_summary"] = summary

                metadata = document.get("metadata") or {}
                metadata["summary"] = summary
                metadata["short_summary"] = summary

                if not metadata.get("long_summary"):
                    metadata["long_summary"] = summary

                document["metadata"] = metadata
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
            document
            for document in self.documents
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