(function () {
  function renderNotesTab() {
    const data = window.AdaptiveRagStore.getResearchData();

    const quoteItems = data.notes.quotes
      .map(
        (quote) => `
          <article class="rag-note-card">
            <p>“${quote.text}”</p>

            <div>
              <span>${quote.sourceTitle}</span>
              <a href="${quote.sourceUrl}" target="_blank">Kaynağa git</a>
            </div>
          </article>
        `
      )
      .join("");

    const recommendationItems = data.notes.recommendations
      .map(
        (item) => `
          <article class="rag-recommendation-card">
            <h4>${item.title}</h4>
            <p>${item.reason}</p>
          </article>
        `
      )
      .join("");

    return `
      <section class="rag-section">
        <div class="rag-summary-box">
          <h3>Genel özet</h3>
          <p>${data.notes.generalSummary}</p>
        </div>

        <div class="rag-notes-block">
          <h3>Alıntılar</h3>
          ${quoteItems || "<p>Henüz alıntı yok.</p>"}
        </div>

        <div class="rag-notes-block">
          <h3>Okuma önerileri</h3>
          ${recommendationItems || "<p>Henüz öneri yok.</p>"}
        </div>

        <div class="rag-export-actions">
          <button>PDF çıktısı</button>
          <button>Word çıktısı</button>
        </div>
      </section>
    `;
  }

  window.AdaptiveRagNotesTab = {
    renderNotesTab
  };
})();