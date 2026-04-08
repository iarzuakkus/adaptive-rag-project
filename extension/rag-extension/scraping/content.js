console.log("Adaptive RAG content script aktif.");

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
  const url = window.location.href.toLowerCase();
  return url.endsWith(".pdf") || url.includes(".pdf?");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.type === "SCRAPE_PAGE") {
      const data = scrapePageContent();

      sendResponse({
        success: true,
        data
      });
    }

    if (request.type === "CHECK_PDF") {
      sendResponse({
        success: true,
        isPdf: isPdfPage(),
        url: window.location.href
      });
    }
  } catch (error) {
    sendResponse({
      success: false,
      message: error.message
    });
  }

  return true;
});