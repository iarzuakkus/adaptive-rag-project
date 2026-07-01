/*
  Dosya: background.js

  Görev:
  - Extension service worker dosyasıdır.
  - Frontend/content script mesajlarını dinler.
  - Backend işlemlerini backend-client.js üzerinden yürütür.

  Not:
  - Backend fetch detayları burada tutulmaz.
  - Timeout, backend adresleri ve endpoint çağrıları backend-client.js içindedir.
  - Bu dosya sadece mesaj yönlendirme yapar.
*/

importScripts("backend-client.js");

console.log("Adaptive RAG background service worker başlatıldı.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Adaptive RAG extension yüklendi.");
});

function getBackendClient() {
  return self.AdaptiveRagBackendClient;
}

function getPayload(request) {
  return request?.payload || {};
}

function getSourceId(request) {
  return request?.sourceId || request?.payload?.sourceId || "";
}

function getChunkId(request) {
  return request?.chunkId || request?.payload?.chunkId || "";
}

function callBackendMethod(backend, methodName, ...args) {
  if (!backend || typeof backend[methodName] !== "function") {
    throw new Error(
      `Backend client içinde ${methodName} metodu bulunamadı. backend-client.js dosyasını güncelle.`
    );
  }

  return backend[methodName](...args);
}

function sendAsyncResponse(promise, sendResponse) {
  promise
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      sendResponse({
        success: false,
        message: error?.message || "Background işlemi başarısız oldu.",
        error: error?.message || "Background işlemi başarısız oldu."
      });
    });

  return true;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[BACKGROUND] Mesaj alındı:", request);

  if (!request || !request.type) {
    sendResponse({
      success: false,
      message: "Geçersiz request."
    });

    return true;
  }

  const backend = getBackendClient();

  if (!backend) {
    sendResponse({
      success: false,
      message: "Backend client yüklenemedi."
    });

    return true;
  }

  const handlers = {
    INGEST_DATA: () => backend.sendIngest(getPayload(request)),

    CHAT_QUESTION: () => backend.sendChat(getPayload(request)),

    PDF_URL: () => backend.sendPdfUrl(getPayload(request)),

    GET_SOURCES: () => backend.getSources(),

    GET_SOURCE_TIMELINE: () => backend.getSourceTimeline(),

    GET_SOURCE_DETAIL: () => backend.getSourceDetail(getSourceId(request)),

    DELETE_SOURCE: () => backend.deleteSource(getSourceId(request)),

    GET_SOURCE_CHUNKS: () => backend.getSourceChunks(getSourceId(request)),

    GET_CHUNK_DETAIL: () =>
      backend.getChunkDetail(getSourceId(request), getChunkId(request)),

    GET_RECOMMENDATIONS: () =>
      callBackendMethod(
        backend,
        "getRecommendations",
        getPayload(request)
      ),

    GENERATE_RECOMMENDATIONS: () =>
      callBackendMethod(
        backend,
        "generateRecommendations",
        getPayload(request)
      ),

    REFRESH_RECOMMENDATIONS: () =>
      callBackendMethod(
        backend,
        "getRecommendations",
        getPayload(request)
      ),

    EXPAND_RECOMMENDATIONS: () =>
      callBackendMethod(
        backend,
        "generateRecommendations",
        {
          ...getPayload(request),
          force: true,
          mode: "expand",
          generation_mode: "expand"
        }
      )
  };

  const handler = handlers[request.type];

  if (!handler) {
    sendResponse({
      success: false,
      message: `Bilinmeyen request type: ${request.type}`
    });

    return true;
  }

  return sendAsyncResponse(handler(), sendResponse);
});
