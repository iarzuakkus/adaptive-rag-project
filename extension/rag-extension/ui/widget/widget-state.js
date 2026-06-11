(function () {
  const state = {
    activeTab: "chat",
    openedPageId: null
  };

  function getActiveTab() {
    return state.activeTab;
  }

  function setActiveTab(tabName) {
    state.activeTab = tabName;
  }

  function getOpenedPageId() {
    return state.openedPageId;
  }

  function toggleOpenedPage(pageId) {
    state.openedPageId = state.openedPageId === pageId ? null : pageId;
  }

  function setOpenedPage(pageId) {
    state.openedPageId = pageId;
  }

  function resetOpenedPage() {
    state.openedPageId = null;
  }

  window.AdaptiveRagState = {
    getActiveTab,
    setActiveTab,
    getOpenedPageId,
    toggleOpenedPage,
    setOpenedPage,
    resetOpenedPage
  };
})();