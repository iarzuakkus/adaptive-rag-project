(function () {
  if (window.AdaptiveRagHighlightEvents?.__moduleName === "highlight-events") {
    return;
  }

  const STYLE_ID = "memorai-page-highlight-style";
  const HIGHLIGHT_CLASS = "memorai-page-highlight";
  const PENDING_HIGHLIGHT_KEY = "adaptive_rag_pending_highlight";
  const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

  let pendingHighlightTimerList = [];
  let pendingHighlightRunning = false;

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim()
      .toLowerCase();
  }

  function normalizeUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      parsedUrl.hash = "";

      let normalized = parsedUrl.toString();

      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch {
      return "";
    }
  }

  function isSafeNavigableUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);

      return ["http:", "https:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  }

  function isSamePageUrl(targetUrl) {
    const current = normalizeUrl(window.location.href);
    const target = normalizeUrl(targetUrl);

    return Boolean(current && target && current === target);
  }

  function injectHighlightStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 2px solid rgba(255, 82, 175, 0.95) !important;
        background: rgba(255, 82, 175, 0.16) !important;
        box-shadow:
          0 0 0 4px rgba(255, 82, 175, 0.18),
          0 0 28px rgba(255, 82, 175, 0.36) !important;
        border-radius: 8px !important;
        transition: all 180ms ease !important;
        scroll-margin-top: 120px !important;
      }
    `;

    document.head.appendChild(style);
  }

  function clearHighlights() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((element) => {
      element.classList.remove(HIGHLIGHT_CLASS);
    });
  }

  function isInsideWidget(element) {
    return Boolean(
      element.closest(".rag-widget") ||
      element.closest("#adaptive-rag-widget") ||
      element.closest("#adaptive-rag-scan-prompt") ||
      element.closest(".adaptive-rag-widget") ||
      element.closest(".memorai-widget")
    );
  }

  function isVisibleElement(element) {
    if (!element || isInsideWidget(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 20 &&
      rect.height > 10 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  }

  function getElementText(element) {
    return normalizeText(element.innerText || element.textContent || "");
  }

  function getChunkText(chunk) {
    if (!chunk) {
      return "";
    }

    if (typeof chunk === "string") {
      return chunk;
    }

    return (
      chunk.text ||
      chunk.content ||
      chunk.chunk_text ||
      chunk.chunkText ||
      ""
    );
  }

  function getChunkSelector(chunk) {
    if (!chunk || typeof chunk !== "object") {
      return "";
    }

    const metadata = chunk.metadata || {};

    return (
      chunk.selector ||
      chunk.css_selector ||
      chunk.dom_selector ||
      chunk.source_selector ||
      metadata.selector ||
      metadata.css_selector ||
      metadata.dom_selector ||
      metadata.source_selector ||
      ""
    );
  }

  function getChunkTargetUrl(chunk) {
    if (!chunk || typeof chunk !== "object") {
      return "";
    }

    const metadata = chunk.metadata || {};

    return (
      chunk.page_url ||
      chunk.pageUrl ||
      chunk.source_url ||
      chunk.sourceUrl ||
      chunk.url ||
      metadata.page_url ||
      metadata.pageUrl ||
      metadata.source_url ||
      metadata.sourceUrl ||
      metadata.url ||
      ""
    );
  }

  function getTargetUrlFromLastChatResult() {
    const result = window.AdaptiveRagLastChatResult;

    if (!result) {
      return "";
    }

    const chunks = Array.isArray(result.chunks) ? result.chunks : [];
    const primaryChunk = getPrimaryChunk(chunks);
    const chunkUrl = getChunkTargetUrl(primaryChunk);

    if (chunkUrl) {
      return chunkUrl;
    }

    const sources = Array.isArray(result.sources) ? result.sources : [];
    const firstSource = sources[0];

    return (
      firstSource?.url ||
      firstSource?.page_url ||
      firstSource?.source_url ||
      ""
    );
  }

  function resolveTargetUrl(primaryChunk) {
    return getChunkTargetUrl(primaryChunk) || getTargetUrlFromLastChatResult();
  }

  function getPrimaryChunk(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return null;
    }

    return (
      chunks.find((chunk) => {
        return (
          chunk &&
          typeof chunk === "object" &&
          (
            chunk.is_primary_chunk === true ||
            chunk.used_by_answer === true
          )
        );
      }) || chunks[0]
    );
  }

  function getCandidateBlocks() {
    const selector = [
      "p",
      "li",
      "blockquote",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "td",
      "th",
      "article",
      "section"
    ].join(",");

    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      if (!isVisibleElement(element)) {
        return false;
      }

      const text = getElementText(element);

      return text.length >= 25 && text.length <= 5000;
    });
  }

  function getUsefulWords(text) {
    const stopWords = new Set([
      "ve",
      "veya",
      "ile",
      "için",
      "icin",
      "bir",
      "bu",
      "şu",
      "su",
      "da",
      "de",
      "ki",
      "mi",
      "ne",
      "olan",
      "olarak",
      "gibi",
      "daha",
      "çok",
      "cok",
      "the",
      "and",
      "for",
      "with",
      "this",
      "that",
      "from",
      "are",
      "was",
      "were"
    ]);

    return normalizeText(text)
      .split(" ")
      .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((word) => word.length > 3 && !stopWords.has(word));
  }

  function scoreElement(elementText, chunkText) {
    const element = normalizeText(elementText);
    const chunk = normalizeText(chunkText);

    if (!element || !chunk) {
      return 0;
    }

    if (element === chunk) {
      return 1;
    }

    if (element.includes(chunk) && chunk.length > 80) {
      return 0.98;
    }

    if (chunk.includes(element) && element.length > 80) {
      return 0.9;
    }

    const chunkStart = chunk.slice(0, 180);

    if (chunkStart.length > 80 && element.includes(chunkStart)) {
      return 0.95;
    }

    const chunkWords = Array.from(new Set(getUsefulWords(chunk))).slice(0, 100);

    if (!chunkWords.length) {
      return 0;
    }

    let matched = 0;

    chunkWords.forEach((word) => {
      if (element.includes(word)) {
        matched += 1;
      }
    });

    return matched / chunkWords.length;
  }

  function findElementBySelector(chunk) {
    const selector = getChunkSelector(chunk);

    if (!selector) {
      return null;
    }

    try {
      const element = document.querySelector(selector);

      if (!element || !isVisibleElement(element)) {
        return null;
      }

      return element;
    } catch (error) {
      console.warn("[HIGHLIGHT EVENTS] Geçersiz selector:", selector, error);
      return null;
    }
  }

  function findBestElementForChunk(chunk) {
    const selectorElement = findElementBySelector(chunk);

    if (selectorElement) {
      return selectorElement;
    }

    const chunkText = getChunkText(chunk);
    const normalizedChunk = normalizeText(chunkText);

    if (!normalizedChunk || normalizedChunk.length < 20) {
      return null;
    }

    let bestElement = null;
    let bestScore = 0;

    getCandidateBlocks().forEach((element) => {
      const score = scoreElement(getElementText(element), normalizedChunk);

      if (score > bestScore) {
        bestScore = score;
        bestElement = element;
      }
    });

    console.log("[HIGHLIGHT EVENTS] Highlight eşleşme skoru:", {
      score: bestScore,
      chunkId: chunk?.chunk_id,
      sourceUrl: getChunkTargetUrl(chunk),
      isPrimary: chunk?.is_primary_chunk,
      chunkPreview: normalizedChunk.slice(0, 160),
      elementPreview: bestElement ? getElementText(bestElement).slice(0, 160) : ""
    });

    if (!bestElement || bestScore < 0.48) {
      return null;
    }

    return bestElement;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(null);
          return;
        }

        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime?.lastError) {
            console.warn("[HIGHLIGHT EVENTS] Storage okuma hatası:", chrome.runtime.lastError);
            resolve(null);
            return;
          }

          resolve(result?.[key] || null);
        });
      } catch (error) {
        console.warn("[HIGHLIGHT EVENTS] Storage okuma exception:", error);
        resolve(null);
      }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(false);
          return;
        }

        chrome.storage.local.set(
          {
            [key]: value
          },
          () => {
            if (chrome.runtime?.lastError) {
              console.warn("[HIGHLIGHT EVENTS] Storage yazma hatası:", chrome.runtime.lastError);
              resolve(false);
              return;
            }

            resolve(true);
          }
        );
      } catch (error) {
        console.warn("[HIGHLIGHT EVENTS] Storage yazma exception:", error);
        resolve(false);
      }
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(false);
          return;
        }

        chrome.storage.local.remove([key], () => {
          if (chrome.runtime?.lastError) {
            console.warn("[HIGHLIGHT EVENTS] Storage silme hatası:", chrome.runtime.lastError);
            resolve(false);
            return;
          }

          resolve(true);
        });
      } catch (error) {
        console.warn("[HIGHLIGHT EVENTS] Storage silme exception:", error);
        resolve(false);
      }
    });
  }

  async function savePendingHighlight(chunks, targetUrl) {
    if (!Array.isArray(chunks) || !chunks.length || !targetUrl) {
      return false;
    }

    return await storageSet(PENDING_HIGHLIGHT_KEY, {
      chunks,
      targetUrl,
      createdAt: Date.now()
    });
  }

  async function clearPendingHighlight() {
    return await storageRemove(PENDING_HIGHLIGHT_KEY);
  }

  async function getPendingHighlight() {
    const pending = await storageGet(PENDING_HIGHLIGHT_KEY);

    if (!pending) {
      return null;
    }

    const createdAt = Number(pending.createdAt || 0);
    const isExpired = !createdAt || Date.now() - createdAt > PENDING_MAX_AGE_MS;

    if (isExpired) {
      await clearPendingHighlight();
      return null;
    }

    return pending;
  }

  async function navigateToSourceAndHighlightLater(chunks, targetUrl) {
    if (!targetUrl || !isSafeNavigableUrl(targetUrl)) {
      return false;
    }

    const saved = await savePendingHighlight(chunks, targetUrl);

    if (!saved) {
      console.warn("[HIGHLIGHT EVENTS] Pending highlight kaydedilemedi.");
      return false;
    }

    console.log("[HIGHLIGHT EVENTS] Kaynak sayfaya yönlendiriliyor:", targetUrl);

    window.location.href = targetUrl;

    return true;
  }

  async function highlightChunksOnCurrentPage(chunks) {
    injectHighlightStyles();
    clearHighlights();

    const primaryChunk = getPrimaryChunk(chunks);

    if (!primaryChunk) {
      console.warn("[HIGHLIGHT EVENTS] Highlight için primary chunk bulunamadı.");
      return false;
    }

    const targetElement = findBestElementForChunk(primaryChunk);

    if (!targetElement) {
      console.warn("[HIGHLIGHT EVENTS] Primary chunk sayfada bulunamadı.");
      return false;
    }

    targetElement.classList.add(HIGHLIGHT_CLASS);

    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    return true;
  }

  async function highlightChunksOnPage(chunks) {
    const safeChunks = Array.isArray(chunks) ? chunks : [];
    const primaryChunk = getPrimaryChunk(safeChunks);

    if (!primaryChunk) {
      console.warn("[HIGHLIGHT EVENTS] Highlight için primary chunk bulunamadı.");
      return false;
    }

    const targetUrl = resolveTargetUrl(primaryChunk);

    if (targetUrl && !isSamePageUrl(targetUrl)) {
      return await navigateToSourceAndHighlightLater(safeChunks, targetUrl);
    }

    return await highlightChunksOnCurrentPage(safeChunks);
  }

  function clearPendingHighlightTimers() {
    pendingHighlightTimerList.forEach((timerId) => {
      clearTimeout(timerId);
    });

    pendingHighlightTimerList = [];
  }

  function schedulePendingHighlightCheck(reason = "unknown") {
    clearPendingHighlightTimers();

    const delays = [250, 800, 1500, 2500, 4000];

    delays.forEach((delay) => {
      const timerId = setTimeout(async () => {
        await runPendingHighlightCheck(reason);
      }, delay);

      pendingHighlightTimerList.push(timerId);
    });
  }

  async function runPendingHighlightCheck(reason = "unknown") {
    if (pendingHighlightRunning) {
      return;
    }

    pendingHighlightRunning = true;

    try {
      const pending = await getPendingHighlight();

      if (!pending) {
        return;
      }

      const targetUrl = pending.targetUrl || "";

      if (targetUrl && !isSamePageUrl(targetUrl)) {
        return;
      }

      const chunks = Array.isArray(pending.chunks) ? pending.chunks : [];

      if (!chunks.length) {
        await clearPendingHighlight();
        return;
      }

      console.log("[HIGHLIGHT EVENTS] Pending highlight deneniyor:", {
        reason,
        currentUrl: window.location.href,
        targetUrl,
        chunkCount: chunks.length
      });

      const highlighted = await highlightChunksOnCurrentPage(chunks);

      if (highlighted) {
        await clearPendingHighlight();
        clearPendingHighlightTimers();
      }
    } finally {
      pendingHighlightRunning = false;
    }
  }

  function bindHighlightEvents() {
    injectHighlightStyles();
    schedulePendingHighlightCheck("bind");
  }

  window.addEventListener("adaptive-rag-highlight-page-chunks", async (event) => {
    const chunks = event.detail?.chunks || [];
    const highlighted = await highlightChunksOnPage(chunks);

    if (!highlighted) {
      alert("Bu cevabın alındığı bölüm mevcut sayfada bulunamadı.");
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      schedulePendingHighlightCheck("dom-content-loaded");
    });
  } else {
    schedulePendingHighlightCheck("script-loaded");
  }

  window.addEventListener("load", () => {
    schedulePendingHighlightCheck("window-load");
  });

  window.AdaptiveRagHighlightEvents = {
    __moduleName: "highlight-events",

    bindHighlightEvents,
    highlightChunksOnPage,
    clearHighlights,
    clearPendingHighlight
  };
})();