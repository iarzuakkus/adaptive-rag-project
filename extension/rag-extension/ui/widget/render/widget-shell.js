/**
 * Dosya: widget-shell.js
 *
 * Görev:
 * - Launcher baloncuğunun HTML'ini üretir.
 * - Widget panelinin ana HTML iskeletini üretir.
 * - Oturum kapalıyken gösterilecek pasif ekranı üretir.
 *
 * Not:
 * - Event bağlama işlemleri burada yapılmaz.
 * - Chat, Kaynaklar ve Notlar içerikleri burada üretilmez.
 */

(function () {
  if (window.AdaptiveRagWidgetShell?.__shellName === "widget-shell") {
    return;
  }

  function getLogoUrl() {
    if (window.AdaptiveRagState?.getLogoUrl) {
      return window.AdaptiveRagState.getLogoUrl();
    }

    try {
      return chrome.runtime.getURL("assets/logo.svg");
    } catch {
      return "";
    }
  }

  function renderLauncher() {
    return `
      <img
        src="${getLogoUrl()}"
        alt="Adaptive RAG Logo"
        class="rag-launcher-logo"
      />
    `;
  }

  function renderWidgetShell() {
    return `
      <div class="rag-window">
        <header class="rag-header">
          <div class="rag-brand">
            <div class="rag-brand-logo-wrap">
              <img
                src="${getLogoUrl()}"
                alt="Adaptive RAG"
                class="rag-brand-logo"
              />
            </div>

            <div class="rag-brand-text">
              <strong>Adaptive RAG</strong>
              <span>Kişisel araştırma asistanı</span>
            </div>
          </div>

          <button
            id="ragWidgetClose"
            class="rag-close-btn"
            type="button"
            aria-label="Widget kapat"
          >
            ×
          </button>
        </header>

        <nav class="rag-tabs" role="tablist" aria-label="Adaptive RAG sekmeleri">
          <button
            class="rag-tab active"
            type="button"
            data-tab="chat"
            role="tab"
            aria-selected="true"
          >
            Chat
          </button>

          <button
            class="rag-tab"
            type="button"
            data-tab="sources"
            role="tab"
            aria-selected="false"
          >
            Kaynaklar
          </button>

          <button
            class="rag-tab"
            type="button"
            data-tab="notes"
            role="tab"
            aria-selected="false"
          >
            Notlar
          </button>
        </nav>

        <main id="ragWidgetBody" class="rag-body"></main>
      </div>
    `;
  }

  function renderPassiveSession() {
    return `
      <div class="rag-window">
        <header class="rag-header">
          <div class="rag-brand">
            <div class="rag-brand-logo-wrap">
              <img
                src="${getLogoUrl()}"
                alt="Adaptive RAG"
                class="rag-brand-logo"
              />
            </div>

            <div class="rag-brand-text">
              <strong>Adaptive RAG</strong>
              <span>Oturum kapalı</span>
            </div>
          </div>

          <button
            id="ragWidgetClose"
            class="rag-close-btn"
            type="button"
            aria-label="Widget kapat"
          >
            ×
          </button>
        </header>

        <main class="rag-body">
          <div class="rag-empty-state">
            <strong>Oturum kapalı.</strong>
            <span>Popup içinden oturumu açınca chat, kaynaklar ve notlar aktif olur.</span>
          </div>
        </main>
      </div>
    `;
  }

  window.AdaptiveRagWidgetShell = {
    __shellName: "widget-shell",

    renderLauncher,
    renderWidgetShell,
    renderPassiveSession
  };
})();