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
    if (resultBox) {
      resultBox.classList.add("hidden");
    }

    if (resultChunks) {
      resultChunks.innerHTML = "";
    }

    if (resultTitle) {
      resultTitle.textContent = "-";
    }

    if (resultUrl) {
      resultUrl.textContent = "-";
    }

    if (resultChunkCount) {
      resultChunkCount.textContent = "0";
    }

    if (resultPreview) {
      resultPreview.textContent = "-";
    }
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

    const type = chunk?.type || "unknown";
    const content = escapeHtml(chunk?.content || "-");
    const tag = chunk?.tag ? ` | tag: ${escapeHtml(chunk.tag)}` : "";
    const textLength =
      typeof chunk?.textLength === "number"
        ? ` | len: ${chunk.textLength}`
        : "";
    const linkDensity =
      typeof chunk?.linkDensity === "number"
        ? ` | linkDensity: ${chunk.linkDensity}`
        : "";
    const score =
      typeof chunk?.score === "number"
        ? ` | score: ${chunk.score}`
        : "";

    chunkEl.innerHTML = `
      <div class="chunk-title">
        Chunk ${index + 1} (${escapeHtml(type)}${tag}${textLength}${linkDensity}${score})
      </div>
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
        const score =
          typeof block?.score === "number" ? ` (score: ${block.score})` : "";
        const text = block?.text || "-";

        return `${index + 1}. ${tag}${text}${score}`;
      })
      .join("\n\n---\n\n");
  }

  function renderResult(data) {
    const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
    const blockChunks = Array.isArray(data?.blockChunks) ? data.blockChunks : [];
    const allChunks = Array.isArray(data?.allChunks) ? data.allChunks : [];
    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    const topBlocks = Array.isArray(data?.topBlocks) ? data.topBlocks : [];

    const preferredChunks =
      allChunks.length > 0
        ? allChunks
        : blockChunks.length > 0
          ? blockChunks
          : chunks;

    const blockChunkCount =
      typeof data?.blockChunkCount === "number"
        ? data.blockChunkCount
        : blockChunks.length;

    const structuredChunkCount =
      typeof data?.chunkCount === "number"
        ? data.chunkCount
        : chunks.length;

    const allChunkCount =
      typeof data?.allChunkCount === "number"
        ? data.allChunkCount
        : allChunks.length;

    scrapeStatus.textContent = "Sayfa başarıyla tarandı.";

    if (resultBox) {
      resultBox.classList.remove("hidden");
    }

    if (resultTitle) {
      resultTitle.textContent = data?.title || "-";
    }

    if (resultUrl) {
      resultUrl.textContent = data?.url || "-";
    }

    if (resultChunkCount) {
      if (allChunkCount > 0) {
        resultChunkCount.textContent =
          `All Chunk: ${allChunkCount} | Block Chunk: ${blockChunkCount} | Structured Chunk: ${structuredChunkCount}`;
      } else {
        resultChunkCount.textContent =
          `Block Chunk: ${blockChunkCount} | Structured Chunk: ${structuredChunkCount}`;
      }
    }

    const previewFromBlocks = buildPreviewFromBlocks(
      topBlocks.length > 0 ? topBlocks : blocks
    );

    if (resultPreview) {
      if (previewFromBlocks) {
        resultPreview.textContent = previewFromBlocks;
      } else if (data?.preview) {
        resultPreview.textContent = data.preview;
      } else {
        resultPreview.textContent = "-";
      }
    }

    if (resultChunks) {
      resultChunks.innerHTML = "";

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

    if (topBlocks.length > 0) {
      console.log("[POPUP] Top blocks:", topBlocks);
    }

    console.log("[POPUP] Final rendered data:", data);
  }

  scrapeBtn.addEventListener("click", () => {
    scrapeStatus.textContent = "Sayfa taranıyor...";
    resetResultArea();

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log("[POPUP] Bulunan sekmeler:", tabs);

      if (!tabs || tabs.length === 0) {
        scrapeStatus.textContent = "Aktif sekme bulunamadı.";
        return;
      }

      const activeTab = tabs[0];
      console.log("[POPUP] Aktif tab:", activeTab);

      if (!activeTab?.id) {
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

          renderResult(response.data || {});
        }
      );
    });
  });
});