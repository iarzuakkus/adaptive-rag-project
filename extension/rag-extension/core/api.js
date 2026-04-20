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

async function askQuestion(question) {
  try {
    const response = await fetch(`${API_BASE}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      throw new Error(`Query isteği başarısız. Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("askQuestion hatası:", error);
    return {
      success: false,
      answer: "",
      message: error.message
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