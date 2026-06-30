"""
Dosya: agents/research_agent.py

Görev:
- Taranan kaynaklardan LLM destekli araştırma önerileri üretir.
- Kaynak bağlamını prompt haline getirir.
- LLM'den 3-5 adet yapılandırılmış öneri ister.
- Dönen cevabı JSON olarak ayrıştırır ve normalize eder.

Not:
- Bu dosya endpoint değildir.
- Endpoint: routes/research.py
- Servis: services/research_service.py
"""

from __future__ import annotations

from typing import Any
import json
import re
import uuid


DEFAULT_LIMIT = 5
MIN_LIMIT = 3
MAX_LIMIT = 5


def clean_text(value: Any, max_length: int | None = None) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)

    if max_length and len(text) > max_length:
        return text[:max_length].strip() + "..."

    return text


def normalize_limit(limit: int | None) -> int:
    try:
        value = int(limit or DEFAULT_LIMIT)
    except Exception:
        value = DEFAULT_LIMIT

    return max(MIN_LIMIT, min(value, MAX_LIMIT))


def make_id() -> str:
    return f"llm_rec_{uuid.uuid4().hex[:10]}"


def extract_json_text(text: str) -> str:
    """
    LLM bazen JSON'u ```json bloğu içinde veya açıklama metniyle birlikte döndürebilir.
    Bu fonksiyon JSON kısmını ayıklar.
    """

    value = str(text or "").strip()

    if not value:
        return ""

    fenced_match = re.search(
        r"```(?:json)?\s*(.*?)```",
        value,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if fenced_match:
        value = fenced_match.group(1).strip()

    if value.startswith("{") or value.startswith("["):
        return value

    object_start = value.find("{")
    object_end = value.rfind("}")

    if object_start != -1 and object_end != -1 and object_end > object_start:
        return value[object_start:object_end + 1]

    array_start = value.find("[")
    array_end = value.rfind("]")

    if array_start != -1 and array_end != -1 and array_end > array_start:
        return value[array_start:array_end + 1]

    return value


def parse_json_response(text: str) -> Any:
    json_text = extract_json_text(text)

    if not json_text:
        return None

    try:
        return json.loads(json_text)
    except Exception:
        pass

    cleaned = (
        json_text
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )

    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)

    try:
        return json.loads(cleaned)
    except Exception as error:
        print("[RESEARCH AGENT] JSON parse edilemedi:", error)
        print("[RESEARCH AGENT] Ham cevap:", text[:1200])
        return None


def build_recommendation_prompt(context: str, sources: list[dict[str, Any]], limit: int) -> str:
    """
    Prompt dosyası varsa onu kullanır.
    Yoksa dahili prompt ile devam eder.
    """

    try:
        from prompts.recommendation_prompt import build_recommendation_prompt as prompt_builder

        return prompt_builder(
            context=context,
            sources=sources,
            limit=limit,
        )
    except Exception:
        pass

    safe_limit = normalize_limit(limit)

    return f"""
Sen MemorAI adlı kişisel araştırma asistanının araştırma öneri ajanısın.

Görevin:
Kullanıcının daha önce taradığı kaynakları analiz ederek araştırmayı genişletecek {safe_limit} adet öneri üretmek.

Kurallar:
- Sadece verilen kaynak bağlamına dayan.
- Uydurma gerçek URL üretme.
- Gerçek URL bilmiyorsan url alanını boş string bırak.
- Her öneri araştırılabilir, kısa ve anlaşılır olmalı.
- Öneriler birbirinin tekrarı olmamalı.
- Öneriler kullanıcının sonraki araştırma adımını yönlendirmeli.
- Cevabı sadece geçerli JSON olarak döndür.
- Markdown kullanma.
- Açıklama metni ekleme.

Dönüş formatı:
{{
  "recommendations": [
    {{
      "title": "Öneri başlığı",
      "summary": "Bu öneride ne araştırılacağına dair 1-2 cümlelik açıklama.",
      "reason": "Bu önerinin mevcut kaynaklarla neden ilişkili olduğunu açıklayan kısa gerekçe.",
      "query": "Bu öneri için kullanılabilecek arama sorgusu",
      "url": "",
      "domain": "Araştırma önerisi",
      "type": "Kavram araştırması"
    }}
  ]
}}

Öneri türleri şunlardan biri olabilir:
- Kavram araştırması
- Karşılaştırmalı araştırma
- Örnek odaklı araştırma
- İleri okuma
- Soru üretimi
- Güncel kaynak araştırması
- Teknik detay araştırması

Kaynak bağlamı:
{context}
""".strip()


