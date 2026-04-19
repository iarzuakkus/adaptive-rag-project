function isLikelyContentBlock(el) {
  const tag = (el.tagName || "").toLowerCase();
  const text = normalizeText(el.innerText || "");
  const textLength = text.length;
  const childCount = el.children.length;
  const ownTextLength = getOwnTextLength(el);

  if (textLength < 20) {
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
    textLength < 150
  ) {
    return false;
  }

  if (
    ["td", "div", "section"].includes(tag) &&
    textLength > 1200 &&
    childCount > 8
  ) {
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
    return ratio > 0.95;
  } catch (error) {
    console.error("[BLOCK_UTILS] isDuplicateOfParent hatası:", error);
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
        textLength: text.length,
        linkDensity: childLinkDensity,
        childCount: child.children.length,
        ownTextLength: getOwnTextLength(child)
      });
    });
  } catch (error) {
    console.error("[BLOCK_UTILS] splitLargeBlockElement hatası:", error);
  }

  return subBlocks;
}