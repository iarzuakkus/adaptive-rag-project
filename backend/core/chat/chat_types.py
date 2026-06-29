"""
Dosya: core/chat/chat_types.py

Görev:
- Chat sistemi içinde kullanılan ortak intent, answer_type ve status değerlerini tutar.
- String tekrarını azaltır.
- Orchestrator, intent_detector ve response_builder dosyalarının aynı sabitleri kullanmasını sağlar.

Not:
- Bu dosya iş mantığı çalıştırmaz.
- Sadece ortak sabitleri ve küçük yardımcı kontrolleri içerir.
"""


class ChatIntent:
    NORMAL_CHAT = "normal_chat"
    SOURCE_NAVIGATION = "source_navigation"

    # İleride eklenecek intent türleri
    SUMMARIZE = "summarize"
    NOTE = "note"
    RECOMMENDATION = "recommendation"
    REPORT = "report"
    RESEARCH = "research"


class AnswerType:
    SHORT = "short"
    SUMMARY = "summary"
    SOURCE_NAVIGATION = "source_navigation"
    NOTE = "note"
    RECOMMENDATION = "recommendation"
    REPORT = "report"
    RESEARCH = "research"
    UNKNOWN = "unknown"


class ChatStatus:
    SUCCESS = "success"
    EMPTY_QUESTION = "empty_question"
    NO_SOURCES = "no_sources"
    RETRIEVER_ERROR = "retriever_error"
    PROMPT_ERROR = "prompt_error"
    LLM_ERROR_WITH_SOURCES = "llm_error_with_sources"


VALID_CHAT_INTENTS = {
    ChatIntent.NORMAL_CHAT,
    ChatIntent.SOURCE_NAVIGATION,
    ChatIntent.SUMMARIZE,
    ChatIntent.NOTE,
    ChatIntent.RECOMMENDATION,
    ChatIntent.REPORT,
    ChatIntent.RESEARCH,
}


def is_valid_chat_intent(intent: str) -> bool:
    return intent in VALID_CHAT_INTENTS


def normalize_chat_intent(intent: str | None) -> str:
    cleaned_intent = str(intent or "").strip().lower()

    if cleaned_intent in VALID_CHAT_INTENTS:
        return cleaned_intent

    return ChatIntent.NORMAL_CHAT


def is_source_navigation_intent(
    intent_result: dict,
    min_confidence: float = 0.55,
) -> bool:
    """
    Intent sonucunun kaynak gösterme / sayfada gösterme isteği olup olmadığını döndürür.
    """

    if not isinstance(intent_result, dict):
        return False

    intent = normalize_chat_intent(intent_result.get("intent"))

    try:
        confidence = float(intent_result.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0

    return intent == ChatIntent.SOURCE_NAVIGATION and confidence >= min_confidence