import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import { exportRunToGit, gitStatus, type GitExportOptions } from "../src/git-export.ts";
import { Store } from "../src/store.ts";
import type { RunRecord } from "../src/types.ts";
import { cleanEnv } from "../src/util.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-c", `core.hooksPath=${devNull}`, "-c", "core.fsmonitor=false", ...args], {
		cwd,
		env: {
			...cleanEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull,
			GIT_AUTHOR_NAME: "TapeDeck test", GIT_AUTHOR_EMAIL: "test@localhost",
			GIT_COMMITTER_NAME: "TapeDeck test", GIT_COMMITTER_EMAIL: "test@localhost",
		},
		encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
	}).trimEnd();
}

function write(root: string, path: string, content: string): void {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function fileState(root: string): Record<string, string> {
	const files: Record<string, string> = {};
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else files[relative(root, path)] = readFileSync(path).toString("base64");
		}
	};
	visit(root);
	return files;
}

function destinationState(destination: string) {
	const gitDir = git(destination, "rev-parse", "--absolute-git-dir");
	const configPath = git(destination, "rev-parse", "--path-format=absolute", "--git-path", "config");
	return {
		head: readFileSync(join(gitDir, "HEAD"), "utf8"),
		commit: git(destination, "rev-parse", "HEAD"),
		index: readFileSync(join(gitDir, "index")).toString("base64"),
		config: readFileSync(configPath, "utf8"),
		fetchHead: existsSync(join(gitDir, "FETCH_HEAD")) ? readFileSync(join(gitDir, "FETCH_HEAD"), "utf8") : null,
		files: fileState(destination),
	};
}

function fixture(context: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "tapedeck-git-export-test-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const store = Store.open(join(root, "store"));
	const source = join(root, "source");
	const destination = join(root, "destination");
	git(root, "init", "--quiet", "--template=", "--initial-branch=main", source);
	write(source, "result.txt", "before agent\n");
	git(source, "add", ".");
	git(source, "commit", "--quiet", "-m", "base");
	const base = git(source, "rev-parse", "HEAD");
	write(source, "result.txt", "after agent\n");
	write(source, "nested/checkpoint.txt", "recorded checkpoint\n");
	git(source, "add", ".");
	git(source, "commit", "--quiet", "-m", "checkpoint");
	const commit = git(source, "rev-parse", "HEAD");
	const repo = store.repoDir("task-test");
	git(root, "clone", "--quiet", "--bare", source, repo);
	git(root, "--git-dir", repo, "update-ref", "refs/tapes/run-test/final", commit);
	git(root, "--git-dir", repo, "update-ref", "refs/heads/main", base);
	git(root, "init", "--quiet", "--template=", "--initial-branch=main", destination);
	write(destination, "local.txt", "original destination\n");
	git(destination, "add", ".");
	git(destination, "commit", "--quiet", "-m", "destination history");
	write(destination, "local.txt", "staged destination change\n");
	git(destination, "add", "local.txt");
	write(destination, "local.txt", "unstaged destination change\n");
	write(destination, "untracked.txt", "untracked destination\n");
	write(destination, ".env", "DESTINATION_SECRET=must-not-be-exported\n");
	write(destination, ".git/FETCH_HEAD", "existing fetch state\n");
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
	const run: RunRecord = {
		format: "tapedeck.run/v1", id: "run-test", kind: "run", task: "task-test", split: "held-in", variant: "vanilla",
		model: "secret-bearing-metadata-is-not-provenance", parent: null, forkAt: null, lenient: [], tapeSource: null,
		status: "done", error: null, startedAt: "2026-09-26T00:00:00Z", finishedAt: "2026-09-26T00:00:01Z", durationMs: 1000,
		pass: true, verify: null, steps: { total: 1, replayed: 0, live: 1 }, usage, savedUsage: usage, divergence: null,
		snapshotBase: base, snapshotFinal: commit, sessionFile: null, reportFile: null, repo: "repos/task-test.git",
	};
	store.writeRun(run);
	const options: GitExportOptions = { runId: run.id, destination, branch: "checkpoints/run-test" };
	return { root, store, source, destination, repo, run, base, commit, options };
}

