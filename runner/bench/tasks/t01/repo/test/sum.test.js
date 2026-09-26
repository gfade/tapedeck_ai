import { test } from "node:test";
import assert from "node:assert/strict";
import { sum } from "../src/sum.js";

test("sum adds", () => {
  assert.equal(sum(2, 3), 5);
  assert.equal(sum(-1, 1), 0);
});
