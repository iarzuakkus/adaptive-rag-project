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