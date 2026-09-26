/** Plain-text rendering of runs and gate reports for the CLI. */

import type { Divergence, GateReport, PassRates, RunRecord } from "./types.ts";

/** Left-aligned columns; columns listed in `right` are right-aligned (numbers). */
export function table(header: string[], rows: string[][], right: number[] = []): string {
	const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
	const line = (cells: string[]) =>
		cells
			.map((cell, i) => (right.includes(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
			.join("  ")
			.trimEnd();
	return [line(header), ...rows.map(line)].join("\n");
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const dollars = (n: number) => `$${n.toFixed(4)}`;
const percent = (x: number) => `${Math.round(x * 100)}%`;

export function verdict(pass: boolean | null): string {
	return pass === null ? "-" : pass ? "PASS" : "fail";
}

function divergenceText(d: Divergence | null): string {
	return d ? `step ${d.step} (${d.kind})` : "none";
}

function runOutcome(run: RunRecord): string {
	if (run.status === "running") return "running";
	if (run.status === "error") return "ERROR";
	return run.kind === "replay" ? (run.divergence ? "diverged" : "matched") : verdict(run.pass);
}

/** One table of runs, newest first. */
export function formatRuns(runs: RunRecord[]): string {
	if (runs.length === 0) return "No runs yet.";
	const rows = runs.map((run) => [
		run.id,
		run.kind + (run.forkAt ? `@${run.forkAt}` : ""),
		run.task,
		run.variant,
		runOutcome(run),
		`${run.steps.total} (${run.steps.replayed} replayed)`,
		run.kind === "run" ? "" : divergenceText(run.divergence),
		int(run.usage.totalTokens),
		dollars(run.usage.cost),
	]);
	const errors = runs.filter((r) => r.status === "error").map((r) => `${r.id}: ${r.error}`);
	const text = table(["id", "kind", "task", "variant", "result", "steps", "divergence", "tokens", "cost"], rows, [7, 8]);
	return errors.length > 0 ? `${text}\n\nErrors:\n${errors.map((e) => `  ${e}`).join("\n")}` : text;
}

function rateRow(label: string, rates: PassRates): string[] {
	const cell = (x: number | undefined) => (x === undefined ? "-" : percent(x));
	return [label, cell(rates["held-in"]), cell(rates["held-out"])];
}

export function formatGate(report: GateReport): string {
	const s = report.summary;
	const repeat = Math.max(0, ...report.rows.map((r) => r.rerunRuns.length));
	const rows = report.rows.map((r) => [
		r.task,
		r.split,
		verdict(r.baselinePass),
		verdict(r.forkPass),
		r.forkAt === null ? "-" : String(r.forkAt),
		divergenceText(r.divergence),
		r.rerunPass.map(verdict).join(" "),
		r.agree ? "yes" : "NO",
		int(r.forkUsage.totalTokens),
		int(r.rerunRuns.length > 0 ? r.rerunUsage.totalTokens / r.rerunRuns.length : 0),
	]);
	const agreed = report.rows.filter((r) => r.agree).length;
	return [
		`Gate ${report.name}: ${report.candidate} vs ${report.baseline}, model ${report.model}, ${repeat} rerun(s) per task`,
		`created ${report.createdAt}`,
		"",
		table(["task", "split", "baseline", "fork", "forkAt", "divergence", "reruns", "agree", "fork tokens", "rerun tokens"], rows, [8, 9]),
		"",
		`Agreement    ${agreed}/${s.n} tasks (${percent(s.agreement)}): fork verdict = majority of the reruns`,
		`Tokens       forks ${int(s.forkTokens)} vs full reruns ${int(s.rerunTokens)} (one per task): forks save ${percent(s.tokenSavings)}`,
		`Cost         forks ${dollars(s.forkCost)} vs full reruns ${dollars(s.rerunCost)}`,
		"",
		table(
			["pass rate", "held-in", "held-out"],
			[
				rateRow(`baseline (${report.baseline})`, s.baselinePassRate),
				rateRow(`fork (${report.candidate})`, s.candidateForkPassRate),
				rateRow(`rerun (${report.candidate})`, s.candidateRerunPassRate),
			],
			[1, 2],
		),
	].join("\n");
}
