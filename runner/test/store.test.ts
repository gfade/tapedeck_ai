/**
 * Store layout and record shapes: run.json and gate reports against INTERFACES.md §5.1,
 * §5.2 and §5.4, checked on the hand-made fixture store and on runs this runner writes.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { REPO_ROOT } from "../src/paths.ts";
import type { Runner } from "../src/runs.ts";
import type { Store } from "../src/store.ts";
import type { RunRecord } from "../src/types.ts";
import { readJson } from "../src/util.ts";
import { gateProblems, runProblems, tempRunner } from "./helpers.ts";

const FIXTURES = join(REPO_ROOT, "fixtures", "store");

let runner: Runner;
let store: Store;
let cleanup: () => void;
let run: RunRecord;

before(async () => {
	({ runner, store, cleanup } = tempRunner());
	run = await runner.run({ task: "t01", variant: "vanilla" });
});

after(() => cleanup());

test("the shape checker accepts the contract's fixture store", { skip: !existsSync(FIXTURES) && "no fixtures/store" }, () => {
	for (const id of readdirSync(join(FIXTURES, "runs"))) {
		assert.deepEqual(runProblems(readJson(join(FIXTURES, "runs", id, "run.json"))), [], id);
	}
	for (const file of readdirSync(join(FIXTURES, "reports"))) {
		assert.deepEqual(gateProblems(readJson(join(FIXTURES, "reports", file))), [], file);
	}
});

test("a recorded run writes the §5.1 files and a §5.2 run.json", () => {
	assert.equal(run.status, "done", run.error ?? "");
	assert.deepEqual(runProblems(run), []);
	assert.deepEqual(runProblems(readJson(join(store.runDir(run.id), "run.json"))), []);
	assert.match(run.id, /^\d{8}-\d{6}-t01-vanilla-run-[0-9a-f]{4}$/);
	assert.equal(run.kind, "run");
	assert.equal(run.pass, false);
	assert.equal(run.repo, "repos/t01.git");
	assert.equal(run.sessionFile, `runs/${run.id}/session.jsonl`);
	for (const file of ["run.json", "session.jsonl", "events.jsonl", "stderr.log", "verify.json", "agent"]) {
		assert.ok(existsSync(join(store.runDir(run.id), file)), file);
	}
	assert.deepEqual(readJson(join(store.runDir(run.id), "verify.json")), run.verify);
	assert.equal(run.steps.total, run.steps.live + run.steps.replayed);
	assert.ok(run.usage.totalTokens > 0);
	assert.ok(existsSync(store.repoDir("t01")), "bare task repo");
	assert.ok(!existsSync(store.workDir(run.id)), "worktree removed after the run");
});

test("--keep keeps the worktree at the task base", async () => {
	const kept = await runner.run({ task: "t03", variant: "vanilla", keep: true });
	assert.equal(kept.pass, true);
	assert.ok(existsSync(join(store.workDir(kept.id), "src", "clamp.js")));
});

test("listRuns is newest first and filters by task, variant and kind", async () => {
	const later = await runner.run({ task: "t06", variant: "vanilla" });
	const all = store.listRuns();
	assert.equal(all[0].id, later.id);
	assert.ok(all.every((r, i) => i === 0 || all[i - 1].startedAt >= r.startedAt));
	assert.deepEqual(store.listRuns({ task: "t01" }).map((r) => r.id), [run.id]);
	assert.equal(store.listRuns({ variant: "rule-generated" }).length, 0);
	assert.ok(store.listRuns({ kind: "run" }).length >= 3);
});

test("a run left running by a dead runner process is marked as an error", () => {
	const id = store.newRunId("t02", "vanilla", "run");
	store.writeRun({ ...run, id, task: "t02", status: "running", finishedAt: null, durationMs: null, pass: null, verify: null });
	writeFileSync(join(store.runDir(id), "runner.pid"), "999999999\n");
	assert.deepEqual(runner.recoverStaleRuns(), [id]);
	const recovered = store.getRun(id);
	assert.equal(recovered.status, "error");
	assert.match(recovered.error ?? "", /runner process stopped/);
	assert.deepEqual(runProblems(recovered), []);
	assert.deepEqual(runner.recoverStaleRuns(), [], "only once");
});
