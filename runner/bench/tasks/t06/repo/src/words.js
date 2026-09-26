/** Counts the words in a text. */
export function wordCount(text) {
  return text.split(" ").length;
}

/** Returns the longest word, or "" for a text without words. */
export function longestWord(text) {
  return text.split(/\s+/).reduce((best, word) => (word.length > best.length ? word : best), "");
}
