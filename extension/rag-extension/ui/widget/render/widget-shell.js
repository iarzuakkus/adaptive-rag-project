/**
 * Dosya: widget-shell.js
 *
 * Görev:
 * - Adaptive RAG ana widget penceresinin sabit HTML iskeletini oluşturur.
 * - Header alanını, logo bölümünü, kapatma butonunu, sekme şeridini ve içerik gövdesini üretir.
 * - Chat, Kaynaklar ve Notlar sekmelerinin temel HTML yapısı burada tanımlanır.
 *
 * Not:
 * - Sekmelerin görsel tasarımı widget-tabs.css dosyasında yapılır.
 * - Widget'ın genel yerleşimi widget-layout.css dosyasında yönetilir.
 * - Sekme içerikleri chat-tab.js, sources-tab.js ve notes-tab.js dosyalarından gelir.
 */

(function () {
  /**
   * Widget'ın ana HTML kabuğunu oluşturur.
   *
   * Bu fonksiyon yalnızca sabit yapıyı üretir:
   * - Üst başlık alanı
   * - Tarayıcı sekmesi görünümündeki sekme şeridi
   * - Aktif sekme içeriğinin basılacağı gövde alanı
   */
  function renderWidgetShell() {
    const logoUrl = chrome.runtime.getURL("assets/logo.svg");

    return `
      <!-- Widget üst başlık alanı -->
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

        <button
          type="button"
          class="rag-widget-close"
          id="ragWidgetClose"
          aria-label="Widget'ı kapat"
        >
          ×
        </button>
      </div>

      <!-- Tarayıcı sekmesi görünümündeki ana sekme şeridi -->
      <div
        class="rag-widget-tabs"
        role="tablist"
        aria-label="Adaptive RAG sekmeleri"
      >
        <button
          type="button"
          class="rag-tab active"
          data-tab="chat"
          role="tab"
          aria-selected="true"
        >
          Chat
        </button>

        <button
          type="button"
          class="rag-tab"
          data-tab="sources"
          role="tab"
          aria-selected="false"
        >
          Kaynaklar
        </button>

        <button
          type="button"
          class="rag-tab"
          data-tab="notes"
          role="tab"
          aria-selected="false"
        >
          Notlar
        </button>
      </div>

      <!-- Aktif sekmenin içeriği widget.js tarafından bu gövdeye render edilir -->
      <div class="rag-widget-body" id="ragWidgetBody"></div>
    `;
  }

  /**
   * Shell render fonksiyonunu global alana açar.
   *
   * widget.js bu fonksiyonu çağırarak ana widget panelinin
   * HTML iskeletini sayfaya ekler.
   */
  window.AdaptiveRagWidgetShell = {
    renderWidgetShell
  };
})();