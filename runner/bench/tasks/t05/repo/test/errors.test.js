import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError } from "../src/errors.js";

test("fills placeholders", () => {
  assert.equal(formatError("E_NOT_FOUND", { id: 7 }), "No such item: 7");
});

test("timeout message", () => {
  assert.equal(formatError("E_TIMEOUT", { seconds: 30 }), "Request timed out after 30s");
});

test("unknown codes", () => {
  assert.equal(formatError("E_NOPE"), "Unknown error E_NOPE");
});
