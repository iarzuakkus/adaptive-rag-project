(function () {
  function renderSourcesTab() {
    const data = window.AdaptiveRagStore.getResearchData();
    const openedPageId = window.AdaptiveRagState.getOpenedPageId();

    const pageCards = data.pages
      .map((page) => renderSourceCard(page, openedPageId))
      .join("");

    const timelineItems = data.timeline
      .map(
        (item) => `
          <li>
            <span>${item.time}</span>
            <p>${item.title}</p>
          </li>
        `
      )
      .join("");

    return `
      <section class="rag-section">
        <div class="rag-section-title">
          <h3>Taranan sayfalar</h3>
          <button id="scanCurrentPageBtn">Sayfayı tara</button>
        </div>

        <div class="rag-source-list">
          ${pageCards || renderEmptySources()}
        </div>

        <div class="rag-timeline">
          <h3>Zaman çizelgesi</h3>
          <ul>
            ${timelineItems || "<li><p>Henüz işlem yok.</p></li>"}
          </ul>
        </div>
      </section>
    `;
  }

  function renderSourceCard(page, openedPageId) {
    const isOpen = openedPageId === page.id;

    return `
      <article class="rag-source-card">
        <button class="rag-source-main" data-page-id="${page.id}">
          <div>
            <h3>${page.title}</h3>
            <p>${page.summary}</p>
            <span>${page.scannedAt}</span>
          </div>

          <strong>${isOpen ? "Kapat" : "Aç"}</strong>
        </button>

        ${isOpen ? renderSourceDetail(page) : ""}
      </article>
    `;
  }

  function renderSourceDetail(page) {
    const chunks = page.chunks
      .map(
        (chunk) => `
          <div class="rag-chunk-card">
            <p>${chunk.text}</p>

            <button 
              class="rag-highlight-btn"
              data-selector="${chunk.sourceSelector || ""}"
            >
              Kaynağa git / highlight
            </button>
          </div>
        `
      )
      .join("");

    return `
      <div class="rag-source-detail">
        <div class="rag-source-url">
          <span>Kaynak:</span>
          <a href="${page.url}" target="_blank">${page.url}</a>
        </div>

        <h4>Kaynak chunk'ları</h4>

        <div class="rag-chunk-list">
          ${chunks || "<p>Bu sayfa için chunk bulunamadı.</p>"}
        </div>
      </div>
    `;
  }

  function renderEmptySources() {
    return `
      <div class="rag-empty-state">
        <h3>Henüz sayfa taranmadı</h3>
        <p>
          Araştırmaya başlamak için mevcut sayfayı tara.
        </p>
      </div>
    `;
  }

  window.AdaptiveRagSourcesTab = {
    renderSourcesTab
  };
})();