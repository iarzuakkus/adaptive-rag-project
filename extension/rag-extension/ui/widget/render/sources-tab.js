/**
 * Dosya: sources-tab.js
 *
 * Görev:
 * - Kaynaklar sekmesinin HTML içeriğini üretir.
 * - Oturum/research-store mantığını korur.
 * - Aktif oturumda kaynak yoksa backend kaynaklarını göstermez.
 * - Aktif oturumda kaynak varsa backend /sources endpointinden gerçek kaynakları alır.
 * - Backend alınamazsa research-store içindeki eski kaynak verisini fallback olarak kullanır.
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

  let sourcesCache = [];
  let sourcesLoading = false;
  let sourcesLoaded = false;
  let sourcesError = "";

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

  function getSessionPages() {
    const researchData = getResearchData();
    return Array.isArray(researchData.pages) ? researchData.pages : [];
  }

  function hasSessionSources() {
    return getSessionPages().length > 0;
  }

  function clearBackendSourceViewCache() {
    sourcesCache = [];
    sourcesLoading = false;
    sourcesLoaded = false;
    sourcesError = "";
  }

  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch {
      return url || "";
    }
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
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return value;
    }
  }

  function getActiveTab() {
    return window.AdaptiveRagState?.getActiveTab?.() || "";
  }

  function rerenderIfSourcesTabActive() {
    const activeTab = getActiveTab();

    if (activeTab === "sources" && window.AdaptiveRagWidget?.renderActiveTab) {
      window.AdaptiveRagWidget.renderActiveTab();
    }
  }

  function sendBackgroundMessage(message) {
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) {
          resolve({
            success: false,
            message: "chrome.runtime.sendMessage kullanılamıyor."
          });

          return;
        }

        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              message: chrome.runtime.lastError.message
            });

            return;
          }

          resolve(response);
        });
      } catch (error) {
        resolve({
          success: false,
          message: error?.message || "Background mesajı gönderilemedi."
        });
      }
    });
  }

  function normalizeLegacyPage(page, index) {
    const chunks = Array.isArray(page.chunks) ? page.chunks : [];

    return {
      source_id: page.source_id || page.sourceId || "",
      title: page.title || "Başlıksız Sayfa",
      url: page.url || "",
      domain: page.domain || getShortUrl(page.url || ""),
      summary: page.summary || "Bu kaynak için özet bulunmuyor.",
      scanned_at: page.scanned_at || page.scannedAt || "",
      chunk_count: page.chunk_count || chunks.length,
      chunks,
      status: page.status || "ready",
      __legacy: true,
      __legacy_index: index
    };
  }

  async function fetchSources({ force = false } = {}) {
    if (!hasSessionSources()) {
      clearBackendSourceViewCache();
      return;
    }

    if (sourcesLoading) {
      return;
    }

    if (sourcesLoaded && !force) {
      return;
    }

    sourcesLoading = true;
    sourcesError = "";

    rerenderIfSourcesTabActive();

    const response = await sendBackgroundMessage({
      type: "GET_SOURCES"
    });

    if (!response?.success) {
      sourcesCache = [];
      sourcesError = response?.message || "Kaynaklar backend'den alınamadı.";
      sourcesLoaded = true;
      sourcesLoading = false;

      rerenderIfSourcesTabActive();
      return;
    }

    const data = response.data || {};
    const nextSources = Array.isArray(data.sources) ? data.sources : [];

    sourcesCache = nextSources;
    sourcesLoaded = true;
    sourcesLoading = false;
    sourcesError = "";

    rerenderIfSourcesTabActive();
  }

  function refreshSources() {
    sourcesLoaded = false;

    if (!hasSessionSources()) {
      clearBackendSourceViewCache();
      rerenderIfSourcesTabActive();
      return Promise.resolve();
    }

    return fetchSources({ force: true });
  }

  function loadScanMode() {
    try {
      if (!chrome?.storage?.local?.get) {
        scanModeCache = "manual";
        rerenderIfSourcesTabActive();
        return;
      }

      chrome.storage.local.get([SCAN_SETTINGS_KEY], (result) => {
        if (chrome.runtime?.lastError) {
          scanModeCache = "manual";
          rerenderIfSourcesTabActive();
          return;
        }

        const settings = result?.[SCAN_SETTINGS_KEY];

        scanModeCache = settings?.scanMode === "auto" ? "auto" : "manual";

        rerenderIfSourcesTabActive();
      });
    } catch (error) {
      scanModeCache = "manual";
      rerenderIfSourcesTabActive();
    }
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

    rerenderIfSourcesTabActive();
  });

  function renderSourcesTab() {
    const sessionPages = getSessionPages();

    if (sessionPages.length === 0) {
      clearBackendSourceViewCache();

      return `
        <div class="rag-sources-layout">
          ${renderSourcesHeader(0)}

          <div class="rag-source-list">
            ${renderEmptySources()}
          </div>
        </div>
      `;
    }

    if (!sourcesLoaded && !sourcesLoading) {
      fetchSources();
    }

    const legacySources = sessionPages.map(normalizeLegacyPage);

    const backendSources = Array.isArray(sourcesCache) ? sourcesCache : [];

    const renderSources = backendSources.length > 0
      ? backendSources
      : legacySources;

    let bodyHtml = "";

    if (sourcesLoading && !sourcesLoaded && backendSources.length === 0) {
      bodyHtml = renderLoadingSources();
    } else if (sourcesError && renderSources.length === 0) {
      bodyHtml = renderSourcesError(sourcesError);
    } else if (renderSources.length > 0) {
      bodyHtml = renderSources.map(renderSourceCard).join("");
    } else {
      bodyHtml = renderEmptySources();
    }

    return `
      <div class="rag-sources-layout">
        ${renderSourcesHeader(renderSources.length)}

        <div class="rag-source-list">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  function renderSourcesHeader(sourceCount) {
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

        <div class="rag-source-head-actions">
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

          <button
            id="refreshSourcesBtn"
            class="rag-secondary-btn small"
            type="button"
          >
            Yenile
          </button>
        </div>
      </div>

      <div class="rag-small-info">
        ${sourceCount} kaynak · ${isManualMode ? "Elle mod" : "Otomatik mod"}
      </div>
    `;
  }

  function renderSourceCard(source) {
    const sourceId = source.source_id || "";
    const title = source.title || "Başlıksız kaynak";
    const url = source.url || "";
    const domain = source.domain || getShortUrl(url);
    const scannedAt = formatDate(source.scanned_at || source.scannedAt);
    const chunks = Array.isArray(source.chunks) ? source.chunks : [];
    const chunkCount = source.chunk_count || chunks.length || 0;
    const summary = source.summary || "Bu kaynak için özet henüz oluşturulmadı.";
    const isLegacy = source.__legacy === true;

    return `
      <article
        class="rag-source-card"
        data-source-id="${escapeHtml(sourceId)}"
      >
        <div class="rag-source-card-head">
          <div>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(scannedAt)}</span>
          </div>
        </div>

        <div class="rag-source-card-body">
          <p class="rag-source-summary">
            ${escapeHtml(trimText(summary, 260))}
          </p>

          <div class="rag-source-url">
            ${escapeHtml(domain || url)}
          </div>

          <div class="rag-small-info">
            Parça sayısı: ${chunkCount}
          </div>

          ${
            isLegacy && chunks.length
              ? renderSourceChunks(chunks)
              : ""
          }

          <div class="rag-source-actions">
            ${
              sourceId
                ? `
                  <button
                    class="rag-secondary-btn rag-source-detail-btn"
                    type="button"
                    data-source-id="${escapeHtml(sourceId)}"
                  >
                    Detay
                  </button>
                `
                : ""
            }

            ${
              url
                ? `
                  <button
                    class="rag-secondary-btn rag-open-source-btn"
                    type="button"
                    data-url="${escapeHtml(url)}"
                  >
                    Siteye git
                  </button>
                `
                : ""
            }

            ${
              sourceId
                ? `
                  <button
                    class="rag-danger-btn rag-delete-source-btn"
                    type="button"
                    data-source-id="${escapeHtml(sourceId)}"
                  >
                    Sil
                  </button>
                `
                : ""
            }
          </div>
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

  function renderLoadingSources() {
    return `
      <div class="rag-empty-state">
        <strong>Kaynaklar yükleniyor.</strong>
        <span>Backend kaynak listesi alınıyor.</span>
      </div>
    `;
  }

  function renderSourcesError(message) {
    return `
      <div class="rag-empty-state">
        <strong>Kaynaklar alınamadı.</strong>
        <span>${escapeHtml(message)}</span>
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

  function getSourcesCache() {
    return [...sourcesCache];
  }

  loadScanMode();

  window.AdaptiveRagSourcesTab = {
    __tabName: "sources-tab",

    renderSourcesTab,
    loadScanMode,
    refreshSources,
    fetchSources,
    getSourcesCache
  };
})();