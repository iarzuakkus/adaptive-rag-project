"""
Dosya: prompts/note_prompt.py

Görev:
- Kaynaklardan ve kişisel notlardan not üretmek için kullanılan
  sistem talimatını ve kullanıcı promptunu oluşturur.
- Genel araştırma notu, ders notu ve özet türlerini destekler.
- Chat üzerinden gelen doğal dilde not oluşturma komutlarına
  uyumlu olacak şekilde hazırlanmıştır.
- Kullanıcının belirttiği kaynak adlarını ve mevcut sayfa isteğini
  dikkate alabilecek genişletilebilir bir yapı sunar.

Örnek gelecekteki komutlar:
- "Bu siteden ders notu çıkar."
- "Wikipedia ve Medium kaynaklarını kullanarak not oluştur."
- "Yalnızca İzmir ile ilgili kaynaklardan özet çıkar."
- "Seçtiğim kaynaklarla kişisel notlarımı birleştir."
- "Az önceki cevabı da bağlam olarak kullanarak araştırma notu oluştur."

Not:
- "Bu cevabı kişisel notlara ekle" komutu bu prompt üzerinden
  çalıştırılmamalıdır.
- Bu komut chat intent katmanında ayrı bir save_personal_note
  aksiyonuna dönüştürülmelidir.
"""

from __future__ import annotations

from typing import Any


SYSTEM_INSTRUCTION = """
Sen MemorAI kişisel araştırma asistanının not oluşturma ajanısın.

Görevin, sana verilen kaynakları, kişisel notları ve varsa kullanıcı
talimatını kullanarak güvenilir, düzenli ve yapılandırılmış bir not
oluşturmaktır.

TEMEL KURALLAR

1. Yalnızca verilen bağlamı kullan.
Kaynaklarda, kişisel notlarda veya chat cevabında bulunmayan bilgileri
uydurma ve dışarıdan bilgi ekleme.

2. Kaynak türlerini birbirinden ayır.
- Taranmış kaynaklar: Doğrulanabilir kaynak içeriğidir.
- Kişisel notlar: Kullanıcının kendi düşüncesi, yorumu veya hatırlatmasıdır.
- Chat cevabı: Önceki konuşmadan gelen yardımcı bağlamdır ve tek başına
  bağımsız kaynak olarak gösterilmemelidir.

3. Kullanıcının kaynak seçimine uy.
Kullanıcı belirli site veya kaynak isimleri verdiyse yalnızca verilen
kaynak listesi içinde bu isimlerle eşleşen kaynakları kullan.

4. Olmayan kaynağı varmış gibi gösterme.
Kullanıcının istediği kaynak mevcut bağlamda bulunmuyorsa yeni kaynak,
URL, alıntı veya bilgi üretme.

5. Kullanılan kaynakları doğru eşleştir.
source_notes alanında yalnızca gerçekten kullanılan kaynakları listele.
Kaynak başlığını, kimliğini veya URL'sini değiştirme.

6. Kişisel notları koru.
Kullanıcının kişisel notlarının anlamını değiştirme. Gerekirse daha düzenli
bir yapıya yerleştir fakat kullanıcıya ait düşünceleri kaynaklardan gelen
bilgiler gibi sunma.

7. Not türüne göre çıktı üret.
- research_note: Dengeli, açıklayıcı ve konu başlıklarına ayrılmış
  araştırma notu.
- lecture_note: Ders çalışmaya uygun, öğretici, sıralı ve maddeli not.
- summary_note: Kısa, doğrudan ve hızlı okunabilir özet.

8. Kaynak desteği zayıfsa bunu açıkça yansıt.
Bağlam yetersizse eksik bilgileri doldurma. Notu mevcut içerikle sınırla.

9. Çıktı dili istenen dil olmalıdır.
Varsayılan dil Türkçedir.

10. Yalnızca geçerli JSON döndür.
JSON öncesinde veya sonrasında açıklama, markdown, kod bloğu ya da yorum
yazma.

11. JSON içinde satır sonu veya özel karakter kullanırken geçerli JSON
sözdizimini koru.

12. Başlık ve metinler okunabilir olmalıdır.
Gereksiz büyük harf, aşırı teknik anlatım ve tekrar kullanma.
""".strip()


