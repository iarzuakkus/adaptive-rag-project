/**
 * Dosya: sources-tab.js
 *
 * Görev:
 * - Kaynaklar sekmesinin HTML içeriğini üretir.
 * - Kaynakların gerçek sahibi backend'dir.
 * - Backend çalışmıyorsa eski/local kaynak fallback'i göstermez.
 * - Kaynak kartlarını sade biçimde render eder.
 * - Kaynak detayını overlay/modal olarak değil, Kaynaklar sekmesi içinde gösterir.
 * - Kaynaklar sekmesi içinde "Kaynaklar / Öneriler" alt sekme kabuğunu yönetir.
 *
 * Öneriler ekranı:
 * - recommendations-panel.js tarafından üretilir.
 * - sources-tab.js sadece bu paneli bağlar.
 */

(function () {
  if (window.AdaptiveRagSourcesTab?.__tabName === "sources-tab") {
    return;
  }

  const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";
  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";
  const ACTIVE_SESSION_KEY = "adaptive_rag_active_session";

  let scanModeCache = "manual";

  let sourcesCache = [];
  let sourcesLoading = false;
  let sourcesLoaded = false;
  let sourcesError = "";

  let sourceViewMode = "list";
  let activeSourceDetail = null;
  let activeSourcesSubTab = "sources";

  let activeSessionIdCache = "";
  let activeSessionStartedAtCache = "";

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

  function getIconUrl(iconName) {
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        typeof chrome.runtime.getURL === "function"
      ) {
        return chrome.runtime.getURL(`icons/${iconName}.svg`);
      }
    } catch {
      return "";
    }

    return "";
  }

  function renderIcon(iconName, className = "") {
    const iconUrl = getIconUrl(iconName);

    if (!iconUrl) {
      return "";
    }

    return `
      <span
        class="rag-icon-mask ${escapeHtml(className)}"
        style="--rag-icon-url: url('${escapeHtml(iconUrl)}');"
        aria-hidden="true"
      ></span>
    `;
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

  function isSessionActiveSync() {
    if (window.AdaptiveRagState?.isSessionActive) {
      return window.AdaptiveRagState.isSessionActive();
    }

    return Boolean(activeSessionIdCache);
  }

  function getStorageValues(keys) {
    return new Promise((resolve) => {
      try {
        if (!hasChromeStorage()) {
          resolve({});
          return;
        }

        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime?.lastError) {
            resolve({});
            return;
          }

          resolve(result || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  async function getCurrentSessionContext() {
    try {
      if (window.AdaptiveRagSessionStore?.getActiveSession) {
        const session = await window.AdaptiveRagSessionStore.getActiveSession();

        if (!session?.id) {
          return {
            active: false,
            id: "",
            startedAt: ""
          };
        }

        return {
          active: true,
          id: session.id,
          startedAt: session.startedAt || ""
        };
      }

      const values = await getStorageValues([
        SESSION_ENABLED_KEY,
        ACTIVE_SESSION_KEY
      ]);

      const session = values[ACTIVE_SESSION_KEY];
      const enabled = values[SESSION_ENABLED_KEY] === true;

      if (!enabled || !session?.id) {
        return {
          active: false,
          id: "",
          startedAt: ""
        };
      }

      return {
        active: true,
        id: session.id,
        startedAt: session.startedAt || ""
      };
    } catch {
      return {
        active: false,
        id: "",
        startedAt: ""
      };
    }
  }

  function applySessionContext(sessionContext) {
    const nextId = sessionContext?.active ? sessionContext.id || "" : "";
    const nextStartedAt = sessionContext?.active ? sessionContext.startedAt || "" : "";

    const changed = activeSessionIdCache !== nextId;

    activeSessionIdCache = nextId;
    activeSessionStartedAtCache = nextStartedAt;

    return changed;
  }

  function getSourceSessionId(source) {
    return (
      source?.session_id ||
      source?.sessionId ||
      source?.session?.id ||
      source?.metadata?.session_id ||
      source?.metadata?.sessionId ||
      ""
    );
  }

  function isSourceInActiveSession(source) {
    if (!activeSessionIdCache) {
      return false;
    }

    const sourceSessionId = getSourceSessionId(source);

    if (sourceSessionId) {
      return sourceSessionId === activeSessionIdCache;
    }

    const sessionStartedAt = Date.parse(activeSessionStartedAtCache || "");

    if (!sessionStartedAt) {
      return true;
    }

    const sourceDate = getSourceDate(source);
    const sourceTime = Date.parse(sourceDate || "");

    if (!sourceTime) {
      return false;
    }

    return sourceTime >= sessionStartedAt - 2000;
  }

  function filterSourcesForActiveSession(sources) {
    if (!Array.isArray(sources)) {
      return [];
    }

    return sources.filter(isSourceInActiveSession);
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
    activeSourcesSubTab = "sources";
  }

  async function fetchSources({ force = false } = {}) {
    if (sourcesLoading) {
      return;
    }

    const sessionContext = await getCurrentSessionContext();
    const sessionChanged = applySessionContext(sessionContext);

    if (!sessionContext.active) {
      clearBackendSourceViewCache();
      rerenderIfSourcesTabActive();
      return;
    }

    if (sessionChanged) {
      sourcesCache = [];
      sourcesLoaded = false;
      sourceViewMode = "list";
      activeSourceDetail = null;
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

    sourcesCache = filterSourcesForActiveSession(nextSources);
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

  function setSourcesSubTab(nextTab) {
    const normalizedTab = String(nextTab || "").trim().toLowerCase();

    if (!["sources", "recommendations"].includes(normalizedTab)) {
      return;
    }

    activeSourcesSubTab = normalizedTab;
    sourceViewMode = "list";
    activeSourceDetail = null;

    if (activeSourcesSubTab === "sources" && !sourcesLoaded && !sourcesLoading) {
      fetchSources();
      return;
    }

    rerenderIfSourcesTabActive();
  }

  function getActiveSourcesSubTab() {
    return activeSourcesSubTab;
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

      if (changes[SESSION_ENABLED_KEY] || changes[ACTIVE_SESSION_KEY]) {
        const nextEnabled = changes[SESSION_ENABLED_KEY]?.newValue;
        const nextSession = changes[ACTIVE_SESSION_KEY]?.newValue;

        if (nextEnabled === false || !nextSession?.id) {
          clearBackendSourceViewCache();
          rerenderIfSourcesTabActive();
          return;
        }

        if (nextSession.id !== activeSessionIdCache) {
          activeSessionIdCache = nextSession.id;
          activeSessionStartedAtCache = nextSession.startedAt || "";
          clearBackendSourceViewCache();
          rerenderIfSourcesTabActive();
          return;
        }
      }

      if (changes[SCAN_SETTINGS_KEY]) {
        const nextSettings = changes[SCAN_SETTINGS_KEY].newValue;

        scanModeCache = nextSettings?.scanMode === "auto" ? "auto" : "manual";

        rerenderIfSourcesTabActive();
      }
    });
  }

  function renderSourcesTab() {
    if (!isSessionActiveSync()) {
      clearBackendSourceViewCache();
      return renderSourcesLayout(renderSourcesHeader(0), renderSessionClosedSources());
    }

    if (sourceViewMode === "detail" && activeSourceDetail) {
      return renderInlineSourceDetail();
    }

    if (!sourcesLoaded && !sourcesLoading) {
      fetchSources();
    }

    const renderSources = Array.isArray(sourcesCache) ? sourcesCache : [];
    const bodyHtml =
      activeSourcesSubTab === "recommendations"
        ? renderRecommendationsContent()
        : renderSourcesContent(renderSources);

    return renderSourcesLayout(renderSourcesHeader(renderSources.length), bodyHtml);
  }

  function renderSourcesLayout(headerHtml, bodyHtml) {
    return `
      <div class="rag-sources-layout">
        ${headerHtml}

        <div class="rag-source-panel">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  function renderSessionClosedSources() {
    return `
      <div class="rag-source-list">
        <div class="rag-empty-state">
          <strong>Oturum kapalı.</strong>
          <span>Kaynakları görmek için oturumu aç.</span>
        </div>
      </div>
    `;
  }

  function renderSourcesContent(renderSources) {
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
      <div class="rag-source-list">
        ${bodyHtml}
      </div>
    `;
  }

  function renderRecommendationsContent() {
    const renderer = window.AdaptiveRagRecommendationsPanel?.renderRecommendationsPanel;

    if (typeof renderer === "function") {
      return renderer({
        sourceCount: Array.isArray(sourcesCache) ? sourcesCache.length : 0
      });
    }

    return `
      <div class="rag-recommendations-panel">
        <div class="rag-empty-state">
          <strong>Öneriler paneli yüklenemedi.</strong>
          <span>recommendations-panel.js dosyası yüklenmemiş olabilir.</span>
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
    const isSourcesActive = activeSourcesSubTab === "sources";
    const isRecommendationsActive = activeSourcesSubTab === "recommendations";

    return `
      <div class="rag-source-topbar">
        <div class="rag-source-subtabs" role="tablist" aria-label="Kaynak alt sekmeleri">
          <button
            class="rag-source-subtab ${isSourcesActive ? "is-active" : ""}"
            type="button"
            data-source-subtab="sources"
            aria-selected="${isSourcesActive ? "true" : "false"}"
          >
            ${renderIcon("source", "rag-icon-subtab")}
            <span>Kaynaklar</span>
          </button>

          <button
            class="rag-source-subtab ${isRecommendationsActive ? "is-active" : ""}"
            type="button"
            data-source-subtab="recommendations"
            aria-selected="${isRecommendationsActive ? "true" : "false"}"
          >
            ${renderIcon("recommendation", "rag-icon-subtab")}
            <span>Öneriler</span>
          </button>
        </div>
      </div>

      ${
        isSourcesActive
          ? renderSourcesToolbarButtons(isManualMode)
          : renderRecommendationToolbarButtons()
      }

      <div class="rag-source-count-line">
        ${
          isSourcesActive
            ? `${sourceCount} kaynak · ${isManualMode ? "Elle tarama" : "Otomatik tarama"}`
            : "Öneriler · Araştırma modu"
        }
      </div>
    `;
  }

  function renderSourcesToolbarButtons(isManualMode) {
    return `
      <div class="rag-source-floating-actions">
        ${
          isManualMode
            ? `
              <button
                id="scanCurrentPageBtn"
                class="rag-icon-action-btn"
                type="button"
                title="Sayfayı tara"
                aria-label="Sayfayı tara"
                data-icon-only="true"
              >
                ${renderIcon("scan", "rag-icon-action")}
              </button>
            `
            : ""
        }

        <button
          id="refreshSourcesBtn"
          class="rag-icon-action-btn"
          type="button"
          title="Yenile"
          aria-label="Yenile"
          data-icon-only="true"
        >
          ${renderIcon("refresh", "rag-icon-action")}
        </button>
      </div>
    `;
  }

  function renderRecommendationToolbarButtons() {
    return `
      <div class="rag-source-floating-actions">
        <button
          id="generateRecommendationsBtn"
          class="rag-icon-action-btn"
          type="button"
          title="Öneri üret"
          aria-label="Öneri üret"
          data-icon-only="true"
        >
          ${renderIcon("recommendation", "rag-icon-action")}
        </button>

        <button
          id="refreshRecommendationsBtn"
          class="rag-icon-action-btn"
          type="button"
          title="Önerileri yenile"
          aria-label="Önerileri yenile"
          data-icon-only="true"
        >
          ${renderIcon("refresh", "rag-icon-action")}
        </button>
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
                    <span>Detay</span>
                  </button>
                `
                : ""
            }

            ${
              url
                ? `
                  <button
                    class="rag-secondary-btn rag-open-source-btn rag-icon-btn"
                    type="button"
                    data-url="${escapeHtml(url)}"
                  >
                    ${renderIcon("external-link", "rag-icon-button")}
                    <span>Siteye git</span>
                  </button>
                `
                : ""
            }

            ${
              sourceId
                ? `
                  <button
                    class="rag-danger-btn rag-delete-source-btn rag-icon-btn"
                    type="button"
                    data-source-id="${escapeHtml(sourceId)}"
                  >
                    ${renderIcon("rubbish", "rag-icon-button")}
                    <span>Sil</span>
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
    if (!isSessionActiveSync()) {
      return [];
    }

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

    setSourcesSubTab,
    getActiveSourcesSubTab,

    getSourcesCache
  };
})();