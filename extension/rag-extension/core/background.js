console.log("Adaptive RAG background service worker başlatıldı.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Adaptive RAG extension yüklendi.");
});

/**
 * Backend adresleri.
 *
 * Not:
 * Bazı sistemlerde extension service worker 127.0.0.1'e erişirken sorun çıkarabilir.
 * Bu yüzden önce 127.0.0.1, olmazsa localhost denenir.
 */
const API_BASE_URLS = [
  "http://127.0.0.1:8000",
  "http://localhost:8000"
];

const REQUEST_TIMEOUT_MS = 12000;

function buildUrl(baseUrl, endpoint) {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  const cleanEndpoint = String(endpoint || "").startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  return `${cleanBase}${cleanEndpoint}`;
}

function withTimeout(promise, timeoutMs, url) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Backend isteği zaman aşımına uğradı. URL: ${url}, Timeout: ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function fetchBackendUrl(url, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  };

  if (options.body !== undefined && options.body !== null) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  console.log("[BACKGROUND] Backend isteği:", {
    url,
    method: fetchOptions.method
  });

  const response = await withTimeout(
    fetch(url, fetchOptions),
    REQUEST_TIMEOUT_MS,
    url
  );

  const responseText = await response.text();

  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `Backend JSON olmayan cevap döndürdü. URL: ${url}, Response: ${responseText}`
      );
    }
  }

  if (!response.ok) {
    const detailMessage =
      data?.detail?.message ||
      data?.message ||
      data?.detail ||
      responseText ||
      `Status: ${response.status}`;

    throw new Error(
      `Backend isteği başarısız. URL: ${url}, Status: ${response.status}, Response: ${
        typeof detailMessage === "string"
          ? detailMessage
          : JSON.stringify(detailMessage)
      }`
    );
  }

  return data;
}

async function requestBackend(endpoint, options = {}) {
  const errors = [];

  for (const baseUrl of API_BASE_URLS) {
    const url = buildUrl(baseUrl, endpoint);

    try {
      return await fetchBackendUrl(url, options);
    } catch (error) {
      console.error("[BACKGROUND] Backend adresi başarısız:", {
        url,
        error: error?.message || error
      });

      errors.push(`${url} -> ${error?.message || error}`);
    }
  }

  throw new Error(
    [
      "Backend'e ulaşılamadı.",
      "FastAPI açık olsa bile extension bu adrese erişemiyor olabilir.",
      "manifest.json içinde host_permissions kontrol edilmeli.",
      "",
      ...errors
    ].join("\n")
  );
}

async function sendIngestToBackend(payload) {
  try {
    const result = await requestBackend("/ingest", {
      method: "POST",
      body: payload
    });

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
    const result = await requestBackend("/chat", {
      method: "POST",
      body: payload
    });

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

async function getSourcesFromBackend() {
  try {
    const result = await requestBackend("/sources", {
      method: "GET"
    });

    console.log("[BACKGROUND] /sources response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] /sources hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function getSourceTimelineFromBackend() {
  try {
    const result = await requestBackend("/sources/timeline", {
      method: "GET"
    });

    console.log("[BACKGROUND] /sources/timeline response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] /sources/timeline hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function getSourceDetailFromBackend(sourceId) {
  try {
    if (!sourceId) {
      throw new Error("sourceId boş olamaz.");
    }

    const result = await requestBackend(
      `/sources/${encodeURIComponent(sourceId)}`,
      {
        method: "GET"
      }
    );

    console.log("[BACKGROUND] source detail response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] source detail hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function deleteSourceFromBackend(sourceId) {
  try {
    if (!sourceId) {
      throw new Error("sourceId boş olamaz.");
    }

    const result = await requestBackend(
      `/sources/${encodeURIComponent(sourceId)}`,
      {
        method: "DELETE"
      }
    );

    console.log("[BACKGROUND] delete source response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] delete source hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function getSourceChunksFromBackend(sourceId) {
  try {
    if (!sourceId) {
      throw new Error("sourceId boş olamaz.");
    }

    const result = await requestBackend(
      `/sources/${encodeURIComponent(sourceId)}/chunks`,
      {
        method: "GET"
      }
    );

    console.log("[BACKGROUND] source chunks response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] source chunks hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function getChunkDetailFromBackend(sourceId, chunkId) {
  try {
    if (!sourceId || !chunkId) {
      throw new Error("sourceId ve chunkId boş olamaz.");
    }

    const result = await requestBackend(
      `/sources/${encodeURIComponent(sourceId)}/chunks/${encodeURIComponent(chunkId)}`,
      {
        method: "GET"
      }
    );

    console.log("[BACKGROUND] chunk detail response:", result);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error("[BACKGROUND] chunk detail hatası:", error);

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

  if (request.type === "GET_SOURCES") {
    console.log("[BACKGROUND] Kaynaklar backend'den alınıyor...");

    getSourcesFromBackend().then((result) => {
      sendResponse(result);
    });

    return true;
  }

  if (request.type === "GET_SOURCE_TIMELINE") {
    console.log("[BACKGROUND] Kaynak timeline backend'den alınıyor...");

    getSourceTimelineFromBackend().then((result) => {
      sendResponse(result);
    });

    return true;
  }

  if (request.type === "GET_SOURCE_DETAIL") {
    console.log("[BACKGROUND] Kaynak detayı backend'den alınıyor...");

    const sourceId = request.sourceId || request.payload?.sourceId;

    getSourceDetailFromBackend(sourceId).then((result) => {
      sendResponse(result);
    });

    return true;
  }

  if (request.type === "DELETE_SOURCE") {
    console.log("[BACKGROUND] Kaynak backend'den siliniyor...");

    const sourceId = request.sourceId || request.payload?.sourceId;

    deleteSourceFromBackend(sourceId).then((result) => {
      sendResponse(result);
    });

    return true;
  }

  if (request.type === "GET_SOURCE_CHUNKS") {
    console.log("[BACKGROUND] Kaynak chunk listesi backend'den alınıyor...");

    const sourceId = request.sourceId || request.payload?.sourceId;

    getSourceChunksFromBackend(sourceId).then((result) => {
      sendResponse(result);
    });

    return true;
  }

  if (request.type === "GET_CHUNK_DETAIL") {
    console.log("[BACKGROUND] Chunk detayı backend'den alınıyor...");

    const sourceId = request.sourceId || request.payload?.sourceId;
    const chunkId = request.chunkId || request.payload?.chunkId;

    getChunkDetailFromBackend(sourceId, chunkId).then((result) => {
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