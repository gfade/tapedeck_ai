/** Small helpers: JSON files, errors, child processes, concurrency. */

import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Writes JSON atomically (temp file + rename), so readers never see half a file. */
export function writeJson(path: string, value: unknown): void {
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, path);
}

/** A problem with the request itself (unknown task, bad argument, …); `status` is the HTTP status. */
export class UserError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Keeps the end of a long text, prefixed with an ellipsis when cut. */
export function tail(text: string, max: number): string {
	return text.length <= max ? text : `…${text.slice(text.length - max)}`;
}

/** Names used in ids and file names: no path separators, no leading dot. */
export function isSafeName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

/**
 * The runner's environment without variables that would steer pi, pi-tape, git or the
 * runner itself from outside (PI_*, GIT_*, TAPEDECK_*). Provider keys pass through.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("PI_") || key.startsWith("GIT_") || key.startsWith("TAPEDECK_")) continue;
		if (key.startsWith("MONGODB_")) continue;
		// Set when the runner itself runs under `node --test`; inherited by a task's own
		// `node --test`, it makes that run skip every test file and exit 0.
		if (key === "NODE_TEST_CONTEXT") continue;
		env[key] = value;
	}
	return env;
}

export interface ProcessResult {
	/** null when the process was killed (timeout). */
	code: number | null;
	/** stdout and stderr interleaved. */
	output: string;
	timedOut: boolean;
	durationMs: number;
}

/** Runs a command to completion in its own process group, killing the group on timeout. */
export function runProcess(command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<ProcessResult> {
	return new Promise((resolvePromise, reject) => {
		const started = Date.now();
		const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
		const chunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => chunks.push(c));
		child.stderr.on("data", (c: Buffer) => chunks.push(c));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
			} catch {
				// already gone
			}
		}, opts.timeoutMs);
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolvePromise({ code: timedOut ? null : code, output: Buffer.concat(chunks).toString("utf8"), timedOut, durationMs: Date.now() - started });
		});
	});
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
	return results;
}

/** Serializes async work per key (e.g. git operations on one task repo). */
export class KeyedMutex {
	private tails = new Map<string, Promise<unknown>>();

	run<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		const result = previous.then(fn, fn);
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(key, settled);
		void settled.then(() => {
			if (this.tails.get(key) === settled) this.tails.delete(key);
		});
		return result;
	}
}
