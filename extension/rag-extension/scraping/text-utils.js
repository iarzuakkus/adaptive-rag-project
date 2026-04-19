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
    console.error("[TEXT_UTILS] getOwnTextLength hatası:", error);
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
    console.error("[TEXT_UTILS] calculateLinkDensity hatası:", error);
    return 0;
  }
}