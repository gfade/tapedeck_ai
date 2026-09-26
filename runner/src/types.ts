/** Shapes shared across the runner. Field names follow INTERFACES.md exactly. */

import type { DivergenceData as Divergence, UsageTotals as Usage } from "../../pi-tape/src/index.ts";

// Tape formats come from pi-tape's library (§2.5, §2.7, §4). Usage `cost` is the dollar total.
export type { DivergenceData as Divergence, Tape, TapeReport, UsageTotals as Usage } from "../../pi-tape/src/index.ts";

export type Split = "held-in" | "held-out";

/** runner/bench/tasks/<id>/task.json, plus where it lives. */
export interface Task {
	id: string;
	title: string;
	split: Split;
	quirk: string;
	prompt: string;
	verify: string;
	note?: string;
	/** Absolute path of the task directory (not part of task.json). */
	dir: string;
}

/** `fork.at` of a variant (§5.6). `tool` is a tool name or a regex over the whole name. */
export interface ForkRule {
	tool: string;
	argMatches?: Record<string, string>;
}

/** runner/bench/variants/<name>/variant.json (§5.6). */
export interface Variant {
	name: string;
	description?: string;
	rules?: string[];
	policy?: { denyCommands?: string[]; denyPaths?: string[] };
	fork?: { lenient?: string[]; at?: ForkRule };
}

/** runs/<id>/verify.json. `exitCode` is null when the verifier was killed (timeout). */
export interface VerifyResult {
	exitCode: number | null;
	pass: boolean;
	output: string;
	durationMs: number;
}

export type RunKind = "run" | "fork" | "replay";
export type RunStatus = "running" | "done" | "error";

/** runs/<id>/run.json (`tapedeck.run/v1`, §5.2). */
export interface RunRecord {
	format: "tapedeck.run/v1";
	id: string;
	kind: RunKind;
	task: string;
	split: Split;
	variant: string;
	model: string;
	parent: string | null;
	forkAt: number | null;
	lenient: string[];
	tapeSource: string | null;
	status: RunStatus;
	error: string | null;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number | null;
	pass: boolean | null;
	verify: VerifyResult | null;
	steps: { total: number; replayed: number; live: number };
	usage: Usage;
	savedUsage: Usage;
	divergence: Divergence | null;
	snapshotBase: string | null;
	snapshotFinal: string | null;
	sessionFile: string | null;
	reportFile: string | null;
	repo: string;
}

export interface GateRow {
	task: string;
	split: Split;
	baselineRun: string;
	baselinePass: boolean | null;
	forkRun: string;
	forkPass: boolean | null;
	forkAt: number | null;
	divergence: Divergence | null;
	forkUsage: Usage;
	savedUsage: Usage;
	rerunRuns: string[];
	rerunPass: (boolean | null)[];
	rerunUsage: Usage;
	agree: boolean;
}

export type PassRates = Partial<Record<Split, number>>;

/** reports/<name>.json (`tapedeck.gate/v1`, §5.4). */
export interface GateReport {
	format: "tapedeck.gate/v1";
	name: string;
	candidate: string;
	baseline: string;
	model: string;
	createdAt: string;
	rows: GateRow[];
	summary: {
		n: number;
		agreement: number;
		forkTokens: number;
		rerunTokens: number;
		forkCost: number;
		rerunCost: number;
		tokenSavings: number;
		baselinePassRate: PassRates;
		candidateForkPassRate: PassRates;
		candidateRerunPassRate: PassRates;
	};
}
