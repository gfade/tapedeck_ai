#!/bin/sh
# Verifier for t01; runs in the run's worktree. Exit 0 = pass.
set -e
node --test --test-reporter=dot
node --input-type=module -e '
import assert from "node:assert/strict";
import { sum } from "./src/sum.js";
assert.equal(sum(2, 3), 5);
assert.equal(sum(10, -4), 6);
assert.equal(sum(0.5, 0.25), 0.75);
console.log("hidden checks passed");
'
