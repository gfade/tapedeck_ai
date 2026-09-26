/** Where things live: the runner's own files, pi-tape's extensions, and the pi package. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNNER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(RUNNER_DIR, "..");
export const DEFAULT_STORE = join(REPO_ROOT, "store");

export const BENCH_DIR = join(RUNNER_DIR, "bench");
export const TASKS_DIR = join(BENCH_DIR, "tasks");
export const VARIANTS_DIR = join(BENCH_DIR, "variants");
/** PI_SCRIPTED_MODEL for the bench: dispatches to tasks/<id>/toy.mjs. */
export const TOY_MODEL = join(BENCH_DIR, "toy-model.mjs");
export const HARNESS_EXTENSION = join(RUNNER_DIR, "harness", "variant.ts");
export const DASHBOARD_HTML = join(RUNNER_DIR, "dashboard", "index.html");

export const PI_TAPE_DIR = join(REPO_ROOT, "pi-tape");
export const TAPE_EXTENSION = join(PI_TAPE_DIR, "extensions", "tape.ts");
export const SCRIPTED_EXTENSION = join(PI_TAPE_DIR, "extensions", "scripted.ts");

export const RUNNER_VERSION: string = JSON.parse(readFileSync(join(RUNNER_DIR, "package.json"), "utf8")).version;

export interface PiPackage {
	dir: string;
	version: string;
	/** The CLI entry point (the package's `bin.pi`). */
	cli: string;
}

let piPackageCache: PiPackage | undefined;

/** Locates the installed pi package from the runner's own module resolution. */
export function piPackage(): PiPackage {
	if (piPackageCache) return piPackageCache;
	let dir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	for (;;) {
		const file = join(dir, "package.json");
		if (existsSync(file)) {
			const pkg = JSON.parse(readFileSync(file, "utf8"));
			if (pkg.name === "@earendil-works/pi-coding-agent") {
				const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pi;
				piPackageCache = { dir, version: pkg.version, cli: join(dir, bin) };
				return piPackageCache;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) throw new Error("cannot find the @earendil-works/pi-coding-agent package");
		dir = parent;
	}
}
