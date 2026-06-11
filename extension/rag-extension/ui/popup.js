const startResearchBtn = document.getElementById("startResearchBtn");
const closeWidgetBtn = document.getElementById("closeWidgetBtn");
const widgetStatus = document.getElementById("widgetStatus");

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function injectWidgetFiles(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["ui/widget/widget.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "core/research-store.js",

      "ui/widget/widget-state.js",

      "ui/widget/render/widget-shell.js",
      "ui/widget/render/chat-tab.js",
      "ui/widget/render/sources-tab.js",
      "ui/widget/render/notes-tab.js",

      "ui/widget/events/source-events.js",
      "ui/widget/events/highlight-events.js",

      "ui/widget/widget.js"
    ]
  });
}

async function startResearch() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    updateStatus("Sayfa bulunamadı", false);
    return;
  }

  try {
    updateStatus("Araştırma başlatılıyor...", true);

    await injectWidgetFiles(activeTab.id);

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        if (window.startAdaptiveRagResearch) {
          return window.startAdaptiveRagResearch();
        }

        return false;
      }
    });

    if (result?.result) {
      updateStatus("Araştırma başladı", true);
    } else {
      updateStatus("Widget başlatılamadı", false);
    }
  } catch (error) {
    console.error("Araştırma başlatma hatası:", error);
    updateStatus("Başlatılamadı", false);
  }
}

async function closeWidget() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    updateStatus("Sayfa bulunamadı", false);
    return;
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        if (window.closeAdaptiveRagWidget) {
          return window.closeAdaptiveRagWidget();
        }

        const widget = document.querySelector("#adaptive-rag-widget");

        if (widget) {
          widget.remove();
          return true;
        }

        return false;
      }
    });

    if (result?.result) {
      updateStatus("Widget kapatıldı", false);
    } else {
      updateStatus("Widget zaten kapalı", false);
    }
  } catch (error) {
    console.error("Widget kapatma hatası:", error);
    updateStatus("Kapatılamadı", false);
  }
}

function updateStatus(text, active) {
  if (!widgetStatus) return;

  widgetStatus.textContent = text;
  widgetStatus.classList.toggle("active", active);
}

startResearchBtn?.addEventListener("click", startResearch);
closeWidgetBtn?.addEventListener("click", closeWidget);