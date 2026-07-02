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

/* -------------------- Yardımcılar -------------------- */

function getBackendClient() {
  return self.AdaptiveRagBackendClient;
}

function getPayload(request) {
  return request?.payload || {};
}

function getSourceId(request) {
  return (
    request?.sourceId ||
    request?.payload?.sourceId ||
    request?.payload?.source_id ||
    ""
  );
}

function getChunkId(request) {
  return (
    request?.chunkId ||
    request?.payload?.chunkId ||
    request?.payload?.chunk_id ||
    ""
  );
}

function getPersonalNoteId(request) {
  return (
    request?.noteId ||
    request?.note_id ||
    request?.id ||
    request?.payload?.noteId ||
    request?.payload?.note_id ||
    request?.payload?.id ||
    ""
  );
}

function callBackendMethod(
  backend,
  methodName,
  ...args
) {
  if (
    !backend ||
    typeof backend[methodName] !== "function"
  ) {
    throw new Error(
      `Backend client içinde ${methodName} metodu bulunamadı. backend-client.js dosyasını güncelle.`
    );
  }

  return backend[methodName](...args);
}

function sendAsyncResponse(
  promise,
  sendResponse
) {
  Promise.resolve(promise)
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      console.error(
        "[BACKGROUND] İşlem başarısız:",
        error
      );

      sendResponse({
        success: false,
        message:
          error?.message ||
          "Background işlemi başarısız oldu.",
        error:
          error?.message ||
          "Background işlemi başarısız oldu."
      });
    });

  return true;
}

/* -------------------- Mesaj Dinleyici -------------------- */

chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    console.log(
      "[BACKGROUND] Mesaj alındı:",
      request
    );

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
      /* -------------------- Ingest -------------------- */

      INGEST_DATA: () =>
        callBackendMethod(
          backend,
          "sendIngest",
          getPayload(request)
        ),

      /* -------------------- Chat -------------------- */

      CHAT_QUESTION: () =>
        callBackendMethod(
          backend,
          "sendChat",
          getPayload(request)
        ),

      /* -------------------- PDF -------------------- */

      PDF_URL: () =>
        callBackendMethod(
          backend,
          "sendPdfUrl",
          getPayload(request)
        ),

      /* -------------------- Kaynaklar -------------------- */

      GET_SOURCES: () =>
        callBackendMethod(
          backend,
          "getSources"
        ),

      GET_SOURCE_TIMELINE: () =>
        callBackendMethod(
          backend,
          "getSourceTimeline"
        ),

      GET_SOURCE_DETAIL: () =>
        callBackendMethod(
          backend,
          "getSourceDetail",
          getSourceId(request)
        ),

      DELETE_SOURCE: () =>
        callBackendMethod(
          backend,
          "deleteSource",
          getSourceId(request)
        ),

      GET_SOURCE_CHUNKS: () =>
        callBackendMethod(
          backend,
          "getSourceChunks",
          getSourceId(request)
        ),

      GET_CHUNK_DETAIL: () =>
        callBackendMethod(
          backend,
          "getChunkDetail",
          getSourceId(request),
          getChunkId(request)
        ),

      /* -------------------- Öneriler -------------------- */

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
        ),

      /* -------------------- Oluşturulan Notlar -------------------- */

      GENERATE_NOTE: () =>
        callBackendMethod(
          backend,
          "generateNote",
          getPayload(request)
        ),

      /* -------------------- Kişisel Notlar -------------------- */

      SAVE_PERSONAL_NOTE: () =>
        callBackendMethod(
          backend,
          "savePersonalNote",
          getPayload(request)
        ),

      DELETE_PERSONAL_NOTE: () =>
        callBackendMethod(
          backend,
          "deletePersonalNote",
          getPersonalNoteId(request)
        ),

      CLEAR_PERSONAL_NOTES_SESSION: () =>
        callBackendMethod(
          backend,
          "clearPersonalNotesSession",
          getPayload(request)
        )
    };

    const handler = handlers[request.type];

    if (!handler) {
      sendResponse({
        success: false,
        message:
          `Bilinmeyen request type: ${request.type}`
      });

      return true;
    }

    try {
      return sendAsyncResponse(
        handler(),
        sendResponse
      );
    } catch (error) {
      console.error(
        "[BACKGROUND] Handler çalıştırılamadı:",
        error
      );

      sendResponse({
        success: false,
        message:
          error?.message ||
          "Background handler çalıştırılamadı.",
        error:
          error?.message ||
          "Background handler çalıştırılamadı."
      });

      return true;
    }
  }
);