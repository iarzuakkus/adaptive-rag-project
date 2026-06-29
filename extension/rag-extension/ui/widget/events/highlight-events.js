(function () {
  if (window.AdaptiveRagHighlightEvents?.__moduleName === "highlight-events") {
    return;
  }

  const STYLE_ID = "memorai-page-highlight-style";
  const HIGHLIGHT_CLASS = "memorai-page-highlight";

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim()
      .toLowerCase();
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
      "th"
    ].join(",");

    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      if (!isVisibleElement(element)) {
        return false;
      }

      const text = getElementText(element);

      return text.length >= 25 && text.length <= 2500;
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
      isPrimary: chunk?.is_primary_chunk,
      chunkPreview: normalizedChunk.slice(0, 160),
      elementPreview: bestElement ? getElementText(bestElement).slice(0, 160) : ""
    });

    if (!bestElement || bestScore < 0.48) {
      return null;
    }

    return bestElement;
  }

  async function highlightChunksOnPage(chunks) {
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

  function bindHighlightEvents() {
    injectHighlightStyles();
  }

  window.addEventListener("adaptive-rag-highlight-page-chunks", async (event) => {
    const chunks = event.detail?.chunks || [];
    const highlighted = await highlightChunksOnPage(chunks);

    if (!highlighted) {
      alert("Bu cevabın alındığı bölüm mevcut sayfada bulunamadı.");
    }
  });

  window.AdaptiveRagHighlightEvents = {
    __moduleName: "highlight-events",

    bindHighlightEvents,
    highlightChunksOnPage,
    clearHighlights
  };
})();