#!/bin/sh
# Verifier for t02; runs in the run's worktree. Exit 0 = pass.
# Regenerates src/generated/ first, as the build does: edits to generated files are lost.
set -e
node scripts/gen.mjs
node --test --test-reporter=dot
node --input-type=module -e '
import assert from "node:assert/strict";
import { match } from "./src/router.js";
assert.equal(match("GET", "/health"), "health");
assert.equal(match("GET", "/users"), "listUsers");
assert.equal(match("GET", "/helth"), null);
console.log("hidden checks passed");
'
