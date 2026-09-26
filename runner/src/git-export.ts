import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Store } from "./store.ts";
import type { RunRecord, Task } from "./types.ts";
import { cleanEnv, isSafeName, UserError } from "./util.ts";

export interface CheckpointStatus {
	commit: string | null;
	status: "available" | "not-recorded" | "invalid" | "missing" | "repository-unavailable";
}

export interface GitStatus {
	format: "tapedeck.git-status/v1";
	task: string;
	repository: { path: string; status: "available" | "missing" | "invalid" };
	refs: { ref: string; commit: string }[];
	checkpoints: { runId: string; snapshotBase: CheckpointStatus; snapshotFinal: CheckpointStatus }[];
	remotesIncluded: false;
}

export interface GitExportOptions {
	runId: string;
	destination: string;
	branch: string;
	remote?: string;
	push?: boolean;
}

export interface GitExportResult {
	format: "tapedeck.git-export/v1";
	status: "exported" | "pushed" | "push-failed";
	branch: string;
	ref: string;
	commit: string;
	tree: string;
	branchCreated: true;
	pushed: boolean;
	push: { requested: boolean; remote: string | null; status: "not-requested" | "pushed" | "failed"; error?: string };
	provenance: {
		runId: string;
		task: string;
		repository: string;
		snapshot: "snapshotFinal";
		credentialPolicy: "reject-known-sensitive-paths-in-history";
	};
}

interface GitContext {
	cwd: string;
	args?: string[];
}

const SAFE_CONFIG = [
	"-c", `core.hooksPath=${devNull}`,
	"-c", "core.fsmonitor=false",
	"-c", "core.attributesFile=" + devNull,
	"-c", "gc.auto=0",
	"-c", "maintenance.auto=false",
	"-c", "submodule.recurse=false",
	"-c", "protocol.ext.allow=never",
	"-c", "protocol.file.allow=always",
];
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function environment(): NodeJS.ProcessEnv {
	return {
		...cleanEnv(),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: devNull,
		GIT_ATTR_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_NO_REPLACE_OBJECTS: "1",
		GIT_NO_LAZY_FETCH: "1",
		GIT_PROTOCOL_FROM_USER: "0",
	};
}

function gitArgs(context: GitContext, args: string[]): string[] {
	return [...SAFE_CONFIG, ...(context.args ?? []), ...args];
}

function command(context: GitContext, args: string[], failure: string, input?: string): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = execFile("git", gitArgs(context, args), {
			cwd: context.cwd,
			env: environment(),
			maxBuffer: 32 * 1024 * 1024,
			timeout: 120_000,
		}, (error, stdout) => {
			if (error) reject(new UserError(failure));
			else resolvePromise(stdout.trimEnd());
		});
		child.stdin?.on("error", () => {});
		child.stdin?.end(input);
	});
}

function safeName(value: unknown, kind: string): asserts value is string {
	if (typeof value !== "string" || !isSafeName(value)) throw new UserError(`Invalid ${kind}.`);
}

function copyRegularTree(source: string, destination: string, skipInfo = false): void {
	const stat = lstatSync(source);
	if (stat.isSymbolicLink()) throw new UserError("Stored repository contains unsupported symbolic links.");
	if (stat.isDirectory()) {
		mkdirSync(destination, { recursive: true });
		for (const entry of readdirSync(source)) {
			if (skipInfo && entry === "info") continue;
			copyRegularTree(join(source, entry), join(destination, entry));
		}
	} else if (stat.isFile()) {
		copyFileSync(source, destination);
	} else {
		throw new UserError("Stored repository contains unsupported file types.");
	}
}

