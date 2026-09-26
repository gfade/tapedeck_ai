import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { captureArchive, restoreArchive } from "./archive.ts";
import { compareRun, type ComparisonRunner } from "./compare.ts";
import { localOllamaUrl, startLocalGateway } from "./local-gateway.ts";
import { Runner } from "./runs.ts";
import { Store } from "./store.ts";
import type { RunRecord } from "./types.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MODELS = [
	{ base: "qwen3.5:2b", alias: "tapedeck-qwen35-2b" },
];

async function ollamaJson(origin: URL, route: string, body?: unknown): Promise<Record<string, unknown>> {
	const response = await fetch(new URL(route, origin), {
		method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {},
		body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) throw new Error(`Ollama ${route} returned HTTP ${response.status}`);
	const result = await response.json() as Record<string, unknown>;
	if (result.error) throw new Error(String(result.error));
	return result;
}

function concise(run: RunRecord, providerRequests: number) {
	return { id: run.id, model: run.model, kind: run.kind, variant: run.variant, status: run.status, pass: run.pass, error: run.error, durationMs: run.durationMs, steps: run.steps, usage: run.usage, providerRequests };
}

export async function localDemo(argv: string[]): Promise<void> {
	const { values } = parseArgs({ args: argv, options: {
		destination: { type: "string" }, model: { type: "string" }, task: { type: "string", default: "t01" },
		timeout: { type: "string", default: "300" }, "setup-only": { type: "boolean" },
	} });
	const selected = values.model ? MODELS.filter(model => model.base === values.model) : MODELS;
	if (!selected.length) throw new Error("--model must be qwen3.5:2b");
	const timeout = Number(values.timeout);
	if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1800) throw new Error("--timeout must be 1–1800 seconds per run");
	const origin = localOllamaUrl(process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");
	const version = await ollamaJson(origin, "/api/version");
	const available = (await ollamaJson(origin, "/api/tags")).models as { name: string; digest: string; size: number; details: unknown }[];
	const missing = selected.filter(model => !available.some(item => item.name === model.base));
	if (missing.length) throw new Error(`Download the real weights first: ${missing.map(model => `ollama pull ${model.base}`).join("; ")}`);
	for (const model of selected) {
		await ollamaJson(origin, "/api/create", { model: model.alias, from: model.base, parameters: { num_ctx: 16384, temperature: 0, seed: 42 }, stream: false });
		console.log(JSON.stringify({ phase: "model-ready", model: model.base, alias: model.alias }));
	}
	if (values["setup-only"]) return;
	const startedAt = new Date().toISOString();
	const output = resolve(values.destination ?? join(ROOT, "agent-exports", `local-demo-${startedAt.replace(/[:.]/g, "-")}`));
	mkdirSync(dirname(output), { recursive: true });
	mkdirSync(output, { mode: 0o700 });
	const write = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
	const gateway = await startLocalGateway({ upstream: origin.href, models: selected.map(model => model.alias), onRequest: record => appendFileSync(join(output, "provider-requests.jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 }) });
	const config = JSON.parse(readFileSync(join(ROOT, "config/models.ollama.json"), "utf8"));
	config.providers.ollama.baseUrl = gateway.url;
	config.providers.ollama.models = config.providers.ollama.models.filter((model: { id: string }) => selected.some(item => item.alias === model.id));
	write("models.json", config);
	const previousConfig = process.env.TAPEDECK_MODELS_FILE;
	process.env.TAPEDECK_MODELS_FILE = join(output, "models.json");
	const store = Store.open(join(output, "store"));
	const runner = new Runner({ store, jobs: 1, timeoutMs: timeout * 1000 });
	const results: Record<string, unknown>[] = [];
	const summary: Record<string, unknown> = {
		format: "tapedeck.local-demo/v1", status: "running", startedAt, task: values.task,
		hardware: { platform: platform(), architecture: arch(), memoryBytes: totalmem() },
		ollamaVersion: version.version,
		settings: { contextWindow: 16384, maxTokens: 2048, temperature: 0, seed: 42, reasoningEffort: "none", timeoutSeconds: timeout },
		models: selected.map(model => ({ ...model, ...available.find(item => item.name === model.base) })),
		results,
		limitations: ["One coding fixture per model, not a general model benchmark.", "Temperature zero and a fixed seed do not guarantee identical inference across runtimes.", "Replay executes no model inference and does not produce a new verifier verdict.", "Local inference has no hosted API charge; wall time includes local computation and task execution.", "Fork skips only the system-prompt comparison to reuse a recorded prefix under an explicitly changed rule.", "Worktrees isolate Git history, not operating-system privileges."],
	};
	write("results.json", summary);
	try {
		for (const model of selected) {
			const identifier = `ollama/${model.alias}`;
			const prefix = model.base;
			gateway.setPhase(`${prefix}:baseline`);
			console.log(JSON.stringify({ phase: "baseline", model: model.base, output }));
			const baseline = await runner.run({ task: values.task, variant: "vanilla", model: identifier });
			const count = (mode: string) => gateway.requests.filter(request => request.phase === `${prefix}:${mode}`).length;
			const entry: Record<string, unknown> = { model: model.base, baseline: concise(baseline, count("baseline")) };
			results.push(entry);
			write("results.json", summary);
			if (baseline.status !== "done" || baseline.steps.total < 1) {
				console.log(JSON.stringify({ phase: "baseline-error", model: model.base, error: baseline.error }));
				continue;
			}
			const measured: ComparisonRunner = {
				store, tape: true,
				startReplay: request => { gateway.setPhase(`${prefix}:replay`); return runner.startReplay(request); },
				startFork: request => { gateway.setPhase(`${prefix}:fork`); return runner.startFork(request); },
				startRun: request => { gateway.setPhase(`${prefix}:rerun`); return runner.startRun(request); },
			};
			console.log(JSON.stringify({ phase: "comparison", model: model.base, baseline: baseline.id }));
			const comparison = await compareRun(measured, { from: baseline.id, variant: "rule-taskrunner", model: identifier, forkAt: Math.min(2, baseline.steps.total), lenient: ["system"] });
			entry.comparisonId = comparison.id;
			entry.status = comparison.status;
			entry.behavior = comparison.summary?.differences;
			for (const mode of ["replay", "fork", "rerun"] as const) {
				const run = comparison.runs[mode];
				entry[mode] = run.id ? concise(store.getRun(run.id), count(mode)) : { status: "error", error: run.error, providerRequests: count(mode) };
			}
			const replay = comparison.runs.replay;
			entry.replayVerified = replay.status === "done" && count("replay") === 0 && replay.usage?.totalTokens === 0 && replay.steps?.live === 0 && comparison.summary?.differences.baselineReplay.equal === true;
			write("results.json", summary);
			console.log(JSON.stringify({ phase: "model-complete", model: model.base, status: comparison.status, replayVerified: entry.replayVerified, outcomes: comparison.summary?.outcomes }));
		}
		await gateway.close();
		summary.status = results.every(entry => entry.status === "done" && entry.replayVerified === true) ? "done" : "partial";
		summary.finishedAt = new Date().toISOString();
		writeFileSync(join(store.home, "reports", "local-demo.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
		if (gateway.requests.length) copyFileSync(join(output, "provider-requests.jsonl"), join(store.home, "reports", "provider-requests.jsonl"));
		const archive = await captureArchive(store);
		writeFileSync(join(output, "Runner.archive.json"), JSON.stringify(archive), { flag: "wx", mode: 0o600 });
		const restored = await restoreArchive(archive, join(output, "restored-store"));
		summary.archive = { files: archive.files.length, gitBundles: archive.gitBundles.length, restoredRuns: restored.listRuns().length };
		summary.finishedAt = new Date().toISOString();
		write("results.json", summary);
		console.log(JSON.stringify({ phase: "complete", status: summary.status, output, results: join(output, "results.json"), archive: summary.archive }));
		if (summary.status !== "done") process.exitCode = 1;
	} catch (error) {
		summary.status = "partial";
		summary.error = error instanceof Error ? error.message : String(error);
		summary.finishedAt = new Date().toISOString();
		write("results.json", summary);
		throw error;
	} finally {
		await gateway.close();
		if (previousConfig === undefined) delete process.env.TAPEDECK_MODELS_FILE;
		else process.env.TAPEDECK_MODELS_FILE = previousConfig;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	localDemo(process.argv.slice(2)).catch(error => { console.error(`Local demo: ${error.message}`); process.exitCode = 1; });
}
