/**
 * Dosya: source-events.js
 *
 * Görev:
 * - Kaynaklar sekmesindeki kaynak eventlerini yönetir.
 * - Kaynaklar / Öneriler alt sekme geçişlerini yönetir.
 * - Elle tarama modundaki "Sayfayı tara" butonunu mevcut sayfa tarama akışına bağlar.
 * - Backend kaynak listesini yeniler.
 * - Kaynak detay isteğini backend'e gönderir.
 * - Kaynak detayını Kaynaklar sekmesinin içinde açar.
 * - Kaynak kartlarındaki "Siteye git" butonlarını çalıştırır.
 * - "Sil" butonuyla kaynağı backend üzerinden siler.
 * - Başarılı kaynak taramasından sonra önerileri otomatik günceller.
 *
 * Oturum kuralı:
 * - Oturum kapalıysa kaynak aksiyonları çalışmaz.
 * - Oturum kapalıyken bu dosya yeni session oluşturmaz.
 *
 * Not:
 * - Öneriler paneline ait eventler bu dosyada değildir.
 * - İlk öneri butonu POST, ikinci öneri butonu GET akışı recommendation-events.js içindedir.
 * - Kaynakların gerçek sahibi backend'dir.
 */

(function () {
  if (window.AdaptiveRagSourceEvents?.__moduleName === "source-events") {
    return;
  }

  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";

  let lastRenderActiveTab = null;

  function bindSourceEvents(renderActiveTab) {
    lastRenderActiveTab = renderActiveTab;

    bindSessionStorageWatcher();

    if (document.body.dataset.ragSourceEventsBound === "1") {
      return;
    }

    document.body.dataset.ragSourceEventsBound = "1";

    document.addEventListener("click", async (event) => {
      const subtabButton = event.target.closest(".rag-source-subtab");

      if (subtabButton) {
        event.preventDefault();
        handleSourceSubtabChange(subtabButton);
        return;
      }

      const backButton = event.target.closest(".rag-source-back-btn");

      if (backButton) {
        event.preventDefault();
        handleBackToSources();
        return;
      }

      const scanButton = event.target.closest(
        "#scanCurrentPageBtn, [data-rag-action='scan-current-page']"
      );

      if (scanButton) {
        event.preventDefault();
        await handleScanCurrentPage(scanButton, lastRenderActiveTab);
        return;
      }

      const refreshButton = event.target.closest("#refreshSourcesBtn");

      if (refreshButton) {
        event.preventDefault();
        await handleRefreshSources(refreshButton, lastRenderActiveTab);
        return;
      }

      const detailButton = event.target.closest(".rag-source-detail-btn");

      if (detailButton) {
        event.preventDefault();
        await handleSourceDetail(detailButton);
        return;
      }

      const openButton = event.target.closest(".rag-open-source-btn");

      if (openButton) {
        event.preventDefault();
        await handleOpenUrlButton(openButton);
        return;
      }

      const deleteButton = event.target.closest(".rag-delete-source-btn");

      if (deleteButton) {
        event.preventDefault();
        await handleDeleteSource(deleteButton, lastRenderActiveTab);
      }
    });
  }

  function bindSessionStorageWatcher() {
    try {
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.onChanged ||
        document.body.dataset.ragSourceSessionWatcherBound === "1"
      ) {
        return;
      }

      document.body.dataset.ragSourceSessionWatcherBound = "1";

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") {
          return;
        }

        if (!changes[SESSION_ENABLED_KEY]) {
          return;
        }

        if (changes[SESSION_ENABLED_KEY].newValue === false) {
          resetSourceSideUi();
        }
      });
    } catch (error) {
      console.warn("[SOURCE EVENTS] Session watcher bağlanamadı:", error);
    }
  }

  function resetSourceSideUi() {
    if (window.AdaptiveRagRecommendationStore?.clearState) {
      window.AdaptiveRagRecommendationStore.clearState({
        render: false
      });
    }

    if (window.AdaptiveRagRecommendationEvents?.clearPendingRecommendationScan) {
      window.AdaptiveRagRecommendationEvents.clearPendingRecommendationScan();
    }

    if (window.AdaptiveRagScanSettingsStore?.clearScanHistory) {
      window.AdaptiveRagScanSettingsStore.clearScanHistory();
    }

    if (window.AdaptiveRagSourcesTab?.clearSourcesCache) {
      window.AdaptiveRagSourcesTab.clearSourcesCache();
    }

    if (window.AdaptiveRagSourcesTab?.closeSourceDetail) {
      window.AdaptiveRagSourcesTab.closeSourceDetail();
    }

    if (window.AdaptiveRagSourcesTab?.setSourcesSubTab) {
      window.AdaptiveRagSourcesTab.setSourcesSubTab("sources");
    }

    window.dispatchEvent(new CustomEvent("adaptive-rag-source-session-cleared"));
    renderSourcesTabFallback();
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

          resolve(result?.[key] ?? null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function isSourceSessionActive() {
    try {
      const enabled = await storageGet(SESSION_ENABLED_KEY);

      if (enabled !== true) {
        return false;
      }

      if (window.AdaptiveRagSessionStore?.getActiveSession) {
        const session = await window.AdaptiveRagSessionStore.getActiveSession();
        return Boolean(session?.id);
      }

      if (window.AdaptiveRagState?.isSessionActive) {
        return window.AdaptiveRagState.isSessionActive();
      }

      return true;
    } catch {
      return false;
    }
  }

  async function guardSourceSession(options = {}) {
    const isActive = await isSourceSessionActive();

    if (isActive) {
      return true;
    }

    if (window.AdaptiveRagRecommendationStore?.clearState) {
      window.AdaptiveRagRecommendationStore.clearState({
        render: false
      });
    }

    if (options.alert === true) {
      alert("Önce oturumu açmalısın.");
    }

    return false;
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
      console.error("[SOURCE EVENTS] Oturum hazırlama hatası:", error);
      return false;
    }
  }

  async function markCurrentUrlAsScanned() {
    if (!window.AdaptiveRagScanSettingsStore?.markUrlScanned) {
      return;
    }

    await window.AdaptiveRagScanSettingsStore.markUrlScanned(window.location.href);
  }

  async function unmarkDeletedSourceUrl(url) {
    if (!url || !window.AdaptiveRagScanSettingsStore) {
      return;
    }

    const store = window.AdaptiveRagScanSettingsStore;

    if (typeof store.unmarkUrl === "function") {
      await store.unmarkUrl(url);
      return;
    }

    if (typeof store.unmarkUrlScanned === "function") {
      await store.unmarkUrlScanned(url);
    }

    if (typeof store.unmarkUrlDismissed === "function") {
      await store.unmarkUrlDismissed(url);
    }
  }

  async function refreshSourcesTab(renderActiveTab, options = {}) {
    if (window.AdaptiveRagSourcesTab?.refreshSources) {
      await window.AdaptiveRagSourcesTab.refreshSources(options);
      return;
    }

    if (typeof renderActiveTab === "function") {
      await renderActiveTab();
      return;
    }

    if (window.AdaptiveRagWidget?.renderActiveTab) {
      await window.AdaptiveRagWidget.renderActiveTab();
    }
  }

  async function refreshRecommendationsAfterSourceScan(options = {}) {
    try {
      const recommendationEvents = window.AdaptiveRagRecommendationEvents;

      if (
        !recommendationEvents ||
        typeof recommendationEvents.generateRecommendationsAfterSourceChange !== "function"
      ) {
        console.warn(
          "[SOURCE EVENTS] Otomatik öneri güncelleme fonksiyonu bulunamadı."
        );

        return null;
      }

      return await recommendationEvents.generateRecommendationsAfterSourceChange({
        silent: false,
        refreshSources: false,
        reason: options.reason || "auto_recommend_after_source_change",
        focusCurrentPage: options.focusCurrentPage === true,
        clearIfNoSources: options.clearIfNoSources === true,
        preserveIfEmpty: options.preserveIfEmpty === true,
        skipAutoCooldown: options.skipAutoCooldown === true,
        forceReloadSources: options.forceReloadSources === true
      });
    } catch (error) {
      console.warn(
        "[SOURCE EVENTS] Kaynak sonrası otomatik öneri güncelleme başarısız:",
        error
      );

      return null;
    }
  }

  function renderSourcesTabFallback() {
    if (typeof lastRenderActiveTab === "function") {
      lastRenderActiveTab();
      return;
    }

    if (window.AdaptiveRagWidget?.renderActiveTab) {
      window.AdaptiveRagWidget.renderActiveTab();
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

  function handleSourceSubtabChange(button) {
    const nextSubtab = button.dataset.sourceSubtab;

    if (!nextSubtab) {
      return;
    }

    if (window.AdaptiveRagSourcesTab?.setSourcesSubTab) {
      window.AdaptiveRagSourcesTab.setSourcesSubTab(nextSubtab);
      return;
    }

    renderSourcesTabFallback();
  }

  function handleBackToSources() {
    if (window.AdaptiveRagSourcesTab?.closeSourceDetail) {
      window.AdaptiveRagSourcesTab.closeSourceDetail();
      return;
    }

    renderSourcesTabFallback();
  }

  async function handleRefreshSources(refreshButton, renderActiveTab) {
    if (refreshButton.dataset.loading === "1") {
      return;
    }

    try {
      refreshButton.dataset.loading = "1";
      setButtonLoading(refreshButton, true, "Yenileniyor...");

      await refreshSourcesTab(renderActiveTab, {
        skipRecommendationRefresh: true
      });

      if (isIconOnlyButton(refreshButton)) {
        setIconButtonState(refreshButton, "success");
        await wait(450);
      }
    } catch (error) {
      console.error("[SOURCE EVENTS] Kaynak yenileme hatası:", error);

      if (isIconOnlyButton(refreshButton)) {
        setIconButtonState(refreshButton, "error");
        await wait(500);
      }

      alert(error.message || "Kaynaklar yenilenirken hata oluştu.");
    } finally {
      refreshButton.dataset.loading = "0";
      setButtonLoading(refreshButton, false);
    }
  }

  async function handleSourceDetail(detailButton) {
    const sourceId = detailButton.dataset.sourceId;

    if (!sourceId) {
      alert("Kaynak kimliği bulunamadı.");
      return;
    }

    if (detailButton.dataset.loading === "1") {
      return;
    }

    try {
      detailButton.dataset.loading = "1";
      setButtonLoading(detailButton, true, "Açılıyor...");

      const response = await sendBackgroundMessage({
        type: "GET_SOURCE_DETAIL",
        sourceId
      });

      if (!response?.success) {
        throw new Error(response?.message || "Kaynak detayı alınamadı.");
      }

      const source = response.data?.source;

      if (!source) {
        throw new Error("Backend kaynak detayı döndürmedi.");
      }

      if (window.AdaptiveRagSourcesTab?.openSourceDetail) {
        window.AdaptiveRagSourcesTab.openSourceDetail(source);
        return;
      }

      window.dispatchEvent(
        new CustomEvent("adaptive-rag-source-detail", {
          detail: {
            source
          }
        })
      );

      console.log("[SOURCE EVENTS] Kaynak detayı alındı:", source);
    } catch (error) {
      console.error("[SOURCE EVENTS] Kaynak detay hatası:", error);
      alert(error.message || "Kaynak detayı açılırken hata oluştu.");
    } finally {
      detailButton.dataset.loading = "0";
      setButtonLoading(detailButton, false);
    }
  }

  async function handleOpenUrlButton(button) {
    const url = button.dataset.url;

    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function resolveDeletedSourceUrl(deleteButton, response) {
    const fromButton =
      deleteButton.dataset.url ||
      deleteButton.dataset.sourceUrl ||
      "";

    if (fromButton) {
      return fromButton;
    }

    const card = deleteButton.closest(
      "[data-source-url], [data-url], .rag-source-card, article"
    );

    const fromCard =
      card?.dataset?.sourceUrl ||
      card?.dataset?.url ||
      "";

    if (fromCard) {
      return fromCard;
    }

    const openButton = card?.querySelector?.(".rag-open-source-btn");
    const fromOpenButton = openButton?.dataset?.url || "";

    if (fromOpenButton) {
      return fromOpenButton;
    }

    const data = response?.data || {};

    return (
      data.url ||
      data.source_url ||
      data.page_url ||
      data.deleted_url ||
      data.source?.url ||
      data.source?.source_url ||
      ""
    );
  }

  async function handleDeleteSource(deleteButton, renderActiveTab) {
    const sourceId = deleteButton.dataset.sourceId;

    if (!sourceId) {
      alert("Silinecek kaynak kimliği bulunamadı.");
      return;
    }

    if (deleteButton.dataset.loading === "1") {
      return;
    }

    const shouldDelete = confirm("Bu kaynağı silmek istediğine emin misin?");

    if (!shouldDelete) {
      return;
    }

    try {
      deleteButton.dataset.loading = "1";
      setButtonLoading(deleteButton, true, "Siliniyor...");

      const response = await sendBackgroundMessage({
        type: "DELETE_SOURCE",
        sourceId
      });

      if (!response?.success) {
        throw new Error(response?.message || "Kaynak silinemedi.");
      }

      const deletedSourceUrl = resolveDeletedSourceUrl(deleteButton, response);

      await unmarkDeletedSourceUrl(deletedSourceUrl);

      console.log("[SOURCE EVENTS] Kaynak silindi:", {
        response: response.data,
        deletedSourceUrl
      });

      await refreshSourcesTab(renderActiveTab, {
        skipRecommendationRefresh: true
      });

      await refreshRecommendationsAfterSourceScan({
        reason: "auto_recommend_after_delete",
        focusCurrentPage: false,
        clearIfNoSources: true,
        preserveIfEmpty: false
      });
    } catch (error) {
      console.error("[SOURCE EVENTS] Kaynak silme hatası:", error);
      alert(error.message || "Kaynak silinirken hata oluştu.");
    } finally {
      deleteButton.dataset.loading = "0";
      setButtonLoading(deleteButton, false);
    }
  }

  async function handleScanCurrentPage(scanButton, renderActiveTab) {
    if (scanButton.dataset.scanning === "1") {
      return;
    }

    try {
      const scanDecision = canScanCurrentPage();

      if (!scanDecision.allowed) {
        alert(scanDecision.reason || "Bu sayfa taramaya uygun değil.");
        return;
      }

      const scanRunner = getPageScanRunner();

      if (!scanRunner) {
        console.error("[SOURCE EVENTS] Sayfa tarama fonksiyonu bulunamadı.", {
          AdaptiveRagPageScanner: window.AdaptiveRagPageScanner,
          AdaptiveRagScanPrompt: window.AdaptiveRagScanPrompt,
          AdaptiveRagContentScanner: window.AdaptiveRagContentScanner,
          runPageScan: window.runPageScan
        });

        alert(
          "Sayfa tarama fonksiyonu bulunamadı. scan-prompt.js veya content.js içinde runPageScan fonksiyonunun window'a açıldığını kontrol et."
        );
        return;
      }

      scanButton.dataset.scanning = "1";
      scanButton.disabled = true;
      setIconButtonState(scanButton, "loading");

      const isReady = await prepareStoresBeforeScan();

      if (!isReady) {
        throw new Error("Oturum hazırlanamadı. Popup içinden oturumu açıp tekrar dene.");
      }

      const result = await scanRunner("manual-sources-button");

      if (result?.success === false) {
        throw new Error(result?.message || "Sayfa taranamadı.");
      }

      await markCurrentUrlAsScanned();

      setIconButtonState(scanButton, "success");
      await wait(650);

      await refreshSourcesTab(renderActiveTab, {
        skipRecommendationRefresh: true
      });

      await wait(350);

      await refreshSourcesTab(renderActiveTab, {
        skipRecommendationRefresh: true
      });

      await refreshRecommendationsAfterSourceScan({
        reason: "auto_recommend_after_scan",
        focusCurrentPage: false,
        preserveIfEmpty: true,
        skipAutoCooldown: true,
        forceReloadSources: true
      });
    } catch (error) {
      console.error("[SOURCE EVENTS] Sayfa tarama hatası:", error);

      setIconButtonState(scanButton, "error");
      await wait(550);

      alert(error.message || "Sayfa taranırken hata oluştu.");
    } finally {
      setTimeout(() => {
        if (document.body.contains(scanButton)) {
          scanButton.dataset.scanning = "0";
          scanButton.disabled = false;
          restoreButtonHtml(scanButton);
        }
      }, 350);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  window.AdaptiveRagSourceEvents = {
    __moduleName: "source-events",

    bindSourceEvents
  };
})();