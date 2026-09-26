/**
 * Fork mode against the real pi CLI: replay up to the divergence, restore the workspace from
 * the tape's snapshot, then continue live on the (scripted) model.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import type { TapeStepData } from "../src/types.ts";
import { addWorktree, divergencesOf, git, headerOf, makeRepo, messagesOf, type PiRun, runPi, Scratch, stepsOf, testExtension, textOf } from "./helpers.ts";

const scratch = new Scratch();
after(() => scratch.cleanup());

let repo = "";
let base = "";
let recorded: PiRun;
let recordedSteps: TapeStepData[];

before(async () => {
	repo = scratch.next("repo");
	base = makeRepo(repo, { "README.md": "# demo\n" });
	recorded = await runPi({ cwd: repo, scratch, env: { PI_TAPE_UPSTREAM: "scripted/toy" } });
	assert.equal(recorded.code, 0, recorded.stderr);
	recordedSteps = stepsOf(recorded);
});

async function fork(options: { extensions?: string[]; env?: Record<string, string>; args?: string[] }) {
	const cwd = addWorktree(repo, scratch.next("wt"), base);
	const run = await runPi({
		cwd,
		scratch,
		extensions: options.extensions,
		args: options.args,
		env: { PI_TAPE_MODE: "fork", PI_TAPE_SOURCE: recorded.sessionFile, PI_TAPE_UPSTREAM: "scripted/toy", ...options.env },
	});
	assert.equal(run.code, 0, run.stderr);
	return { run, cwd };
}

describe("fork", { concurrency: true }, () => {
	test("PI_TAPE_FORK_AT replays the steps before it, restores the workspace, then runs live", async () => {
		const { run, cwd } = await fork({
			args: ["--append-system-prompt", "RULE-X: write fixed.txt when you are done."],
			env: { PI_TAPE_FORK_AT: "3", PI_TAPE_LENIENT: "system", PI_TAPE_LABEL: "rule-x" },
		});
		const report = run.report;
		assert.ok(report);
		const d = report.divergence;
		assert.deepEqual(
			{ step: d?.step, kind: d?.kind, at: d?.at, action: d?.action, detail: d?.detail, restored: d?.restoredSnapshot },
			{ step: 3, kind: "forced", at: "request", action: "live", detail: null, restored: recordedSteps[1].snapshotAfter },
		);
		assert.deepEqual(divergencesOf(run), [d]);

		// Steps 1-2 come from the tape, 3-5 from the model (which follows the new rule).
		const steps = stepsOf(run);
		assert.deepEqual(
			steps.map((s) => [s.step, s.live, s.tools.map((t) => `${t.name}:${t.exec}`)]),
			[
				[1, false, ["bash:stub"]],
				[2, false, ["write:stub", "read:stub"]],
				[3, true, ["bash:real"]],
				[4, true, ["bash:real"]],
				[5, true, []],
			],
		);
		assert.equal(textOf(messagesOf(run, "assistant").at(-1)), "Fixed.");

		// The live step 3 ran `cat notes.txt` for real: notes.txt, written by stubbed step 2,
		// exists only because the workspace was restored to the tape's snapshot first.
		const step3Result = messagesOf(run, "toolResult").find((m) => m.toolCallId === "toy_3_0");
		assert.equal(textOf(step3Result), "note\n");
		assert.equal(step3Result.isError, false);
		assert.equal(readFileSync(`${cwd}/fixed.txt`, "utf8"), "fixed\n");

		// Live steps take new snapshots under the fork's own ref prefix, descending from the restore point.
		const header = headerOf(run)[0];
		assert.equal(header.mode, "fork");
		assert.equal(header.forkAt, 3);
		assert.deepEqual(header.lenient, ["system"]);
		assert.notEqual(header.refPrefix, headerOf(recorded)[0].refPrefix);
		const s3 = steps[2].tools[0].snapshot;
		assert.equal(git(repo, "rev-parse", `${header.refPrefix}/s3-t1`), s3);
		assert.equal(git(repo, "rev-parse", `${s3}^`), recordedSteps[1].snapshotAfter);
		assert.equal(git(repo, "show", `${steps[3].snapshotAfter}:fixed.txt`), "fixed");
		assert.equal(steps[0].snapshotAfter, recordedSteps[0].snapshotAfter);

		// Only live steps count as spent; the replayed ones are savings.
		const sum = (list: TapeStepData[]) => list.reduce((total, s) => total + s.usage.totalTokens, 0);
		assert.deepEqual(report.steps, { replayed: 2, live: 3, total: 5 });
		assert.equal(report.usage.live.totalTokens, sum(steps.slice(2)));
		assert.ok(report.usage.live.cost > 0);
		assert.equal(report.usage.replayed.totalTokens, sum(recordedSteps.slice(0, 2)));
		assert.ok(report.usage.replayed.cost > 0);
		assert.equal(steps[0].usage.cost.total, 0);
		assert.equal(report.finalRestore, null);
		assert.equal(report.label, "rule-x");
		assert.deepEqual(report.errors, []);
	});

	test("a natural divergence (a blocked call) restores the last matching snapshot and continues live", async () => {
		const { run, cwd } = await fork({ extensions: [testExtension("guard.ts")], env: { TEST_GUARD_PATTERN: "^cat notes" } });
		const d = run.report?.divergence;
		assert.deepEqual(
			[d?.step, d?.kind, d?.toolId, d?.action, d?.restoredSnapshot],
			[3, "tool-blocked", "toy_3_0", "live", recordedSteps[1].snapshotAfter],
		);
		assert.deepEqual(
			stepsOf(run).map((s) => [s.step, s.live, s.tools.map((t) => t.exec)]),
			[
				[1, false, ["stub"]],
				[2, false, ["stub", "stub"]],
				[3, false, ["none"]],
				[4, true, []],
			],
		);
		assert.equal(stepsOf(run)[2].snapshotAfter, recordedSteps[1].snapshotAfter);
		assert.deepEqual(run.report?.steps, { replayed: 3, live: 1, total: 4 });
		assert.ok(existsSync(`${cwd}/notes.txt`), "restored from the tape's snapshot after step 2");
		assert.equal(textOf(messagesOf(run, "assistant").at(-1)), "Done.");
	});

	test("a fork that never diverges replays everything and ends at the tape's final snapshot", async () => {
		const { run, cwd } = await fork({});
		assert.equal(run.report?.divergence, null);
		assert.deepEqual(run.report?.steps, { replayed: 4, live: 0, total: 4 });
		assert.equal(run.report?.usage.live.totalTokens, 0);
		assert.equal(run.report?.finalRestore, recordedSteps[3].snapshotAfter);
		assert.ok(existsSync(`${cwd}/notes.txt`));
	});
});
