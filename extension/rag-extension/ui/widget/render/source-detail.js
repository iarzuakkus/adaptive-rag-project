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

  function parseJsonSafely(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
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

  function getSourceUrl(source) {
    return (
      source?.url ||
      source?.source_url ||
      source?.page_url ||
      source?.pageUrl ||
      ""
    );
  }

  function getSourceDomain(source) {
    const url = getSourceUrl(source);

    return (
      source?.domain ||
      source?.site ||
      source?.hostname ||
      getShortUrl(url) ||
      "Kaynak adresi yok"
    );
  }

  function getLongSummary(source) {
    return (
      source?.long_summary ||
      source?.detail_summary ||
      source?.extended_summary ||
      source?.llm_summary ||
      source?.summary ||
      ""
    );
  }

  function getSourceId(source) {
    return source?.source_id || source?.sourceId || source?.id || "";
  }

  function normalizeSummarySection(section, index) {
    if (!section) {
      return null;
    }

    if (typeof section === "string") {
      const value = section.trim();

      if (!value) {
        return null;
      }

      return {
        title: `Başlık ${index + 1}`,
        content: value
      };
    }

    if (typeof section !== "object") {
      return null;
    }

    const title =
      section.title ||
      section.heading ||
      section.header ||
      section.name ||
      section.label ||
      `Başlık ${index + 1}`;

    const content =
      section.content ||
      section.text ||
      section.summary ||
      section.description ||
      section.body ||
      "";

    if (!String(content || "").trim()) {
      return null;
    }

    return {
      title: String(title || `Başlık ${index + 1}`).trim(),
      content: String(content || "").trim()
    };
  }

  function normalizeSectionsFromObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    if (Array.isArray(value.sections)) {
      return value.sections;
    }

    if (Array.isArray(value.summary_sections)) {
      return value.summary_sections;
    }

    if (Array.isArray(value.headings)) {
      return value.headings;
    }

    return Object.entries(value).map(([title, content]) => {
      return {
        title,
        content
      };
    });
  }

  function getRawSummarySections(source) {
    const candidates = [
      source?.summary_sections,
      source?.detail_sections,
      source?.structured_summary,
      source?.structuredSummary,
      source?.llm_summary_sections,
      source?.llmSummarySections,
      source?.heading_summary,
      source?.headingSummary,
      source?.summary_by_headings,
      source?.summaryByHeadings
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      if (Array.isArray(candidate)) {
        return candidate;
      }

      const parsedCandidate =
        typeof candidate === "string" ? parseJsonSafely(candidate) : candidate;

      if (Array.isArray(parsedCandidate)) {
        return parsedCandidate;
      }

      const objectSections = normalizeSectionsFromObject(parsedCandidate);

      if (objectSections.length > 0) {
        return objectSections;
      }
    }

    return [];
  }

  function getDetailSummarySections(source) {
    const rawSections = getRawSummarySections(source);

    const normalizedSections = rawSections
      .map((section, index) => normalizeSummarySection(section, index))
      .filter(Boolean)
      .slice(0, 4);

    if (normalizedSections.length > 0) {
      return normalizedSections;
    }

    const longSummary = getLongSummary(source);

    if (!String(longSummary || "").trim()) {
      return [];
    }

    return [
      {
        title: "Genel özet",
        content: longSummary
      }
    ];
  }

  function renderSummarySections(source) {
    const sections = getDetailSummarySections(source);

    if (!sections.length) {
      return `
        <section class="rag-source-detail-section">
          <div class="rag-source-detail-section-head">
            <span>Başlıklı özet</span>
            <strong>Henüz oluşturulmadı</strong>
          </div>

          <p>
            Bu kaynak için başlıklı detay özeti henüz oluşturulmadı.
          </p>
        </section>
      `;
    }

    return `
      <section class="rag-source-detail-summary-area">
        <div class="rag-source-detail-section-head">
          <span>Başlıklı özet</span>
          <strong>Kaynağın ana noktaları</strong>
        </div>

        <div class="rag-source-detail-summary-grid">
          ${sections.map(renderSummarySectionCard).join("")}
        </div>
      </section>
    `;
  }

  function renderSummarySectionCard(section, index) {
    return `
      <article class="rag-source-detail-summary-card">
        <div class="rag-source-detail-summary-index">
          ${String(index + 1).padStart(2, "0")}
        </div>

        <div class="rag-source-detail-summary-content">
          <h4>${escapeHtml(section.title)}</h4>
          <p>${escapeHtml(trimText(section.content, 520))}</p>
        </div>
      </article>
    `;
  }

  function renderSourceDetail(source) {
    if (!source) {
      return renderEmptyDetail();
    }

    const title = getSourceTitle(source);
    const url = getSourceUrl(source);
    const domain = getSourceDomain(source);
    const scannedAt = formatDate(source.scanned_at || source.scannedAt || source.created_at);
    const sourceId = getSourceId(source);

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

          ${renderSummarySections(source)}

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
                    class="rag-secondary-btn rag-open-source-btn rag-icon-btn"
                    type="button"
                    data-url="${escapeHtml(url)}"
                  >
                    ${renderIcon("external-link", "rag-icon-button")}
                    <span>Siteye git</span>
                  </button>
                `
                : ""
            }

            ${
              sourceId
                ? `
                  <button
                    class="rag-danger-btn rag-delete-source-btn rag-icon-btn"
                    type="button"
                    data-source-id="${escapeHtml(sourceId)}"
                  >
                    ${renderIcon("rubbish", "rag-icon-button")}
                    <span>Sil</span>
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