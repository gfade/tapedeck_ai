/**
 * The Runner executes runs, replays and forks (INTERFACES.md §5.2, §5.3):
 *
 *   plan     validate the request, allocate the run id, resolve the tape source and fork point
 *   launch   write run.json (status running) and hand back the id (async API calls stop here)
 *   execute  worktree at the task base → pi → move the session file → read pi-tape's report
 *            → verify (not for replays) → final run.json → remove the worktree unless kept
 *
 * A run always ends with status done or error: failures anywhere are caught and recorded.
 */

import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getTask, getVariant, variantFile } from "./bench.ts";
import { addWorktree, ensureTaskRepo, removeWorktree } from "./git.ts";
import { checkModel, launchPi, modelEnv, piArgs, piEnv, type PiExit, tapeAvailable } from "./pi.ts";
import type { Store } from "./store.ts";
import { emptyUsageTotals } from "../../pi-tape/src/index.ts";
import { customData, forkAtFromRule, hasTape, loadTape, parseTape, readBranch, summarizeSession } from "./tape.ts";
import type { RunKind, RunRecord, Tape, TapeReport, Task, VerifyResult } from "./types.ts";
import { cleanEnv, errorMessage, readJson, runProcess, tail, UserError, writeJson } from "./util.ts";

export const DEFAULT_MODEL = "scripted/toy";
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 60 * 1000;
const VERIFY_OUTPUT_MAX = 4000;

export interface RunnerOptions {
	store: Store;
	/** Model for new runs (forks and replays default to their parent's model). */
	model?: string;
	/** Record with pi-tape. Defaults to whether pi-tape/extensions/tape.ts exists. */
	tape?: boolean;
	timeoutMs?: number;
	/** Concurrent runs in bench and gate. */
	jobs?: number;
	log?: (line: string) => void;
}

export interface RunRequest {
	task: string;
	variant: string;
	model?: string;
	keep?: boolean;
}

export interface ReplayRequest {
	from: string;
	variant: string;
	/** An inline tape (§4), e.g. an edited one; stored under store/tapes/. */
	tape?: Tape;
	/** A URL serving tape JSON, passed to pi-tape as PI_TAPE_SOURCE. */
	tapeUrl?: string;
	keep?: boolean;
}

export interface ForkRequest extends ReplayRequest {
	forkAt?: number | null;
	lenient?: string[];
	/** Take forkAt and lenient from the variant's fork rule (explicit values win). */
	auto?: boolean;
	model?: string;
}

export interface StartedRun {
	id: string;
	done: Promise<RunRecord>;
}

interface Plan {
	id: string;
	kind: RunKind;
	task: Task;
	variant: string;
	model: string;
	parent: string | null;
	forkAt: number | null;
	lenient: string[];
	tapeSource: string | null;
	keep: boolean;
}

const MODE: Record<RunKind, string> = { run: "record", replay: "replay", fork: "fork" };

export class Runner {
	readonly store: Store;
	readonly model: string;
	readonly tape: boolean;
	readonly timeoutMs: number;
	readonly jobs: number;
	private readonly log: (line: string) => void;
	private readonly active = new Map<string, AbortController>();

	constructor(opts: RunnerOptions) {
		this.store = opts.store;
		this.model = opts.model ?? DEFAULT_MODEL;
		checkModel(this.model);
		this.tape = opts.tape ?? tapeAvailable();
		this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.jobs = opts.jobs ?? 4;
		this.log = opts.log ?? (() => {});
	}

	run(req: RunRequest): Promise<RunRecord> {
		return this.startRun(req).then((started) => started.done);
	}

	fork(req: ForkRequest): Promise<RunRecord> {
		return this.startFork(req).then((started) => started.done);
	}

	replay(req: ReplayRequest): Promise<RunRecord> {
		return this.startReplay(req).then((started) => started.done);
	}

	async startRun(req: RunRequest): Promise<StartedRun> {
		const task = getTask(req.task);
		getVariant(req.variant);
		const model = req.model ?? this.model;
		checkModel(model);
		const id = this.store.newRunId(task.id, req.variant, "run");
		return this.launch({ id, kind: "run", task, variant: req.variant, model, parent: null, forkAt: null, lenient: [], tapeSource: null, keep: Boolean(req.keep) });
	}

