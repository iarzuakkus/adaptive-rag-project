(function () {
  function renderWidgetShell() {
    const logoUrl = chrome.runtime.getURL("assets/logo.svg");

    return `
      <div class="rag-widget-header">
        <div class="rag-widget-brand">
          <div class="rag-widget-brand-logo">
            <img
              src="${logoUrl}"
              alt="Adaptive RAG Logo"
              class="rag-widget-brand-logo-image"
            />
          </div>

          <div class="rag-widget-brand-text">
            <h2>Adaptive RAG</h2>
            <span>Kişisel araştırma asistanı</span>
          </div>
        </div>

        <button class="rag-widget-close" id="ragWidgetClose">×</button>
      </div>

      <div class="rag-widget-tabs">
        <button class="rag-tab active" data-tab="chat">Chat</button>
        <button class="rag-tab" data-tab="sources">Kaynaklar</button>
        <button class="rag-tab" data-tab="notes">Notlar</button>
      </div>

      <div class="rag-widget-body" id="ragWidgetBody"></div>
    `;
  }

  window.AdaptiveRagWidgetShell = {
    renderWidgetShell
  };
})();