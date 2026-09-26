import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { captureArchive, restoreArchive, validateArchive } from "./archive.ts";
import { AtlasRepository } from "./atlas.ts";
import { compareRun } from "./compare.ts";
import { exportRunToGit, gitStatus } from "./git-export.ts";
import { Runner } from "./runs.ts";
import { Store } from "./store.ts";
import { UserError } from "./util.ts";

const COMMANDS = new Set(["archive", "restore", "atlas-push", "atlas-pull", "atlas-ls", "compare", "git-status", "git-export"]);

export async function agentCommand(argv: string[]): Promise<number | null> {
	if (!COMMANDS.has(argv[0])) return null;
	const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
		home: { type: "string" }, output: { type: "string" }, archive: { type: "string" },
		destination: { type: "string" }, image: { type: "string" }, changes: { type: "string" },
		sources: { type: "string" }, name: { type: "string" }, variant: { type: "string" },
		model: { type: "string" }, at: { type: "string" }, auto: { type: "boolean" },
		lenient: { type: "string" }, task: { type: "string" }, branch: { type: "string" },
		remote: { type: "string" }, push: { type: "boolean" }, json: { type: "boolean" },
	} });
	const [command, id] = positionals;
	const required = (value: string | undefined, name: string): string => {
		if (!value?.trim()) throw new UserError(`${command} requires ${name}`);
		return value;
	};
	const readArchive = (file: string) => validateArchive(JSON.parse(readFileSync(file, "utf8")));
	let result: unknown;
	let failed = false;
	if (command === "restore") {
		const store = await restoreArchive(readArchive(required(values.archive, "--archive")), required(values.destination, "--destination"));
		result = { restored: true, store: store.home, runs: store.listRuns().length };
	} else if (command.startsWith("atlas-")) {
		const atlas = await AtlasRepository.fromEnv();
		try {
			if (command === "atlas-ls") result = await atlas.list();
			else if (command === "atlas-pull") {
				const restored = await atlas.restore(required(id, "snapshot ID"), required(values.destination, "--destination"));
				const { store, ...paths } = restored;
				result = { ...paths, runs: store.listRuns().length };
			} else {
				const image = resolve(required(values.image, "--image"));
				if (!image.endsWith(".image")) throw new UserError("--image must name a saved .image file");
				const stem = image.slice(0, -6);
				const changes = values.changes ?? (existsSync(`${stem}.changes`) ? `${stem}.changes` : undefined);
				result = await atlas.publish({
					name: values.name ?? basename(stem), imagePath: image,
					archive: readArchive(values.archive ?? `${stem}.archive.json`),
					changesPath: changes, sourcesPath: values.sources,
				});
			}
		} finally { await atlas.close(); }
	} else {
		const store = Store.open(values.home);
		if (command === "archive") {
			const output = resolve(required(values.output, "--output"));
			const archive = await captureArchive(store);
			writeFileSync(output, JSON.stringify(archive), { flag: "wx", mode: 0o600 });
			result = { archive: output, files: archive.files.length, gitBundles: archive.gitBundles.length };
		} else if (command === "git-status") result = await gitStatus(store, required(values.task, "--task"));
		else if (command === "git-export") {
			const exported = await exportRunToGit(store, {
				runId: required(id, "run ID"), destination: required(values.destination ?? process.env.TAPEDECK_GIT_DESTINATION, "--destination"),
				branch: required(values.branch, "--branch"), remote: values.remote ?? process.env.TAPEDECK_GIT_REMOTE,
				push: values.push === true,
			});
			result = exported;
			failed = exported.status === "push-failed";
		} else {
			const forkAt = values.at === undefined ? undefined : Number(values.at);
			if (forkAt !== undefined && (!Number.isInteger(forkAt) || forkAt < 1)) throw new UserError("--at must be a positive integer");
			const runner = new Runner({ store });
			const comparison = await compareRun(runner, {
				from: required(id, "run ID"), variant: required(values.variant, "--variant"), model: values.model,
				forkAt, auto: values.auto, lenient: values.lenient?.split(",").filter(Boolean),
			});
			result = comparison;
			failed = comparison.status !== "done";
		}
	}
	console.log(JSON.stringify(result, null, 2));
	return failed ? 1 : 0;
}
