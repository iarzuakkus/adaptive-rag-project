"""
Dosya: prompts/rag_prompt.py

Görev:
- Chat RAG için kullanılacak prompt yapısını hazırlar.
- Kullanıcı sorusu ve bulunan kaynak chunk'larını modele düzenli şekilde verir.
"""


SYSTEM_INSTRUCTION = """
Sen Adaptive RAG Chrome Extension içinde çalışan teknik bir asistansın.

Kurallar:
- Cevabı mümkün olduğunca verilen kaynaklara dayanarak üret.
- Kaynaklarda olmayan bilgiyi kesin bilgi gibi söyleme.
- Kaynak yoksa veya yeterli değilse bunu açıkça belirt.
- Türkçe, anlaşılır ve düzenli cevap ver.
- Gereksiz uzun cevap verme.
- Kullanıcı özellikle istemedikçe cevabı akademik dille ağırlaştırma.
"""


def _get_value(item, keys, default=""):
    """
    Dict içinden farklı olası key isimlerini güvenli şekilde okur.
    """
    if not isinstance(item, dict):
        return default

    for key in keys:
        value = item.get(key)
        if value:
            return value

    return default


def build_rag_prompt(question: str, chunks: list[dict]) -> str:
    """
    Kullanıcı sorusu ve ilgili chunk'ları kullanarak RAG prompt'u oluşturur.
    """

    formatted_chunks = []

    for index, chunk in enumerate(chunks, start=1):
        title = _get_value(chunk, ["title", "page_title", "source_title"], "Başlıksız kaynak")
        url = _get_value(chunk, ["url", "source_url", "page_url"], "")
        text = _get_value(chunk, ["content", "text", "chunk", "page_content"], "")
        chunk_id = _get_value(chunk, ["chunk_id", "id"], f"chunk-{index}")

        formatted_chunks.append(
            f"""
[Kaynak {index}]
Başlık: {title}
URL: {url}
Chunk ID: {chunk_id}
İçerik:
{text}
"""
        )

    sources_text = "\n".join(formatted_chunks)

    prompt = f"""
Kullanıcı sorusu:
{question}

Aşağıdaki kaynak parçalarını kullanarak cevap ver:

{sources_text}

Cevap formatı:

1. Kısa cevap
Kullanıcının sorusuna net cevap ver.

2. Detay
Gerekirse açıklamayı birkaç maddeyle destekle.

3. Kullanılan kaynaklar
Cevabı hangi kaynaklara dayandırdığını kısa şekilde belirt.
"""

    return prompt.strip()