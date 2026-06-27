const API_BASE = "http://127.0.0.1:8000";

async function requestJson(path, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        data?.detail?.message ||
        data?.message ||
        data?.detail ||
        `İstek başarısız. Status: ${response.status}`;

      throw new Error(
        typeof message === "string" ? message : JSON.stringify(message)
      );
    }

    return data;
  } catch (error) {
    console.error(`API hatası: ${path}`, error);

    return {
      success: false,
      message: error.message,
      error: error.message
    };
  }
}

async function sendPageData(payload) {
  return await requestJson("/ingest", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function askQuestion(question, context = {}) {
  const payload = {
    question,
    page_url: context.page_url || null,
    page_title: context.page_title || null,
    scope: context.scope || "auto",
    top_k: context.top_k || 5
  };

  const result = await requestJson("/chat", {
    method: "POST",
    body: JSON.stringify(payload)
  });

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
    sources: result.sources || [],
    chunks: result.chunks || [],
    actions: result.actions || [],
    source_count: result.source_count || 0,
    status: result.status || "success",
    error: result.error || null
  };
}

async function sendPdfUrl(pdfUrl) {
  return await requestJson("/pdf", {
    method: "POST",
    body: JSON.stringify({ pdf_url: pdfUrl })
  });
}

async function getSources() {
  const result = await requestJson("/sources", {
    method: "GET"
  });

  if (!result || result.success === false) {
    return {
      success: false,
      count: 0,
      sources: [],
      message: result?.message || "Kaynaklar getirilemedi."
    };
  }

  return {
    success: true,
    count: result.count || 0,
    sources: result.sources || []
  };
}

async function getSourceTimeline() {
  const result = await requestJson("/sources/timeline", {
    method: "GET"
  });

  if (!result || result.success === false) {
    return {
      success: false,
      count: 0,
      timeline: [],
      message: result?.message || "Kaynak zaman çizelgesi getirilemedi."
    };
  }

  return {
    success: true,
    count: result.count || 0,
    timeline: result.timeline || []
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

  const result = await requestJson(`/sources/${encodeURIComponent(sourceId)}`, {
    method: "GET"
  });

  if (!result || result.success === false) {
    return {
      success: false,
      source: null,
      message: result?.message || "Kaynak detayı getirilemedi."
    };
  }

  return {
    success: true,
    source: result.source || null
  };
}

async function deleteSource(sourceId) {
  if (!sourceId) {
    return {
      success: false,
      message: "sourceId boş olamaz."
    };
  }

  const result = await requestJson(`/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE"
  });

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
    result: result.result || null
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

  const result = await requestJson(
    `/sources/${encodeURIComponent(sourceId)}/chunks`,
    {
      method: "GET"
    }
  );

  if (!result || result.success === false) {
    return {
      success: false,
      count: 0,
      chunks: [],
      message: result?.message || "Kaynak chunk listesi getirilemedi."
    };
  }

  return {
    success: true,
    source_id: result.source_id || sourceId,
    count: result.count || 0,
    chunks: result.chunks || []
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

  const result = await requestJson(
    `/sources/${encodeURIComponent(sourceId)}/chunks/${encodeURIComponent(chunkId)}`,
    {
      method: "GET"
    }
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
    chunk: result.chunk || null
  };
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
  getChunkDetail
};