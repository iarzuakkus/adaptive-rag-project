(function () {
  function renderWidgetShell() {
    return `
      <div class="rag-widget-header">
        <div>
          <h2>Adaptive RAG</h2>
          <span>Kişisel araştırma asistanı</span>
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