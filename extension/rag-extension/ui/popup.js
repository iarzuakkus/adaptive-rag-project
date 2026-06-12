const widgetToggle = document.getElementById("widgetToggle");

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
    files: [
      "ui/widget/styles/widget-variables.css",
      "ui/widget/styles/widget-launcher.css",
      "ui/widget/styles/widget-layout.css",
      "ui/widget/styles/widget-tabs.css",
      "ui/widget/styles/widget-cards.css",
      "ui/widget/styles/widget-chat.css",
      "ui/widget/styles/widget-sources.css",
      "ui/widget/styles/widget-notes.css",
      "ui/widget/styles/widget-effects.css"
    ]
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

async function checkBubbleStatus() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    widgetToggle.checked = false;
    return;
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        return Boolean(document.querySelector("#adaptive-rag-launcher"));
      }
    });

    widgetToggle.checked = Boolean(result?.result);
  } catch (error) {
    console.error("Baloncuk durumu kontrol edilemedi:", error);
    widgetToggle.checked = false;
  }
}

async function toggleBubble() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    widgetToggle.checked = false;
    return;
  }

  try {
    if (widgetToggle.checked) {
      await injectWidgetFiles(activeTab.id);

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          if (window.showAdaptiveRagBubble) {
            return window.showAdaptiveRagBubble();
          }

          console.error("showAdaptiveRagBubble bulunamadı.");
          return false;
        }
      });

      widgetToggle.checked = Boolean(result?.result);
    } else {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          if (window.hideAdaptiveRagBubble) {
            return window.hideAdaptiveRagBubble();
          }

          document.querySelector("#adaptive-rag-launcher")?.remove();
          document.querySelector("#adaptive-rag-widget")?.remove();

          return true;
        }
      });

      widgetToggle.checked = false;
    }
  } catch (error) {
    console.error("Baloncuk kontrol hatası:", error);
    alert("Baloncuk açılamadı. Console hatasını kontrol et.");
    widgetToggle.checked = false;
  }
}

widgetToggle?.addEventListener("change", toggleBubble);

checkBubbleStatus();