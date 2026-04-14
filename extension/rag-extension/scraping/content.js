console.log("[CONTENT] Script yüklendi.");

function removeNoise() {
  try {
    document
      .querySelectorAll("nav, header, footer, aside, script, style, noscript")
      .forEach((el) => el.remove());
  } catch (error) {
    console.error("[CONTENT] removeNoise hatası:", error);
  }
}

function extractStructuredContent() {
  removeNoise();

  const data = {
    title: document.title || "",
    url: window.location.href || "",
    content: {
      headings: [],
      paragraphs: [],
      lists: []
    }
  };

  document.querySelectorAll("h1, h2, h3").forEach((el) => {
    const text = (el.innerText || "").trim();
    if (text.length > 5) {
      data.content.headings.push(text);
    }
  });

  document.querySelectorAll("p").forEach((el) => {
    const text = (el.innerText || "").trim();
    if (text.length > 20) {
      data.content.paragraphs.push(text);
    }
  });

  document.querySelectorAll("li").forEach((el) => {
    const text = (el.innerText || "").trim();
    if (text.length > 5) {
      data.content.lists.push(text);
    }
  });

  return data;
}

function isPdfPage() {
  const currentUrl = window.location.href.toLowerCase();
  return currentUrl.endsWith(".pdf") || currentUrl.includes(".pdf?");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[CONTENT] Mesaj alındı:", request);

  try {
    if (!request || !request.type) {
      sendResponse({
        success: false,
        message: "Geçersiz request"
      });
      return true;
    }

    if (request.type === "SCRAPE_PAGE") {
      console.log("[CONTENT] SCRAPE_PAGE başladı");

      const structuredData = extractStructuredContent();
      console.log("[CONTENT] Structured data:", structuredData);

      if (typeof cleanPageContent === "function") {
        const cleanedData = cleanPageContent(structuredData);
        console.log("[CONTENT] Cleaned data:", cleanedData);

        sendResponse({
          success: true,
          data: cleanedData
        });
      } else {
        console.warn("[CONTENT] cleanPageContent bulunamadı, ham veri dönülüyor.");

        sendResponse({
          success: true,
          data: structuredData
        });
      }

      return true;
    }

    if (request.type === "CHECK_PDF") {
      sendResponse({
        success: true,
        isPdf: isPdfPage(),
        url: window.location.href
      });
      return true;
    }

    sendResponse({
      success: false,
      message: "Bilinmeyen request type"
    });
    return true;
  } catch (error) {
    console.error("[CONTENT] HATA:", error);

    sendResponse({
      success: false,
      message: error.message || "Bilinmeyen content script hatası"
    });

    return true;
  }
});