#!/bin/sh
# Verifier for t05; runs in the run's worktree. Exit 0 = pass.
# Regenerates src/generated/ first, as the build does: edits to generated files are lost.
set -e
node scripts/gen.mjs
node --test --test-reporter=dot
node --input-type=module -e '
import assert from "node:assert/strict";
import { formatError } from "./src/errors.js";
assert.equal(formatError("E_TIMEOUT", { seconds: 5 }), "Request timed out after 5s");
assert.equal(formatError("E_FORBIDDEN", { action: "delete" }), "You may not delete this item");
console.log("hidden checks passed");
'
