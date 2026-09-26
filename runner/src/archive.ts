import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { TASKS_DIR, VARIANTS_DIR } from "./paths.ts";
import { Store } from "./store.ts";
import { cleanEnv, isSafeName } from "./util.ts";

export interface ArchiveFile {
	path: string;
	mode: number;
	size: number;
	sha256: string;
	data: string;
}

export interface ArchiveGitBundle {
	task: string;
	sha256: string;
	size: number;
	data: string;
}

export interface AgentArchive {
	format: "tapedeck.archive/v1";
	createdAt: string;
	files: ArchiveFile[];
	gitBundles: ArchiveGitBundle[];
}

export interface ArchiveOptions {
	maxBytes?: number;
	maxFiles?: number;
}

export interface RestoreArchiveOptions extends ArchiveOptions {
	referenceHome?: string;
}

export const DEFAULT_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_FILES = 100_000;
const RUN_FILES = new Set(["run.json", "session.jsonl", "events.jsonl", "stdout.log", "stderr.log", "report.json", "tape-report.json", "verify.json"]);
const OMITTED_DIRECTORIES = new Set([".git", "node_modules", ".pi", ".codex", ".ssh", ".aws"]);
const HASH = /^[a-f0-9]{64}$/;

function fail(message: string): never {
	throw new Error(`archive: ${message}`);
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
	return value as Record<string, unknown>;
}

function name(value: unknown): string {
	if (typeof value !== "string" || !isSafeName(value) || value.length > 180 || /[. ]$/.test(value)) fail("unsafe name");
	return value;
}

function pathName(value: unknown): string {
	if (typeof value !== "string" || value.length > 4096 || /[\\:\x00-\x1f\x7f]/.test(value)) fail("unsafe path");
	if (value.split("/").some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) fail("unsafe path");
	return value;
}

