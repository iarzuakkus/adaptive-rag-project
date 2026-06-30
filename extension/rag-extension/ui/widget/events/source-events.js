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
 *
 * Not:
 * - Öneriler paneline ait eventler bu dosyada değildir.
 * - Öneri üretme, öneri yenileme, öneri siteye gitme ve öneri tarama işlemleri recommendation-events.js içinde yönetilir.
 * - Kaynakların gerçek sahibi backend'dir.
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