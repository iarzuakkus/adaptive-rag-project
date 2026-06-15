/**
 * Dosya: sources-tab.js
 *
 * Görev:
 * - Kaynaklar sekmesinin HTML içeriğini oluşturur.
 * - Aktif araştırma oturumundaki gerçek taranan sayfaları gösterir.
 * - Sayfa kartlarını, detay alanlarını, chunk listesini ve zaman çizelgesini render eder.
 * - Elle tarama modunda “Sayfayı tara” butonunu gösterir.
 * - Otomatik tarama modunda manuel tarama butonunu gizler.
 *
 * Önemli:
 * - Bu dosyada sahte/mock veri bulunmaz.
 * - Veriler window.AdaptiveRagStore.getResearchData() üzerinden gelir.
 * - Scan mode bilgisi chrome.storage.local içindeki adaptive_rag_scan_settings kaydından okunur.
 */

(function () {
  const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";

  let scanModeCache = "manual";

  /**
   * Aynı dosyanın tekrar inject edilmesini engeller.
   */
  if (window.AdaptiveRagSourcesTab?.__moduleName === "sources-tab") {
    return;
  }

  /**
   * HTML içine basılacak metinleri güvenli hale getirir.
   */
  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /**
   * Uzun metinleri kart içinde daha okunabilir göstermek için kısaltır.
   */
  function truncateText(value, maxLength = 180) {
    const text = String(value || "").trim();

    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}...`;
  }

  /**
   * URL bilgisini kısa ve okunabilir hale getirir.
   */
  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch (error) {
      return url || "";
    }
  }

  /**
   * Storage içinden tarama modunu okur.
   *
   * Not:
   * - Render fonksiyonu senkron çalıştığı için değer cache'e alınır.
   * - Değer sonradan değişirse chrome.storage.onChanged ile cache güncellenir.
   */
  function loadScanMode() {
    chrome.storage.local.get([SCAN_SETTINGS_KEY], (result) => {
      const settings = result[SCAN_SETTINGS_KEY];

      scanModeCache = settings?.scanMode === "auto" ? "auto" : "manual";

      const activeTab = window.AdaptiveRagState?.getActiveTab?.();

      if (activeTab === "sources" && window.AdaptiveRagWidget?.renderActiveTab) {
        window.AdaptiveRagWidget.renderActiveTab();
      }
    });
  }

  /**
   * Popup üzerinden scan mode değişirse Kaynaklar sekmesini güncel tutar.
   */
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (!changes[SCAN_SETTINGS_KEY]) {
      return;
    }

    const nextSettings = changes[SCAN_SETTINGS_KEY].newValue;

    scanModeCache = nextSettings?.scanMode === "auto" ? "auto" : "manual";

    const activeTab = window.AdaptiveRagState?.getActiveTab?.();

    if (activeTab === "sources" && window.AdaptiveRagWidget?.renderActiveTab) {
      window.AdaptiveRagWidget.renderActiveTab();
    }
  });

  /**
   * Kaynaklar sekmesinin ana render fonksiyonu.
   */
  function renderSourcesTab() {
    const data = window.AdaptiveRagStore?.getResearchData
      ? window.AdaptiveRagStore.getResearchData()
      : {
          pages: [],
          timeline: []
        };

    const openedPageId = window.AdaptiveRagState?.getOpenedPageId?.();

    const pages = Array.isArray(data.pages) ? data.pages : [];
    const timeline = Array.isArray(data.timeline) ? data.timeline : [];

    const pageCards = pages
      .map((page) => renderSourceCard(page, openedPageId))
      .join("");

    const timelineItems = timeline
      .map((item) => renderTimelineItem(item))
      .join("");

    return `
      <section class="rag-section rag-sources-section">
        ${renderSourcesHeader(pages.length)}

        <div class="rag-source-list">
          ${pageCards || renderEmptySources()}
        </div>

        ${renderTimeline(timelineItems)}
      </section>
    `;
  }

  /**
   * Kaynaklar sekmesinin üst başlık alanını render eder.
   *
   * Elle tarama modunda:
   * - Sayfayı tara butonu görünür.
   *
   * Otomatik tarama modunda:
   * - Buton gizlenir.
   */
  function renderSourcesHeader(pageCount) {
    const scanButton =
      scanModeCache === "manual"
        ? `
          <button
            type="button"
            id="scanCurrentPageBtn"
            class="rag-scan-current-btn"
          >
            Sayfayı tara
          </button>
        `
        : "";

    const modeText =
      scanModeCache === "auto"
        ? "Otomatik tarama aktif. Uygun sayfalar arka planda eklenir."
        : "Elle tarama aktif. İstersen mevcut sayfayı kaynaklara ekleyebilirsin.";

    return `
      <div class="rag-section-title rag-sources-header">
        <div>
          <h3>Kaynaklar</h3>
          <p class="rag-section-subtitle">
            ${escapeHtml(modeText)}
          </p>
        </div>

        ${scanButton}
      </div>

      <div class="rag-source-stats">
        <span>${pageCount} sayfa</span>
        <span>${scanModeCache === "auto" ? "Otomatik mod" : "Elle mod"}</span>
      </div>
    `;
  }

  /**
   * Taranan tek bir sayfayı kart olarak render eder.
   */
  function renderSourceCard(page, openedPageId) {
    const isOpen = openedPageId === page.id;

    const title = escapeHtml(page.title || "Başlıksız sayfa");
    const summary = escapeHtml(
      truncateText(page.summary || "Bu sayfa için özet henüz oluşmadı.", 190)
    );
    const scannedAt = escapeHtml(page.scannedAt || "");
    const shortUrl = escapeHtml(getShortUrl(page.url));
    const chunkCount = Array.isArray(page.chunks) ? page.chunks.length : 0;

    return `
      <article class="rag-source-card ${isOpen ? "open" : ""}">
        <button
          type="button"
          class="rag-source-main"
          data-page-id="${escapeHtml(page.id)}"
          aria-expanded="${isOpen ? "true" : "false"}"
        >
          <div class="rag-source-main-content">
            <div class="rag-source-card-top">
              <span class="rag-source-domain">${shortUrl || "Kaynak"}</span>
              <span class="rag-source-date">${scannedAt}</span>
            </div>

            <h3>${title}</h3>

            <p>${summary}</p>

            <div class="rag-source-meta">
              <span>${chunkCount} parça</span>
            </div>
          </div>

          <strong class="rag-source-toggle">
            ${isOpen ? "Detayı kapat" : "Detayı aç"}
          </strong>
        </button>

        ${isOpen ? renderSourceDetail(page) : ""}
      </article>
    `;
  }

  /**
   * Açılan kaynak kartının detay alanını render eder.
   */
  function renderSourceDetail(page) {
    const chunks = Array.isArray(page.chunks) ? page.chunks : [];

    const chunkCards = chunks
      .map((chunk, index) => renderChunkCard(chunk, index))
      .join("");

    return `
      <div class="rag-source-detail">
        <div class="rag-source-url">
          <span>Kaynak:</span>
          ${
            page.url
              ? `<a href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.url)}</a>`
              : `<p>Kaynak URL bilgisi bulunamadı.</p>`
          }
        </div>

        <div class="rag-source-detail-head">
          <h4>Kaynak parçaları</h4>
          <span>${chunks.length} chunk</span>
        </div>

        <div class="rag-chunk-list">
          ${chunkCards || renderEmptyChunks()}
        </div>
      </div>
    `;
  }

  /**
   * Tek bir chunk kartını render eder.
   */
  function renderChunkCard(chunk, index) {
    const text = escapeHtml(truncateText(chunk.text || "", 260));
    const selector = escapeHtml(chunk.sourceSelector || "");

    return `
      <div class="rag-chunk-card">
        <span class="rag-small-label">Parça ${index + 1}</span>

        <p>${text}</p>

        <button
          type="button"
          class="rag-highlight-btn"
          data-selector="${selector}"
          ${selector ? "" : "disabled"}
        >
          Kaynağa git / highlight
        </button>
      </div>
    `;
  }

  /**
   * Hiç chunk yoksa gösterilecek boş durum.
   */
  function renderEmptyChunks() {
    return `
      <div class="rag-empty-mini">
        Bu sayfa için kaynak parçası bulunamadı.
      </div>
    `;
  }

  /**
   * Hiç sayfa taranmadığında gösterilecek boş durum.
   */
  function renderEmptySources() {
    const description =
      scanModeCache === "auto"
        ? "Otomatik mod açık. Uygun bir sayfaya girdiğinde kaynaklar burada görünecek."
        : "Henüz bu oturumda taranan sayfa yok. Mevcut sayfayı tarayarak kaynak ekleyebilirsin.";

    return `
      <div class="rag-empty-state">
        <h3>Kaynak yok</h3>
        <p>${escapeHtml(description)}</p>
      </div>
    `;
  }

  /**
   * Zaman çizelgesi alanını render eder.
   *
   * Eğer hiç işlem yoksa sahte veri göstermez.
   */
  function renderTimeline(timelineItems) {
    return `
      <div class="rag-timeline">
        <h3>Zaman çizelgesi</h3>

        <ul>
          ${timelineItems || `<li class="rag-timeline-empty"><p>Henüz işlem yok.</p></li>`}
        </ul>
      </div>
    `;
  }

  /**
   * Tek bir timeline kaydını render eder.
   */
  function renderTimelineItem(item) {
    return `
      <li>
        <span>${escapeHtml(item.time || "")}</span>
        <p>${escapeHtml(item.title || "")}</p>
      </li>
    `;
  }

  loadScanMode();

  window.AdaptiveRagSourcesTab = {
    __moduleName: "sources-tab",
    renderSourcesTab,
    loadScanMode
  };
})();