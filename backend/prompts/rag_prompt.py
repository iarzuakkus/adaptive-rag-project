# backend/prompts/rag_prompt.py

"""
MemorAI Chat RAG Prompt

Görev:
- Kullanıcının sorusuna, sadece verilen kaynak bağlamına dayanarak cevap üretir.
- LLM cevabını backend'in parse edebileceği JSON formatında ister.
- Kullanıcıya gösterilecek cevap sadece JSON içindeki "answer" alanıdır.
- used_context_indexes alanı, cevabın hangi bağlam parçasına dayandığını belirtir.
- Kaynaklar backend tarafından structured response olarak ayrıca döndürülür.
- Cevap uzunluğunu kullanıcının niyetine göre ayarlar.
"""


SYSTEM_INSTRUCTION = """
Sen MemorAI adlı kişisel araştırma asistanının chat motorusun.

Görevin:
- Kullanıcının sorusuna yalnızca verilen kaynak bağlamına dayanarak cevap vermek.
- Kaynaklarda olmayan bilgiyi uydurmamak.
- Cevabın içine kaynak listesi, URL, source_id, chunk_id veya teknik metadata yazmamak.
- Kaynakları metne gömmemek; kaynaklar backend tarafından ayrıca structured response olarak döndürülür.
- Kullanıcının istediği cevap uzunluğuna göre doğal, sade ve ürün kalitesinde cevap üretmek.
- Raw cevabı her zaman geçerli JSON olarak döndürmek.

Çıktı kuralları:
- Sadece JSON döndür.
- Markdown kullanma.
- Kod bloğu kullanma.
- JSON dışında açıklama yazma.
- JSON geçerli parse edilebilir yapıda olmalı.
- Kullanıcıya gösterilecek doğal cevap sadece "answer" alanında olmalı.
- "used_context_indexes" alanı, cevabın dayandığı bağlam parçalarının 1 tabanlı sıra numaralarını içermeli.
- Birden fazla bağlam parçası kullanıldıysa en önemli olanı ilk sıraya yaz.
- Emin değilsen veya kaynak yetersizse "used_context_indexes" boş liste olabilir.
""".strip()


def infer_answer_type(question: str) -> str:
    """
    Kullanıcı sorusundan cevap tipini basit kurallarla tahmin eder.
    Bu değer hem prompt stilini hem de frontend aksiyonlarını yönlendirmek için kullanılabilir.
    """

    if not question:
        return "unknown"

    q = question.lower().strip()

    detailed_keywords = [
        "detaylı",
        "detayli",
        "açıkla",
        "acikla",
        "anlat",
        "madde madde",
        "ayrıntılı",
        "ayrintili",
        "neden",
        "nasıl",
        "nasil",
        "örnekle",
        "ornekle",
        "açıklaması",
        "aciklamasi",
    ]

    summary_keywords = [
        "özetle",
        "ozetle",
        "özet",
        "ozeti",
        "kısaca",
        "kisaca",
        "ana fikir",
        "ana nokta",
        "en önemli",
        "en onemli",
        "ne anlatıyor",
        "ne anlatiyor",
    ]

    comparison_keywords = [
        "karşılaştır",
        "karsilastir",
        "farkı ne",
        "farki ne",
        "farkları",
        "farklari",
        "hangisi",
        "avantaj",
        "dezavantaj",
        "benzerlik",
        "kıyasla",
        "kiyasla",
    ]

    if any(keyword in q for keyword in comparison_keywords):
        return "comparison"

    if any(keyword in q for keyword in detailed_keywords):
        return "detailed"

    if any(keyword in q for keyword in summary_keywords):
        return "summary"

    return "short"


def get_style_instruction(answer_type: str) -> str:
    """
    Cevap tipine göre LLM'e verilecek stil yönergesini üretir.
    """

    if answer_type == "detailed":
        return """
Kullanıcı detaylı açıklama istiyor.
"answer" alanı 2-5 kısa paragraf olabilir.
Gerekirse az sayıda madde kullanabilirsin.
Konuyu açık, anlaşılır ve doğal bir dille anlat.
Gereksiz tekrar yapma.
""".strip()

    if answer_type == "summary":
        return """
Kullanıcı özet istiyor.
"answer" alanı kısa, yoğun ve anlaşılır olmalı.
Ana fikri ve en önemli noktaları ver.
Gereksiz ayrıntıya girme.
""".strip()

    if answer_type == "comparison":
        return """
Kullanıcı karşılaştırma veya fark istiyor.
"answer" alanında benzerlikleri ve farkları netleştir.
Gerekirse kısa maddeler kullan.
Kaynak bağlamında olmayan karşılaştırma bilgisini uydurma.
""".strip()

    if answer_type == "unknown":
        return """
Kullanıcının niyeti veya kaynak bağlamı belirsiz olabilir.
Elindeki bağlam yeterliyse dikkatli cevap ver.
Yeterli bilgi yoksa bunu "answer" alanında açıkça söyle.
""".strip()

    return """
Kullanıcı basit veya kısa bir cevap bekliyor.
"answer" alanı 2-4 cümlelik doğal bir metin olsun.
Gereksiz başlık, uzun açıklama veya madde kullanma.
""".strip()


