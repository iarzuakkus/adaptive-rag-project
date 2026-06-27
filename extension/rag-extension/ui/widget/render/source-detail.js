/**
 * Dosya: source-detail.js
 *
 * Görev:
 * - Kaynaklar sekmesinde "Detay" butonuna basıldığında kaynak detay ekranını açar.
 * - Backend'den gelen source metadata ve chunk listesini gösterir.
 * - Kaynak özeti, temel bilgiler ve chunk preview alanını üretir.
 * - Kaynağa git, kapat, chunk highlight ve chunk'ı chat'e sor aksiyonları için temel butonları hazırlar.
 *
 * Not:
 * - Bu dosya backend'e doğrudan istek atmaz.
 * - source-events.js backend'den detayı alır ve bu modüle source objesini verir.
 * - Mock veri üretmez.
 */

(function () {
  if (window.AdaptiveRagSourceDetail?.__moduleName === "source-detail") {
    return;
  }

  const DETAIL_OVERLAY_ID = "ragSourceDetailOverlay";

  let activeSource = null;

  function escapeHtml(text) {
    if (window.AdaptiveRagState?.escapeHtml) {
      return window.AdaptiveRagState.escapeHtml(text);
    }

    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function trimText(text, maxLength = 260) {
    if (window.AdaptiveRagState?.trimText) {
      return window.AdaptiveRagState.trimText(text, maxLength);
    }

    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    try {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return value;
    }
  }

  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch {
      return url || "";
    }
  }

  function getOverlay() {
    let overlay = document.getElementById(DETAIL_OVERLAY_ID);

    if (overlay) {
      return overlay;
    }

    overlay = document.createElement("div");
    overlay.id = DETAIL_OVERLAY_ID;
    overlay.className = "rag-source-detail-overlay";

    document.body.appendChild(overlay);

    return overlay;
  }

  function closeSourceDetail() {
    const overlay = document.getElementById(DETAIL_OVERLAY_ID);

    if (overlay) {
      overlay.remove();
    }

    activeSource = null;
  }

  function openSourceDetail(source) {
    if (!source) {
      return;
    }

    activeSource = source;

    const overlay = getOverlay();

    overlay.innerHTML = renderSourceDetail(source);

    bindDetailEvents(overlay);
  }

  function renderSourceDetail(source) {
    const title = source.title || "Başlıksız kaynak";
    const url = source.url || "";
    const domain = source.domain || getShortUrl(url);
    const scannedAt = formatDate(source.scanned_at);
    const summary = source.summary || "Bu kaynak için özet henüz oluşturulmadı.";
    const chunks = Array.isArray(source.chunks) ? source.chunks : [];
    const chunkCount = source.chunk_count || chunks.length || 0;

    return `
      <div class="rag-source-detail-backdrop" data-source-detail-close="1"></div>

      <section
        class="rag-source-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Kaynak detayı"
      >
        <div class="rag-source-detail-header">
          <div>
            <span class="rag-source-detail-kicker">Kaynak detayı</span>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(domain || url)}</p>
          </div>

          <button
            class="rag-icon-btn rag-source-detail-close-btn"
            type="button"
            aria-label="Kaynak detayını kapat"
          >
            ×
          </button>
        </div>

        <div class="rag-source-detail-meta">
          <div>
            <span>Tarama zamanı</span>
            <strong>${escapeHtml(scannedAt || "Bilinmiyor")}</strong>
          </div>

          <div>
            <span>Parça sayısı</span>
            <strong>${chunkCount}</strong>
          </div>

          <div>
            <span>Durum</span>
            <strong>${escapeHtml(source.status || "ready")}</strong>
          </div>
        </div>

        <div class="rag-source-detail-actions">
          ${
            url
              ? `
                <button
                  class="rag-secondary-btn rag-source-detail-open-url-btn"
                  type="button"
                  data-url="${escapeHtml(url)}"
                >
                  Kaynağa git
                </button>
              `
              : ""
          }

          <button
            class="rag-secondary-btn rag-source-detail-ask-btn"
            type="button"
            data-source-id="${escapeHtml(source.source_id || "")}"
          >
            Bu kaynağı chat’e sor
          </button>
        </div>

        <div class="rag-source-detail-section">
          <div class="rag-subtitle">Özet</div>
          <p class="rag-source-detail-summary">
            ${escapeHtml(summary)}
          </p>
        </div>

        <div class="rag-source-detail-section">
          <div class="rag-subtitle">Kaynak parçaları</div>

          ${
            chunks.length
              ? renderChunkPreviewList(chunks)
              : renderEmptyChunks()
          }
        </div>
      </section>
    `;
  }

  function renderChunkPreviewList(chunks) {
    return `
      <div class="rag-source-detail-chunks">
        ${chunks.map(renderChunkPreview).join("")}
      </div>
    `;
  }

  function renderChunkPreview(chunk, index) {
    const text = chunk.text || chunk.content || chunk.chunk_text || "";
    const chunkIndex = chunk.chunk_index ?? index;
    const sourceId = chunk.source_id || activeSource?.source_id || "";
    const chunkId = chunk.chunk_id || "";

    return `
      <article
        class="rag-source-detail-chunk"
        data-source-id="${escapeHtml(sourceId)}"
        data-chunk-id="${escapeHtml(chunkId)}"
      >
        <div class="rag-source-detail-chunk-head">
          <strong>Parça ${Number(chunkIndex) + 1}</strong>

          <div class="rag-source-detail-chunk-actions">
            <button
              class="rag-secondary-btn small rag-source-detail-highlight-btn"
              type="button"
              data-source-id="${escapeHtml(sourceId)}"
              data-chunk-id="${escapeHtml(chunkId)}"
            >
              Kaynakta göster
            </button>

            <button
              class="rag-secondary-btn small rag-source-detail-ask-chunk-btn"
              type="button"
              data-source-id="${escapeHtml(sourceId)}"
              data-chunk-id="${escapeHtml(chunkId)}"
            >
              Chat’e sor
            </button>
          </div>
        </div>

        <p>${escapeHtml(trimText(text, 420))}</p>
      </article>
    `;
  }

  function renderEmptyChunks() {
    return `
      <div class="rag-empty-state compact">
        <strong>Parça bulunamadı.</strong>
        <span>Bu kaynak için backend chunk listesi döndürmedi.</span>
      </div>
    `;
  }

  function bindDetailEvents(overlay) {
    overlay.addEventListener("click", (event) => {
      const closeTarget = event.target.closest(
        ".rag-source-detail-close-btn, [data-source-detail-close='1']"
      );

      if (closeTarget) {
        event.preventDefault();
        closeSourceDetail();
        return;
      }

      const openUrlButton = event.target.closest(".rag-source-detail-open-url-btn");

      if (openUrlButton) {
        event.preventDefault();

        const url = openUrlButton.dataset.url;

        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }

        return;
      }

      const askSourceButton = event.target.closest(".rag-source-detail-ask-btn");

      if (askSourceButton) {
        event.preventDefault();
        handleAskSource(askSourceButton);
        return;
      }

      const askChunkButton = event.target.closest(".rag-source-detail-ask-chunk-btn");

      if (askChunkButton) {
        event.preventDefault();
        handleAskChunk(askChunkButton);
        return;
      }

      const highlightButton = event.target.closest(".rag-source-detail-highlight-btn");

      if (highlightButton) {
        event.preventDefault();
        handleHighlightChunk(highlightButton);
      }
    });
  }

  function switchToChatTab() {
    if (window.AdaptiveRagState?.setActiveTab) {
      window.AdaptiveRagState.setActiveTab("chat");
    }

    if (window.AdaptiveRagWidget?.renderActiveTab) {
      window.AdaptiveRagWidget.renderActiveTab();
    }
  }

  function fillChatInput(question) {
    const possibleInputs = [
      document.querySelector("#ragChatInput"),
      document.querySelector("#ragChatTextarea"),
      document.querySelector("[data-rag-chat-input='1']"),
      document.querySelector(".rag-chat-input textarea"),
      document.querySelector(".rag-chat-input input")
    ];

    const input = possibleInputs.find(Boolean);

    if (!input) {
      return false;
    }

    input.value = question;

    input.dispatchEvent(
      new Event("input", {
        bubbles: true
      })
    );

    input.focus();

    return true;
  }

  function handleAskSource(button) {
    const sourceId = button.dataset.sourceId || activeSource?.source_id || "";
    const title = activeSource?.title || "bu kaynak";

    const question = sourceId
      ? `"${title}" kaynağını temel alarak kısa bir özet çıkar.`
      : "Bu kaynağı temel alarak kısa bir özet çıkar.";

    switchToChatTab();

    const filled = fillChatInput(question);

    if (!filled) {
      console.warn("[SOURCE DETAIL] Chat input bulunamadı. Soru:", question);
    }

    closeSourceDetail();
  }

  function handleAskChunk(button) {
    const sourceId = button.dataset.sourceId || activeSource?.source_id || "";
    const chunkId = button.dataset.chunkId || "";
    const title = activeSource?.title || "bu kaynak";

    const question =
      sourceId && chunkId
        ? `"${title}" kaynağındaki ilgili parçayı açıkla.`
        : "Bu kaynak parçasını açıkla.";

    switchToChatTab();

    const filled = fillChatInput(question);

    if (!filled) {
      console.warn("[SOURCE DETAIL] Chat input bulunamadı. Soru:", question);
    }

    closeSourceDetail();
  }

  function handleHighlightChunk(button) {
    const sourceId = button.dataset.sourceId || activeSource?.source_id || "";
    const chunkId = button.dataset.chunkId || "";

    if (!sourceId || !chunkId) {
      alert("Highlight için source_id veya chunk_id bulunamadı.");
      return;
    }

    if (window.AdaptiveRagHighlightEvents?.highlightChunk) {
      window.AdaptiveRagHighlightEvents.highlightChunk({
        sourceId,
        chunkId,
        url: activeSource?.url || ""
      });

      closeSourceDetail();
      return;
    }

    window.dispatchEvent(
      new CustomEvent("adaptive-rag-highlight-chunk", {
        detail: {
          sourceId,
          chunkId,
          url: activeSource?.url || ""
        }
      })
    );

    console.log("[SOURCE DETAIL] Highlight isteği gönderildi:", {
      sourceId,
      chunkId,
      url: activeSource?.url || ""
    });

    closeSourceDetail();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSource) {
      closeSourceDetail();
    }
  });

  window.AdaptiveRagSourceDetail = {
    __moduleName: "source-detail",

    openSourceDetail,
    renderSourceDetail,
    closeSourceDetail
  };
})();