import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { validateAdaptiveVariant } from "../harness/adaptive-policy.ts";
import { getTask, getVariant } from "./bench.ts";
import { Runner } from "./runs.ts";
import { Store } from "./store.ts";
import type { RunRecord, Variant } from "./types.ts";
import { readJson, UserError, writeJson } from "./util.ts";

const TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const FLOOR = {
	denyPaths: ["(^|/)\\.env($|\\.)", "(^|/)\\.ssh(/|$)"],
	denyCommands: ["(^|[\\s;&|(])(curl|wget)(\\s|$)", "git\\s+push", "rm\\s+(-[^\\s]*r[^\\s]*f|-[^\\s]*f[^\\s]*r)"],
};

export interface HarnessProfile {
	format: "tapedeck.harness/v1";
	id: string;
	parent: string | null;
	user: string;
	tasks: string[];
	model: string;
	variant: Variant;
	createdAt: string;
}

export function assertSafetyFloor(variant: Variant): void {
	validateAdaptiveVariant(variant);
	if (!variant.tools?.length || variant.tools.some((tool) => !TOOLS.includes(tool))) throw new UserError("invalid harness tool access");
	const limit = variant.context?.maxToolResultChars;
	if (!Number.isInteger(limit) || limit! < 512 || limit! > 32000) throw new UserError("invalid context policy");
	for (const key of ["denyPaths", "denyCommands"] as const) {
		if (FLOOR[key].some((rule) => !variant.policy?.[key]?.includes(rule))) throw new UserError(`immutable safety floor missing: ${key}`);
	}
	if ((variant.rules?.length ?? 0) > 16 || variant.rules?.some((rule) => typeof rule !== "string" || rule.length > 2000)) throw new UserError("invalid harness rules");
	for (const source of [...(variant.policy?.denyPaths ?? []), ...(variant.policy?.denyCommands ?? [])]) new RegExp(source);
}

export function initialProfile(user: string, tasks: string[], model: string): HarnessProfile {
	return {
		format: "tapedeck.harness/v1", id: randomUUID(), parent: null, user, tasks, model, createdAt: new Date().toISOString(),
		variant: { name: "adaptive-base", rules: [], tools: [...TOOLS], context: { maxToolResultChars: 16000 }, policy: structuredClone(FLOOR) },
	};
}

export function proposeProfile(parent: HarnessProfile, evidence: string): { profile: HarnessProfile; reasons: string[] } {
	assertSafetyFloor(parent.variant);
	const profile = structuredClone(parent);
	profile.id = randomUUID();
	profile.parent = parent.id;
	profile.createdAt = new Date().toISOString();
	profile.variant.name = `adaptive-${profile.id.slice(0, 8)}`;
	const reasons: string[] = [];
	const rules = new Set(profile.variant.rules);
	if (/npm (test|run)|Makefile|\.\/tasks/.test(evidence)) {
		for (const rule of getVariant("rule-taskrunner").rules ?? []) rules.add(rule);
		reasons.push("Recorded test commands suggest repository-specific setup and test-runner guidance.");
	}
	if (/src\/generated\/|schema\/|generated.file/i.test(evidence)) {
		for (const rule of getVariant("rule-generated").rules ?? []) rules.add(rule);
		profile.variant.policy!.denyCommands = [...new Set([...profile.variant.policy!.denyCommands!, "sed\\s+-i.*src/generated/"])];
		reasons.push("Recorded generated-file access suggests schema-first rules and a direct sed-edit gate.");
	}
	profile.variant.rules = [...rules];
	const observed = TOOLS.filter((tool) => new RegExp(`"toolName"\\s*:\\s*"${tool}"`).test(evidence));
	if (observed.length) {
		profile.variant.tools = parent.variant.tools!.filter((tool) => observed.includes(tool));
		reasons.push("Restrict direct tool calls to the observed task workflow; bash remains a broad capability.");
	}
	if (evidence.length > 32000 && profile.variant.context!.maxToolResultChars > 8000) {
		profile.variant.context!.maxToolResultChars = 8000;
		reasons.push("Large recorded trace: trial a smaller per-tool-result context budget.");
	}
	assertSafetyFloor(profile.variant);
	return { profile, reasons };
}

