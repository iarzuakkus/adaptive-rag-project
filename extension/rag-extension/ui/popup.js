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

  function resetResultArea() {
    resultBox.classList.add("hidden");
    resultChunks.innerHTML = "";
    resultTitle.textContent = "-";
    resultUrl.textContent = "-";
    resultChunkCount.textContent = "0";
    resultPreview.textContent = "-";
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderChunkItem(chunk, index) {
    const chunkEl = document.createElement("div");
    chunkEl.className = "chunk-item";

    const type = chunk.type || "unknown";
    const content = escapeHtml(chunk.content || "-");
    const tag = chunk.tag ? ` | tag: ${escapeHtml(chunk.tag)}` : "";
    const textLength =
      typeof chunk.textLength === "number" ? ` | len: ${chunk.textLength}` : "";
    const linkDensity =
      typeof chunk.linkDensity === "number"
        ? ` | linkDensity: ${chunk.linkDensity}`
        : "";

    chunkEl.innerHTML = `
      <div class="chunk-title">Chunk ${index + 1} (${escapeHtml(type)}${tag}${textLength}${linkDensity})</div>
      <div class="chunk-text">${content}</div>
    `;

    return chunkEl;
  }

  function buildPreviewFromBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return "";
    }

    return blocks
      .slice(0, 3)
      .map((block, index) => {
        const tag = block?.tag ? `[${block.tag}] ` : "";
        const text = block?.text || "-";
        return `${index + 1}. ${tag}${text}`;
      })
      .join("\n\n---\n\n");
  }

  scrapeBtn.addEventListener("click", () => {
    scrapeStatus.textContent = "Sayfa taranıyor...";
    resetResultArea();

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
          const blockChunks = Array.isArray(data.blockChunks) ? data.blockChunks : [];
          const blocks = Array.isArray(data.blocks) ? data.blocks : [];

          const preferredChunks = blockChunks.length > 0 ? blockChunks : chunks;

          const blockChunkCount =
            typeof data.blockChunkCount === "number"
              ? data.blockChunkCount
              : blockChunks.length;

          const structuredChunkCount =
            typeof data.chunkCount === "number"
              ? data.chunkCount
              : chunks.length;

          scrapeStatus.textContent = "Sayfa başarıyla tarandı.";
          resultBox.classList.remove("hidden");

          resultTitle.textContent = data.title || "-";
          resultUrl.textContent = data.url || "-";
          resultChunkCount.textContent =
            `Block Chunk: ${blockChunkCount} | Structured Chunk: ${structuredChunkCount}`;

          const previewFromBlocks = buildPreviewFromBlocks(blocks);

          if (previewFromBlocks) {
            resultPreview.textContent = previewFromBlocks;
          } else if (data.preview) {
            resultPreview.textContent = data.preview;
          } else {
            resultPreview.textContent = "-";
          }

          if (preferredChunks.length === 0) {
            resultChunks.innerHTML =
              `<div class="chunk-item">Chunk bulunamadı.</div>`;
            return;
          }

          const shownChunks = preferredChunks.slice(0, 5);

          shownChunks.forEach((chunk, index) => {
            const chunkEl = renderChunkItem(chunk, index);
            resultChunks.appendChild(chunkEl);
          });
        }
      );
    });
  });
});