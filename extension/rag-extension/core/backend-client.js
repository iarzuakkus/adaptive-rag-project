/*
  Dosya: backend-client.js

  Görev:
  - FastAPI backend ile iletişimi yönetir.
  - Backend adreslerini, timeout yönetimini ve endpoint çağrılarını burada toplar.
  - background.js dosyasını sade tutar.

  Not:
  - Bu dosya Chrome extension service worker içinde importScripts ile yüklenir.
  - window kullanılmaz.
  - Mock veri üretmez.
*/

(function () {
  if (self.AdaptiveRagBackendClient?.__moduleName === "backend-client") {
    return;
  }

  const API_BASE_URLS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000"
  ];

  const DEFAULT_TIMEOUT_MS = 15000;
  const INGEST_TIMEOUT_MS = 60000;
  const CHAT_TIMEOUT_MS = 45000;
  const PDF_TIMEOUT_MS = 60000;
  const RECOMMENDATION_TIMEOUT_MS = 60000;

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
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

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

    console.log("[BACKEND CLIENT] Backend isteği:", {
      url,
      method: fetchOptions.method,
      timeoutMs
    });

    const response = await withTimeout(
      fetch(url, fetchOptions),
      timeoutMs,
      url
    );

    const responseText = await response.text();

    let data = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
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
        console.error("[BACKEND CLIENT] Backend adresi başarısız:", {
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

  async function safeRequest(label, callback) {
    try {
      const data = await callback();

      return {
        success: true,
        data
      };
    } catch (error) {
      console.error(`[BACKEND CLIENT] ${label} hatası:`, error);

      return {
        success: false,
        message: error?.message || `${label} işlemi başarısız oldu.`,
        error: error?.message || `${label} işlemi başarısız oldu.`
      };
    }
  }

  function sendIngest(payload) {
    return safeRequest("/ingest", () =>
      requestBackend("/ingest", {
        method: "POST",
        body: payload,
        timeoutMs: INGEST_TIMEOUT_MS
      })
    );
  }

  function sendChat(payload) {
    return safeRequest("/chat", () =>
      requestBackend("/chat", {
        method: "POST",
        body: payload,
        timeoutMs: CHAT_TIMEOUT_MS
      })
    );
  }

  function sendPdfUrl(payload) {
    return safeRequest("/pdf", () =>
      requestBackend("/pdf", {
        method: "POST",
        body: payload,
        timeoutMs: PDF_TIMEOUT_MS
      })
    );
  }

  function getSources() {
    return safeRequest("/sources", () =>
      requestBackend("/sources", {
        method: "GET"
      })
    );
  }

  function getSourceTimeline() {
    return safeRequest("/sources/timeline", () =>
      requestBackend("/sources/timeline", {
        method: "GET"
      })
    );
  }

  function getSourceDetail(sourceId) {
    return safeRequest("source detail", () => {
      if (!sourceId) {
        throw new Error("sourceId boş olamaz.");
      }

      return requestBackend(`/sources/${encodeURIComponent(sourceId)}`, {
        method: "GET"
      });
    });
  }

  function deleteSource(sourceId) {
    return safeRequest("delete source", () => {
      if (!sourceId) {
        throw new Error("sourceId boş olamaz.");
      }

      return requestBackend(`/sources/${encodeURIComponent(sourceId)}`, {
        method: "DELETE"
      });
    });
  }

  function getSourceChunks(sourceId) {
    return safeRequest("source chunks", () => {
      if (!sourceId) {
        throw new Error("sourceId boş olamaz.");
      }

      return requestBackend(`/sources/${encodeURIComponent(sourceId)}/chunks`, {
        method: "GET"
      });
    });
  }

  function getChunkDetail(sourceId, chunkId) {
    return safeRequest("chunk detail", () => {
      if (!sourceId || !chunkId) {
        throw new Error("sourceId ve chunkId boş olamaz.");
      }

      return requestBackend(
        `/sources/${encodeURIComponent(sourceId)}/chunks/${encodeURIComponent(chunkId)}`,
        {
          method: "GET"
        }
      );
    });
  }

  function generateRecommendations(payload) {
    return safeRequest("/research/recommendations", () =>
      requestBackend("/research/recommendations", {
        method: "POST",
        body: {
          sources: Array.isArray(payload?.sources) ? payload.sources : [],
          source_count: Number(payload?.source_count || 0),
          force: payload?.force === true
        },
        timeoutMs: RECOMMENDATION_TIMEOUT_MS
      })
    );
  }

  self.AdaptiveRagBackendClient = {
    __moduleName: "backend-client",

    sendIngest,
    sendChat,
    sendPdfUrl,
    getSources,
    getSourceTimeline,
    getSourceDetail,
    deleteSource,
    getSourceChunks,
    getChunkDetail,
    generateRecommendations
  };
})();