/**
 * Dosya: content.js
 *
 * Görev:
 * - Sayfa içeriğini çıkaran content script ana dosyasıdır.
 * - Popup, widget veya diğer extension parçalarından gelen mesajları dinler.
 * - SCRAPE_PAGE mesajı geldiğinde mevcut sayfayı kazır ve temizler.
 * - Sayfa açıldığında tarama moduna göre manuel/otomatik tarama akışını başlatır.
 * - Kaynaklar sekmesindeki “Sayfayı tara” butonunun kullanacağı global tarama API'sini sağlar.
 *
 * Bağlı olduğu dosyalar:
 * - extractor.js → extractStructuredContent()
 * - cleaner-entry.js → cleanPageContent()
 * - page-scan-rules.js → sayfa taranabilir mi kontrolü
 * - scan-prompt.js → sağ yandan çıkan “Bu sayfayı tara?” kartı
 * - scan-settings-store.js → manual/auto modu ve taranan URL kayıtları
 * - session-store.js → aktif oturum bilgisini yönetir
 * - research-store.js → taranan sayfaları aktif oturuma kaydeder
 * - background.js → INGEST_DATA mesajını backend /ingest endpoint’ine gönderir
 */

console.log("[CONTENT] Script yüklendi.");


/**
 * Mevcut sayfanın ham ve temizlenmiş içeriğini çıkarır.
 *
 * Akış:
 * 1. extractStructuredContent() ile sayfadan başlık, paragraf, liste ve bloklar alınır.
 * 2. cleanPageContent() varsa içerik temizlenir.
 * 3. Temizlenmiş veri geri döndürülür.
 */
function scrapeCurrentPage() {
  console.log("[CONTENT] Sayfa kazıma başladı.");

  if (typeof extractStructuredContent !== "function") {
    throw new Error("extractStructuredContent fonksiyonu bulunamadı.");
  }

  const structuredData = extractStructuredContent();

  const cleanedData =
    typeof cleanPageContent === "function"
      ? cleanPageContent(structuredData)
      : structuredData;

  return cleanedData;
}


/**
 * Backend'e gönderilecek payload'u hazırlar.
 *
 * Amaç:
 * - Scraping çıktısını backend'in ingest endpoint'ine uygun hale getirmek.
 * - Ek metadata ile taramanın nereden ve ne zaman yapıldığını belirtmek.
 */
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


/**
 * Sayfa verisini background.js üzerinden backend'e gönderir.
 *
 * Not:
 * - Mevcut mimaride /ingest isteği background.js içinde yönetiliyor.
 * - Bu yüzden INGEST_DATA mesajı gönderiyoruz.
 */
async function sendPageToBackend(payload) {
  return await chrome.runtime.sendMessage({
    type: "INGEST_DATA",
    payload
  });
}


/**
 * Backend response farklı formatlarda gelebilir.
 *
 * Örnek formatlar:
 * - backendResult.data.chunks
 * - backendResult.data.data.chunks
 * - backendResult.chunks
 *
 * Bu fonksiyon olası response objelerini sırayla döndürür.
 */
function getBackendResponseCandidates(backendResult) {
  const candidates = [];

  if (backendResult?.data?.data && typeof backendResult.data.data === "object") {
    candidates.push(backendResult.data.data);
  }

  if (backendResult?.data && typeof backendResult.data === "object") {
    candidates.push(backendResult.data);
  }

  if (backendResult && typeof backendResult === "object") {
    candidates.push(backendResult);
  }

  return candidates;
}


/**
 * Backend response içinden ilk bulunan değeri döndürür.
 *
 * Özet gibi alanlarda kullanılır.
 */
function getFirstBackendValue(backendResult, keys = []) {
  const candidates = getBackendResponseCandidates(backendResult);

  for (const candidate of candidates) {
    for (const key of keys) {
      if (candidate[key]) {
        return candidate[key];
      }
    }
  }

  return "";
}


/**
 * Backend response içinden chunk dizisini bulur.
 *
 * Backend tarafında farklı isimlendirmeler olabilir.
 * Bu yüzden birkaç olası alan kontrol edilir.
 */
