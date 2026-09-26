/**
 * HTTP API (INTERFACES.md §5.5) and the dashboard. JSON in and out; errors are
 * `{"error": "…"}` with a 4xx/5xx status.
 *
 * POST bodies must be `application/json`: browsers cannot send that cross-origin without a
 * preflight (which this server never approves), so web pages cannot start runs here.
 */

import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { captureArchive, DEFAULT_ARCHIVE_MAX_BYTES, restoreArchive } from "./archive.ts";
import { loadTasks, loadVariants, taskSummary } from "./bench.ts";
import { compareRun } from "./compare.ts";
import { gateName, type GateRequest, runGate } from "./gate.ts";
import { exportRunToGit, gitStatus } from "./git-export.ts";
import { DASHBOARD_HTML, piPackage, RUNNER_VERSION } from "./paths.ts";
import type { ForkRequest, ReplayRequest, Runner, RunRequest, StartedRun } from "./runs.ts";
import { readTapeFromSessionFile } from "./tape.ts";
import { errorMessage, isSafeName, UserError } from "./util.ts";

const MAX_BODY = 32 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: string, type: string): void {
	res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
	send(res, status, `${JSON.stringify(value, null, 2)}\n`, "application/json; charset=utf-8");
}

async function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Record<string, unknown>> {
	if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
		throw new UserError("POST bodies must be sent as application/json", 415);
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > limit) throw new UserError("request body too large", 413);
		chunks.push(chunk as Buffer);
	}
	let body: unknown;
	try {
		body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
	} catch {
		throw new UserError("request body is not valid JSON");
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new UserError("request body must be a JSON object");
	return body as Record<string, unknown>;
}

function str(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
	const value = body[key];
	if (value === undefined || value === null) {
		if (required) throw new UserError(`"${key}" is required`);
		return undefined;
	}
	if (typeof value !== "string" || value === "") throw new UserError(`"${key}" must be a non-empty string`);
	return value;
}

function strings(body: Record<string, unknown>, key: string): string[] | undefined {
	const value = body[key];
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new UserError(`"${key}" must be an array of strings`);
	return value as string[];
}

