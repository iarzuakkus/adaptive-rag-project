console.log("Adaptive RAG background service worker başlatıldı.");

chrome.runtime.onInstalled.addListener(() => {
  console.log("Adaptive RAG extension yüklendi.");
});