async def call_llm(prompt: str) -> str:
    """
    Projedeki mevcut llm_service yapısına uyumlu çalışmaya çalışır.

    Amaç:
    - llm_service içinde hangi metod varsa onu kullanmak.
    - Bu dosyayı tek bir LLM servis adına aşırı bağımlı yapmamak.
    """

    try:
        from services import llm_service
    except Exception as error:
        print("[RESEARCH AGENT] llm_service import edilemedi:", error)
        return ""

    possible_async_functions = [
        "generate_text",
        "generate_content",
        "ask_llm",
        "call_llm",
        "complete",
        "chat",
    ]

    for function_name in possible_async_functions:
        fn = getattr(llm_service, function_name, None)

        if callable(fn):
            try:
                result = fn(
                    prompt,
                    temperature=0.35,
                    max_output_tokens=1400,
                )

                if hasattr(result, "__await__"):
                    result = await result

                return extract_text_from_llm_result(result)
            except TypeError:
                try:
                    result = fn(prompt)

                    if hasattr(result, "__await__"):
                        result = await result

                    return extract_text_from_llm_result(result)
                except Exception as error:
                    print(f"[RESEARCH AGENT] llm_service.{function_name} hatası:", error)
            except Exception as error:
                print(f"[RESEARCH AGENT] llm_service.{function_name} hatası:", error)

    llm_service_class = getattr(llm_service, "LLMService", None)

    if llm_service_class:
      try:
          service = llm_service_class()

          possible_methods = [
              "generate_text",
              "generate_content",
              "ask",
              "complete",
              "chat",
          ]

          for method_name in possible_methods:
              method = getattr(service, method_name, None)

              if not callable(method):
                  continue

              try:
                  result = method(
                      prompt,
                      temperature=0.35,
                      max_output_tokens=1400,
                  )

                  if hasattr(result, "__await__"):
                      result = await result

                  return extract_text_from_llm_result(result)
              except TypeError:
                  try:
                      result = method(prompt)

                      if hasattr(result, "__await__"):
                          result = await result

                      return extract_text_from_llm_result(result)
                  except Exception as error:
                      print(f"[RESEARCH AGENT] LLMService.{method_name} hatası:", error)
              except Exception as error:
                  print(f"[RESEARCH AGENT] LLMService.{method_name} hatası:", error)
      except Exception as error:
          print("[RESEARCH AGENT] LLMService oluşturulamadı:", error)

    print("[RESEARCH AGENT] Uygun LLM metodu bulunamadı.")
    return ""


def extract_text_from_llm_result(result: Any) -> str:
    """
    Farklı LLM servis dönüşlerini string'e çevirir.
    """

    if result is None:
        return ""

    if isinstance(result, str):
        return result

    if isinstance(result, dict):
        for key in [
            "text",
            "content",
            "answer",
            "response",
            "output",
            "message",
        ]:
            value = result.get(key)

            if isinstance(value, str) and value.strip():
                return value

        candidates = result.get("candidates")

        if isinstance(candidates, list) and candidates:
            return extract_text_from_llm_result(candidates[0])

        return json.dumps(result, ensure_ascii=False)

    text_attr = getattr(result, "text", None)

    if isinstance(text_attr, str) and text_attr.strip():
        return text_attr

    content_attr = getattr(result, "content", None)

    if isinstance(content_attr, str) and content_attr.strip():
        return content_attr

    return str(result or "")


def normalize_recommendation(item: dict[str, Any], index: int) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    title = clean_text(
        item.get("title")
        or item.get("heading")
        or item.get("query_title")
        or item.get("search_title")
        or "",
        180,
    )

    summary = clean_text(
        item.get("summary")
        or item.get("description")
        or item.get("snippet")
        or item.get("content")
        or "",
        520,
    )

    reason = clean_text(
        item.get("reason")
        or item.get("why")
        or item.get("why_recommended")
        or item.get("recommendation_reason")
        or "",
        520,
    )

    query = clean_text(
        item.get("query")
        or item.get("search_query")
        or item.get("searchQuery")
        or item.get("keyword")
        or "",
        260,
    )

    url = clean_text(
        item.get("url")
        or item.get("source_url")
        or item.get("page_url")
        or item.get("target_url")
        or "",
        500,
    )

    domain = clean_text(
        item.get("domain")
        or item.get("site")
        or item.get("hostname")
        or "",
        140,
    )

    recommendation_type = clean_text(
        item.get("type")
        or item.get("category")
        or item.get("label")
        or "Öneri",
        80,
    )

    if not title and not summary and not query and not url:
        return None

    return {
        "id": clean_text(item.get("id") or item.get("recommendation_id") or "") or make_id(),
        "title": title or f"Araştırma önerisi {index + 1}",
        "summary": summary or "Bu öneri için açıklama oluşturulamadı.",
        "reason": reason or "Bu öneri mevcut kaynak bağlamına göre üretildi.",
        "query": query,
        "url": url,
        "domain": domain or "Araştırma önerisi",
        "type": recommendation_type,
    }


def extract_recommendation_list(parsed: Any) -> list[Any]:
    if isinstance(parsed, list):
        return parsed

    if not isinstance(parsed, dict):
        return []

    for key in [
        "recommendations",
        "items",
        "results",
        "sources",
        "recommended_sources",
    ]:
        value = parsed.get(key)

        if isinstance(value, list):
            return value

    return []


def normalize_recommendations(parsed: Any, limit: int) -> list[dict[str, Any]]:
    safe_limit = normalize_limit(limit)
    raw_items = extract_recommendation_list(parsed)

    normalized = []

    for index, item in enumerate(raw_items):
        normalized_item = normalize_recommendation(item, index)

        if normalized_item:
            normalized.append(normalized_item)

        if len(normalized) >= safe_limit:
            break

    return normalized


async def generate_recommendations_with_llm(
    context: str,
    sources: list[dict[str, Any]] | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict[str, Any]]:
    """
    Taranan kaynak bağlamından LLM ile öneri üretir.

    Dönüş:
    - Başarılıysa normalize edilmiş öneri listesi
    - Başarısızsa boş liste

    Boş liste dönerse research_service fallback öneriler üretir.
    """

    safe_context = clean_text(context, 9000)
    safe_limit = normalize_limit(limit)

    if not safe_context:
        return []

    prompt = build_recommendation_prompt(
        context=safe_context,
        sources=sources or [],
        limit=safe_limit,
    )

    llm_text = await call_llm(prompt)

    if not llm_text:
        return []

    parsed = parse_json_response(llm_text)

    if not parsed:
        return []

    recommendations = normalize_recommendations(parsed, safe_limit)

    print("[RESEARCH AGENT] LLM öneri sayısı:", len(recommendations))

    return recommendations