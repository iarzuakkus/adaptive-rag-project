console.log("[CONTENT] Script yüklendi.");

function scrapePageContent() {
  const title = document.title || "";
  const url = window.location.href || "";
  const content = document.body ? document.body.innerText || "" : "";

  return {
    title,
    url,
    content
  };
}

function isPdfPage() {
  const currentUrl = window.location.href.toLowerCase();
  return currentUrl.endsWith(".pdf") || currentUrl.includes(".pdf?");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[CONTENT] Mesaj alındı:", request);

  try {
    if (!request || !request.type) {
      console.error("[CONTENT] Geçersiz request");
      sendResponse({ success: false });
      return;
    }

    if (request.type === "SCRAPE_PAGE") {
      console.log("[CONTENT] SCRAPE_PAGE başladı");

      const rawData = scrapePageContent();

      if (typeof cleanPageContent !== "function") {
        console.error("[CONTENT] cleanPageContent bulunamadı!");
        sendResponse({ success: false });
        return;
      }

      const cleanedData = cleanPageContent(rawData);

      console.log("[CONTENT] Raw Data:", rawData);
      console.log("[CONTENT] Cleaned Data:", cleanedData);

      sendResponse({
        success: true,
        data: cleanedData
      });

      return;
    }

    if (request.type === "CHECK_PDF") {
      sendResponse({
        success: true,
        isPdf: isPdfPage(),
        url: window.location.href
      });
      return;
    }

    console.warn("[CONTENT] Bilinmeyen type");
    sendResponse({ success: false });

  } catch (error) {
    console.error("[CONTENT] HATA:", error);
    sendResponse({
      success: false,
      message: error.message
    });
  }
});