	async startReplay(req: ReplayRequest): Promise<StartedRun> {
		return this.launch(await this.planFromTape("replay", req, {}));
	}

	async startFork(req: ForkRequest): Promise<StartedRun> {
		const variant = getVariant(req.variant);
		const plan = await this.planFromTape("fork", req, { model: req.model });
		plan.lenient = req.lenient ?? (req.auto ? (variant.fork?.lenient ?? []) : []);
		if (req.forkAt !== undefined && req.forkAt !== null) {
			if (!Number.isInteger(req.forkAt) || req.forkAt < 1) throw new UserError("forkAt must be an integer >= 1");
			plan.forkAt = req.forkAt;
		} else if (req.auto && variant.fork?.at) {
			plan.forkAt = forkAtFromRule(await tapeFrom(plan.tapeSource as string), variant.fork.at);
		}
		return this.launch(plan);
	}

	/** Aborts every run in flight (they end with status error). */
	abortAll(): void {
		for (const controller of this.active.values()) controller.abort();
	}

	/** Marks runs left `running` by a runner process that died as errors. */
	recoverStaleRuns(): string[] {
		const recovered: string[] = [];
		for (const run of this.store.staleRuns()) {
			const now = new Date();
			this.store.writeRun({
				...run,
				status: "error",
				error: "the runner process stopped before this run finished",
				finishedAt: now.toISOString(),
				durationMs: now.getTime() - Date.parse(run.startedAt),
			});
			this.store.release(run.id);
			recovered.push(run.id);
		}
		return recovered;
	}

