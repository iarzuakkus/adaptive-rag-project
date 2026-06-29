"""
Dosya: services/llm_service.py

Görev:
- Gemini API ile haberleşir.
- API key'i backend/.env dosyasından okur.
- Chat, özetleme, not çıkarma ve RAG cevapları için tek merkezden LLM cevabı üretir.
- Geçici Gemini hatalarında retry mekanizması uygular.
- Ana model yoğunluktaysa veya erişilemiyorsa fallback model dener.

Bu dosya frontend tarafından doğrudan çağrılmaz.
Frontend -> FastAPI route -> LLMService akışıyla çalışır.
"""

import os
import time
import random
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types


BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_DIR / ".env"

load_dotenv(ENV_PATH)


class LLMService:
    """
    Gemini API ile konuşan ana servis sınıfı.
    """

    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")

        # Not:
        # Eğer .env içinde GEMINI_MODEL yoksa daha güvenli varsayılan model kullanıyoruz.
        # İstersen .env içinde bunu ayrıca değiştirebilirsin.
        self.primary_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

        fallback_models_raw = os.getenv(
            "GEMINI_FALLBACK_MODELS",
            "gemini-2.5-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.1-flash-lite"
        )

        self.fallback_models = [
            model.strip()
            for model in fallback_models_raw.split(",")
            if model.strip()
        ]

        self.models = self._build_model_list()

        self.max_retries = int(os.getenv("GEMINI_MAX_RETRIES", "2"))
        self.retry_base_delay = float(os.getenv("GEMINI_RETRY_BASE_DELAY", "1.2"))
        self.retry_max_delay = float(os.getenv("GEMINI_RETRY_MAX_DELAY", "5"))

        # Hata ayıklarken .env içine LLM_DEBUG=1 yazabilirsin.
        self.debug = os.getenv("LLM_DEBUG", "1") == "1"

        if not self.api_key:
            raise ValueError(
                "GEMINI_API_KEY bulunamadı. Lütfen backend/.env dosyasını kontrol et."
            )

        self.client = genai.Client(api_key=self.api_key)

    def _build_model_list(self) -> list[str]:
        """
        Ana model + fallback modellerden tekrar etmeyen model listesi üretir.
        """

        models = []

        if self.primary_model:
            models.append(self.primary_model)

        for model in self.fallback_models:
            if model and model not in models:
                models.append(model)

        return models

    def _log(self, *args):
        """
        Debug loglarını LLM_DEBUG=1 iken basar.
        """

        if self.debug:
            print(*args)

    def _is_retryable_error(self, exc: Exception) -> bool:
        """
        Gemini tarafındaki geçici hataları ayırt eder.
        """

        message = str(exc).lower()

        retryable_markers = [
            "503",
            "unavailable",
            "high demand",
            "try again later",
            "temporarily",
            "timeout",
            "deadline",
            "429",
            "rate limit",
            "resource exhausted",
            "overloaded",
            "internal",
            "500",
            "502",
            "504",
        ]

        return any(marker in message for marker in retryable_markers)

    def _is_model_fallback_error(self, exc: Exception) -> bool:
        """
        Model erişimi/model adı/model desteği kaynaklı hatalarda
        sıradaki fallback modele geçmek için kullanılır.

        Örnek:
        - model not found
        - permission denied
        - not supported
        - unavailable for this API version
        """

        message = str(exc).lower()

        fallback_markers = [
            "404",
            "not found",
            "model not found",
            "permission denied",
            "forbidden",
            "not supported",
            "is not supported",
            "not available",
            "unavailable for",
            "api version",
            "does not exist",
        ]

        return any(marker in message for marker in fallback_markers)

    def _get_retry_delay(self, attempt: int) -> float:
        """
        Exponential backoff + küçük jitter uygular.
        """

        delay = self.retry_base_delay * (2 ** max(attempt - 1, 0))
        jitter = random.uniform(0, 0.4)

        return min(delay + jitter, self.retry_max_delay)

    def _extract_text(self, response) -> str:
        """
        Gemini response içinden metni güvenli şekilde çıkarır.
        """

        if response is None:
            return ""

        text = getattr(response, "text", None)

        if text:
            return str(text).strip()

        return ""

    def _generate_once(
        self,
        model: str,
        prompt: str,
        system_instruction: Optional[str],
        temperature: float,
        max_output_tokens: int,
    ) -> str:
        """
        Tek bir Gemini isteği atar.
        """

        response = self.client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            ),
        )

        return self._extract_text(response)

    def generate_text(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 1200,
    ) -> str:
        """
        Gemini'den düz metin cevabı üretir.

        Ana model hata verirse fallback modellere geçer.
        """

        if not prompt or not prompt.strip():
            raise ValueError("Prompt boş olamaz.")

        if not self.models:
            raise ValueError("Kullanılabilir Gemini modeli bulunamadı.")

        last_error = None

        self._log("\n[LLM] Kullanılacak model sırası:", self.models)
        self._log("[LLM] Prompt length:", len(prompt))
        self._log("[LLM] System instruction var mı:", bool(system_instruction))

        for model in self.models:
            for attempt in range(1, self.max_retries + 1):
                try:
                    self._log(
                        f"[LLM] model={model} attempt={attempt}/{self.max_retries}"
                    )

                    text = self._generate_once(
                        model=model,
                        prompt=prompt,
                        system_instruction=system_instruction,
                        temperature=temperature,
                        max_output_tokens=max_output_tokens,
                    )

                    if text and text.strip():
                        self._log(f"[LLM] Başarılı model: {model}")
                        return text.strip()

                    last_error = RuntimeError(
                        f"Gemini boş cevap döndürdü. Model: {model}"
                    )

                    self._log(f"[LLM] Boş cevap döndü. model={model}")

                    break

                except Exception as exc:
                    last_error = exc

                    self._log(
                        f"[LLM] Hata aldı. model={model} attempt={attempt} error={exc}"
                    )

                    if self._is_retryable_error(exc):
                        if attempt < self.max_retries:
                            delay = self._get_retry_delay(attempt)

                            self._log(
                                f"[LLM] Geçici hata. Bekleniyor: {delay:.1f}s"
                            )

                            time.sleep(delay)
                            continue

                        self._log(
                            f"[LLM] Retry bitti. Sıradaki modele geçilecek: {model}"
                        )
                        break

                    if self._is_model_fallback_error(exc):
                        self._log(
                            f"[LLM] Model erişim/model adı hatası. "
                            f"Sıradaki modele geçiliyor: {model}"
                        )
                        break

                    raise RuntimeError(
                        f"Gemini API isteği başarısız oldu. "
                        f"Model: {model}. Hata: {exc}"
                    ) from exc

            self._log(f"[LLM] Model başarısız, fallback deneniyor: {model}")

        raise RuntimeError(
            f"Gemini API isteği başarısız oldu. "
            f"Denenen modeller: {', '.join(self.models)}. "
            f"Son hata: {last_error}"
        ) from last_error