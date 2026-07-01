"""
Dosya: agents/research_agent.py

Görev:
- Taranan kaynaklardan LLM destekli araştırma önerileri üretir.
- Kaynak bağlamını prompt haline getirir.
- LLM'den 3-5 adet yapılandırılmış öneri ister.
- Dönen cevabı JSON olarak ayrıştırır.
- Normalize işlemini services/research/recommendation_normalizer.py modülüne bırakır.

Not:
- Bu dosya endpoint değildir.
- Endpoint: routes/research.py
- Servis: services/research_service.py
"""

from __future__ import annotations

from typing import Any
import inspect
import json
import re

from services.research.recommendation_normalizer import normalize_recommendations
from services.research.url_filters import clean_text, safe_list


DEFAULT_LIMIT = 5
MIN_LIMIT = 3
MAX_LIMIT = 5


def normalize_limit(limit: int | None) -> int:
    try:
        value = int(limit or DEFAULT_LIMIT)
    except Exception:
        value = DEFAULT_LIMIT

    return max(MIN_LIMIT, min(value, MAX_LIMIT))


def normalize_generation_mode(mode: str | None = None, generation_mode: str | None = None) -> str:
    raw_mode = clean_text(generation_mode or mode or "refresh", 40).lower()

    if raw_mode == "expand":
        return "expand"

    return "refresh"


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


def build_exclude_context_text(exclude_payload: dict[str, list[str]] | None = None) -> str:
    excludes = exclude_payload or {}

    exclude_urls = safe_list(excludes.get("exclude_urls"))[:10]
    exclude_queries = safe_list(excludes.get("exclude_queries"))[:10]
    exclude_titles = safe_list(excludes.get("exclude_titles"))[:10]
    exclude_domains = safe_list(excludes.get("exclude_domains"))[:10]

    parts: list[str] = []

    if exclude_titles:
        parts.append("Tekrar edilmemesi gereken öneri başlıkları:")
        parts.extend([f"- {clean_text(title, 220)}" for title in exclude_titles if clean_text(title)])

    if exclude_queries:
        parts.append("Tekrar edilmemesi gereken arama sorguları:")
        parts.extend([f"- {clean_text(query, 220)}" for query in exclude_queries if clean_text(query)])

    if exclude_domains:
        parts.append("Mümkünse tekrar edilmemesi gereken domainler:")
        parts.extend([f"- {clean_text(domain, 160)}" for domain in exclude_domains if clean_text(domain)])

    if exclude_urls:
        parts.append("Tekrar önerilmemesi gereken URL'ler:")
        parts.extend([f"- {clean_text(url, 300)}" for url in exclude_urls if clean_text(url)])

    return "\n".join(parts).strip()


def build_internal_recommendation_prompt(
    context: str,
    sources: list[dict[str, Any]],
    limit: int,
    mode: str = "refresh",
    exclude_payload: dict[str, list[str]] | None = None,
) -> str:
    safe_limit = normalize_limit(limit)
    safe_mode = normalize_generation_mode(mode)
    exclude_text = build_exclude_context_text(exclude_payload)

    if safe_mode == "expand":
        mode_instruction = """
Bu istek ÖNERİ OLUŞTUR modundadır.

Bu modda amacın:
- Mevcut önerileri yenilemek değil, araştırmayı genişletmek.
- Aynı başlıkları, aynı arama sorgularını ve aynı URL'leri tekrar üretmemek.
- Kullanıcıya farklı siteler, farklı araştırma açıları ve yeni kaynak yönleri önermek.
- Mümkün olduğunca mevcut önerilerden farklı query üretmek.
- Aynı fikri küçük kelime değişiklikleriyle tekrar etmemek.
""".strip()
    else:
        mode_instruction = """
Bu istek YENİLE modundadır.

Bu modda amacın:
- Mevcut kaynak bağlamını güncellemek.
- Kullanıcının taradığı kaynaklara göre en alakalı önerileri yeniden üretmek.
- Araştırma yönünü netleştirmek.
""".strip()

    exclude_block = ""

    if exclude_text:
        exclude_block = f"""
Tekrar edilmemesi gereken mevcut öneri bilgileri:
{exclude_text}
""".strip()

    return f"""
Sen MemorAI adlı kişisel araştırma asistanının araştırma öneri ajanısın.

Görevin:
Kullanıcının daha önce taradığı kaynakları analiz ederek araştırmayı geliştirecek {safe_limit} adet öneri üretmek.

Mod bilgisi:
{mode_instruction}

Kurallar:
- Sadece verilen kaynak bağlamına dayan.
- Uydurma gerçek URL üretme.
- Gerçek URL bilmiyorsan url alanını boş string bırak.
- Her öneri araştırılabilir, kısa ve anlaşılır olmalı.
- Öneriler birbirinin tekrarı olmamalı.
- Öneriler kullanıcının sonraki araştırma adımını yönlendirmeli.
- Arama sorguları web search için kullanılabilir olmalı.
- Cevabı sadece geçerli JSON olarak döndür.
- Markdown kullanma.
- Açıklama metni ekleme.

{exclude_block}

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
- Alternatif kaynak
- Eleştirel araştırma
- Vaka araştırması

Kaynak bağlamı:
{context}
""".strip()


def build_recommendation_prompt(
    context: str,
    sources: list[dict[str, Any]],
    limit: int,
    mode: str = "refresh",
    exclude_payload: dict[str, list[str]] | None = None,
) -> str:
    """
    prompts/recommendation_prompt.py varsa onu kullanır.
    Prompt builder yeni parametreleri desteklemiyorsa dahili prompt ile devam eder.
    """

    try:
        from prompts.recommendation_prompt import build_recommendation_prompt as prompt_builder

        signature = inspect.signature(prompt_builder)

        kwargs: dict[str, Any] = {
            "context": context,
            "sources": sources,
            "limit": limit,
        }

        if "mode" in signature.parameters:
            kwargs["mode"] = mode

        if "generation_mode" in signature.parameters:
            kwargs["generation_mode"] = mode

        if "exclude_payload" in signature.parameters:
            kwargs["exclude_payload"] = exclude_payload or {}

        return prompt_builder(**kwargs)
    except Exception as error:
        print("[RESEARCH AGENT] Harici recommendation_prompt kullanılamadı:", error)

    return build_internal_recommendation_prompt(
        context=context,
        sources=sources,
        limit=limit,
        mode=mode,
        exclude_payload=exclude_payload,
    )


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

        if not callable(fn):
            continue

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


async def generate_recommendations_with_llm(
    context: str,
    sources: list[dict[str, Any]] | None = None,
    limit: int = DEFAULT_LIMIT,
    mode: str = "refresh",
    generation_mode: str | None = None,
    exclude_payload: dict[str, list[str]] | None = None,
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
    safe_mode = normalize_generation_mode(mode=mode, generation_mode=generation_mode)

    if not safe_context:
        return []

    prompt = build_recommendation_prompt(
        context=safe_context,
        sources=sources or [],
        limit=safe_limit,
        mode=safe_mode,
        exclude_payload=exclude_payload or {},
    )

    llm_text = await call_llm(prompt)

    if not llm_text:
        return []

    parsed = parse_json_response(llm_text)

    if not parsed:
        return []

    recommendations = normalize_recommendations(
        recommendations=parsed,
        limit=safe_limit,
        mode=safe_mode,
        exclude_payload=exclude_payload or {},
    )

    print("[RESEARCH AGENT] LLM öneri sayısı:", len(recommendations))

    return recommendations