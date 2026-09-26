import { test } from "node:test";
import assert from "node:assert/strict";
import { product } from "../src/product.js";

test("product multiplies", () => {
  assert.equal(product(2, 3), 6);
  assert.equal(product(-2, 4), -8);
});
