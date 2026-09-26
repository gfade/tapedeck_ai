import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { slugify } from "../src/slug.js";

// test/cases.json is written by `make setup`.
const casesFile = new URL("./cases.json", import.meta.url);

if (!existsSync(casesFile)) {
  test("test cases are set up", () => {
    assert.fail("test/cases.json is missing: run `make setup` first");
  });
} else {
  for (const [title, slug] of JSON.parse(readFileSync(casesFile, "utf8"))) {
    test(`slugify(${JSON.stringify(title)})`, () => {
      assert.equal(slugify(title), slug);
    });
  }
}
