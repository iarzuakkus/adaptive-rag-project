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