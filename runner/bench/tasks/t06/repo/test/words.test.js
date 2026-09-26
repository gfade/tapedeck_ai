import { test } from "node:test";
import assert from "node:assert/strict";
import { longestWord, wordCount } from "../src/words.js";

test("wordCount", () => {
  assert.equal(wordCount("one two three"), 3);
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("  two   words "), 2);
});

test("longestWord", () => {
  assert.equal(longestWord("a tape deck"), "tape");
});
