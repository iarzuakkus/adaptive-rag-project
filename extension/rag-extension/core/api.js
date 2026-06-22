const API_BASE = "http://127.0.0.1:8000";

async function sendPageData(payload) {
  try {
    const response = await fetch(`${API_BASE}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Ingest isteği başarısız. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("sendPageData hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

async function askQuestion(question, context = {}) {
  try {
    const payload = {
      question,
      page_url: context.page_url || null,
      page_title: context.page_title || null,
      scope: context.scope || "auto",
      top_k: context.top_k || 5
    };

    const response = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Chat isteği başarısız. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("askQuestion hatası:", error);

    return {
      answer: "",
      sources: [],
      source_count: 0,
      status: "error",
      error: error.message
    };
  }
}

async function sendPdfUrl(pdfUrl) {
  try {
    const response = await fetch(`${API_BASE}/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pdf_url: pdfUrl })
    });

    if (!response.ok) {
      throw new Error(`PDF isteği başarısız. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("sendPdfUrl hatası:", error);

    return {
      success: false,
      message: error.message
    };
  }
}

export {
  sendPageData,
  askQuestion,
  sendPdfUrl
};