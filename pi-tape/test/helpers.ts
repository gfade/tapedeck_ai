/**
 * Test helpers: temporary git repositories and real pi runs (offline, scripted model).
 *
 * Every pi run gets its own agent dir and session dir under a scratch directory outside the
 * repository; `Scratch.cleanup()` removes everything, worktrees included.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GitWorkspace } from "../src/git.ts";
import { activeBranch, parseSessionJsonl, type SessionEntry } from "../src/session.ts";
import type { DivergenceData, TapeHeaderData, TapeReport, TapeStepData } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const PI_TAPE_DIR = resolve(here, "..");
const REPO_ROOT = resolve(PI_TAPE_DIR, "..");
export const PI_PACKAGE_DIR = resolve(REPO_ROOT, "node_modules/@earendil-works/pi-coding-agent");
const PI_CLI = join(PI_PACKAGE_DIR, "dist/bundle/cli.js");
export const TAPE_EXTENSION = join(PI_TAPE_DIR, "extensions/tape.ts");
export const SCRIPTED_EXTENSION = join(PI_TAPE_DIR, "extensions/scripted.ts");

export const testExtension = (name: string) => join(here, "extensions", name);
export const scriptModel = (name: string) => join(here, "models", name);

const GIT_ENV = {
	GIT_AUTHOR_NAME: "test",
	GIT_AUTHOR_EMAIL: "test@localhost",
	GIT_COMMITTER_NAME: "test",
	GIT_COMMITTER_EMAIL: "test@localhost",
	GIT_AUTHOR_DATE: "@1790000000 +0000",
	GIT_COMMITTER_DATE: "@1790000000 +0000",
};

export function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A scratch directory for one test file. */
export class Scratch {
	readonly dir = mkdtempSync(join(tmpdir(), "pi-tape-test-"));
	private counter = 0;

	path(...parts: string[]): string {
		return join(this.dir, ...parts);
	}

	/** A fresh, unused directory name. */
	next(prefix: string): string {
		return this.path(`${prefix}-${++this.counter}`);
	}

	cleanup(): void {
		rmSync(this.dir, { recursive: true, force: true });
	}
}

/** Create a git repository with one commit holding `files`. Returns the base commit. */
export function makeRepo(dir: string, files: Record<string, string>): string {
	mkdirSync(dir, { recursive: true });
	git(dir, "init", "-q", "-b", "main");
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, name)), { recursive: true });
		writeFileSync(join(dir, name), content);
	}
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "task base");
	return git(dir, "rev-parse", "HEAD");
}

/** A detached worktree of `repo` at `commit` (shares the repository's objects and snapshots). */
export function addWorktree(repo: string, path: string, commit: string): string {
	git(repo, "worktree", "add", "-q", "--detach", path, commit);
	return path;
}

/** The tree id of a working tree (tracked and untracked files, ignored excluded). */
export async function workingTree(dir: string): Promise<string> {
	const workspace = await GitWorkspace.open(dir, { refPrefix: "refs/tapes/test" });
	if (!workspace) throw new Error(`${dir} is not a git working tree`);
	try {
		return await workspace.workingTree();
	} finally {
		workspace.dispose();
	}
}

export interface PiOptions {
	cwd: string;
	scratch: Scratch;
	/** Scripted model module (PI_SCRIPTED_MODEL). */
	script?: string;
	prompt?: string;
	model?: string;
	/** Extensions loaded before pi-tape (pi-tape is always last). */
	extensions?: string[];
	/** Load pi-tape (default true). */
	tape?: boolean;
	env?: Record<string, string>;
	args?: string[];
}

export interface PiRun {
	code: number | null;
	stdout: string;
	stderr: string;
	sessionFile: string;
	/** Every entry of the session file. */
	entries: SessionEntry[];
	/** The active branch. */
	branch: SessionEntry[];
	report: TapeReport | null;
	reportFile: string;
}

/** Run pi once in JSON mode, offline, with the scripted model and pi-tape. */
export async function runPi(options: PiOptions): Promise<PiRun> {
	const runDir = options.scratch.next("pi");
	const sessionDir = join(runDir, "sessions");
	const reportFile = join(runDir, "report.json");
	mkdirSync(join(runDir, "agent"), { recursive: true });
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !key.startsWith("PI_") && !key.startsWith("TEST_")) env[key] = value;
	}
	Object.assign(env, {
		PI_CODING_AGENT_DIR: join(runDir, "agent"),
		PI_OFFLINE: "1",
		PI_SKIP_VERSION_CHECK: "1",
		PI_TELEMETRY: "0",
		PI_SCRIPTED_MODEL: options.script ?? scriptModel("basic.mjs"),
		PI_TAPE_REPORT: reportFile,
		...options.env,
	});
	const extensions = [SCRIPTED_EXTENSION, ...(options.extensions ?? []), ...(options.tape === false ? [] : [TAPE_EXTENSION])];
	const argv = [
		PI_CLI,
		"--mode",
		"json",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--session-dir",
		sessionDir,
		...extensions.flatMap((path) => ["-e", path]),
		"--model",
		options.model ?? "tape/main",
		...(options.args ?? []),
		options.prompt ?? "Fix the task.",
	];
	const child = spawn(process.execPath, argv, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
	child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
	const code = await new Promise<number | null>((resolveCode) => child.on("close", resolveCode));

	const files = existsSync(sessionDir) ? readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl")) : [];
	if (files.length !== 1) throw new Error(`expected one session file, found ${files.length}\nstderr:\n${stderr}`);
	const sessionFile = join(sessionDir, files[0]);
	const entries = parseSessionJsonl(readFileSync(sessionFile, "utf8"));
	const report = existsSync(reportFile) ? (JSON.parse(readFileSync(reportFile, "utf8")) as TapeReport) : null;
	return { code, stdout, stderr, sessionFile, entries, branch: activeBranch(entries), report, reportFile };
}

// ---------------------------------------------------------------------------------------------
// Reading runs

export function customData<T>(run: PiRun, customType: string): T[] {
	return run.branch.filter((e) => e.type === "custom" && e.customType === customType).map((e) => e.data as T);
}

export const headerOf = (run: PiRun) => customData<TapeHeaderData>(run, "tape.header");
export const stepsOf = (run: PiRun) => customData<TapeStepData>(run, "tape.step");
export const divergencesOf = (run: PiRun) => customData<DivergenceData>(run, "tape.divergence");

/** Messages on the active branch (typed loosely: tests check them field by field). */
export function messagesOf(run: PiRun, role?: string): any[] {
	return run.branch
		.filter((e) => e.type === "message")
		.map((e) => e.message as { role: string })
		.filter((m) => role === undefined || m.role === role);
}

/** Text of a message's text blocks. */
export function textOf(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	return (Array.isArray(content) ? content : [])
		.filter((b: { type?: string }) => b.type === "text")
		.map((b: { text?: string }) => b.text)
		.join("\n");
}