export function promotionDecision(baseline: RunRecord[], forks: RunRecord[], fresh: RunRecord[][], parent: HarnessProfile, candidate: HarnessProfile): { promote: boolean; reason: string } {
	assertSafetyFloor(candidate.variant);
	assertSafetyFloor(parent.variant);
	for (const key of ["denyPaths", "denyCommands"] as const) {
		if (parent.variant.policy?.[key]?.some((rule) => !candidate.variant.policy?.[key]?.includes(rule))) return { promote: false, reason: "Guardrail removal requires human approval." };
	}
	if (candidate.variant.tools!.some((tool) => !parent.variant.tools!.includes(tool))) return { promote: false, reason: "Tool authority expansion requires human approval." };
	if (baseline.length === 0 || forks.length !== baseline.length || fresh.length !== baseline.length || fresh.some((runs) => runs.length < 2)) return { promote: false, reason: "Incomplete evaluation evidence." };
	if (baseline.some((run) => run.status !== "done")) return { promote: false, reason: "Baseline infrastructure failed." };
	if (forks.some((run) => run.status !== "done" || run.pass !== true) || fresh.flat().some((run) => run.status !== "done" || run.pass !== true)) return { promote: false, reason: "Every fork and independent fresh verification must pass; keep previous profile." };
	const repaired = baseline.some((run) => run.pass !== true);
	const before = baseline.reduce((sum, run) => sum + run.usage.totalTokens, 0);
	const after = fresh.reduce((sum, runs) => sum + runs.reduce((total, run) => total + run.usage.totalTokens, 0) / runs.length, 0);
	const reducedTools = candidate.variant.tools!.length < parent.variant.tools!.length;
	const promote = repaired || (before > 0 && after < before * 0.95) || reducedTools;
	return { promote, reason: repaired ? "Verified failing tasks repaired without evaluation-set regressions." : promote ? "All checks pass with fewer direct tools or at least 5% fewer fresh-run tokens." : "No measured improvement; retain previous profile." };
}

function scopeDirectory(store: Store, user: string, tasks: string[], model: string): string {
	const scope = createHash("sha256").update(JSON.stringify({ user, tasks: [...tasks].sort(), model })).digest("hex").slice(0, 24);
	return join(store.home, "reports", "harness", scope);
}

