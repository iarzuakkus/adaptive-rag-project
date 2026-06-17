/**
 * Dosya: popup.js
 *
 * Görev:
 * - Popup içindeki oturum aç/kapa switch'ini yönetir.
 * - Sağ alttaki baloncuğu silmez.
 * - Switch açılınca aktif sekmedeki Adaptive RAG oturumunu başlatır.
 * - Switch kapanınca aktif sekmedeki oturumu kapatır ve widget içi verileri temizletir.
 * - Tarama modunu yönetir:
 *   - manual: Kullanıcıya sorarak tarar.
 *   - auto: Uygun sayfaları otomatik tarar.
 */

const widgetToggle = document.getElementById("widgetToggle");

const scanModeManualBtn = document.getElementById("scanModeManual");
const scanModeAutoBtn = document.getElementById("scanModeAuto");
const scanModeStatus = document.getElementById("scanModeStatus");

const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";
const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";

const DEFAULT_SCAN_SETTINGS = {
  scanMode: "manual",
  dismissedUrls: [],
  scannedUrls: []
};

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function getStorageValue(key, defaultValue) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] ?? defaultValue);
    });
  });
}

async function setStorageValue(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => {
      resolve(value);
    });
  });
}

/* -------------------- Oturum Aç / Kapa -------------------- */

async function getSessionEnabled() {
  return await getStorageValue(SESSION_ENABLED_KEY, false);
}

async function setSessionEnabled(isEnabled) {
  return await setStorageValue(SESSION_ENABLED_KEY, Boolean(isEnabled));
}

async function runOnActiveTab(func) {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    return false;
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func
  });

  return Boolean(result?.result);
}

async function startSessionOnPage() {
  return await runOnActiveTab(async () => {
    if (window.startAdaptiveRagSession) {
      return await window.startAdaptiveRagSession();
    }

    console.warn("[POPUP] startAdaptiveRagSession bulunamadı.");
    return false;
  });
}

async function stopSessionOnPage() {
  return await runOnActiveTab(async () => {
    if (window.stopAdaptiveRagSession) {
      return await window.stopAdaptiveRagSession();
    }

    console.warn("[POPUP] stopAdaptiveRagSession bulunamadı.");
    return false;
  });
}

async function loadSessionStatus() {
  const isEnabled = await getSessionEnabled();

  if (widgetToggle) {
    widgetToggle.checked = isEnabled;
  }
}

async function toggleSession() {
  if (!widgetToggle) {
    return;
  }

  const shouldEnable = widgetToggle.checked;

  try {
    if (shouldEnable) {
      const started = await startSessionOnPage();

      if (!started) {
        widgetToggle.checked = false;
        await setSessionEnabled(false);
        alert("Oturum başlatılamadı. Sayfayı yenileyip tekrar dene.");
        return;
      }

      await setSessionEnabled(true);
      return;
    }

    const stopped = await stopSessionOnPage();

    if (!stopped) {
      widgetToggle.checked = true;
      alert("Oturum kapatılamadı. Sayfayı yenileyip tekrar dene.");
      return;
    }

    await setSessionEnabled(false);
  } catch (error) {
    console.error("[POPUP] Oturum kontrol hatası:", error);

    widgetToggle.checked = await getSessionEnabled();
    alert("Oturum kontrolünde hata oluştu. Console'u kontrol et.");
  }
}

/* -------------------- Tarama Modu -------------------- */

async function getScanSettings() {
  const savedSettings = await getStorageValue(SCAN_SETTINGS_KEY, null);

  if (!savedSettings || typeof savedSettings !== "object") {
    return { ...DEFAULT_SCAN_SETTINGS };
  }

  return {
    ...DEFAULT_SCAN_SETTINGS,
    ...savedSettings
  };
}

async function saveScanSettings(settings) {
  return await setStorageValue(SCAN_SETTINGS_KEY, settings);
}

async function setScanMode(scanMode) {
  const settings = await getScanSettings();

  const nextSettings = {
    ...settings,
    scanMode: scanMode === "auto" ? "auto" : "manual"
  };

  await saveScanSettings(nextSettings);
  updateScanModeUI(nextSettings.scanMode);
}

function updateScanModeUI(scanMode) {
  scanModeManualBtn?.classList.toggle("active", scanMode === "manual");
  scanModeAutoBtn?.classList.toggle("active", scanMode === "auto");

  if (!scanModeStatus) {
    return;
  }

  if (scanMode === "auto") {
    scanModeStatus.textContent = "Otomatik tarama aktif. Uygun sayfalar sormadan taranır.";
    return;
  }

  scanModeStatus.textContent = "Elle tarama aktif. Sayfaya girince tarama kartı gösterilir.";
}

async function loadScanModeStatus() {
  const settings = await getScanSettings();
  updateScanModeUI(settings.scanMode);
}

/* -------------------- Eventler -------------------- */

function bindPopupEvents() {
  widgetToggle?.addEventListener("change", toggleSession);

  scanModeManualBtn?.addEventListener("click", () => {
    setScanMode("manual");
  });

  scanModeAutoBtn?.addEventListener("click", () => {
    setScanMode("auto");
  });
}

async function initPopup() {
  bindPopupEvents();

  await loadSessionStatus();
  await loadScanModeStatus();
}

initPopup();