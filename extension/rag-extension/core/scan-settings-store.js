/**
 * Dosya: scan-settings-store.js
 *
 * Görev:
 * - Sayfa tarama ayarlarını chrome.storage.local içinde saklar.
 * - Kullanıcının tarama modunu yönetir.
 * - Elle tarama / otomatik tarama seçimini tutar.
 * - Kullanıcının kapattığı sayfalarda tekrar öneri kartı göstermemek için URL bilgisini saklar.
 * - Daha önce taranan URL'leri tutarak aynı sayfanın gereksiz tekrar taranmasını engeller.
 *
 * Tarama modları:
 * - manual: Sayfaya girince kullanıcıya “Bu sayfayı tara?” kartı gösterilir.
 * - auto: Uygun sayfalar kullanıcıya sorulmadan otomatik taranır.
 */

(function () {
  const SCAN_SETTINGS_KEY = "adaptive_rag_scan_settings";

  const DEFAULT_SCAN_SETTINGS = {
    scanMode: "manual",
    dismissedUrls: [],
    scannedUrls: []
  };

  /**
   * Aynı store tekrar inject edilirse yeniden tanımlanmasını engeller.
   */
  if (window.AdaptiveRagScanSettingsStore?.__storeName === "scan-settings-store") {
    return;
  }

  /**
   * URL değerini güvenli hale getirir.
   */
  function normalizeUrl(url) {
    if (typeof url !== "string") {
      return "";
    }

    return url.trim();
  }

  /**
   * Storage içinden gelen ayarları güvenli formata dönüştürür.
   */
  function normalizeScanSettings(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return { ...DEFAULT_SCAN_SETTINGS };
    }

    return {
      scanMode: settings.scanMode === "auto" ? "auto" : "manual",
      dismissedUrls: Array.isArray(settings.dismissedUrls)
        ? settings.dismissedUrls.filter((url) => typeof url === "string")
        : [],
      scannedUrls: Array.isArray(settings.scannedUrls)
        ? settings.scannedUrls.filter((url) => typeof url === "string")
        : []
    };
  }

  /**
   * Storage okuma işlemini Promise formatına çevirir.
   */
  function getFromStorage(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  }

  /**
   * Storage yazma işlemini Promise formatına çevirir.
   */
  function setToStorage(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [key]: value
        },
        () => resolve(value)
      );
    });
  }

  /**
   * Tarama ayarlarını storage içinden okur.
   * Kayıt yoksa varsayılan ayarları döndürür.
   */
  async function getScanSettings() {
    const savedSettings = await getFromStorage(SCAN_SETTINGS_KEY);
    return normalizeScanSettings(savedSettings);
  }

  /**
   * Güncel tarama ayarlarını storage içine kaydeder.
   */
  async function saveScanSettings(settings) {
    const normalizedSettings = normalizeScanSettings(settings);
    return await setToStorage(SCAN_SETTINGS_KEY, normalizedSettings);
  }

  /**
   * Aktif tarama modunu döndürür.
   * manual veya auto dönebilir.
   */
  async function getScanMode() {
    const settings = await getScanSettings();
    return settings.scanMode;
  }

  /**
   * Kullanıcının seçtiği tarama modunu kaydeder.
   */
  async function setScanMode(scanMode) {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      scanMode: scanMode === "auto" ? "auto" : "manual"
    };

    return await saveScanSettings(nextSettings);
  }

  /**
   * Kullanıcının tarama öneri kartını kapattığı URL'yi kaydeder.
   * Böylece aynı sayfada tekrar tekrar öneri gösterilmez.
   */
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

  /**
   * Bu URL için öneri kartının daha önce kapatılıp kapatılmadığını kontrol eder.
   */
  async function isUrlDismissed(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
      return false;
    }

    const settings = await getScanSettings();
    return settings.dismissedUrls.includes(normalizedUrl);
  }

  /**
   * Başarıyla taranan URL'yi kaydeder.
   * Otomatik modda aynı sayfanın tekrar taranmasını engellemek için kullanılır.
   */
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

  /**
   * Bu URL'nin daha önce taranıp taranmadığını kontrol eder.
   */
  async function isUrlScanned(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
      return false;
    }

    const settings = await getScanSettings();
    return settings.scannedUrls.includes(normalizedUrl);
  }

  /**
   * Dismissed ve scanned URL kayıtlarını temizler.
   * Tarama modu korunur.
   */
  async function clearScanHistory() {
    const settings = await getScanSettings();

    const nextSettings = {
      ...settings,
      dismissedUrls: [],
      scannedUrls: []
    };

    return await saveScanSettings(nextSettings);
  }

  /**
   * Tüm tarama ayarlarını varsayılan hale getirir.
   */
  async function resetScanSettings() {
    return await saveScanSettings({ ...DEFAULT_SCAN_SETTINGS });
  }

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

    clearScanHistory,
    resetScanSettings
  };
})();