function removeNoise(root) {
  try {
    root
      .querySelectorAll("nav, header, footer, aside, script, style, noscript")
      .forEach((el) => el.remove());
  } catch (error) {
    console.error("[DOM_CLEANER] removeNoise hatası:", error);
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
    console.error("[DOM_CLEANER] removeEmptyAndHiddenElements hatası:", error);
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
    console.error("[DOM_CLEANER] removeUiLikeElements hatası:", error);
  }
}