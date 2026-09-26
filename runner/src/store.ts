/**
 * The store (INTERFACES.md §5.1): task repos, disposable worktrees, one directory per run,
 * posted tapes and gate reports. Paths inside records are relative to the store root.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DEFAULT_STORE } from "./paths.ts";
import type { GateReport, RunKind, RunRecord, Tape } from "./types.ts";
import { isSafeName, readJson, UserError, writeJson } from "./util.ts";

export interface RunFilter {
	task?: string;
	variant?: string;
	kind?: string;
}

/** Sidecar file naming the runner process that owns a running run. */
const OWNER_FILE = "runner.pid";

export class Store {
	readonly home: string;

	private constructor(home: string) {
		this.home = home;
	}

	/** Opens (creating if needed) the store at `home`, $TAPEDECK_HOME, or <repo>/store. */
	static open(home?: string): Store {
		const store = new Store(resolve(home || process.env.TAPEDECK_HOME || DEFAULT_STORE));
		for (const dir of ["repos", "work", "runs", "tapes", "reports"]) mkdirSync(join(store.home, dir), { recursive: true });
		return store;
	}

	runDir(id: string): string {
		return join(this.home, "runs", id);
	}

	workDir(id: string): string {
		return join(this.home, "work", id);
	}

	repoDir(taskId: string): string {
		return join(this.home, "repos", `${taskId}.git`);
	}

	/** A path inside the store, relative to its root (as run.json stores paths). */
	rel(path: string): string {
		return relative(this.home, path);
	}

	/** `20260926-153012-t01-vanilla-run-a1b2`: UTC time first, so ids sort by time. */
	newRunId(task: string, variant: string, kind: RunKind): string {
		const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
		for (;;) {
			const id = `${stamp}-${task}-${variant}-${kind}-${randomBytes(2).toString("hex")}`;
			if (!existsSync(this.runDir(id))) return id;
		}
	}

	readRun(id: string): RunRecord | undefined {
		if (!isSafeName(id)) return undefined;
		const file = join(this.runDir(id), "run.json");
		return existsSync(file) ? readJson<RunRecord>(file) : undefined;
	}

	getRun(id: string): RunRecord {
		const run = this.readRun(id);
		if (!run) throw new UserError(`unknown run "${id}"`);
		return run;
	}

	writeRun(run: RunRecord): void {
		mkdirSync(this.runDir(run.id), { recursive: true });
		writeJson(join(this.runDir(run.id), "run.json"), run);
	}

	/** All runs, newest first, optionally filtered. */
	listRuns(filter: RunFilter = {}): RunRecord[] {
		const dir = join(this.home, "runs");
		const runs: RunRecord[] = [];
		for (const id of readdirSync(dir)) {
			let run: RunRecord | undefined;
			try {
				run = this.readRun(id);
			} catch {
				continue; // a run.json being replaced right now, or damaged: skip it
			}
			if (!run) continue;
			if (filter.task && run.task !== filter.task) continue;
			if (filter.variant && run.variant !== filter.variant) continue;
			if (filter.kind && run.kind !== filter.kind) continue;
			runs.push(run);
		}
		return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
	}

	/** Records that this process owns a running run (see staleRuns). */
	claim(id: string): void {
		writeFileSync(join(this.runDir(id), OWNER_FILE), `${process.pid}\n`);
	}

	release(id: string): void {
		rmSync(join(this.runDir(id), OWNER_FILE), { force: true });
	}

	/** Runs marked `running` whose owning process is gone. */
	staleRuns(): RunRecord[] {
		return this.listRuns().filter((run) => {
			if (run.status !== "running") return false;
			const file = join(this.runDir(run.id), OWNER_FILE);
			if (!existsSync(file)) return true;
			const pid = Number.parseInt(readFileSync(file, "utf8"), 10);
			if (pid === process.pid) return false;
			try {
				process.kill(pid, 0);
				return false;
			} catch (err) {
				return (err as NodeJS.ErrnoException).code === "ESRCH";
			}
		});
	}

	/** Saves a tape posted inline; returns its absolute path. */
	saveTape(name: string, tape: Tape): string {
		const file = join(this.home, "tapes", `${name}.json`);
		writeJson(file, tape);
		return file;
	}

	reportPath(name: string): string {
		return join(this.home, "reports", `${name}.json`);
	}

	readReport(name: string): GateReport | undefined {
		if (!isSafeName(name)) return undefined;
		const file = this.reportPath(name);
		return existsSync(file) ? readJson<GateReport>(file) : undefined;
	}

	writeReport(report: GateReport): void {
		writeJson(this.reportPath(report.name), report);
	}

	/** Gate report names, newest first. */
	listReports(): string[] {
		const dir = join(this.home, "reports");
		const reports: GateReport[] = [];
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".json")) continue;
			try {
				reports.push(readJson<GateReport>(join(dir, file)));
			} catch {
				// skip damaged files
			}
		}
		return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => r.name);
	}
}
