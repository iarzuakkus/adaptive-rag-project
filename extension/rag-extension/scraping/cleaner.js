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
    .map(item => cleanText(item))
    .filter(item => item && item.length >= minLength);
}

function chunkText(text, chunkSize = 500) {
  if (!text) {
    return [];
  }

  const words = text.split(" ");
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

  content.headings.forEach(item => {
    chunks.push({
      type: "heading",
      content: item
    });
  });

  content.paragraphs.forEach(item => {
    chunks.push({
      type: "paragraph",
      content: item
    });
  });

  content.lists.forEach(item => {
    chunks.push({
      type: "list",
      content: item
    });
  });

  return chunks;
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

  const chunkedItems = rawStructuredChunks.flatMap(item => {
    const pieces = chunkText(item.content, 500);

    return pieces.map(piece => ({
      type: item.type,
      content: piece
    }));
  });

  return {
    title: cleanedTitle,
    url: cleanedUrl,
    content: cleanedStructuredContent,
    preview: previewText,
    chunks: chunkedItems,
    chunkCount: chunkedItems.length
  };
}