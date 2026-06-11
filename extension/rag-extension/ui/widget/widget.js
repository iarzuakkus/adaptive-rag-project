(function () {
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

  window.AdaptiveRagWidget = {
    createWidget,
    renderActiveTab
  };

  window.startAdaptiveRagResearch = function () {
    createWidget();
    return true;
  };

  window.closeAdaptiveRagWidget = function () {
    const existingWidget = document.querySelector("#adaptive-rag-widget");

    if (existingWidget) {
      existingWidget.remove();
      return true;
    }

    return false;
  };
})();