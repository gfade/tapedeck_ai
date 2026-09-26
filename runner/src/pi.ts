/**
 * Starting pi (INTERFACES.md §5.3): argv, environment, the JSON event stream, timeouts.
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { HARNESS_EXTENSION, piPackage, SCRIPTED_EXTENSION, TAPE_EXTENSION, TOY_MODEL } from "./paths.ts";
import { cleanEnv, UserError } from "./util.ts";

export function isScripted(model: string): boolean {
	return model.startsWith("scripted/");
}

/** `provider/modelId`, split at the first slash (`openrouter/anthropic/claude-sonnet-4.5`). */
export function checkModel(model: string): void {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) throw new UserError(`model must be provider/modelId, got "${model}"`);
}

export function tapeAvailable(): boolean {
	return existsSync(TAPE_EXTENSION);
}

export interface PiInvocation {
	model: string;
	/** Load pi-tape and select `tape/main`; false runs the upstream model directly (no tape). */
	tape: boolean;
	sessionDir: string;
	prompt: string;
}

/** The pi command line, minus `node`: extension order is scripted, variant, pi-tape last. */
export function piArgs(inv: PiInvocation): string[] {
	const extensions = [...(isScripted(inv.model) ? [SCRIPTED_EXTENSION] : []), HARNESS_EXTENSION, ...(inv.tape ? [TAPE_EXTENSION] : [])];
	return [
		piPackage().cli,
		"--mode",
		"json",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--session-dir",
		inv.sessionDir,
		"--model",
		inv.tape ? "tape/main" : inv.model,
		...extensions.flatMap((file) => ["-e", file]),
		// "--" so that a prompt starting with "-" is not taken for an option.
		"--",
		inv.prompt,
	];
}

/** pi's environment: the runner's (see cleanEnv; provider keys pass through) plus `vars`. */
export function piEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
	return { ...cleanEnv(), PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", ...vars };
}

/** The environment a model needs beyond the runner's: the toy script for scripted models. */
export function modelEnv(model: string): Record<string, string> {
	return isScripted(model) ? { PI_SCRIPTED_MODEL: TOY_MODEL } : {};
}

export interface PiLaunch {
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	/** pi's stdout (the JSON event stream) is copied here. */
	eventsFile: string;
	stderrFile: string;
	timeoutMs: number;
	signal?: AbortSignal;
	onEvent?: (event: Record<string, unknown>) => void;
}

export interface PiExit {
	code: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	aborted: boolean;
	durationMs: number;
	/** errorMessage of the last assistant message, when it ended in error or abort. */
	modelError: string | null;
}

const KILL_GRACE_MS = 5000;

/**
 * Runs pi to completion. stdin is /dev/null (pi waits on an open pipe). pi gets its own
 * process group so a timeout or abort also stops the commands its tools started.
 */
export function launchPi(launch: PiLaunch): Promise<PiExit> {
	return new Promise((resolvePromise, reject) => {
		const started = Date.now();
		const events = createWriteStream(launch.eventsFile);
		const stderr = createWriteStream(launch.stderrFile);
		const child = spawn(process.execPath, launch.args, {
			cwd: launch.cwd,
			env: launch.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		let timedOut = false;
		let aborted = false;
		let modelError: string | null = null;
		let killTimer: NodeJS.Timeout | undefined;

		const kill = () => {
			const signalGroup = (signal: NodeJS.Signals) => {
				try {
					if (child.pid !== undefined) process.kill(-child.pid, signal);
				} catch {
					// already gone
				}
			};
			signalGroup("SIGTERM");
			killTimer ??= setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, launch.timeoutMs);
		const onAbort = () => {
			aborted = true;
			kill();
		};
		if (launch.signal?.aborted) onAbort();
		launch.signal?.addEventListener("abort", onAbort);

		// Strict JSONL: split on LF only (JSON strings may contain U+2028, which readline splits on).
		let pending: Buffer = Buffer.alloc(0);
		const handleLine = (line: Buffer) => {
			const text = line.toString("utf8").replace(/\r$/, "");
			if (!text) return;
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(text);
			} catch {
				return;
			}
			if (event.type === "message_end") {
				const message = event.message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
				if (message?.role === "assistant") {
					const failed = message.stopReason === "error" || message.stopReason === "aborted";
					modelError = failed ? message.errorMessage || `model response ended with ${message.stopReason}` : null;
				}
			}
			launch.onEvent?.(event);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			events.write(chunk);
			pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
			let newline = pending.indexOf(0x0a);
			while (newline >= 0) {
				handleLine(pending.subarray(0, newline));
				pending = pending.subarray(newline + 1);
				newline = pending.indexOf(0x0a);
			}
		});
		child.stderr.pipe(stderr, { end: false });

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			launch.signal?.removeEventListener("abort", onAbort);
			if (pending.length) handleLine(pending);
			let open = 2;
			const done = () => {
				if (--open === 0) resolvePromise({ code, signal, timedOut, aborted, durationMs: Date.now() - started, modelError });
			};
			events.end(done);
			stderr.end(done);
		});
	});
}
