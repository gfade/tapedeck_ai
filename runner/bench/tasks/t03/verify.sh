#!/bin/sh
# Verifier for t03; runs in the run's worktree. Exit 0 = pass.
set -e
node --test --test-reporter=dot
node --input-type=module -e '
import assert from "node:assert/strict";
import { clamp } from "./src/clamp.js";
assert.equal(clamp(11, 0, 10), 10);
assert.equal(clamp(-1, 0, 10), 0);
assert.equal(clamp(0.5, 0, 1), 0.5);
console.log("hidden checks passed");
'
