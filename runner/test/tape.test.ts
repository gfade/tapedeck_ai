/**
 * End to end with pi-tape: record → replay → fork → gate on the toy bench. Skipped, with the
 * reason, when pi-tape (pi-tape/extensions/tape.ts) is missing or cannot record.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { getTask } from "../src/bench.ts";
import { runGate } from "../src/gate.ts";
import { runVerifier } from "../src/runs.ts";
import type { Runner } from "../src/runs.ts";
import type { Store } from "../src/store.ts";
import { readTapeFromSessionFile } from "../src/tape.ts";
import type { RunRecord } from "../src/types.ts";
import { gateProblems, piTapeProblem, runProblems, tempRunner } from "./helpers.ts";

const problem = await piTapeProblem();

describe("record, replay, fork and gate with pi-tape", { skip: problem ? `pi-tape is not usable: ${problem}` : false }, () => {
	let runner: Runner;
	let store: Store;
	let cleanup: () => void;
	let baseline: RunRecord;

	before(async () => {
		({ runner, store, cleanup } = tempRunner({ tape: true }));
		baseline = await runner.run({ task: "t01", variant: "vanilla" });
	});

	after(() => { if (!process.env.KEEP) cleanup(); });

	test("a recording is a tape with snapshots and a report", () => {
		assert.equal(baseline.status, "done", baseline.error ?? "");
		assert.deepEqual(runProblems(baseline), []);
		assert.equal(baseline.pass, false);
		assert.deepEqual(baseline.steps, { total: 6, replayed: 0, live: 6 });
		assert.match(baseline.snapshotBase ?? "", /^[0-9a-f]{40}$/);
		assert.equal(baseline.reportFile, `runs/${baseline.id}/tape-report.json`);
		const tape = readTapeFromSessionFile(join(store.home, baseline.sessionFile as string));
		assert.equal(tape.steps.length, 6);
		assert.deepEqual(
			tape.steps.flatMap((s) => s.tools.map((t) => t.args.command ?? t.name)),
			["ls", "read", "edit", "npm test", "edit"],
		);
	});

	test("replaying a recording: no divergence, zero live tokens, same verdict", async () => {
		const replay = await runner.replay({ from: baseline.id, variant: "vanilla", keep: true });
		assert.equal(replay.status, "done", replay.error ?? "");
		assert.deepEqual(runProblems(replay), []);
		assert.equal(replay.kind, "replay");
		assert.equal(replay.parent, baseline.id);
		assert.equal(replay.divergence, null);
		assert.equal(replay.pass, null, "replays have no verdict of their own");
		assert.equal(replay.usage.totalTokens, 0);
		assert.deepEqual(replay.steps, { total: 6, replayed: 6, live: 0 });
		assert.equal(replay.savedUsage.totalTokens, baseline.usage.totalTokens);
		// pi-tape restores the recording's final snapshot, so the verifier sees the same workspace.
		const verdict = await runVerifier(getTask("t01"), store.workDir(replay.id));
		assert.equal(verdict.pass, baseline.pass);
	});

	test("an auto fork goes live at the first npm call and fixes the test-command trap", async () => {
		const fork = await runner.fork({ from: baseline.id, variant: "rule-taskrunner", auto: true });
		assert.equal(fork.status, "done", fork.error ?? "");
		assert.deepEqual(runProblems(fork), []);
		assert.equal(fork.forkAt, 4);
		assert.deepEqual(fork.lenient, ["system"]);
		assert.equal(fork.tapeSource, join(store.runDir(baseline.id), "session.jsonl"));
		assert.equal(fork.divergence?.kind, "forced");
		assert.equal(fork.divergence?.step, 4);
		assert.equal(fork.pass, true);
		assert.deepEqual(fork.steps, { total: 5, replayed: 3, live: 2 });
		assert.ok(fork.usage.totalTokens > 0 && fork.savedUsage.totalTokens > 0);

		// Every session pi-tape writes is a tape again: replaying the fork matches it.
		const again = await runner.replay({ from: fork.id, variant: "rule-taskrunner" });
		assert.equal(again.divergence, null);
		assert.equal(again.usage.totalTokens, 0);
	});

	test("t04: the lazy fork fails where full reruns pass (the designed disagreement)", async () => {
		const t04 = await runner.run({ task: "t04", variant: "vanilla" });
		const fork = await runner.fork({ from: t04.id, variant: "rule-taskrunner", auto: true });
		const rerun = await runner.run({ task: "t04", variant: "rule-taskrunner" });
		assert.equal(fork.forkAt, 4);
		assert.equal(fork.pass, false);
		assert.equal(rerun.pass, true);
	});

	test("an edited tape replayed with the guard is blocked at the edited step, at zero tokens", async () => {
		const tape = readTapeFromSessionFile(join(store.home, baseline.sessionFile as string), { id: baseline.id });
		const step = tape.steps[3];
		const call = step.response.content.find((b) => b.type === "toolCall");
		assert.ok(call && call.type === "toolCall");
		call.arguments = { command: "cat .env" };
		step.tools[0].args = { command: "cat .env" };
		tape.edits.push({ step: 4, toolId: call.id, field: "args", note: "npm test -> cat .env" });

		const replay = await runner.replay({ from: baseline.id, variant: "guard-secrets", tape });
		assert.equal(replay.status, "done", replay.error ?? "");
		assert.match(replay.tapeSource ?? "", /\/tapes\/.+\.json$/);
		assert.equal(replay.divergence?.kind, "tool-blocked");
		assert.equal(replay.divergence?.step, 4);
		assert.equal(replay.usage.totalTokens, 0);
	});

	test("the gate reports fork/rerun agreement and token savings", async () => {
		const report = await runGate(runner, { candidate: "rule-taskrunner", tasks: ["t01", "t04"], repeat: 1 });
		assert.deepEqual(gateProblems(report), []);
		assert.equal(report.name, "rule-taskrunner-vs-vanilla");
		assert.deepEqual(store.listReports(), [report.name]);
		const byTask = Object.fromEntries(report.rows.map((r) => [r.task, r]));
		assert.equal(byTask.t01.baselineRun, baseline.id, "reuses the latest baseline");
		assert.deepEqual([byTask.t01.forkPass, byTask.t01.rerunPass, byTask.t01.agree], [true, [true], true]);
		assert.deepEqual([byTask.t04.forkPass, byTask.t04.rerunPass, byTask.t04.agree], [false, [true], false]);
		assert.equal(report.summary.n, 2);
		assert.equal(report.summary.agreement, 0.5);
		assert.ok(report.summary.tokenSavings > 0.3, `forks should be much cheaper, saved ${report.summary.tokenSavings}`);
		assert.deepEqual(report.summary.baselinePassRate, { "held-in": 0, "held-out": 0 });
		assert.deepEqual(report.summary.candidateRerunPassRate, { "held-in": 1, "held-out": 1 });
	});
});
