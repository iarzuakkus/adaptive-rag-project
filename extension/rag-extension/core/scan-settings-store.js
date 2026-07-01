/**
 * Dosya: scan-settings-store.js
 *
 * Görev:
 * - Sayfa tarama ayarlarını chrome.storage.local içinde saklar.
 * - Kullanıcının tarama modunu yönetir.
 * - Elle tarama / otomatik tarama seçimini tutar.
 * - Kullanıcının kapattığı sayfalarda tekrar öneri kartı göstermemek için URL bilgisini saklar.
 * - Daha önce taranan URL'leri tutarak aynı sayfanın gereksiz tekrar taranmasını engeller.
 * - Kaynak silindiğinde ilgili URL'nin tekrar taranabilmesi için scanned/dismissed kayıtlarını temizler.
 * - Oturum kapatıldığında scanned/dismissed geçmişini temizler.
 *
 * Tarama modları:
 * - manual: Sayfaya girince kullanıcıya “Bu sayfayı tara?” kartı gösterilir.
 * - auto: Uygun sayfalar kullanıcıya sorulmadan otomatik taranır.
 */

(function () {
  const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";
  const SESSION_ENABLED_KEY = "adaptive_rag_session_enabled";

  const DEFAULT_SCAN_SETTINGS = {
    scanMode: "manual",
    dismissedUrls: [],
    scannedUrls: []
  };

  let sessionWatcherBound = false;

  if (window.AdaptiveRagScanSettingsStore?.__storeName === "scan-settings-store") {
    return;
  }

  function isChromeStorageAvailable() {
    try {
      return (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.local &&
        typeof chrome.storage.local.get === "function" &&
        typeof chrome.storage.local.set === "function"
      );
    } catch {
      return false;
    }
  }

  function getChromeLastErrorMessage() {
    try {
      return chrome.runtime?.lastError?.message || "";
    } catch {
      return "";
    }
  }

  function normalizeUrl(url) {
    if (typeof url !== "string") {
      return "";
    }

    const rawUrl = url.trim();

    if (!rawUrl) {
      return "";
    }

    try {
      const parsedUrl = new URL(rawUrl, window.location.href);
      parsedUrl.hash = "";

      let normalized = parsedUrl.toString();

      if (normalized.endsWith("/") && parsedUrl.pathname !== "/") {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch {
      return rawUrl;
    }
  }

  function uniqueNormalizedUrls(urls) {
    const seen = new Set();
    const cleanUrls = [];

    if (!Array.isArray(urls)) {
      return cleanUrls;
    }

    urls.forEach((url) => {
      const normalizedUrl = normalizeUrl(url);

      if (!normalizedUrl || seen.has(normalizedUrl)) {
        return;
      }

      seen.add(normalizedUrl);
      cleanUrls.push(normalizedUrl);
    });

    return cleanUrls;
  }

  function normalizeScanSettings(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return { ...DEFAULT_SCAN_SETTINGS };
    }

    return {
      scanMode: settings.scanMode === "auto" ? "auto" : "manual",
      dismissedUrls: uniqueNormalizedUrls(settings.dismissedUrls),
      scannedUrls: uniqueNormalizedUrls(settings.scannedUrls)
    };
  }

  function removeUrlFromList(urls, targetUrl) {
    const normalizedTargetUrl = normalizeUrl(targetUrl);

    if (!normalizedTargetUrl) {
      return uniqueNormalizedUrls(urls);
    }

    return uniqueNormalizedUrls(urls).filter((url) => {
      return normalizeUrl(url) !== normalizedTargetUrl;
    });
  }

  function getFromStorage(key) {
    return new Promise((resolve) => {
      let settled = false;

      function safeResolve(value) {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      }

      try {
        if (!isChromeStorageAvailable()) {
          console.warn(
            "[SCAN SETTINGS] Chrome storage kullanılamıyor. Muhtemelen extension context yenilendi."
          );

          safeResolve(null);
          return;
        }

        const timeoutId = setTimeout(() => {
          console.warn("[SCAN SETTINGS] Storage okuma zaman aşımına uğradı:", key);
          safeResolve(null);
        }, 1200);

        chrome.storage.local.get([key], (result) => {
          clearTimeout(timeoutId);

          const lastErrorMessage = getChromeLastErrorMessage();

          if (lastErrorMessage) {
            console.warn("[SCAN SETTINGS] Storage okuma hatası:", lastErrorMessage);
            safeResolve(null);
            return;
          }

          safeResolve(result?.[key] || null);
        });
      } catch (error) {
        console.warn(
          "[SCAN SETTINGS] getFromStorage yakalanan hata:",
          error?.message || error
        );

        safeResolve(null);
      }
    });
  }

  function setToStorage(key, value) {
    return new Promise((resolve) => {
      let settled = false;

      function safeResolve(nextValue) {
        if (settled) {
          return;
        }

        settled = true;
        resolve(nextValue);
      }

      try {
        if (!isChromeStorageAvailable()) {
          console.warn(
            "[SCAN SETTINGS] Chrome storage kullanılamıyor. Yazma işlemi atlandı."
          );

          safeResolve(value);
          return;
        }

        const timeoutId = setTimeout(() => {
          console.warn("[SCAN SETTINGS] Storage yazma zaman aşımına uğradı:", key);
          safeResolve(value);
        }, 1200);

        chrome.storage.local.set(
          {
            [key]: value
          },
          () => {
            clearTimeout(timeoutId);

            const lastErrorMessage = getChromeLastErrorMessage();

            if (lastErrorMessage) {
              console.warn("[SCAN SETTINGS] Storage yazma hatası:", lastErrorMessage);
              safeResolve(value);
              return;
            }

            safeResolve(value);
          }
        );
      } catch (error) {
        console.warn(
          "[SCAN SETTINGS] setToStorage yakalanan hata:",
          error?.message || error
        );

        safeResolve(value);
      }
    });
  }

  async function getScanSettings() {
    const savedSettings = await getFromStorage(SCAN_SETTINGS_KEY);
    return normalizeScanSettings(savedSettings);
  }

  async function saveScanSettings(settings) {
    const normalizedSettings = normalizeScanSettings(settings);
    return await setToStorage(SCAN_SETTINGS_KEY, normalizedSettings);
  }

  async function getScanMode() {
    const settings = await getScanSettings();
    return settings.scanMode;
  }

  async function setScanMode(scanMode) {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      scanMode: scanMode === "auto" ? "auto" : "manual"
    };

    return await saveScanSettings(nextSettings);
  }

  async function markUrlDismissed(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
      return await getScanSettings();
    }

    const settings = await getScanSettings();

    if (!settings.dismissedUrls.includes(normalizedUrl)) {
      settings.dismissedUrls.push(normalizedUrl);
    }

    return await saveScanSettings(settings);
  }

  async function isUrlDismissed(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
      return false;
    }

    const settings = await getScanSettings();
    return settings.dismissedUrls.includes(normalizedUrl);
  }

  async function markUrlScanned(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
      return await getScanSettings();
    }

    const settings = await getScanSettings();

    if (!settings.scannedUrls.includes(normalizedUrl)) {
      settings.scannedUrls.push(normalizedUrl);
    }

    return await saveScanSettings(settings);
  }

  async function isUrlScanned(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
      return false;
    }

    const settings = await getScanSettings();
    return settings.scannedUrls.includes(normalizedUrl);
  }

  async function unmarkUrlScanned(url) {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      scannedUrls: removeUrlFromList(settings.scannedUrls, url)
    };

    return await saveScanSettings(nextSettings);
  }

  async function unmarkUrlDismissed(url) {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      dismissedUrls: removeUrlFromList(settings.dismissedUrls, url)
    };

    return await saveScanSettings(nextSettings);
  }

  async function unmarkUrl(url) {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      scannedUrls: removeUrlFromList(settings.scannedUrls, url),
      dismissedUrls: removeUrlFromList(settings.dismissedUrls, url)
    };

    return await saveScanSettings(nextSettings);
  }

  async function clearScanHistory() {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      dismissedUrls: [],
      scannedUrls: []
    };

    return await saveScanSettings(nextSettings);
  }

  async function resetScanSettings() {
    return await saveScanSettings({ ...DEFAULT_SCAN_SETTINGS });
  }

  function bindSessionWatcher() {
    try {
      if (
        sessionWatcherBound ||
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.onChanged
      ) {
        return;
      }

      sessionWatcherBound = true;

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") {
          return;
        }

        const sessionChange = changes[SESSION_ENABLED_KEY];

        if (!sessionChange) {
          return;
        }

        if (sessionChange.newValue === false) {
          clearScanHistory();
        }
      });
    } catch (error) {
      console.warn("[SCAN SETTINGS] Session watcher bağlanamadı:", error);
    }
  }

  bindSessionWatcher();

  window.AdaptiveRagScanSettingsStore = {
    __storeName: "scan-settings-store",

    getScanSettings,
    saveScanSettings,
    getScanMode,
    setScanMode,

    markUrlDismissed,
    isUrlDismissed,
    markUrlScanned,
    isUrlScanned,

    unmarkUrlScanned,
    unmarkUrlDismissed,
    unmarkUrl,

    clearScanHistory,
    resetScanSettings
  };
})();