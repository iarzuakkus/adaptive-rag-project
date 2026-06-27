/**
 * Dosya: sources-tab.js
 *
 * Görev:
 * - Kaynaklar sekmesinin HTML içeriğini üretir.
 * - Kaynakların gerçek sahibi backend'dir.
 * - Backend çalışmıyorsa eski/local kaynak fallback'i göstermez.
 * - Kaynak kartlarını sade biçimde render eder.
 * - Kaynak detayını overlay/modal olarak değil, Kaynaklar sekmesi içinde gösterir.
 *
 * Kartta gösterilen bilgiler:
 * - LLM/Backend başlığı
 * - Taranma zamanı
 * - Kısa genel özet
 * - Kaynak domaini
 *
 * Detay ekranı:
 * - source-detail.js tarafından üretilir.
 * - sources-tab.js içinde gösterilir.
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

  let sourceViewMode = "list";
  let activeSourceDetail = null;

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

  function trimText(text, maxLength = 220) {
    if (window.AdaptiveRagState?.trimText) {
      return window.AdaptiveRagState.trimText(text, maxLength);
    }

    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function hasChromeRuntime() {
    return (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }

  function hasChromeStorage() {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    );
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
      return "Tarih bilgisi yok";
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

  function getSourceId(source) {
    return source?.source_id || source?.sourceId || "";
  }

  function getSourceTitle(source) {
    return (
      source?.llm_title ||
      source?.generated_title ||
      source?.source_title ||
      source?.title ||
      "Başlıksız kaynak"
    );
  }

  function getSourceSummary(source) {
    return (
      source?.short_summary ||
      source?.card_summary ||
      source?.summary ||
      "Bu kaynak için kısa özet henüz oluşturulmadı."
    );
  }

  function getSourceUrl(source) {
    return source?.url || source?.source_url || "";
  }

  function getSourceDomain(source) {
    const url = getSourceUrl(source);

    return (
      source?.domain ||
      source?.site ||
      source?.hostname ||
      getShortUrl(url) ||
      "Kaynak adresi yok"
    );
  }

  function getSourceDate(source) {
    return source?.scanned_at || source?.scannedAt || source?.created_at || "";
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
        if (!hasChromeRuntime()) {
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

  function clearBackendSourceViewCache() {
    sourcesCache = [];
    sourcesLoading = false;
    sourcesLoaded = false;
    sourcesError = "";
    sourceViewMode = "list";
    activeSourceDetail = null;
  }

  async function fetchSources({ force = false } = {}) {
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
      sourcesError =
        response?.message ||
        "Kaynaklar backend'den alınamadı. Backend çalışmıyor olabilir.";
      sourcesLoaded = true;
      sourcesLoading = false;
      sourceViewMode = "list";
      activeSourceDetail = null;

      rerenderIfSourcesTabActive();
      return;
    }

    const data = response.data || {};

    const nextSources = Array.isArray(data.sources)
      ? data.sources
      : Array.isArray(data)
        ? data
        : [];

    sourcesCache = nextSources;
    sourcesLoaded = true;
    sourcesLoading = false;
    sourcesError = "";

    rerenderIfSourcesTabActive();
  }

  function refreshSources() {
    sourcesLoaded = false;
    sourceViewMode = "list";
    activeSourceDetail = null;

    return fetchSources({ force: true });
  }

  function openSourceDetail(source) {
    if (!source) {
      return;
    }

    activeSourceDetail = source;
    sourceViewMode = "detail";

    rerenderIfSourcesTabActive();
  }

  function closeSourceDetail() {
    activeSourceDetail = null;
    sourceViewMode = "list";

    rerenderIfSourcesTabActive();
  }

  function loadScanMode() {
    try {
      if (!hasChromeStorage()) {
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
    } catch {
      scanModeCache = "manual";
      rerenderIfSourcesTabActive();
    }
  }

  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.onChanged
  ) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
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
  }

  function renderSourcesTab() {
    if (sourceViewMode === "detail" && activeSourceDetail) {
      return renderInlineSourceDetail();
    }

    if (!sourcesLoaded && !sourcesLoading) {
      fetchSources();
    }

    const renderSources = Array.isArray(sourcesCache) ? sourcesCache : [];

    let bodyHtml = "";

    if (sourcesLoading && !sourcesLoaded) {
      bodyHtml = renderLoadingSources();
    } else if (sourcesError) {
      bodyHtml = renderSourcesError(sourcesError);
    } else if (renderSources.length > 0) {
      bodyHtml = `
        ${renderSources.map(renderSourceCard).join("")}
        ${renderSourceTimeline(renderSources)}
      `;
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

  function renderInlineSourceDetail() {
    const detailRenderer = window.AdaptiveRagSourceDetail?.renderSourceDetail;

    return `
      <div class="rag-sources-layout">
        ${
          typeof detailRenderer === "function"
            ? detailRenderer(activeSourceDetail)
            : renderMissingDetailRenderer()
        }
      </div>
    `;
  }

  function renderMissingDetailRenderer() {
    return `
      <div class="rag-source-detail-view">
        <button
          class="rag-source-back-btn"
          type="button"
          aria-label="Kaynak listesine dön"
        >
          ← Kaynaklara dön
        </button>

        <div class="rag-empty-state">
          <strong>Detay ekranı yüklenemedi.</strong>
          <span>source-detail.js içindeki renderSourceDetail fonksiyonu bulunamadı.</span>
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
            Taradığın sayfaları özetleriyle burada yönetebilirsin.
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

      <div class="rag-source-count-line">
        ${sourceCount} kaynak · ${isManualMode ? "Elle tarama" : "Otomatik tarama"}
      </div>
    `;
  }

  function renderSourceCard(source) {
    const sourceId = getSourceId(source);
    const title = getSourceTitle(source);
    const url = getSourceUrl(source);
    const domain = getSourceDomain(source);
    const scannedAt = formatDate(getSourceDate(source));
    const summary = getSourceSummary(source);

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
            ${escapeHtml(domain)}
          </div>

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

  function renderSourceTimeline(sources) {
    const timelineGroups = buildTimelineGroups(sources);
    const groupHtml = timelineGroups
      .filter((group) => group.sources.length > 0)
      .map(renderTimelineGroup)
      .join("");

    if (!groupHtml) {
      return "";
    }

    return `
      <section class="rag-timeline-box">
        <div class="rag-timeline-head">
          <strong>Zaman çizelgesi</strong>
          <span>Taranan kaynak geçmişi</span>
        </div>

        <div class="rag-timeline-list">
          ${groupHtml}
        </div>
      </section>
    `;
  }

  function buildTimelineGroups(sources) {
    const now = new Date();

    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 7);

    const groups = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
      unknown: []
    };

    sources.forEach((source) => {
      const rawDate = getSourceDate(source);

      if (!rawDate) {
        groups.unknown.push(source);
        return;
      }

      const date = new Date(rawDate);

      if (Number.isNaN(date.getTime())) {
        groups.unknown.push(source);
        return;
      }

      if (date >= startOfToday) {
        groups.today.push(source);
        return;
      }

      if (date >= startOfYesterday) {
        groups.yesterday.push(source);
        return;
      }

      if (date >= startOfWeek) {
        groups.week.push(source);
        return;
      }

      groups.older.push(source);
    });

    return [
      {
        label: "Bugün",
        sources: groups.today
      },
      {
        label: "Dün",
        sources: groups.yesterday
      },
      {
        label: "Bu hafta",
        sources: groups.week
      },
      {
        label: "Daha eski",
        sources: groups.older
      },
      {
        label: "Tarih bilgisi yok",
        sources: groups.unknown
      }
    ];
  }

  function renderTimelineGroup(group) {
    return `
      <div class="rag-timeline-group">
        <div class="rag-timeline-group-title">
          ${escapeHtml(group.label)}
        </div>

        ${group.sources.map(renderTimelineItem).join("")}
      </div>
    `;
  }

  function renderTimelineItem(source) {
    const sourceId = getSourceId(source);
    const title = getSourceTitle(source);
    const scannedAt = formatDate(getSourceDate(source));

    if (!sourceId) {
      return `
        <div class="rag-timeline-item">
          <span class="rag-timeline-dot"></span>

          <div>
            <strong>${escapeHtml(trimText(title, 60))}</strong>
            <span>${escapeHtml(scannedAt)}</span>
          </div>
        </div>
      `;
    }

    return `
      <button
        class="rag-timeline-item rag-source-detail-btn"
        type="button"
        data-source-id="${escapeHtml(sourceId)}"
      >
        <span class="rag-timeline-dot"></span>

        <span>
          <strong>${escapeHtml(trimText(title, 60))}</strong>
          <span>${escapeHtml(scannedAt)}</span>
        </span>
      </button>
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

  function getActiveSourceDetail() {
    return activeSourceDetail;
  }

  loadScanMode();

  window.AdaptiveRagSourcesTab = {
    __tabName: "sources-tab",

    renderSourcesTab,
    loadScanMode,
    refreshSources,
    fetchSources,
    clearBackendSourceViewCache,

    openSourceDetail,
    closeSourceDetail,
    getActiveSourceDetail,

    getSourcesCache
  };
})();