def format_context_chunks(chunks) -> str:
    """
    Retriever'dan gelen chunk listesini prompt içinde kullanılabilir bağlama çevirir.

    Beklenen chunk alanları:
    - text/content
    - title / llm_title
    - score

    Not:
    LLM cevapta teknik metadata yazmayacak.
    Ancak used_context_indexes alanında bağlam sıra numarasını döndürecek.
    """

    if not chunks:
        return ""

    formatted_chunks = []

    for index, chunk in enumerate(chunks, start=1):
        if isinstance(chunk, str):
            text = chunk
            title = ""
            score = ""
        else:
            text = (
                chunk.get("text")
                or chunk.get("content")
                or chunk.get("chunk_text")
                or ""
            )

            title = (
                chunk.get("llm_title")
                or chunk.get("title")
                or chunk.get("page_title")
                or ""
            )

            score = chunk.get("score", "")

        text = str(text).strip()

        if not text:
            continue

        formatted_chunks.append(
            f"""
[Bağlam Parçası {index}]
context_index: {index}
Başlık: {title}
Benzerlik skoru: {score}

İçerik:
{text}
""".strip()
        )

    return "\n\n---\n\n".join(formatted_chunks)


def build_rag_prompt(
    question: str,
    chunks,
    page_url: str | None = None,
    page_title: str | None = None,
    scope: str | None = "auto",
    answer_type: str | None = None,
) -> str:
    """
    Chat RAG için ana prompt.

    LLM geçerli JSON döndürür.
    Backend JSON içinden:
    - answer alanını kullanıcıya gösterir.
    - used_context_indexes alanını primary chunk seçmek için kullanır.
    """

    resolved_answer_type = answer_type or infer_answer_type(question)
    style_instruction = get_style_instruction(resolved_answer_type)
    context_text = format_context_chunks(chunks)

    page_context = ""

    if page_title or page_url:
        page_context = f"""
Aktif sayfa bilgisi:
- Sayfa başlığı: {page_title or "Bilinmiyor"}
- Sayfa URL bilgisi backend tarafında tutulur; cevaba yazma.
- Scope: {scope or "auto"}
""".strip()

    return f"""
Sen MemorAI adlı kişisel araştırma asistanının chat motorusun.

Temel görevin:
Kullanıcının sorusunu, yalnızca aşağıda verilen kaynak bağlamına dayanarak cevaplamak.

Çok önemli kurallar:
- Raw cevabın sadece JSON olmalı.
- Markdown kullanma.
- Kod bloğu kullanma.
- JSON dışında açıklama yazma.
- "answer" alanı kullanıcıya gösterilecek doğal cevap olmalı.
- "answer" içine kaynak listesi yazma.
- "answer" içine "Kullanılan kaynaklar", "Kaynaklar", "Referanslar" gibi başlıklar ekleme.
- "answer" içine URL, source_id, chunk_id veya teknik metadata yazma.
- Her cevapta otomatik olarak "Kısa cevap" veya "Detay" başlığı kullanma.
- Cevabı kullanıcının sorusunun seviyesine göre doğal biçimde ver.
- Bağlamda olmayan bilgiyi uydurma.
- Kaynaklar yetersizse "answer" alanında açıkça "Bu konuda elimdeki kaynaklarda yeterli bilgi yok" benzeri doğal bir cümleyle belirt.
- Gereksiz markdown kalabalığı yapma.
- Backend kaynakları ayrıca structured response olarak gösterecek; bu yüzden kaynakları "answer" içine gömme.
- Kullanıcı kısa soru sorduysa kısa cevap ver.
- Kullanıcı detay isterse detaylandır.
- Kullanıcı madde madde isterse madde kullan.
- Kullanıcı istemedikçe uzun akademik açıklama yapma.

Kaynak eşleştirme kuralları:
- "used_context_indexes" alanına cevabın dayandığı bağlam parçalarının context_index değerlerini yaz.
- En çok kullanılan / cevabı en iyi destekleyen bağlam parçasını listenin ilk elemanı yap.
- Cevap birden fazla bağlam parçasına dayanıyorsa en fazla 3 index yaz.
- Cevap yalnızca genel bir özetse ve birden fazla parça kullanıldıysa yine en baskın parçayı ilk sıraya yaz.
- Cevap kaynaklarda yeterince desteklenmiyorsa "used_context_indexes": [] döndür.
- "used_context_indexes" içine sadece verilen bağlam parçalarının numaralarını yaz.
- Olmayan index yazma.

Cevap stili:
{style_instruction}

{page_context}

Kaynak bağlamı:
{context_text if context_text else "Bu soru için kullanılabilir kaynak bağlamı bulunamadı."}

Kullanıcı sorusu:
{question}

Dönüş formatı kesinlikle şu JSON yapısında olmalı:

{{
  "answer": "Kullanıcıya gösterilecek doğal cevap.",
  "used_context_indexes": [1],
  "confidence": 0.0
}}

Alan açıklamaları:
- answer: Kullanıcıya gösterilecek doğal cevap.
- used_context_indexes: Cevabı destekleyen bağlam parçalarının 1 tabanlı index listesi.
- confidence: Cevabın verilen bağlama dayanma güveni. 0 ile 1 arasında sayı.

Şimdi sadece JSON döndür.
""".strip()