async function withSource<T>(store: Store, task: string, action: (context: GitContext) => Promise<T>): Promise<T> {
	const source = store.repoDir(task);
	if (!existsSync(source)) throw new UserError("Stored task repository is missing; restore its Git objects first.");
	const scratch = mkdtempSync(join(tmpdir(), "tapedeck-git-export-"));
	try {
		if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()
			|| !lstatSync(join(source, "config")).isFile() || lstatSync(join(source, "config")).isSymbolicLink()) {
			throw new UserError("Stored task repository must be a regular bare repository.");
		}
		const context = { cwd: scratch };
		const config = ["config", "--no-includes", "--file", join(source, "config")];
		const bare = await command(context, [...config, "--get", "core.bare"], "Stored task repository is invalid.");
		if (bare !== "true") throw new UserError("Stored task repository must be bare.");
		const format = await command(context, [...config, "--get", "extensions.objectformat"], "Invalid object format.").catch(() => "sha1");
		if (format !== "sha1" && format !== "sha256") throw new UserError("Stored repository object format is unsupported.");
		const repo = join(scratch, "source.git");
		await command(context, ["init", "--bare", "--quiet", "--template=", `--object-format=${format}`, repo], "Cannot prepare isolated Git repository.");
		copyRegularTree(join(source, "objects"), join(repo, "objects"), true);
		copyRegularTree(join(source, "refs"), join(repo, "refs"));
		if (existsSync(join(source, "packed-refs"))) copyRegularTree(join(source, "packed-refs"), join(repo, "packed-refs"));
		return await action({ cwd: scratch, args: ["--git-dir", repo] });
	} catch (error) {
		if (error instanceof UserError) throw error;
		throw new UserError("Stored task repository could not be read safely.");
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function checkpoint(context: GitContext | undefined, value: unknown): Promise<CheckpointStatus> {
	if (value == null) return { commit: null, status: "not-recorded" };
	if (typeof value !== "string" || !OBJECT_ID.test(value)) return { commit: null, status: "invalid" };
	if (!context) return { commit: value, status: "repository-unavailable" };
	const type = await command(context, ["cat-file", "-t", value], "Checkpoint object is missing.").catch(() => "");
	return { commit: value, status: type === "commit" ? "available" : type ? "invalid" : "missing" };
}

export async function gitStatus(store: Store, task: string | Task): Promise<GitStatus> {
	const taskId = typeof task === "string" ? task : task?.id;
	safeName(taskId, "task");
	const runs = store.listRuns({ task: taskId }).filter((run) => typeof run.id === "string" && isSafeName(run.id));
	const result: GitStatus = {
		format: "tapedeck.git-status/v1",
		task: taskId,
		repository: { path: `repos/${taskId}.git`, status: "missing" },
		refs: [],
		checkpoints: [],
		remotesIncluded: false,
	};
	const checkpoints = async (context?: GitContext) => Promise.all(runs.map(async (run) => ({
		runId: run.id,
		snapshotBase: await checkpoint(context, run.snapshotBase),
		snapshotFinal: await checkpoint(context, run.snapshotFinal),
	})));
	if (existsSync(store.repoDir(taskId))) {
		try {
			await withSource(store, taskId, async (context) => {
				const refs = await command(context, ["for-each-ref", "--format=%(refname)%09%(objectname)"], "Cannot read stored refs.");
				result.refs = refs.split("\n").filter(Boolean).map((line) => {
					const [ref, commit] = line.split("\t");
					return { ref: /^[A-Za-z0-9_./-]+$/.test(ref) ? ref : "[redacted-ref]", commit };
				}).filter((entry) => OBJECT_ID.test(entry.commit));
				result.checkpoints = await checkpoints(context);
				result.repository.status = "available";
			});
			return result;
		} catch {
			result.repository.status = "invalid";
			result.refs = [];
		}
	}
	result.checkpoints = await checkpoints();
	return result;
}

function sensitivePath(path: string): boolean {
	const parts = path.toLowerCase().split("/");
	const filename = parts.at(-1) ?? "";
	return parts.some((part) => [".git", ".ssh", ".aws", ".azure", "gcloud"].includes(part))
		|| /^\.env(?:\.|$)/.test(filename)
		|| /^(?:\.netrc|_netrc|\.npmrc|\.pypirc|\.git-credentials|auth\.json|credentials(?:\.json)?|secrets?\.(?:json|ya?ml)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/.test(filename)
		|| /\.(?:pem|key|p12|pfx)$/.test(filename)
		|| /^service[-_]account.*\.json$/.test(filename);
}

async function checkHistory(context: GitContext, commit: string): Promise<void> {
	const output = await command(context, ["log", "--format=%T", commit, "--"], "Checkpoint history is incomplete.");
	for (const tree of new Set(output.split("\n").filter(Boolean))) {
		if (!OBJECT_ID.test(tree)) throw new UserError("Checkpoint history is invalid.");
		const paths = await command(context, ["ls-tree", "-r", "-z", "--name-only", tree], "Cannot inspect checkpoint files.");
		if (paths.split("\0").some(sensitivePath)) {
			throw new UserError("Checkpoint history contains a known auth, credential, or env file; create a credential-free checkpoint before exporting.");
		}
	}
}

function waitChild(child: ChildProcess): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		child.once("error", () => reject(new UserError("Cannot transfer checkpoint Git objects.")));
		child.once("close", (code) => code === 0 ? resolvePromise() : reject(new UserError("Cannot transfer checkpoint Git objects.")));
	});
}

async function transferObjects(source: GitContext, destination: GitContext, commit: string): Promise<void> {
	const pack = spawn("git", gitArgs(source, ["pack-objects", "--stdout", "--revs"]), {
		cwd: source.cwd, env: environment(), stdio: ["pipe", "pipe", "ignore"], timeout: 120_000,
	});
	const unpack = spawn("git", gitArgs(destination, ["index-pack", "--stdin", "--strict"]), {
		cwd: destination.cwd, env: environment(), stdio: ["pipe", "ignore", "ignore"], timeout: 120_000,
	});
	pack.stdin!.on("error", () => {});
	try {
		const transferred = Promise.all([waitChild(pack), waitChild(unpack), pipeline(pack.stdout!, unpack.stdin!)]);
		pack.stdin!.end(`${commit}\n`);
		await transferred;
	} catch {
		pack.kill();
		unpack.kill();
		throw new UserError("Cannot transfer checkpoint Git objects; the destination branch was not created.");
	}
}

