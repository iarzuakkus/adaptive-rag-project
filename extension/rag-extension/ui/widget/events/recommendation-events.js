/**
 * Dosya: recommendation-events.js
 *
 * Görev:
 * - Kaynaklar sekmesi içindeki Öneriler panelinin eventlerini yönetir.
 * - Öneri kartlarındaki "Siteye git" ve "Tara ve ekle" butonlarını çalıştırır.
 * - Öneri state bilgisini AdaptiveRagRecommendationStore içinde tutar.
 *
 * Akış:
 * - İlk buton: POST /research/recommendations, yeni/farklı öneri üretir.
 * - İkinci buton: GET /research/recommendations, mevcut önerileri çeker.
 * - Kaynak taranınca: POST /research/recommendations, yeni taranan sayfaya göre öneri üretir.
 * - Kaynak silinince: POST /research/recommendations, kalan kaynaklara göre öneri üretir.
 *
 * Oturum kuralı:
 * - Oturum kapalıysa öneri gösterilmez.
 * - Oturum kapalıysa GET/POST çalışmaz.
 * - Oturum kapalıysa öneri state ve eski öneri cache temizlenir.
 */

(function () {
  if (window.AdaptiveRagRecommendationEvents?.__moduleName === "recommendation-events") {
    return;
  }

  const ACTIVE_SESSION_KEY = "adaptive_rag_active_session";
  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";
  const PENDING_RECOMMENDATION_SCAN_KEY = "adaptive_rag_pending_recommendation_scan";

  const LEGACY_RECOMMENDATION_CACHE_KEY = "adaptive_rag_recommendations_cache_v1";
  const SESSION_RECOMMENDATION_CACHE_KEY = "adaptive_rag_recommendations_by_session_v1";

  const PENDING_SCAN_MAX_AGE_MS = 10 * 60 * 1000;
  const AUTO_GENERATION_COOLDOWN_MS = 8000;

  let lastRenderActiveTab = null;
  let pendingScanRunning = false;
  let pendingScanTimers = [];
  let activePostPromise = null;
  let lastAutoContextKey = "";
  let lastAutoGenerationAt = 0;

  const recommendationState = {
    recommendations: [],
    isLoading: false,
    isRefreshing: false,
    error: "",
    generatedAt: "",
    sourceCount: 0,
    contextKey: "",
    generationMode: "refresh"
  };

  function getState() {
    return {
      ...recommendationState,
      recommendations: [...recommendationState.recommendations]
    };
  }

  function emitStateChange() {
    window.dispatchEvent(
      new CustomEvent("adaptive-rag-recommendations-updated", {
        detail: getState()
      })
    );
  }

  function setState(patch = {}, options = {}) {
    Object.assign(recommendationState, patch);
    emitStateChange();

    if (options.render !== false) {
      renderActiveTabFallback();
    }
  }

  function clearState(options = {}) {
    recommendationState.recommendations = [];
    recommendationState.isLoading = false;
    recommendationState.isRefreshing = false;
    recommendationState.error = "";
    recommendationState.generatedAt = "";
    recommendationState.sourceCount = 0;
    recommendationState.contextKey = "";
    recommendationState.generationMode = "refresh";

    if (options.clearStored !== false) {
      clearStoredRecommendations();
    }

    emitStateChange();

    if (options.render !== false) {
      renderActiveTabFallback();
    }
  }

  function setRecommendations(recommendations = [], options = {}) {
    const incomingRecommendations = normalizeRecommendations(recommendations);

    const shouldPreserveExisting =
      options.preserveIfEmpty === true &&
      incomingRecommendations.length === 0 &&
      recommendationState.recommendations.length > 0;

    recommendationState.recommendations = shouldPreserveExisting
      ? recommendationState.recommendations
      : incomingRecommendations;

    recommendationState.isLoading = false;
    recommendationState.isRefreshing = false;
    recommendationState.error = "";

    recommendationState.generatedAt = shouldPreserveExisting
      ? recommendationState.generatedAt
      : options.generatedAt || new Date().toISOString();

    recommendationState.sourceCount = Number(
      options.sourceCount || recommendationState.sourceCount || 0
    );

    recommendationState.contextKey = options.contextKey || recommendationState.contextKey || "";
    recommendationState.generationMode =
      options.generationMode || recommendationState.generationMode || "refresh";

    persistRecommendationsForActiveSession();
    emitStateChange();

    if (options.render !== false) {
      renderActiveTabFallback();
    }
  }

  function bindRecommendationEvents(renderActiveTab) {
    lastRenderActiveTab = renderActiveTab;

    storageRemove(LEGACY_RECOMMENDATION_CACHE_KEY);
    hydrateRecommendationsForActiveSession({ render: false });

    if (document.body.dataset.ragRecommendationEventsBound === "1") {
      schedulePendingRecommendationScanCheck("already-bound");
      return;
    }

    document.body.dataset.ragRecommendationEventsBound = "1";

    bindSessionStorageWatcher();

    document.addEventListener("click", async (event) => {
      const postButton = event.target.closest("#generateRecommendationsBtn");

      if (postButton) {
        event.preventDefault();
        event.stopPropagation();

        await handlePostRecommendations(postButton, {
          force: true,
          mode: "expand",
          reason: "manual_post_new_recommendations",
          openPanel: false,
          preserveIfEmpty: true
        });

        return;
      }

      const getButton = event.target.closest("#refreshRecommendationsBtn");

      if (getButton) {
        event.preventDefault();
        event.stopPropagation();

        await handleGetRecommendations(getButton);
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

  function bindSessionStorageWatcher() {
    try {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.onChanged ||
        document.body.dataset.ragRecommendationSessionWatcherBound === "1"
      ) {
        return;
      }

      document.body.dataset.ragRecommendationSessionWatcherBound = "1";

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") {
          return;
        }

        if (!changes[SESSION_ENABLED_KEY]) {
          return;
        }

        if (changes[SESSION_ENABLED_KEY].newValue === false) {
          clearState();
          clearPendingRecommendationScan();
          clearPendingRecommendationScanTimers();
        }
      });
    } catch (error) {
      console.warn("[RECOMMENDATION EVENTS] Session watcher bağlanamadı:", error);
    }
  }

  async function isRecommendationSessionActive() {
    try {
      const enabled = await storageGet(SESSION_ENABLED_KEY);

      if (enabled !== true) {
        return false;
      }

      if (window.AdaptiveRagSessionStore?.isSessionActive) {
        return await window.AdaptiveRagSessionStore.isSessionActive();
      }

      if (window.AdaptiveRagState?.isSessionActive) {
        return window.AdaptiveRagState.isSessionActive();
      }

      return true;
    } catch {
      return false;
    }
  }

  async function clearIfSessionClosed(options = {}) {
    const isActive = await isRecommendationSessionActive();

    if (isActive) {
      return true;
    }

    clearState(options);
    await clearPendingRecommendationScan();
    clearPendingRecommendationScanTimers();

    return false;
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

  function buildContextKey(sources = []) {
    return sources
      .map((source) => {
        const id = source?.source_id || "";
        const url = normalizeUrl(source?.url || source?.source_url || source?.page_url || "");
        const title = source?.title || source?.llm_title || source?.original_title || "";

        return `${id}|${url}|${title}`;
      })
      .filter(Boolean)
      .sort()
      .join("::");
  }

  function getFocusedSources(options = {}) {
    const sources = getSourcesForRecommendation();
    const allSources = sources.map(normalizeSourceForRequest);

    if (options.focusCurrentPage !== true) {
      return allSources;
    }

    const currentPageUrl = normalizeUrl(window.location.href);

    const currentPageSources = allSources.filter((source) => {
      const sourceUrl = normalizeUrl(
        source?.url ||
        source?.source_url ||
        source?.page_url ||
        ""
      );

      return Boolean(sourceUrl && currentPageUrl && sourceUrl === currentPageUrl);
    });

    return currentPageSources.length ? currentPageSources : allSources;
  }

  async function getFocusedSourcesAsync(options = {}) {
    let sources = getFocusedSources(options);

    if (sources.length > 0 && options.forceReloadSources !== true) {
      return sources;
    }

    if (window.AdaptiveRagSourcesTab?.refreshSources) {
      await window.AdaptiveRagSourcesTab.refreshSources({
        skipRecommendationRefresh: true
      });

      await wait(250);
    }

    sources = getFocusedSources({
      ...options,
      focusCurrentPage: false
    });

    return sources;
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

  function cleanText(value, maxLength = 500) {
    const text = String(value || "").trim().replace(/\s+/g, " ");

    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength).trim()}...`;
  }

  function buildExistingRecommendationExcludes() {
    const excludeRecommendations = [];
    const excludeUrls = [];
    const excludeQueries = [];
    const excludeTitles = [];
    const excludeDomains = [];

    recommendationState.recommendations.forEach((item) => {
      const title = cleanText(item?.title, 220);
      const url = cleanText(item?.url, 800);
      const query = cleanText(item?.query, 260);
      const domain = cleanText(item?.domain, 180);

      if (title) {
        excludeTitles.push(title);
      }

      if (url) {
        excludeUrls.push(url);
      }

      if (query) {
        excludeQueries.push(query);
      }

      if (domain && domain.includes(".")) {
        excludeDomains.push(domain);
      }

      if (title || url || query || domain) {
        excludeRecommendations.push({
          title,
          url,
          query,
          domain
        });
      }
    });

    return {
      exclude_recommendations: excludeRecommendations.slice(0, 20),
      exclude_urls: Array.from(new Set(excludeUrls)).slice(0, 20),
      exclude_queries: Array.from(new Set(excludeQueries)).slice(0, 20),
      exclude_titles: Array.from(new Set(excludeTitles)).slice(0, 20),
      exclude_domains: Array.from(new Set(excludeDomains)).slice(0, 20)
    };
  }

  async function handleGetRecommendations(button) {
    if (recommendationState.isLoading || recommendationState.isRefreshing) {
      return;
    }

    const previousRecommendations = [...recommendationState.recommendations];

    try {
      setButtonLoading(button, true, "Alınıyor...");

      setState({
        isLoading: false,
        isRefreshing: true,
        error: ""
      });

      const response = await sendBackgroundMessage({
        type: "GET_RECOMMENDATIONS",
        payload: {
          source_count: recommendationState.sourceCount || 0
        }
      });

      if (!response?.success) {
        throw new Error(response?.message || "Mevcut öneriler alınamadı.");
      }

      const recommendations = extractRecommendationsFromResponse(response);
      const generatedAt = extractGeneratedAtFromResponse(response);
      const sourceCount = extractSourceCountFromResponse(
        response,
        recommendationState.sourceCount
      );

      setRecommendations(recommendations, {
        generatedAt,
        sourceCount,
        generationMode: recommendationState.generationMode,
        preserveIfEmpty: previousRecommendations.length > 0
      });

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "success");
        await wait(450);
      }
    } catch (error) {
      console.error("[RECOMMENDATION EVENTS] GET öneri alma hatası:", error);

      setState({
        recommendations: previousRecommendations,
        isLoading: false,
        isRefreshing: false,
        error: previousRecommendations.length
          ? ""
          : error.message || "Mevcut öneriler alınamadı."
      });

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "error");
        await wait(500);
      }
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function handlePostRecommendations(button, options = {}) {
    if (recommendationState.isLoading || activePostPromise) {
      return activePostPromise;
    }

    activePostPromise = runPostRecommendations(button, options)
      .finally(() => {
        activePostPromise = null;
      });

    return activePostPromise;
  }

  async function runPostRecommendations(button, options = {}) {
    const mode = options.mode === "expand" ? "expand" : "refresh";
    const sources = await getFocusedSourcesAsync(options);
    const contextKey = buildContextKey(sources);
    const previousRecommendations = [...recommendationState.recommendations];

    if (options.openPanel !== false) {
      setRecommendationSubtab();
    }

    if (!sources.length) {
      if (options.clearIfNoSources === true) {
        clearState();
        return getState();
      }

      setState({
        recommendations: previousRecommendations,
        isLoading: false,
        isRefreshing: false,
        error: previousRecommendations.length ? "" : "Öneri üretmek için önce kaynak taranmalı.",
        generatedAt: recommendationState.generatedAt,
        sourceCount: 0,
        contextKey: "",
        generationMode: mode
      });

      return getState();
    }

    if (options.auto === true && shouldSkipAutoGeneration(contextKey)) {
      return getState();
    }

    if (options.auto === true) {
      markAutoGeneration(contextKey);
    }

    const excludes = mode === "expand"
      ? buildExistingRecommendationExcludes()
      : {
        exclude_recommendations: [],
        exclude_urls: [],
        exclude_queries: [],
        exclude_titles: [],
        exclude_domains: []
      };

    try {
      setButtonLoading(
        button,
        true,
        mode === "expand" ? "Yeni öneriler..." : "Öneri hazırlanıyor..."
      );

      setState({
        isLoading: true,
        isRefreshing: false,
        error: "",
        sourceCount: sources.length,
        contextKey,
        generationMode: mode
      });

      const response = await sendBackgroundMessage({
        type: "GENERATE_RECOMMENDATIONS",
        payload: {
          sources,
          source_count: sources.length,
          force: options.force === true,
          mode,
          generation_mode: mode,
          reason: options.reason || "",
          exclude_recommendations: excludes.exclude_recommendations,
          exclude_urls: excludes.exclude_urls,
          exclude_queries: excludes.exclude_queries,
          exclude_titles: excludes.exclude_titles,
          exclude_domains: excludes.exclude_domains
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
        sources.length
      );

      setRecommendations(recommendations, {
        generatedAt,
        sourceCount,
        contextKey,
        generationMode: mode,
        preserveIfEmpty: options.preserveIfEmpty === true && previousRecommendations.length > 0
      });

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "success");
        await wait(450);
      }

      return getState();
    } catch (error) {
      console.error("[RECOMMENDATION EVENTS] POST öneri üretme hatası:", error);

      setState({
        recommendations: previousRecommendations,
        isLoading: false,
        isRefreshing: false,
        error: previousRecommendations.length
          ? ""
          : error.message || "Öneriler üretilirken hata oluştu.",
        generatedAt: recommendationState.generatedAt,
        sourceCount: sources.length,
        contextKey,
        generationMode: mode
      });

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "error");
        await wait(500);
      }

      return getState();
    } finally {
      setButtonLoading(button, false);
    }
  }

  function shouldSkipAutoGeneration(contextKey) {
    if (!contextKey) {
      return true;
    }

    return (
      lastAutoContextKey === contextKey &&
      Date.now() - lastAutoGenerationAt < AUTO_GENERATION_COOLDOWN_MS
    );
  }

  function markAutoGeneration(contextKey) {
    lastAutoContextKey = contextKey || "";
    lastAutoGenerationAt = Date.now();
  }

  async function generateRecommendationsAfterSourceChange(options = {}) {
    return await handlePostRecommendations(null, {
      force: true,
      mode: "refresh",
      reason: options.reason || "auto_recommend_after_source_change",
      auto: options.skipAutoCooldown === true ? false : true,
      openPanel: false,
      focusCurrentPage: options.focusCurrentPage === true,
      clearIfNoSources: options.clearIfNoSources === true,
      preserveIfEmpty: options.preserveIfEmpty === true,
      forceReloadSources: options.forceReloadSources === true
    });
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

      if (normalized.endsWith("/") && parsedUrl.pathname !== "/") {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch {
      return String(url || "").trim();
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

  async function getActiveSessionId() {
    try {
      if (window.AdaptiveRagSessionStore?.getActiveSessionId) {
        const sessionId = await window.AdaptiveRagSessionStore.getActiveSessionId();
        return sessionId || "";
      }

      const session = await storageGet(ACTIVE_SESSION_KEY);
      return session?.id || "";
    } catch {
      return "";
    }
  }

  async function getRecommendationCacheMap() {
    const cache = await storageGet(SESSION_RECOMMENDATION_CACHE_KEY);

    if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
      return {};
    }

    return cache;
  }

  async function persistRecommendationsForActiveSession() {
    const sessionId = await getActiveSessionId();

    if (!sessionId || !recommendationState.recommendations.length) {
      return false;
    }

    const cache = await getRecommendationCacheMap();

    cache[sessionId] = {
      savedAt: Date.now(),
      state: getState()
    };

    await storageRemove(LEGACY_RECOMMENDATION_CACHE_KEY);
    return await storageSet(SESSION_RECOMMENDATION_CACHE_KEY, cache);
  }

  async function hydrateRecommendationsForActiveSession(options = {}) {
    const enabled = await storageGet(SESSION_ENABLED_KEY);

    if (enabled !== true) {
      clearState({
        render: options.render === true,
        clearStored: true
      });

      return getState();
    }

    const sessionId = await getActiveSessionId();

    if (!sessionId) {
      clearState({
        render: options.render === true,
        clearStored: true
      });

      return getState();
    }

    const cache = await getRecommendationCacheMap();
    const cached = cache[sessionId];

    if (!cached?.state) {
      return getState();
    }

    const cachedState = cached.state;
    const recommendations = normalizeRecommendations(cachedState.recommendations);

    recommendationState.recommendations = recommendations;
    recommendationState.isLoading = false;
    recommendationState.isRefreshing = false;
    recommendationState.error = "";
    recommendationState.generatedAt = cachedState.generatedAt || "";
    recommendationState.sourceCount = Number(cachedState.sourceCount || 0);
    recommendationState.contextKey = cachedState.contextKey || "";
    recommendationState.generationMode = cachedState.generationMode || "refresh";

    emitStateChange();

    if (options.render === true) {
      renderActiveTabFallback();
    }

    return getState();
  }

  async function clearStoredRecommendations() {
    await storageRemove(LEGACY_RECOMMENDATION_CACHE_KEY);
    await storageRemove(SESSION_RECOMMENDATION_CACHE_KEY);
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

    [600, 1400, 2600, 4200].forEach((delay) => {
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

    const canRun = await clearIfSessionClosed({
      render: false
    });

    if (!canRun) {
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
          await window.AdaptiveRagSourcesTab.refreshSources({
            skipRecommendationRefresh: true
          });
        }

        await generateRecommendationsAfterSourceChange({
          reason: "auto_recommend_after_recommendation_scan",
          focusCurrentPage: true,
          preserveIfEmpty: false
        });
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
      if (!window.AdaptiveRagSessionStore?.getActiveSession) {
        return false;
      }

      const session = await window.AdaptiveRagSessionStore.getActiveSession();

      if (!session?.id) {
        return false;
      }

      if (window.AdaptiveRagStore?.initResearchSession) {
        await window.AdaptiveRagStore.initResearchSession(session.id);
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
    generateRecommendationsAfterSourceChange,
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