/**
 * Replay mode against the real pi CLI. One recorded tape (test/models/basic.mjs) is replayed
 * in fresh worktrees of the same repository under different harness changes.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { readTapeFromSessionFile } from "../src/session.ts";
import type { Tape, TapeStepData } from "../src/types.ts";
import {
	addWorktree,
	divergencesOf,
	git,
	headerOf,
	makeRepo,
	messagesOf,
	type PiRun,
	runPi,
	Scratch,
	scriptModel,
	stepsOf,
	testExtension,
	textOf,
	workingTree,
} from "./helpers.ts";

const scratch = new Scratch();
after(() => scratch.cleanup());

const FILES = { "README.md": "# demo\n", ".env": "SECRET=1\n" };

/** The recorded run every test replays. */
let repo = "";
let base = "";
let recorded: PiRun;
let recordedSteps: TapeStepData[];

before(async () => {
	repo = scratch.next("repo");
	base = makeRepo(repo, FILES);
	recorded = await runPi({ cwd: repo, scratch, env: { PI_TAPE_UPSTREAM: "scripted/toy" } });
	assert.equal(recorded.code, 0, recorded.stderr);
	recordedSteps = stepsOf(recorded);
	assert.equal(recordedSteps.length, 4);
});

/** Replay `source` in a new worktree at the task base. */
async function replay(source: string, options: { extensions?: string[]; env?: Record<string, string>; args?: string[] } = {}) {
	const cwd = addWorktree(repo, scratch.next("wt"), base);
	const run = await runPi({ cwd, scratch, extensions: options.extensions, args: options.args, env: { PI_TAPE_MODE: "replay", PI_TAPE_SOURCE: source, ...options.env } });
	assert.equal(run.code, 0, run.stderr);
	return { run, cwd };
}

function writeTape(tape: Tape): string {
	const file = `${scratch.next("tape")}.json`;
	writeFileSync(file, JSON.stringify(tape, null, 2));
	return file;
}

/** The replay ended with the synthetic final message, which is not a step. */
function assertStoppedAt(run: PiRun, step: number, kind: string) {
	const entry = run.branch.filter((e) => e.type === "message" && (e.message as { role: string }).role === "assistant").at(-1);
	const last = entry?.message as { stopReason: string; usage: { totalTokens: number }; content: unknown };
	assert.match(textOf(last), new RegExp(`^\\[tape\\] diverged at step ${step} \\(${kind}\\): `));
	assert.equal(last.stopReason, "stop");
	assert.equal(last.usage.totalTokens, 0);
	assert.ok(stepsOf(run).every((s) => s.responseEntryId !== entry?.id));
	assert.equal(stepsOf(run).length, run.report?.steps.total);
}

