/**
 * Dosya: popup.js
 *
 * Görev:
 * - Chrome extension popup arayüzündeki baloncuk aç/kapat switch'ini yönetir.
 * - Aktif sekmeye Adaptive RAG widget dosyalarını inject eder.
 * - Kullanıcının tarama modunu yönetir:
 *   - manual: Sayfaya girince “Bu sayfayı tara?” kartı çıkar.
 *   - auto: Uygun sayfalar kullanıcıya sorulmadan otomatik taranır.
 *
 * Bağlı olduğu alanlar:
 * - popup.html içindeki #widgetToggle
 * - popup.html içindeki #scanModeManual ve #scanModeAuto butonları
 * - core/scan-settings-store.js ile aynı storage key yapısını kullanır.
 */


/* Popup içindeki baloncuk aç/kapat switch'i */
const widgetToggle = document.getElementById("widgetToggle");


/* Popup içindeki tarama modu butonları */
const scanModeManualBtn = document.getElementById("scanModeManual");
const scanModeAutoBtn = document.getElementById("scanModeAuto");
const scanModeStatus = document.getElementById("scanModeStatus");


/* Tarama ayarlarının chrome.storage.local içinde tutulduğu anahtar */
const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";


/* Varsayılan tarama ayarı */
const DEFAULT_SCAN_SETTINGS = {
  scanMode: "manual",
  dismissedUrls: [],
  scannedUrls: []
};


/**
 * Aktif Chrome sekmesini döndürür.
 *
 * Popup üzerinden işlem yaparken hangi sekmeye widget inject edileceğini
 * öğrenmek için kullanılır.
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}


/**
 * Tarama ayarlarını chrome.storage.local içinden okur.
 *
 * Eğer daha önce kayıt yoksa varsayılan ayarları döndürür.
 */
async function getScanSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCAN_SETTINGS_KEY], (result) => {
      const savedSettings = result[SCAN_SETTINGS_KEY];

      if (!savedSettings || typeof savedSettings !== "object") {
        resolve({ ...DEFAULT_SCAN_SETTINGS });
        return;
      }

      resolve({
        ...DEFAULT_SCAN_SETTINGS,
        ...savedSettings
      });
    });
  });
}


/**
 * Tarama ayarlarını chrome.storage.local içine kaydeder.
 */
async function saveScanSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [SCAN_SETTINGS_KEY]: settings
      },
      () => resolve(settings)
    );
  });
}


/**
 * Kullanıcının seçtiği tarama modunu kaydeder.
 *
 * manual:
 * - Sayfaya girince sağdan “Bu sayfayı tara?” kartı çıkar.
 *
 * auto:
 * - Uygun sayfalarda kullanıcıya sormadan tarama yapılır.
 */
async function setScanMode(scanMode) {
  const settings = await getScanSettings();

  const nextSettings = {
    ...settings,
    scanMode: scanMode === "auto" ? "auto" : "manual"
  };

  await saveScanSettings(nextSettings);

  updateScanModeUI(nextSettings.scanMode);
}


/**
 * Popup içindeki tarama modu görünümünü günceller.
 *
 * Aktif modun butonu active class'ı alır.
 * Alt durum yazısı da seçime göre değişir.
 */
function updateScanModeUI(scanMode) {
  if (!scanModeManualBtn || !scanModeAutoBtn) {
    return;
  }

  scanModeManualBtn.classList.toggle("active", scanMode === "manual");
  scanModeAutoBtn.classList.toggle("active", scanMode === "auto");

  if (!scanModeStatus) {
    return;
  }

  if (scanMode === "auto") {
    scanModeStatus.textContent = "Otomatik tarama aktif. Uygun sayfalar sormadan taranır.";
    return;
  }

  scanModeStatus.textContent = "Elle tarama aktif. Sayfaya girince tarama kartı gösterilir.";
}


/**
 * Popup açıldığında kayıtlı tarama modunu okur ve UI'a yansıtır.
 */
async function loadScanModeStatus() {
  const settings = await getScanSettings();
  updateScanModeUI(settings.scanMode);
}


/**
 * Widget için gerekli CSS ve JS dosyalarını aktif sekmeye inject eder.
 *
 * Önemli sıralama:
 * - session-store.js önce yüklenir.
 * - research-store.js session-store üzerinden active session id okur.
 * - widget.js en sonda yüklenir ve bu store'ları kullanarak baloncuğu başlatır.
 */
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
      "core/session-store.js",
      "core/scan-settings-store.js",
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


/**
 * Aktif sekmede Adaptive RAG baloncuğunun açık olup olmadığını kontrol eder.
 *
 * Popup açıldığında switch'in doğru konumda görünmesini sağlar.
 */
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


/**
 * Baloncuk switch'i değiştiğinde çalışır.
 *
 * Switch açılırsa:
 * - Widget dosyaları aktif sekmeye inject edilir.
 * - Sağ alttaki launcher baloncuğu gösterilir.
 *
 * Switch kapanırsa:
 * - hideAdaptiveRagBubble() çağrılır.
 * - Launcher, widget paneli, aktif session ve research verileri temizlenir.
 */
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
        func: async () => {
          if (window.showAdaptiveRagBubble) {
            return await window.showAdaptiveRagBubble();
          }

          console.error("showAdaptiveRagBubble bulunamadı.");
          return false;
        }
      });

      widgetToggle.checked = Boolean(result?.result);
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: async () => {
        if (window.hideAdaptiveRagBubble) {
          return await window.hideAdaptiveRagBubble();
        }

        document.querySelector("#adaptive-rag-launcher")?.remove();
        document.querySelector("#adaptive-rag-widget")?.remove();

        return true;
      }
    });

    widgetToggle.checked = false;
  } catch (error) {
    console.error("Baloncuk kontrol hatası:", error);
    alert("Baloncuk açılamadı. Console hatasını kontrol et.");
    widgetToggle.checked = false;
  }
}


/**
 * Popup eventlerini bağlar.
 */
function bindPopupEvents() {
  widgetToggle?.addEventListener("change", toggleBubble);

  scanModeManualBtn?.addEventListener("click", () => {
    setScanMode("manual");
  });

  scanModeAutoBtn?.addEventListener("click", () => {
    setScanMode("auto");
  });
}


/**
 * Popup ilk açıldığında çalışır.
 *
 * - Baloncuk açık mı kontrol eder.
 * - Tarama modu ayarını yükler.
 * - Eventleri bağlar.
 */
async function initPopup() {
  bindPopupEvents();

  await checkBubbleStatus();
  await loadScanModeStatus();
}

initPopup();