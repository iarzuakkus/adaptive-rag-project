import faiss
import numpy as np


class VectorStore:
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self.index = faiss.IndexFlatIP(dimension)
        self.documents = []

    def add_documents(self, chunks: list[dict], embeddings: list[list[float]]):
        vectors = np.array(embeddings).astype("float32")

        self.index.add(vectors)
        self.documents.extend(chunks)

    def search(self, query_embedding: list[float], top_k: int = 5) -> list[dict]:
        query_vector = np.array([query_embedding]).astype("float32")

        scores, indices = self.index.search(query_vector, top_k)

        results = []

        for score, index in zip(scores[0], indices[0]):
            if index == -1:
                continue

            item = self.documents[index].copy()
            item["score"] = float(score)
            results.append(item)

        return results


vector_store = VectorStore()