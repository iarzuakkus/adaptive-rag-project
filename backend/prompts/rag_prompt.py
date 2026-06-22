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
- Farklı kaynaklardan gelen bilgileri tek bir sayfanın içeriği gibi karıştırma.
- Bir kaynakta geçen bilgiyi başka bir kaynağa aitmiş gibi anlatma.
- Kaynaklar yetersizse veya konu dışıysa bunu açıkça belirt.
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

    metadata = item.get("metadata") or {}

    for key in keys:
        value = item.get(key)

        if value:
            return value

    if isinstance(metadata, dict):
        for key in keys:
            value = metadata.get(key)

            if value:
                return value

    return default


def _detect_source_count(chunks: list[dict]) -> int:
    """
    Kaç farklı kaynak kullanıldığını kabaca hesaplar.
    """

    source_keys = set()

    for chunk in chunks:
        title = _get_value(chunk, ["title", "page_title", "source_title"], "")
        url = _get_value(chunk, ["url", "source_url", "page_url"], "")

        key = url or title

        if key:
            source_keys.add(key)

    return len(source_keys)


def build_rag_prompt(
    question: str,
    chunks: list[dict],
    page_url: str | None = None,
    page_title: str | None = None,
    scope: str | None = "auto",
) -> str:
    """
    Kullanıcı sorusu ve ilgili chunk'ları kullanarak RAG prompt'u oluşturur.
    """

    formatted_chunks = []

    for index, chunk in enumerate(chunks, start=1):
        title = _get_value(
            chunk,
            ["title", "page_title", "source_title"],
            "Başlıksız kaynak",
        )

        url = _get_value(
            chunk,
            ["url", "source_url", "page_url"],
            "",
        )

        text = _get_value(
            chunk,
            ["content", "text", "chunk", "page_content"],
            "",
        )

        chunk_id = _get_value(
            chunk,
            ["chunk_id", "id"],
            f"chunk-{index}",
        )

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
    source_count = _detect_source_count(chunks)

    page_context = ""

    if page_url or page_title or scope:
        page_context = f"""
Aktif sayfa bağlamı:
- Aktif sayfa başlığı: {page_title or "Bilinmiyor"}
- Aktif sayfa URL: {page_url or "Bilinmiyor"}
- İstenen kapsam: {scope or "auto"}
- Kullanılan farklı kaynak sayısı: {source_count}
"""

    prompt = f"""
Kullanıcı sorusu:
{question}

{page_context}

Aşağıdaki kaynak parçalarını kullanarak cevap ver:

{sources_text}

Cevap verirken dikkat et:
- Cevabını sadece verilen kaynak parçalarına dayandır.
- Eğer soru aktif sayfayı soruyorsa, aktif sayfa dışındaki kaynakları ana dayanak yapma.
- Eğer birden fazla farklı kaynak varsa, bilgileri hangi kaynaktan geldiğini karıştırmadan anlat.
- Kaynaklarda cevap için yeterli bilgi yoksa tahmin yapma; "Bu kaynaklarda yeterli bilgi yok" de.
- Kaynak dışı genel bilgi eklemen gerekiyorsa bunun kaynaklardan değil genel bilgiden geldiğini açıkça belirt.

Cevap formatı:

Kısa cevap:
Kullanıcının sorusuna net cevap ver.

Detay:
Gerekirse birkaç kısa maddeyle açıkla.

Kullanılan kaynaklar:
Kullandığın kaynakların başlığını ve varsa URL bilgisini kısa şekilde yaz.
"""

    return prompt.strip()