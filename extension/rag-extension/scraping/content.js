console.log("[CONTENT] Script yüklendi.");

function removeNoise(root) {
  try {
    root
      .querySelectorAll("nav, header, footer, aside, script, style, noscript")
      .forEach((el) => el.remove());
  } catch (error) {
    console.error("[CONTENT] removeNoise hatası:", error);
  }
}

function removeEmptyAndHiddenElements(root) {
  try {
    root.querySelectorAll("*").forEach((el) => {
      const text = (el.innerText || "").trim();

      const isHidden =
        el.hidden ||
        el.getAttribute("aria-hidden") === "true" ||
        el.style?.display === "none" ||
        el.style?.visibility === "hidden";

      const isLeaf = el.children.length === 0;
      const isEmpty = text.length === 0;

      if (isHidden || (isEmpty && isLeaf)) {
        el.remove();
      }
    });
  } catch (error) {
    console.error("[CONTENT] removeEmptyAndHiddenElements hatası:", error);
  }
}

function removeUiLikeElements(root) {
  try {
    const keywords = [
      "cookie",
      "popup",
      "login",
      "sign in",
      "sign up",
      "banner",
      "modal"
    ];

    root.querySelectorAll("*").forEach((el) => {
      const text = (el.innerText || "").toLowerCase();
      const className =
        typeof el.className === "string" ? el.className.toLowerCase() : "";
      const id = (el.id || "").toLowerCase();

      const combined = `${text} ${className} ${id}`;
      const hasKeyword = keywords.some((keyword) => combined.includes(keyword));
      const isSmallUiBlock = text.length > 0 && text.length < 200;

      if (hasKeyword && isSmallUiBlock) {
        el.remove();
      }
    });
  } catch (error) {
    console.error("[CONTENT] removeUiLikeElements hatası:", error);
  }
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getOwnTextLength(el) {
  try {
    let ownText = "";

    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        ownText += ` ${node.textContent || ""}`;
      }
    });

    return normalizeText(ownText).length;
  } catch (error) {
    console.error("[CONTENT] getOwnTextLength hatası:", error);
    return 0;
  }
}

function calculateLinkDensity(el) {
  try {
    const text = normalizeText(el.innerText || "");
    const textLength = text.length;

    if (textLength === 0) {
      return 0;
    }

    const links = Array.from(el.querySelectorAll("a"));
    const linkTextLength = links.reduce((total, link) => {
      return total + normalizeText(link.innerText || "").length;
    }, 0);

    return Number((linkTextLength / textLength).toFixed(3));
  } catch (error) {
    console.error("[CONTENT] calculateLinkDensity hatası:", error);
    return 0;
  }
}

function isLikelyContentBlock(el) {
  const tag = (el.tagName || "").toLowerCase();
  const text = normalizeText(el.innerText || "");
  const textLength = text.length;
  const childCount = el.children.length;
  const ownTextLength = getOwnTextLength(el);

  if (textLength < 40) {
    return false;
  }

  if (
    ["script", "style", "noscript", "nav", "header", "footer", "aside"].includes(tag)
  ) {
    return false;
  }

  const classIdText = `${el.className || ""} ${el.id || ""}`.toLowerCase();
  const badKeywords = [
    "menu",
    "nav",
    "footer",
    "header",
    "sidebar",
    "cookie",
    "popup",
    "modal",
    "banner",
    "advert",
    "ads"
  ];

  if (
    badKeywords.some((keyword) => classIdText.includes(keyword)) &&
    textLength < 300
  ) {
    return false;
  }

  if ((tag === "td" || tag === "div" || tag === "section") && textLength > 1200 && childCount > 8) {
    return false;
  }

  if (childCount > 10 && ownTextLength < 20 && textLength > 300) {
    return false;
  }

  if (childCount === 0 && textLength >= 40) {
    return true;
  }

  if (ownTextLength >= 30) {
    return true;
  }

  if (
    [
      "p",
      "li",
      "article",
      "section",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "td",
      "th"
    ].includes(tag)
  ) {
    return true;
  }

  return false;
}

