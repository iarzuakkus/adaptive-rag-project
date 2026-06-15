/**
 * Dosya: source-events.js
 *
 * Görev:
 * - Kaynaklar sekmesindeki etkileşimleri yönetir.
 * - Kaynak kartlarına tıklanınca detay alanını açıp kapatır.
 * - Elle tarama modunda görünen “Sayfayı tara” butonunu mevcut sayfa tarama akışına bağlar.
 *
 * Bağlı olduğu dosyalar:
 * - sources-tab.js
 * - widget-state.js
 * - content.js
 * - research-store.js
 * - page-scan-rules.js
 */

(function () {
  /**
   * Aynı event dosyasının tekrar inject edilmesini engeller.
   */
  if (window.AdaptiveRagSourceEvents?.__moduleName === "source-events") {
    return;
  }

  /**
   * Kaynak kartlarının aç/kapat eventlerini bağlar.
   *
   * Kullanıcı bir kaynak kartına tıkladığında:
   * - openedPageId state içinde güncellenir.
   * - Kaynaklar sekmesi yeniden render edilir.
   */
  function bindSourceCardEvents(renderActiveTab) {
    document.querySelectorAll(".rag-source-main").forEach((button) => {
      button.addEventListener("click", () => {
        const pageId = button.dataset.pageId;

        window.AdaptiveRagState.toggleOpenedPage(pageId);
        renderActiveTab();
      });
    });

    bindScanCurrentPageEvent(renderActiveTab);
  }

  /**
   * “Sayfayı tara” butonunu yakalar.
   *
   * Bu buton sadece elle tarama modunda sources-tab.js tarafından render edilir.
   */
  function bindScanCurrentPageEvent(renderActiveTab) {
    const scanButton = document.querySelector("#scanCurrentPageBtn");

    if (!scanButton) {
      return;
    }

    scanButton.addEventListener("click", async () => {
      await handleScanCurrentPage(scanButton, renderActiveTab);
    });
  }

  /**
   * Mevcut sayfanın taranabilir olup olmadığını kontrol eder.
   *
   * Google Search, kısa/boş sayfa veya desteklenmeyen protokol gibi durumlarda
   * tarama başlatılmaz.
   */
  function validateCurrentPageBeforeScan() {
    if (!window.AdaptiveRagPageScanRules?.canScanCurrentPage) {
      return {
        allowed: true,
        reason: "Sayfa tarama kural dosyası bulunamadı, kontrol atlandı."
      };
    }

    return window.AdaptiveRagPageScanRules.canScanCurrentPage();
  }

  /**
   * content.js içindeki tarama fonksiyonunu bulur.
   *
   * Öncelik:
   * - window.AdaptiveRagPageScanner.runPageScan
   * - window.runPageScan
   *
   * Not:
   * - Eğer ikisi de yoksa content.js tarafında runPageScan fonksiyonunu
   *   global alana açmamız gerekir.
   */
  function getPageScanRunner() {
    if (window.AdaptiveRagPageScanner?.runPageScan) {
      return window.AdaptiveRagPageScanner.runPageScan;
    }

    if (typeof window.runPageScan === "function") {
      return window.runPageScan;
    }

    return null;
  }

  /**
   * “Sayfayı tara” butonuna basıldığında çalışan ana akış.
   *
   * Akış:
   * - Sayfa uygun mu kontrol edilir.
   * - Aktif session/research store hazırlanır.
   * - content.js içindeki runPageScan çalıştırılır.
   * - Başarılı sonuçtan sonra Kaynaklar sekmesi yenilenir.
   */
  async function handleScanCurrentPage(scanButton, renderActiveTab) {
    const originalText = scanButton.textContent;

    try {
      const scanDecision = validateCurrentPageBeforeScan();

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

      await window.AdaptiveRagSessionStore?.ensureActiveSession?.();
      await window.AdaptiveRagStore?.ensureResearchSession?.();

      const result = await scanRunner("manual-sources-button");

      if (!result?.success) {
        throw new Error(result?.message || "Sayfa taranamadı.");
      }

      scanButton.textContent = result.skipped ? "Zaten tarandı" : "Tarandı";

      setTimeout(() => {
        renderActiveTab();
      }, 350);
    } catch (error) {
      console.error("[SOURCE EVENTS] Sayfa tarama hatası:", error);

      scanButton.disabled = false;
      scanButton.textContent = "Tekrar dene";

      alert(error.message || "Sayfa taranırken hata oluştu.");
    } finally {
      setTimeout(() => {
        if (document.body.contains(scanButton)) {
          scanButton.disabled = false;
          scanButton.textContent = originalText;
        }
      }, 1200);
    }
  }

  window.AdaptiveRagSourceEvents = {
    __moduleName: "source-events",
    bindSourceCardEvents
  };
})();