async function validateBranch(context: GitContext, branch: string): Promise<string> {
	if (typeof branch !== "string" || !branch || branch.startsWith("-") || branch.startsWith("refs/") || branch === "HEAD") {
		throw new UserError("An explicit, valid new branch name is required.");
	}
	const ref = `refs/heads/${branch}`;
	await command(context, ["check-ref-format", ref], "Invalid branch name.");
	const existing = await command(context, ["show-ref", "--verify", "--quiet", ref], "No existing branch.").then(() => true, () => false);
	const symbolic = await command(context, ["symbolic-ref", "--quiet", ref], "Not a symbolic branch.").catch(() => "");
	if (existing || symbolic) throw new UserError("Destination branch already exists; choose a new branch name.", 409);
	const head = await command(context, ["symbolic-ref", "--quiet", "HEAD"], "Detached HEAD.").catch(() => "");
	const worktrees = await command(context, ["worktree", "list", "--porcelain", "-z"], "Cannot inspect destination worktrees.");
	if (head === ref || worktrees.split("\0").includes(`branch ${ref}`)) {
		throw new UserError("Destination branch is checked out, possibly unborn; choose a new branch name.", 409);
	}
	return ref;
}

export async function exportRunToGit(store: Store, options: GitExportOptions): Promise<GitExportResult> {
	safeName(options.runId, "run id");
	if (options.push !== undefined && typeof options.push !== "boolean") throw new UserError("push must be an explicit boolean.");
	if (options.remote !== undefined && (typeof options.remote !== "string" || !REMOTE_NAME.test(options.remote))) {
		throw new UserError("Remote must be an existing remote name, never a URL or an option.");
	}
	if (options.push === true && !options.remote) throw new UserError("An existing named remote is required for push.");
	if (typeof options.destination !== "string" || !options.destination || options.destination.includes("\0") || options.destination.startsWith("-")) {
		throw new UserError("An existing local Git repository destination is required.");
	}
	let run: RunRecord;
	try {
		run = store.getRun(options.runId);
	} catch {
		throw new UserError("Stored run is missing or invalid.");
	}
	safeName(run.task, "stored task");
	if (run.snapshotFinal == null) throw new UserError("Run has no snapshotFinal checkpoint; record a final snapshot before exporting.");
	if (typeof run.snapshotFinal !== "string" || !OBJECT_ID.test(run.snapshotFinal)) throw new UserError("Run snapshotFinal must be a full Git commit object ID.");
	const commit = run.snapshotFinal;
	const destination = { cwd: resolve(options.destination) };
	const destinationGitDir = await command(destination, ["rev-parse", "--absolute-git-dir"], "Destination must be an existing Git repository.");
	if (existsSync(store.repoDir(run.task)) && realpathSync(destinationGitDir) === realpathSync(store.repoDir(run.task))) {
		throw new UserError("Destination must not be the stored task repository.");
	}
	const ref = await validateBranch(destination, options.branch);
	if (options.remote) {
		const remotes = await command(destination, ["remote"], "Cannot inspect destination remote names.");
		if (!remotes.split("\n").includes(options.remote)) throw new UserError("The named remote does not exist in the destination repository.");
	}
	return withSource(store, run.task, async (source) => {
		const sourceCheckpoint = await checkpoint(source, commit);
		if (sourceCheckpoint.status !== "available") throw new UserError("snapshotFinal is not an available commit in the stored task repository.");
		const tree = await command(source, ["rev-parse", "--verify", `${commit}^{tree}`], "Checkpoint tree is unavailable.");
		await checkHistory(source, commit);
		await transferObjects(source, destination, commit);
		await command(destination, ["update-ref", "--no-deref", "--stdin"], "Cannot create new destination branch; it may already exist.", `create ${ref} ${commit}\n`);
		const result: GitExportResult = {
			format: "tapedeck.git-export/v1",
			status: "exported",
			branch: options.branch,
			ref,
			commit,
			tree,
			branchCreated: true,
			pushed: false,
			push: { requested: options.push === true, remote: options.remote ?? null, status: "not-requested" },
			provenance: {
				runId: options.runId, task: run.task, repository: `repos/${run.task}.git`, snapshot: "snapshotFinal",
				credentialPolicy: "reject-known-sensitive-paths-in-history",
			},
		};
		if (options.push === true) {
			try {
				await command(destination, [
					"-c", `remote.${options.remote}.mirror=false`, "-c", "push.followTags=false", "-c", "push.recurseSubmodules=no",
					"push", "--porcelain", "--no-verify", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--signed=false",
					"--", options.remote!, `${commit}:${ref}`,
				], "Push failed; the local export branch remains available. Check the named remote and permissions.");
				result.status = "pushed";
				result.pushed = true;
				result.push.status = "pushed";
			} catch {
				result.status = "push-failed";
				result.push.status = "failed";
				result.push.error = "Push failed; the local export branch remains available. Check the named remote and permissions.";
			}
		}
		return result;
	});
}
