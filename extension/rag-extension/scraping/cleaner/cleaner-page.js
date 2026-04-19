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