/**
 * Task repositories: one bare repo per task (store/repos/<task>.git) whose `main` is the task
 * base, and one disposable worktree per run. pi-tape's snapshots are commits in the same bare
 * repo, so any worktree of a task can restore any snapshot of any earlier run of that task.
 */

import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./store.ts";
import type { Task } from "./types.ts";
import { cleanEnv, KeyedMutex } from "./util.ts";

/** Worktree add/remove and base updates touch shared repo metadata: one at a time per task. */
const repoLocks = new KeyedMutex();

/** Fixed identity and date, so the same task files always give the same base commit. */
const BASE_ENV = {
	GIT_AUTHOR_NAME: "tapedeck",
	GIT_AUTHOR_EMAIL: "tapedeck@localhost",
	GIT_COMMITTER_NAME: "tapedeck",
	GIT_COMMITTER_EMAIL: "tapedeck@localhost",
	GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
	GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export function git(args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		// cleanEnv drops GIT_DIR, GIT_INDEX_FILE, … that would redirect git from outside.
		execFile("git", args, { env: { ...cleanEnv(), ...extraEnv }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) reject(new Error(`git ${args.join(" ")} failed: ${(stderr || err.message).trim()}`));
			else resolvePromise(stdout.trim());
		});
	});
}

/**
 * Makes sure the task's bare repo exists and that `main` holds the current contents of the
 * task's repo/ directory. Returns the base commit. When the task files changed since the
 * repo was made, `main` moves to a new root commit (older snapshots stay valid).
 */
export function ensureTaskRepo(store: Store, task: Task): Promise<string> {
	const repo = store.repoDir(task.id);
	return repoLocks.run(task.id, async () => {
		if (!existsSync(repo)) {
			await git(["init", "--bare", "--quiet", repo]);
			// pi-tape writes many refs and objects from concurrent worktrees: never auto-gc.
			await git(["--git-dir", repo, "config", "gc.auto", "0"]);
		}
		const index = join(repo, `tapedeck-index-${process.pid}-${Date.now()}`);
		let tree: string;
		try {
			// -f: files such as .env must be part of the base even if a global excludes file ignores them.
			await git(["--git-dir", repo, "--work-tree", join(task.dir, "repo"), "add", "-A", "-f", "."], { GIT_INDEX_FILE: index });
			tree = await git(["--git-dir", repo, "write-tree"], { GIT_INDEX_FILE: index });
		} finally {
			rmSync(index, { force: true });
		}
		const current = await git(["--git-dir", repo, "rev-parse", "--verify", "--quiet", "refs/heads/main"]).catch(() => "");
		if (current && (await git(["--git-dir", repo, "rev-parse", `${current}^{tree}`])) === tree) return current;
		const base = await git(["--git-dir", repo, "commit-tree", tree, "-m", `task ${task.id} base`], BASE_ENV);
		await git(["--git-dir", repo, "update-ref", "refs/heads/main", base]);
		return base;
	});
}

/** Checks out `commit` (detached) into a new worktree at `dir`. */
export function addWorktree(store: Store, taskId: string, dir: string, commit: string): Promise<void> {
	const repo = store.repoDir(taskId);
	return repoLocks.run(taskId, async () => {
		await git(["--git-dir", repo, "worktree", "prune"]);
		await git(["--git-dir", repo, "worktree", "add", "--detach", "--quiet", dir, commit]);
	});
}

/** Deletes a worktree and its metadata; tolerates a half-created or already deleted one. */
export function removeWorktree(store: Store, taskId: string, dir: string): Promise<void> {
	const repo = store.repoDir(taskId);
	return repoLocks.run(taskId, async () => {
		try {
			await git(["--git-dir", repo, "worktree", "remove", "--force", dir]);
		} catch {
			rmSync(dir, { recursive: true, force: true });
			if (existsSync(repo)) await git(["--git-dir", repo, "worktree", "prune"]);
		}
	});
}
