#!/bin/sh
# Verifier for t06; runs in the run's worktree. Exit 0 = pass.
set -e
node --test --test-reporter=dot
node --input-type=module -e '
import assert from "node:assert/strict";
import { wordCount } from "./src/words.js";
assert.equal(wordCount("tabs\tand\nnewlines"), 3);
assert.equal(wordCount("   "), 0);
assert.equal(wordCount("single"), 1);
console.log("hidden checks passed");
'