test("local export transfers the exact final checkpoint, preserving destination HEAD, index, configuration and files", async (context) => {
	const setup = fixture(context);
	const before = destinationState(setup.destination);
	const result = await exportRunToGit(setup.store, setup.options);
	assert.equal(result.status, "exported");
	assert.equal(result.branchCreated, true);
	assert.equal(result.pushed, false);
	assert.deepEqual(result.push, { requested: false, remote: null, status: "not-requested" });
	assert.equal(result.commit, setup.commit);
	assert.equal(git(setup.destination, "rev-parse", result.ref), setup.commit);
	assert.equal(git(setup.destination, "show", `${result.ref}:result.txt`), "after agent");
	assert.equal(git(setup.destination, "show", `${result.ref}:nested/checkpoint.txt`), "recorded checkpoint");
	assert.equal(git(setup.destination, "rev-parse", `${result.ref}^`), setup.base);
	assert.equal(git(setup.destination, "rev-parse", `${result.ref}^{tree}`), result.tree);
	assert.equal(git(setup.destination, "ls-tree", "-r", "--name-only", result.ref), "nested/checkpoint.txt\nresult.txt");
	assert.deepEqual(destinationState(setup.destination), before);
	assert.equal(git(setup.root, "--git-dir", setup.repo, "rev-parse", "refs/heads/main"), setup.base);
	assert.ok(!JSON.stringify(result).includes(setup.run.model));
	assert.ok(!JSON.stringify(result).includes(setup.root));
});

test("status reports refs and checkpoint availability without returning remote credentials or archived metadata", async (context) => {
	const setup = fixture(context);
	git(setup.root, "--git-dir", setup.repo, "remote", "set-url", "origin", "https://user:credential-canary@example.invalid/repo?token=secret");
	git(setup.root, "--git-dir", setup.repo, "pack-refs", "--all");
	const status = await gitStatus(setup.store, setup.run.task);
	assert.equal(status.format, "tapedeck.git-status/v1");
	assert.equal(status.repository.status, "available");
	assert.equal(status.remotesIncluded, false);
	assert.ok(status.refs.some((entry) => entry.ref === "refs/tapes/run-test/final" && entry.commit === setup.commit));
	assert.deepEqual(status.checkpoints, [{
		runId: setup.run.id,
		snapshotBase: { status: "available", commit: setup.base },
		snapshotFinal: { status: "available", commit: setup.commit },
	}]);
	assert.doesNotMatch(JSON.stringify(status), /credential-canary|example\.invalid|token=|secret-bearing/);
});

test("status distinguishes unrecorded, missing, invalid and unavailable checkpoint objects", async (context) => {
	const setup = fixture(context);
	setup.store.writeRun({ ...setup.run, id: "run-no-snapshot", snapshotFinal: null });
	setup.store.writeRun({ ...setup.run, id: "run-missing", snapshotFinal: "a".repeat(40) });
	setup.store.writeRun({ ...setup.run, id: "run-invalid", snapshotFinal: "--credential-canary" });
	const blob = git(setup.source, "rev-parse", "HEAD:result.txt");
	setup.store.writeRun({ ...setup.run, id: "run-blob", snapshotFinal: blob });
	const status = await gitStatus(setup.store, setup.run.task);
	const statuses = Object.fromEntries(status.checkpoints.map((entry) => [entry.runId, entry.snapshotFinal.status]));
	assert.deepEqual(statuses, { "run-test": "available", "run-no-snapshot": "not-recorded", "run-missing": "missing", "run-invalid": "invalid", "run-blob": "invalid" });
	assert.doesNotMatch(JSON.stringify(status), /credential-canary/);
	rmSync(setup.repo, { recursive: true });
	const missing = await gitStatus(setup.store, setup.run.task);
	assert.equal(missing.repository.status, "missing");
	assert.deepEqual(missing.refs, []);
	assert.equal(missing.checkpoints.find((entry) => entry.runId === "run-test")?.snapshotFinal.status, "repository-unavailable");
	assert.equal((await gitStatus(setup.store, "unknown-task")).repository.status, "missing");
	await assert.rejects(gitStatus(setup.store, "../outside"), /Invalid task/);
});

