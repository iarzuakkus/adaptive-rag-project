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
  - Öneri üretme payload'ını kırpmaz; mode ve exclude alanlarını backend'e taşır.
  - Not üretme isteğini /notes/generate endpoint'ine gönderir.
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
  const NOTE_TIMEOUT_MS = 90000;

  /* -------------------- URL Yardımcıları -------------------- */

  function buildUrl(baseUrl, endpoint) {
    const cleanBase = String(baseUrl || "").replace(/\/+$/, "");

    const cleanEndpoint = String(endpoint || "").startsWith("/")
      ? endpoint
      : `/${endpoint}`;

    return `${cleanBase}${cleanEndpoint}`;
  }

  function buildQueryString(params = {}) {
    const query = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return;
      }

      query.set(key, String(value));
    });

    const queryText = query.toString();

    return queryText ? `?${queryText}` : "";
  }

  /* -------------------- İstek Yardımcıları -------------------- */

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
    const timeoutMs =
      options.timeoutMs || DEFAULT_TIMEOUT_MS;

    const fetchOptions = {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    };

    if (
      options.body !== undefined &&
      options.body !== null
    ) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    console.log("[BACKEND CLIENT] Backend isteği:", {
      url,
      method: fetchOptions.method,
      timeoutMs,
      body: options.body || null
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
        console.error(
          "[BACKEND CLIENT] Backend adresi başarısız:",
          {
            url,
            error: error?.message || error
          }
        );

        errors.push(
          `${url} -> ${error?.message || error}`
        );
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
      console.error(
        `[BACKEND CLIENT] ${label} hatası:`,
        error
      );

      return {
        success: false,
        message:
          error?.message ||
          `${label} işlemi başarısız oldu.`,
        error:
          error?.message ||
          `${label} işlemi başarısız oldu.`
      };
    }
  }

  /* -------------------- Genel Normalizasyon -------------------- */

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeString(value, fallback = "") {
    if (value === undefined || value === null) {
      return fallback;
    }

    return String(value).trim();
  }

  /* -------------------- Öneri Payload -------------------- */

  function normalizeRecommendationMode(payload = {}) {
    const mode = String(
      payload.mode ||
      payload.generation_mode ||
      ""
    )
      .trim()
      .toLowerCase();

    if (mode === "expand") {
      return "expand";
    }

    return "refresh";
  }

  function buildRecommendationPayload(payload = {}) {
    const mode = normalizeRecommendationMode(payload);

    return {
      sources: safeArray(payload.sources),
      source_count: Number(
        payload.source_count ||
        payload.sourceCount ||
        0
      ),
      force: payload.force === true,

      mode,
      generation_mode: mode,
      reason: String(payload.reason || ""),

      exclude_recommendations: safeArray(
        payload.exclude_recommendations
      ),
      exclude_urls: safeArray(
        payload.exclude_urls
      ),
      exclude_queries: safeArray(
        payload.exclude_queries
      ),
      exclude_titles: safeArray(
        payload.exclude_titles
      ),
      exclude_domains: safeArray(
        payload.exclude_domains
      )
    };
  }

  /* -------------------- Not Payload -------------------- */

  function normalizeNoteType(payload = {}) {
    const noteType = safeString(
      payload.note_type ||
      payload.noteType ||
      "research_note"
    ).toLowerCase();

    const allowedTypes = new Set([
      "research_note",
      "lecture_note",
      "summary_note"
    ]);

    if (allowedTypes.has(noteType)) {
      return noteType;
    }

    return "research_note";
  }

  function buildNotePayload(payload = {}) {
    const sources = safeArray(payload.sources);

    const personalNotes = safeArray(
      payload.personal_notes ||
      payload.personalNotes
    );

    return {
      note_type: normalizeNoteType(payload),

      custom_title: safeString(
        payload.custom_title ||
        payload.customTitle
      ),

      language: safeString(
        payload.language,
        "tr"
      ) || "tr",

      sources,

      personal_notes: personalNotes,

      source_count: Number(
        payload.source_count ||
        payload.sourceCount ||
        sources.length ||
        0
      ),

      personal_note_count: Number(
        payload.personal_note_count ||
        payload.personalNoteCount ||
        personalNotes.length ||
        0
      ),

      session_id: safeString(
        payload.session_id ||
        payload.sessionId
      ),

      force: payload.force === true
    };
  }

  /* -------------------- Ingest -------------------- */

  function sendIngest(payload) {
    return safeRequest("/ingest", () =>
      requestBackend("/ingest", {
        method: "POST",
        body: payload,
        timeoutMs: INGEST_TIMEOUT_MS
      })
    );
  }

  /* -------------------- Chat -------------------- */

  function sendChat(payload) {
    return safeRequest("/chat", () =>
      requestBackend("/chat", {
        method: "POST",
        body: payload,
        timeoutMs: CHAT_TIMEOUT_MS
      })
    );
  }

  /* -------------------- PDF -------------------- */

  function sendPdfUrl(payload) {
    return safeRequest("/pdf", () =>
      requestBackend("/pdf", {
        method: "POST",
        body: payload,
        timeoutMs: PDF_TIMEOUT_MS
      })
    );
  }

  /* -------------------- Kaynaklar -------------------- */

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

      return requestBackend(
        `/sources/${encodeURIComponent(sourceId)}`,
        {
          method: "GET"
        }
      );
    });
  }

  function deleteSource(sourceId) {
    return safeRequest("delete source", () => {
      if (!sourceId) {
        throw new Error("sourceId boş olamaz.");
      }

      return requestBackend(
        `/sources/${encodeURIComponent(sourceId)}`,
        {
          method: "DELETE"
        }
      );
    });
  }

  function getSourceChunks(sourceId) {
    return safeRequest("source chunks", () => {
      if (!sourceId) {
        throw new Error("sourceId boş olamaz.");
      }

      return requestBackend(
        `/sources/${encodeURIComponent(sourceId)}/chunks`,
        {
          method: "GET"
        }
      );
    });
  }

  function getChunkDetail(sourceId, chunkId) {
    return safeRequest("chunk detail", () => {
      if (!sourceId || !chunkId) {
        throw new Error(
          "sourceId ve chunkId boş olamaz."
        );
      }

      return requestBackend(
        `/sources/${encodeURIComponent(sourceId)}/chunks/${encodeURIComponent(chunkId)}`,
        {
          method: "GET"
        }
      );
    });
  }

  /* -------------------- Öneriler -------------------- */

  function getRecommendations(payload = {}) {
    const queryString = buildQueryString({
      source_count:
        payload.source_count ||
        payload.sourceCount ||
        "",
      mode: "refresh"
    });

    return safeRequest(
      "/research/recommendations GET",
      () =>
        requestBackend(
          `/research/recommendations${queryString}`,
          {
            method: "GET",
            timeoutMs: DEFAULT_TIMEOUT_MS
          }
        )
    );
  }

  function generateRecommendations(payload = {}) {
    const requestPayload =
      buildRecommendationPayload(payload);

    console.log(
      "[BACKEND CLIENT] Recommendation payload:",
      requestPayload
    );

    return safeRequest(
      "/research/recommendations POST",
      () =>
        requestBackend("/research/recommendations", {
          method: "POST",
          body: requestPayload,
          timeoutMs: RECOMMENDATION_TIMEOUT_MS
        })
    );
  }

  /* -------------------- Notlar -------------------- */

  function generateNote(payload = {}) {
    const requestPayload = buildNotePayload(payload);

    console.log(
      "[BACKEND CLIENT] Note payload:",
      requestPayload
    );

    return safeRequest(
      "/notes/generate POST",
      () =>
        requestBackend("/notes/generate", {
          method: "POST",
          body: requestPayload,
          timeoutMs: NOTE_TIMEOUT_MS
        })
    );
  }

  /* -------------------- Dış API -------------------- */

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

    getRecommendations,
    generateRecommendations,

    generateNote
  };
})();