NOTE_TYPE_INSTRUCTIONS = {
    "research_note": """
GENEL ARAŞTIRMA NOTU KURALLARI

- Konunun genel çerçevesini açıkla.
- Kaynaklar arasındaki ortak ve farklı noktaları düzenle.
- Kişisel notlar varsa uygun bölümlere kullanıcı bağlamı olarak ekle.
- Ana konuları anlamlı başlıklara ayır.
- Önemli çıkarımları kaynak içeriğine dayalı olarak yaz.
- Sonuç bölümünde yalnızca verilen içerikten çıkarılabilecek genel sonucu
  belirt.
""".strip(),

    "lecture_note": """
DERS NOTU KURALLARI

- İçeriği öğrenme sırasına göre düzenle.
- Önce temel kavramları, sonra ayrıntıları ver.
- Uzun paragraflar yerine açıklayıcı ve kısa maddeler kullan.
- Birbiriyle ilişkili kavramları aynı başlık altında topla.
- Kişisel notlar varsa çalışma hatırlatması veya kullanıcı notu olarak
  uygun başlığa ekle.
- Bilgiyi sınav, tekrar veya sunum hazırlığında kullanılabilecek biçimde
  yapılandır.
""".strip(),

    "summary_note": """
ÖZET NOT KURALLARI

- Yalnızca en önemli bilgileri kullan.
- Tekrarları kaldır.
- Az sayıda bölüm ve kısa maddeler oluştur.
- Ayrıntılara gereğinden fazla girme.
- Kişisel notlar varsa özetin yönünü etkileyen kısa kullanıcı bağlamı
  olarak kullan.
- Sonuç bölümü kısa olmalıdır.
""".strip(),
}


NOTE_TYPE_LABELS = {
    "research_note": "Genel not",
    "lecture_note": "Ders notu",
    "summary_note": "Özet",
}


def clean_text(
    value: Any,
    max_length: int | None = None,
) -> str:
    """
    Değeri güvenli bir metne dönüştürür.
    """

    text = str(value or "").strip()

    if max_length and len(text) > max_length:
        return text[:max_length].rstrip()

    return text


def safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value

    return []


def normalize_note_type(note_type: str | None) -> str:
    value = clean_text(note_type, 40).lower()

    if value in NOTE_TYPE_INSTRUCTIONS:
        return value

    return "research_note"


def normalize_title_list(
    values: list[str] | None,
) -> list[str]:
    """
    Kullanıcının doğal dil komutundan çıkarılan kaynak adlarını temizler.
    """

    normalized = []
    seen = set()

    for value in safe_list(values):
        title = clean_text(value, 200)

        if not title:
            continue

        key = title.lower()

        if key in seen:
            continue

        seen.add(key)
        normalized.append(title)

    return normalized


def get_source_id(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("source_id")
        or source.get("sourceId")
        or source.get("id")
    )


def get_source_title(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("title")
        or source.get("page_title")
        or source.get("pageTitle")
        or source.get("name")
        or "Başlıksız kaynak",
        240,
    )


def get_source_url(source: dict[str, Any]) -> str:
    return clean_text(
        source.get("url")
        or source.get("page_url")
        or source.get("pageUrl"),
        1200,
    )


def is_current_page(source: dict[str, Any]) -> bool:
    """
    Gelecekte chat üzerinden "bu site" komutu geldiğinde kullanılabilir.

    Frontend veya chat orchestrator ilgili kaynağa:
    is_current_page: true

    alanını ekleyebilir.
    """

    return bool(
        source.get("is_current_page")
        or source.get("isCurrentPage")
        or source.get("current_page")
    )


def build_source_inventory(
    sources: list[dict[str, Any]],
) -> str:
    """
    LLM'e kullanılabilir kaynakların kısa kimlik listesini verir.

    Asıl içerik context alanında bulunur. Bu liste kaynak seçimi ve
    kaynak adı eşleştirmesi için kullanılır.
    """

    if not sources:
        return "Kullanılabilir taranmış kaynak yok."

    lines = []

    for index, source in enumerate(sources, start=1):
        if not isinstance(source, dict):
            continue

        source_id = get_source_id(source)
        title = get_source_title(source)
        url = get_source_url(source)

        domain = clean_text(
            source.get("domain"),
            240,
        )

        source_type = clean_text(
            source.get("source_type")
            or source.get("sourceType")
            or source.get("type"),
            80,
        )

        current_page_label = (
            " | AKTİF SAYFA"
            if is_current_page(source)
            else ""
        )

        lines.append(
            f"{index}. "
            f"ID: {source_id or '-'} | "
            f"Başlık: {title} | "
            f"Domain: {domain or '-'} | "
            f"Tür: {source_type or '-'} | "
            f"URL: {url or '-'}"
            f"{current_page_label}"
        )

    return "\n".join(lines) or "Kullanılabilir taranmış kaynak yok."