function isDuplicateOfParent(el) {
  try {
    const parent = el.parentElement;
    if (!parent) {
      return false;
    }

    const currentText = normalizeText(el.innerText || "");
    const parentText = normalizeText(parent.innerText || "");

    if (!currentText || !parentText) {
      return false;
    }

    if (currentText === parentText) {
      return true;
    }

    const ratio = currentText.length / parentText.length;

    if (ratio > 0.95) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("[CONTENT] isDuplicateOfParent hatası:", error);
    return false;
  }
}
function splitLargeBlockElement(el) {
  const subBlocks = [];
  const seen = new Set();

  const childSelectors = "h1, h2, h3, h4, h5, h6, p, li, td > div, div, span";

  try {
    el.querySelectorAll(childSelectors).forEach((child) => {
      const text = normalizeText(child.innerText || "");

      if (text.length < 40) {
        return;
      }

      const childTextLength = text.length;
      const childLinkDensity = calculateLinkDensity(child);

      if (childLinkDensity > 0.7) {
        return;
      }

      const key = text.slice(0, 300);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      subBlocks.push({
        text,
        tag: (child.tagName || "").toLowerCase(),
        className: typeof child.className === "string" ? child.className : "",
        id: child.id || "",
        textLength: childTextLength,
        linkDensity: childLinkDensity,
        childCount: child.children.length,
        ownTextLength: getOwnTextLength(child)
      });
    });
  } catch (error) {
    console.error("[CONTENT] splitLargeBlockElement hatası:", error);
  }

  return subBlocks;
}

function extractBlocks(root) {
  const blocks = [];
  const seen = new Set();

  const selectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "article",
    "section",
    "td",
    "th",
    "div"
  ].join(", ");

  try {
    root.querySelectorAll(selectors).forEach((el) => {
      if (!isLikelyContentBlock(el)) {
        return;
      }

      if (isDuplicateOfParent(el)) {
        return;
      }

      const text = normalizeText(el.innerText || "");

      if (text.length < 40) {
        return;
      }

      if (
        ["td", "div", "section"].includes((el.tagName || "").toLowerCase()) &&
        text.length > 700
      ) {
        const splitBlocks = splitLargeBlockElement(el);

        if (splitBlocks.length >= 2) {
          splitBlocks.forEach((block) => {
            const key = block.text.slice(0, 500);

            if (!seen.has(key)) {
              seen.add(key);
              blocks.push(block);
            }
          });

          return;
        }
      }

      const key = text.slice(0, 500);

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      blocks.push({
        text,
        tag: (el.tagName || "").toLowerCase(),
        className: typeof el.className === "string" ? el.className : "",
        id: el.id || "",
        textLength: text.length,
        linkDensity: calculateLinkDensity(el),
        childCount: el.children.length,
        ownTextLength: getOwnTextLength(el)
      });
    });
  } catch (error) {
    console.error("[CONTENT] extractBlocks hatası:", error);
  }

  return blocks;
}

function extractStructuredContent() {
  const clonedBody = document.body.cloneNode(true);

  removeNoise(clonedBody);
  removeUiLikeElements(clonedBody);
  removeEmptyAndHiddenElements(clonedBody);

  const headings = [];
  const paragraphs = [];
  const lists = [];

  clonedBody.querySelectorAll("h1, h2, h3, h4, h5, h6, th").forEach((el) => {
    const text = normalizeText(el.innerText || "");
    if (text.length > 5) {
      headings.push(text);
    }
  });

  clonedBody.querySelectorAll("p, td, div").forEach((el) => {
    const text = normalizeText(el.innerText || "");
    if (text.length > 40) {
      paragraphs.push(text);
    }
  });

  clonedBody.querySelectorAll("li").forEach((el) => {
    const text = normalizeText(el.innerText || "");
    if (text.length > 5) {
      lists.push(text);
    }
  });

  const blocks = extractBlocks(clonedBody);

  return {
    title: document.title || "",
    url: window.location.href || "",
    content: {
      headings,
      paragraphs,
      lists
    },
    blocks
  };
}

function isPdfPage() {
  const currentUrl = window.location.href.toLowerCase();
  return currentUrl.endsWith(".pdf") || currentUrl.includes(".pdf?");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[CONTENT] Mesaj alındı:", request);

  try {
    if (!request || !request.type) {
      sendResponse({
        success: false,
        message: "Geçersiz request"
      });
      return true;
    }

    if (request.type === "SCRAPE_PAGE") {
      console.log("[CONTENT] SCRAPE_PAGE başladı");

      const structuredData = extractStructuredContent();
      console.log("[CONTENT] Structured data:", structuredData);

      if (typeof cleanPageContent === "function") {
        const cleanedData = cleanPageContent(structuredData);
        console.log("[CONTENT] Cleaned data:", cleanedData);

        sendResponse({
          success: true,
          data: cleanedData
        });
      } else {
        console.warn("[CONTENT] cleanPageContent bulunamadı, mevcut veri dönülüyor.");

        sendResponse({
          success: true,
          data: structuredData
        });
      }

      return true;
    }

    if (request.type === "CHECK_PDF") {
      sendResponse({
        success: true,
        isPdf: isPdfPage(),
        url: window.location.href
      });
      return true;
    }

    sendResponse({
      success: false,
      message: "Bilinmeyen request type"
    });
    return true;
  } catch (error) {
    console.error("[CONTENT] HATA:", error);

    sendResponse({
      success: false,
      message: error.message || "Bilinmeyen content script hatası"
    });

    return true;
  }
});