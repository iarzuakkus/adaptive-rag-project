document.addEventListener("DOMContentLoaded", () => {
  console.log("[POPUP] Popup hazır.");

  const tabButtons = document.querySelectorAll(".tab-btn");
  const chatPanel = document.getElementById("chatPanel");
  const scrapePanel = document.getElementById("scrapePanel");

  const scrapeBtn = document.getElementById("scrapeBtn");
  const scrapeStatus = document.getElementById("scrapeStatus");
  const resultBox = document.getElementById("resultBox");
  const resultTitle = document.getElementById("resultTitle");
  const resultUrl = document.getElementById("resultUrl");
  const resultChunkCount = document.getElementById("resultChunkCount");
  const resultPreview = document.getElementById("resultPreview");
  const resultChunks = document.getElementById("resultChunks");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const selectedTab = btn.dataset.tab;

      if (selectedTab === "chat") {
        chatPanel.classList.remove("hidden");
        scrapePanel.classList.add("hidden");
      } else {
        scrapePanel.classList.remove("hidden");
        chatPanel.classList.add("hidden");
      }
    });
  });

  if (!scrapeBtn) {
    console.error("[POPUP] scrapeBtn bulunamadı.");
    return;
  }

  function isRestrictedUrl(url) {
    if (!url) return true;

    return (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("devtools://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")
    );
  }

  scrapeBtn.addEventListener("click", () => {
    scrapeStatus.textContent = "Sayfa taranıyor...";
    resultBox.classList.add("hidden");
    resultChunks.innerHTML = "";

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      console.log("[POPUP] Bulunan sekmeler:", tabs);

      if (!tabs || tabs.length === 0) {
        scrapeStatus.textContent = "Aktif sekme bulunamadı.";
        return;
      }

      const activeTab = tabs[0];
      console.log("[POPUP] Aktif tab:", activeTab);

      if (!activeTab.id) {
        scrapeStatus.textContent = "Aktif sekme ID bilgisi alınamadı.";
        return;
      }

      if (isRestrictedUrl(activeTab.url)) {
        scrapeStatus.textContent =
          "Bu sayfa taranamaz. Normal bir web sayfası açıp tekrar dene.";
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { type: "SCRAPE_PAGE" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("[POPUP] Hata:", chrome.runtime.lastError.message);
            scrapeStatus.textContent =
              "Content script ile bağlantı kurulamadı. Sayfayı yenileyip tekrar dene.";
            return;
          }

          console.log("[POPUP] Response:", response);

          if (!response || !response.success) {
            scrapeStatus.textContent =
              response?.message || "Veri alınamadı.";
            return;
          }

          const data = response.data || {};
          const chunks = Array.isArray(data.chunks) ? data.chunks : [];

          scrapeStatus.textContent = "Sayfa başarıyla tarandı.";
          resultBox.classList.remove("hidden");

          resultTitle.textContent = data.title || "-";
          resultUrl.textContent = data.url || "-";
          resultChunkCount.textContent = data.chunkCount ?? 0;
          resultPreview.textContent = data.preview || "-";

          if (chunks.length === 0) {
            resultChunks.innerHTML =
              `<div class="chunk-item">Chunk bulunamadı.</div>`;
            return;
          }

          const shownChunks = chunks.slice(0, 3);

          shownChunks.forEach((chunk, index) => {
            const chunkEl = document.createElement("div");
            chunkEl.className = "chunk-item";

            chunkEl.innerHTML = `
              <div class="chunk-title">Chunk ${index + 1} (${chunk.type || "unknown"})</div>
              <div class="chunk-text">${chunk.content || "-"}</div>
            `;

            resultChunks.appendChild(chunkEl);
          });
        }
      );
    });
  });
});