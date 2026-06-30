/**
 * Dosya: recommendations-panel.js
 *
 * Görev:
 * - Kaynaklar sekmesi içindeki Öneriler panelinin HTML içeriğini üretir.
 * - İlk aşamada mock/boş state ile çalışır.
 * - Backend entegrasyonu daha sonra recommendation-store / research endpoint üzerinden bağlanacaktır.
 *
 * Not:
 * - Bu dosya sadece render işi yapar.
 * - Event yönetimi recommendation-events.js içinde yapılacaktır.
 */

(function () {
  if (window.AdaptiveRagRecommendationsPanel?.__moduleName === "recommendations-panel") {
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

  function trimText(text, maxLength = 180) {
    if (window.AdaptiveRagState?.trimText) {
      return window.AdaptiveRagState.trimText(text, maxLength);
    }

    const value = String(text || "").trim();

    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}...`;
  }

  function getIconUrl(iconName) {
    try {
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        typeof chrome.runtime.getURL === "function"
      ) {
        return chrome.runtime.getURL(`icons/${iconName}.svg`);
      }
    } catch {
      return "";
    }

    return "";
  }

  function renderIcon(iconName, className = "") {
    const iconUrl = getIconUrl(iconName);

    if (!iconUrl) {
      return "";
    }

    return `
      <span
        class="rag-icon-mask ${escapeHtml(className)}"
        style="--rag-icon-url: url('${escapeHtml(iconUrl)}');"
        aria-hidden="true"
      ></span>
    `;
  }

  function getMockRecommendations() {
    return [
      {
        id: "mock-rec-1",
        title: "Konuya benzer yeni kaynak",
        url: "",
        domain: "Öneri kaynağı",
        summary:
          "Mevcut taranan kaynakla ilişkili yeni bir sayfa önerisi burada görünecek. Backend bağlandığında bu alan gerçek web arama sonuçlarıyla dolacak.",
        reason:
          "Bu öneri, taranan sayfalarda geçen ana kavramları genişletmek ve araştırmayı derinleştirmek için hazırlanır."
      },
      {
        id: "mock-rec-2",
        title: "Alternatif açıklama içeren kaynak",
        url: "",
        domain: "Öneri kaynağı",
        summary:
          "Kullanıcının araştırma bağlamına göre bulunacak ikinci kaynak burada kart olarak listelenecek.",
        reason:
          "Bu kaynak, mevcut içeriği farklı bir bakış açısıyla destekleyebilir."
      }
    ];
  }

  function renderRecommendationsPanel(options = {}) {
    const recommendations = Array.isArray(options.recommendations)
      ? options.recommendations
      : getMockRecommendations();

    const isLoading = options.isLoading === true;
    const error = String(options.error || "").trim();

    if (isLoading) {
      return renderLoadingRecommendations();
    }

    if (error) {
      return renderRecommendationsError(error);
    }

    return `
      <div class="rag-recommendations-panel">
        <div class="rag-recommendation-hero">
          <div class="rag-recommendation-hero-icon">
            ${renderIcon("recommendation", "rag-icon-recommendation")}
          </div>

          <div class="rag-recommendation-hero-text">
            <strong>Akıllı kaynak önerileri</strong>
            <span>
              Taranan kaynaklardan konu çıkarımı yapılarak ilgili yeni sayfalar burada listelenir.
            </span>
          </div>
        </div>

        <div class="rag-recommendation-count-line">
          ${recommendations.length} öneri · Araştırma modu
        </div>

        <div class="rag-recommendation-list">
          ${
            recommendations.length
              ? recommendations.map(renderRecommendationCard).join("")
              : renderEmptyRecommendations()
          }
        </div>
      </div>
    `;
  }

  function renderRecommendationCard(item) {
    const id = item?.id || "";
    const title = item?.title || "Başlıksız öneri";
    const summary = item?.summary || "Bu öneri için kısa özet henüz oluşturulmadı.";
    const reason = item?.reason || "Bu öneri mevcut kaynak bağlamıyla ilişkili olduğu için gösteriliyor.";
    const domain = item?.domain || "Kaynak adresi yok";
    const url = item?.url || "";

    return `
      <article
        class="rag-recommendation-card"
        data-recommendation-id="${escapeHtml(id)}"
      >
        <div class="rag-recommendation-card-top">
          <div class="rag-recommendation-card-icon">
            ${renderIcon("recommendation", "rag-icon-recommendation")}
          </div>

          <div class="rag-recommendation-card-title">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(domain)}</span>
          </div>
        </div>

        <p class="rag-recommendation-summary">
          ${escapeHtml(trimText(summary, 210))}
        </p>

        <div class="rag-recommendation-reason">
          <span>Neden önerildi?</span>
          <p>${escapeHtml(trimText(reason, 180))}</p>
        </div>

        <div class="rag-recommendation-actions">
          ${
            url
              ? `
                <button
                  class="rag-secondary-btn rag-open-recommendation-btn"
                  type="button"
                  data-url="${escapeHtml(url)}"
                >
                  ${renderIcon("external-link", "rag-icon-button")}
                  <span>Siteye git</span>
                </button>
              `
              : ""
          }

          <button
            class="rag-primary-btn rag-scan-recommendation-btn"
            type="button"
            data-recommendation-id="${escapeHtml(id)}"
            ${url ? `data-url="${escapeHtml(url)}"` : ""}
          >
            ${renderIcon("scan", "rag-icon-button")}
            <span>Tara ve ekle</span>
          </button>
        </div>
      </article>
    `;
  }

  function renderEmptyRecommendations() {
    return `
      <div class="rag-empty-state">
        <strong>Henüz öneri yok.</strong>
        <span>Mevcut kaynaklara göre yeni öneriler üretmek için öneri üret butonunu kullan.</span>
      </div>
    `;
  }

  function renderLoadingRecommendations() {
    return `
      <div class="rag-recommendations-panel">
        <div class="rag-empty-state">
          <strong>Öneriler hazırlanıyor.</strong>
          <span>Mevcut kaynaklardan konu çıkarımı yapılıyor.</span>
        </div>
      </div>
    `;
  }

  function renderRecommendationsError(message) {
    return `
      <div class="rag-recommendations-panel">
        <div class="rag-empty-state">
          <strong>Öneriler alınamadı.</strong>
          <span>${escapeHtml(message)}</span>
        </div>
      </div>
    `;
  }

  window.AdaptiveRagRecommendationsPanel = {
    __moduleName: "recommendations-panel",

    renderRecommendationsPanel
  };
})();