export async function evolve(runner: Runner, options: { user: string; tasks: string[]; repeat?: number }) {
	if (!options.user.trim() || options.user.length > 100) throw new UserError("user scope must be 1–100 characters");
	const tasks = [...new Set(options.tasks)].sort();
	if (!tasks.length || tasks.length > 12) throw new UserError("choose 1–12 evaluation tasks");
	for (const task of tasks) getTask(task);
	const repeat = options.repeat ?? 2;
	if (!Number.isInteger(repeat) || repeat < 2 || repeat > 5) throw new UserError("repeat must be 2–5");
	if (!runner.tape) throw new UserError("evolution requires recorded tapes");
	const directory = scopeDirectory(runner.store, options.user, tasks, runner.model);
	mkdirSync(directory, { recursive: true });
	const lock = join(directory, "evolution.lock");
	try { mkdirSync(lock); } catch { throw new UserError("This scope is already evolving; inspect evolution.lock if a process crashed."); }
	const reportId = randomUUID();
	const report: Record<string, unknown> = { format: "tapedeck.evolution/v1", id: reportId, startedAt: new Date().toISOString(), user: options.user, tasks, model: runner.model, status: "evaluating", baseline: [], replays: [], forks: [], fresh: [] };
	const save = () => writeJson(join(directory, `${reportId}.json`), report);
	try {
		const activeFile = join(directory, "active.json");
		const parent = existsSync(activeFile) ? readJson<HarnessProfile>(activeFile) : initialProfile(options.user, tasks, runner.model);
		assertSafetyFloor(parent.variant);
		if (parent.user !== options.user || parent.model !== runner.model || JSON.stringify(parent.tasks) !== JSON.stringify(tasks)) throw new UserError("active profile scope mismatch");
		report.parent = parent;
		save();
		const baseline: RunRecord[] = [];
		const replays: RunRecord[] = [];
		let evidence = "";
		for (const task of tasks) {
			const run = await runner.run({ task, variant: parent.variant.name, variantSpec: parent.variant });
			baseline.push(run);
			report.baseline = baseline;
			save();
			if (run.status !== "done") throw new UserError(`baseline failed: ${run.id}`);
			const replay = await runner.replay({ from: run.id, variant: parent.variant.name });
			replays.push(replay);
			report.replays = replays;
			save();
			if (replay.status !== "done" || replay.divergence || replay.steps.live !== 0 || replay.steps.replayed !== run.steps.total || replay.usage.totalTokens !== 0) throw new UserError(`strict replay failed: ${replay.id}`);
			const events = readFileSync(join(runner.store.runDir(run.id), "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string });
			evidence += events.filter((event) => ["tool_execution_start", "tool_execution_end"].includes(event.type)).map((event) => JSON.stringify(event)).join("\n") + (run.verify?.output ?? "");
		}
		const proposal = proposeProfile(parent, evidence);
		report.proposal = proposal;
		save();
		const forks: RunRecord[] = [];
		const fresh: RunRecord[][] = [];
		for (const run of baseline) {
			forks.push(await runner.fork({ from: run.id, variant: proposal.profile.variant.name, variantSpec: proposal.profile.variant, forkAt: 1, lenient: ["system"] }));
			report.forks = forks;
			save();
			const repeats: RunRecord[] = [];
			fresh.push(repeats);
			for (let index = 0; index < repeat; index++) {
				repeats.push(await runner.run({ task: run.task, variant: proposal.profile.variant.name, variantSpec: proposal.profile.variant }));
				report.fresh = fresh;
				save();
			}
		}
		const decision = promotionDecision(baseline, forks, fresh, parent, proposal.profile);
		report.decision = decision;
		report.status = decision.promote ? "promoted" : "rejected";
		report.finishedAt = new Date().toISOString();
		save();
		if (decision.promote) {
			writeJson(join(directory, `${proposal.profile.id}.profile.json`), proposal.profile);
			writeJson(activeFile, proposal.profile);
		}
		return { report: join(directory, `${reportId}.json`), ...report };
	} catch (error) {
		report.status = "error";
		report.error = error instanceof Error ? error.message : String(error);
		save();
		throw error;
	} finally { rmSync(lock, { recursive: true, force: true }); }
}

export async function evolveCommand(argv: string[]): Promise<number | null> {
	if (!["evolve", "adaptive-run"].includes(argv[0])) return null;
	const { values } = parseArgs({ args: argv.slice(1), options: {
		home: { type: "string" }, model: { type: "string" }, user: { type: "string", default: "local" },
		task: { type: "string", multiple: true }, repeat: { type: "string", default: "2" }, timeout: { type: "string", default: "300" },
	} });
	const tasks = [...new Set(values.task ?? ["t01", "t04"])].sort();
	const timeout = Number(values.timeout);
	if (!Number.isFinite(timeout) || timeout < 1 || timeout > 1800) throw new UserError("timeout must be 1–1800 seconds");
	const runner = new Runner({ store: Store.open(values.home), model: values.model, timeoutMs: timeout * 1000, jobs: 1, log: (line) => console.error(line) });
	const abort = () => runner.abortAll();
	process.once("SIGINT", abort);
	process.once("SIGTERM", abort);
	try {
		if (argv[0] === "evolve") console.log(JSON.stringify(await evolve(runner, { user: values.user!, tasks, repeat: Number(values.repeat) }), null, 2));
		else {
			const file = join(scopeDirectory(runner.store, values.user!, tasks, runner.model), "active.json");
			if (!existsSync(file)) throw new UserError("no promoted harness for this user/task-set/model; run evolve first");
			const profile = readJson<HarnessProfile>(file);
			assertSafetyFloor(profile.variant);
			for (const task of tasks) console.log(JSON.stringify(await runner.run({ task, variant: profile.variant.name, variantSpec: profile.variant }), null, 2));
		}
		return 0;
	} finally {
		process.removeListener("SIGINT", abort);
		process.removeListener("SIGTERM", abort);
	}
}
