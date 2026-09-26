/** Shared test helpers: temporary stores, the contract shapes of §5.2/§5.4, pi-tape detection. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tapeAvailable } from "../src/pi.ts";
import { Runner, type RunnerOptions } from "../src/runs.ts";
import { Store } from "../src/store.ts";

export function tempDir(prefix: string): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), `tapedeck-${prefix}-`));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A Runner on a fresh temporary store. */
export function tempRunner(opts: Partial<RunnerOptions> = {}): { runner: Runner; store: Store; cleanup: () => void } {
	const { dir, cleanup } = tempDir("store");
	const store = Store.open(dir);
	return { runner: new Runner({ store, timeoutMs: 60_000, ...opts }), store, cleanup };
}

type Check = (value: unknown) => boolean;
const isString: Check = (v) => typeof v === "string";
const isNumber: Check = (v) => typeof v === "number" && Number.isFinite(v);
const isBool: Check = (v) => typeof v === "boolean";
const isNull: Check = (v) => v === null;
const isObject: Check = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso: Check = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.includes("T");
const oneOf = (...values: unknown[]): Check => (v) => values.includes(v);
const or = (...checks: Check[]): Check => (v) => checks.some((c) => c(v));
const arrayOf = (check: Check): Check => (v) => Array.isArray(v) && v.every(check);

function shapeProblems(value: unknown, shape: Record<string, Check>, where: string): string[] {
	if (!isObject(value)) return [`${where} is not an object`];
	const record = value as Record<string, unknown>;
	const problems: string[] = [];
	for (const key of Object.keys(shape)) {
		if (!(key in record)) problems.push(`${where}.${key} is missing`);
		else if (!shape[key](record[key])) problems.push(`${where}.${key} has a bad value: ${JSON.stringify(record[key])}`);
	}
	for (const key of Object.keys(record)) if (!(key in shape)) problems.push(`${where}.${key} is not in the contract`);
	return problems;
}

const USAGE: Record<string, Check> = { input: isNumber, output: isNumber, cacheRead: isNumber, cacheWrite: isNumber, totalTokens: isNumber, cost: isNumber };
const isUsage: Check = (v) => shapeProblems(v, USAGE, "usage").length === 0;
const DIVERGENCE: Record<string, Check> = {
	v: isNumber,
	step: isNumber,
	kind: isString,
	toolId: or(isString, isNull),
	at: oneOf("request", "tool", "turn"),
	detail: or(isObject, isNull),
	restoredSnapshot: or(isString, isNull),
	action: oneOf("live", "stop"),
};
const isDivergence: Check = (v) => shapeProblems(v, DIVERGENCE, "divergence").length === 0;
const VERIFY: Record<string, Check> = { exitCode: or(isNumber, isNull), pass: isBool, output: isString, durationMs: isNumber };
const STEPS: Record<string, Check> = { total: isNumber, replayed: isNumber, live: isNumber };
const isRelative: Check = (v) => typeof v === "string" && !v.startsWith("/");

/** Problems of a run.json against INTERFACES.md §5.2 (empty when it conforms). */
export function runProblems(run: unknown): string[] {
	const finished = isObject(run) && (run as { status?: string }).status !== "running";
	return shapeProblems(
		run,
		{
			format: oneOf("tapedeck.run/v1"),
			id: isString,
			kind: oneOf("run", "fork", "replay"),
			task: isString,
			split: oneOf("held-in", "held-out"),
			variant: isString,
			model: isString,
			parent: or(isString, isNull),
			forkAt: or((v) => Number.isInteger(v) && (v as number) >= 1, isNull),
			lenient: arrayOf(isString),
			tapeSource: or(isString, isNull),
			status: oneOf("running", "done", "error"),
			error: or(isString, isNull),
			startedAt: isIso,
			finishedAt: finished ? isIso : isNull,
			durationMs: finished ? isNumber : isNull,
			pass: or(isBool, isNull),
			verify: or((v) => shapeProblems(v, VERIFY, "verify").length === 0, isNull),
			steps: (v) => shapeProblems(v, STEPS, "steps").length === 0,
			usage: isUsage,
			savedUsage: isUsage,
			divergence: or(isDivergence, isNull),
			snapshotBase: or(isString, isNull),
			snapshotFinal: or(isString, isNull),
			sessionFile: or(isRelative, isNull),
			reportFile: or(isRelative, isNull),
			repo: isRelative,
		},
		"run",
	);
}

const isRates: Check = (v) => isObject(v) && Object.entries(v as object).every(([k, x]) => (k === "held-in" || k === "held-out") && isNumber(x));
const ROW: Record<string, Check> = {
	task: isString,
	split: oneOf("held-in", "held-out"),
	baselineRun: isString,
	baselinePass: or(isBool, isNull),
	forkRun: isString,
	forkPass: or(isBool, isNull),
	forkAt: or(isNumber, isNull),
	divergence: or(isDivergence, isNull),
	forkUsage: isUsage,
	savedUsage: isUsage,
	rerunRuns: arrayOf(isString),
	rerunPass: arrayOf(or(isBool, isNull)),
	rerunUsage: isUsage,
	agree: isBool,
};
const SUMMARY: Record<string, Check> = {
	n: isNumber,
	agreement: isNumber,
	forkTokens: isNumber,
	rerunTokens: isNumber,
	forkCost: isNumber,
	rerunCost: isNumber,
	tokenSavings: isNumber,
	baselinePassRate: isRates,
	candidateForkPassRate: isRates,
	candidateRerunPassRate: isRates,
};

/** Problems of a gate report against INTERFACES.md §5.4. */
export function gateProblems(report: unknown): string[] {
	const problems = shapeProblems(
		report,
		{
			format: oneOf("tapedeck.gate/v1"),
			name: isString,
			candidate: isString,
			baseline: isString,
			model: isString,
			createdAt: isIso,
			rows: Array.isArray,
			summary: isObject,
		},
		"gate",
	);
	if (problems.length > 0) return problems;
	const gate = report as { rows: unknown[]; summary: unknown };
	return [...gate.rows.flatMap((row, i) => shapeProblems(row, ROW, `rows[${i}]`)), ...shapeProblems(gate.summary, SUMMARY, "summary")];
}

let tapeProbe: Promise<string | null> | undefined;

/**
 * Null when pi-tape records working tapes; otherwise why not. Probes once per process by
 * recording one short run.
 */
export function piTapeProblem(): Promise<string | null> {
	tapeProbe ??= (async () => {
		if (!tapeAvailable()) return "pi-tape/extensions/tape.ts does not exist yet";
		const { runner, cleanup } = tempRunner({ tape: true });
		try {
			const run = await runner.run({ task: "t03", variant: "vanilla" });
			if (run.status !== "done") return `a recording with pi-tape failed: ${run.error}`;
			if (!run.reportFile || run.steps.total === 0) return "pi-tape wrote no report or no steps";
			return null;
		} finally {
			cleanup();
		}
	})();
	return tapeProbe;
}
