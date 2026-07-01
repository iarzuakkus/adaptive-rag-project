/**
 * Dosya: recommendations-panel.js
 *
 * Görev:
 * - Kaynaklar sekmesi içindeki Öneriler panelinin HTML içeriğini üretir.
 * - Mock veri üretmez.
 * - Backend/recommendation store tarafından verilen gerçek önerileri render eder.
 *
 * Not:
 * - Bu dosya sadece render işi yapar.
 * - Öneri üretme, yenileme, sayfa açma ve öneriyi tarama eventleri recommendation-events.js üzerinden yönetilir.
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

  function getRecommendationStoreState() {
    const possibleStores = [
      window.AdaptiveRagRecommendationStore,
      window.AdaptiveRagRecommendationsStore,
      window.AdaptiveRagRecommendationState,
      window.AdaptiveRagRecommendationsState
    ];

    for (const store of possibleStores) {
      if (!store) {
        continue;
      }

      if (typeof store.getState === "function") {
        const state = store.getState();

        if (state && typeof state === "object") {
          return state;
        }
      }

      if (typeof store.getRecommendations === "function") {
        return {
          recommendations: store.getRecommendations()
        };
      }
    }

    return {};
  }

  function resolvePanelOptions(options = {}) {
    const storeState = getRecommendationStoreState();

    const recommendations = Array.isArray(options.recommendations)
      ? options.recommendations
      : Array.isArray(storeState.recommendations)
        ? storeState.recommendations
        : [];

    const isLoading =
      options.isLoading === true ||
      storeState.isLoading === true ||
      storeState.loading === true;

    const isRefreshing =
      options.isRefreshing === true ||
      storeState.isRefreshing === true ||
      storeState.refreshing === true;

    const error = String(
      options.error ||
      storeState.error ||
      storeState.message ||
      ""
    ).trim();

    const sourceCount = Number(
      options.sourceCount ??
      storeState.sourceCount ??
      0
    );

    const generatedAt =
      options.generatedAt ||
      storeState.generatedAt ||
      storeState.updatedAt ||
      "";

    const generationMode =
      options.generationMode ||
      storeState.generationMode ||
      "refresh";

    return {
      recommendations,
      isLoading,
      isRefreshing,
      error,
      sourceCount,
      generatedAt,
      generationMode
    };
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }

    try {
      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return "";
      }

      return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  }

  function getRecommendationId(item, index) {
    return (
      item?.id ||
      item?.recommendation_id ||
      item?.recommendationId ||
      item?.query_id ||
      `recommendation-${index + 1}`
    );
  }

  function getRecommendationTitle(item) {
    return (
      item?.title ||
      item?.query_title ||
      item?.search_title ||
      item?.heading ||
      "Başlıksız öneri"
    );
  }

  function getRecommendationUrl(item) {
    return (
      item?.url ||
      item?.source_url ||
      item?.page_url ||
      item?.target_url ||
      ""
    );
  }

  function getShortUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  function getRecommendationDomain(item) {
    const url = getRecommendationUrl(item);

    return (
      item?.domain ||
      item?.site ||
      item?.hostname ||
      getShortUrl(url) ||
      "Kaynak önerisi"
    );
  }

  function getRecommendationSummary(item) {
    return (
      item?.summary ||
      item?.description ||
      item?.snippet ||
      item?.content ||
      "Bu öneri için açıklama henüz oluşturulmadı."
    );
  }

  function getRecommendationReason(item) {
    return (
      item?.reason ||
      item?.why ||
      item?.why_recommended ||
      item?.recommendation_reason ||
      "Bu öneri mevcut kaynak bağlamıyla ilişkili olduğu için gösteriliyor."
    );
  }

  function getRecommendationQuery(item) {
    return (
      item?.query ||
      item?.search_query ||
      item?.searchQuery ||
      item?.keyword ||
      ""
    );
  }

  function getRecommendationBadge(item) {
    return (
      item?.type ||
      item?.category ||
      item?.label ||
      "Öneri"
    );
  }

  function renderRecommendationsPanel(options = {}) {
    const resolved = resolvePanelOptions(options);
    const recommendations = resolved.recommendations;
    const hasRecommendations = recommendations.length > 0;
    const hasSources = resolved.sourceCount > 0;

    if (resolved.isLoading && !hasRecommendations) {
      return renderLoadingRecommendations(resolved.sourceCount);
    }

    if (resolved.error && !hasRecommendations) {
      return renderRecommendationsError(resolved.error);
    }

    return `
      <div class="rag-recommendations-panel">
        ${!hasSources && !hasRecommendations ? renderSmartRecommendationHero() : ""}

        <div class="rag-recommendation-count-line">
          ${renderCountLine(recommendations.length, resolved.sourceCount, resolved.generatedAt)}
        </div>

        ${
          resolved.isRefreshing && hasRecommendations
            ? `
              <div class="rag-recommendation-inline-status">
                Mevcut öneriler yenileniyor.
              </div>
            `
            : ""
        }

        ${
          resolved.error && hasRecommendations
            ? `
              <div class="rag-recommendation-inline-status">
                ${escapeHtml(resolved.error)}
              </div>
            `
            : ""
        }

        <div class="rag-recommendation-list">
          ${
            hasRecommendations
              ? recommendations.map(renderRecommendationCard).join("")
              : renderEmptyRecommendations(resolved.sourceCount)
          }
        </div>
      </div>
    `;
  }

  function renderSmartRecommendationHero() {
    return `
      <div class="rag-recommendation-hero">
        <div class="rag-recommendation-hero-icon">
          ${renderIcon("recommendation", "rag-icon-recommendation")}
        </div>

        <div class="rag-recommendation-hero-text">
          <strong>Akıllı kaynak önerileri</strong>
          <span>
            Taranan kaynaklardan konu çıkarımı yapılarak araştırmayı genişletecek yeni kaynak fikirleri burada listelenir.
          </span>
        </div>
      </div>
    `;
  }

  function renderCountLine(recommendationCount, sourceCount, generatedAt) {
    const dateText = formatDate(generatedAt);

    if (dateText) {
      return `${recommendationCount} öneri · ${dateText}`;
    }

    if (sourceCount > 0) {
      return `${recommendationCount} öneri · ${sourceCount} kaynak analiz edildi`;
    }

    return `${recommendationCount} öneri · Araştırma modu`;
  }

  function renderRecommendationCard(item, index) {
    const id = getRecommendationId(item, index);
    const title = getRecommendationTitle(item);
    const summary = getRecommendationSummary(item);
    const reason = getRecommendationReason(item);
    const domain = getRecommendationDomain(item);
    const url = getRecommendationUrl(item);
    const query = getRecommendationQuery(item);
    const badge = getRecommendationBadge(item);

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

        <div class="rag-recommendation-meta-row">
          <span>${escapeHtml(badge)}</span>
          ${
            query
              ? `<span>${escapeHtml(trimText(query, 54))}</span>`
              : ""
          }
        </div>

        <p class="rag-recommendation-summary">
          ${escapeHtml(trimText(summary, 260))}
        </p>

        <div class="rag-recommendation-reason">
          <span>Neden önerildi?</span>
          <p>${escapeHtml(trimText(reason, 220))}</p>
        </div>

        <div class="rag-recommendation-actions">
          ${
            url
              ? `
                <button
                  class="rag-secondary-btn rag-open-recommendation-btn rag-icon-btn"
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
            class="rag-primary-btn rag-scan-recommendation-btn rag-icon-btn"
            type="button"
            data-recommendation-id="${escapeHtml(id)}"
            ${url ? `data-url="${escapeHtml(url)}"` : ""}
            ${query ? `data-query="${escapeHtml(query)}"` : ""}
            ${url || query ? "" : "disabled"}
          >
            ${renderIcon("scan", "rag-icon-button")}
            <span>${url ? "Tara ve ekle" : "Kaynak ara"}</span>
          </button>
        </div>
      </article>
    `;
  }

  function renderEmptyRecommendations(sourceCount = 0) {
    const description =
      sourceCount > 0
        ? "Kaynaklar hazır. Öneriler otomatik gelmediyse öneri oluştur butonunu kullan."
        : "Öneri üretmek için önce birkaç web sayfasını kaynaklara ekle.";

    return `
      <div class="rag-empty-state">
        <strong>Henüz öneri yok.</strong>
        <span>${escapeHtml(description)}</span>
      </div>
    `;
  }

  function renderLoadingRecommendations(sourceCount = 0) {
    return `
      <div class="rag-recommendations-panel">
        <div class="rag-recommendation-hero">
          <div class="rag-recommendation-hero-icon">
            <span class="rag-action-loader" aria-hidden="true"></span>
          </div>

          <div class="rag-recommendation-hero-text">
            <strong>Öneriler hazırlanıyor</strong>
            <span>
              ${
                sourceCount > 0
                  ? `${sourceCount} kaynak üzerinden konu çıkarımı yapılıyor.`
                  : "Mevcut kaynaklardan konu çıkarımı yapılıyor."
              }
            </span>
          </div>
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