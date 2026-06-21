/**
 * Dosya: content.js
 *
 * Görev:
 * - Mevcut sayfayı kazır.
 * - Backend ingest endpointine gönderir.
 * - Taranan sayfayı aktif research oturumuna kaydeder.
 * - Manuel modda sağdaki "Bu sayfayı tara?" kartını gösterir.
 * - Otomatik modda uygun sayfayı arka planda tarar.
 */

(function () {
  if (window.AdaptiveRagPageScanner?.__moduleName === "content-scanner") {
    return;
  }

  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";

  console.log("[CONTENT] Script yüklendi.");

  /* -------------------- Storage -------------------- */

  function getStorageValue(key, defaultValue = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] ?? defaultValue);
      });
    });
  }

  async function isSessionEnabled() {
    return Boolean(await getStorageValue(SESSION_ENABLED_KEY, false));
  }

  /* -------------------- Sayfa Kazıma -------------------- */

  function scrapeCurrentPage() {
    if (typeof extractStructuredContent !== "function") {
      throw new Error("extractStructuredContent fonksiyonu bulunamadı.");
    }

    const rawData = extractStructuredContent();

    if (typeof cleanPageContent === "function") {
      return cleanPageContent(rawData);
    }

    return rawData;
  }

  function buildIngestPayload(pageData, scanSource = "manual") {
    return {
      ...pageData,
      metadata: {
        ...(pageData.metadata || {}),
        scanSource,
        scannedAt: new Date().toISOString(),
        pageTitle: document.title,
        pageUrl: window.location.href,
        source: "chrome-extension"
      }
    };
  }

  async function sendPageToBackend(payload) {
    return await chrome.runtime.sendMessage({
      type: "INGEST_DATA",
      payload
    });
  }

  /* -------------------- Backend Sonucunu Sadeleştirme -------------------- */

  function unwrapBackendData(result) {
    return result?.data?.data || result?.data || result || {};
  }

  function getBackendChunks(result) {
    const data = unwrapBackendData(result);

    if (Array.isArray(data.chunks)) return data.chunks;
    if (Array.isArray(data.blockChunks)) return data.blockChunks;
    if (Array.isArray(data.block_chunks)) return data.block_chunks;
    if (Array.isArray(data.semanticChunks)) return data.semanticChunks;
    if (Array.isArray(data.semantic_chunks)) return data.semantic_chunks;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.documents)) return data.documents;

    return [];
  }

  function getTextFromChunk(chunk) {
    if (typeof chunk === "string") {
      return chunk;
    }

    return (
      chunk?.text ||
      chunk?.content ||
      chunk?.chunk ||
      chunk?.chunk_text ||
      chunk?.page_content ||
      chunk?.metadata?.text ||
      chunk?.metadata?.content ||
      ""
    );
  }

  function normalizeChunks(pageData, backendResult) {
    const backendChunks = getBackendChunks(backendResult);
    const frontendChunks = pageData.blockChunks || pageData.chunks || [];
    const rawChunks = backendChunks.length ? backendChunks : frontendChunks;

    if (!Array.isArray(rawChunks)) {
      return [];
    }

    return rawChunks
      .map((chunk, index) => {
        const text = getTextFromChunk(chunk);

        return {
          id: chunk?.id || chunk?.chunk_id || `chunk-${Date.now()}-${index}`,
          text,
          sourceSelector:
            chunk?.sourceSelector ||
            chunk?.source_selector ||
            chunk?.selector ||
            chunk?.metadata?.sourceSelector ||
            chunk?.metadata?.selector ||
            "",
          metadata: chunk?.metadata || {}
        };
      })
      .filter((chunk) => chunk.text.trim().length > 0);
  }

  function getSummary(pageData, backendResult, chunks) {
    const data = unwrapBackendData(backendResult);

    if (data.summary) return data.summary;
    if (data.pageSummary) return data.pageSummary;
    if (data.page_summary) return data.page_summary;
    if (pageData.summary) return pageData.summary;
    if (pageData.preview) return pageData.preview;

    const firstChunk = chunks[0]?.text || "";

    if (firstChunk.length > 180) {
      return `${firstChunk.slice(0, 180)}...`;
    }

    return firstChunk;
  }

  /* -------------------- Research Store Kontrolü -------------------- */

  function getResearchData() {
    if (window.AdaptiveRagState?.getResearchData) {
      return window.AdaptiveRagState.getResearchData();
    }

    if (window.AdaptiveRagStore?.getResearchData) {
      return window.AdaptiveRagStore.getResearchData();
    }

    return {
      pages: []
    };
  }

  function normalizeUrlForCompare(url) {
    try {
      const parsedUrl = new URL(url);
      parsedUrl.hash = "";
      return parsedUrl.href;
    } catch {
      return String(url || "");
    }
  }

  function isUrlSavedInCurrentResearchStore(url) {
    const researchData = getResearchData();
    const pages = Array.isArray(researchData.pages) ? researchData.pages : [];
    const normalizedCurrentUrl = normalizeUrlForCompare(url);

    return pages.some((page) => {
      return normalizeUrlForCompare(page.url) === normalizedCurrentUrl;
    });
  }

  /* -------------------- Research Store'a Kaydetme -------------------- */

  async function prepareResearchStore() {
    if (!window.AdaptiveRagSessionStore?.ensureActiveSession) {
      throw new Error("Session store bulunamadı.");
    }

    const session = await window.AdaptiveRagSessionStore.ensureActiveSession();

    if (!session?.id) {
      throw new Error("Aktif oturum oluşturulamadı.");
    }

    if (window.AdaptiveRagStore?.initResearchSession) {
      await window.AdaptiveRagStore.initResearchSession(session.id);
    }

    return session;
  }

  async function savePageToResearchStore(pageData, backendResult) {
    if (!window.AdaptiveRagStore?.addScannedPage) {
      return null;
    }

    await prepareResearchStore();

    const chunks = normalizeChunks(pageData, backendResult);

    const savedPage = await window.AdaptiveRagStore.addScannedPage({
      title: pageData.title || document.title,
      url: pageData.url || window.location.href,
      summary: getSummary(pageData, backendResult, chunks),
      preview: pageData.preview || "",
      chunks
    });

    if (window.AdaptiveRagWidget?.renderActiveTab) {
      await window.AdaptiveRagWidget.renderActiveTab();
    }

    return savedPage;
  }

  /* -------------------- Ana Tarama Fonksiyonu -------------------- */

  async function runPageScan(scanSource = "manual") {
    const currentUrl = window.location.href;

    const sessionOpen = await isSessionEnabled();

    if (!sessionOpen) {
      throw new Error("Oturum kapalı. Önce popup içinden oturumu aç.");
    }

    const alreadyScanned =
      await window.AdaptiveRagScanSettingsStore?.isUrlScanned?.(currentUrl);

    const alreadySavedInCurrentSession = isUrlSavedInCurrentResearchStore(currentUrl);

    if (alreadyScanned && alreadySavedInCurrentSession) {
      return {
        success: true,
        skipped: true,
        message: "Bu sayfa bu oturumdaki kaynaklara zaten eklenmiş."
      };
    }

    const pageData = scrapeCurrentPage();
    const payload = buildIngestPayload(pageData, scanSource);
    const backendResult = await sendPageToBackend(payload);

    if (!backendResult?.success) {
      throw new Error(backendResult?.message || "Sayfa backend'e gönderilemedi.");
    }

    await window.AdaptiveRagScanSettingsStore?.markUrlScanned?.(currentUrl);

    const savedPage = await savePageToResearchStore(pageData, backendResult);

    return {
      success: true,
      skipped: false,
      data: pageData,
      backend: backendResult,
      savedPage
    };
  }

  /* -------------------- Sayfa Açılış Akışı -------------------- */

  function canScanCurrentPage() {
    if (!window.AdaptiveRagPageScanRules?.canScanCurrentPage) {
      return {
        allowed: true,
        reason: ""
      };
    }

    return window.AdaptiveRagPageScanRules.canScanCurrentPage();
  }

  async function shouldSkipPrompt(currentUrl) {
    const alreadyScanned =
      await window.AdaptiveRagScanSettingsStore?.isUrlScanned?.(currentUrl);

    const alreadySavedInCurrentSession = isUrlSavedInCurrentResearchStore(currentUrl);

    if (alreadyScanned && alreadySavedInCurrentSession) {
      return true;
    }

    const dismissed =
      await window.AdaptiveRagScanSettingsStore?.isUrlDismissed?.(currentUrl);

    return Boolean(dismissed);
  }

  async function initializePageScanFlow() {
    try {
      const sessionOpen = await isSessionEnabled();

      if (!sessionOpen) {
        window.AdaptiveRagScanPrompt?.hideScanPrompt?.();
        return;
      }

      if (!window.AdaptiveRagScanSettingsStore) {
        console.warn("[CONTENT] Scan settings store bulunamadı.");
        return;
      }

      const scanDecision = canScanCurrentPage();

      if (!scanDecision.allowed) {
        console.log("[CONTENT] Sayfa tarama dışı:", scanDecision.reason);
        return;
      }

      const currentUrl = window.location.href;
      const scanMode = await window.AdaptiveRagScanSettingsStore.getScanMode();

      const alreadyScanned =
        await window.AdaptiveRagScanSettingsStore.isUrlScanned(currentUrl);

      const alreadySavedInCurrentSession = isUrlSavedInCurrentResearchStore(currentUrl);

      if (alreadyScanned && alreadySavedInCurrentSession) {
        window.AdaptiveRagScanPrompt?.hideScanPrompt?.();
        return;
      }

      if (scanMode === "auto") {
        window.AdaptiveRagScanPrompt?.hideScanPrompt?.();
        await runPageScan("auto");
        return;
      }

      const skipPrompt = await shouldSkipPrompt(currentUrl);

      if (skipPrompt) {
        return;
      }

      if (!window.AdaptiveRagScanPrompt?.showScanPrompt) {
        console.warn("[CONTENT] Scan prompt bulunamadı.");
        return;
      }

      window.AdaptiveRagScanPrompt.showScanPrompt({
        onScan: async () => {
          await runPageScan("manual-prompt");
        },
        onClose: async () => {
          await window.AdaptiveRagScanSettingsStore.markUrlDismissed(currentUrl);
        }
      });
    } catch (error) {
      console.error("[CONTENT] Tarama akışı başlatılamadı:", error);
    }
  }

  /* -------------------- Mesaj Dinleyici -------------------- */

  function checkCurrentPageIsPdf() {
    if (typeof isPdfPage === "function") {
      return isPdfPage();
    }

    return window.location.href.toLowerCase().includes(".pdf");
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request?.type) {
      sendResponse({
        success: false,
        message: "Geçersiz request"
      });

      return true;
    }

    if (request.type === "SCRAPE_PAGE") {
      try {
        sendResponse({
          success: true,
          data: scrapeCurrentPage()
        });
      } catch (error) {
        sendResponse({
          success: false,
          message: error.message
        });
      }

      return true;
    }

    if (request.type === "CHECK_PDF") {
      sendResponse({
        success: true,
        isPdf: checkCurrentPageIsPdf(),
        url: window.location.href
      });

      return true;
    }

    if (request.type === "INGEST_CURRENT_PAGE") {
      runPageScan("message")
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            message: error.message || "Sayfa taranırken hata oluştu."
          });
        });

      return true;
    }

    sendResponse({
      success: false,
      message: "Bilinmeyen request type"
    });

    return true;
  });

  /* -------------------- Dış API -------------------- */

  window.AdaptiveRagPageScanner = {
    __moduleName: "content-scanner",

    runPageScan,
    scrapeCurrentPage,
    initializePageScanFlow
  };

  /* -------------------- Storage Değişince Kartı Güncelle -------------------- */

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (
      changes[SESSION_ENABLED_KEY] ||
      changes.adaptive_rag_scan_settings
    ) {
      setTimeout(() => {
        initializePageScanFlow();
      }, 300);
    }
  });

  setTimeout(() => {
    initializePageScanFlow();
  }, 900);
})();