def build_personal_note_inventory(
    personal_notes: list[dict[str, Any]],
) -> str:
    """
    Kullanılabilir kişisel notların kısa listesini oluşturur.
    """

    if not personal_notes:
        return "Kullanılabilir kişisel not yok."

    lines = []

    for index, note in enumerate(personal_notes, start=1):
        if not isinstance(note, dict):
            continue

        note_id = clean_text(
            note.get("note_id")
            or note.get("noteId")
            or note.get("id")
        )

        title = clean_text(
            note.get("title")
            or f"Kişisel not {index}",
            200,
        )

        text = clean_text(
            note.get("text")
            or note.get("note")
            or note.get("content"),
            700,
        )

        lines.append(
            f"{index}. "
            f"ID: {note_id or '-'} | "
            f"Başlık: {title} | "
            f"İçerik: {text}"
        )

    return "\n".join(lines) or "Kullanılabilir kişisel not yok."


def build_target_source_instruction(
    target_source_titles: list[str] | None,
) -> str:
    """
    Chat intent katmanı kaynak isimlerini çıkardığında prompta eklenir.
    """

    titles = normalize_title_list(target_source_titles)

    if not titles:
        return (
            "Belirli bir kaynak adı kısıtı verilmedi. "
            "Gönderilen kaynakların tamamı kullanılabilir."
        )

    readable_titles = "\n".join(
        f"- {title}"
        for title in titles
    )

    return (
        "Kullanıcının özellikle kullanmak istediği kaynak adları:\n"
        f"{readable_titles}\n\n"
        "Yalnızca kullanılabilir kaynak listesinde bu adlarla veya "
        "domainlerle anlamlı şekilde eşleşen kaynakları kullan. "
        "Eşleşmeyen bir kaynağı üretme."
    )


def build_chat_answer_section(
    chat_answer: str,
) -> str:
    """
    Önceki assistant cevabı not oluşturma bağlamına dahil edilecekse kullanılır.

    Bu cevap bağımsız bir kaynak olarak sunulmaz.
    """

    safe_answer = clean_text(
        chat_answer,
        8_000,
    )

    if not safe_answer:
        return "Not üretimine dahil edilecek önceki chat cevabı yok."

    return (
        "ÖNCEKİ CHAT CEVABI\n"
        "Bu metin yardımcı bağlamdır. Bağımsız ve doğrulanmış kaynak olarak "
        "gösterme:\n\n"
        f"{safe_answer}"
    )


def build_output_schema(
    note_type: str,
) -> str:
    """
    LLM'in döndürmesi gereken JSON yapısını oluşturur.
    """

    note_type_label = NOTE_TYPE_LABELS[note_type]

    return f"""
{{
  "note": {{
    "title": "Not başlığı",
    "summary": "Notun kısa açıklaması",
    "note_type": "{note_type}",
    "note_type_label": "{note_type_label}",
    "content": {{
      "short_summary": "Kısa özet",
      "sections": [
        {{
          "heading": "Bölüm başlığı",
          "bullets": [
            "Birinci madde",
            "İkinci madde"
          ]
        }}
      ],
      "insights": [
        "Önemli çıkarım"
      ],
      "source_notes": [
        {{
          "source_id": "Gönderilen kaynak kimliği",
          "source_title": "Gönderilen kaynak başlığı",
          "source_url": "Gönderilen kaynak URL'si",
          "note": "Bu kaynaktan nota aktarılan temel nokta"
        }}
      ],
      "personal_notes": [
        {{
          "note_id": "Gönderilen kişisel not kimliği",
          "title": "Kişisel not başlığı",
          "text": "Kişisel notun içeriği"
        }}
      ],
      "conclusion": "Sonuç"
    }},
    "manual_note": "Kullanılan kişisel notların düzenli metin karşılığı",
    "is_manual": false
  }}
}}
""".strip()


