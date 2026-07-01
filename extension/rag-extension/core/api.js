/*
  Dosya: api.js

  Görev:
  - Frontend/widget/content script tarafı için API yardımcı fonksiyonlarını sağlar.
  - Backend'e doğrudan fetch atmaz.
  - Tüm backend isteklerini background.js üzerinden gönderir.

  Akış:
  UI / content script
  → api.js
  → chrome.runtime.sendMessage
  → background.js
  → backend-client.js
  → FastAPI

  Not:
  - API_BASE burada tutulmaz.
  - Timeout burada yönetilmez.
  - Backend adresleri sadece backend-client.js içinde kalmalıdır.
  - Bu dosya sadece frontend tarafında kullanılacak sade API arayüzüdür.
*/

function hasRuntimeMessaging() {
  return Boolean(
    typeof chrome !== "undefined" &&
    chrome.runtime &&
    typeof chrome.runtime.sendMessage === "function"
  );
}

function sendRuntimeMessage(type, payload = {}, extra = {}) {
  return new Promise((resolve) => {
    try {
      if (!hasRuntimeMessaging()) {
        resolve({
          success: false,
          message: "chrome.runtime.sendMessage kullanılamıyor."
        });

        return;
      }

      chrome.runtime.sendMessage(
        {
          type,
          payload,
          ...extra
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              message: chrome.runtime.lastError.message
            });

            return;
          }

          resolve(response || null);
        }
      );
    } catch (error) {
      resolve({
        success: false,
        message: error?.message || "Background mesajı gönderilemedi."
      });
    }
  });
}

async function requestBackground(
  type,
  payload = {},
  extra = {},
  fallbackMessage = "İstek başarısız."
) {
  const response = await sendRuntimeMessage(type, payload, extra);

  if (!response?.success) {
    return {
      success: false,
      message: response?.message || fallbackMessage,
      error: response?.error || response?.message || fallbackMessage
    };
  }

  const data = response.data;

  if (!data) {
    return {
      success: true
    };
  }

  if (typeof data.success === "boolean") {
    return data;
  }

  return {
    success: true,
    ...data
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRecommendationMode(payload = {}) {
  const mode = String(
    payload.mode ||
    payload.generation_mode ||
    ""
  ).trim().toLowerCase();

  if (mode === "expand") {
    return "expand";
  }

  return "refresh";
}

function buildRecommendationPayload(payload = {}) {
  const mode = normalizeRecommendationMode(payload);

  return {
    sources: safeArray(payload.sources),
    source_count: Number(payload.source_count || payload.sourceCount || 0),
    force: payload.force === true,

    mode,
    generation_mode: mode,
    reason: String(payload.reason || ""),

    exclude_recommendations: safeArray(payload.exclude_recommendations),
    exclude_urls: safeArray(payload.exclude_urls),
    exclude_queries: safeArray(payload.exclude_queries),
    exclude_titles: safeArray(payload.exclude_titles),
    exclude_domains: safeArray(payload.exclude_domains)
  };
}

async function sendPageData(payload) {
  return await requestBackground(
    "INGEST_DATA",
    payload,
    {},
    "Sayfa backend'e gönderilemedi."
  );
}

async function askQuestion(question, context = {}) {
  const payload = {
    question,
    page_url: context.page_url || null,
    page_title: context.page_title || null,
    scope: context.scope || "auto",
    top_k: context.top_k || 5
  };

  const result = await requestBackground(
    "CHAT_QUESTION",
    payload,
    {},
    "Chat isteği başarısız."
  );

  if (!result || result.success === false) {
    return {
      answer: "",
      sources: [],
      chunks: [],
      actions: [],
      source_count: 0,
      status: "error",
      error: result?.error || result?.message || "Chat isteği başarısız."
    };
  }

  return {
    answer: result.answer || "",
    sources: safeArray(result.sources),
    chunks: safeArray(result.chunks),
    actions: safeArray(result.actions),
    source_count: Number(result.source_count || 0),
    status: result.status || "success",
    answer_type: result.answer_type || result.answerType || "",
    intent: result.intent || null,
    error: result.error || null
  };
}

async function sendPdfUrl(pdfUrl) {
  return await requestBackground(
    "PDF_URL",
    {
      pdf_url: pdfUrl
    },
    {},
    "PDF isteği başarısız."
  );
}

async function getSources() {
  const result = await requestBackground(
    "GET_SOURCES",
    {},
    {},
    "Kaynaklar getirilemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      count: 0,
      sources: [],
      message: result?.message || "Kaynaklar getirilemedi."
    };
  }

  const sources = safeArray(result.sources);

  return {
    success: true,
    count: Number(result.count || sources.length || 0),
    sources
  };
}

async function getSourceTimeline() {
  const result = await requestBackground(
    "GET_SOURCE_TIMELINE",
    {},
    {},
    "Kaynak zaman çizelgesi getirilemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      count: 0,
      timeline: [],
      message: result?.message || "Kaynak zaman çizelgesi getirilemedi."
    };
  }

  const timeline = safeArray(result.timeline);

  return {
    success: true,
    count: Number(result.count || timeline.length || 0),
    timeline
  };
}