function credentialPath(path: string): boolean {
	return path.split("/").some((part) => /^(auth\.json|credentials(\.json)?|\.env(\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$/i.test(part) || OMITTED_DIRECTORIES.has(part.toLowerCase()));
}

function safeContent(path: string, data: Buffer): void {
	if (!credentialPath(path)) return;
	const env = path.split("/").at(-1) === ".env";
	const values = data.toString("utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
	if (env && !path.split("/").slice(0, -1).some((part) => credentialPath(part)) && values.length && values.every((line) => /^[A-Z][A-Z0-9_]*=canary-tapedeck-[a-f0-9]+$/.test(line))) return;
	fail(`credential/configuration file is not portable: ${path}`);
}

function allowedFile(path: string): boolean {
	const parts = path.split("/");
	if (parts[0] === "runs") return parts.length === 3 && isSafeName(parts[1]) && RUN_FILES.has(parts[2]);
	if (["reports", "tapes", "comparisons"].includes(parts[0])) return parts.length >= 2 && /\.(json|jsonl|md|txt|html|csv)$/.test(parts.at(-1)!);
	if (parts[0] === "snapshots") return parts.length >= 3 && isSafeName(parts[1]);
	return parts[0] === "catalog" && ["tasks", "variants"].includes(parts[1]) && parts.length >= 4 && isSafeName(parts[2]);
}

function limits(options: ArchiveOptions): { maxBytes: number; maxFiles: number } {
	const maxBytes = options.maxBytes ?? Number(process.env.TAPEDECK_ARCHIVE_MAX_BYTES ?? DEFAULT_ARCHIVE_MAX_BYTES);
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	if (![maxBytes, maxFiles].every((value) => Number.isSafeInteger(value) && value > 0)) fail("byte/file limits must be positive safe integers");
	return { maxBytes, maxFiles };
}

function digest(data: Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

function payload(value: Record<string, unknown>, remaining: number): Buffer {
	if (!Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > remaining) fail("total byte limit exceeded or invalid size");
	if (typeof value.sha256 !== "string" || !HASH.test(value.sha256)) fail("invalid SHA256");
	if (typeof value.data !== "string" || value.data.length !== Math.ceil((value.size as number) / 3) * 4 || /[^A-Za-z0-9+/=]/.test(value.data)) fail("invalid base64");
	const bytes = Buffer.from(value.data, "base64");
	if (bytes.length !== value.size || bytes.toString("base64") !== value.data || digest(bytes) !== value.sha256) fail("payload integrity check failed");
	return bytes;
}

function parseJson(data: Buffer, path: string): Record<string, unknown> {
	try {
		return object(JSON.parse(data.toString("utf8")));
	} catch {
		return fail(`invalid JSON object: ${path}`);
	}
}

export function validateArchive(value: unknown, options: ArchiveOptions = {}): AgentArchive {
	const archive = object(value);
	const { maxBytes, maxFiles } = limits(options);
	if (archive.format !== "tapedeck.archive/v1" || typeof archive.createdAt !== "string" || !Number.isFinite(Date.parse(archive.createdAt))) fail("invalid archive format or createdAt");
	if (!Array.isArray(archive.files) || !Array.isArray(archive.gitBundles) || archive.files.length + archive.gitBundles.length > maxFiles) fail("invalid file catalog or file limit exceeded");
	const paths = new Set<string>();
	const tasks = new Set<string>();
	const runs = new Map<string, Record<string, unknown>>();
	let size = 0;
	for (const item of archive.files) {
		const file = object(item);
		const path = pathName(file.path);
		if (!allowedFile(path)) fail(`file is outside the artifact allowlist: ${path}`);
		const key = path.normalize("NFC").toLowerCase();
		if (paths.has(key)) fail(`duplicate path: ${path}`);
		paths.add(key);
		if (!Number.isInteger(file.mode) || (file.mode as number) < 0 || (file.mode as number) > 0o777) fail("invalid regular-file mode");
		const bytes = payload(file, maxBytes - size);
		size += bytes.length;
		safeContent(path, bytes);
		if (/^runs\/[^/]+\/run\.json$/.test(path)) {
			const record = parseJson(bytes, path);
			if (record.format !== "tapedeck.run/v1" || name(record.id) !== path.split("/")[1] || !["done", "error"].includes(record.status as string)) fail("invalid or running run");
			name(record.task);
			name(record.variant);
			if (record.repo !== `repos/${record.task}.git`) fail("invalid run repository path");
			for (const field of ["sessionFile", "reportFile"]) {
				if (record[field] != null && (typeof record[field] !== "string" || !record[field].startsWith(`runs/${record.id}/`) || !allowedFile(pathName(record[field])))) fail(`invalid ${field}`);
			}
			if (record.tapeSource != null && typeof record.tapeSource !== "string") fail("invalid tapeSource");
			if (record.parent != null) name(record.parent);
			runs.set(record.id as string, record);
		}
	}
	for (const path of paths) {
		const parts = path.split("/");
		while (parts.length > 1) {
			parts.pop();
			if (paths.has(parts.join("/"))) fail("file/directory path conflict");
		}
		if (["runs", "snapshots"].includes(path.split("/")[0]) && ![...runs.keys()].some((id) => id.toLowerCase() === path.split("/")[1])) fail("artifact has no completed run record");
	}
	for (const record of runs.values()) {
		for (const field of ["sessionFile", "reportFile"]) if (record[field] && !paths.has((record[field] as string).normalize("NFC").toLowerCase())) fail(`missing ${field}`);
	}
	for (const item of archive.gitBundles) {
		const bundle = object(item);
		const task = name(bundle.task);
		if (tasks.has(task.toLowerCase())) fail("duplicate Git task");
		tasks.add(task.toLowerCase());
		size += payload(bundle, maxBytes - size).length;
	}
	for (const record of runs.values()) if ((record.snapshotBase || record.snapshotFinal) && !tasks.has((record.task as string).toLowerCase())) fail("run snapshots have no Git bundle");
	return {
		format: "tapedeck.archive/v1", createdAt: archive.createdAt,
		files: archive.files.map((file: ArchiveFile) => ({ path: file.path, mode: file.mode, size: file.size, sha256: file.sha256, data: file.data })),
		gitBundles: archive.gitBundles.map((bundle: ArchiveGitBundle) => ({ task: bundle.task, size: bundle.size, sha256: bundle.sha256, data: bundle.data })),
	};
}

function git(args: string[], maxBuffer = 64 * 1024 * 1024): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		execFile("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never", "-c", "protocol.file.allow=always", "-c", "fetch.fsckObjects=true", "-c", "gc.auto=0", ...args], {
			env: { ...cleanEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
			encoding: "buffer", maxBuffer, timeout: 120_000,
		}, (error, stdout) => error ? reject(new Error(`archive: Git ${args.find((arg) => !arg.startsWith("-")) ?? "operation"} failed`)) : resolvePromise(stdout));
	});
}

async function textGit(args: string[]): Promise<string> {
	return (await git(args)).toString("utf8").trim();
}

async function statOptional(path: string) {
	return lstat(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
}

async function directory(path: string): Promise<boolean> {
	const stat = await statOptional(path);
	if (!stat) return false;
	if (!stat.isDirectory() || stat.isSymbolicLink()) fail("expected a real directory, not a symlink");
	return true;
}

async function regularFile(path: string, maxBytes: number): Promise<{ data: Buffer; mode: number }> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > maxBytes) fail("non-regular file or total byte limit exceeded");
		const data = await handle.readFile();
		if (data.length > maxBytes || data.length !== stat.size) fail("file changed during capture or byte limit exceeded");
		return { data, mode: stat.mode & 0o777 };
	} finally {
		await handle.close();
	}
}

