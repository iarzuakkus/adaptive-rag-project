/**
 * Dosya: source-detail.js
 *
 * Görev:
 * - Kaynak detay görünümünün HTML içeriğini üretir.
 * - Detay ekranını kendi başına açmaz.
 * - Overlay, backdrop veya modal oluşturmaz.
 * - Detay görünümü sources-tab.js içinde gösterilir.
 *
 * Not:
 * - Bu dosya backend'e doğrudan istek atmaz.
 * - source-events.js backend'den detayı alır.
 * - sources-tab.js bu modülden gelen HTML'i Kaynaklar sekmesi içine basar.
 */

(function () {
  if (window.AdaptiveRagSourceDetail?.__moduleName === "source-detail") {
    return;
  }

  function escapeHtml(text) {
    if (window.AdaptiveRagState?.escapeHtml) {
      return window.AdaptiveRagState.escapeHtml(text);
    }

    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function trimText(text, maxLength = 900) {
    if (window.AdaptiveRagState?.trimText) {
      return window.AdaptiveRagState.trimText(text, maxLength);
    }

    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function formatDate(value) {
    if (!value) {
      return "Tarih bilgisi yok";
    }

    try {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return value;
      }

      return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return value;
    }
  }

  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch {
      return url || "";
    }
  }

  function getSourceTitle(source) {
    return (
      source?.llm_title ||
      source?.generated_title ||
      source?.source_title ||
      source?.title ||
      "Başlıksız kaynak"
    );
  }

  function getShortSummary(source) {
    return (
      source?.short_summary ||
      source?.card_summary ||
      source?.summary ||
      "Bu kaynak için kısa özet henüz oluşturulmadı."
    );
  }

  function getLongSummary(source) {
    return (
      source?.long_summary ||
      source?.detail_summary ||
      source?.extended_summary ||
      source?.summary ||
      "Bu kaynak için geniş özet henüz oluşturulmadı."
    );
  }

  function renderSourceDetail(source) {
    if (!source) {
      return renderEmptyDetail();
    }

    const title = getSourceTitle(source);
    const url = source.url || "";
    const domain = source.domain || getShortUrl(url);
    const scannedAt = formatDate(source.scanned_at || source.scannedAt);
    const shortSummary = getShortSummary(source);
    const longSummary = getLongSummary(source);
    const sourceId = source.source_id || source.sourceId || "";

    return `
      <div
        class="rag-source-detail-view"
        data-source-id="${escapeHtml(sourceId)}"
      >
        <button
          class="rag-source-back-btn"
          type="button"
          aria-label="Kaynak listesine dön"
        >
          ← Kaynaklara dön
        </button>

        <article class="rag-source-detail-card">
          <div class="rag-source-detail-top">
            <div>
              <span class="rag-source-detail-label">Kaynak detayı</span>
              <h3>${escapeHtml(title)}</h3>
            </div>
          </div>

          <div class="rag-source-detail-info">
            <div>
              <span>Taranma zamanı</span>
              <strong>${escapeHtml(scannedAt)}</strong>
            </div>

            <div>
              <span>Kaynak</span>
              <strong>${escapeHtml(domain || "Kaynak adresi yok")}</strong>
            </div>
          </div>

          <section class="rag-source-detail-section">
            <h4>Kısa özet</h4>
            <p>${escapeHtml(trimText(shortSummary, 360))}</p>
          </section>

          <section class="rag-source-detail-section">
            <h4>Geniş özet</h4>
            <p>${escapeHtml(trimText(longSummary, 1200))}</p>
          </section>

          ${
            url
              ? `
                <div class="rag-source-detail-url">
                  ${escapeHtml(url)}
                </div>
              `
              : ""
          }

          <div class="rag-source-detail-actions">
            ${
              url
                ? `
                  <button
                    class="rag-secondary-btn rag-open-source-btn"
                    type="button"
                    data-url="${escapeHtml(url)}"
                  >
                    Siteye git
                  </button>
                `
                : ""
            }

            ${
              sourceId
                ? `
                  <button
                    class="rag-danger-btn rag-delete-source-btn"
                    type="button"
                    data-source-id="${escapeHtml(sourceId)}"
                  >
                    Sil
                  </button>
                `
                : ""
            }
          </div>
        </article>
      </div>
    `;
  }

  function renderEmptyDetail() {
    return `
      <div class="rag-source-detail-view">
        <button
          class="rag-source-back-btn"
          type="button"
          aria-label="Kaynak listesine dön"
        >
          ← Kaynaklara dön
        </button>

        <div class="rag-empty-state">
          <strong>Kaynak detayı bulunamadı.</strong>
          <span>Backend kaynak detayını döndürmedi.</span>
        </div>
      </div>
    `;
  }

  window.AdaptiveRagSourceDetail = {
    __moduleName: "source-detail",
    renderSourceDetail
  };
})();