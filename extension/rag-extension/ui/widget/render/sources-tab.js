/**
 * Dosya: sources-tab.js
 *
 * Görev:
 * - Kaynaklar sekmesinin HTML içeriğini üretir.
 * - Taranan sayfaları research-store.js üzerinden okur.
 * - Elle tarama modunda "Sayfayı tara" butonunu gösterir.
 *
 * Not:
 * - Bu dosya event bağlamaz.
 * - Buton click işlemleri source-events.js içinde yapılır.
 * - Mock veri içermez.
 */

(function () {
  if (window.AdaptiveRagSourcesTab?.__tabName === "sources-tab") {
    return;
  }

  const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";

  let scanModeCache = "manual";

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

  function trimText(text, maxLength = 180) {
    if (window.AdaptiveRagState?.trimText) {
      return window.AdaptiveRagState.trimText(text, maxLength);
    }

    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function getResearchData() {
    if (window.AdaptiveRagState?.getResearchData) {
      return window.AdaptiveRagState.getResearchData();
    }

    if (window.AdaptiveRagStore?.getResearchData) {
      return window.AdaptiveRagStore.getResearchData();
    }

    return {
      pages: [],
      notes: {
        generalSummary: ""
      },
      timeline: []
    };
  }

  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch {
      return url || "";
    }
  }

  function loadScanMode() {
    chrome.storage.local.get([SCAN_SETTINGS_KEY], (result) => {
      const settings = result[SCAN_SETTINGS_KEY];

      scanModeCache = settings?.scanMode === "auto" ? "auto" : "manual";

      const activeTab = window.AdaptiveRagState?.getActiveTab?.();

      if (activeTab === "sources" && window.AdaptiveRagWidget?.renderActiveTab) {
        window.AdaptiveRagWidget.renderActiveTab();
      }
    });
  }

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (!changes[SCAN_SETTINGS_KEY]) {
      return;
    }

    const nextSettings = changes[SCAN_SETTINGS_KEY].newValue;

    scanModeCache = nextSettings?.scanMode === "auto" ? "auto" : "manual";

    const activeTab = window.AdaptiveRagState?.getActiveTab?.();

    if (activeTab === "sources" && window.AdaptiveRagWidget?.renderActiveTab) {
      window.AdaptiveRagWidget.renderActiveTab();
    }
  });

  function renderSourcesTab() {
    const researchData = getResearchData();
    const pages = Array.isArray(researchData.pages) ? researchData.pages : [];

    const pagesHtml = pages.length
      ? pages.map(renderSourceCard).join("")
      : renderEmptySources();

    return `
      <div class="rag-sources-layout">
        ${renderSourcesHeader(pages.length)}

        <div class="rag-source-list">
          ${pagesHtml}
        </div>
      </div>
    `;
  }

  function renderSourcesHeader(pageCount) {
    const isManualMode = scanModeCache === "manual";

    return `
      <div class="rag-section-head">
        <div>
          <h3>Kaynaklar</h3>
          <p>
            ${
              isManualMode
                ? "Elle tarama aktif. Mevcut sayfayı kaynaklara ekleyebilirsin."
                : "Otomatik tarama aktif. Uygun sayfalar arka planda eklenir."
            }
          </p>
        </div>

        ${
          isManualMode
            ? `
              <button
                id="scanCurrentPageBtn"
                class="rag-primary-btn small"
                type="button"
              >
                Sayfayı tara
              </button>
            `
            : ""
        }
      </div>

      <div class="rag-small-info">
        ${pageCount} sayfa · ${isManualMode ? "Elle mod" : "Otomatik mod"}
      </div>
    `;
  }

  function renderSourceCard(page) {
    const chunks = Array.isArray(page.chunks) ? page.chunks : [];
    const chunkCount = chunks.length;

    return `
      <article class="rag-source-card open">
        <div class="rag-source-card-head">
          <div>
            <strong>${escapeHtml(page.title || "Başlıksız Sayfa")}</strong>
            <span>${escapeHtml(page.scannedAt || "")}</span>
          </div>
        </div>

        <div class="rag-source-card-body">
          <p class="rag-source-summary">
            ${escapeHtml(trimText(page.summary || "Bu kaynak için özet bulunmuyor.", 220))}
          </p>

          <div class="rag-source-url">
            ${escapeHtml(getShortUrl(page.url || ""))}
          </div>

          <div class="rag-small-info">
            Parça sayısı: ${chunkCount}
          </div>

          ${renderSourceChunks(chunks)}

          ${
            page.url
              ? `
                <button
                  class="rag-secondary-btn rag-open-source-btn"
                  type="button"
                  data-url="${escapeHtml(page.url)}"
                >
                  Siteye git
                </button>
              `
              : ""
          }
        </div>
      </article>
    `;
  }

  function renderSourceChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return "";
    }

    const firstChunks = chunks.slice(0, 3);

    return `
      <div class="rag-chunks">
        <div class="rag-subtitle">Kaynak parçaları</div>

        ${firstChunks.map(renderChunkCard).join("")}

        ${
          chunks.length > 3
            ? `<div class="rag-small-info">+${chunks.length - 3} parça daha var.</div>`
            : ""
        }
      </div>
    `;
  }

  function renderChunkCard(chunk) {
    const text = chunk.text || chunk.content || "";

    return `
      <div class="rag-chunk-card">
        <p>${escapeHtml(trimText(text, 220))}</p>
      </div>
    `;
  }

  function renderEmptySources() {
    const text =
      scanModeCache === "manual"
        ? "Henüz kaynak yok. Sayfayı tara butonuyla mevcut sayfayı ekleyebilirsin."
        : "Henüz kaynak yok. Otomatik tarama uygun sayfalarda kaynak ekleyecek.";

    return `
      <div class="rag-empty-state">
        <strong>Henüz kaynak yok.</strong>
        <span>${escapeHtml(text)}</span>
      </div>
    `;
  }

  loadScanMode();

  window.AdaptiveRagSourcesTab = {
    __tabName: "sources-tab",

    renderSourcesTab,
    loadScanMode
  };
})();