function cleanText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function cleanPageContent(data) {
  const cleanedTitle = cleanText(data?.title || "");
  const cleanedUrl = data?.url || "";
  const cleanedContent = cleanText(data?.content || "");
  const chunks = chunkText(cleanedContent);

  return {
    title: cleanedTitle,
    url: cleanedUrl,
    content: cleanedContent,
    chunks,
    chunkCount: chunks.length
  };
}