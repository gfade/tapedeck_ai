#!/usr/bin/env node
/**
 * tapedeck — the TapeDeck runner CLI. `tapedeck help` prints the usage below.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { agentCommand } from "./agent-cli.ts";
import { loadTasks, loadVariants } from "./bench.ts";
import { DEFAULT_REPEAT, runGate } from "./gate.ts";
import { formatGate, formatRuns } from "./report.ts";
import { DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, type ForkRequest, Runner } from "./runs.ts";
import { createApiServer } from "./server.ts";
import { Store } from "./store.ts";
import { readTapeFromSessionFile } from "./tape.ts";
import type { RunRecord, Tape } from "./types.ts";
import { evolveCommand } from "./evolve.ts";
import { errorMessage, pool, UserError } from "./util.ts";

const USAGE = `tapedeck — record, replay, fork and gate pi runs

Usage:
  tapedeck evolve --task t01 --task t04 --user NAME         replay, propose, fork, verify, promote a scoped harness
  tapedeck adaptive-run --task t01 --task t04 --user NAME   use the promoted harness for the same scope
  tapedeck run    --task t01 --variant vanilla [--repeat N]   record full runs
  tapedeck bench  [--task …] [--variant …] [--repeat N]       all tasks x variants (default: all)
  tapedeck replay <runId> --variant V [--tape FILE | --tape-url URL]
                                                              zero-token replay of a run's tape
  tapedeck fork   <runId> --variant V [--auto] [--at N] [--lenient system]
                  [--tape FILE | --tape-url URL]              replay, then go live at the divergence
  tapedeck gate   --candidate V [--baseline vanilla] [--repeat ${DEFAULT_REPEAT}] [--task …]
                                                              fork + rerun every task, write a report
  tapedeck report [name]                                      print a gate report (default: latest)
  tapedeck ls     [--task T] [--variant V] [--kind run|fork|replay]
  tapedeck tape   <runId>                                     print a run's tape JSON
  tapedeck serve  [--port 4777] [--host 127.0.0.1]            HTTP API and dashboard
  tapedeck archive --output Agent.archive.json [--home DIR] capture traces, files and Git bundles
  tapedeck restore --archive FILE --destination DIR        restore into an empty runner store
  tapedeck atlas-push --image Agent.image [--archive FILE]  publish image + archive to Atlas
  tapedeck atlas-pull <snapshotId> --destination DIR        retrieve image and restore its files
  tapedeck atlas-ls                                         list published snapshots
  tapedeck compare <runId> --variant V --model P/M          replay + live fork + fresh rerun
  tapedeck git-status --task T                              inspect stored Git checkpoints
  tapedeck git-export <runId> --destination REPO --branch B [--remote origin] [--push]
                                                             export to a new branch; push is opt-in

Options:
  --home DIR      store directory (default: $TAPEDECK_HOME or <repo>/store)
  --model M       provider/model (default: ${DEFAULT_MODEL}); e.g. openrouter/anthropic/claude-sonnet-4.5
  --keep          keep the run's worktree (store/work/<runId>)
  --json          print JSON instead of tables
  --jobs N        concurrent runs (default 4)
  --timeout SEC   kill pi after SEC seconds (default ${DEFAULT_TIMEOUT_MS / 1000})
  --no-tape       run pi without pi-tape (plain runs; no replay or fork)
  Lists (--task, --variant) take commas or repeated flags.`;

const OPTIONS = {
	home: { type: "string" },
	model: { type: "string" },
	task: { type: "string", multiple: true },
	variant: { type: "string", multiple: true },
	repeat: { type: "string" },
	keep: { type: "boolean" },
	json: { type: "boolean" },
	jobs: { type: "string" },
	timeout: { type: "string" },
	"no-tape": { type: "boolean" },
	at: { type: "string" },
	auto: { type: "boolean" },
	lenient: { type: "string" },
	tape: { type: "string" },
	"tape-url": { type: "string" },
	candidate: { type: "string" },
	baseline: { type: "string" },
	name: { type: "string" },
	kind: { type: "string" },
	port: { type: "string" },
	host: { type: "string" },
	help: { type: "boolean", short: "h" },
} as const;

function list(values: string[] | undefined): string[] {
	return (values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

function positiveInt(value: string | undefined, flag: string, fallback: number): number {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) throw new UserError(`${flag} must be a positive integer`);
	return n;
}

function one(values: string[] | undefined, flag: string): string {
	const items = list(values);
	if (items.length !== 1) throw new UserError(`give exactly one ${flag}`);
	return items[0];
}

function readTapeFile(file: string | undefined): Tape | undefined {
	if (file === undefined) return undefined;
	if (!existsSync(file)) throw new UserError(`tape file not found: ${file}`);
	return JSON.parse(readFileSync(file, "utf8")) as Tape;
}

function printRuns(runs: RunRecord[], json: boolean | undefined): void {
	console.log(json ? JSON.stringify(runs, null, 2) : formatRuns(runs));
}

async function main(argv: string[]): Promise<number> {
	const evolved = await evolveCommand(argv);
	if (evolved !== null) return evolved;
	const handled = await agentCommand(argv);
	if (handled !== null) return handled;
	const { values: flags, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
	const [command, ...rest] = positionals;
	if (flags.help || !command || command === "help") {
		console.log(USAGE);
		return command || flags.help ? 0 : 1;
	}

	const store = Store.open(flags.home);
	const log = (line: string) => console.error(`  ${line}`);
	const runner = new Runner({
		store,
		model: flags.model,
		tape: flags["no-tape"] ? false : undefined,
		timeoutMs: positiveInt(flags.timeout, "--timeout", DEFAULT_TIMEOUT_MS / 1000) * 1000,
		jobs: positiveInt(flags.jobs, "--jobs", 4),
		log,
	});
	for (const id of runner.recoverStaleRuns()) log(`marked stale run ${id} as error`);

	// Ctrl-C: stop pi processes, let runs record the interruption, then exit.
	let interrupted = false;
	const onSignal = () => {
		if (interrupted) process.exit(130);
		interrupted = true;
		console.error("\nstopping runs…");
		runner.abortAll();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	switch (command) {
		case "run":
		case "bench": {
			const tasks = list(flags.task);
			const variants = list(flags.variant);
			if (command === "run" && (tasks.length === 0 || variants.length === 0)) throw new UserError("run needs --task and --variant");
			const repeat = positiveInt(flags.repeat, "--repeat", 1);
			const combos = (tasks.length ? tasks : loadTasks().map((t) => t.id)).flatMap((task) =>
				(variants.length ? variants : loadVariants().map((v) => v.name)).flatMap((variant) => Array.from({ length: repeat }, () => ({ task, variant }))),
			);
			const runs = await pool(combos, runner.jobs, (c) => runner.run({ ...c, keep: flags.keep }));
			printRuns(runs, flags.json);
			return runs.some((r) => r.status === "error") ? 1 : 0;
		}
		case "replay":
		case "fork": {
			const from = rest[0];
			if (!from) throw new UserError(`${command} needs the id of the run to ${command}`);
			const request: ForkRequest = {
				from,
				variant: one(flags.variant, "--variant"),
				tape: readTapeFile(flags.tape),
				tapeUrl: flags["tape-url"],
				keep: flags.keep,
			};
			let run: RunRecord;
			if (command === "replay") {
				run = await runner.replay(request);
			} else {
				run = await runner.fork({
					...request,
					auto: flags.auto,
					forkAt: flags.at === undefined ? undefined : positiveInt(flags.at, "--at", 1),
					lenient: flags.lenient === undefined ? undefined : list([flags.lenient]),
					model: flags.model,
				});
			}
			printRuns([run], flags.json);
			return run.status === "error" ? 1 : 0;
		}
		case "gate": {
			if (!flags.candidate) throw new UserError("gate needs --candidate");
			const report = await runGate(
				runner,
				{
					candidate: flags.candidate,
					baseline: flags.baseline,
					repeat: positiveInt(flags.repeat, "--repeat", DEFAULT_REPEAT),
					tasks: list(flags.task),
					model: flags.model,
					name: flags.name,
				},
				log,
			);
			console.log(flags.json ? JSON.stringify(report, null, 2) : formatGate(report));
			return 0;
		}
		case "report": {
			const name = rest[0] ?? store.listReports()[0];
			if (!name) throw new UserError("no gate reports yet: run `tapedeck gate` first");
			const report = store.readReport(name);
			if (!report) throw new UserError(`unknown report "${name}" (have: ${store.listReports().join(", ") || "none"})`);
			console.log(flags.json ? JSON.stringify(report, null, 2) : formatGate(report));
			return 0;
		}
		case "ls": {
			printRuns(store.listRuns({ task: list(flags.task)[0], variant: list(flags.variant)[0], kind: flags.kind }), flags.json);
			return 0;
		}
		case "tape": {
			const run = store.getRun(rest[0] ?? "");
			const session = join(store.runDir(run.id), "session.jsonl");
			if (!existsSync(session)) throw new UserError(`run ${run.id} has no session file`);
			console.log(JSON.stringify(readTapeFromSessionFile(session, { id: run.id }), null, 2));
			return 0;
		}
		case "serve": {
			const port = positiveInt(flags.port, "--port", 4777);
			const host = flags.host ?? "127.0.0.1";
			const server = createApiServer(runner, log);
			await new Promise<void>((resolveListen, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => resolveListen());
			});
			console.log(`tapedeck runner on http://${host}:${port}/ (store ${store.home}${runner.tape ? "" : ", no pi-tape"})`);
			await new Promise<void>((resolveClosed) => {
				const stop = () => {
					runner.abortAll();
					server.close(() => resolveClosed());
					server.closeAllConnections();
				};
				process.removeListener("SIGINT", onSignal);
				process.removeListener("SIGTERM", onSignal);
				process.once("SIGINT", stop);
				process.once("SIGTERM", stop);
			});
			return 0;
		}
		default:
			throw new UserError(`unknown command "${command}" (see tapedeck help)`);
	}
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(err) => {
		console.error(`tapedeck: ${errorMessage(err)}`);
		process.exitCode = err instanceof UserError || (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS") ? 2 : 1;
	},
);
