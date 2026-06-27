/**
 * Dosya: source-events.js
 *
 * Görev:
 * - Kaynaklar sekmesindeki buton eventlerini yönetir.
 * - Elle tarama modundaki "Sayfayı tara" butonunu mevcut sayfa tarama akışına bağlar.
 * - Backend kaynak listesini yeniler.
 * - Kaynak detay isteğini backend'e gönderir.
 * - "Siteye git" butonlarını çalıştırır.
 * - "Sil" butonuyla kaynağı backend + vector store üzerinden siler.
 *
 * Not:
 * - Mock veri üretmez.
 * - Kaynakların gerçek sahibi backend'dir.
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
        handleOpenSource(openButton);
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

  function setButtonLoading(button, isLoading, loadingText) {
    if (!button) {
      return;
    }

    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = loadingText || "İşleniyor...";
      return;
    }

    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
  }

  async function handleRefreshSources(refreshButton, renderActiveTab) {
    if (refreshButton.dataset.loading === "1") {
      return;
    }

    try {
      refreshButton.dataset.loading = "1";
      setButtonLoading(refreshButton, true, "Yenileniyor...");

      await refreshSourcesTab(renderActiveTab);
    } catch (error) {
      console.error("[SOURCE EVENTS] Kaynak yenileme hatası:", error);
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

      if (window.AdaptiveRagSourceDetail?.openSourceDetail) {
        window.AdaptiveRagSourceDetail.openSourceDetail(source);
        return;
      }

      if (window.AdaptiveRagSourceDetail?.renderSourceDetail) {
        window.AdaptiveRagSourceDetail.renderSourceDetail(source);
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

  function handleOpenSource(openButton) {
    const url = openButton.dataset.url;

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

    const shouldDelete = confirm(
      "Bu kaynağı silmek istediğine emin misin? Kaynağa ait tüm parçalar vector store'dan kaldırılacak."
    );

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

    const originalText = scanButton.textContent;

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
      scanButton.textContent = "Taranıyor...";

      const isReady = await prepareStoresBeforeScan();

      if (!isReady) {
        throw new Error("Oturum hazırlanamadı. Popup içinden oturumu açıp tekrar dene.");
      }

      const result = await scanRunner("manual-sources-button");

      if (result?.success === false) {
        throw new Error(result?.message || "Sayfa taranamadı.");
      }

      await markCurrentUrlAsScanned();

      scanButton.textContent = result?.skipped ? "Zaten tarandı" : "Tarandı";

      await refreshSourcesTab(renderActiveTab);
    } catch (error) {
      console.error("[SOURCE EVENTS] Sayfa tarama hatası:", error);

      scanButton.textContent = "Tekrar dene";
      alert(error.message || "Sayfa taranırken hata oluştu.");
    } finally {
      setTimeout(() => {
        if (document.body.contains(scanButton)) {
          scanButton.dataset.scanning = "0";
          scanButton.disabled = false;
          scanButton.textContent = originalText;
        }
      }, 1000);
    }
  }

  window.AdaptiveRagSourceEvents = {
    __moduleName: "source-events",

    bindSourceEvents
  };
})();