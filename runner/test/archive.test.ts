import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { captureArchive, restoreArchive, validateArchive, type AgentArchive, type ArchiveFile } from "../src/archive.ts";
import { git } from "../src/git.ts";
import { Runner } from "../src/runs.ts";
import { Store } from "../src/store.ts";
import type { RunRecord } from "../src/types.ts";

function workspace(context: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "tapedeck-archive-test-"));
	context.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function entry(path: string, content: string | Buffer, mode = 0o644): ArchiveFile {
	const data = Buffer.from(content);
	return { path, mode, size: data.length, sha256: createHash("sha256").update(data).digest("hex"), data: data.toString("base64") };
}

function emptyArchive(): AgentArchive {
	return { format: "tapedeck.archive/v1", createdAt: new Date().toISOString(), files: [], gitBundles: [] };
}

function record(id: string, task = "unit"): RunRecord {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
	return {
		format: "tapedeck.run/v1", id, task, variant: "vanilla", kind: "run", split: "held-in", model: "scripted/toy",
		parent: null, forkAt: null, lenient: [], tapeSource: null, status: "done", error: null, startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(), durationMs: 1, pass: true, verify: null, steps: { total: 0, live: 0, replayed: 0 },
		usage, savedUsage: { ...usage }, divergence: null, snapshotBase: null, snapshotFinal: null,
		sessionFile: `runs/${id}/session.jsonl`, reportFile: null, repo: `repos/${task}.git`,
	};
}

async function fixture(dir: string): Promise<{ store: Store; commit: string }> {
	const store = Store.open(join(dir, "original"));
	const source = join(dir, "source");
	mkdirSync(source);
	writeFileSync(join(source, "hello.txt"), "portable\n");
	writeFileSync(join(source, "run.sh"), "#!/bin/sh\nprintf portable\n", { mode: 0o755 });
	await git(["init", "--quiet", "--initial-branch=main", source]);
	await git(["-C", source, "add", "."]);
	await git(["-C", source, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "base"]);
	await git(["init", "--bare", "--quiet", "--initial-branch=main", store.repoDir("unit")]);
	await git(["--git-dir", store.repoDir("unit"), "fetch", "--quiet", source, "refs/heads/main:refs/heads/main"]);
	const commit = await git(["--git-dir", store.repoDir("unit"), "rev-parse", "main"]);
	await git(["--git-dir", store.repoDir("unit"), "update-ref", "refs/tapes/recorded/step-1", commit]);
	await git(["--git-dir", store.repoDir("unit"), "update-ref", "refs/tags/baseline", commit]);
	const run = { ...record("recorded"), snapshotBase: commit, snapshotFinal: commit };
	store.writeRun(run);
	const cwd = join(store.home, "work", run.id);
	writeFileSync(join(store.runDir(run.id), "session.jsonl"), `${JSON.stringify({ type: "session", id: "session", cwd })}\n${JSON.stringify({ type: "custom", customType: "tape.header", data: { cwd, upstream: { location: join(store.runDir(run.id), "session.jsonl") } } })}\n`);
	store.writeRun({ ...record("child"), kind: "fork", parent: "recorded", tapeSource: join(store.runDir("recorded"), "session.jsonl"), sessionFile: null });
	for (const artifact of ["stdout.log", "stderr.log", "events.jsonl", "verify.json", "tape-report.json"]) writeFileSync(join(store.runDir("recorded"), artifact), artifact.endsWith(".json") ? "{}\n" : "trace\n");
	mkdirSync(join(store.runDir("recorded"), "agent"));
	writeFileSync(join(store.runDir("recorded"), "agent", "auth.json"), "SECRET");
	writeFileSync(join(store.runDir("recorded"), "agent", "models.json"), "SECRET_MODEL_LITERAL");
	writeFileSync(join(store.runDir("recorded"), "auth.json"), "SECRET");
	writeFileSync(join(store.home, ".env"), "SECRET=private");
	mkdirSync(store.workDir("recorded"));
	writeFileSync(join(store.workDir("recorded"), "not-recorded.txt"), "live file");
	writeFileSync(join(store.home, "reports", "report.json"), "{}");
	writeFileSync(join(store.home, "tapes", "edit.json"), JSON.stringify({ cwd, sourceSession: join(store.runDir("recorded"), "session.jsonl") }));
	mkdirSync(join(store.home, "comparisons"));
	writeFileSync(join(store.home, "comparisons", "comparison.json"), "{}");
	return { store, commit };
}