export function createApiServer(runner: Runner, log: (line: string) => void = () => {}): Server {
	const store = runner.store;
	/** Gates started with async: true, by report name, until they finish. */
	const runningGates = new Map<string, Promise<unknown>>();
	let archiveBusy = false;
	let comparisonsBusy = 0;

	/** Starts a run; answers when it finishes, or at once with {id, status} when async. */
	async function respondToRun(res: ServerResponse, body: Record<string, unknown>, started: Promise<StartedRun>): Promise<void> {
		const { id, done } = await started;
		if (body.async === true) {
			void done.catch((err) => log(`run ${id} failed: ${errorMessage(err)}`));
			sendJson(res, 202, { id, status: "running" });
		} else {
			sendJson(res, 200, await done);
		}
	}

	function tapeFields(body: Record<string, unknown>): Pick<ReplayRequest, "tape" | "tapeUrl"> {
		const tape = body.tape;
		if (tape !== undefined && tape !== null && (typeof tape !== "object" || Array.isArray(tape))) {
			throw new UserError('"tape" must be a tape JSON object');
		}
		return { tape: (tape ?? undefined) as ReplayRequest["tape"], tapeUrl: str(body, "tapeUrl", false) };
	}

	async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const token = process.env.TAPEDECK_API_TOKEN;
		if (token) {
			const expected = Buffer.from(`Bearer ${token}`);
			const actual = Buffer.from(req.headers.authorization ?? "");
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UserError("runner authentication required", 401);
		}
		const url = new URL(req.url ?? "/", "http://localhost");
		const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
		const method = req.method ?? "GET";
		if (archiveBusy && method !== "GET") throw new UserError("archive operation in progress", 409);
		const at = (m: string, ...pattern: string[]) =>
			method === m && parts.length === pattern.length && pattern.every((p, i) => p.startsWith(":") || p === parts[i]);

		if (at("GET")) {
			if (!existsSync(DASHBOARD_HTML)) throw new UserError("dashboard not found", 404);
			return send(res, 200, readFileSync(DASHBOARD_HTML, "utf8"), "text/html; charset=utf-8");
		}
		if (at("GET", "api", "health")) {
			return sendJson(res, 200, { ok: true, version: RUNNER_VERSION, pi: piPackage().version, store: store.home, tape: runner.tape });
		}
		if (at("GET", "api", "tasks")) return sendJson(res, 200, loadTasks().map(taskSummary));
		if (at("GET", "api", "variants")) return sendJson(res, 200, loadVariants());
		if (at("GET", "api", "agent", "archive") || at("POST", "api", "agent", "restore")) {
			if (archiveBusy || comparisonsBusy || runningGates.size) throw new UserError("wait for active operations before capturing or restoring", 409);
			archiveBusy = true;
			try {
				if (method === "GET") return sendJson(res, 200, await captureArchive(store));
				const body = await readBody(req, DEFAULT_ARCHIVE_MAX_BYTES * 2);
				const restored = await restoreArchive(body.archive, store.home);
				return sendJson(res, 200, { restored: true, store: restored.home, runs: restored.listRuns().length });
			} finally { archiveBusy = false; }
		}
		if (at("POST", "api", "comparisons")) {
			const body = await readBody(req);
			if (archiveBusy) throw new UserError("archive operation in progress", 409);
			comparisonsBusy++;
			try {
				return sendJson(res, 200, await compareRun(runner, {
					from: str(body, "from", true) as string,
					variant: str(body, "variant", true) as string,
					model: str(body, "model", false), forkAt: body.forkAt as number | undefined,
					auto: body.auto === true, lenient: strings(body, "lenient"),
				}));
			} finally { comparisonsBusy--; }
		}
		if (at("GET", "api", "comparisons", ":id")) {
			if (!isSafeName(parts[2])) throw new UserError("invalid comparison ID");
			const file = join(store.home, "comparisons", `${parts[2]}.json`);
			if (!existsSync(file)) throw new UserError("comparison not found", 404);
			return sendJson(res, 200, JSON.parse(readFileSync(file, "utf8")));
		}
		if (at("GET", "api", "git", ":task")) return sendJson(res, 200, await gitStatus(store, parts[2]));
		if (at("POST", "api", "git", "exports")) {
			const body = await readBody(req);
			const destination = process.env.TAPEDECK_GIT_DESTINATION;
			if (!destination) throw new UserError("set TAPEDECK_GIT_DESTINATION on the runner before exporting", 409);
			const result = await exportRunToGit(store, {
				runId: str(body, "runId", true) as string, branch: str(body, "branch", true) as string,
				destination, remote: str(body, "remote", false) ?? process.env.TAPEDECK_GIT_REMOTE, push: body.push === true,
			});
			return sendJson(res, result.status === "push-failed" ? 502 : 200, result);
		}
		if (at("GET", "api", "runs")) {
			const filter = { task: url.searchParams.get("task") ?? undefined, variant: url.searchParams.get("variant") ?? undefined, kind: url.searchParams.get("kind") ?? undefined };
			return sendJson(res, 200, store.listRuns(filter));
		}
		if (parts[0] === "api" && parts[1] === "runs" && parts.length >= 3 && method === "GET") {
			const run = store.readRun(parts[2]);
			if (!run) throw new UserError(`unknown run "${parts[2]}"`, 404);
			const runDir = store.runDir(run.id);
			if (at("GET", "api", "runs", ":id")) {
				const reportPath = run.reportFile ? join(store.home, run.reportFile) : null;
				const report = reportPath && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
				return sendJson(res, 200, { ...run, report });
			}
			const sessionPath = join(runDir, "session.jsonl");
			if (at("GET", "api", "runs", ":id", "session")) {
				if (!existsSync(sessionPath)) throw new UserError(`run ${run.id} has no session file`, 404);
				return send(res, 200, readFileSync(sessionPath, "utf8"), "application/x-ndjson; charset=utf-8");
			}
			if (at("GET", "api", "runs", ":id", "tape")) {
				if (!existsSync(sessionPath)) throw new UserError(`run ${run.id} has no session file`, 404);
				try {
					return sendJson(res, 200, readTapeFromSessionFile(sessionPath, { id: run.id }));
				} catch (err) {
					throw new UserError(errorMessage(err), 409);
				}
			}
		}
		if (at("POST", "api", "runs")) {
			const body = await readBody(req);
			const request: RunRequest = { task: str(body, "task", true) as string, variant: str(body, "variant", true) as string, model: str(body, "model", false) };
			return respondToRun(res, body, runner.startRun(request));
		}
		if (at("POST", "api", "forks")) {
			const body = await readBody(req);
			const forkAt = body.forkAt;
			if (forkAt !== undefined && forkAt !== null && !(Number.isInteger(forkAt) && (forkAt as number) >= 1)) {
				throw new UserError('"forkAt" must be an integer >= 1');
			}
			const request: ForkRequest = {
				from: str(body, "from", true) as string,
				variant: str(body, "variant", true) as string,
				forkAt: (forkAt ?? undefined) as number | undefined,
				lenient: strings(body, "lenient"),
				auto: body.auto === true,
				model: str(body, "model", false),
				...tapeFields(body),
			};
			return respondToRun(res, body, runner.startFork(request));
		}
		if (at("POST", "api", "replays")) {
			const body = await readBody(req);
			const request: ReplayRequest = { from: str(body, "from", true) as string, variant: str(body, "variant", true) as string, ...tapeFields(body) };
			return respondToRun(res, body, runner.startReplay(request));
		}
		if (at("POST", "api", "gate")) {
			const body = await readBody(req);
			const repeat = body.repeat;
			if (repeat !== undefined && !(Number.isInteger(repeat) && (repeat as number) >= 1)) throw new UserError('"repeat" must be an integer >= 1');
			const request: GateRequest = {
				candidate: str(body, "candidate", true) as string,
				baseline: str(body, "baseline", false),
				repeat: repeat as number | undefined,
				tasks: strings(body, "tasks"),
				model: str(body, "model", false),
				name: str(body, "name", false),
			};
			if (request.name !== undefined && !isSafeName(request.name)) throw new UserError('"name" may only use letters, digits, ".", "_" and "-"');
			if (body.async === true) {
				const name = gateName(request, request.model ?? runner.model);
				if (runningGates.has(name)) throw new UserError(`gate ${name} is already running`, 409);
				const gate = runGate(runner, request, log)
					.catch((err) => log(`gate ${name} failed: ${errorMessage(err)}`))
					.finally(() => runningGates.delete(name));
				runningGates.set(name, gate);
				return sendJson(res, 202, { name, status: "running" });
			}
			return sendJson(res, 200, await runGate(runner, request, log));
		}
		if (at("GET", "api", "reports")) return sendJson(res, 200, store.listReports());
		if (at("GET", "api", "reports", ":name")) {
			const report = store.readReport(parts[2]);
			if (report) return sendJson(res, 200, report);
			if (runningGates.has(parts[2])) return sendJson(res, 202, { name: parts[2], status: "running" });
			throw new UserError(`unknown report "${parts[2]}"`, 404);
		}
		throw new UserError(`no route for ${method} ${url.pathname}`, 404);
	}

	return createServer((req, res) => {
		route(req, res).catch((err) => {
			const status = err instanceof UserError ? err.status : 500;
			if (!res.headersSent) sendJson(res, status, { error: errorMessage(err) });
			else res.end();
		});
	});
}
