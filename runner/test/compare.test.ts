import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { emptyUsageTotals } from "../../pi-tape/src/index.ts";
import { compareRun, type CompareRequest, type ComparisonRunner } from "../src/compare.ts";
import type { ForkRequest, ReplayRequest, RunRequest } from "../src/runs.ts";
import type { RunRecord } from "../src/types.ts";
import { tempRunner } from "./helpers.ts";

type Mode = "replay" | "fork" | "rerun";
type Message = Record<string, unknown>;

function messages(label = "original", suffix = "base"): Message[] {
	return [
		{ role: "assistant", content: [{ type: "toolCall", id: `tool-${suffix}`, name: "bash", arguments: { command: "echo hello" } }], stopReason: "toolUse" },
		{ role: "toolResult", toolCallId: `tool-${suffix}`, toolName: "bash", content: [{ type: "text", text: "hello" }], isError: false },
		{ role: "assistant", content: [{ type: "text", text: label }], stopReason: "stop" },
	];
}

function writeSession(file: string, record: RunRecord, content: Message[]): void {
	const entries: Record<string, unknown>[] = [{ type: "session", id: `session-${record.id}`, cwd: `/work/${record.id}` }];
	let parentId: string | null = null;
	const append = (entry: Record<string, unknown>) => {
		const id = `${record.id}-${entries.length}`;
		entries.push({ ...entry, id, parentId });
		parentId = id;
		return id;
	};
	append({ type: "custom", customType: "tape.header", data: { v: 1, cwd: `/work/${record.id}`, upstream: { provider: "scripted", model: "toy" }, snapshotBase: null } });
	const responses: string[] = [];
	for (const message of content) {
		const id = append({ type: "message", message: { ...message, timestamp: record.id, usage: { totalTokens: 10 } } });
		if (message.role === "assistant") responses.push(id);
	}
	for (const [index, responseEntryId] of responses.entries()) {
		append({ type: "custom", customType: "tape.step", data: { step: index + 1, live: true, responseEntryId, request: { keep: 0, append: [] }, requestHash: "stub", tools: [], snapshotAfter: null } });
	}
	writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

interface StubOptions {
	baselineMessages?: Message[];
	content?: (mode: Mode, id: string) => Message[];
	autoNeverDiverges?: boolean;
	neverLive?: boolean;
	startError?: Mode;
	doneError?: Mode;
	missingSession?: Mode;
	wrongModel?: Mode;
}

function stubRunner(options: StubOptions = {}) {
	const temporary = tempRunner({ tape: true });
	const { store } = temporary;
	const baseline: RunRecord = {
		format: "tapedeck.run/v1", id: "baseline", kind: "run", task: "t01", split: "held-in",
		variant: "vanilla", model: "scripted/toy", parent: null, forkAt: null, lenient: [], tapeSource: null,
		status: "done", error: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 1,
		pass: false, verify: null, steps: { total: 2, replayed: 0, live: 2 },
		usage: { ...emptyUsageTotals(), input: 8, output: 2, totalTokens: 10 }, savedUsage: emptyUsageTotals(),
		divergence: null, snapshotBase: "base-snapshot", snapshotFinal: "final-snapshot",
		sessionFile: "runs/baseline/session.jsonl", reportFile: null, repo: "repos/t01.git",
	};
	store.writeRun(baseline);
	writeSession(join(store.runDir(baseline.id), "session.jsonl"), baseline, options.baselineMessages ?? messages());
	const calls: { mode: Mode; request: ReplayRequest | ForkRequest | RunRequest }[] = [];
	const start = async (mode: Mode, request: ReplayRequest | ForkRequest | RunRequest) => {
		calls.push({ mode, request });
		if (options.startError === mode) throw new Error(`unsupported model at ${mode} launch`);
		const id = `${mode}-${calls.length}`;
		const recordedOnly = mode === "replay" || (mode === "fork" && (options.neverLive || (options.autoNeverDiverges && (request as ForkRequest).forkAt === undefined)));
		const model = mode === "replay" ? baseline.model : (request as RunRequest).model as string;
		const record: RunRecord = {
			...baseline, id, kind: mode === "rerun" ? "run" : mode, model: options.wrongModel === mode ? "scripted/wrong" : model,
			variant: request.variant, parent: mode === "rerun" ? null : baseline.id,
			pass: mode === "replay" ? null : true,
			steps: { total: 2, replayed: recordedOnly ? 2 : 0, live: recordedOnly ? 0 : 2 },
			usage: recordedOnly ? emptyUsageTotals() : baseline.usage,
			savedUsage: recordedOnly ? baseline.usage : emptyUsageTotals(),
			sessionFile: options.missingSession === mode ? null : `runs/${id}/session.jsonl`,
		};
		store.writeRun(record);
		if (record.sessionFile) writeSession(join(store.home, record.sessionFile), record, options.content?.(mode, id) ?? messages(mode === "replay" ? "original" : "candidate", id));
		return { id, done: options.doneError === mode ? Promise.reject(new Error("upstream disconnected")) : Promise.resolve(record) };
	};
	const runner: ComparisonRunner = {
		store, tape: true,
		startReplay: (request) => start("replay", request),
		startFork: (request) => start("fork", request),
		startRun: (request) => start("rerun", request),
	};
	return { runner, store, baseline, calls, cleanup: temporary.cleanup };
}

const request: CompareRequest = { from: "baseline", variant: "rule-taskrunner", model: "scripted/toy" };

test("requires an explicit upstream model and safe input before launching anything", async (context) => {
	const stub = stubRunner();
	context.after(stub.cleanup);
	const previous = process.env.TAPEDECK_LIVE_MODEL;
	delete process.env.TAPEDECK_LIVE_MODEL;
	context.after(() => { if (previous === undefined) delete process.env.TAPEDECK_LIVE_MODEL; else process.env.TAPEDECK_LIVE_MODEL = previous; });
	await assert.rejects(compareRun(stub.runner, { from: "baseline", variant: "vanilla" }), /explicit model or TAPEDECK_LIVE_MODEL/);
	for (const model of ["", "invalid", "provider/", "/model", "tape/main", "provider/has spaces"]) {
		await assert.rejects(compareRun(stub.runner, { ...request, model }));
	}
	for (const invalid of [{ from: "../baseline" }, { variant: "../vanilla" }, { forkAt: 0 }, { forkAt: 3 }, { forkAt: 1.5 }, { auto: "true" }, { lenient: ["all"] }]) {
		await assert.rejects(compareRun(stub.runner, { ...request, ...invalid } as CompareRequest));
	}
	assert.equal(stub.calls.length, 0);
	assert.equal(existsSync(join(stub.store.home, "comparisons")), false);
});

test("environment fallback is explicit and can be overridden without reading provider credentials", async (context) => {
	const stub = stubRunner();
	context.after(stub.cleanup);
	const previous = process.env.TAPEDECK_LIVE_MODEL;
	process.env.TAPEDECK_LIVE_MODEL = "mock/configured";
	context.after(() => { if (previous === undefined) delete process.env.TAPEDECK_LIVE_MODEL; else process.env.TAPEDECK_LIVE_MODEL = previous; });
	const configured = await compareRun(stub.runner, { from: "baseline", variant: "vanilla" });
	assert.equal(configured.model, "mock/configured");
	assert.equal(configured.runs.replay.providerCallsAllowed, false);
	assert.equal(configured.runs.fork.providerCallsAllowed, true);
	assert.equal(configured.runs.rerun.provider, "external");
	assert.equal(configured.runs.replay.model, "scripted/toy");
	const explicit = await compareRun(stub.runner, { ...request, model: "mock/explicit" });
	assert.equal(explicit.model, "mock/explicit");
	assert.equal(explicit.runs.fork.model, "mock/explicit");
	assert.equal(explicit.runs.rerun.model, "mock/explicit");
	assert.equal(stub.calls.length, 6);
});

test("strict replay is baseline-only; fork defaults live at step 1; rerun has no tape parent", async (context) => {
	const stub = stubRunner();
	context.after(stub.cleanup);
	const original = readFileSync(join(stub.store.runDir("baseline"), "session.jsonl"), "utf8");
	const result = await compareRun(stub.runner, request);
	assert.equal(result.format, "tapedeck.comparison/v1");
	assert.equal(result.status, "done", JSON.stringify(result.errors));
	assert.match(result.id, /^comparison-[a-f0-9-]+$/);
	assert.deepEqual(stub.calls.map((call) => call.mode), ["replay", "fork", "rerun"]);
	assert.deepEqual(stub.calls[0].request, { from: "baseline", variant: "vanilla" });
	assert.deepEqual(stub.calls[1].request, { ...request, forkAt: 1 });
	assert.deepEqual(stub.calls[2].request, { task: "t01", variant: "rule-taskrunner", model: "scripted/toy" });
	assert.equal(result.summary?.outcomes.replay, null);
	assert.equal(result.summary?.outcomes.forkRerunAgreement, true);
	assert.equal(result.summary?.differences.baselineReplay.equal, true);
	assert.equal(result.summary?.differences.baselineFork.equal, false);
	assert.equal(result.summary?.usage.totalNew.totalTokens, 20);
	assert.equal(result.runs.fork.provider, "scripted");
	assert.equal(result.runs.fork.providerCallsAllowed, false);
	assert.equal(result.runs.baseline.artifacts?.snapshotFinal, "final-snapshot");
	assert.equal(readFileSync(join(stub.store.runDir("baseline"), "session.jsonl"), "utf8"), original);
	assert.deepEqual(JSON.parse(readFileSync(join(stub.store.home, "comparisons", `${result.id}.json`), "utf8")), result);
	assert.deepEqual(readdirSync(join(stub.store.home, "comparisons")), [`${result.id}.json`]);
});

test("behavior distinguishes text, tool arguments, results, result errors and event order despite equal pass", async (context) => {
	const changes: Record<string, (content: Message[]) => Message[]> = {
		text: (content) => { content[2].content = [{ type: "text", text: "different answer" }]; return content; },
		arguments: (content) => { (content[0].content as Record<string, unknown>[])[0].arguments = { command: "echo different" }; return content; },
		result: (content) => { content[1].content = [{ type: "text", text: "different output" }]; return content; },
		error: (content) => { content[1].isError = true; return content; },
		details: (content) => { content[1].details = { exitCode: 4 }; return content; },
		order: (content) => [content[0], content[2], content[1]],
	};
	for (const [name, change] of Object.entries(changes)) {
		await context.test(name, async (child) => {
			const stub = stubRunner({ content: (mode, id) => mode === "fork" ? change(messages("original", id)) : messages("original", id) });
			child.after(stub.cleanup);
			const result = await compareRun(stub.runner, request);
			assert.equal(result.summary?.outcomes.forkRerunAgreement, true);
			assert.equal(result.summary?.differences.forkRerun.equal, false);
			assert.equal(result.summary?.differences.forkRerun.complete, true);
			assert.ok(result.summary?.differences.forkRerun.changes.length);
		});
	}
});

test("ignores generated tool IDs, model metadata, usage and different worktree paths", async (context) => {
	const original = messages("/work/baseline/src/file");
	const stub = stubRunner({ baselineMessages: original, content: (_mode, id) => messages(`/work/${id}/src/file`, id) });
	context.after(stub.cleanup);
	const result = await compareRun(stub.runner, request);
	assert.equal(result.status, "done");
	for (const difference of Object.values(result.summary!.differences)) assert.equal(difference.equal, true);
});

test("compares complete content beyond excerpt limits while bounding summary size", async (context) => {
	const content = Array.from({ length: 20 }, () => ({ role: "assistant", content: [{ type: "text", text: `${"x".repeat(1500)}baseline` }], stopReason: "stop" }));
	const stub = stubRunner({
		baselineMessages: content,
		content: (mode) => mode === "replay" ? content : content.map((message) => ({ ...message, content: [{ type: "text", text: `${"x".repeat(1500)}candidate` }] })),
	});
	context.after(stub.cleanup);
	const result = await compareRun(stub.runner, request);
	const difference = result.summary!.differences.baselineFork;
	assert.equal(difference.equal, false);
	assert.equal(difference.changedEvents, 20);
	assert.equal(difference.changes.length, 12);
	assert.equal(difference.omittedChanges, 8);
	assert.ok(difference.changes.every((change) => (change.left?.length ?? 0) <= 500 && (change.right?.length ?? 0) <= 500));
	assert.ok(difference.changes.every((change) => change.offset > 0 && change.left?.includes("baseline") && change.right?.includes("candidate")));
	assert.ok(readFileSync(join(stub.store.home, result.runs.fork.artifacts!.session!), "utf8").includes(`${"x".repeat(1500)}candidate`));
});

test("auto without divergence forces a second live fork and preserves both attempts", async (context) => {
	const stub = stubRunner({ autoNeverDiverges: true });
	context.after(stub.cleanup);
	const result = await compareRun(stub.runner, { ...request, auto: true, lenient: ["system"] });
	assert.equal(result.status, "done");
	assert.equal(result.forkAttempts.length, 2);
	assert.equal(result.forkAttempts[0].steps?.live, 0);
	assert.equal(result.forkRun, result.forkAttempts[1].id);
	assert.equal((stub.calls[2].request as ForkRequest).forkAt, 1);
	assert.deepEqual((stub.calls[2].request as ForkRequest).lenient, ["system"]);
	assert.match(result.notes.join("\n"), /never went live.*retained/);
	assert.ok(result.forkAttempts.every((run) => existsSync(join(stub.store.home, run.artifacts!.session!))));
});

test("respects explicit forkAt, and never labels a replay-only fork successful", async (context) => {
	const stub = stubRunner({ neverLive: true });
	context.after(stub.cleanup);
	const result = await compareRun(stub.runner, { ...request, forkAt: 2, auto: true });
	assert.equal(result.status, "partial");
	assert.equal(result.forkAttempts.length, 1);
	assert.equal((stub.calls[1].request as ForkRequest).forkAt, 2);
	assert.ok(result.errors.some((error) => error.mode === "fork" && /no live steps/.test(error.message)));
});

test("launch errors, rejected execution and absent traces retain other runs and a partial report", async (context) => {
	for (const options of [{ startError: "fork" }, { doneError: "fork" }, { missingSession: "fork" }, { wrongModel: "fork" }] as StubOptions[]) {
		await context.test(JSON.stringify(options), async (child) => {
			const stub = stubRunner(options);
			child.after(stub.cleanup);
			const result = await compareRun(stub.runner, { ...request, model: "mock/requested" });
			assert.equal(result.status, "partial");
			assert.ok(result.replayRun);
			assert.ok(result.rerunRun);
			assert.equal(result.forkRun === null, options.startError === "fork");
			assert.equal(result.errors[0].mode, "fork");
			assert.equal(result.errors[0].runId, result.forkRun);
			assert.equal(result.summary?.differences.forkRerun.complete, false);
			assert.ok(existsSync(join(stub.store.home, "comparisons", `${result.id}.json`)));
		});
	}
});

test("divergent replay is not silently reported as a valid strict comparison", async (context) => {
	const stub = stubRunner({ content: (_mode, id) => messages("unexpected", id) });
	context.after(stub.cleanup);
	const result = await compareRun(stub.runner, request);
	assert.equal(result.status, "partial");
	assert.ok(result.errors.some((error) => error.mode === "replay" && /strict replay/.test(error.message)));
});

describe("scripted/toy comparisons with real recording, git snapshots and sessions", () => {
	const temporary = tempRunner({ tape: true });
	let baseline: RunRecord;
	before(async () => {
		baseline = await temporary.runner.run({ task: "t01", variant: "vanilla", model: "scripted/toy" });
		assert.equal(baseline.status, "done", baseline.error ?? "");
	});
	after(temporary.cleanup);

	test("default live comparison preserves baseline and uses the requested model", async () => {
		const original = readFileSync(join(temporary.store.home, baseline.sessionFile!), "utf8");
		const result = await compareRun(temporary.runner, { from: baseline.id, variant: "rule-taskrunner", model: "scripted/toy" });
		assert.equal(result.status, "done", JSON.stringify(result.errors));
		assert.equal(result.runs.replay.steps?.live, 0);
		assert.equal(result.runs.replay.usage?.totalTokens, 0);
		assert.ok(result.runs.fork.steps!.live > 0);
		assert.ok(result.runs.rerun.steps!.live > 0);
		assert.equal(temporary.store.getRun(result.forkRun!).forkAt, 1);
		assert.equal(temporary.store.getRun(result.forkRun!).model, "scripted/toy");
		assert.equal(temporary.store.getRun(result.rerunRun!).parent, null);
		assert.equal(result.summary?.outcomes.baseline, false);
		assert.equal(result.summary?.outcomes.fork, true);
		assert.equal(result.summary?.outcomes.rerun, true);
		assert.equal(result.summary?.differences.baselineReplay.equal, true);
		assert.equal(result.summary?.differences.baselineFork.equal, false);
		assert.equal(readFileSync(join(temporary.store.home, baseline.sessionFile!), "utf8"), original);
		for (const run of Object.values(result.runs)) {
			assert.ok(existsSync(join(temporary.store.home, run.artifacts!.session!)));
			assert.match(run.artifacts!.snapshotFinal ?? "", /^[a-f0-9]{40}$/);
		}
	});

	test("automatic rule forks replay the shared prefix before live continuation", async () => {
		const result = await compareRun(temporary.runner, { from: baseline.id, variant: "rule-taskrunner", model: "scripted/toy", auto: true });
		assert.equal(result.status, "done", JSON.stringify(result.errors));
		assert.equal(temporary.store.getRun(result.forkRun!).forkAt, 4);
		assert.equal(result.runs.fork.steps?.replayed, 3);
		assert.ok(result.runs.fork.steps!.live > 0);
		assert.ok(result.summary!.usage.forkSaved!.totalTokens > 0);
	});

	test("auto vanilla cannot masquerade as a live fork", async () => {
		const result = await compareRun(temporary.runner, { from: baseline.id, variant: "vanilla", model: "scripted/toy", auto: true });
		assert.equal(result.status, "done", JSON.stringify(result.errors));
		assert.equal(result.forkAttempts.length, 2);
		assert.equal(result.forkAttempts[0].steps?.live, 0);
		assert.ok(result.runs.fork.steps!.live > 0);
		assert.equal(temporary.store.getRun(result.forkRun!).forkAt, 1);
	});
});
