/**
 * Dosya: recommendation-events.js
 *
 * Görev:
 * - Kaynaklar sekmesi içindeki Öneriler panelinin eventlerini yönetir.
 * - Öneri üretme ve önerileri yenileme işlemlerini backend/background akışına bağlar.
 * - Öneri kartlarındaki "Siteye git" ve "Tara ve ekle" butonlarını çalıştırır.
 * - Öneri state bilgisini AdaptiveRagRecommendationStore içinde tutar.
 *
 * Not:
 * - Bu dosya kaynak kartı eventlerini yönetmez.
 * - Kaynak kartı eventleri source-events.js içinde kalır.
 * - Backend mesaj tipleri background.js içinde bağlanacaktır.
 */

(function () {
  if (window.AdaptiveRagRecommendationEvents?.__moduleName === "recommendation-events") {
    return;
  }

  const PENDING_RECOMMENDATION_SCAN_KEY = "adaptive_rag_pending_recommendation_scan";
  const PENDING_SCAN_MAX_AGE_MS = 10 * 60 * 1000;

  let lastRenderActiveTab = null;
  let pendingScanRunning = false;
  let pendingScanTimers = [];

  const recommendationState = {
    recommendations: [],
    isLoading: false,
    error: "",
    generatedAt: "",
    sourceCount: 0
  };

  function getState() {
    return {
      ...recommendationState,
      recommendations: [...recommendationState.recommendations]
    };
  }

  function setState(patch = {}, options = {}) {
    Object.assign(recommendationState, patch);

    if (options.render !== false) {
      renderActiveTabFallback();
    }
  }

  function clearState(options = {}) {
    recommendationState.recommendations = [];
    recommendationState.isLoading = false;
    recommendationState.error = "";
    recommendationState.generatedAt = "";
    recommendationState.sourceCount = 0;

    if (options.render !== false) {
      renderActiveTabFallback();
    }
  }

  function setRecommendations(recommendations = [], options = {}) {
    recommendationState.recommendations = Array.isArray(recommendations)
      ? recommendations
      : [];

    recommendationState.isLoading = false;
    recommendationState.error = "";
    recommendationState.generatedAt = options.generatedAt || new Date().toISOString();
    recommendationState.sourceCount = Number(options.sourceCount || recommendationState.sourceCount || 0);

    if (options.render !== false) {
      renderActiveTabFallback();
    }
  }

  function bindRecommendationEvents(renderActiveTab) {
    lastRenderActiveTab = renderActiveTab;

    if (document.body.dataset.ragRecommendationEventsBound === "1") {
      schedulePendingRecommendationScanCheck("already-bound");
      return;
    }

    document.body.dataset.ragRecommendationEventsBound = "1";

    document.addEventListener("click", async (event) => {
      const generateButton = event.target.closest("#generateRecommendationsBtn");

      if (generateButton) {
        event.preventDefault();
        event.stopPropagation();

        await handleGenerateRecommendations(generateButton, {
          force: true
        });

        return;
      }

      const refreshButton = event.target.closest("#refreshRecommendationsBtn");

      if (refreshButton) {
        event.preventDefault();
        event.stopPropagation();

        await handleGenerateRecommendations(refreshButton, {
          force: true
        });

        return;
      }

      const openButton = event.target.closest(".rag-open-recommendation-btn");

      if (openButton) {
        event.preventDefault();
        event.stopPropagation();

        handleOpenRecommendation(openButton);
        return;
      }

      const scanButton = event.target.closest(".rag-scan-recommendation-btn");

      if (scanButton) {
        event.preventDefault();
        event.stopPropagation();

        await handleScanRecommendation(scanButton);
      }
    });

    schedulePendingRecommendationScanCheck("bind");
  }

  function renderActiveTabFallback() {
    if (typeof lastRenderActiveTab === "function") {
      lastRenderActiveTab();
      return;
    }

    if (window.AdaptiveRagWidget?.renderActiveTab) {
      window.AdaptiveRagWidget.renderActiveTab();
    }
  }

  function setRecommendationSubtab() {
    if (window.AdaptiveRagSourcesTab?.setSourcesSubTab) {
      window.AdaptiveRagSourcesTab.setSourcesSubTab("recommendations");
      return;
    }

    renderActiveTabFallback();
  }

  function sendBackgroundMessage(message) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.runtime ||
          typeof chrome.runtime.sendMessage !== "function"
        ) {
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

  function getSourcesForRecommendation() {
    if (window.AdaptiveRagSourcesTab?.getSourcesCache) {
      const sources = window.AdaptiveRagSourcesTab.getSourcesCache();

      if (Array.isArray(sources)) {
        return sources;
      }
    }

    return [];
  }

  function normalizeSourceForRequest(source) {
    return {
      source_id: source?.source_id || source?.sourceId || "",
      title:
        source?.llm_title ||
        source?.title ||
        source?.original_title ||
        "Başlıksız kaynak",
      url:
        source?.url ||
        source?.source_url ||
        source?.page_url ||
        "",
      domain:
        source?.domain ||
        source?.site ||
        source?.hostname ||
        "",
      summary:
        source?.summary ||
        source?.short_summary ||
        source?.long_summary ||
        "",
      short_summary:
        source?.short_summary ||
        source?.summary ||
        "",
      long_summary:
        source?.long_summary ||
        source?.summary ||
        "",
      summary_sections: Array.isArray(source?.summary_sections)
        ? source.summary_sections
        : Array.isArray(source?.detail_sections)
          ? source.detail_sections
          : [],
      scanned_at:
        source?.scanned_at ||
        source?.scannedAt ||
        source?.created_at ||
        ""
    };
  }

  function normalizeRecommendation(item, index) {
    const url =
      item?.url ||
      item?.source_url ||
      item?.page_url ||
      item?.target_url ||
      "";

    const query =
      item?.query ||
      item?.search_query ||
      item?.searchQuery ||
      item?.keyword ||
      "";

    return {
      id:
        item?.id ||
        item?.recommendation_id ||
        item?.recommendationId ||
        `rec_${index + 1}`,
      title:
        item?.title ||
        item?.query_title ||
        item?.search_title ||
        item?.heading ||
        "Başlıksız öneri",
      summary:
        item?.summary ||
        item?.description ||
        item?.snippet ||
        item?.content ||
        "Bu öneri için açıklama oluşturulamadı.",
      reason:
        item?.reason ||
        item?.why ||
        item?.why_recommended ||
        item?.recommendation_reason ||
        "Bu öneri mevcut kaynak bağlamıyla ilişkili olduğu için gösteriliyor.",
      url,
      domain:
        item?.domain ||
        item?.site ||
        item?.hostname ||
        getShortUrl(url) ||
        "Kaynak önerisi",
      query,
      type:
        item?.type ||
        item?.category ||
        item?.label ||
        "Öneri"
    };
  }

  function normalizeRecommendations(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(normalizeRecommendation).filter((item) => {
      return item.title || item.summary || item.url || item.query;
    });
  }

  function extractRecommendationsFromResponse(response) {
    const data = response?.data || response || {};

    const candidates = [
      data.recommendations,
      data.items,
      data.results,
      data.sources,
      data.recommended_sources
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return normalizeRecommendations(candidate);
      }
    }

    return [];
  }

  function extractGeneratedAtFromResponse(response) {
    const data = response?.data || response || {};

    return (
      data.generated_at ||
      data.generatedAt ||
      data.updated_at ||
      data.updatedAt ||
      new Date().toISOString()
    );
  }

  function extractSourceCountFromResponse(response, fallbackCount) {
    const data = response?.data || response || {};

    return Number(
      data.source_count ||
      data.sourceCount ||
      data.analyzed_sources ||
      data.analyzedSources ||
      fallbackCount ||
      0
    );
  }

  async function handleGenerateRecommendations(button, options = {}) {
    if (recommendationState.isLoading) {
      return;
    }

    const sources = getSourcesForRecommendation();
    const normalizedSources = sources.map(normalizeSourceForRequest);

    setRecommendationSubtab();

    if (!normalizedSources.length) {
      setState({
        recommendations: [],
        isLoading: false,
        error: "",
        generatedAt: "",
        sourceCount: 0
      });

      return;
    }

    try {
      setButtonLoading(button, true, "Üretiliyor...");

      setState({
        isLoading: true,
        error: "",
        sourceCount: normalizedSources.length
      });

      const response = await sendBackgroundMessage({
        type: "GENERATE_RECOMMENDATIONS",
        payload: {
          sources: normalizedSources,
          source_count: normalizedSources.length,
          force: options.force === true
        }
      });

      if (!response?.success) {
        throw new Error(
          response?.message ||
          "Öneri üretme endpoint'i henüz bağlanmadı."
        );
      }

      const recommendations = extractRecommendationsFromResponse(response);
      const generatedAt = extractGeneratedAtFromResponse(response);
      const sourceCount = extractSourceCountFromResponse(
        response,
        normalizedSources.length
      );

      setRecommendations(recommendations, {
        generatedAt,
        sourceCount
      });

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "success");
        await wait(450);
      }
    } catch (error) {
      console.error("[RECOMMENDATION EVENTS] Öneri üretme hatası:", error);

      setState({
        recommendations: [],
        isLoading: false,
        error: error.message || "Öneriler üretilirken hata oluştu.",
        generatedAt: "",
        sourceCount: normalizedSources.length
      });

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "error");
        await wait(500);
      }
    } finally {
      setButtonLoading(button, false);
    }
  }

  function handleOpenRecommendation(button) {
    const url = button.dataset.url || "";

    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleScanRecommendation(button) {
    if (button.dataset.loading === "1") {
      return;
    }

    const url = button.dataset.url || "";
    const query = button.dataset.query || "";
    const recommendationId = button.dataset.recommendationId || "";

    try {
      button.dataset.loading = "1";
      setButtonLoading(button, true, "Hazırlanıyor...");

      if (!url && query) {
        throw new Error(
          "Bu öneri şu an yalnızca arama sorgusu içeriyor. Web search entegrasyonu bağlanınca bu sorgudan kaynak bulunup taranacak."
        );
      }

      if (!url) {
        throw new Error("Bu öneride taranacak bir URL bulunamadı.");
      }

      if (!isSafeNavigableUrl(url)) {
        throw new Error("Bu önerinin URL adresi taramaya uygun değil.");
      }

      await savePendingRecommendationScan({
        targetUrl: url,
        recommendationId,
        createdAt: Date.now()
      });

      window.location.href = url;
    } catch (error) {
      console.error("[RECOMMENDATION EVENTS] Öneri tarama hatası:", error);

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "error");
        await wait(500);
      }

      alert(error.message || "Öneri kaynağı taranırken hata oluştu.");
    } finally {
      button.dataset.loading = "0";
      setButtonLoading(button, false);
    }
  }

  function isIconOnlyButton(button) {
    return button?.dataset?.iconOnly === "true";
  }

  function rememberButtonHtml(button) {
    if (!button) {
      return;
    }

    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
  }

  function restoreButtonHtml(button) {
    if (!button) {
      return;
    }

    button.classList.remove("is-loading", "is-success", "is-error");

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function setIconButtonState(button, state) {
    if (!button) {
      return;
    }

    rememberButtonHtml(button);

    button.classList.remove("is-loading", "is-success", "is-error");

    if (state === "loading") {
      button.classList.add("is-loading");
      button.innerHTML = `<span class="rag-action-loader" aria-hidden="true"></span>`;
      return;
    }

    if (state === "success") {
      button.classList.add("is-success");
      button.innerHTML = `<span class="rag-action-check" aria-hidden="true"></span>`;
      return;
    }

    if (state === "error") {
      button.classList.add("is-error");
      button.innerHTML = `<span class="rag-action-error" aria-hidden="true"></span>`;
    }
  }

  function setButtonLoading(button, isLoading, loadingText) {
    if (!button) {
      return;
    }

    if (isLoading) {
      button.disabled = true;

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "loading");
        return;
      }

      rememberButtonHtml(button);
      button.innerHTML = `<span>${loadingText || "İşleniyor..."}</span>`;
      return;
    }

    button.disabled = false;
    restoreButtonHtml(button);
  }

  function normalizeUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      parsedUrl.hash = "";

      let normalized = parsedUrl.toString();

      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch {
      return "";
    }
  }

  function isSamePageUrl(targetUrl) {
    const current = normalizeUrl(window.location.href);
    const target = normalizeUrl(targetUrl);

    return Boolean(current && target && current === target);
  }

  function isSafeNavigableUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return ["http:", "https:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  }

  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(null);
          return;
        }

        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }

          resolve(result?.[key] || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(false);
          return;
        }

        chrome.storage.local.set(
          {
            [key]: value
          },
          () => {
            if (chrome.runtime?.lastError) {
              resolve(false);
              return;
            }

            resolve(true);
          }
        );
      } catch {
        resolve(false);
      }
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(false);
          return;
        }

        chrome.storage.local.remove([key], () => {
          if (chrome.runtime?.lastError) {
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }

  async function savePendingRecommendationScan(payload) {
    return await storageSet(PENDING_RECOMMENDATION_SCAN_KEY, payload);
  }

  async function getPendingRecommendationScan() {
    const pending = await storageGet(PENDING_RECOMMENDATION_SCAN_KEY);

    if (!pending) {
      return null;
    }

    const createdAt = Number(pending.createdAt || 0);
    const expired = !createdAt || Date.now() - createdAt > PENDING_SCAN_MAX_AGE_MS;

    if (expired) {
      await clearPendingRecommendationScan();
      return null;
    }

    return pending;
  }

  async function clearPendingRecommendationScan() {
    return await storageRemove(PENDING_RECOMMENDATION_SCAN_KEY);
  }

  function clearPendingRecommendationScanTimers() {
    pendingScanTimers.forEach((timerId) => {
      clearTimeout(timerId);
    });

    pendingScanTimers = [];
  }

  function schedulePendingRecommendationScanCheck(reason = "unknown") {
    clearPendingRecommendationScanTimers();

    const delays = [600, 1400, 2600, 4200];

    delays.forEach((delay) => {
      const timerId = setTimeout(async () => {
        await runPendingRecommendationScanCheck(reason);
      }, delay);

      pendingScanTimers.push(timerId);
    });
  }

  async function runPendingRecommendationScanCheck(reason = "unknown") {
    if (pendingScanRunning) {
      return;
    }

    pendingScanRunning = true;

    try {
      const pending = await getPendingRecommendationScan();

      if (!pending) {
        return;
      }

      const targetUrl = pending.targetUrl || "";

      if (!targetUrl || !isSamePageUrl(targetUrl)) {
        return;
      }

      console.log("[RECOMMENDATION EVENTS] Pending öneri taraması başlatılıyor:", {
        reason,
        targetUrl
      });

      const scanned = await scanCurrentPageFromRecommendation();

      if (scanned) {
        await clearPendingRecommendationScan();
        clearPendingRecommendationScanTimers();

        if (window.AdaptiveRagSourcesTab?.refreshSources) {
          await window.AdaptiveRagSourcesTab.refreshSources();
        }
      }
    } catch (error) {
      console.error("[RECOMMENDATION EVENTS] Pending öneri tarama hatası:", error);
    } finally {
      pendingScanRunning = false;
    }
  }

  function canScanCurrentPage() {
    if (!window.AdaptiveRagPageScanRules?.canScanCurrentPage) {
      return {
        allowed: true,
        reason: ""
      };
    }

    return window.AdaptiveRagPageScanRules.canScanCurrentPage();
  }

  function getPageScanRunner() {
    const scanRunners = [
      window.AdaptiveRagPageScanner?.runPageScan,
      window.AdaptiveRagScanPrompt?.runPageScan,
      window.AdaptiveRagScanPrompt?.scanCurrentPage,
      window.AdaptiveRagContentScanner?.runPageScan,
      window.runPageScan
    ];

    return scanRunners.find((runner) => typeof runner === "function") || null;
  }

  async function prepareStoresBeforeScan() {
    try {
      if (window.AdaptiveRagState?.prepareSession) {
        const preparedSession = await window.AdaptiveRagState.prepareSession();

        if (preparedSession === false) {
          return false;
        }

        return true;
      }

      if (window.AdaptiveRagSessionStore?.ensureActiveSession) {
        const session = await window.AdaptiveRagSessionStore.ensureActiveSession();

        if (!session?.id) {
          return false;
        }

        if (window.AdaptiveRagStore?.initResearchSession) {
          await window.AdaptiveRagStore.initResearchSession(session.id);
        }

        return true;
      }

      return true;
    } catch (error) {
      console.error("[RECOMMENDATION EVENTS] Oturum hazırlama hatası:", error);
      return false;
    }
  }

  async function markCurrentUrlAsScanned() {
    if (!window.AdaptiveRagScanSettingsStore?.markUrlScanned) {
      return;
    }

    await window.AdaptiveRagScanSettingsStore.markUrlScanned(window.location.href);
  }

  async function scanCurrentPageFromRecommendation() {
    const scanDecision = canScanCurrentPage();

    if (!scanDecision.allowed) {
      console.warn("[RECOMMENDATION EVENTS] Sayfa taramaya uygun değil:", scanDecision.reason);
      return false;
    }

    const scanRunner = getPageScanRunner();

    if (!scanRunner) {
      console.warn("[RECOMMENDATION EVENTS] Sayfa tarama fonksiyonu bulunamadı.");
      return false;
    }

    const isReady = await prepareStoresBeforeScan();

    if (!isReady) {
      console.warn("[RECOMMENDATION EVENTS] Oturum hazırlanamadı.");
      return false;
    }

    const result = await scanRunner("recommendation-scan");

    if (result?.success === false) {
      console.warn("[RECOMMENDATION EVENTS] Öneri sayfası taranamadı:", result);
      return false;
    }

    await markCurrentUrlAsScanned();

    return true;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  window.AdaptiveRagRecommendationStore = {
    __moduleName: "recommendation-store",

    getState,
    setState,
    clearState,
    setRecommendations
  };

  window.AdaptiveRagRecommendationEvents = {
    __moduleName: "recommendation-events",

    bindRecommendationEvents,
    clearPendingRecommendationScan
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      schedulePendingRecommendationScanCheck("dom-content-loaded");
    });
  } else {
    schedulePendingRecommendationScanCheck("script-loaded");
  }

  window.addEventListener("load", () => {
    schedulePendingRecommendationScanCheck("window-load");
  });
})();