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

  function bindSourceEvents(renderActiveTab) {
    bindScanCurrentPageButton(renderActiveTab);
    bindOpenSourceButtons();
  }

  function bindScanCurrentPageButton(renderActiveTab) {
    const scanButton = document.getElementById("scanCurrentPageBtn");

    if (!scanButton) {
      return;
    }

    scanButton.addEventListener("click", async () => {
      await handleScanCurrentPage(scanButton, renderActiveTab);
    });
  }

  function bindOpenSourceButtons() {
    document.querySelectorAll(".rag-open-source-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const url = button.dataset.url;

        if (!url) {
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
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
    if (window.AdaptiveRagPageScanner?.runPageScan) {
      return window.AdaptiveRagPageScanner.runPageScan;
    }

    if (typeof window.runPageScan === "function") {
      return window.runPageScan;
    }

    return null;
  }

  async function prepareStoresBeforeScan() {
    if (window.AdaptiveRagState?.prepareSession) {
      return await window.AdaptiveRagState.prepareSession();
    }

    if (window.AdaptiveRagSessionStore?.ensureActiveSession) {
      const session = await window.AdaptiveRagSessionStore.ensureActiveSession();

      if (window.AdaptiveRagStore?.initResearchSession && session?.id) {
        await window.AdaptiveRagStore.initResearchSession(session.id);
      }

      return Boolean(session?.id);
    }

    return false;
  }

  async function handleScanCurrentPage(scanButton, renderActiveTab) {
    const originalText = scanButton.textContent;

    try {
      const scanDecision = canScanCurrentPage();

      if (!scanDecision.allowed) {
        alert(scanDecision.reason || "Bu sayfa taramaya uygun değil.");
        return;
      }

      const scanRunner = getPageScanRunner();

      if (!scanRunner) {
        alert("Sayfa tarama fonksiyonu bulunamadı. content.js bağlantısını kontrol et.");
        return;
      }

      scanButton.disabled = true;
      scanButton.textContent = "Taranıyor...";

      const isReady = await prepareStoresBeforeScan();

      if (!isReady) {
        throw new Error("Oturum hazırlanamadı. Popup içinden oturumu açıp tekrar dene.");
      }

      const result = await scanRunner("manual-sources-button");

      if (!result?.success) {
        throw new Error(result?.message || "Sayfa taranamadı.");
      }

      await window.AdaptiveRagScanSettingsStore?.markUrlScanned?.(window.location.href);

      scanButton.textContent = result.skipped ? "Zaten tarandı" : "Tarandı";

      if (typeof renderActiveTab === "function") {
        await renderActiveTab();
      }
    } catch (error) {
      console.error("[SOURCE EVENTS] Sayfa tarama hatası:", error);

      scanButton.textContent = "Tekrar dene";
      alert(error.message || "Sayfa taranırken hata oluştu.");
    } finally {
      setTimeout(() => {
        if (document.body.contains(scanButton)) {
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