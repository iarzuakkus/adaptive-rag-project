(function () {
  function createLauncher() {
    const existingLauncher = document.querySelector("#adaptive-rag-launcher");

    if (existingLauncher) {
      return;
    }

    const logoUrl = chrome.runtime.getURL("assets/logo.svg");

    const launcher = document.createElement("button");
    launcher.id = "adaptive-rag-launcher";
    launcher.className = "rag-launcher";
    launcher.type = "button";

    launcher.innerHTML = `
      <img
        src="${logoUrl}"
        alt="Adaptive RAG Logo"
        class="rag-launcher-logo"
      />
    `;

    document.body.appendChild(launcher);

    launcher.addEventListener("click", () => {
      const existingWidget = document.querySelector("#adaptive-rag-widget");

      if (existingWidget) {
        existingWidget.remove();
        return;
      }

      createWidget();
    });
  }

  function createWidget() {
    const existingWidget = document.querySelector("#adaptive-rag-widget");

    if (existingWidget) {
      existingWidget.remove();
    }

    const widget = document.createElement("div");
    widget.id = "adaptive-rag-widget";
    widget.className = "rag-widget";

    widget.innerHTML = window.AdaptiveRagWidgetShell.renderWidgetShell();

    document.body.appendChild(widget);

    bindWidgetEvents();
    renderActiveTab();
  }

  function bindWidgetEvents() {
    document.querySelector("#ragWidgetClose")?.addEventListener("click", () => {
      document.querySelector("#adaptive-rag-widget")?.remove();
    });

    document.querySelectorAll(".rag-tab").forEach((tabButton) => {
      tabButton.addEventListener("click", () => {
        const selectedTab = tabButton.dataset.tab;

        window.AdaptiveRagState.setActiveTab(selectedTab);

        document.querySelectorAll(".rag-tab").forEach((button) => {
          button.classList.remove("active");
        });

        tabButton.classList.add("active");

        renderActiveTab();
      });
    });
  }

  function renderActiveTab() {
    const body = document.querySelector("#ragWidgetBody");

    if (!body) return;

    const activeTab = window.AdaptiveRagState.getActiveTab();

    if (activeTab === "chat") {
      body.innerHTML = window.AdaptiveRagChatTab.renderChatTab();
      return;
    }

    if (activeTab === "sources") {
      body.innerHTML = window.AdaptiveRagSourcesTab.renderSourcesTab();

      window.AdaptiveRagSourceEvents.bindSourceCardEvents(renderActiveTab);
      window.AdaptiveRagHighlightEvents.bindHighlightEvents();

      return;
    }

    if (activeTab === "notes") {
      body.innerHTML = window.AdaptiveRagNotesTab.renderNotesTab();
    }
  }

  window.showAdaptiveRagBubble = function () {
    createLauncher();
    return true;
  };

  window.hideAdaptiveRagBubble = function () {
    document.querySelector("#adaptive-rag-launcher")?.remove();
    document.querySelector("#adaptive-rag-widget")?.remove();

    return true;
  };

  window.closeAdaptiveRagWidget = function () {
    document.querySelector("#adaptive-rag-widget")?.remove();
    return true;
  };

  window.AdaptiveRagWidget = {
    createLauncher,
    createWidget,
    renderActiveTab
  };
})();