	/** Common part of replay and fork plans: parent run, tape source, model. */
	private async planFromTape(kind: RunKind, req: ReplayRequest, opts: { model?: string }): Promise<Plan> {
		if (!this.tape) throw new UserError(`${kind}s need pi-tape: pi-tape/extensions/tape.ts is missing or tapes are disabled (--no-tape)`);
		const parent = this.store.getRun(req.from);
		const task = getTask(parent.task);
		getVariant(req.variant);
		const model = opts.model ?? parent.model;
		checkModel(model);
		const id = this.store.newRunId(task.id, req.variant, kind);
		let tapeSource: string;
		if (req.tape !== undefined) {
			try {
				parseTape(req.tape);
			} catch (err) {
				throw new UserError(`invalid tape: ${errorMessage(err)}`);
			}
			tapeSource = this.store.saveTape(id, req.tape);
		} else if (req.tapeUrl !== undefined) {
			if (!/^https?:\/\//.test(req.tapeUrl)) throw new UserError("tapeUrl must be an http(s) URL");
			tapeSource = req.tapeUrl;
		} else {
			tapeSource = join(this.store.runDir(parent.id), "session.jsonl");
			if (!existsSync(tapeSource) || !hasTape(readBranch(tapeSource))) {
				throw new UserError(`run ${parent.id} has no tape (it was recorded without pi-tape)`);
			}
		}
		return { id, kind, task, variant: req.variant, model, parent: parent.id, forkAt: null, lenient: [], tapeSource, keep: Boolean(req.keep) };
	}

	private launch(plan: Plan): StartedRun {
		const record = this.initialRecord(plan);
		this.store.writeRun(record);
		this.store.claim(plan.id);
		const controller = new AbortController();
		this.active.set(plan.id, controller);
		this.log(`started ${plan.id}`);
		const done = this.execute(plan, record, controller.signal).finally(() => {
			this.active.delete(plan.id);
			this.store.release(plan.id);
		});
		return { id: plan.id, done };
	}

	private initialRecord(plan: Plan): RunRecord {
		return {
			format: "tapedeck.run/v1",
			id: plan.id,
			kind: plan.kind,
			task: plan.task.id,
			split: plan.task.split,
			variant: plan.variant,
			model: plan.model,
			parent: plan.parent,
			forkAt: plan.forkAt,
			lenient: plan.lenient,
			tapeSource: plan.tapeSource,
			status: "running",
			error: null,
			startedAt: new Date().toISOString(),
			finishedAt: null,
			durationMs: null,
			pass: null,
			verify: null,
			steps: { total: 0, replayed: 0, live: 0 },
			usage: emptyUsageTotals(),
			savedUsage: emptyUsageTotals(),
			divergence: null,
			snapshotBase: null,
			snapshotFinal: null,
			sessionFile: null,
			reportFile: null,
			repo: this.store.rel(this.store.repoDir(plan.task.id)),
		};
	}

	private async execute(plan: Plan, initial: RunRecord, signal: AbortSignal): Promise<RunRecord> {
		const store = this.store;
		const runDir = store.runDir(plan.id);
		const workDir = store.workDir(plan.id);
		const reportPath = join(runDir, "tape-report.json");
		let record = initial;
		let worktree = false;
		try {
			const base = await ensureTaskRepo(store, plan.task);
			await addWorktree(store, plan.task.id, workDir, base);
			worktree = true;
			mkdirSync(join(runDir, "agent"), { recursive: true });
			if (process.env.TAPEDECK_MODELS_FILE) {
				const modelsFile = process.env.TAPEDECK_MODELS_FILE;
				const models = readJson<unknown>(modelsFile);
				if (!models || typeof models !== "object" || Array.isArray(models)) throw new UserError("TAPEDECK_MODELS_FILE must contain a models JSON object");
				copyFileSync(modelsFile, join(runDir, "agent", "models.json"));
			}
			const sessionDir = join(runDir, "pi-sessions");
			mkdirSync(sessionDir, { recursive: true });

			const exit = await launchPi({
				args: piArgs({ model: plan.model, tape: this.tape, sessionDir, prompt: plan.task.prompt }),
				cwd: workDir,
				env: piEnv({
					PI_CODING_AGENT_DIR: join(runDir, "agent"),
					TAPEDECK_TASK: plan.task.id,
					TAPEDECK_VARIANT: variantFile(plan.variant),
					...modelEnv(plan.model),
					...(this.tape ? this.tapeEnv(plan, reportPath) : {}),
				}),
				eventsFile: join(runDir, "events.jsonl"),
				stderrFile: join(runDir, "stderr.log"),
				timeoutMs: this.timeoutMs,
				signal,
			});

			const sessionPath = collectSession(runDir);
			const report = this.tape ? readReport(reportPath, sessionPath) : null;
			const problem = exitProblem(exit, this.timeoutMs, join(runDir, "stderr.log")) ?? (sessionPath ? null : "pi wrote no session file") ?? reportProblem(report);
			record = { ...record, ...outcome(sessionPath, report), sessionFile: sessionPath && store.rel(sessionPath), reportFile: report ? store.rel(reportPath) : null };
			if (problem) {
				record = { ...record, status: "error", error: problem };
			} else if (plan.kind === "replay") {
				record = { ...record, status: "done" };
			} else {
				const verify = await runVerifier(plan.task, workDir);
				writeJson(join(runDir, "verify.json"), verify);
				record = { ...record, status: "done", verify, pass: verify.pass };
			}
		} catch (err) {
			record = { ...record, status: "error", error: errorMessage(err) };
		} finally {
			if (worktree && !plan.keep) {
				await removeWorktree(store, plan.task.id, workDir).catch((err) => {
					this.log(`warning: could not remove worktree ${workDir}: ${errorMessage(err)}`);
				});
			}
			const finished = new Date();
			record = { ...record, finishedAt: finished.toISOString(), durationMs: finished.getTime() - Date.parse(record.startedAt) };
			store.writeRun(record);
		}
		this.log(`finished ${record.id}: ${record.status === "error" ? `error: ${record.error}` : record.pass === null ? "no verdict" : record.pass ? "pass" : "fail"}`);
		return record;
	}

	/** PI_TAPE_* for this run (§2.2). */
	private tapeEnv(plan: Plan, reportPath: string): Record<string, string> {
		const env: Record<string, string> = {
			PI_TAPE_MODE: MODE[plan.kind],
			PI_TAPE_UPSTREAM: plan.model,
			PI_TAPE_REPORT: reportPath,
			PI_TAPE_LABEL: plan.variant,
		};
		if (plan.tapeSource) env.PI_TAPE_SOURCE = plan.tapeSource;
		if (plan.forkAt !== null) env.PI_TAPE_FORK_AT = String(plan.forkAt);
		if (plan.lenient.length > 0) env.PI_TAPE_LENIENT = plan.lenient.join(",");
		return env;
	}
}

/** Loads the tape at a source (session file, tape file or URL) to find a fork point. */
async function tapeFrom(source: string): Promise<Tape> {
	try {
		return (await loadTape(source)).tape;
	} catch (err) {
		throw new UserError(`cannot read the tape at ${source}: ${errorMessage(err)}`);
	}
}

/** Moves pi's session file (pi-sessions/<timestamp>_<uuid>.jsonl) to runs/<id>/session.jsonl. */
function collectSession(runDir: string): string | null {
	const dir = join(runDir, "pi-sessions");
	const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort() : [];
	if (files.length === 0) return null;
	const target = join(runDir, "session.jsonl");
	renameSync(join(dir, files[files.length - 1]), target);
	rmSync(dir, { recursive: true, force: true });
	return target;
}

/**
 * pi-tape's report: the PI_TAPE_REPORT file, else the last `tape.report` session entry.
 * Its sessionFile is rewritten to where the session now lives.
 */
function readReport(reportPath: string, sessionPath: string | null): TapeReport | null {
	let report: TapeReport | null = null;
	if (existsSync(reportPath)) {
		report = readJson<TapeReport>(reportPath);
	} else if (sessionPath) {
		report = customData<TapeReport>(readBranch(sessionPath), "tape.report").at(-1) ?? null;
	}
	if (report && sessionPath && report.sessionFile !== sessionPath) {
		report = { ...report, sessionFile: sessionPath };
		writeJson(reportPath, report);
	}
	return report;
}

/** Steps, usage, divergence and snapshots: from the report, else from the session. */
function outcome(sessionPath: string | null, report: TapeReport | null): Partial<RunRecord> {
	if (report) {
		return {
			steps: report.steps,
			usage: report.usage.live,
			savedUsage: report.usage.replayed,
			divergence: report.divergence ?? null,
			snapshotBase: report.snapshots?.base ?? null,
			snapshotFinal: report.snapshots?.final ?? null,
		};
	}
	if (!sessionPath) return {};
	const branch = readBranch(sessionPath);
	return {
		...summarizeSession(branch),
		divergence: customData(branch, "tape.divergence")[0] ?? null,
		snapshotBase: customData(branch, "tape.header")[0]?.snapshotBase ?? null,
		snapshotFinal: customData(branch, "tape.step").at(-1)?.snapshotAfter ?? null,
	};
}

/** Why pi's exit means the run did not complete, or null. */
function exitProblem(exit: PiExit, timeoutMs: number, stderrPath: string): string | null {
	if (exit.timedOut) return `pi timed out after ${Math.round(timeoutMs / 1000)} s and was killed`;
	if (exit.aborted) return "interrupted: the runner was stopped";
	if (exit.code !== 0) {
		const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8").trim() : "";
		const how = exit.code === null ? `was killed by ${exit.signal}` : `exited with code ${exit.code}`;
		return `pi ${how}${stderr ? `: ${tail(stderr, 1000)}` : ""}`;
	}
	if (exit.modelError) return `model error: ${exit.modelError}`;
	return null;
}

function reportProblem(report: TapeReport | null): string | null {
	const errors = report?.errors ?? [];
	return errors.length > 0 ? `pi-tape: ${errors.join("; ")}` : null;
}

function isExecutable(file: string): boolean {
	try {
		accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Runs the task's verifier in the worktree, outside pi. Exit code 0 = pass. */
export async function runVerifier(task: Task, cwd: string): Promise<VerifyResult> {
	const script = join(task.dir, task.verify);
	const [command, args] = isExecutable(script) ? [script, []] : ["sh", [script]];
	const result = await runProcess(command, args, { cwd, env: { ...cleanEnv(), TAPEDECK_TASK: task.id }, timeoutMs: VERIFY_TIMEOUT_MS });
	const output = result.timedOut ? `${result.output}\n[verifier timed out after ${VERIFY_TIMEOUT_MS / 1000} s]` : result.output;
	return { exitCode: result.code, pass: result.code === 0, output: tail(output.trim(), VERIFY_OUTPUT_MAX), durationMs: result.durationMs };
}
