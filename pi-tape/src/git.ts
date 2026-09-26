/**
 * Git snapshots of a working tree (INTERFACES §2.6).
 *
 * A snapshot is a commit of the whole working tree (tracked and untracked files, ignored files
 * excluded), built through a private index file so it never touches HEAD, the real index or
 * any branch. Restoring also goes through the private index, so the real index stays as it was.
 * All operations on one workspace run one at a time, in call order.
 */

import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const AUTHOR = { name: "tapedeck", email: "tapedeck@localhost" };

export class GitError extends Error {
	override name = "GitError";
}

function runGit(cwd: string, args: string[], env: Record<string, string | undefined>): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile("git", args, { cwd, env, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
			if (error) reject(new GitError(`git ${args[0]}: ${(stderr || error.message).trim()}`));
			else resolvePromise(stdout.trim());
		});
	});
}

/** The environment for git: the caller's, minus an inherited index override. */
function baseEnv(): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
	delete env.GIT_INDEX_FILE;
	return env;
}

export interface OpenWorkspaceOptions {
	/** Ref namespace for snapshots, e.g. `refs/tapes/<sessionId>`. */
	refPrefix: string;
}

export class GitWorkspace {
	/** The working tree's top-level directory. */
	readonly top: string;
	readonly refPrefix: string;
	/** Parent of the next snapshot: the last snapshot taken or restored (initially HEAD, if any). */
	head: string | null;
	private readonly realIndex: string;
	private readonly tempDir: string;
	private readonly tempIndex: string;
	private tempIndexReady = false;
	private queue: Promise<unknown> = Promise.resolve();

	private constructor(top: string, realIndex: string, head: string | null, refPrefix: string) {
		this.top = top;
		this.realIndex = realIndex;
		this.head = head;
		this.refPrefix = refPrefix;
		this.tempDir = mkdtempSync(join(tmpdir(), "pi-tape-"));
		this.tempIndex = join(this.tempDir, "index");
	}

	/** Open the git working tree containing `cwd`, or return null if there is none. */
	static async open(cwd: string, options: OpenWorkspaceOptions): Promise<GitWorkspace | null> {
		const env = baseEnv();
		let top: string;
		try {
			top = await runGit(cwd, ["rev-parse", "--show-toplevel"], env);
		} catch {
			return null;
		}
		if (!top) return null;
		const indexPath = resolve(top, await runGit(top, ["rev-parse", "--git-path", "index"], env));
		const head = await runGit(top, ["rev-parse", "--verify", "-q", "HEAD"], env).catch(() => "");
		return new GitWorkspace(top, indexPath, head || null, options.refPrefix);
	}

	/** Run git at the top of the working tree. */
	git(args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
		return runGit(this.top, args, { ...baseEnv(), ...extraEnv });
	}

	/** Git through the private index. It starts as a copy of the real index, which makes `git add -A` fast. */
	private gitTemp(args: string[]): Promise<string> {
		if (!this.tempIndexReady) {
			if (existsSync(this.realIndex)) copyFileSync(this.realIndex, this.tempIndex);
			this.tempIndexReady = true;
		}
		return this.git(args, { GIT_INDEX_FILE: this.tempIndex });
	}

	private serialize<T>(task: () => Promise<T>): Promise<T> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	/**
	 * Commit the current working tree as `<refPrefix>/<name>` with the last snapshot as parent.
	 * Returns the commit sha.
	 */
	snapshot(name: string, message: string, date = new Date()): Promise<string> {
		return this.serialize(async () => {
			await this.gitTemp(["add", "-A"]);
			const tree = await this.gitTemp(["write-tree"]);
			const stamp = `@${Math.floor(date.getTime() / 1000)} +0000`;
			const args = ["commit-tree", "--no-gpg-sign", ...(this.head ? ["-p", this.head] : []), "-m", message, tree];
			const commit = await this.git(args, {
				GIT_AUTHOR_NAME: AUTHOR.name,
				GIT_AUTHOR_EMAIL: AUTHOR.email,
				GIT_AUTHOR_DATE: stamp,
				GIT_COMMITTER_NAME: AUTHOR.name,
				GIT_COMMITTER_EMAIL: AUTHOR.email,
				GIT_COMMITTER_DATE: stamp,
			});
			await this.git(["update-ref", `${this.refPrefix}/${name}`, commit]);
			this.head = commit;
			return commit;
		});
	}

	/**
	 * Make the working tree equal to a snapshot: changed and deleted files are restored, files
	 * the snapshot does not have are removed. Ignored files are left alone.
	 */
	restore(commit: string): Promise<void> {
		return this.serialize(async () => {
			await this.gitTemp(["add", "-A"]);
			await this.gitTemp(["read-tree", "--reset", "-u", commit]);
			await this.gitTemp(["clean", "-fdq"]);
			this.head = commit;
		});
	}

	/** The tree id of the current working tree (tracked and untracked, ignored excluded). */
	workingTree(): Promise<string> {
		return this.serialize(async () => {
			await this.gitTemp(["add", "-A"]);
			return this.gitTemp(["write-tree"]);
		});
	}

	/** Remove the private index. The workspace must not be used afterwards. */
	dispose(): void {
		rmSync(this.tempDir, { recursive: true, force: true });
	}
}
