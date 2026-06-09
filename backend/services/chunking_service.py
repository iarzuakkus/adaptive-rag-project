import re
import numpy as np

from core.embeddings import generate_embeddings


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def split_sentences(text: str) -> list[str]:
    text = clean_text(text)

    protected_patterns = {
        "MÖ": "MO_PLACEHOLDER",
        "MS": "MS_PLACEHOLDER",
        "Dr": "DR_PLACEHOLDER",
        "Prof": "PROF_PLACEHOLDER",
        "Doç": "DOC_PLACEHOLDER",
        "Hz": "HZ_PLACEHOLDER",
        "vb": "VB_PLACEHOLDER",
        "vs": "VS_PLACEHOLDER",
        "örn": "ORN_PLACEHOLDER"
    }

    for original, placeholder in protected_patterns.items():
        text = re.sub(rf"\b{original}\.", placeholder, text)

    text = re.sub(r"(\b\d+)\.", r"\1_DOT_", text)

    sentences = re.split(r"(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])", text)

    cleaned_sentences = []

    for sentence in sentences:
        sentence = sentence.replace("_DOT_", ".")
        for original, placeholder in protected_patterns.items():
            sentence = sentence.replace(placeholder, f"{original}.")

        sentence = sentence.strip()
        if sentence:
            cleaned_sentences.append(sentence)

    return cleaned_sentences


def cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    a = np.array(vec1)
    b = np.array(vec2)

    denominator = np.linalg.norm(a) * np.linalg.norm(b)

    if denominator == 0:
        return 0.0

    return float(np.dot(a, b) / denominator)


def create_chunk(chunk_id: int, sentences: list[str], sources: list[dict]) -> dict:
    text = " ".join(sentences).strip()

    return {
        "chunk_id": chunk_id,
        "text": text,
        "char_count": len(text),
        "sentence_count": len(sentences),
        "sources": sources
    }


def semantic_chunk_blocks(
    blocks: list[dict],
    max_chars: int = 900,
    min_chars: int = 250,
    similarity_threshold: float = 0.55
) -> list[dict]:
    chunks = []
    chunk_id = 0

    current_sentences = []
    current_sources = []
    current_length = 0
    previous_embedding = None

    for block_index, block in enumerate(blocks):
        text = clean_text(block.get("text", ""))

        if not text:
            continue

        sentences = split_sentences(text)

        if not sentences:
            continue

        embeddings = generate_embeddings(sentences)

        for sentence, embedding in zip(sentences, embeddings):
            sentence = clean_text(sentence)

            if not sentence:
                continue

            sentence_length = len(sentence)
            should_split = False

            if previous_embedding is not None:
                similarity = cosine_similarity(previous_embedding, embedding)

                if (
                    similarity < similarity_threshold
                    and current_length >= min_chars
                ):
                    should_split = True

            if current_length + sentence_length > max_chars and current_length >= min_chars:
                should_split = True

            if should_split and current_sentences:
                chunks.append(
                    create_chunk(
                        chunk_id=chunk_id,
                        sentences=current_sentences,
                        sources=current_sources
                    )
                )

                chunk_id += 1
                current_sentences = []
                current_sources = []
                current_length = 0

            current_sentences.append(sentence)
            current_sources.append({
                "block_index": block_index,
                "type": block.get("type", "paragraph")
            })
            current_length += sentence_length
            previous_embedding = embedding

    if current_sentences:
        chunks.append(
            create_chunk(
                chunk_id=chunk_id,
                sentences=current_sentences,
                sources=current_sources
            )
        )

    return chunks