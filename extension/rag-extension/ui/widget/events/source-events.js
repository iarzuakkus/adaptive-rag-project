(function () {
  function bindSourceCardEvents(renderActiveTab) {
    document.querySelectorAll(".rag-source-main").forEach((button) => {
      button.addEventListener("click", () => {
        const pageId = button.dataset.pageId;

        window.AdaptiveRagState.toggleOpenedPage(pageId);
        renderActiveTab();
      });
    });
  }

  window.AdaptiveRagSourceEvents = {
    bindSourceCardEvents
  };
})();