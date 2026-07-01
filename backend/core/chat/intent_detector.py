"""
Dosya: core/chat/intent_detector.py

Görev:
- Kullanıcının chat mesajındaki niyeti LLM ile sınıflandırır.
- Normal bilgi sorusu, kaynak gösterme / sayfada gösterme isteği
  ve öneri üretme isteğini ayırır.

Desteklenen intent değerleri:
- normal_chat
- source_navigation
- recommendation_request

Not:
- Bu dosya retriever çağırmaz.
- RAG prompt'u oluşturmaz.
- Chat cevabı üretmez.
- Sadece intent sonucu döndürür.
"""

import json

from prompts.chat_intent_prompt import (
    CHAT_INTENT_SYSTEM_INSTRUCTION,
    build_chat_intent_prompt,
)
from services.llm_service import LLMService


DEFAULT_CHAT_INTENT = {
    "intent": "normal_chat",
    "confidence": 0.0,
    "reason": "intent_detection_skipped",
    "action": None,
}


VALID_CHAT_INTENTS = {
    "normal_chat",
    "source_navigation",
    "recommendation_request",
}


def extract_json_from_text(text: str) -> dict:
    """
    LLM'den gelen intent cevabını güvenli şekilde JSON'a çevirir.

    LLM bazen JSON'u doğrudan, bazen markdown kod bloğu içinde döndürebilir.
    Bu fonksiyon ikisini de tolere eder.
    """

    if not text:
        return {}

    cleaned = str(text).strip()

    if cleaned.startswith("```"):
        cleaned = cleaned.replace("```json", "").replace("```", "").strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    start_index = cleaned.find("{")
    end_index = cleaned.rfind("}")

    if start_index == -1 or end_index == -1 or end_index <= start_index:
        return {}

    try:
        return json.loads(cleaned[start_index:end_index + 1])
    except json.JSONDecodeError:
        return {}


def build_recommendation_action(parsed_action: dict | None = None) -> dict:
    """
    recommendation_request intent'i için frontend'in anlayacağı action yapısını üretir.
    LLM eksik veya hatalı action döndürse bile güvenli varsayılan action döndürülür.
    """

    action = parsed_action if isinstance(parsed_action, dict) else {}

    return {
        "type": "generate_recommendations",
        "reason": str(
            action.get("reason") or "chat_natural_language_request"
        ).strip(),
        "mode": str(action.get("mode") or "refresh").strip().lower(),
        "open_panel": action.get("open_panel", True) is not False,
        "show_in_chat": action.get("show_in_chat", True) is not False,
    }


def normalize_intent_result(parsed: dict) -> dict:
    """
    LLM'den gelen ham JSON intent cevabını güvenli hale getirir.
    """

    if not isinstance(parsed, dict):
        return dict(DEFAULT_CHAT_INTENT)

    intent = str(parsed.get("intent") or "normal_chat").strip().lower()

    if intent not in VALID_CHAT_INTENTS:
        intent = "normal_chat"

    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    confidence = max(0.0, min(confidence, 1.0))

    reason = str(parsed.get("reason") or "").strip()

    action = None

    if intent == "recommendation_request":
        action = build_recommendation_action(parsed.get("action"))

    return {
        "intent": intent,
        "confidence": confidence,
        "reason": reason,
        "action": action,
    }


def detect_chat_intent(
    question: str,
    has_previous_answer: bool = True,
    has_previous_chunks: bool = True,
) -> dict:
    """
    Kullanıcı mesajının niyetini LLM ile sınıflandırır.

    Örnek dönüş:

    {
        "intent": "source_navigation",
        "confidence": 0.92,
        "reason": "Kullanıcı önceki cevabın kaynağını sayfada görmek istiyor.",
        "action": null
    }

    veya:

    {
        "intent": "recommendation_request",
        "confidence": 0.92,
        "reason": "Kullanıcı mevcut kaynaklara göre öneri istiyor.",
        "action": {
            "type": "generate_recommendations",
            "reason": "chat_natural_language_request",
            "mode": "refresh",
            "open_panel": true,
            "show_in_chat": true
        }
    }

    Not:
    Intent algılama başarısız olursa sistem normal_chat döndürür.
    Böylece ana RAG akışı bozulmaz.
    """

    if not question or not question.strip():
        return dict(DEFAULT_CHAT_INTENT)

    try:
        llm = LLMService()

        prompt = build_chat_intent_prompt(
            question=question,
            has_previous_answer=has_previous_answer,
            has_previous_chunks=has_previous_chunks,
        )

        raw_answer = llm.generate_text(
            prompt=prompt,
            system_instruction=CHAT_INTENT_SYSTEM_INSTRUCTION,
            temperature=0.0,
            max_output_tokens=350,
        )

        parsed = extract_json_from_text(raw_answer)
        result = normalize_intent_result(parsed)

        print("[CHAT INTENT]", {
            "question": question,
            "intent": result.get("intent"),
            "confidence": result.get("confidence"),
            "reason": result.get("reason"),
            "action": result.get("action"),
        })

        return result

    except Exception as exc:
        print("[CHAT INTENT] Intent algılama başarısız oldu:", exc)
        return dict(DEFAULT_CHAT_INTENT)


def is_source_navigation_intent(
    intent_result: dict,
    min_confidence: float = 0.55,
) -> bool:
    """
    Intent sonucunun kaynak gösterme / sayfada gösterme isteği olup olmadığını döndürür.
    """

    if not isinstance(intent_result, dict):
        return False

    intent = str(intent_result.get("intent") or "").strip().lower()

    try:
        confidence = float(intent_result.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0

    return intent == "source_navigation" and confidence >= min_confidence


def is_recommendation_request_intent(
    intent_result: dict,
    min_confidence: float = 0.55,
) -> bool:
    """
    Intent sonucunun öneri üretme isteği olup olmadığını döndürür.
    """

    if not isinstance(intent_result, dict):
        return False

    intent = str(intent_result.get("intent") or "").strip().lower()

    try:
        confidence = float(intent_result.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0

    return intent == "recommendation_request" and confidence >= min_confidence