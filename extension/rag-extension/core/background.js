console.log("Adaptive RAG background service worker başlatıldı.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Adaptive RAG extension yüklendi.");
});

const API_BASE = "http://127.0.0.1:8000";

async function postToBackend(endpoint, payload) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Backend isteği başarısız. Endpoint: ${endpoint}, Status: ${response.status}, Response: ${responseText}`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Backend JSON olmayan cevap döndürdü. Endpoint: ${endpoint}, Response: ${responseText}`
    );
  }
}

async function sendIngestToBackend(payload) {
  try {
    const result = await postToBackend("/ingest", payload);

    console.log("[BACKGROUND] /ingest response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] /ingest hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function sendChatToBackend(payload) {
  try {
    const result = await postToBackend("/chat", payload);

    console.log("[BACKGROUND] /chat response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] /chat hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[BACKGROUND] Mesaj alındı:", request);

  if (!request || !request.type) {
    sendResponse({
      success: false,
      message: "Geçersiz request"
    });

    return true;
  }

  if (request.type === "INGEST_DATA") {
    console.log("[BACKGROUND] Veri backend'e gönderiliyor...");

    sendIngestToBackend(request.payload).then((result) => {
      sendResponse(result);
    });

    return true;
  }

  if (request.type === "CHAT_QUESTION") {
    console.log("[BACKGROUND] Chat sorusu backend'e gönderiliyor...");

    sendChatToBackend(request.payload).then((result) => {
      sendResponse(result);
    });

    return true;
  }

  sendResponse({
    success: false,
    message: `Bilinmeyen request type: ${request.type}`
  });

  return true;
});