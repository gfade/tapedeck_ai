import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { evolve } from "../runner/src/evolve.ts";
import { Runner } from "../runner/src/runs.ts";
import { Store } from "../runner/src/store.ts";
import { captureArchive, restoreArchive } from "../runner/src/archive.ts";
import { startLocalGateway } from "../runner/src/local-gateway.ts";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { cli: { type: "boolean" }, verbose: { type: "boolean" }, help: { type: "boolean", short: "h" }, port: { type: "string", default: "4781" }, output: { type: "string" }, "atlas-proof": { type: "string" }, "start-file": { type: "string" } } });
if (values.help) {
	console.log(`Usage: npm run demo:cli -- [options]
       npm run demo:screen -- [options]

--cli                 Run immediately in the terminal, without a web UI
--verbose             Include detailed CLI events (always saved to evidence)
--output <directory>  Evidence directory (default: new agent-exports directory)
--atlas-proof <path>  Verify a trusted prior Atlas download; not a live transfer
--port <number>       Web UI port (default: 4781)
--start-file <path>   Web UI recording trigger; incompatible with --cli
-h, --help            Show this help without running the demo

Requires running Ollama and npm run demo:local:setup.
CLI exits 0 on completed proof, 1 on failed proof. Evidence: result.json,
terminal.jsonl, Agent.archive.json, and restored-store in the output directory.`);
	process.exit(0);
}
if (values.cli && values["start-file"]) throw new Error("--cli cannot be combined with --start-file");
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be 1024–65535");
const output = resolve(values.output ?? join(root, "agent-exports", `live-screen-${Date.now()}`));
mkdirSync(output, { recursive: true, mode: 0o700 });
const token = randomUUID();
const state: Record<string, any> = { status: "ready", phase: "Ready to run", startedAt: null, finishedAt: null, logs: [], runs: [], replayCalls: null, providerCalls: 0, tools: null, decision: null, task: { title: "t01 · sum() subtracts", failure: null, fix: null, command: null }, atlas: { status: "pending", source: "Prior Atlas download · verification runs now" }, archive: null };
let activeRunner: Runner | undefined;
state.triggerMode = Boolean(values["start-file"]);
const publish = (text: string, detail = false) => {
	const event = { at: new Date().toISOString(), text };
	state.logs.push(event);
	if (!values.cli || values.verbose || !detail) console.log(text);
	appendFileSync(join(output, "terminal.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 });
};
const explain = (text: string) => { if (values.cli) publish(text); };
async function checksum(file: string) {
	const hash = createHash("sha256");
	let size = 0;
	for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
	return { sha256: hash.digest("hex"), size };
}
async function reopenAtlasImage() {
	if (!values["atlas-proof"]) { state.atlas.status = "not configured"; publish("Atlas recovery not configured; no cloud recovery claim."); return; }
	state.phase = "MongoDB recovery • real file verification";
	const source = resolve(values["atlas-proof"]);
	const manifest = JSON.parse(readFileSync(join(source, "snapshot.json"), "utf8"));
	const archive = JSON.parse(readFileSync(join(source, "downloaded", "archive.json"), "utf8"));
	state.atlas.snapshot = manifest.id;
	state.atlas.status = "verifying";
	publish("[GridFS] verify downloaded companions + reopen image", true);
	publish(`Prior Atlas snapshot ${manifest.id} · not a live transfer`);
	const directory = join(output, "atlas-image");
	mkdirSync(directory, { mode: 0o700 });
	for (const [kind, item] of Object.entries(manifest.files) as [string, any][]) {
		if (basename(item.name) !== item.name) throw new Error("invalid snapshot filename");
		const file = kind === "archive" ? join(source, "downloaded", "archive.json") : join(source, "downloaded", "image", item.name);
		const actual = await checksum(file);
		if (actual.sha256 !== item.sha256 || actual.size !== item.size) throw new Error("Atlas companion checksum mismatch");
		publish(`SHA-256 MATCH  ${item.name}  ${actual.sha256.slice(0, 12)}…`, true);
		if (kind !== "archive") copyFileSync(file, join(directory, item.name));
	}
	const expression = "| agent result | agent := TdAgentImage current. agent lastError ifNotNil: [ self error: agent lastError ]. result := OrderedDictionary new at: 'runs' put: agent store size; at: 'files' put: agent fileNames size; at: 'restoredDirectory' put: agent lastRestoreDirectory; yourself. Stdio stdout nextPutAll: (TdJson toString: result); lf; flush. Smalltalk snapshot: false andQuit: true";
	publish("$ pharo Agent.image eval 'TdAgentImage current'", true);
	const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/MONGODB_|API_KEY|TOKEN|SECRET|PASSWORD|TAPEDECK_RESTORE_DIRECTORY/.test(name)));
	const restored = await new Promise<any>((resolveResult, reject) => {
		const child = spawn(join(root, "image/pharo/pharo"), [join(directory, manifest.files.image.name), "eval", expression], { env: environment });
		let stdout = "";
		const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("image reopen timed out")); }, 30_000);
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.resume();
		child.on("error", (error) => { clearTimeout(timeout); reject(error); });
		child.on("close", (code) => {
			clearTimeout(timeout);
			try { if (code !== 0) throw new Error("image reopen failed"); resolveResult(JSON.parse(stdout.split("\n").find((line) => line.startsWith("{"))!)); }
			catch (error) { reject(error); }
		});
	});
	let verified = 0;
	for (const file of [...archive.files.map((item: any) => ({ ...item, destination: item.path })), ...archive.gitBundles.map((item: any) => ({ ...item, destination: `git-bundles/${item.task}.bundle` }))]) {
		const actual = await checksum(join(restored.restoredDirectory, file.destination));
		if (actual.sha256 !== file.sha256 || actual.size !== file.size) throw new Error("restored payload checksum mismatch");
		verified++;
	}
	state.atlas = { ...state.atlas, status: "verified", payloads: verified, runs: restored.runs, files: restored.files, imageHash: manifest.files.image.sha256 };
	publish(`IMAGE REOPENED · ${restored.runs} runs · ${verified}/${verified} payload SHA-256 checks PASS`);
}
async function runDemo() {
	state.status = "running";
	state.startedAt = new Date().toISOString();
	let gateway: Awaited<ReturnType<typeof startLocalGateway>> | undefined;
	const previousModels = process.env.TAPEDECK_MODELS_FILE;
	try {
		const tags = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) }).then((response) => response.json()) as any;
		if (!tags.models?.some((model: any) => model.name === "tapedeck-qwen35-2b:latest")) throw new Error("Run npm run demo:local:setup first; local Qwen alias is missing");
		gateway = await startLocalGateway({ upstream: "http://127.0.0.1:11434", models: ["tapedeck-qwen35-2b"], onRequest: () => { state.providerCalls = gateway!.requests.length; } });
		const config = JSON.parse(readFileSync(join(root, "config/models.ollama.json"), "utf8"));
		config.providers.ollama.baseUrl = gateway.url;
		writeFileSync(join(output, "models.json"), JSON.stringify(config), { mode: 0o600 });
		process.env.TAPEDECK_MODELS_FILE = join(output, "models.json");
		const store = Store.open(join(output, "store"));
		publish("[runner] evolve(task=t01, user=screen-recording)", true);
		publish("REAL EXECUTION · deterministic repair, then local Qwen3.5 2B", true);
		for (const [label, model] of [["Repair fixture", "scripted/toy"], ["Qwen3.5 2B", "ollama/tapedeck-qwen35-2b"]]) {
			state.phase = `${label} • record → replay → fork → verify`;
			explain(label === "Repair fixture"
				? "\n1 / REPAIR THE WORKFLOW\n  Scripted fixture: sum(2,3) should be 5, not -1.\n  It undoes a correct patch after running a disabled npm test.\n  Trial: use ./tasks test, then verify the patch independently."
				: "\n2 / TEST LOCAL QWEN\n  Run the real model, then trial fewer directly exposed tools.\n  A passing baseline needs no rescue; bash remains a broad capability.");
			if (label === "Qwen3.5 2B") publish("[runner] evolve(model=ollama/tapedeck-qwen35-2b)", true);
			activeRunner = new Runner({ store, model, jobs: 1, timeoutMs: 90_000, log: (line) => {
				const id = line.split(" ")[1].replace(/:$/, "");
				const record = store.getRun(id);
				if (line.startsWith("started")) {
					gateway!.setPhase(`${label}:${record.kind}`);
					state.runs.push({ id, label, kind: record.kind, status: "running", pass: null });
					publish(`▶ ${label.padEnd(14)} ${record.kind.toUpperCase()}  ${id.slice(-4)}`, true);
				} else {
					Object.assign(state.runs.find((run: any) => run.id === id), { status: record.status, pass: record.pass, tokens: record.usage.totalTokens, steps: record.steps });
					if (label === "Repair fixture" && record.kind !== "replay") {
						const events = readFileSync(join(store.runDir(id), "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
						const calls = events.filter((event) => event.type === "tool_execution_start");
						if (record.pass === false && record.verify?.output.includes("-1 !== 5") && calls.some((call) => call.args?.command === "npm test")) {
							state.task.failure = "sum(2,3) = -1; expected 5. Disabled npm test → correct patch reverted.";
							publish("BUG: sum(2,3) returned -1, not 5; npm test was disabled.", true);
						}
						if (record.pass === true && calls.some((call) => call.args?.command === "./tasks test") && record.verify?.output.includes("hidden checks passed")) {
							const alreadyExplained = Boolean(state.task.fix);
							state.task.fix = "return a - b  →  return a + b";
							state.task.command = "./tasks test (not npm test)";
							publish("FIX VERIFIED: a - b → a + b; ./tasks test + hidden checks PASS", alreadyExplained);
						}
					}
					if (record.kind === "replay") state.replayCalls = gateway!.requests.filter((request) => request.phase.endsWith(":replay")).length;
					const completedRuns = state.runs.filter((run: any) => run.label === label && run.kind === "run").length;
					const stage = record.kind === "run" ? completedRuns === 1 ? "BASELINE" : `FRESH ${completedRuns - 1}` : record.kind.toUpperCase();
					const verdict = record.status === "error" ? "ERROR" : record.pass === null ? "RECORDED" : record.pass ? "PASS" : "FAIL";
					publish(`  ${values.cli ? stage.padEnd(8) : record.kind.toUpperCase().padEnd(6)} ${verdict} · ${record.kind === "replay" && values.cli ? `${state.replayCalls} model calls (not a new test verdict)` : `${record.usage.totalTokens} new tokens`}`);
				}
			} });
			const result = await evolve(activeRunner, { user: "screen-recording", tasks: ["t01"], repeat: 2 });
			const report = JSON.parse(readFileSync(result.report, "utf8"));
			state.tools = { before: report.parent.variant.tools, after: report.proposal.profile.variant.tools };
			state.decision = report.status;
			publish(`${label}: ${report.status.toUpperCase()} · tools ${state.tools.before.length} → ${state.tools.after.length}`);
			publish(report.decision.reason, report.status === "promoted");
			if (report.status === "promoted") explain("  Accepted only after the fork and two fresh verifications passed.");
			if (report.status !== "promoted") throw new Error("Candidate did not promote; retaining its honest evaluation result");
		}
		state.phase = "Portable experiment • archive and restore";
		explain("\n3 / RECOVER THE EVIDENCE\n  Restore traces, files and Git history; check saved bytes, not claims.");
		publish("[archive] captureArchive() → restoreArchive()", true);
		const archive = await captureArchive(store);
		writeFileSync(join(output, "Agent.archive.json"), JSON.stringify(archive), { mode: 0o600 });
		const restored = await restoreArchive(archive, join(output, "restored-store"));
		state.archive = { files: archive.files.length, bundles: archive.gitBundles.length, runs: restored.listRuns().length };
		publish(`RESTORED ${state.archive.runs} new runs · ${archive.files.length} artifacts · ${archive.gitBundles.length} Git bundle`);
		await reopenAtlasImage();
		if (state.replayCalls !== 0) throw new Error("Replay unexpectedly called the model provider");
		state.status = "complete";
		state.phase = "Proof complete • improve the system, not just the answer";
		publish("DONE · recorded evidence, bounded adaptation, verified recovery");
		explain("  This tunes harness configuration, not model weights or arbitrary code.");
	} catch (error) {
		state.status = "error";
		state.phase = "Execution stopped • evidence retained";
		publish(error instanceof Error ? error.message.replaceAll(root, "$PROJECT") : "demo failed");
	} finally {
		state.finishedAt = new Date().toISOString();
		writeFileSync(join(output, "result.json"), JSON.stringify({ ...state, providerRequests: gateway?.requests ?? [] }, null, 2), { mode: 0o600 });
		await gateway?.close();
		if (previousModels === undefined) delete process.env.TAPEDECK_MODELS_FILE; else process.env.TAPEDECK_MODELS_FILE = previousModels;
	}
}
const server = createServer((request, response) => {
	response.setHeader("Cache-Control", "no-store");
	if (request.method === "GET" && request.url === "/") {
		response.setHeader("Content-Type", "text/html; charset=utf-8");
		response.end(readFileSync(join(import.meta.dirname, "live-screen.html"), "utf8").replace("__START_TOKEN__", token));
	} else if (request.method === "GET" && request.url === "/state") {
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ ...state, logs: state.logs.slice(-16) }));
	} else if (request.method === "POST" && request.url === `/start/${token}` && request.headers.origin === `http://127.0.0.1:${port}`) {
		if (state.status !== "ready" || state.triggerMode) { response.writeHead(409).end(); return; }
		void runDemo();
		response.writeHead(202).end();
	} else response.writeHead(404).end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { activeRunner?.abortAll(); server.close(); process.exitCode = 1; });
if (values.cli) {
	console.log(`TapeDeck CLI · evidence: ${output}`);
	await runDemo();
	if (state.status !== "complete") process.exitCode = 1;
} else {
server.listen(port, "127.0.0.1", () => console.log(`Live app: http://127.0.0.1:${port} · evidence: ${output}`));
if (values["start-file"]) {
	const trigger = resolve(values["start-file"]);
	if (existsSync(trigger)) throw new Error("start-file must not already exist");
	const timer = setInterval(() => {
		if (state.status !== "ready") { clearInterval(timer); return; }
		if (existsSync(trigger)) { clearInterval(timer); void runDemo(); }
	}, 100);
	timer.unref();
}
}
