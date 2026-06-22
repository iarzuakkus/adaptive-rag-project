/**
 * Dosya: widget.js
 *
 * Görev:
 * - Sağ alttaki launcher baloncuğunu her durumda oluşturur.
 * - Oturum açıksa widget panelini açar.
 * - Oturum kapalıysa pasif ekran gösterir.
 * - Chat / Kaynaklar / Notlar içeriklerini ayrı modüllerden çağırır.
 */

(function () {
  const WIDGET_ID = "adaptive-rag-widget";
  const LAUNCHER_ID = "adaptive-rag-launcher";

  if (
    window.AdaptiveRagWidget?.__widgetName === "adaptive-rag-main-widget" &&
    document.getElementById(LAUNCHER_ID)
  ) {
    return;
  }

  function state() {
    return window.AdaptiveRagState;
  }

  function isSessionActive() {
    return Boolean(state()?.isSessionActive?.());
  }

  function getLogoUrl() {
    try {
      return chrome.runtime.getURL("assets/logo.svg");
    } catch {
      return "";
    }
  }

  function removeWidget() {
    document.getElementById(WIDGET_ID)?.remove();
  }

  function createLauncher() {
    let launcher = document.getElementById(LAUNCHER_ID);

    if (!launcher) {
      launcher = document.createElement("button");
      launcher.id = LAUNCHER_ID;
      launcher.type = "button";
      launcher.className = "rag-launcher";
      launcher.setAttribute("aria-label", "Adaptive RAG oturum baloncuğu");

      launcher.innerHTML = `
        <img
          src="${getLogoUrl()}"
          alt="Adaptive RAG Logo"
          class="rag-launcher-logo"
        />
      `;

      launcher.addEventListener("click", async () => {
        if (document.getElementById(WIDGET_ID)) {
          removeWidget();
          return;
        }

        if (!isSessionActive()) {
          createPassiveWidget();
          return;
        }

        await createWidget();
      });

      document.body.appendChild(launcher);
    }

    updateLauncherState();
  }

  function updateLauncherState() {
    const launcher = document.getElementById(LAUNCHER_ID);

    if (!launcher) {
      return;
    }

    const active = isSessionActive();

    launcher.classList.toggle("active", active);
    launcher.classList.toggle("passive", !active);
    launcher.title = active ? "Oturum açık" : "Oturum kapalı";
  }

  function createPanel(html) {
    removeWidget();

    const widget = document.createElement("section");
    widget.id = WIDGET_ID;
    widget.className = "rag-widget";
    widget.innerHTML = html;

    document.body.appendChild(widget);

    document.getElementById("ragWidgetClose")?.addEventListener("click", removeWidget);
  }

  function createPassiveWidget() {
    const html = window.AdaptiveRagWidgetShell?.renderPassiveSession
      ? window.AdaptiveRagWidgetShell.renderPassiveSession()
      : `
        <div class="rag-window">
          <header class="rag-header">
            <div class="rag-brand">
              <div class="rag-brand-text">
                <strong>Adaptive RAG</strong>
                <span>Oturum kapalı</span>
              </div>
            </div>

            <button id="ragWidgetClose" class="rag-close-btn" type="button">×</button>
          </header>

          <main class="rag-body">
            <div class="rag-empty-state">
              <strong>Oturum kapalı.</strong>
              <span>Popup içinden oturumu açınca widget aktif olur.</span>
            </div>
          </main>
        </div>
      `;

    createPanel(html);
  }

  async function createWidget() {
    const html = window.AdaptiveRagWidgetShell?.renderWidgetShell
      ? window.AdaptiveRagWidgetShell.renderWidgetShell()
      : `
        <div class="rag-window">
          <header class="rag-header">
            <div class="rag-brand">
              <div class="rag-brand-text">
                <strong>Adaptive RAG</strong>
                <span>Kişisel araştırma asistanı</span>
              </div>
            </div>

            <button id="ragWidgetClose" class="rag-close-btn" type="button">×</button>
          </header>

          <nav class="rag-tabs">
            <button class="rag-tab active" type="button" data-tab="chat">Chat</button>
            <button class="rag-tab" type="button" data-tab="sources">Kaynaklar</button>
            <button class="rag-tab" type="button" data-tab="notes">Notlar</button>
          </nav>

          <main id="ragWidgetBody" class="rag-body"></main>
        </div>
      `;

    createPanel(html);
    bindTabEvents();
    syncTabs();

    await renderActiveTab();
  }

  function bindTabEvents() {
    document.querySelectorAll(".rag-tab").forEach((button) => {
      button.addEventListener("click", async () => {
        state()?.setActiveTab?.(button.dataset.tab || "chat");
        syncTabs();
        await renderActiveTab();
      });
    });
  }

  function syncTabs() {
    const activeTab = state()?.getActiveTab?.() || "chat";

    document.querySelectorAll(".rag-tab").forEach((button) => {
      const active = button.dataset.tab === activeTab;

      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  async function renderActiveTab() {
    if (!isSessionActive()) {
      createPassiveWidget();
      return;
    }

    const body = document.getElementById("ragWidgetBody");

    if (!body) {
      return;
    }

    const activeTab = state()?.getActiveTab?.() || "chat";

    if (activeTab === "sources") {
      body.innerHTML = window.AdaptiveRagSourcesTab?.renderSourcesTab
        ? window.AdaptiveRagSourcesTab.renderSourcesTab()
        : renderMissingModule("Kaynaklar modülü yüklenmedi.");

      window.AdaptiveRagSourceEvents?.bindSourceEvents?.(renderActiveTab);
      return;
    }

    if (activeTab === "notes") {
      body.innerHTML = window.AdaptiveRagNotesTab?.renderNotesTab
        ? window.AdaptiveRagNotesTab.renderNotesTab()
        : renderMissingModule("Notlar modülü yüklenmedi.");

      window.AdaptiveRagNotesTab?.bindNotesEvents?.(renderActiveTab);
      return;
    }

    if (activeTab === "chat") {
      if (window.AdaptiveRagChatTab?.renderChatTab) {
        body.innerHTML = await window.AdaptiveRagChatTab.renderChatTab();

        if (window.AdaptiveRagChatTab?.bindChatEvents) {
          window.AdaptiveRagChatTab.bindChatEvents(renderActiveTab);
          return;
        }

        if (window.AdaptiveRagChatEvents?.bindChatEvents) {
          window.AdaptiveRagChatEvents.bindChatEvents(renderActiveTab);
          return;
        }

        console.warn("[WIDGET] Chat event modülü yüklenmedi.");
        return;
      }

      body.innerHTML = renderMissingModule("Chat modülü yüklenmedi.");
      return;
    }

    body.innerHTML = renderMissingModule("Sekme modülü yüklenmedi.");
  }

  function renderMissingModule(message) {
    return `
      <div class="rag-empty-state">
        <strong>Modül bulunamadı.</strong>
        <span>${message}</span>
      </div>
    `;
  }

  window.startAdaptiveRagSession = async function () {
    const prepared = await state()?.prepareSession?.();

    state()?.setSessionActive?.(Boolean(prepared));
    await state()?.saveSessionState?.(Boolean(prepared));

    updateLauncherState();

    if (prepared && document.getElementById(WIDGET_ID)) {
      await createWidget();
    }

    setTimeout(() => {
      window.AdaptiveRagPageScanner?.initializePageScanFlow?.();
    }, 300);

    return Boolean(prepared);
  };

  window.stopAdaptiveRagSession = async function () {
    removeWidget();

    await state()?.clearSessionData?.();

    state()?.setSessionActive?.(false);
    await state()?.saveSessionState?.(false);

    updateLauncherState();

    window.AdaptiveRagScanPrompt?.hideScanPrompt?.();

    return true;
  };

  window.showAdaptiveRagBubble = async function () {
    createLauncher();
    return true;
  };

  window.hideAdaptiveRagBubble = async function () {
    return await window.stopAdaptiveRagSession();
  };

  window.closeAdaptiveRagWidget = function () {
    removeWidget();
    return true;
  };

  window.AdaptiveRagWidget = {
    __widgetName: "adaptive-rag-main-widget",

    createLauncher,
    createWidget,
    renderActiveTab,
    updateLauncherState
  };

  async function initWidget() {
    await state()?.loadSessionState?.();

    createLauncher();

    if (isSessionActive()) {
      const prepared = await state()?.prepareSession?.();

      if (!prepared) {
        state()?.setSessionActive?.(false);
        await state()?.saveSessionState?.(false);
      }
    }

    updateLauncherState();
  }

  initWidget();
})();