function getBackendChunks(backendResult) {
  const candidates = getBackendResponseCandidates(backendResult);

  const possibleChunkKeys = [
    "chunks",
    "blockChunks",
    "block_chunks",
    "semanticChunks",
    "semantic_chunks",
    "chunkList",
    "chunk_list",
    "storedChunks",
    "stored_chunks",
    "results",
    "documents",
    "items"
  ];

  for (const candidate of candidates) {
    for (const key of possibleChunkKeys) {
      if (Array.isArray(candidate[key])) {
        return candidate[key];
      }
    }
  }

  if (Array.isArray(backendResult?.data)) {
    return backendResult.data;
  }

  if (Array.isArray(backendResult)) {
    return backendResult;
  }

  return [];
}


/**
 * Chunk içindeki metin alanını güvenli şekilde bulur.
 *
 * Backend ve frontend farklı alan isimleri kullanabilir.
 */
function getChunkText(chunk) {
  if (typeof chunk === "string") {
    return chunk;
  }

  return (
    chunk.text ||
    chunk.content ||
    chunk.chunk ||
    chunk.chunk_text ||
    chunk.chunkText ||
    chunk.page_content ||
    chunk.pageContent ||
    chunk.body ||
    chunk.value ||
    chunk.metadata?.text ||
    chunk.metadata?.content ||
    ""
  );
}


/**
 * Chunk içindeki selector bilgisini güvenli şekilde bulur.
 *
 * Backend selector döndürmüyorsa boş gelir.
 * Bu durumda highlight butonu disabled olur.
 */
function getChunkSourceSelector(chunk) {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  return (
    chunk.sourceSelector ||
    chunk.source_selector ||
    chunk.selector ||
    chunk.cssSelector ||
    chunk.css_selector ||
    chunk.metadata?.sourceSelector ||
    chunk.metadata?.source_selector ||
    chunk.metadata?.selector ||
    chunk.metadata?.cssSelector ||
    chunk.metadata?.css_selector ||
    ""
  );
}


/**
 * Chunk id değerini güvenli şekilde üretir.
 */
function getChunkId(chunk, index) {
  if (chunk && typeof chunk === "object") {
    return (
      chunk.id ||
      chunk.chunk_id ||
      chunk.chunkId ||
      chunk.metadata?.id ||
      chunk.metadata?.chunk_id ||
      `chunk-${Date.now()}-${index}`
    );
  }

  return `chunk-${Date.now()}-${index}`;
}


/**
 * Backend veya frontend kaynaklı chunk verilerini tek formata dönüştürür.
 *
 * Öncelik:
 * 1. Backend'den dönen chunk'lar
 * 2. Frontend scraping çıktısındaki blockChunks
 * 3. Frontend scraping çıktısındaki chunks
 */
function getChunksForResearchStore(pageData, backendResult) {
  const backendChunks = getBackendChunks(backendResult);

  const frontendChunks =
    pageData.blockChunks ||
    pageData.chunks ||
    [];

  const rawChunks =
    backendChunks.length > 0
      ? backendChunks
      : frontendChunks;

  const chunkSource =
    backendChunks.length > 0
      ? "backend"
      : "frontend";

  if (!Array.isArray(rawChunks)) {
    return [];
  }

  return rawChunks
    .map((chunk, index) => {
      const text = getChunkText(chunk);

      return {
        id: getChunkId(chunk, index),
        text,
        sourceSelector: getChunkSourceSelector(chunk),
        score:
          chunk?.score ||
          chunk?.similarity ||
          chunk?.similarity_score ||
          chunk?.metadata?.score ||
          null,
        type:
          chunk?.type ||
          chunk?.chunk_type ||
          chunk?.metadata?.type ||
          "",
        source: chunkSource,
        metadata: chunk?.metadata || {}
      };
    })
    .filter((chunk) => chunk.text.trim().length > 0);
}


/**
 * Backend cevabından veya scraping çıktısından özet üretir.
 *
 * Öncelik:
 * - Backend summary
 * - Backend özet benzeri alanlar
 * - Sayfanın summary / preview alanı
 * - İlk chunk metni
 * - Boş string
 */