function checkRef(ref: string): void {
	if (ref === "HEAD") return;
	if (!ref.startsWith("refs/") || ref.startsWith("refs/remotes/") || ref.startsWith("refs/replace/") || /[\x00-\x20\x7f\\~^:?*\[]|\.\.|@\{|\/\//.test(ref) || ref.endsWith("/") || ref.endsWith(".lock")) fail("unsafe or remote Git ref");
}

async function treeEntries(repo: string, tree: string): Promise<{ path: string; mode: number; oid: string }[]> {
	if (!/^[a-f0-9]{40,64}$/.test(tree)) fail("invalid snapshot object id");
	const output = await git(["--git-dir", repo, "ls-tree", "-rz", tree]);
	if (!Buffer.from(output.toString("utf8")).equals(output)) fail("Git filenames must be valid UTF-8");
	return output.toString("utf8").split("\0").filter(Boolean).map((entry) => {
		const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
		if (!match || match[2] !== "blob" || !["100644", "100755"].includes(match[1])) fail("symlink, submodule, or non-regular Git tree entry");
		return { path: pathName(match[4]), mode: match[1] === "100755" ? 0o755 : 0o644, oid: match[3] };
	});
}

async function checkRepository(repo: string): Promise<void> {
	if (await textGit(["--git-dir", repo, "rev-parse", "--is-bare-repository"]) !== "true") fail("task repository must be bare");
	const config = await textGit(["--git-dir", repo, "config", "--local", "--no-includes", "--name-only", "--list"]);
	if (config.split("\n").some((key) => /^(remote\.|include\.|includeif\.|filter\.|credential\.|url\.|http\.|core\.(hookspath|sshcommand|worktree)$)/i.test(key))) fail("remote or executable Git configuration is not portable");
	const hooks = join(repo, "hooks");
	if (await directory(hooks)) for (const hook of await readdir(hooks)) if (!hook.endsWith(".sample")) fail("Git hooks are not portable");
	for (const ref of (await textGit(["--git-dir", repo, "for-each-ref", "--format=%(refname)"])).split("\n").filter(Boolean)) checkRef(ref);
	const trees = new Set((await textGit(["--git-dir", repo, "log", "--all", "--format=%T"])).split("\n").filter(Boolean));
	const checked = new Set<string>();
	for (const tree of trees) {
		for (const entry of await treeEntries(repo, tree)) {
			if (credentialPath(entry.path) && !checked.has(`${entry.path}:${entry.oid}`)) {
				safeContent(entry.path, await git(["--git-dir", repo, "cat-file", "blob", entry.oid]));
				checked.add(`${entry.path}:${entry.oid}`);
			}
		}
	}
}

async function runCatalog(store: Store): Promise<Map<string, string>> {
	const records = new Map<string, string>();
	if (!await directory(join(store.home, "runs"))) return records;
	for (const id of (await readdir(join(store.home, "runs"))).sort()) {
		name(id);
		if (!await directory(store.runDir(id))) continue;
		const file = join(store.runDir(id), "run.json");
		if (!await statOptional(file)) fail("run directory has no completed record");
		const { data } = await regularFile(file, 4 * 1024 * 1024);
		const record = parseJson(data, file);
		if (!["done", "error"].includes(record.status as string)) fail("cannot capture running runs");
		if (record.id !== id) fail("run record ID does not match its directory");
		records.set(id, digest(data));
	}
	return records;
}

export async function captureArchive(store: Store, options: ArchiveOptions = {}): Promise<AgentArchive> {
	const { maxBytes, maxFiles } = limits(options);
	const before = await runCatalog(store);
	await directory(join(store.home, "catalog"));
	await directory(join(store.home, "catalog", "tasks"));
	await directory(join(store.home, "catalog", "variants"));
	const archive: AgentArchive = { format: "tapedeck.archive/v1", createdAt: new Date().toISOString(), files: [], gitBundles: [] };
	let total = 0;
	const add = (path: string, data: Buffer, mode: number) => {
		pathName(path);
		safeContent(path, data);
		total += data.length;
		if (total > maxBytes || archive.files.length + archive.gitBundles.length >= maxFiles) fail("total byte/file limit exceeded");
		archive.files.push({ path, mode, size: data.length, sha256: digest(data), data: data.toString("base64") });
	};
	const walk = async (root: string, prefix: string): Promise<void> => {
		if (!await directory(root)) return;
		for (const entry of (await readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
			if (OMITTED_DIRECTORIES.has(entry.name)) continue;
			const path = `${prefix}/${entry.name}`;
			if (entry.isSymbolicLink()) fail("symlinks cannot be captured");
			if (entry.isDirectory()) await walk(join(root, entry.name), path);
			else if (allowedFile(path)) {
				const { data, mode } = await regularFile(join(root, entry.name), maxBytes - total);
				add(path, data, mode);
			}
		}
	};
	for (const id of before.keys()) {
		for (const artifact of RUN_FILES) {
			const file = join(store.runDir(id), artifact);
			if (!await statOptional(file)) continue;
			const { data, mode } = await regularFile(file, maxBytes - total);
			add(`runs/${id}/${artifact}`, data, mode);
		}
	}
	for (const section of ["reports", "tapes", "comparisons"]) await walk(join(store.home, section), section);
	const runs = archive.files.filter((file) => file.path.endsWith("/run.json")).map((file) => parseJson(Buffer.from(file.data, "base64"), file.path));
	for (const task of new Set(runs.map((run) => name(run.task)))) {
		const archived = join(store.home, "catalog", "tasks", task);
		await walk(await directory(archived) ? archived : join(TASKS_DIR, task), `catalog/tasks/${task}`);
	}
	for (const variant of new Set(runs.map((run) => name(run.variant)))) {
		const archived = join(store.home, "catalog", "variants", variant);
		await walk(await directory(archived) ? archived : join(VARIANTS_DIR, variant), `catalog/variants/${variant}`);
	}
	const temporary = await mkdtemp(join(tmpdir(), "tapedeck-bundles-"));
	try {
		if (await directory(join(store.home, "repos"))) {
			for (const entry of (await readdir(join(store.home, "repos"))).sort()) {
				if (!entry.endsWith(".git")) fail("unexpected task repository entry");
				const task = name(entry.slice(0, -4));
				const repo = store.repoDir(task);
				await directory(repo);
				await checkRepository(repo);
				const bundlePath = join(temporary, `${task}.bundle`);
				await git(["--git-dir", repo, "bundle", "create", bundlePath, "--all"]);
				const { data } = await regularFile(bundlePath, maxBytes - total);
				total += data.length;
				archive.gitBundles.push({ task, sha256: digest(data), size: data.length, data: data.toString("base64") });
				for (const run of runs.filter((run) => run.task === task && run.snapshotFinal)) {
					for (const entry of await treeEntries(repo, run.snapshotFinal as string)) {
						const bytes = await git(["--git-dir", repo, "cat-file", "blob", entry.oid], Math.max(1, maxBytes - total));
						add(`snapshots/${run.id}/${entry.path}`, bytes, entry.mode);
					}
				}
			}
		}
		if (JSON.stringify([...before]) !== JSON.stringify([...(await runCatalog(store))])) fail("runs changed during capture; retry while idle");
		return validateArchive(archive, options);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

function rebaseLocation(location: unknown, home: string, files: Set<string>): unknown {
	if (typeof location !== "string" || /^https?:\/\//.test(location)) return location;
	const normalized = location.replaceAll("\\", "/");
	for (const prefix of ["runs/", "tapes/"]) {
		const offset = normalized.lastIndexOf(`/${prefix}`);
		const candidate = offset >= 0 ? normalized.slice(offset + 1) : normalized.startsWith(prefix) ? normalized : "";
		if (files.has(candidate)) return join(home, candidate);
	}
	return location;
}

function relocateMetadata(value: Record<string, unknown>, home: string, files: Set<string>, relative = false): void {
	for (const key of ["tapeSource", "sourceSession", "sessionFile", "reportFile"]) {
		if (relative && ["sessionFile", "reportFile"].includes(key)) continue;
		if (key in value) value[key] = rebaseLocation(value[key], home, files);
	}
	for (const key of ["source", "upstream"]) {
		const source = value[key];
		if (source && typeof source === "object" && !Array.isArray(source)) {
			const metadata = source as Record<string, unknown>;
			if ("location" in metadata) metadata.location = rebaseLocation(metadata.location, home, files);
		}
	}
}

function restoredBytes(file: ArchiveFile, home: string, files: Set<string>): Buffer {
	const bytes = Buffer.from(file.data, "base64");
	if (/^(snapshots|catalog)\//.test(file.path)) return bytes;
	if (file.path.endsWith(".json")) {
		let value: Record<string, unknown>;
		try { value = object(JSON.parse(bytes.toString("utf8"))); } catch { return bytes; }
		const original = JSON.stringify(value);
		relocateMetadata(value, home, files, file.path.endsWith("/run.json"));
		return JSON.stringify(value) === original ? bytes : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
	}
	if (file.path.endsWith("/session.jsonl")) {
		const lines = bytes.toString("utf8").split("\n").map((line) => {
			if (!line.trim()) return line;
			let value: Record<string, unknown>;
			try { value = object(JSON.parse(line)); } catch { return line; }
			const original = JSON.stringify(value);
			if (value.type === "custom" && ["tape.header", "tape.report", "tape.source"].includes(value.customType as string) && value.data && typeof value.data === "object") relocateMetadata(value.data as Record<string, unknown>, home, files);
			if (value.type === "session" && "parentSession" in value) value.parentSession = rebaseLocation(value.parentSession, home, files);
			return JSON.stringify(value) === original ? line : JSON.stringify(value);
		});
		return Buffer.from(lines.join("\n"));
	}
	return bytes;
}

export async function prepareArchiveDestination(destination: string, allowStoreSkeleton = false): Promise<{ target: string; staging: string; commit: () => Promise<void>; cleanup: () => Promise<void> }> {
	const requested = resolve(destination);
	const parent = await realpath(dirname(requested));
	const target = join(parent, requested.slice(dirname(requested).length + 1));
	const empty = async (): Promise<boolean> => {
		for (const entry of await readdir(target, { withFileTypes: true })) {
			if (!allowStoreSkeleton || !["repos", "work", "runs", "tapes", "reports"].includes(entry.name) || !entry.isDirectory() || (await readdir(join(target, entry.name))).length) return false;
		}
		return true;
	};
	const initial = await statOptional(target);
	if (initial && (!initial.isDirectory() || initial.isSymbolicLink() || !await empty())) fail("destination must be absent, empty, or an empty Store directory skeleton");
	const staging = await mkdtemp(join(parent, ".tapedeck-restore-"));
	return {
		target, staging,
		commit: async () => {
			const current = await statOptional(target);
			if (initial ? !current || current.ino !== initial.ino || current.dev !== initial.dev || !current.isDirectory() || !await empty() : current) fail("destination changed during restore");
			if (initial && (await readdir(target)).length) {
				const backup = `${staging}.previous`;
				await rename(target, backup);
				try {
					if (await statOptional(target)) fail("destination changed during restore");
					await rename(staging, target);
				} catch (error) {
					if (!await statOptional(target)) await rename(backup, target);
					throw error;
				}
				await rm(backup, { recursive: true });
			} else await rename(staging, target);
		},
		cleanup: () => rm(staging, { recursive: true, force: true }),
	};
}

export async function restoreArchive(value: unknown, destination: string, options: RestoreArchiveOptions = {}): Promise<Store> {
	const archive = validateArchive(value, options);
	const transaction = await prepareArchiveDestination(destination, true);
	const home = options.referenceHome ? resolve(options.referenceHome) : transaction.target;
	const files = new Set(archive.files.map((file) => file.path));
	try {
		const store = Store.open(transaction.staging);
		for (const file of archive.files) {
			const path = join(store.home, file.path);
			const data = restoredBytes(file, home, files);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, data, { flag: "wx", mode: file.mode });
			await chmod(path, file.mode);
		}
		for (const bundle of archive.gitBundles) {
			const path = join(store.home, `${bundle.task}.bundle`);
			await writeFile(path, Buffer.from(bundle.data, "base64"), { flag: "wx", mode: 0o600 });
			const repo = store.repoDir(bundle.task);
			const format = Buffer.from(bundle.data, "base64").subarray(0, 1024).toString("utf8").includes("@object-format=sha256\n") ? "sha256" : "sha1";
			await git(["init", "--bare", "--quiet", "--template=", "--initial-branch=main", `--object-format=${format}`, repo]);
			await git(["--git-dir", repo, "bundle", "verify", path]);
			const heads = (await textGit(["bundle", "list-heads", path])).split("\n").filter(Boolean);
			if (!heads.length) fail("empty Git bundle");
			for (const head of heads) checkRef(head.slice(head.indexOf(" ") + 1));
			await git(["--git-dir", repo, "fetch", "--quiet", "--no-tags", path, "refs/*:refs/*"]);
			await git(["--git-dir", repo, "fsck", "--full", "--strict", "--no-reflogs"]);
			await checkRepository(repo);
			await git(["--git-dir", repo, "config", "gc.auto", "0"]);
			await rm(join(repo, "FETCH_HEAD"), { force: true });
			await rm(path);
		}
		for (const runFile of archive.files.filter((file) => /^runs\/[^/]+\/run\.json$/.test(file.path))) {
			const run = parseJson(Buffer.from(runFile.data, "base64"), runFile.path);
			for (const snapshot of [run.snapshotBase, run.snapshotFinal]) if (snapshot) {
				if (typeof snapshot !== "string" || !/^[a-f0-9]{40,64}$/.test(snapshot)) fail("invalid run snapshot");
				await git(["--git-dir", store.repoDir(run.task as string), "cat-file", "-e", `${snapshot}^{commit}`]);
			}
			if (run.snapshotFinal) {
				const expected = await treeEntries(store.repoDir(run.task as string), run.snapshotFinal as string);
				const actual = archive.files.filter((file) => file.path.startsWith(`snapshots/${run.id}/`));
				if (expected.length !== actual.length) fail("final snapshot file catalog is incomplete");
				for (const entry of expected) {
					const file = actual.find((file) => file.path === `snapshots/${run.id}/${entry.path}`);
					if (!file || file.mode !== entry.mode || file.sha256 !== digest(await git(["--git-dir", store.repoDir(run.task as string), "cat-file", "blob", entry.oid], limits(options).maxBytes))) fail("final snapshot files disagree with Git bundle");
				}
			}
		}
		await transaction.commit();
		return Store.open(transaction.target);
	} finally {
		await transaction.cleanup();
	}
}
