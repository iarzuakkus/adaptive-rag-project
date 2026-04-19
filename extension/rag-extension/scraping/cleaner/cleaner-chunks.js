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