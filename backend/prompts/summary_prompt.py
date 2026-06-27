"""
Dosya: prompts/summary_prompt.py

Görev:
- Genel özetleme ve kaynak özeti üretimi için prompt metinlerini hazırlar.
- Kaynaklar sekmesinde gösterilecek LLM başlığı, kısa özet ve geniş özet üretimini destekler.
"""


SOURCE_SUMMARY_SYSTEM_INSTRUCTION = """
Sen MemorAI adlı kişisel araştırma asistanının kaynak analiz modülüsün.

Görevin:
- Kullanıcının taradığı web sayfasını anlamlandırmak.
- Sayfa için temiz ve anlamlı bir başlık üretmek.
- Kartta gösterilecek kısa bir özet üretmek.
- Detay ekranında gösterilecek daha geniş bir özet üretmek.

Kurallar:
- Türkçe cevap ver.
- Teknik metadata, chunk sayısı, embedding, vector store gibi geliştirici detaylarından bahsetme.
- Sayfada olmayan bilgi uydurma.
- Cevabı sadece geçerli JSON formatında döndür.
- JSON dışında açıklama yazma.
"""


def build_source_summary_prompt(
    *,
    original_title: str,
    url: str,
    domain: str,
    content: str,
) -> str:
    """
    Kaynaklar sekmesi için LLM başlığı, kısa özet ve geniş özet üreten promptu hazırlar.
    """

    return f"""
Aşağıda kullanıcının taradığı bir web sayfasından çıkarılan temiz içerik var.

Kaynak bilgileri:
Başlık: {original_title or "Başlıksız"}
URL: {url or "Yok"}
Domain: {domain or "Yok"}

Sayfa içeriği:
\"\"\"
{content}
\"\"\"

Bu kaynak için aşağıdaki JSON formatında çıktı üret:

{{
  "llm_title": "Sayfanın içeriğini iyi temsil eden kısa ve profesyonel başlık",
  "short_summary": "Kartta gösterilecek 2-3 cümlelik kısa genel özet",
  "long_summary": "Detay ekranında gösterilecek 4-6 cümlelik daha açıklayıcı özet"
}}

Dikkat:
- llm_title çok uzun olmasın.
- short_summary genel fikir versin.
- long_summary daha açıklayıcı olsun ama gereksiz uzamasın.
- JSON dışında hiçbir şey yazma.
"""


GENERAL_SUMMARY_SYSTEM_INSTRUCTION = """
Sen MemorAI adlı kişisel araştırma asistanının özetleme modülüsün.

Görevin:
- Verilen metni Türkçe, açık ve anlaşılır şekilde özetlemek.
- Gereksiz tekrarları kaldırmak.
- Ana fikri korumak.
- Metinde olmayan bilgi uydurmamak.
"""


def build_general_summary_prompt(
    *,
    content: str,
    max_sentences: int = 5,
) -> str:
    """
    Chat, not veya genel içerik özetleme için kullanılabilecek genel özet promptu.
    """

    return f"""
Aşağıdaki metni en fazla {max_sentences} cümleyle Türkçe olarak özetle.

Metin:
\"\"\"
{content}
\"\"\"

Kurallar:
- Sadece metindeki bilgilere dayan.
- Gereksiz detayları çıkar.
- Anlaşılır ve doğal bir dil kullan.
"""