function getPageSummaryForStore(pageData, backendResult) {
  const backendSummary = getFirstBackendValue(backendResult, [
    "summary",
    "pageSummary",
    "page_summary",
    "shortSummary",
    "short_summary",
    "preview"
  ]);

  if (backendSummary) {
    return backendSummary;
  }

  if (pageData.summary) {
    return pageData.summary;
  }

  if (pageData.preview) {
    return pageData.preview;
  }

  const chunks = getChunksForResearchStore(pageData, backendResult);

  if (chunks.length > 0) {
    const firstText = chunks[0].text || "";

    if (firstText.length > 180) {
      return `${firstText.slice(0, 180)}...`;
    }

    return firstText;
  }

  return "";
}


/**
 * Widget tarafındaki research store yüklüyse taranan sayfayı aktif oturuma ekler.
 *
 * Önemli:
 * - Backend chunk dönüyorsa öncelik backend chunk'larına verilir.
 * - Backend chunk dönmüyorsa frontend scraping chunk'ları kullanılır.
 * - Kaynaklar sekmesi açıksa otomatik yenilenir.
 */
async function savePageToResearchStoreIfAvailable(pageData, backendResult) {
  if (!window.AdaptiveRagStore?.addScannedPage) {
    console.log("[CONTENT] Research store yüklü değil, local kaynaklara yazılmadı.");
    return null;
  }

  if (window.AdaptiveRagSessionStore?.ensureActiveSession) {
    await window.AdaptiveRagSessionStore.ensureActiveSession();
  }

  if (window.AdaptiveRagStore?.ensureResearchSession) {
    await window.AdaptiveRagStore.ensureResearchSession();
  }

  const chunks = getChunksForResearchStore(pageData, backendResult);

  console.log("[CONTENT] Store'a kaydedilecek chunk sayısı:", chunks.length);
  console.log("[CONTENT] Store'a kaydedilecek chunk kaynağı:", chunks[0]?.source || "chunk yok");

  const savedPage = await window.AdaptiveRagStore.addScannedPage({
    title: pageData.title || document.title,
    url: pageData.url || window.location.href,
    summary: getPageSummaryForStore(pageData, backendResult),
    preview: pageData.preview || "",
    chunks
  });

  if (window.AdaptiveRagWidget?.renderActiveTab) {
    window.AdaptiveRagWidget.renderActiveTab();
  }

  return savedPage;
}


/**
 * Sayfayı baştan sona tarar:
 * - İçeriği çıkarır
 * - Backend'e gönderir
 * - Başarılıysa URL'yi tarandı olarak işaretler
 * - Research store açıksa aktif oturuma kaynak olarak ekler
 * - Widget açıksa Kaynaklar sekmesini yeniler
 */
async function runPageScan(scanSource = "manual") {
  const currentUrl = window.location.href;

  const alreadyScanned =
    await window.AdaptiveRagScanSettingsStore?.isUrlScanned?.(currentUrl);

  if (alreadyScanned) {
    console.log("[CONTENT] Bu URL daha önce taranmış, tekrar taranmadı:", currentUrl);

    return {
      success: true,
      skipped: true,
      message: "Bu sayfa daha önce tarandı."
    };
  }

  const pageData = scrapeCurrentPage();
  const payload = buildIngestPayload(pageData, scanSource);

  console.log("[CONTENT] Backend'e gönderilecek payload:", payload);

  const backendResult = await sendPageToBackend(payload);

  console.log("[CONTENT] Backend'den gelen sonuç:", backendResult);

  if (!backendResult?.success) {
    throw new Error(
      backendResult?.message || "Sayfa backend'e gönderilemedi."
    );
  }

  await window.AdaptiveRagScanSettingsStore?.markUrlScanned?.(currentUrl);

  const savedPage = await savePageToResearchStoreIfAvailable(pageData, backendResult);

  console.log("[CONTENT] Sayfa başarıyla tarandı:", backendResult);

  return {
    success: true,
    data: pageData,
    backend: backendResult,
    savedPage
  };
}