test("archive round trip preserves refs, trace, final files and recorded cwd, but not secrets/worktrees", async (context) => {
	const dir = workspace(context);
	const { store, commit } = await fixture(dir);
	const profile = { name: "adaptive-example", tools: ["read"], context: { maxToolResultChars: 8000 } };
	writeFileSync(join(store.runDir("recorded"), "variant.json"), JSON.stringify(profile));
	mkdirSync(join(store.home, "reports", "harness", "example"), { recursive: true });
	writeFileSync(join(store.home, "reports", "harness", "example", "active.json"), JSON.stringify({ variant: profile }));
	const archive = await captureArchive(store);
	assert.equal(archive.format, "tapedeck.archive/v1");
	assert.equal(archive.gitBundles.length, 1);
	assert.ok(archive.files.some((file) => file.path === "snapshots/recorded/hello.txt"));
	assert.ok(archive.files.some((file) => file.path === "catalog/variants/vanilla/variant.json"));
	assert.ok(!archive.files.some((file) => /auth\.json|\/agent\/|^work\/|^repos\/|\.env$/.test(file.path)));
	const restored = await restoreArchive(archive, join(dir, "restored"));
	assert.deepEqual(JSON.parse(readFileSync(join(restored.runDir("recorded"), "variant.json"), "utf8")), profile);
	assert.deepEqual(JSON.parse(readFileSync(join(restored.home, "reports", "harness", "example", "active.json"), "utf8")), { variant: profile });
	assert.equal(readFileSync(join(restored.home, "snapshots", "recorded", "hello.txt"), "utf8"), "portable\n");
	assert.equal(statSync(join(restored.home, "snapshots", "recorded", "run.sh")).mode & 0o777, 0o755);
	assert.equal(await git(["--git-dir", restored.repoDir("unit"), "rev-parse", "refs/tapes/recorded/step-1"]), commit);
	assert.equal(await git(["--git-dir", restored.repoDir("unit"), "rev-parse", "refs/tags/baseline"]), commit);
	assert.deepEqual(readdirSync(join(restored.home, "work")), []);
	assert.ok(!existsSync(join(restored.repoDir("unit"), "worktrees")));
	assert.ok(!existsSync(join(restored.repoDir("unit"), "hooks")));
	assert.equal(restored.getRun("child").tapeSource, join(restored.runDir("recorded"), "session.jsonl"));
	const lines = readFileSync(join(restored.runDir("recorded"), "session.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(lines[0].cwd, join(store.home, "work", "recorded"));
	assert.equal(lines[1].data.cwd, lines[0].cwd);
	assert.equal(lines[1].data.upstream.location, join(restored.runDir("recorded"), "session.jsonl"));
	assert.equal(JSON.parse(readFileSync(join(restored.home, "tapes", "edit.json"), "utf8")).sourceSession, join(restored.runDir("recorded"), "session.jsonl"));
});

test("unsafe archives fail transactionally for absent and empty destinations", async (context) => {
	const dir = workspace(context);
	const cases = [
		{ ...emptyArchive(), files: [entry("../outside", "bad")] },
		{ ...emptyArchive(), files: [entry("/absolute", "bad")] },
		{ ...emptyArchive(), files: [entry("reports/../bad.json", "{}")] },
		{ ...emptyArchive(), files: [entry("reports\\bad.json", "{}")] },
		{ ...emptyArchive(), files: [entry("reports/a.json", "{}"), entry("reports/A.json", "{}")] },
		{ ...emptyArchive(), files: [entry("reports/a.json", "{}"), entry("reports/a.json/b.json", "{}")] },
		{ ...emptyArchive(), files: [entry("auth.json", "secret")] },
		{ ...emptyArchive(), files: [entry("reports/auth.json", "secret")] },
		{ ...emptyArchive(), files: [{ ...entry("reports/a.json", "{}"), sha256: "0".repeat(64) }] },
		{ ...emptyArchive(), files: [{ ...entry("reports/a.json", "{}"), size: 3 }] },
		{ ...emptyArchive(), files: [{ ...entry("reports/a.json", "{}"), data: "!!!!" }] },
		{ ...emptyArchive(), files: [entry("reports/a.json", "{}", 0o120777)] },
		{ ...emptyArchive(), files: [entry("runs/orphan/session.jsonl", "{}")] },
		{ ...emptyArchive(), gitBundles: [{ task: "unit", ...entry("unused", "not a git bundle") }] },
	];
	for (const [index, archive] of cases.entries()) {
		for (const existing of [false, true]) {
			const destination = join(dir, `bad-${index}-${existing}`);
			if (existing) mkdirSync(destination);
			await assert.rejects(restoreArchive(archive, destination), /archive:/);
			assert.equal(existsSync(destination), existing);
			if (existing) assert.deepEqual(readdirSync(destination), []);
		}
	}
	assert.ok(!readdirSync(dir).some((name) => name.startsWith(".tapedeck-restore-")));
});

test("untouched artifacts retain exact bytes, including incomplete error traces", async (context) => {
	const dir = workspace(context);
	const archive = emptyArchive();
	archive.files = [
		entry("reports/raw.json", "not-complete-json{"),
		entry("reports/array.json", "[1, 2, 3]\n"),
		entry("runs/error/run.json", JSON.stringify({ ...record("error"), status: "error" })),
		entry("runs/error/session.jsonl", '{ "type": "session", "cwd": "/original" }\n{"incomplete":'),
	];
	const restored = await restoreArchive(archive, join(dir, "restored"));
	for (const file of archive.files) assert.deepEqual(readFileSync(join(restored.home, file.path)), Buffer.from(file.data, "base64"));
});

test("byte limits, missing references, running runs and destination protections are enforced", async (context) => {
	const dir = workspace(context);
	const store = Store.open(join(dir, "store"));
	store.writeRun({ ...record("running"), status: "running", sessionFile: null });
	await assert.rejects(captureArchive(store), /running/);
	const archive = { ...emptyArchive(), files: [entry("reports/a.json", "{}\n")] };
	await assert.rejects(restoreArchive(archive, join(dir, "limited"), { maxBytes: 2 }), /limit/);
	assert.throws(() => validateArchive(archive, { maxBytes: -1 }), /positive/);
	const target = join(dir, "existing");
	mkdirSync(target);
	writeFileSync(join(target, "precious"), "keep me");
	await assert.rejects(restoreArchive(emptyArchive(), target), /empty/);
	assert.equal(readFileSync(join(target, "precious"), "utf8"), "keep me");
	symlinkSync(target, join(dir, "linked"));
	await assert.rejects(restoreArchive(emptyArchive(), join(dir, "linked")), /empty/);
	const missing = { ...emptyArchive(), files: [entry("runs/test/run.json", JSON.stringify(record("test")))] };
	await assert.rejects(restoreArchive(missing, join(dir, "missing")), /missing sessionFile/);
});

test("restore accepts only the empty Store.open skeleton and preserves it on failure", async (context) => {
	const dir = workspace(context);
	const destination = Store.open(join(dir, "store")).home;
	const archive = { ...emptyArchive(), files: [entry("reports/saved.json", "{}\n")] };
	const invalid = { ...emptyArchive(), gitBundles: [{ task: "broken", ...entry("unused", "not a bundle") }] };
	await assert.rejects(restoreArchive(invalid, destination), /Git/);
	assert.deepEqual(readdirSync(destination).sort(), ["reports", "repos", "runs", "tapes", "work"]);
	const restored = await restoreArchive(archive, destination);
	assert.ok(existsSync(join(restored.home, "reports", "saved.json")));
	await assert.rejects(restoreArchive(emptyArchive(), destination), /empty/);
});

test("capture rejects artifact symlinks and real environment credentials", async (context) => {
	const dir = workspace(context);
	const store = Store.open(join(dir, "store"));
	writeFileSync(join(dir, "outside"), "{}");
	symlinkSync(join(dir, "outside"), join(store.home, "reports", "linked.json"));
	await assert.rejects(captureArchive(store), /symlink/);
	rmSync(join(store.home, "reports", "linked.json"));
	store.writeRun({ ...record("run"), sessionFile: null });
	mkdirSync(join(store.home, "catalog", "tasks", "unit"), { recursive: true });
	writeFileSync(join(store.home, "catalog", "tasks", "unit", ".env"), "API_TOKEN=real-secret");
	await assert.rejects(captureArchive(store), /credential/);
});

test("bundles reject remote refs, remote config, hooks, credential history and symlinks", async (context) => {
	const dir = workspace(context);
	const { store, commit } = await fixture(dir);
	const repo = store.repoDir("unit");
	await git(["--git-dir", repo, "update-ref", "refs/remotes/origin/main", commit]);
	await assert.rejects(captureArchive(store), /remote/);
	await git(["--git-dir", repo, "update-ref", "-d", "refs/remotes/origin/main"]);
	await git(["--git-dir", repo, "config", "remote.origin.url", "https://example.invalid/private"]);
	await assert.rejects(captureArchive(store), /configuration/);
	await git(["--git-dir", repo, "config", "--remove-section", "remote.origin"]);
	writeFileSync(join(repo, "hooks", "post-checkout"), "#!/bin/sh\nexit 99\n");
	await assert.rejects(captureArchive(store), /hooks/);
	rmSync(join(repo, "hooks", "post-checkout"));
	const source = join(dir, "source");
	symlinkSync("hello.txt", join(source, "linked"));
	await git(["-C", source, "add", "."]);
	await git(["-C", source, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "symlink"]);
	await git(["--git-dir", repo, "fetch", "--quiet", source, "refs/heads/main:refs/heads/main"]);
	await assert.rejects(captureArchive(store), /symlink/);
});

test("final files must exactly match their bundled checkpoint", async (context) => {
	const dir = workspace(context);
	const { store } = await fixture(dir);
	const archive = await captureArchive(store);
	archive.files = archive.files.map((file) => file.path === "snapshots/recorded/hello.txt" ? entry(file.path, "tampered", file.mode) : file);
	await assert.rejects(restoreArchive(archive, join(dir, "mismatch")), /disagree/);
	assert.ok(!existsSync(join(dir, "mismatch")));
});

test("capture detects another process changing the run catalog during bundle creation", async (context) => {
	const dir = workspace(context);
	const { store } = await fixture(dir);
	const original = childProcess.execFile;
	const mocked = context.mock.method(childProcess, "execFile", (command: string, args: string[], options: childProcess.ExecFileOptionsWithBufferEncoding, callback: (error: childProcess.ExecFileException | null, stdout: Buffer, stderr: Buffer) => void) => {
		if (args.includes("bundle") && args.includes("create")) store.writeRun({ ...record("new-run"), sessionFile: null });
		return original(command, args, options, callback);
	});
	syncBuiltinESMExports();
	try {
		await assert.rejects(captureArchive(store), /changed during capture; retry/);
	} finally {
		mocked.mock.restore();
		syncBuiltinESMExports();
	}
});

test("restore rejects remote refs even in a correctly hashed bundle", async (context) => {
	const dir = workspace(context);
	const { store, commit } = await fixture(dir);
	const archive = await captureArchive(store);
	await git(["--git-dir", store.repoDir("unit"), "update-ref", "refs/remotes/origin/main", commit]);
	const bundle = join(dir, "remote.bundle");
	await git(["--git-dir", store.repoDir("unit"), "bundle", "create", bundle, "--all"]);
	archive.gitBundles = [{ task: "unit", ...entry("unused", readFileSync(bundle)) }];
	await assert.rejects(restoreArchive(archive, join(dir, "bad-remote")), /remote Git ref/);
	assert.ok(!existsSync(join(dir, "bad-remote")));
});

test("capture rejects real credentials in Git history even after their deletion", async (context) => {
	const dir = workspace(context);
	const { store } = await fixture(dir);
	const source = join(dir, "source");
	writeFileSync(join(source, ".env"), "PRIVATE_API_KEY=real-secret");
	for (const message of ["add secret", "remove secret"]) {
		if (message === "remove secret") rmSync(join(source, ".env"));
		await git(["-C", source, "add", "-A"]);
		await git(["-C", source, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", message]);
	}
	await git(["--git-dir", store.repoDir("unit"), "fetch", "--quiet", source, "refs/heads/main:refs/heads/main"]);
	await assert.rejects(captureArchive(store), /credential/);
});

test("capture explicitly rejects Git submodules", async (context) => {
	const dir = workspace(context);
	const { store, commit } = await fixture(dir);
	const source = join(dir, "source");
	await git(["-C", source, "update-index", "--add", "--cacheinfo", `160000,${commit},submodule`]);
	await git(["-C", source, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "submodule"]);
	await git(["--git-dir", store.repoDir("unit"), "fetch", "--quiet", source, "refs/heads/main:refs/heads/main"]);
	await assert.rejects(captureArchive(store), /submodule/);
});

test("archives larger than the BSON limit validate without regex stack overflow", () => {
	const archive = emptyArchive();
	archive.files.push(entry("reports/large.txt", Buffer.alloc(17 * 1024 * 1024, 65)));
	assert.equal(validateArchive(archive).files[0].size, 17 * 1024 * 1024);
});

test("restored scripted recording can replay and fork without the original store", { timeout: 120_000 }, async (context) => {
	const dir = workspace(context);
	const store = Store.open(join(dir, "store"));
	const runner = new Runner({ store, tape: true, timeoutMs: 45_000 });
	const run = await runner.run({ task: "t03", variant: "vanilla" });
	assert.equal(run.status, "done", run.error ?? "");
	const archive = await captureArchive(store);
	assert.ok(archive.files.some((file) => file.path === "catalog/tasks/t03/task.json"));
	assert.ok(archive.files.some((file) => file.path === "catalog/tasks/t03/verify.sh"));
	assert.ok(archive.files.some((file) => file.path === `snapshots/${run.id}/src/clamp.js`));
	const restored = await restoreArchive(archive, join(dir, "restored"));
	rmSync(store.home, { recursive: true, force: true });
	const next = new Runner({ store: restored, tape: true, timeoutMs: 45_000 });
	const replay = await next.replay({ from: run.id, variant: "vanilla" });
	assert.equal(replay.status, "done", replay.error ?? "");
	assert.equal(replay.usage.totalTokens, 0);
	const fork = await next.fork({ from: run.id, variant: "vanilla", forkAt: 1 });
	assert.equal(fork.status, "done", fork.error ?? "");
	assert.equal(fork.pass, true);
	assert.ok(fork.steps.live > 0);
});