test("invalid or option-like branch names cannot create refs or alter destination state", async (context) => {
	const setup = fixture(context);
	const before = destinationState(setup.destination);
	for (const branch of ["", "-bad", "--force", "HEAD", "refs/heads/ambiguous", "bad..name", "bad name", "bad\nname", "a:b", "@{-1}", "bad.lock", "/absolute", "trailing/", "nul\0branch"]) {
		await assert.rejects(exportRunToGit(setup.store, { ...setup.options, branch }), /branch/i, branch);
	}
	assert.equal(git(setup.destination, "for-each-ref", "--format=%(refname)", "refs/heads"), "refs/heads/main");
	assert.deepEqual(destinationState(setup.destination), before);
});

test("existing and symbolic branches are refused, even when they already point at the checkpoint", async (context) => {
	const setup = fixture(context);
	await exportRunToGit(setup.store, setup.options);
	const before = destinationState(setup.destination);
	await assert.rejects(exportRunToGit(setup.store, setup.options), /already exists/);
	await assert.rejects(exportRunToGit(setup.store, { ...setup.options, branch: "main" }), /already exists/);
	git(setup.destination, "symbolic-ref", "refs/heads/dangling", "refs/heads/absent");
	await assert.rejects(exportRunToGit(setup.store, { ...setup.options, branch: "dangling" }), /already exists/);
	assert.equal(git(setup.destination, "symbolic-ref", "refs/heads/dangling"), "refs/heads/absent");
	assert.deepEqual(destinationState(setup.destination), before);
});

test("an unborn destination HEAD is preserved and a different new branch can be exported", async (context) => {
	const setup = fixture(context);
	const unborn = join(setup.root, "unborn");
	git(setup.root, "init", "--quiet", "--template=", "--initial-branch=unborn", unborn);
	write(unborn, "local.txt", "not committed\n");
	git(unborn, "add", ".");
	const index = readFileSync(join(unborn, ".git/index"));
	await assert.rejects(exportRunToGit(setup.store, { ...setup.options, destination: unborn, branch: "unborn" }), /checked out/);
	await exportRunToGit(setup.store, { ...setup.options, destination: unborn });
	assert.equal(git(unborn, "symbolic-ref", "HEAD"), "refs/heads/unborn");
	assert.throws(() => git(unborn, "rev-parse", "--verify", "HEAD"));
	assert.deepEqual(readFileSync(join(unborn, ".git/index")), index);
	assert.equal(readFileSync(join(unborn, "local.txt"), "utf8"), "not committed\n");
});

test("a detached destination and linked worktree retain their HEADs and index bytes", async (context) => {
	const setup = fixture(context);
	git(setup.destination, "checkout", "--detach", "--quiet");
	const before = destinationState(setup.destination);
	await exportRunToGit(setup.store, setup.options);
	assert.deepEqual(destinationState(setup.destination), before);
	const linked = join(setup.root, "linked");
	git(setup.destination, "worktree", "add", "--quiet", "-b", "linked", linked, "main");
	write(linked, "local.txt", "linked edits\n");
	git(linked, "add", "local.txt");
	const linkedBefore = destinationState(linked);
	await exportRunToGit(setup.store, { ...setup.options, destination: linked, branch: "checkpoints/linked" });
	assert.deepEqual(destinationState(linked), linkedBefore);
	assert.deepEqual(destinationState(setup.destination), before);
});

test("no snapshotFinal, a missing object, or an invalid source fails before creating a branch", async (context) => {
	const setup = fixture(context);
	const before = destinationState(setup.destination);
	for (const snapshotFinal of [null, "f".repeat(40), "--all", git(setup.source, "rev-parse", "HEAD:result.txt")]) {
		setup.store.writeRun({ ...setup.run, snapshotFinal });
		await assert.rejects(exportRunToGit(setup.store, setup.options), /snapshotFinal/);
	}
	setup.store.writeRun(setup.run);
	rmSync(setup.repo, { recursive: true });
	await assert.rejects(exportRunToGit(setup.store, setup.options), /repository is missing/);
	assert.deepEqual(destinationState(setup.destination), before);
	assert.throws(() => git(setup.destination, "rev-parse", "--verify", "refs/heads/checkpoints/run-test"));
});

