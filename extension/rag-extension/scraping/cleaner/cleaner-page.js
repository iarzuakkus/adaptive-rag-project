function cleanPageContent(data) {
  const cleanedTitle = cleanText(data?.title || "");
  const cleanedUrl = data?.url || "";

  const cleanedStructuredContent = {
    headings: cleanArray(data?.content?.headings || [], 5),
    paragraphs: cleanArray(data?.content?.paragraphs || [], 20),
    lists: cleanArray(data?.content?.lists || [], 3)
  };

  const previewText = buildCombinedPreview(cleanedStructuredContent);
  const structuredContent = buildStructuredContent(cleanedStructuredContent);
  const cleanedBlocks = cleanBlocks(data?.blocks || []);

  return {
    title: cleanedTitle,
    url: cleanedUrl,
    content: cleanedStructuredContent,
    preview: previewText,
    structuredContent,
    blocks: cleanedBlocks
  };
}