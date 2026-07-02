"""
Dosya: prompts/chat_intent_prompt.py

Görev:
- Chat mesajının niyetini sınıflandırır.
- Kullanıcı normal bilgi sorusu mu soruyor,
  önceki cevabın kaynağını sayfada görmek mi istiyor,
  mevcut kaynaklara göre öneri mi istiyor,
  yoksa kaynaklardan not oluşturmak mı istiyor bunu ayırır.

Desteklenen intent değerleri:
- normal_chat
- source_navigation
- recommendation_request
- note_generation_request

Kullanım:
- chat_rag.py içinde answer_chat akışının en başında çağrılır.
- source_navigation intentinde yeni RAG cevabı üretilmez.
- recommendation_request intentinde öneri üretme action'ı döndürülür.
- note_generation_request intentinde not oluşturma action'ı döndürülür.
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

Kullanıcı bilgi istiyor, soru soruyor, özet istiyor,
karşılaştırma istiyor veya yeni bir cevap bekliyor.

2. source_navigation

Kullanıcı önceki cevabın nereden alındığını görmek istiyor.
Kullanıcı cevabın geçtiği yeri sayfada görmek istiyor.
Kullanıcı kaynak göster, nereden aldın, sayfada göster,
bunu göster gibi yönlendirme istiyor.

3. recommendation_request

Kullanıcı mevcut kaynaklara, aktif sayfaya veya araştırma
konusuna göre yeni kaynak önerisi istiyor.

Kullanıcı araştırmayı genişletmek, benzer kaynaklar bulmak,
başka ne okuyacağını öğrenmek veya öneri paneline kaynak
önerisi üretmek istiyor.

4. note_generation_request

Kullanıcı aktif sayfadan, mevcut kaynaklardan, belirli bir
konudan veya önceki araştırma bağlamından not oluşturulmasını
istiyor.

Kullanıcı oluşturulan notun Notlar sekmesine kaydedilmesini
veya not olarak hazırlanmasını istiyor.

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

recommendation_request örnekleri:
- Bana kaynak öner
- Bu konuyla ilgili kaynak öner
- Bu kaynaklara göre bana öneri sun
- Araştırmayı genişlet
- Bu konuyu daha iyi anlamak için ne okuyayım?
- Benzer kaynaklar bul
- Bana yeni siteler öner
- Bu konuda başka hangi kaynaklara bakmalıyım?
- Öneri oluştur
- Kaynak önerisi üret
- Bu araştırmaya devam etmek için öneri ver
- Okuma önerisi sun
- Bu konuyu derinleştirmek için neye bakayım?
- Bana araştırma önerisi ver

note_generation_request örnekleri:
- Bu kaynaklardan bana not oluştur
- Bu konulardan not çıkar
- Bu sayfadaki bilgilerden not hazırla
- Önemli yerleri not haline getir
- Bunları Notlar sekmesine kaydet
- Bu araştırmadan düzenli bir not oluştur
- Bu kaynakları başlıklandırarak not çıkar
- Bu konu hakkında çalışma notu hazırla
- Tüm kaynaklardan genel bir not oluştur
- Aktif sayfadan not oluştur
- Bu bilgileri notlarıma ekle
- Önceki cevaptan not oluştur
- Bunları ders notu haline getir
- Kaynaklardaki önemli bilgileri notlaştır

normal_chat örnekleri:
- Bu sayfa ne anlatıyor?
- Bu konuyu özetle
- Gediz Nehri'nin uzunluğu nedir?
- Bu metindeki en önemli nokta ne?
- Bu iki kaynak arasında fark ne?
- Bana kısa cevap ver
- Detaylandırır mısın?
- Bu kaynaklardan sonuç çıkar
- Bunu açıklar mısın?

Önemli ayrım kuralları:

- Kullanıcı "kaynak göster", "nerede yazıyor",
  "sayfada göster" diyorsa source_navigation seç.

- Kullanıcı "kaynak öner", "öneri sun",
  "benzer kaynak bul", "ne okuyayım" diyorsa
  recommendation_request seç.

- Kullanıcı "not oluştur", "not çıkar", "not hazırla",
  "notlara kaydet", "not haline getir" veya "notlaştır"
  diyorsa note_generation_request seç.

- Kullanıcı yalnızca "özetle" diyorsa normal_chat seç.

- Kullanıcı "özet not oluştur" veya "özeti notlara kaydet"
  diyorsa note_generation_request seç.

- Kullanıcı yalnızca bilgi sorusu soruyorsa normal_chat seç.

- Kullanıcı hem kaynak hem öneri kelimesini kullanıyorsa ve
  amacı yeni kaynak bulmaksa recommendation_request seç.

- Kullanıcı mevcut kaynaklardan içerik çıkarıp not hazırlanmasını
  istiyorsa note_generation_request seç.

- Kullanıcı mevcut cevabın kaynağını görmek istiyorsa
  source_navigation seç.

- Emin değilsen normal_chat seç.

note_generation_request action scope kuralları:

- "Bu sayfadan", "aktif sayfadan" deniyorsa:
  scope = "active_page"

- "Tüm kaynaklardan", "bütün kaynaklardan" deniyorsa:
  scope = "all_sources"

- "Bu kaynaklardan", "bu konudan", "önceki bilgilerden"
  deniyorsa:
  scope = "retrieved_sources"

Dönüş formatı kesinlikle şu JSON yapılarından biri olmalı:

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

veya:

{
  "intent": "recommendation_request",
  "confidence": 0.0,
  "reason": "kısa neden",
  "action": {
    "type": "generate_recommendations",
    "reason": "chat_natural_language_request",
    "mode": "refresh",
    "open_panel": true,
    "show_in_chat": true
  }
}

veya:

{
  "intent": "note_generation_request",
  "confidence": 0.0,
  "reason": "kısa neden",
  "action": {
    "type": "generate_note",
    "reason": "chat_natural_language_request",
    "scope": "retrieved_sources",
    "title": "",
    "open_panel": true,
    "show_in_chat": true
  }
}
"""