test("archived configuration, hooks and includes are never executed or imported", async (context) => {
	const setup = fixture(context);
	const marker = join(setup.root, "hook-executed");
	const hookBody = `#!/bin/sh\nprintf unsafe > '${marker}'\n`;
	for (const hooks of [join(setup.repo, "hooks"), join(setup.destination, ".git/hooks")]) {
		mkdirSync(hooks, { recursive: true });
		for (const name of ["reference-transaction", "post-checkout", "pre-push"]) writeFileSync(join(hooks, name), hookBody, { mode: 0o755 });
	}
	git(setup.root, "--git-dir", setup.repo, "config", "include.path", "credential-canary-missing-config");
	git(setup.root, "--git-dir", setup.repo, "config", "core.sshCommand", `touch '${marker}'`);
	git(setup.root, "--git-dir", setup.repo, "config", "credential.helper", `!touch '${marker}'`);
	git(setup.root, "--git-dir", setup.repo, "config", "uploadpack.packObjectsHook", `touch '${marker}'`);
	git(setup.root, "--git-dir", setup.repo, "remote", "set-url", "origin", "ext::unsafe-credential-canary");
	const remote = join(setup.root, "remote.git");
	git(setup.root, "init", "--bare", "--quiet", "--template=", remote);
	git(setup.destination, "remote", "add", "local", remote);
	assert.equal((await gitStatus(setup.store, setup.run.task)).repository.status, "available");
	const result = await exportRunToGit(setup.store, { ...setup.options, remote: "local", push: true });
	assert.equal(result.status, "pushed");
	assert.equal(existsSync(marker), false);
	assert.doesNotMatch(JSON.stringify(result), /credential-canary|unsafe/);
	assert.doesNotMatch(readFileSync(join(setup.destination, ".git/config"), "utf8"), /credential-canary|packObjectsHook/);
});

test("known auth and env paths in checkpoint ancestry are rejected even after deletion", async (context) => {
	const setup = fixture(context);
	const before = destinationState(setup.destination);
	for (const path of [".env", "nested/.env.production", "agent/auth.json", ".aws/credentials", "config/private.pem", ".git-credentials"]) {
		git(setup.source, "reset", "--hard", setup.commit);
		write(setup.source, path, "credential-canary\n");
		git(setup.source, "add", "-f", path);
		git(setup.source, "commit", "--quiet", "-m", "secret checkpoint");
		git(setup.source, "rm", "--quiet", path);
		git(setup.source, "commit", "--quiet", "-m", "remove secret");
		const commit = git(setup.source, "rev-parse", "HEAD");
		git(setup.root, "--git-dir", setup.repo, "fetch", "--quiet", setup.source, "main");
		setup.store.writeRun({ ...setup.run, snapshotFinal: commit });
		await assert.rejects(exportRunToGit(setup.store, setup.options), /auth, credential, or env file/, path);
		assert.throws(() => git(setup.destination, "cat-file", "-t", commit));
	}
	assert.deepEqual(destinationState(setup.destination), before);
});

test("push is never inferred from a remote and only explicit true pushes to a local named remote", async (context) => {
	const setup = fixture(context);
	const remote = join(setup.root, "remote.git");
	git(setup.root, "init", "--bare", "--quiet", "--template=", remote);
	git(setup.destination, "remote", "add", "local", remote);
	const before = destinationState(setup.destination);
	for (const [branch, push] of [["checkpoints/no-push", undefined], ["checkpoints/false", false]] as const) {
		const result = await exportRunToGit(setup.store, { ...setup.options, branch, remote: "local", push });
		assert.equal(result.status, "exported");
		assert.equal(result.push.status, "not-requested");
		assert.equal(git(setup.root, "--git-dir", remote, "for-each-ref"), "");
	}
	const result = await exportRunToGit(setup.store, { ...setup.options, remote: "local", push: true });
	assert.equal(result.status, "pushed");
	assert.equal(result.pushed, true);
	assert.equal(git(setup.root, "--git-dir", remote, "rev-parse", result.ref), setup.commit);
	assert.equal(git(setup.root, "--git-dir", remote, "for-each-ref", "--format=%(refname)"), result.ref);
	assert.deepEqual(destinationState(setup.destination), before);
});

