/**
 * Dosya: source-events.js
 *
 * Görev:
 * - Kaynaklar sekmesindeki buton eventlerini yönetir.
 * - Kaynaklar / Öneriler alt sekme geçişlerini yönetir.
 * - Elle tarama modundaki "Sayfayı tara" butonunu mevcut sayfa tarama akışına bağlar.
 * - Backend kaynak listesini yeniler.
 * - Kaynak detay isteğini backend'e gönderir.
 * - Kaynak detayını Kaynaklar sekmesinin içinde açar.
 * - "Siteye git" butonlarını çalıştırır.
 * - "Sil" butonuyla kaynağı backend üzerinden siler.
 * - Öneriler paneli için ilk UI event altyapısını hazırlar.
 *
 * Not:
 * - Mock veri üretmez.
 * - Kaynakların gerçek sahibi backend'dir.
 * - Öneri üretme backend entegrasyonu daha sonra recommendation/research servisine bağlanacaktır.
 * - İkon-only butonlarda yazılı loading basılmaz; spinner / tik / hata ikonu kullanılır.
 */

(function () {
  if (window.AdaptiveRagSourceEvents?.__moduleName === "source-events") {
    return;
  }

  let lastRenderActiveTab = null;

  function bindSourceEvents(renderActiveTab) {
    lastRenderActiveTab = renderActiveTab;

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

      const generateRecommendationsButton = event.target.closest(
        "#generateRecommendationsBtn"
      );

      if (generateRecommendationsButton) {
        event.preventDefault();
        await handleGenerateRecommendations(
          generateRecommendationsButton,
          lastRenderActiveTab
        );
        return;
      }

      const refreshRecommendationsButton = event.target.closest(
        "#refreshRecommendationsBtn"
      );

      if (refreshRecommendationsButton) {
        event.preventDefault();
        await handleRefreshRecommendations(
          refreshRecommendationsButton,
          lastRenderActiveTab
        );
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
        handleOpenUrlButton(openButton);
        return;
      }

      const openRecommendationButton = event.target.closest(
        ".rag-open-recommendation-btn"
      );

      if (openRecommendationButton) {
        event.preventDefault();
        handleOpenUrlButton(openRecommendationButton);
        return;
      }

      const scanRecommendationButton = event.target.closest(
        ".rag-scan-recommendation-btn"
      );

      if (scanRecommendationButton) {
        event.preventDefault();
        await handleScanRecommendation(
          scanRecommendationButton,
          lastRenderActiveTab
        );
        return;
      }

      const deleteButton = event.target.closest(".rag-delete-source-btn");

      if (deleteButton) {
        event.preventDefault();
        await handleDeleteSource(deleteButton, lastRenderActiveTab);
      }
    });
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

  async function refreshSourcesTab(renderActiveTab) {
    if (window.AdaptiveRagSourcesTab?.refreshSources) {
      await window.AdaptiveRagSourcesTab.refreshSources();
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

      await refreshSourcesTab(renderActiveTab);

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

  function handleOpenUrlButton(button) {
    const url = button.dataset.url;

    if (!url) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
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

      console.log("[SOURCE EVENTS] Kaynak silindi:", response.data);

      await refreshSourcesTab(renderActiveTab);
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

      await refreshSourcesTab(renderActiveTab);
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

  async function handleGenerateRecommendations(button, renderActiveTab) {
    if (button.dataset.loading === "1") {
      return;
    }

    try {
      button.dataset.loading = "1";
      setButtonLoading(button, true, "Üretiliyor...");

      if (window.AdaptiveRagSourcesTab?.setSourcesSubTab) {
        window.AdaptiveRagSourcesTab.setSourcesSubTab("recommendations");
      }

      await wait(350);

      if (typeof renderActiveTab === "function") {
        await renderActiveTab();
      } else if (window.AdaptiveRagWidget?.renderActiveTab) {
        await window.AdaptiveRagWidget.renderActiveTab();
      }

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "success");
        await wait(450);
      }

      console.log("[SOURCE EVENTS] Öneri üretme UI akışı hazır. Backend entegrasyonu daha sonra bağlanacak.");
    } catch (error) {
      console.error("[SOURCE EVENTS] Öneri üretme hatası:", error);

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "error");
        await wait(500);
      }

      alert(error.message || "Öneriler üretilirken hata oluştu.");
    } finally {
      button.dataset.loading = "0";
      setButtonLoading(button, false);
    }
  }

  async function handleRefreshRecommendations(button, renderActiveTab) {
    if (button.dataset.loading === "1") {
      return;
    }

    try {
      button.dataset.loading = "1";
      setButtonLoading(button, true, "Yenileniyor...");

      await wait(250);

      if (window.AdaptiveRagSourcesTab?.setSourcesSubTab) {
        window.AdaptiveRagSourcesTab.setSourcesSubTab("recommendations");
      }

      if (typeof renderActiveTab === "function") {
        await renderActiveTab();
      } else if (window.AdaptiveRagWidget?.renderActiveTab) {
        await window.AdaptiveRagWidget.renderActiveTab();
      }

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "success");
        await wait(450);
      }
    } catch (error) {
      console.error("[SOURCE EVENTS] Öneri yenileme hatası:", error);

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "error");
        await wait(500);
      }

      alert(error.message || "Öneriler yenilenirken hata oluştu.");
    } finally {
      button.dataset.loading = "0";
      setButtonLoading(button, false);
    }
  }

  async function handleScanRecommendation(button, renderActiveTab) {
    if (button.dataset.loading === "1") {
      return;
    }

    const url = button.dataset.url || "";

    try {
      button.dataset.loading = "1";
      setButtonLoading(button, true, "Hazırlanıyor...");

      await wait(300);

      if (!url) {
        throw new Error(
          "Bu öneri henüz gerçek bir URL'ye bağlı değil. Backend öneri sistemi bağlanınca bu buton önerilen sayfayı tarayıp kaynaklara ekleyecek."
        );
      }

      window.open(url, "_blank", "noopener,noreferrer");

      if (typeof renderActiveTab === "function") {
        await renderActiveTab();
      }

      if (isIconOnlyButton(button)) {
        setIconButtonState(button, "success");
        await wait(450);
      }
    } catch (error) {
      console.error("[SOURCE EVENTS] Öneri tarama hatası:", error);

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