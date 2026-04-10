import { cleanPageContent } from "./cleaner.js";

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
  const currentUrl = window.location.href.toLowerCase();
  return currentUrl.endsWith(".pdf") || currentUrl.includes(".pdf?");
}

function handleScrapePage(sendResponse) {
  const rawData = scrapePageContent();

  // TEMİZLEME BURADA YAPILIYOR
  const cleanedData = cleanPageContent(rawData);

  console.log("Raw Data:", rawData);
  console.log("Cleaned Data:", cleanedData);

  sendResponse({
    success: true,
    data: cleanedData
  });
}

function handleCheckPdf(sendResponse) {
  sendResponse({
    success: true,
    isPdf: isPdfPage(),
    url: window.location.href
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.type === "SCRAPE_PAGE") {
      handleScrapePage(sendResponse);
      return true;
    }

    if (request.type === "CHECK_PDF") {
      handleCheckPdf(sendResponse);
      return true;
    }

    sendResponse({
      success: false,
      message: "Bilinmeyen istek tipi."
    });
  } catch (error) {
    sendResponse({
      success: false,
      message: error.message || "Bir hata oluştu."
    });
  }

  return true;
});