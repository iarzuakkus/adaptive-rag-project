import faiss
import numpy as np


class VectorStore:
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index = faiss.IndexFlatIP(dimension)
        self.documents = []

        print("\nVECTOR STORE INIT")
        print("-" * 40)
        print("Store object id:", id(self))
        print("Dimension:", self.dimension)

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

        self.index.add(vectors)
        self.documents.extend(chunks)

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

            item = self.documents[index].copy()
            item["score"] = float(score)
            results.append(item)

        print("Dönen sonuç sayısı:", len(results))

        return results

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


def clear_store():
    vector_store.clear()