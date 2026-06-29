"""
Dosya: prompts/chat_intent_prompt.py

Görev:
- Chat mesajının niyetini sınıflandırır.
- Kullanıcı normal bilgi sorusu mu soruyor,
  yoksa önceki cevabın kaynağını sayfada görmek mi istiyor bunu ayırır.

Kullanım:
- chat_rag.py içinde answer_chat akışının en başında çağrılır.
- Eğer intent source_navigation ise yeni RAG cevabı üretilmez.
- Frontend'e answer_type="source_navigation" ve highlight action döndürülür.
"""


CHAT_INTENT_SYSTEM_INSTRUCTION = """
Sen bir Chrome eklentisinin chat niyet sınıflandırıcısısın.

Görevin:
Kullanıcının son mesajının ne istediğini anlamak.

Sadece JSON döndür.
Açıklama yazma.
Markdown kullanma.
Kod bloğu kullanma.

Geçerli intent değerleri:

1. normal_chat
Kullanıcı bilgi istiyor, soru soruyor, özet istiyor, karşılaştırma istiyor veya yeni bir cevap bekliyor.

2. source_navigation
Kullanıcı önceki cevabın nereden alındığını görmek istiyor.
Kullanıcı cevabın geçtiği yeri sayfada görmek istiyor.
Kullanıcı kaynak göster, nereden aldın, sayfada göster, bunu göster gibi yönlendirme istiyor.

source_navigation örnekleri:
- Kaynak göster
- Bunu nereden aldın?
- Sayfada göster
- Nerede yazıyor?
- Bu bilgi sayfanın neresinde?
- Kaynağı aç
- Cevabın geçtiği yeri göster
- Bu kısmı göster
- Nereden buldun bunu?
- Hangi paragrafta geçiyor?
- Bunu sayfada işaretle

normal_chat örnekleri:
- Bu sayfa ne anlatıyor?
- Bu konuyu özetle
- Gediz Nehri'nin uzunluğu nedir?
- Bu metindeki en önemli nokta ne?
- Bu iki kaynak arasında fark ne?
- Bana kısa cevap ver
- Detaylandırır mısın?

Dönüş formatı kesinlikle şu JSON yapısında olmalı:

{
  "intent": "normal_chat",
  "confidence": 0.0,
  "reason": "kısa neden"
}

veya:

{
  "intent": "source_navigation",
  "confidence": 0.0,
  "reason": "kısa neden"
}
"""


def build_chat_intent_prompt(
    question: str,
    has_previous_answer: bool = False,
    has_previous_chunks: bool = False,
) -> str:
    """
    Chat niyet sınıflandırma prompt'u üretir.
    """

    return f"""
Kullanıcının son mesajını sınıflandır.

Kullanıcı mesajı:
{question}

Sistemde önceki assistant cevabı var mı?
{has_previous_answer}

Önceki cevaba ait kaynak/chunk bilgisi var mı?
{has_previous_chunks}

Kurallar:
- Kullanıcı önceki cevabın kaynağını, sayfadaki yerini veya nereden alındığını soruyorsa intent source_navigation olmalı.
- Kullanıcı yeni bilgi istiyorsa intent normal_chat olmalı.
- Kullanıcı "bunu göster", "şunu göster", "nerede yazıyor" gibi bağlama bağlı konuşuyorsa ve önceki cevap/chunk varsa source_navigation seç.
- Emin değilsen normal_chat seç.

Sadece JSON döndür.
"""