async function getSourceDetail(sourceId) {
  if (!sourceId) {
    return {
      success: false,
      source: null,
      message: "sourceId boş olamaz."
    };
  }

  const result = await requestBackground(
    "GET_SOURCE_DETAIL",
    {
      sourceId
    },
    {
      sourceId
    },
    "Kaynak detayı getirilemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      source: null,
      message: result?.message || "Kaynak detayı getirilemedi."
    };
  }

  return {
    success: true,
    source: result.source || result
  };
}

async function deleteSource(sourceId) {
  if (!sourceId) {
    return {
      success: false,
      message: "sourceId boş olamaz."
    };
  }

  const result = await requestBackground(
    "DELETE_SOURCE",
    {
      sourceId
    },
    {
      sourceId
    },
    "Kaynak silinemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      message: result?.message || "Kaynak silinemedi.",
      result: result?.result || null
    };
  }

  return {
    success: true,
    message: result.message || "Kaynak başarıyla silindi.",
    result: result.result || result || null
  };
}

async function getSourceChunks(sourceId) {
  if (!sourceId) {
    return {
      success: false,
      count: 0,
      chunks: [],
      message: "sourceId boş olamaz."
    };
  }

  const result = await requestBackground(
    "GET_SOURCE_CHUNKS",
    {
      sourceId
    },
    {
      sourceId
    },
    "Kaynak chunk listesi getirilemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      count: 0,
      chunks: [],
      message: result?.message || "Kaynak chunk listesi getirilemedi."
    };
  }

  const chunks = safeArray(result.chunks);

  return {
    success: true,
    source_id: result.source_id || sourceId,
    count: Number(result.count || chunks.length || 0),
    chunks
  };
}

async function getChunkDetail(sourceId, chunkId) {
  if (!sourceId || !chunkId) {
    return {
      success: false,
      chunk: null,
      message: "sourceId ve chunkId boş olamaz."
    };
  }

  const result = await requestBackground(
    "GET_CHUNK_DETAIL",
    {
      sourceId,
      chunkId
    },
    {
      sourceId,
      chunkId
    },
    "Chunk detayı getirilemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      chunk: null,
      message: result?.message || "Chunk detayı getirilemedi."
    };
  }

  return {
    success: true,
    chunk: result.chunk || result
  };
}

async function generateRecommendations(payload = {}) {
  const recommendationPayload = buildRecommendationPayload(payload);

  const result = await requestBackground(
    "GENERATE_RECOMMENDATIONS",
    recommendationPayload,
    {},
    "Öneriler üretilemedi."
  );

  if (!result || result.success === false) {
    return {
      success: false,
      status: "error",
      recommendations: [],
      source_count: Number(recommendationPayload.source_count || 0),
      message: result?.message || "Öneriler üretilemedi.",
      error: result?.error || result?.message || "Öneriler üretilemedi."
    };
  }

  const recommendations = safeArray(result.recommendations);

  return {
    success: true,
    status: result.status || "ok",
    source: result.source || "",
    force: result.force === true,
    mode: result.mode || recommendationPayload.mode,
    generation_mode: result.generation_mode || recommendationPayload.generation_mode,
    recommendations,
    source_count: Number(result.source_count || recommendationPayload.source_count || 0),
    analyzed_sources: Number(result.analyzed_sources || result.source_count || 0),
    web_search: result.web_search === true,
    web_found_count: Number(result.web_found_count || 0),
    generated_at: result.generated_at || result.generatedAt || ""
  };
}

async function refreshRecommendations(payload = {}) {
  return await generateRecommendations({
    ...payload,
    force: true,
    mode: "refresh",
    generation_mode: "refresh",
    reason: payload.reason || "manual_refresh"
  });
}

async function expandRecommendations(payload = {}) {
  return await generateRecommendations({
    ...payload,
    force: true,
    mode: "expand",
    generation_mode: "expand",
    reason: payload.reason || "manual_expand"
  });
}

export {
  sendPageData,
  askQuestion,
  sendPdfUrl,
  getSources,
  getSourceTimeline,
  getSourceDetail,
  deleteSource,
  getSourceChunks,
  getChunkDetail,
  generateRecommendations,
  refreshRecommendations,
  expandRecommendations
};