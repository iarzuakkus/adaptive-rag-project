/**
 * Dosya: page-scan-rules.js
 *
 * Görev:
 * - Mevcut sayfanın taranabilir olup olmadığını kontrol eder.
 * - Google Search gibi gereksiz arama sonuçlarını engeller.
 * - chrome://, about:, file:// gibi özel sayfaların taranmasını engeller.
 * - Çok kısa veya içeriksiz sayfaları tarama dışı bırakır.
 *
 * Amaç:
 * - RAG hafızasına gereksiz, kalitesiz veya tekrar eden içeriklerin girmesini önlemek.
 */

(function () {
  const MIN_PAGE_TEXT_LENGTH = 300;

  /**
   * Sadece http ve https sayfalarının taranmasına izin verir.
   */
  function isSupportedProtocol(url) {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  /**
   * Google arama sonuçları gibi sayfaları tespit eder.
   * Bu sayfalar genellikle bilgi kaynağı değil, yönlendirme sayfasıdır.
   */
  function isGoogleSearchPage(url) {
    const hostname = url.hostname.toLowerCase();

    const isGoogleDomain =
      hostname === "google.com" ||
      hostname.endsWith(".google.com") ||
      hostname.includes("google.");

    return isGoogleDomain && url.pathname === "/search";
  }

  /**
   * Genel arama sonuçları sayfalarını yakalamak için ek kontrol.
   * Şimdilik ana hedef Google Search olduğu için sıkı tutuldu.
   */
  function isSearchResultsPage(url) {
    if (isGoogleSearchPage(url)) {
      return true;
    }

    return false;
  }

  /**
   * Sayfanın yeterli metin içerip içermediğini kontrol eder.
   * Çok kısa sayfalar RAG için zayıf bağlam üretir.
   */
  function hasEnoughReadableText() {
    const bodyText = document.body?.innerText?.trim() || "";
    return bodyText.length >= MIN_PAGE_TEXT_LENGTH;
  }

  /**
   * Mevcut sayfanın taranabilir olup olmadığını ana kontrol olarak döndürür.
   */
  function canScanCurrentPage() {
    const currentUrl = new URL(window.location.href);

    if (!isSupportedProtocol(currentUrl)) {
      return {
        allowed: false,
        reason: "Desteklenmeyen sayfa türü"
      };
    }

    if (isSearchResultsPage(currentUrl)) {
      return {
        allowed: false,
        reason: "Arama sonuçları sayfası taranmaz"
      };
    }

    if (!document.body) {
      return {
        allowed: false,
        reason: "Sayfa gövdesi bulunamadı"
      };
    }

    if (!hasEnoughReadableText()) {
      return {
        allowed: false,
        reason: "Sayfada yeterli okunabilir metin yok"
      };
    }

    return {
      allowed: true,
      reason: "Sayfa taramaya uygun"
    };
  }

  window.AdaptiveRagPageScanRules = {
    canScanCurrentPage,
    isSearchResultsPage,
    isGoogleSearchPage
  };
})();