def build_note_prompt(
    context: str,
    note_type: str = "research_note",
    sources: list[dict[str, Any]] | None = None,
    personal_notes: list[dict[str, Any]] | None = None,
    custom_title: str = "",
    language: str = "tr",
    user_instruction: str = "",
    target_source_titles: list[str] | None = None,
    chat_answer: str = "",
) -> str:
    """
    Not üretimi için ana kullanıcı promptunu oluşturur.

    Mevcut agent şu alanları gönderir:
    - context
    - note_type
    - sources
    - personal_notes
    - custom_title
    - language

    Chat bağlantısı tamamlandığında ek olarak şunlar gönderilebilir:
    - user_instruction
    - target_source_titles
    - chat_answer
    """

    safe_note_type = normalize_note_type(note_type)
    safe_sources = [
        source
        for source in safe_list(sources)
        if isinstance(source, dict)
    ]

    safe_personal_notes = [
        note
        for note in safe_list(personal_notes)
        if isinstance(note, dict)
    ]

    safe_context = clean_text(context)
    safe_custom_title = clean_text(
        custom_title,
        180,
    )

    safe_language = clean_text(
        language,
        30,
    ) or "tr"

    safe_user_instruction = clean_text(
        user_instruction,
        2_000,
    )

    source_inventory = build_source_inventory(
        safe_sources
    )

    personal_note_inventory = build_personal_note_inventory(
        safe_personal_notes
    )

    target_source_instruction = build_target_source_instruction(
        target_source_titles
    )

    chat_answer_section = build_chat_answer_section(
        chat_answer
    )

    note_type_instruction = NOTE_TYPE_INSTRUCTIONS[
        safe_note_type
    ]

    output_schema = build_output_schema(
        safe_note_type
    )

    custom_title_instruction = (
        f'Not başlığını tam olarak "{safe_custom_title}" kullan.'
        if safe_custom_title
        else (
            "Bağlama uygun, kısa ve açıklayıcı bir başlık üret. "
            "Başlıkta gereksiz şekilde 'not' kelimesini tekrar etme."
        )
    )

    user_instruction_text = (
        safe_user_instruction
        if safe_user_instruction
        else (
            "Ek kullanıcı talimatı verilmedi. Seçili kaynaklar ve "
            "kişisel notlardan belirtilen not türünde içerik oluştur."
        )
    )

    return f"""
NOT OLUŞTURMA GÖREVİ

Not türü:
{safe_note_type}

Not türü etiketi:
{NOTE_TYPE_LABELS[safe_note_type]}

Çıktı dili:
{safe_language}

Başlık talimatı:
{custom_title_instruction}

Kullanıcının doğal dilde talimatı:
{user_instruction_text}

KAYNAK SEÇİM KURALI

{target_source_instruction}

Kullanıcı "bu site", "bu sayfa" veya "aktif sayfa" gibi bir ifade
kullandıysa yalnızca AKTİF SAYFA olarak işaretlenen kaynağı kullan.
Aktif sayfa işaretli değilse başka bir kaynağı aktif sayfaymış gibi
kabul etme.

KULLANILABİLİR KAYNAKLAR

{source_inventory}

KULLANILABİLİR KİŞİSEL NOTLAR

{personal_note_inventory}

{chat_answer_section}

NOT TÜRÜNE ÖZEL TALİMATLAR

{note_type_instruction}

ANA BAĞLAM

{safe_context}

İÇERİK KURALLARI

- Yalnızca gerçekten verilen kaynakları kullan.
- Kaynak başlığı, kaynak kimliği ve URL bilgisini değiştirme.
- source_notes listesine kullanılmayan kaynak ekleme.
- Kaynak içeriğinde olmayan bir bilgiyi kesin bilgi olarak yazma.
- Kişisel notları personal_notes alanında koru.
- Kişisel notları doğrulanmış kaynak iddiası gibi sunma.
- Önceki chat cevabı verilmişse onu yalnızca yardımcı bağlam olarak kullan.
- Önceki chat cevabını source_notes alanına ekleme.
- Aynı bilgiyi farklı bölümlerde gereksiz yere tekrarlama.
- Bölüm başlıklarını içerikle uyumlu oluştur.
- Boş bölüm üretme.
- Boş madde üretme.
- En az bir anlamlı sections öğesi üret.
- summary ile content.short_summary birbiriyle uyumlu olmalıdır.
- manual_note alanında kullanılan kişisel notları okunabilir şekilde
  birleştir.
- Kişisel not yoksa manual_note boş string olmalıdır.
- Kaynak yoksa source_notes boş liste olmalıdır.
- Kişisel not yoksa personal_notes boş liste olmalıdır.
- Çıktıya açıklama veya markdown ekleme.

DÖNDÜRÜLECEK JSON ŞEMASI

{output_schema}

Şimdi yalnızca geçerli JSON nesnesini döndür.
""".strip()