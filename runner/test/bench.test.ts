/**
 * Bench sanity: the toy agents behave as designed in full runs of every task x variant
 * (plain pi runs, no tapes), and the bench is laid out as the runner expects.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadTasks, loadVariants } from "../src/bench.ts";
import type { Runner } from "../src/runs.ts";
import type { Store } from "../src/store.ts";
import { readBranch } from "../src/tape.ts";
import type { RunRecord } from "../src/types.ts";
import { pool } from "../src/util.ts";
import { tempRunner } from "./helpers.ts";

/** Designed verdicts of full runs: rules fix their own quirk and change nothing else. */
const EXPECTED: Record<string, Record<string, boolean>> = {
	t01: { vanilla: false, "rule-taskrunner": true, "rule-generated": false, "guard-secrets": false },
	t02: { vanilla: false, "rule-taskrunner": false, "rule-generated": true, "guard-secrets": false },
	t03: { vanilla: true, "rule-taskrunner": true, "rule-generated": true, "guard-secrets": true },
	t04: { vanilla: false, "rule-taskrunner": true, "rule-generated": false, "guard-secrets": false },
	t05: { vanilla: false, "rule-taskrunner": false, "rule-generated": true, "guard-secrets": false },
	t06: { vanilla: true, "rule-taskrunner": true, "rule-generated": true, "guard-secrets": true },
};

let runner: Runner;
let store: Store;
let cleanup: () => void;
const runs = new Map<string, RunRecord>();

/** The tool calls of a run, in order, from its session. */
function toolCalls(run: RunRecord): { name: string; args: Record<string, unknown> }[] {
	return readBranch(join(store.home, run.sessionFile as string))
		.map((e) => e.message as { role?: string; content?: { type: string; name: string; arguments: Record<string, unknown> }[] } | undefined)
		.filter((m) => m?.role === "assistant")
		.flatMap((m) => (m?.content ?? []).filter((b) => b.type === "toolCall").map((b) => ({ name: b.name, args: b.arguments })));
}

before(async () => {
	({ runner, store, cleanup } = tempRunner({ tape: false }));
	const combos = Object.keys(EXPECTED).flatMap((task) => Object.keys(EXPECTED[task]).map((variant) => ({ task, variant })));
	const results = await pool(combos, 4, (c) => runner.run(c));
	for (const run of results) runs.set(`${run.task}/${run.variant}`, run);
});

after(() => cleanup());

test("six tasks: both quirk classes in both splits, plus a quirk-free control in each", () => {
	const tasks = loadTasks();
	assert.deepEqual(tasks.map((t) => t.id), Object.keys(EXPECTED));
	const quirks = (split: string) => tasks.filter((t) => t.split === split).map((t) => t.quirk).sort();
	assert.deepEqual(quirks("held-in"), ["generated-file", "none", "test-command"]);
	assert.deepEqual(quirks("held-out"), ["generated-file", "none", "test-command"]);
	assert.deepEqual(loadVariants().map((v) => v.name).sort(), ["guard-secrets", "rule-generated", "rule-taskrunner", "vanilla"]);
});

test("verifiers live outside the repo the agent sees", () => {
	for (const task of loadTasks()) {
		assert.ok(existsSync(join(task.dir, task.verify)), `${task.id} verifier`);
		assert.ok(!existsSync(join(task.dir, "repo", task.verify)), `${task.id} verifier leaked into repo/`);
		assert.ok(existsSync(join(task.dir, "repo", "AGENTS.md")), `${task.id} AGENTS.md`);
	}
});

test("full runs give the designed verdicts for every task x variant", () => {
	const wrong: string[] = [];
	for (const [key, run] of runs) {
		const [task, variant] = key.split("/");
		assert.equal(run.status, "done", `${key}: ${run.error}`);
		if (run.pass !== EXPECTED[task][variant]) wrong.push(`${key}: expected ${EXPECTED[task][variant]}, got ${run.pass}`);
	}
	assert.deepEqual(wrong, []);
});

test("vanilla falls into both traps: npm test (then reverts), and editing generated files", () => {
	const t01 = toolCalls(runs.get("t01/vanilla") as RunRecord);
	assert.deepEqual(t01.map((c) => c.args.command ?? c.name), ["ls", "read", "edit", "npm test", "edit"]);
	const t02 = toolCalls(runs.get("t02/vanilla") as RunRecord);
	assert.ok(t02.some((c) => c.name === "edit" && c.args.path === "src/generated/routes.js"));
});

test("rules keep the first steps unchanged, except t04 where the rule adds a setup step first", () => {
	for (const task of Object.keys(EXPECTED)) {
		const vanilla = toolCalls(runs.get(`${task}/vanilla`) as RunRecord);
		for (const variant of ["rule-taskrunner", "rule-generated"]) {
			const patched = toolCalls(runs.get(`${task}/${variant}`) as RunRecord);
			if (task === "t04" && variant === "rule-taskrunner") {
				assert.deepEqual(patched[0], { name: "bash", args: { command: "make setup" } });
			} else {
				assert.deepEqual(patched[0], vanilla[0], `${task}/${variant} step 1`);
			}
		}
	}
});

test("the rule-generated variant edits the schema and runs the generator", () => {
	const calls = toolCalls(runs.get("t05/rule-generated") as RunRecord);
	assert.ok(calls.some((c) => c.name === "edit" && c.args.path === "schema/messages.json"));
	assert.ok(calls.some((c) => c.name === "bash" && c.args.command === "node scripts/gen.mjs"));
	assert.ok(!calls.some((c) => c.name === "edit" && String(c.args.path).startsWith("src/generated/")));
});
