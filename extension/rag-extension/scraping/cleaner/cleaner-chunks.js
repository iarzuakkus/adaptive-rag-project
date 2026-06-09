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

function buildStructuredContent(content) {
  const items = [];

  content.headings.forEach((item) => {
    items.push({
      type: "heading",
      content: item
    });
  });

  content.paragraphs.forEach((item) => {
    items.push({
      type: "paragraph",
      content: item
    });
  });

  content.lists.forEach((item) => {
    items.push({
      type: "list",
      content: item
    });
  });

  return items;
}