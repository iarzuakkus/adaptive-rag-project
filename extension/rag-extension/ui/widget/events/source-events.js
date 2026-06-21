/**
 * Dosya: source-events.js
 *
 * Görev:
 * - Kaynaklar sekmesindeki buton eventlerini yönetir.
 * - Elle tarama modundaki "Sayfayı tara" butonunu mevcut sayfa tarama akışına bağlar.
 * - "Siteye git" butonlarını çalıştırır.
 *
 * Not:
 * - Kart aç/kapa state'i burada tutulmaz.
 * - Mock veri üretmez.
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

      const openButton = event.target.closest(".rag-open-source-btn");

      if (openButton) {
        event.preventDefault();

        const url = openButton.dataset.url;

        if (!url) {
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
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
    if (typeof renderActiveTab === "function") {
      await renderActiveTab();
      return;
    }

    if (window.AdaptiveRagWidget?.renderActiveTab) {
      await window.AdaptiveRagWidget.renderActiveTab();
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