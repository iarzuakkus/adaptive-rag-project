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

function cleanBlocks(blocks = []) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const seen = new Set();

  return blocks
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

      if (block.linkDensity > 0.7) {
        return false;
      }

      const uniqueKey = `${block.tag}::${block.text}`;

      if (seen.has(uniqueKey)) {
        return false;
      }

      seen.add(uniqueKey);
      return true;
    });
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
        chunkIndex: index
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