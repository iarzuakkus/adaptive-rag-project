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