test("remote URLs, option injection, unknown remotes and non-boolean push are rejected without export", async (context) => {
	const setup = fixture(context);
	for (const remote of ["--all", "-f", "https://user:credential-canary@example.invalid/repo", "../elsewhere", "origin\n--force", "missing"]) {
		await assert.rejects(exportRunToGit(setup.store, { ...setup.options, remote, push: true }), /remote/i);
	}
	await assert.rejects(exportRunToGit(setup.store, { ...setup.options, push: true }), /remote/i);
	await assert.rejects(exportRunToGit(setup.store, { ...setup.options, push: "true" as unknown as boolean }), /boolean/);
	assert.throws(() => git(setup.destination, "rev-parse", "--verify", "refs/heads/checkpoints/run-test"));
});

test("non-fast-forward push failure preserves the local export and never forces or leaks Git diagnostics", async (context) => {
	const setup = fixture(context);
	const remote = join(setup.root, "remote.git");
	git(setup.root, "init", "--bare", "--quiet", "--template=", remote);
	git(setup.destination, "remote", "add", "local", remote);
	git(setup.destination, "push", "--quiet", "local", `HEAD:refs/heads/${setup.options.branch}`);
	const original = git(setup.root, "--git-dir", remote, "rev-parse", `refs/heads/${setup.options.branch}`);
	const result = await exportRunToGit(setup.store, { ...setup.options, remote: "local", push: true });
	assert.equal(result.status, "push-failed");
	assert.equal(result.branchCreated, true);
	assert.equal(result.push.status, "failed");
	assert.match(result.push.error ?? "", /local export branch remains/);
	assert.equal(git(setup.destination, "rev-parse", result.ref), setup.commit);
	assert.equal(git(setup.root, "--git-dir", remote, "rev-parse", result.ref), original);
	git(setup.destination, "remote", "set-url", "local", join(setup.root, "user:credential-canary@missing"));
	const failed = await exportRunToGit(setup.store, { ...setup.options, branch: "checkpoints/failed", remote: "local", push: true });
	assert.equal(failed.status, "push-failed");
	assert.doesNotMatch(JSON.stringify(failed), /credential-canary|@missing/);
});

test("push ignores mirror, follow-tags and extra configured push refspecs", async (context) => {
	const setup = fixture(context);
	const remote = join(setup.root, "remote.git");
	git(setup.root, "init", "--bare", "--quiet", "--template=", remote);
	git(setup.destination, "remote", "add", "local", remote);
	git(setup.destination, "config", "remote.local.mirror", "true");
	git(setup.destination, "config", "remote.local.push", "+refs/heads/main:refs/heads/unwanted");
	git(setup.destination, "config", "push.followTags", "true");
	await exportRunToGit(setup.store, { ...setup.options, branch: "checkpoints/local-only" });
	git(setup.destination, "tag", "-a", "do-not-push", setup.commit, "-m", "unrelated tag");
	const result = await exportRunToGit(setup.store, { ...setup.options, remote: "local", push: true });
	assert.equal(result.status, "pushed");
	assert.equal(git(setup.root, "--git-dir", remote, "for-each-ref", "--format=%(refname)"), result.ref);
});

test("unsafe archived symlinks fail closed and status remains machine-readable", async (context) => {
	const setup = fixture(context);
	symlinkSync(join(setup.root, "source"), join(setup.repo, "objects/unsafe-link"));
	assert.equal((await gitStatus(setup.store, setup.run.task)).repository.status, "invalid");
	await assert.rejects(exportRunToGit(setup.store, setup.options), /symbolic links/);
	assert.throws(() => git(setup.destination, "rev-parse", "--verify", "refs/heads/checkpoints/run-test"));
});

test("concurrent exports never overwrite the same branch", async (context) => {
	const setup = fixture(context);
	const outcomes = await Promise.allSettled([exportRunToGit(setup.store, setup.options), exportRunToGit(setup.store, setup.options)]);
	assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
	assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
	assert.equal(git(setup.destination, "rev-parse", `refs/heads/${setup.options.branch}`), setup.commit);
});
