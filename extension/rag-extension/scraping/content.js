console.log("[CONTENT] Script yüklendi.");

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

      const data =
        typeof cleanPageContent === "function"
          ? cleanPageContent(structuredData)
          : structuredData;

      console.log("[CONTENT] Final data:", data);

      sendResponse({
        success: true,
        data
      });

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