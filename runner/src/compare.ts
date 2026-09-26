import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, normalizeMessage, sha256Hex, substitutePaths, sumUsage } from "../../pi-tape/src/index.ts";
import { getTask, getVariant } from "./bench.ts";
import { checkModel, isScripted } from "./pi.ts";
import type { ForkRequest, Runner, StartedRun } from "./runs.ts";
import { readBranch, readTapeFromSessionFile } from "./tape.ts";
import type { RunRecord, Usage } from "./types.ts";
import { errorMessage, isSafeName, UserError, writeJson } from "./util.ts";

export interface CompareRequest {
	from: string;
	variant: string;
	model?: string;
	forkAt?: number;
	auto?: boolean;
	lenient?: string[];
}

export type ComparisonRunner = Pick<Runner, "store" | "tape" | "startReplay" | "startFork" | "startRun">;
type Mode = "baseline" | "replay" | "fork" | "rerun";

export interface ComparisonRun {
	id: string | null;
	status: "pending" | "running" | "done" | "error";
	error: string | null;
	model: string;
	variant: string;
	provider: "historical" | "none" | "scripted" | "external";
	providerCallsAllowed: boolean;
	pass: boolean | null;
	usage: Usage | null;
	savedUsage: Usage | null;
	steps: RunRecord["steps"] | null;
	divergence: RunRecord["divergence"];
	artifacts: {
		run: string;
		session: string | null;
		report: string | null;
		repo: string;
		snapshotBase: string | null;
		snapshotFinal: string | null;
	} | null;
	behavior: { digest: string; events: number; assistantResponses: number; toolCalls: number; toolResults: number } | null;
	traceError: string | null;
}

export interface BehaviorDifference {
	equal: boolean | null;
	complete: boolean;
	leftEvents: number | null;
	rightEvents: number | null;
	changedEvents: number | null;
	omittedChanges: number;
	changes: { index: number; offset: number; left: string | null; right: string | null }[];
}

export interface ComparisonResult {
	format: "tapedeck.comparison/v1";
	id: string;
	createdAt: string;
	finishedAt: string | null;
	status: "running" | "done" | "partial";
	baselineRun: string;
	replayRun: string | null;
	forkRun: string | null;
	rerunRun: string | null;
	task: string;
	model: string;
	variant: string;
	request: CompareRequest;
	runs: Record<Mode, ComparisonRun>;
	forkAttempts: ComparisonRun[];
	notes: string[];
	errors: { mode: Mode; runId: string | null; message: string }[];
	summary: {
		outcomes: Record<Mode, boolean | null> & { forkRerunAgreement: boolean | null };
		usage: {
			complete: boolean;
			baseline: Usage | null;
			replay: Usage | null;
			fork: Usage | null;
			rerun: Usage | null;
			totalNew: Usage;
			forkSaved: Usage | null;
			forkMinusRerunTokens: number | null;
		};
		differences: Record<"baselineReplay" | "baselineFork" | "baselineRerun" | "forkRerun", BehaviorDifference>;
	} | null;
}

const MAX_CHANGES = 12;
const MAX_EXCERPT = 500;
const MAX_ERROR = 2000;

