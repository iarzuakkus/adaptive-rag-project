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

      const tag = (el.tagName || "").toLowerCase();

      if (["td", "div", "section"].includes(tag) && text.length > 700) {
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
        tag,
        className: typeof el.className === "string" ? el.className : "",
        id: el.id || "",
        textLength: text.length,
        linkDensity: calculateLinkDensity(el),
        childCount: el.children.length,
        ownTextLength: getOwnTextLength(el)
      });
    });
  } catch (error) {
    console.error("[EXTRACTOR] extractBlocks hatası:", error);
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