/**
 * The gate (INTERFACES.md §5.4): evaluates a candidate variant against a baseline variant.
 * For every task it takes the latest baseline run (recording one if there is none), forks
 * it with the candidate (tier 2, fork point from the candidate's fork rule) and reruns the
 * candidate from scratch `repeat` times (tier 3). The report says how often the cheap fork
 * reaches the same verdict as the reruns, and how many tokens the fork saves.
 */

import { getTask, getVariant, loadTasks } from "./bench.ts";
import { DEFAULT_MODEL, type Runner } from "./runs.ts";
import type { GateReport, GateRow, PassRates, RunRecord, Split, Task } from "./types.ts";
import { sumUsage } from "../../pi-tape/src/index.ts";
import { errorMessage, pool, UserError } from "./util.ts";

export const DEFAULT_REPEAT = 2;

export interface GateRequest {
	candidate: string;
	baseline?: string;
	/** Full reruns of the candidate per task. */
	repeat?: number;
	/** Task ids; all tasks when empty. */
	tasks?: string[];
	model?: string;
	/** Report name; defaults to `<candidate>-vs-<baseline>` (plus the model unless scripted/toy). */
	name?: string;
}

export function gateName(req: GateRequest, model: string): string {
	const base = `${req.candidate}-vs-${req.baseline ?? "vanilla"}`;
	return req.name ?? (model === DEFAULT_MODEL ? base : `${base}-${model.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
}

/** The newest completed, taped baseline run for a task, if any. */
function latestBaseline(runner: Runner, task: string, variant: string, model: string): RunRecord | undefined {
	return runner.store
		.listRuns({ task, variant, kind: "run" })
		.find((run) => run.model === model && run.status === "done" && run.reportFile !== null && run.pass !== null);
}

/** Majority verdict of the reruns; a tie counts as fail. */
function majority(verdicts: (boolean | null)[]): boolean {
	return verdicts.filter((v) => v === true).length * 2 > verdicts.length;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Mean of 0/1 values per split, over the rows that have that split. */
function passRates(rows: GateRow[], verdicts: (row: GateRow) => (boolean | null)[]): PassRates {
	const rates: PassRates = {};
	for (const split of ["held-in", "held-out"] as Split[]) {
		const all = rows.filter((r) => r.split === split).flatMap(verdicts);
		if (all.length > 0) rates[split] = round4(all.filter((v) => v === true).length / all.length);
	}
	return rates;
}

export function summarize(rows: GateRow[]): GateReport["summary"] {
	const n = rows.length;
	const forkTokens = rows.reduce((s, r) => s + r.forkUsage.totalTokens, 0);
	const forkCost = rows.reduce((s, r) => s + r.forkUsage.cost, 0);
	// Compare one fork with one full rerun per task: the reruns' usage is summed over repeats.
	const perRerun = (r: GateRow, total: number) => (r.rerunRuns.length > 0 ? total / r.rerunRuns.length : 0);
	const rerunTokens = Math.round(rows.reduce((s, r) => s + perRerun(r, r.rerunUsage.totalTokens), 0));
	const rerunCost = rows.reduce((s, r) => s + perRerun(r, r.rerunUsage.cost), 0);
	return {
		n,
		agreement: n > 0 ? round4(rows.filter((r) => r.agree).length / n) : 0,
		forkTokens,
		rerunTokens,
		forkCost: Math.round(forkCost * 1e8) / 1e8,
		rerunCost: Math.round(rerunCost * 1e8) / 1e8,
		tokenSavings: rerunTokens > 0 ? round4(1 - forkTokens / rerunTokens) : 0,
		baselinePassRate: passRates(rows, (r) => [r.baselinePass]),
		candidateForkPassRate: passRates(rows, (r) => [r.forkPass]),
		candidateRerunPassRate: passRates(rows, (r) => r.rerunPass),
	};
}

export async function runGate(runner: Runner, req: GateRequest, log: (line: string) => void = () => {}): Promise<GateReport> {
	const baselineVariant = req.baseline ?? "vanilla";
	getVariant(baselineVariant);
	getVariant(req.candidate);
	const model = req.model ?? runner.model;
	const repeat = req.repeat ?? DEFAULT_REPEAT;
	if (!Number.isInteger(repeat) || repeat < 1) throw new UserError("repeat must be an integer >= 1");
	if (!runner.tape) throw new UserError("the gate forks baseline tapes, so it needs pi-tape (pi-tape/extensions/tape.ts)");
	const tasks: Task[] = req.tasks && req.tasks.length > 0 ? req.tasks.map(getTask) : loadTasks();
	const name = gateName(req, model);

	// 1. A taped baseline per task: the latest one, or a new recording.
	const baselines = await pool(tasks, runner.jobs, async (task) => {
		const existing = latestBaseline(runner, task.id, baselineVariant, model);
		if (existing) return existing;
		log(`${task.id}: no ${baselineVariant} baseline yet, recording one`);
		return runner.run({ task: task.id, variant: baselineVariant, model });
	});

	// 2. Per task: one fork of the baseline and `repeat` full reruns, all in one pool.
	const usable = tasks.map((task, i) => ({ task, baseline: baselines[i] })).filter(({ task, baseline }) => {
		const ok = baseline.status === "done" && baseline.reportFile !== null;
		if (!ok) log(`${task.id}: skipped, baseline ${baseline.id} did not complete (${baseline.error ?? baseline.status})`);
		return ok;
	});
	type Job = { row: number; fork: boolean };
	const jobs: Job[] = usable.flatMap((_, row) => [{ row, fork: true }, ...Array.from({ length: repeat }, () => ({ row, fork: false }))]);
	const results = await pool(jobs, runner.jobs, async (job): Promise<RunRecord | null> => {
		const { task, baseline } = usable[job.row];
		try {
			return job.fork
				? await runner.fork({ from: baseline.id, variant: req.candidate, auto: true })
				: await runner.run({ task: task.id, variant: req.candidate, model });
		} catch (err) {
			log(`${task.id}: ${job.fork ? "fork" : "rerun"} could not start: ${errorMessage(err)}`);
			return null;
		}
	});

	const rows: GateRow[] = [];
	usable.forEach(({ task, baseline }, row) => {
		const mine = jobs.map((job, i) => ({ job, run: results[i] })).filter(({ job }) => job.row === row);
		const fork = mine.find(({ job }) => job.fork)?.run;
		const reruns = mine.filter(({ job, run }) => !job.fork && run !== null).map(({ run }) => run as RunRecord);
		if (!fork) return;
		const rerunPass = reruns.map((r) => r.pass);
		rows.push({
			task: task.id,
			split: task.split,
			baselineRun: baseline.id,
			baselinePass: baseline.pass,
			forkRun: fork.id,
			forkPass: fork.pass,
			forkAt: fork.forkAt,
			divergence: fork.divergence,
			forkUsage: fork.usage,
			savedUsage: fork.savedUsage,
			rerunRuns: reruns.map((r) => r.id),
			rerunPass,
			rerunUsage: sumUsage(reruns.map((r) => r.usage)),
			agree: fork.pass !== null && fork.pass === majority(rerunPass),
		});
	});

	const report: GateReport = {
		format: "tapedeck.gate/v1",
		name,
		candidate: req.candidate,
		baseline: baselineVariant,
		model,
		createdAt: new Date().toISOString(),
		rows,
		summary: summarize(rows),
	};
	runner.store.writeReport(report);
	return report;
}
