"""
Dosya: services/chunking_service.py

Görev:
- Gelen metin bloklarını temizler.
- Metinleri cümlelere ayırır.
- Cümle embedding'leri arasındaki benzerliği hesaplar.
- Anlam değişimi veya maksimum karakter sınırı oluştuğunda
  yeni bir semantic chunk başlatır.
- Her chunk için kaynak blok bilgilerini korur.

Temel mantık:
- Cümleler sırayla işlenir.
- Ardışık cümlelerin embedding benzerliği ölçülür.
- Benzerlik belirlenen eşikten düşükse ve mevcut chunk yeterince
  uzunsa semantic sınır kabul edilerek yeni chunk oluşturulur.
- Chunk maksimum karakter sınırını aşacaksa güvenli biçimde bölünür.
"""

import re

import numpy as np

from core.embeddings import generate_embeddings


def clean_text(text: str) -> str:
    """
    Metin içindeki satır sonlarını ve tekrar eden boşlukları
    tek boşluğa indirger.
    """

    return re.sub(
        r"\s+",
        " ",
        text or "",
    ).strip()


def split_sentences(text: str) -> list[str]:
    """
    Metni cümlelere ayırır.

    Yaygın Türkçe kısaltmalar ve numaralı maddelerdeki noktalar,
    yanlışlıkla cümle sonu olarak algılanmamaları için geçici olarak
    korunur. Bölme işleminden sonra özgün biçimlerine geri çevrilir.
    """

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
        "örn": "ORN_PLACEHOLDER",
    }

    # Kısaltmaların sonundaki noktaları geçici olarak korur.
    for original, placeholder in protected_patterns.items():
        text = re.sub(
            rf"\b{original}\.",
            placeholder,
            text,
        )

    # "1.", "2." gibi numaralı maddelerin noktalarını korur.
    text = re.sub(
        r"(\b\d+)\.",
        r"\1_DOT_",
        text,
    )

    # Noktalama işaretinden sonra büyük harfle başlayan yeni bölümü
    # cümle sınırı olarak kabul eder.
    sentences = re.split(
        r"(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])",
        text,
    )

    cleaned_sentences = []

    for sentence in sentences:
        # Numaralı madde noktalarını geri getirir.
        sentence = sentence.replace(
            "_DOT_",
            ".",
        )

        # Korunan kısaltmaları özgün biçimlerine döndürür.
        for original, placeholder in protected_patterns.items():
            sentence = sentence.replace(
                placeholder,
                f"{original}.",
            )

        sentence = sentence.strip()

        if sentence:
            cleaned_sentences.append(sentence)

    return cleaned_sentences


def cosine_similarity(
    vec1: list[float],
    vec2: list[float],
) -> float:
    """
    İki embedding vektörü arasındaki cosine similarity değerini
    hesaplar.

    Dönüş değeri:
    - 1'e yakınsa cümleler anlam bakımından benzerdir.
    - 0'a yakınsa anlam ilişkisi zayıftır.
    - Negatif değerler ters yönlü semantic ilişki gösterebilir.
    """

    a = np.array(vec1)
    b = np.array(vec2)

    denominator = (
        np.linalg.norm(a)
        * np.linalg.norm(b)
    )

    if denominator == 0:
        return 0.0

    return float(
        np.dot(a, b)
        / denominator
    )


def create_chunk(
    chunk_id: int,
    sentences: list[str],
    sources: list[dict],
) -> dict:
    """
    Bir grup cümleden standart chunk sözlüğü oluşturur.

    Saklanan bilgiler:
    - chunk_id
    - birleştirilmiş metin
    - karakter sayısı
    - cümle sayısı
    - cümlelerin geldiği kaynak bloklar
    """

    text = " ".join(sentences).strip()

    return {
        "chunk_id": chunk_id,
        "text": text,
        "char_count": len(text),
        "sentence_count": len(sentences),
        "sources": sources,
    }


def semantic_chunk_blocks(
    blocks: list[dict],
    max_chars: int = 900,
    min_chars: int = 250,
    similarity_threshold: float = 0.55,
) -> list[dict]:
    """
    Metin bloklarını semantic olarak anlamlı chunk'lara böler.

    Parametreler:
    - blocks:
      İçinde en az `text` alanı bulunan kaynak blok listesi.

    - max_chars:
      Bir chunk için önerilen maksimum karakter uzunluğu.

    - min_chars:
      Semantic benzerlik düşse bile mevcut chunk bu uzunluğa
      ulaşmadan bölme yapılmaz.

    - similarity_threshold:
      Ardışık iki cümlenin embedding benzerliği bu değerin altına
      düştüğünde semantic konu değişimi kabul edilir.

    Bölme koşulları:
    1. Ardışık cümlelerin benzerliği eşikten düşükse ve mevcut chunk
       minimum uzunluğa ulaştıysa yeni chunk başlatılır.
    2. Yeni cümle mevcut chunk'ı maksimum karakter sınırının üzerine
       çıkaracaksa yeni chunk başlatılır.
    """

    chunks = []
    chunk_id = 0

    current_sentences = []
    current_sources = []
    current_length = 0

    # Bir önceki cümlenin embedding'i semantic geçişi ölçmek için tutulur.
    previous_embedding = None

    for block_index, block in enumerate(blocks):
        text = clean_text(
            block.get("text", "")
        )

        if not text:
            continue

        sentences = split_sentences(text)

        if not sentences:
            continue

        # Aynı blok içindeki bütün cümle embedding'leri toplu üretilir.
        # Bu yöntem her cümle için ayrı model çağrısı yapmaktan daha verimlidir.
        embeddings = generate_embeddings(sentences)

        for sentence, embedding in zip(
            sentences,
            embeddings,
        ):
            sentence = clean_text(sentence)

            if not sentence:
                continue

            sentence_length = len(sentence)
            should_split = False

            # Önceki cümle ile mevcut cümle arasındaki semantic benzerlik
            # belirlenen eşiğin altına düştüyse konu değişimi kabul edilir.
            if previous_embedding is not None:
                similarity = cosine_similarity(
                    previous_embedding,
                    embedding,
                )

                if (
                    similarity < similarity_threshold
                    and current_length >= min_chars
                ):
                    should_split = True

            # Semantic sınır oluşmasa bile maksimum karakter sınırı
            # aşılacaksa chunk güvenli biçimde kapatılır.
            if (
                current_length + sentence_length > max_chars
                and current_length >= min_chars
            ):
                should_split = True

            # Mevcut chunk kapatılır ve yeni chunk için state sıfırlanır.
            if should_split and current_sentences:
                chunks.append(
                    create_chunk(
                        chunk_id=chunk_id,
                        sentences=current_sentences,
                        sources=current_sources,
                    )
                )

                chunk_id += 1
                current_sentences = []
                current_sources = []
                current_length = 0

            # Cümle mevcut chunk'a eklenir.
            current_sentences.append(sentence)

            # Her cümlenin hangi kaynak bloktan geldiği korunur.
            current_sources.append(
                {
                    "block_index": block_index,
                    "type": block.get(
                        "type",
                        "paragraph",
                    ),
                }
            )

            current_length += sentence_length
            previous_embedding = embedding

    # Döngü sonunda kapanmamış son chunk listeye eklenir.
    if current_sentences:
        chunks.append(
            create_chunk(
                chunk_id=chunk_id,
                sentences=current_sentences,
                sources=current_sources,
            )
        )

    return chunks