describe("replay", { concurrency: true }, () => {
	test("the same harness in another worktree replays without divergence, tokens or tool execution", async () => {
		const { run, cwd } = await replay(recorded.sessionFile);
		const report = run.report;
		assert.ok(report);
		assert.equal(report.divergence, null);
		assert.deepEqual(divergencesOf(run), []);
		assert.deepEqual(report.steps, { replayed: 4, live: 0, total: 4 });
		assert.deepEqual(report.usage.live, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 });
		assert.equal(report.usage.replayed.totalTokens, recorded.report?.usage.live.totalTokens);
		assert.equal(report.usage.replayed.cost, recorded.report?.usage.live.cost);
		assert.deepEqual(report.errors, []);

		const header = headerOf(run)[0];
		assert.equal(header.mode, "replay");
		assert.equal(header.cwd, cwd);
		assert.equal(header.snapshotBase, headerOf(recorded)[0].snapshotBase);
		assert.deepEqual(header.source, { kind: "session", location: recorded.sessionFile, tapeId: null, steps: 4 });

		// Replayed steps: from the tape, tools stubbed, snapshots copied, costs zero.
		const steps = stepsOf(run);
		assert.equal(steps.length, 4);
		steps.forEach((step, i) => {
			assert.equal(step.live, false);
			assert.equal(step.requestHash, recordedSteps[i].requestHash);
			assert.equal(step.snapshotAfter, recordedSteps[i].snapshotAfter);
			assert.deepEqual(
				step.tools.map((t) => [t.id, t.exec, t.snapshot]),
				recordedSteps[i].tools.map((t) => [t.id, "stub", t.snapshot]),
			);
			assert.equal(step.usage.cost.total, 0);
			assert.equal(step.usage.totalTokens, recordedSteps[i].usage.totalTokens);
		});

		// The workspace ends where the recording ended.
		const final = String(recordedSteps[3].snapshotAfter);
		assert.equal(report.finalRestore, final);
		assert.equal(await workingTree(cwd), git(repo, "rev-parse", `${final}^{tree}`));
		assert.equal(readFileSync(`${cwd}/notes.txt`, "utf8"), "note\n");

		// Recorded paths were rewritten to the new worktree.
		const assistant = messagesOf(run, "assistant")[0];
		const result = messagesOf(run, "toolResult")[0];
		assert.equal(textOf(assistant), `Working in ${cwd}.`);
		assert.equal(textOf(result), `README.md\n${cwd}\n`);
		assert.ok(!JSON.stringify(run.branch.filter((e) => e.type === "message")).includes(repo));
	});

	test("a harness that blocks a recorded call diverges with tool-blocked and stops cleanly", async () => {
		const { run } = await replay(recorded.sessionFile, { extensions: [testExtension("guard.ts")], env: { TEST_GUARD_PATTERN: "^cat notes" } });
		const divergences = divergencesOf(run);
		assert.equal(divergences.length, 1);
		const d = divergences[0];
		assert.deepEqual(
			{ step: d.step, kind: d.kind, toolId: d.toolId, at: d.at, action: d.action, restoredSnapshot: d.restoredSnapshot },
			{ step: 3, kind: "tool-blocked", toolId: "toy_3_0", at: "tool", action: "stop", restoredSnapshot: null },
		);
		assert.equal(d.detail?.recorded, "real");
		assert.equal(d.detail?.live, "none: Blocked by test guard: cat notes.txt");
		assert.deepEqual(run.report?.divergence, d);
		assert.deepEqual(run.report?.steps, { replayed: 3, live: 0, total: 3 });
		assert.equal(run.report?.usage.live.totalTokens, 0);
		assert.deepEqual(stepsOf(run)[2].tools.map((t) => [t.id, t.exec, t.isError]), [["toy_3_0", "none", true]]);
		assertStoppedAt(run, 3, "tool-blocked");
	});

	test("a changed prompt diverges at step 1 on the system message unless PI_TAPE_LENIENT=system", async () => {
		const args = ["--append-system-prompt", "RULE-X: keep answers short."];
		const [strict, lenient] = await Promise.all([
			replay(recorded.sessionFile, { args }),
			replay(recorded.sessionFile, { args, env: { PI_TAPE_LENIENT: "system" } }),
		]);
		const d = strict.run.report?.divergence;
		assert.ok(d);
		assert.deepEqual([d.step, d.kind, d.at, d.toolId], [1, "context", "request", null]);
		assert.equal(d.detail?.index, 0);
		assert.match(String(d.detail?.path), /^sections\[4\]/);
		assert.equal(d.detail?.live, "addendum");
		assert.deepEqual(strict.run.report?.steps, { replayed: 0, live: 0, total: 0 });
		assertStoppedAt(strict.run, 1, "context");

		assert.equal(lenient.run.report?.divergence, null);
		assert.deepEqual(lenient.run.report?.steps, { replayed: 4, live: 0, total: 4 });
		assert.deepEqual(headerOf(lenient.run)[0].lenient, ["system"]);
	});

	test("a tool_call hook that changes a recorded call's arguments diverges with tool-args", async () => {
		const { run } = await replay(recorded.sessionFile, {
			extensions: [testExtension("mutate.ts")],
			env: { TEST_MUTATE_FROM: "cat notes.txt", TEST_MUTATE_TO: "cat -n notes.txt" },
		});
		const d = run.report?.divergence;
		assert.deepEqual(
			{ step: d?.step, kind: d?.kind, toolId: d?.toolId, detail: d?.detail },
			{ step: 3, kind: "tool-args", toolId: "toy_3_0", detail: { index: null, path: "args.command", recorded: "cat notes.txt", live: "cat -n notes.txt" } },
		);
		assertStoppedAt(run, 3, "tool-args");
		const result = messagesOf(run, "toolResult").at(-1);
		assert.equal(textOf(result), "[tape] replay stopped at divergence");
		assert.equal(result.isError, true);
	});

	test("an edited tape JSON (file and URL) is replayed and its edited call diverges under a guard", async () => {
		const tape = readTapeFromSessionFile(recorded.sessionFile);
		assert.equal(tape.steps.length, 4);
		const edited = structuredClone(tape);
		const call = edited.steps[0].response.content.find((block) => block.type === "toolCall");
		assert.ok(call && call.type === "toolCall");
		call.arguments = { command: "cat .env" };
		edited.steps[0].tools[0].args = { command: "cat .env" };
		edited.edits.push({ step: 1, toolId: "toy_1_0", field: "args", note: "read the secrets instead" });
		const file = writeTape(edited);

		const server = createServer((request, response) => {
			response.writeHead(request.url === "/tapes/edited" ? 200 : 404, { "content-type": "application/json" });
			response.end(request.url === "/tapes/edited" ? JSON.stringify(edited) : "{}");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tapes/edited`;
		try {
			const guarded = { extensions: [testExtension("guard.ts")], env: { TEST_GUARD_PATTERN: "\\.env" } };
			const [fromFile, fromUrl] = await Promise.all([replay(file, guarded), replay(url, guarded)]);
			for (const { run } of [fromFile, fromUrl]) {
				const d = run.report?.divergence;
				assert.deepEqual([d?.step, d?.kind, d?.toolId], [1, "tool-blocked", "toy_1_0"]);
				assert.equal(d?.detail?.live, "none: Blocked by test guard: cat .env");
				assert.equal(messagesOf(run, "assistant")[0].content[1].arguments.command, "cat .env");
				assertStoppedAt(run, 1, "tool-blocked");
			}
			assert.deepEqual(fromFile.run.report?.source, { kind: "tape", location: file, tapeId: tape.id, steps: 4 });
			assert.deepEqual(fromUrl.run.report?.source, { kind: "url", location: url, tapeId: tape.id, steps: 4 });
		} finally {
			server.close();
		}
	});

	test("asking for more steps than the tape has diverges with tape-end", async () => {
		const tape = readTapeFromSessionFile(recorded.sessionFile);
		tape.steps = tape.steps.slice(0, 2);
		const { run } = await replay(writeTape(tape));
		const d = run.report?.divergence;
		assert.deepEqual([d?.step, d?.kind, d?.at, d?.detail?.recorded], [3, "tape-end", "request", "2"]);
		assert.deepEqual(run.report?.steps, { replayed: 2, live: 0, total: 2 });
		assertStoppedAt(run, 3, "tape-end");
	});

	test("a run that ends before the tape does diverges with early-end and restores that point", async () => {
		const tape = readTapeFromSessionFile(recorded.sessionFile);
		// Step 2 now answers with a final text: pi stops after it.
		tape.steps[1].response = { ...tape.steps[1].response, content: [{ type: "text", text: "Stopping here." }], stopReason: "stop" };
		tape.steps[1].tools = [];
		tape.steps[1].snapshotAfter = tape.steps[0].snapshotAfter;
		const { run, cwd } = await replay(writeTape(tape));
		const d = run.report?.divergence;
		assert.deepEqual([d?.step, d?.kind, d?.at, d?.action], [3, "early-end", "turn", "stop"]);
		assert.deepEqual(divergencesOf(run), [d]);
		assert.deepEqual(run.report?.steps, { replayed: 2, live: 0, total: 2 });
		assert.equal(run.report?.finalRestore, tape.steps[0].snapshotAfter);
		assert.equal(await workingTree(cwd), git(repo, "rev-parse", `${tape.steps[0].snapshotAfter}^{tree}`));
	});
});

describe("tools pi-tape cannot stub", () => {
	const HELLO = testExtension("hello-tool.ts");
	let helloRepo = "";
	let helloBase = "";
	let helloRun: PiRun;
	const log = () => `${helloRepo}.log`;
	const lines = () => readFileSync(log(), "utf8").split("\n").filter(Boolean).length;

	before(async () => {
		helloRepo = scratch.next("hello");
		helloBase = makeRepo(helloRepo, FILES);
		helloRun = await runPi({
			cwd: helloRepo,
			scratch,
			script: scriptModel("hello.mjs"),
			extensions: [HELLO],
			env: { PI_TAPE_UPSTREAM: "scripted/toy", TEST_HELLO_LOG: log() },
		});
		assert.equal(helloRun.code, 0, helloRun.stderr);
	});

	test("recording executes them for real and snapshots after them", () => {
		const [step] = stepsOf(helloRun);
		assert.deepEqual(step.tools.map((t) => [t.name, t.exec, t.isError]), [["hello", "real", false]]);
		assert.ok(step.tools[0].snapshot);
		assert.equal(lines(), 1);
	});

	test("replay treats them as tool-unwrapped and blocks them; fork runs them live", async () => {
		const env = { PI_TAPE_SOURCE: helloRun.sessionFile, TEST_HELLO_LOG: log() };
		const cwd = addWorktree(helloRepo, scratch.next("wt"), helloBase);
		const replayed = await runPi({ cwd, scratch, script: scriptModel("hello.mjs"), extensions: [HELLO], env: { ...env, PI_TAPE_MODE: "replay" } });
		assert.equal(replayed.code, 0, replayed.stderr);
		const d = replayed.report?.divergence;
		assert.deepEqual([d?.step, d?.kind, d?.toolId, d?.at, d?.action], [1, "tool-unwrapped", "toy_1_0", "tool", "stop"]);
		assert.equal(lines(), 1, "the tool did not run during the replay");
		assert.deepEqual(stepsOf(replayed)[0].tools.map((t) => t.exec), ["none"]);
		assertStoppedAt(replayed, 1, "tool-unwrapped");

		const forkCwd = addWorktree(helloRepo, scratch.next("wt"), helloBase);
		const forked = await runPi({
			cwd: forkCwd,
			scratch,
			script: scriptModel("hello.mjs"),
			extensions: [HELLO],
			env: { ...env, PI_TAPE_MODE: "fork", PI_TAPE_UPSTREAM: "scripted/toy" },
		});
		assert.equal(forked.code, 0, forked.stderr);
		const f = forked.report?.divergence;
		assert.deepEqual([f?.step, f?.kind, f?.action, f?.restoredSnapshot], [1, "tool-unwrapped", "live", headerOf(helloRun)[0].snapshotBase]);
		assert.equal(lines(), 2, "the fork ran the tool live");
		assert.deepEqual(stepsOf(forked).map((s) => [s.step, s.live, s.tools.map((t) => t.exec)]), [
			[1, false, ["real"]],
			[2, true, []],
		]);
	});
});
