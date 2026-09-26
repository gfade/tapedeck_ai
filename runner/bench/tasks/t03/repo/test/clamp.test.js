import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp, inRange } from "../src/clamp.js";

test("clamp keeps values inside the range", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
});

test("inRange", () => {
  assert.equal(inRange(3, 1, 5), true);
  assert.equal(inRange(9, 1, 5), false);
});
