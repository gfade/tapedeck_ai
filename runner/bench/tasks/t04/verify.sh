#!/bin/sh
# Verifier for t04; runs in the run's worktree. Exit 0 = pass.
set -e
cp test/cases.sample.json test/cases.json
node --test --test-reporter=dot
node --input-type=module -e '
import assert from "node:assert/strict";
import { slugify } from "./src/slug.js";
assert.equal(slugify("Hello, World!"), "hello-world");
assert.equal(slugify("What? No: way!"), "what-no-way");
assert.equal(slugify("  Keep-Hyphens  "), "keep-hyphens");
console.log("hidden checks passed");
'
