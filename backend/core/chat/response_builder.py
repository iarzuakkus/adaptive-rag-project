"""
Dosya: core/chat/response_builder.py

Görev:
- Chat akışında dönecek standart response yapılarını üretir.
- Hata cevaplarını tek yerde toplar.
- LLM hata fallback cevabını hazırlar.
- Kaynak gösterme / sayfada gösterme niyeti için response üretir.

Not:
- Bu dosya retriever çağırmaz.
- LLM çağırmaz.
- Prompt oluşturmaz.
- Sadece response dict üretir.
"""


def build_empty_question_response() -> dict:
    return {
        "success": False,
        "answer": "Lütfen bir soru yaz.",
        "answer_type": "unknown",
        "sources": [],
        "chunks": [],
        "actions": [],
        "source_count": 0,
        "status": "empty_question",
        "error": None,
    }


def build_retriever_error_response(error: Exception) -> dict:
    return {
        "success": False,
        "answer": (
            "LLM bağlantısı hazır ancak retriever bağlantısı kurulamadı. "
            "Bu yüzden henüz kaynaklı cevap üretemiyorum."
        ),
        "answer_type": "unknown",
        "sources": [],
        "chunks": [],
        "actions": [],
        "source_count": 0,
        "status": "retriever_error",
        "error": str(error),
    }


def build_no_sources_response() -> dict:
    return {
        "success": False,
        "answer": (
            "Bu soru için uygun kaynak bulunamadı. "
            "Önce sayfayı taraman veya daha fazla kaynak eklemen gerekebilir."
        ),
        "answer_type": "unknown",
        "sources": [],
        "chunks": [],
        "actions": [],
        "source_count": 0,
        "status": "no_sources",
        "error": None,
    }


def build_prompt_error_response(
    error: Exception,
    sources: list[dict],
    chunks: list[dict],
    actions: list[dict],
) -> dict:
    return {
        "success": False,
        "answer": "Kaynaklar bulundu ancak RAG prompt'u oluşturulurken hata oluştu.",
        "answer_type": "unknown",
        "sources": sources,
        "chunks": chunks,
        "actions": actions,
        "source_count": len(sources),
        "status": "prompt_error",
        "error": str(error),
    }


def build_llm_error_fallback_answer(chunks: list[dict]) -> str:
    """
    LLM hata verdiğinde kaynaklardan kısa fallback cevap üretir.
    Böylece retriever kaynak bulduğu halde kullanıcı tamamen boş hata görmez.
    """

    fallback_parts = []

    for index, chunk in enumerate(chunks[:3], start=1):
        title = chunk.get("title") or "Başlıksız kaynak"
        content = (
            chunk.get("content")
            or chunk.get("text")
            or chunk.get("chunk_text")
            or ""
        )

        cleaned_content = str(content).strip()

        if not cleaned_content:
            continue

        if len(cleaned_content) > 420:
            cleaned_content = cleaned_content[:420].strip() + "..."

        fallback_parts.append(
            f"{index}. {title}\n{cleaned_content}"
        )

    if fallback_parts:
        return (
            "Kaynaklar bulundu ancak dil modeli şu anda cevap üretemedi. "
            "Aşağıda bulunan kaynak parçalarından çıkarılabilecek en ilgili içerikleri gösteriyorum:\n\n"
            + "\n\n".join(fallback_parts)
        )

    return (
        "Kaynaklar bulundu ancak dil modeli şu anda cevap üretemedi. "
        "Ayrıca gösterilebilecek temiz kaynak parçası bulunamadı."
    )


def build_llm_error_response(
    error: Exception,
    original_chunks: list[dict],
    sources: list[dict],
    chunks: list[dict],
    actions: list[dict],
) -> dict:
    fallback_answer = build_llm_error_fallback_answer(original_chunks)

    return {
        "success": False,
        "answer": fallback_answer,
        "answer_type": "unknown",
        "sources": sources,
        "chunks": chunks,
        "actions": actions,
        "source_count": len(sources),
        "status": "llm_error_with_sources",
        "error": str(error),
    }


def build_source_navigation_response(intent_result: dict | None = None) -> dict:
    """
    Kullanıcı önceki cevabın kaynağını sayfada görmek istiyorsa
    yeni RAG çalıştırmadan frontend'e highlight komutu döndürür.

    Not:
    chunks boş döner.
    Frontend son cevabın window.AdaptiveRagLastChatChunks verisini kullanır.
    """

    return {
        "success": True,
        "answer": "Tabii, son cevabın geçtiği bölümü sayfada gösteriyorum.",
        "answer_type": "source_navigation",
        "sources": [],
        "chunks": [],
        "actions": [
            {
                "type": "auto_highlight_page",
                "action_type": "auto_highlight_page",
                "label": "Kaynağı sayfada göster",
            }
        ],
        "source_count": 0,
        "status": "success",
        "error": None,
        "intent": intent_result or {},
    }


def build_success_response(
    answer: str,
    sources: list[dict],
    chunks: list[dict],
    actions: list[dict],
) -> dict:
    cleaned_answer = str(answer or "").strip()

    if not cleaned_answer:
        cleaned_answer = (
            "Bu soru için kaynaklar bulundu ancak model boş cevap döndürdü. "
            "Bulunan kaynaklar sayfanın ana metninden çok kaynakça, dipnot veya zayıf içerik parçaları olabilir. "
            "Bu nedenle daha net cevap için sayfanın ana içerik kısmının daha temiz taranması gerekir."
        )

    return {
        "success": True,
        "answer": cleaned_answer,
        "answer_type": "short",
        "sources": sources,
        "chunks": chunks,
        "actions": actions,
        "source_count": len(sources),
        "status": "success",
        "error": None,
    }