function cleanText(text) {
  if (!text) {
    return "";
  }

  return String(text)
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanArray(items = [], minLength = 1) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => cleanText(item))
    .filter((item) => item && item.length >= minLength);
}

function chunkText(text, chunkSize = 500) {
  if (!text) {
    return [];
  }

  const words = cleanText(text).split(" ");
  const chunks = [];
  let currentChunk = "";

  for (const word of words) {
    const candidate = currentChunk ? `${currentChunk} ${word}` : word;

    if (candidate.length > chunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = word;
    } else {
      currentChunk = candidate;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function buildCombinedPreview(content) {
  const previewParts = [];

  if (content.headings.length) {
    previewParts.push(...content.headings.slice(0, 3));
  }

  if (content.paragraphs.length) {
    previewParts.push(...content.paragraphs.slice(0, 3));
  }

  if (content.lists.length) {
    previewParts.push(...content.lists.slice(0, 3));
  }

  return previewParts.join("\n\n");
}

function buildStructuredChunks(content) {
  const chunks = [];

  content.headings.forEach((item) => {
    chunks.push({
      type: "heading",
      content: item
    });
  });

  content.paragraphs.forEach((item) => {
    chunks.push({
      type: "paragraph",
      content: item
    });
  });

  content.lists.forEach((item) => {
    chunks.push({
      type: "list",
      content: item
    });
  });

  return chunks;
}

function countMatches(text, regex) {
  if (!text) {
    return 0;
  }

  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function containsMeaningfulSentence(text) {
  if (!text) {
    return false;
  }

  const sentenceLikePattern = /[A-ZÇĞİÖŞÜa-zçğıöşü0-9][^.!?]{20,}[.!?]/;
  return sentenceLikePattern.test(text);
}

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

function cleanBlocks(blocks = []) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const seen = new Set();

  const normalizedBlocks = blocks
    .map((block) => {
      const cleanedText = cleanText(block?.text || "");

      return {
        text: cleanedText,
        tag: cleanText(block?.tag || "").toLowerCase(),
        className: cleanText(block?.className || ""),
        id: cleanText(block?.id || ""),
        textLength: cleanedText.length,
        linkDensity: Number(block?.linkDensity || 0)
      };
    })
    .filter((block) => {
      if (!block.text || block.text.length < 20) {
        return false;
      }

      const uniqueKey = `${block.tag}::${block.text}`;

      if (seen.has(uniqueKey)) {
        return false;
      }

      seen.add(uniqueKey);
      return true;
    });

  const scoredBlocks = normalizedBlocks.map((block) => {
    const score = calculateBlockScore(block);

    return {
      ...block,
      score
    };
  });

  return filterBlocksByScore(scoredBlocks, 4);
}

function buildBlockChunks(blocks, chunkSize = 500) {
  const result = [];

  blocks.forEach((block) => {
    const pieces = chunkText(block.text, chunkSize);

    pieces.forEach((piece, index) => {
      result.push({
        type: "block",
        content: piece,
        tag: block.tag,
        className: block.className,
        id: block.id,
        textLength: piece.length,
        linkDensity: block.linkDensity,
        sourceTextLength: block.textLength,
        chunkIndex: index,
        score: block.score
      });
    });
  });

  return result;
}

function cleanPageContent(data) {
  const cleanedTitle = cleanText(data?.title || "");
  const cleanedUrl = data?.url || "";

  const cleanedStructuredContent = {
    headings: cleanArray(data?.content?.headings || [], 5),
    paragraphs: cleanArray(data?.content?.paragraphs || [], 20),
    lists: cleanArray(data?.content?.lists || [], 3)
  };

  const previewText = buildCombinedPreview(cleanedStructuredContent);
  const rawStructuredChunks = buildStructuredChunks(cleanedStructuredContent);

  const structuredChunks = rawStructuredChunks.flatMap((item) => {
    const pieces = chunkText(item.content, 500);

    return pieces.map((piece) => ({
      type: item.type,
      content: piece
    }));
  });

  const cleanedBlocks = cleanBlocks(data?.blocks || []);
  const blockChunks = buildBlockChunks(cleanedBlocks, 500);

  return {
    title: cleanedTitle,
    url: cleanedUrl,
    content: cleanedStructuredContent,
    preview: previewText,
    chunks: structuredChunks,
    chunkCount: structuredChunks.length,
    blocks: cleanedBlocks,
    blockChunks,
    blockChunkCount: blockChunks.length
  };
}