def build_chat_intent_prompt(
    question: str,
    has_previous_answer: bool = False,
    has_previous_chunks: bool = False,
) -> str:
    """
    Chat niyet sınıflandırma prompt'unu üretir.
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

- Kullanıcı önceki cevabın kaynağını, sayfadaki yerini veya
  nereden alındığını soruyorsa intent source_navigation olmalı.

- Kullanıcı yeni bilgi istiyorsa intent normal_chat olmalı.

- Kullanıcı mevcut kaynaklara, aktif sayfaya veya araştırma
  konusuna göre yeni kaynak önerisi istiyorsa intent
  recommendation_request olmalı.

- Kullanıcı kaynaklardan, aktif sayfadan, önceki cevaptan veya
  araştırma konusundan not oluşturulmasını istiyorsa intent
  note_generation_request olmalı.

- Kullanıcı "bana kaynak öner", "öneri sun", "benzer kaynak bul",
  "araştırmayı genişlet", "ne okuyayım" veya
  "başka hangi kaynaklara bakayım" gibi ifadeler kullanıyorsa
  recommendation_request seç.

- Kullanıcı "not oluştur", "not çıkar", "not hazırla",
  "notlara kaydet", "not haline getir", "notlaştır" veya
  "çalışma notu hazırla" gibi ifadeler kullanıyorsa
  note_generation_request seç.

- Kullanıcı yalnızca "özetle" diyorsa normal_chat seç.

- Kullanıcı "özet not oluştur" veya "özeti notlarıma kaydet"
  diyorsa note_generation_request seç.

- Kullanıcı "bunu göster", "şunu göster", "nerede yazıyor"
  gibi bağlama bağlı konuşuyorsa ve önceki cevap/chunk varsa
  source_navigation seç.

- "Kaynak göster" ifadesi önceki cevabın kaynağını görmek
  anlamındaysa source_navigation seç.

- "Kaynak öner" ifadesi yeni kaynak önerisi istemek
  anlamındaysa recommendation_request seç.

- Emin değilsen normal_chat seç.

recommendation_request seçersen action alanını mutlaka şöyle döndür:

{{
  "type": "generate_recommendations",
  "reason": "chat_natural_language_request",
  "mode": "refresh",
  "open_panel": true,
  "show_in_chat": true
}}

note_generation_request seçersen action alanını mutlaka döndür.

Scope belirleme:

- Aktif sayfadan not isteniyorsa:
  "active_page"

- Tüm kaynaklardan not isteniyorsa:
  "all_sources"

- Mevcut veya ilgili kaynaklardan not isteniyorsa:
  "retrieved_sources"

Not başlığı kullanıcı tarafından açıkça verilmişse title alanına yaz.
Başlık verilmemişse boş string döndür.

note_generation_request action formatı:

{{
  "type": "generate_note",
  "reason": "chat_natural_language_request",
  "scope": "retrieved_sources",
  "title": "",
  "open_panel": true,
  "show_in_chat": true
}}

Dönüş örnekleri:

Kullanıcı: "Bana kaynak öner"

JSON:

{{
  "intent": "recommendation_request",
  "confidence": 0.95,
  "reason": "Kullanıcı mevcut araştırma bağlamına göre yeni kaynak önerisi istiyor.",
  "action": {{
    "type": "generate_recommendations",
    "reason": "chat_natural_language_request",
    "mode": "refresh",
    "open_panel": true,
    "show_in_chat": true
  }}
}}

Kullanıcı: "Bu kaynaklardan bana not oluştur"

JSON:

{{
  "intent": "note_generation_request",
  "confidence": 0.97,
  "reason": "Kullanıcı mevcut kaynaklardan düzenli bir not oluşturulmasını istiyor.",
  "action": {{
    "type": "generate_note",
    "reason": "chat_natural_language_request",
    "scope": "retrieved_sources",
    "title": "",
    "open_panel": true,
    "show_in_chat": true
  }}
}}

Kullanıcı: "Aktif sayfadan Karadeniz hakkında not oluştur"

JSON:

{{
  "intent": "note_generation_request",
  "confidence": 0.98,
  "reason": "Kullanıcı aktif sayfa içeriğinden başlıklı bir not oluşturulmasını istiyor.",
  "action": {{
    "type": "generate_note",
    "reason": "chat_natural_language_request",
    "scope": "active_page",
    "title": "Karadeniz",
    "open_panel": true,
    "show_in_chat": true
  }}
}}

Kullanıcı: "Tüm kaynaklardan genel bir çalışma notu hazırla"

JSON:

{{
  "intent": "note_generation_request",
  "confidence": 0.97,
  "reason": "Kullanıcı bütün kaynaklardan genel bir çalışma notu hazırlanmasını istiyor.",
  "action": {{
    "type": "generate_note",
    "reason": "chat_natural_language_request",
    "scope": "all_sources",
    "title": "Genel çalışma notu",
    "open_panel": true,
    "show_in_chat": true
  }}
}}

Kullanıcı: "Bunu nereden aldın?"

JSON:

{{
  "intent": "source_navigation",
  "confidence": 0.95,
  "reason": "Kullanıcı önceki cevabın kaynağını veya sayfadaki yerini görmek istiyor."
}}

Kullanıcı: "Bu sayfa ne anlatıyor?"

JSON:

{{
  "intent": "normal_chat",
  "confidence": 0.9,
  "reason": "Kullanıcı yeni bir bilgi cevabı istiyor."
}}

Sadece JSON döndür.
"""