function bounded(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function pendingRun(mode: Mode, model: string, variant: string): ComparisonRun {
	return {
		id: null, status: "pending", error: null, model, variant,
		provider: mode === "baseline" ? "historical" : mode === "replay" ? "none" : isScripted(model) ? "scripted" : "external",
		providerCallsAllowed: (mode === "fork" || mode === "rerun") && !isScripted(model),
		pass: null, usage: null, savedUsage: null, steps: null, divergence: null,
		artifacts: null, behavior: null, traceError: null,
	};
}

function readBehavior(runner: ComparisonRunner, run: RunRecord): { events: string[]; summary: NonNullable<ComparisonRun["behavior"]> } {
	if (!run.sessionFile) throw new Error("run has no session file; behavior is unavailable");
	const branch = readBranch(join(runner.store.runDir(run.id), "session.jsonl"));
	const header = branch.find((entry) => entry.type === "custom" && entry.customType === "tape.header")?.data as { cwd?: string } | undefined;
	const cwd = header?.cwd ?? runner.store.workDir(run.id);
	const callIds = new Map<string, string>();
	const events: string[] = [];
	let assistantResponses = 0;
	let toolCalls = 0;
	let toolResults = 0;
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const message = entry.message as Record<string, unknown> | undefined;
		if (message?.role !== "assistant" && message?.role !== "toolResult") continue;
		const normalized = normalizeMessage(message);
		if (message.role === "assistant") {
			assistantResponses++;
			normalized.stopReason = message.stopReason ?? null;
			for (const block of normalized.content as Record<string, unknown>[]) {
				if (block.type !== "toolCall") continue;
				const id = `call-${++toolCalls}`;
				callIds.set(String(block.id), id);
				block.id = id;
			}
		} else {
			toolResults++;
			normalized.toolCallId = callIds.get(String(message.toolCallId)) ?? `unmatched:${String(message.toolCallId)}`;
			normalized.details = message.details ?? null;
		}
		events.push(canonicalJson(substitutePaths(normalized, { cwd })));
	}
	if (assistantResponses === 0) throw new Error("session has no assistant responses; behavior is unavailable");
	return {
		events,
		summary: { digest: sha256Hex(canonicalJson(events)), events: events.length, assistantResponses, toolCalls, toolResults },
	};
}

function difference(left: ComparisonRun, right: ComparisonRun, traces: Map<string, string[]>): BehaviorDifference {
	const leftEvents = left.id ? traces.get(left.id) : undefined;
	const rightEvents = right.id ? traces.get(right.id) : undefined;
	const result: BehaviorDifference = {
		equal: null,
		complete: left.status === "done" && right.status === "done" && !left.traceError && !right.traceError,
		leftEvents: leftEvents?.length ?? null, rightEvents: rightEvents?.length ?? null,
		changedEvents: null, omittedChanges: 0, changes: [],
	};
	if (!leftEvents || !rightEvents) return result;
	result.changedEvents = 0;
	for (let index = 0; index < Math.max(leftEvents.length, rightEvents.length); index++) {
		if (leftEvents[index] === rightEvents[index]) continue;
		result.changedEvents++;
		if (result.changes.length < MAX_CHANGES) {
			let offset = 0;
			const leftEvent = leftEvents[index];
			const rightEvent = rightEvents[index];
			if (leftEvent !== undefined && rightEvent !== undefined) {
				while (offset < Math.min(leftEvent.length, rightEvent.length) && leftEvent[offset] === rightEvent[offset]) offset++;
			}
			offset = Math.max(0, offset - 100);
			result.changes.push({
				index: index + 1,
				offset,
				left: leftEvent === undefined ? null : bounded(leftEvent.slice(offset), MAX_EXCERPT),
				right: rightEvent === undefined ? null : bounded(rightEvent.slice(offset), MAX_EXCERPT),
			});
		}
	}
	result.equal = result.changedEvents === 0;
	result.omittedChanges = result.changedEvents - result.changes.length;
	return result;
}

