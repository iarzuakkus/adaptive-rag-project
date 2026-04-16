console.log("Adaptive RAG background service worker başlatıldı.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Adaptive RAG extension yüklendi.");
});

// BACKEND URL
const API_BASE = "http://127.0.0.1:8000";

// BACKEND'e veri gönderme fonksiyonu
async function sendToBackend(payload) {
  try {
    const response = await fetch(`${API_BASE}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    console.log("[BACKGROUND] Backend response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] Backend hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

// MESAJ DİNLEYİCİ
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[BACKGROUND] Mesaj alındı:", request);

  if (!request || !request.type) {
    sendResponse({ success: false, message: "Geçersiz request" });
    return true;
  }

  // SCRAPED DATA BACKEND'E GİDİYOR
  if (request.type === "INGEST_DATA") {
    console.log("[BACKGROUND] Veri backend'e gönderiliyor...");

    sendToBackend(request.payload).then((result) => {
      sendResponse(result);
    });

    return true; // async olduğu için önemli
  }

  sendResponse({ success: false, message: "Bilinmeyen request type" });
  return true;
});