"""
Dosya: services/llm_service.py

Görev:
- Gemini API ile haberleşir.
- API key'i backend/.env dosyasından okur.
- Chat, özetleme, not çıkarma ve RAG cevapları için tek merkezden LLM cevabı üretir.

Bu dosya frontend tarafından doğrudan çağrılmaz.
Frontend -> FastAPI route -> LLMService akışıyla çalışır.
"""

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types


# backend/.env dosyasını güvenli şekilde yükler
BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND_DIR / ".env"

load_dotenv(ENV_PATH)


class LLMService:
    """
    Gemini API ile konuşan ana servis sınıfı.
    Projede LLM gereken her yerde bu sınıfı kullanacağız.
    """

    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.model = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

        if not self.api_key:
            raise ValueError(
                "GEMINI_API_KEY bulunamadı. Lütfen backend/.env dosyasını kontrol et."
            )

        self.client = genai.Client(api_key=self.api_key)

    def generate_text(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
        max_output_tokens: int = 1200,
    ) -> str:
        """
        Gemini'den düz metin cevabı üretir.

        Args:
            prompt: Modele gönderilecek kullanıcı/prompt metni.
            system_instruction: Modelin davranışını belirleyen sistem talimatı.
            temperature: Cevabın yaratıcılık seviyesi.
            max_output_tokens: Üretilecek maksimum token sayısı.

        Returns:
            Modelin ürettiği metin cevap.
        """

        if not prompt or not prompt.strip():
            raise ValueError("Prompt boş olamaz.")

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                ),
            )

            return response.text or ""

        except Exception as exc:
            raise RuntimeError(f"Gemini API isteği başarısız oldu: {exc}") from exc


def test_llm_connection():
    """
    Terminalden hızlı test yapmak için kullanılır.
    """

    llm = LLMService()

    answer = llm.generate_text(
        prompt="Adaptive RAG Chrome Extension projesi için tek cümlelik açıklama yaz.",
        system_instruction=(
            "Sen teknik bir yazılım asistanısın. "
            "Kısa, net ve Türkçe cevap ver."
        ),
    )

    print("\nGemini test cevabı:\n")
    print(answer)


if __name__ == "__main__":
    test_llm_connection()