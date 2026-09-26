import { test } from "node:test";
import assert from "node:assert/strict";
import { match } from "../src/router.js";

test("user routes", () => {
  assert.equal(match("GET", "/users"), "listUsers");
  assert.equal(match("POST", "/users"), "createUser");
});

test("GET /health is routed", () => {
  assert.equal(match("GET", "/health"), "health");
});

test("unknown routes do not match", () => {
  assert.equal(match("DELETE", "/users"), null);
});