export async function compareRun(runner: ComparisonRunner, request: CompareRequest): Promise<ComparisonResult> {
	if (!request || typeof request !== "object") throw new UserError("comparison request is required");
	const selectedModel = request.model === undefined ? process.env.TAPEDECK_LIVE_MODEL : request.model;
	if (typeof selectedModel !== "string" || !selectedModel.trim()) {
		throw new UserError("comparison requires an explicit model or TAPEDECK_LIVE_MODEL; the runner default is not used");
	}
	const model = selectedModel.trim();
	checkModel(model);
	if (/\s/.test(model) || model.startsWith("tape/")) throw new UserError("comparison model must name an upstream provider/modelId, not tape/main");
	if (typeof request.from !== "string" || !isSafeName(request.from)) throw new UserError("from must be a safe run ID");
	if (typeof request.variant !== "string" || !isSafeName(request.variant)) throw new UserError("variant must be a safe name");
	if (request.auto !== undefined && typeof request.auto !== "boolean") throw new UserError("auto must be a boolean");
	if (request.forkAt !== undefined && (!Number.isInteger(request.forkAt) || request.forkAt < 1)) throw new UserError("forkAt must be an integer >= 1");
	if (request.lenient !== undefined && (!Array.isArray(request.lenient) || request.lenient.some((value) => value !== "system"))) {
		throw new UserError('lenient must be an array containing only "system"');
	}
	if (!runner.tape) throw new UserError("comparisons require pi-tape recording and replay");
	const baseline = runner.store.getRun(request.from);
	if (baseline.id !== request.from || baseline.status !== "done") throw new UserError("comparison baseline must be a completed run");
	getTask(baseline.task);
	getVariant(baseline.variant);
	getVariant(request.variant);
	const baselineTape = readTapeFromSessionFile(join(runner.store.runDir(baseline.id), "session.jsonl"));
	if (!baselineTape.steps.length) throw new UserError("comparison baseline must contain recorded steps");
	if (request.forkAt !== undefined && request.forkAt > baselineTape.steps.length) throw new UserError("forkAt exceeds the baseline's recorded steps and cannot guarantee a live fork");
	const normalizedRequest: CompareRequest = { from: baseline.id, variant: request.variant, model };
	if (request.forkAt !== undefined) normalizedRequest.forkAt = request.forkAt;
	if (request.auto !== undefined) normalizedRequest.auto = request.auto;
	if (request.lenient !== undefined) normalizedRequest.lenient = [...request.lenient];
	const result: ComparisonResult = {
		format: "tapedeck.comparison/v1", id: `comparison-${randomUUID()}`,
		createdAt: new Date().toISOString(), finishedAt: null, status: "running",
		baselineRun: baseline.id, replayRun: null, forkRun: null, rerunRun: null,
		task: baseline.task, model, variant: request.variant, request: normalizedRequest,
		runs: {
			baseline: pendingRun("baseline", baseline.model, baseline.variant),
			replay: pendingRun("replay", baseline.model, baseline.variant),
			fork: pendingRun("fork", model, request.variant),
			rerun: pendingRun("rerun", model, request.variant),
		},
		forkAttempts: [], errors: [], summary: null,
		notes: [
			"Strict replay uses the baseline variant and recorded responses: no model-provider calls, no leniency, and no new verification verdict.",
			"Fork continues live under the requested model; fresh rerun starts the same task from its base with the requested variant and model, without a tape source.",
			isScripted(model) ? "scripted/* is an offline model: live means executing the toy model, not a paid external API." : "Fork and fresh rerun may call external providers. Credentials are resolved by the runner at execution and are not part of this comparison request.",
			"Provider allowance is not a request count. Failed requests may have unreported usage; totals include reported usage only and are marked incomplete after execution failures.",
			"Behavior compares ordered assistant content, stop reasons, tool calls and results (including errors/details), ignoring usage, timestamps, signatures, worktree paths and generated call IDs. Excerpts are bounded; complete original sessions and git snapshots are retained.",
		],
	};
	const traces = new Map<string, string[]>();
	const directory = join(runner.store.home, "comparisons");
	mkdirSync(directory, { recursive: true });
	const persist = () => writeJson(join(directory, `${result.id}.json`), result);
	const capture = (target: ComparisonRun, record: RunRecord) => {
		if (!isSafeName(record.id)) throw new Error("runner returned an unsafe run ID");
		if (target.id && record.id !== target.id) throw new Error("runner returned a different run ID from the launched run");
		Object.assign(target, {
			id: record.id, status: record.status, error: record.error ? bounded(record.error, MAX_ERROR) : null,
			model: record.model, variant: record.variant, pass: record.pass,
			usage: record.usage, savedUsage: record.savedUsage, steps: record.steps, divergence: record.divergence,
			artifacts: {
				run: `runs/${record.id}/run.json`, session: record.sessionFile ? `runs/${record.id}/session.jsonl` : null,
				report: record.reportFile ? `runs/${record.id}/tape-report.json` : null,
				repo: runner.store.rel(runner.store.repoDir(baseline.task)), snapshotBase: record.snapshotBase, snapshotFinal: record.snapshotFinal,
			},
		});
		try {
			const behavior = readBehavior(runner, record);
			target.behavior = behavior.summary;
			traces.set(record.id, behavior.events);
		} catch (error) {
			target.traceError = bounded(errorMessage(error), MAX_ERROR);
		}
	};
	capture(result.runs.baseline, baseline);
	persist();
	const execute = async (mode: Exclude<Mode, "baseline">, start: () => Promise<StartedRun>) => {
		const target = pendingRun(mode, mode === "replay" ? baseline.model : model, mode === "replay" ? baseline.variant : request.variant);
		result.runs[mode] = target;
		if (mode === "fork") result.forkAttempts.push(target);
		try {
			const started = await start();
			if (!isSafeName(started.id)) throw new Error("runner returned an unsafe run ID");
			target.id = started.id;
			target.status = "running";
			result[`${mode}Run`] = started.id;
			persist();
			capture(target, await started.done);
			if (mode !== "replay" && target.model !== model) throw new Error("runner did not execute the requested model");
		} catch (error) {
			if (target.id) {
				try {
					const record = runner.store.readRun(target.id);
					if (record) capture(target, record);
				} catch (captureError) {
					target.traceError = bounded(errorMessage(captureError), MAX_ERROR);
				}
			}
			target.status = "error";
			target.error = bounded(errorMessage(error), MAX_ERROR);
		}
		persist();
		return target;
	};
	await execute("replay", () => runner.startReplay({ from: baseline.id, variant: baseline.variant }));
	const forkRequest: ForkRequest = {
		...normalizedRequest,
		forkAt: request.forkAt ?? (request.auto ? undefined : 1),
	};
	const fork = await execute("fork", () => runner.startFork(forkRequest));
	if (request.auto && request.forkAt === undefined && fork.status === "done" && fork.steps?.live === 0) {
		result.notes.push(`Auto fork ${fork.id} never went live; its artifacts are retained. A second fork is forced at step 1 to execute the requested model.`);
		await execute("fork", () => runner.startFork({ ...forkRequest, forkAt: 1 }));
	}
	await execute("rerun", () => runner.startRun({ task: baseline.task, variant: request.variant, model }));
	const { replay, fork: liveFork, rerun } = result.runs;
	const outcomes = {
		baseline: baseline.pass, replay: replay.pass, fork: liveFork.pass, rerun: rerun.pass,
		forkRerunAgreement: liveFork.status !== "done" || rerun.status !== "done" || liveFork.pass === null || rerun.pass === null ? null : liveFork.pass === rerun.pass,
	};
	result.summary = {
		outcomes,
		usage: {
			complete: [replay, ...result.forkAttempts, rerun].every((run) => run.status === "done" && run.usage !== null),
			baseline: baseline.usage, replay: replay.usage, fork: liveFork.usage, rerun: rerun.usage,
			totalNew: sumUsage([replay.usage, ...result.forkAttempts.map((attempt) => attempt.usage), rerun.usage]),
			forkSaved: liveFork.savedUsage,
			forkMinusRerunTokens: liveFork.usage && rerun.usage ? liveFork.usage.totalTokens - rerun.usage.totalTokens : null,
		},
		differences: {
			baselineReplay: difference(result.runs.baseline, replay, traces),
			baselineFork: difference(result.runs.baseline, liveFork, traces),
			baselineRerun: difference(result.runs.baseline, rerun, traces),
			forkRerun: difference(liveFork, rerun, traces),
		},
	};
	for (const mode of ["baseline", "replay", "fork", "rerun"] as const) {
		const run = result.runs[mode];
		const problem = run.status !== "done" ? run.error ?? `run ended with status ${run.status}`
			: run.traceError ?? (mode === "fork" || mode === "rerun" ? (run.steps?.live ? null : "requested live execution produced no live steps") : null);
		if (problem) result.errors.push({ mode, runId: run.id, message: problem });
	}
	if (replay.status === "done" && (replay.steps?.live !== 0 || replay.divergence || replay.usage?.totalTokens !== 0 || replay.usage?.cost !== 0 || result.summary.differences.baselineReplay.equal !== true)) {
		result.errors.push({ mode: "replay", runId: replay.id, message: "strict replay did not reproduce baseline behavior without divergence or live usage" });
	}
	result.status = result.errors.length ? "partial" : "done";
	result.finishedAt = new Date().toISOString();
	persist();
	return result;
}
