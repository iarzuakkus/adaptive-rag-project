function calculateBlockScore(block) {
  let score = 0;

  const text = block.text || "";
  const tag = (block.tag || "").toLowerCase();
  const className = (block.className || "").toLowerCase();
  const id = (block.id || "").toLowerCase();
  const combinedMeta = `${tag} ${className} ${id}`;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sentenceCount = countMatches(text, /[.!?]+/g);
  const commaCount = countMatches(text, /,/g);

  const positiveTags = ["article", "section", "main", "p"];
  const negativeKeywords = [
    "nav",
    "menu",
    "footer",
    "sidebar",
    "cookie",
    "popup",
    "banner",
    "ads",
    "advert",
    "modal",
    "breadcrumb",
    "social",
    "share",
    "comment",
    "newsletter",
    "subscribe"
  ];

  if (text.length >= 80) {
    score += 2;
  }

  if (text.length >= 150) {
    score += 2;
  }

  if (wordCount >= 12) {
    score += 2;
  }

  if (wordCount >= 25) {
    score += 2;
  }

  if (sentenceCount >= 1) {
    score += 2;
  }

  if (sentenceCount >= 2) {
    score += 1;
  }

  if (commaCount >= 1) {
    score += 1;
  }

  if (containsMeaningfulSentence(text)) {
    score += 2;
  }

  if (positiveTags.includes(tag)) {
    score += 3;
  }

  if (tag && /^h[1-6]$/.test(tag)) {
    score += 2;
  }

  if (block.linkDensity <= 0.2) {
    score += 2;
  } else if (block.linkDensity <= 0.4) {
    score += 1;
  }

  negativeKeywords.forEach((keyword) => {
    if (combinedMeta.includes(keyword)) {
      score -= 4;
    }
  });

  if (block.linkDensity > 0.5) {
    score -= 3;
  }

  if (block.linkDensity > 0.7) {
    score -= 4;
  }

  if (text.length < 40) {
    score -= 3;
  }

  if (wordCount < 8) {
    score -= 2;
  }

  if (sentenceCount === 0 && text.length < 120) {
    score -= 2;
  }

  const shortUiPattern =
    /^(giriş|login|sign in|sign up|menu|home|anasayfa|next|prev|previous|read more|load more|subscribe|search|ara|kapat|close|accept|reject|ok)$/i;

  if (shortUiPattern.test(text)) {
    score -= 6;
  }

  return score;
}

function filterBlocksByScore(blocks, minScore = 4) {
  return blocks.filter((block) => block.score >= minScore);
}