/**
 * Sayfa açılışında manuel/otomatik tarama akışını başlatır.
 *
 * Manuel mod:
 * - Sağ yandan küçük “Bu sayfayı tara?” kartı gösterilir.
 *
 * Otomatik mod:
 * - Sayfa uygunsa kullanıcıya sormadan tarama yapılır.
 */
async function initializePageScanFlow() {
  try {
    if (!window.AdaptiveRagPageScanRules?.canScanCurrentPage) {
      console.warn("[CONTENT] Sayfa tarama kuralları yüklenmemiş.");
      return;
    }

    if (!window.AdaptiveRagScanSettingsStore) {
      console.warn("[CONTENT] Tarama ayar store'u yüklenmemiş.");
      return;
    }

    const scanDecision = window.AdaptiveRagPageScanRules.canScanCurrentPage();

    if (!scanDecision.allowed) {
      console.log("[CONTENT] Sayfa tarama dışı bırakıldı:", scanDecision.reason);
      return;
    }

    const currentUrl = window.location.href;

    const alreadyScanned =
      await window.AdaptiveRagScanSettingsStore.isUrlScanned(currentUrl);

    if (alreadyScanned) {
      console.log("[CONTENT] Sayfa daha önce taranmış, öneri gösterilmedi.");
      return;
    }

    const scanMode = await window.AdaptiveRagScanSettingsStore.getScanMode();

    if (scanMode === "auto") {
      console.log("[CONTENT] Otomatik tarama modu aktif.");

      await runPageScan("auto");

      return;
    }

    const dismissed =
      await window.AdaptiveRagScanSettingsStore.isUrlDismissed(currentUrl);

    if (dismissed) {
      console.log("[CONTENT] Kullanıcı bu sayfada tarama önerisini kapatmış.");
      return;
    }

    if (!window.AdaptiveRagScanPrompt?.showScanPrompt) {
      console.warn("[CONTENT] Tarama öneri kartı yüklenmemiş.");
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
    console.error("[CONTENT] Sayfa tarama akışı başlatılamadı:", error);
  }
}


/**
 * PDF kontrolünü güvenli şekilde yapar.
 *
 * isPdfPage() fonksiyonu varsa onu kullanır.
 * Yoksa URL üzerinden basit PDF kontrolü yapar.
 */
function checkCurrentPageIsPdf() {
  if (typeof isPdfPage === "function") {
    return isPdfPage();
  }

  return window.location.href.toLowerCase().includes(".pdf");
}


/**
 * Content script tarama API'sini global alana açar.
 *
 * Kaynaklar sekmesindeki “Sayfayı tara” butonu bu API üzerinden
 * mevcut sayfayı doğrudan taratabilir.
 */
window.AdaptiveRagPageScanner = {
  runPageScan,
  scrapeCurrentPage
};


/**
 * Extension içinden gelen mesajları dinler.
 *
 * Desteklenen mesajlar:
 * - SCRAPE_PAGE: Sayfayı kazır ve sonucu döndürür.
 * - CHECK_PDF: Mevcut sayfanın PDF olup olmadığını kontrol eder.
 * - INGEST_CURRENT_PAGE: Sayfayı kazır ve backend'e gönderir.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[CONTENT] Mesaj alındı:", request);

  try {
    if (!request || !request.type) {
      sendResponse({
        success: false,
        message: "Geçersiz request"
      });

      return true;
    }

    if (request.type === "SCRAPE_PAGE") {
      console.log("[CONTENT] SCRAPE_PAGE başladı.");

      const data = scrapeCurrentPage();

      console.log("[CONTENT] SCRAPE_PAGE final data:", data);

      sendResponse({
        success: true,
        data
      });

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
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          console.error("[CONTENT] INGEST_CURRENT_PAGE hatası:", error);

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
  } catch (error) {
    console.error("[CONTENT] HATA:", error);

    sendResponse({
      success: false,
      message: error.message || "Bilinmeyen content script hatası"
    });

    return true;
  }
});


/**
 * Content script document_idle anında yükleniyor.
 * Yine de bazı sayfalarda içerik geç geldiği için kısa bir bekleme sonrası
 * tarama öneri/otomatik tarama akışı başlatılır.
 */
setTimeout(() => {
  initializePageScanFlow();
}, 900);