/**
 * Record mode against the real pi CLI: transparency (the model sees exactly what it would see
 * without pi-tape), the session entries, git snapshots, and the inert and off modes.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { requestHash } from "../src/canonical.ts";
import { expandRequestDelta } from "../src/delta.ts";
import { normalizeMessages } from "../src/normalize.ts";
import type { NormalizedMessage } from "../src/types.ts";
import { git, headerOf, makeRepo, messagesOf, type PiRun, runPi, Scratch, scriptModel, stepsOf, testExtension } from "./helpers.ts";

const scratch = new Scratch();
after(() => scratch.cleanup());

const FILES = { "README.md": "# demo\n", "src/app.js": "console.log('app');\n" };
const CAPTURE = testExtension("capture.ts");

interface Captured {
	cwd: string;
	piDir: string;
	messages: { role: string; sections?: Record<string, string>; toolsAdded?: unknown[] }[];
}

function readCapture(file: string): Captured[] {
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

const normalized = (captured: Captured[]): NormalizedMessage[][] =>
	captured.map((request) => normalizeMessages(request.messages, { cwd: request.cwd, piDir: request.piDir }));

describe("transparency", { concurrency: true }, () => {
	for (const variant of [
		{ name: "default tools", args: [] as string[], script: scriptModel("basic.mjs"), tools: ["bash", "write", "read", "bash"] },
		{ name: "--tools read,grep,ls", args: ["--tools", "read,grep,ls"], script: scriptModel("search.mjs"), tools: ["ls", "grep", "read"] },
	]) {
		test(`the model sees identical declarations and requests with and without pi-tape (${variant.name})`, async () => {
			const plainDir = scratch.next("plain");
			const tapedDir = scratch.next("taped");
			makeRepo(plainDir, FILES);
			makeRepo(tapedDir, FILES);
			const plainFile = `${scratch.next("capture")}.jsonl`;
			const tapedFile = `${scratch.next("capture")}.jsonl`;
			const common = { scratch, script: variant.script, extensions: [CAPTURE], args: variant.args };
			const [plain, taped] = await Promise.all([
				runPi({ ...common, cwd: plainDir, tape: false, model: "capture/toy", env: { TEST_CAPTURE_FILE: plainFile } }),
				runPi({ ...common, cwd: tapedDir, env: { TEST_CAPTURE_FILE: tapedFile, PI_TAPE_UPSTREAM: "capture/toy" } }),
			]);
			// The wrapped built-in tools really ran.
			const executed = stepsOf(taped).flatMap((step) => step.tools.map((tool) => [tool.name, tool.exec, tool.isError]));
			assert.deepEqual(executed, variant.tools.map((name) => [name, "real", false]));
			assert.equal(plain.code, 0, plain.stderr);
			assert.equal(taped.code, 0, taped.stderr);
			const plainRequests = readCapture(plainFile);
			const tapedRequests = readCapture(tapedFile);

			// Byte-identical tool declarations and prompt sections, except the cwd section.
			const system = (requests: Captured[]) => requests[0].messages[0];
			assert.equal(system(plainRequests).role, "system");
			assert.equal(JSON.stringify(system(tapedRequests).toolsAdded), JSON.stringify(system(plainRequests).toolsAdded));
			const sectionsBesidesCwd = (requests: Captured[]) => JSON.stringify(Object.entries(system(requests).sections ?? {}).filter(([name]) => name !== "cwd"));
			assert.equal(sectionsBesidesCwd(tapedRequests), sectionsBesidesCwd(plainRequests));
			assert.notEqual(system(tapedRequests).sections?.cwd, system(plainRequests).sections?.cwd);

			// Every request of the run is identical once paths are normalized.
			assert.equal(tapedRequests.length, plainRequests.length);
			assert.deepEqual(normalized(tapedRequests), normalized(plainRequests));
			assert.deepEqual(taped.report?.errors, []);
		});
	}
});

describe("record", () => {
	test("writes a header, one tape.step per response with exact request deltas, and real snapshots", async () => {
		const dir = scratch.next("record");
		const base = makeRepo(dir, FILES);
		const captureFile = `${scratch.next("capture")}.jsonl`;
		const gitState = () => ({
			head: git(dir, "rev-parse", "HEAD"),
			symbolicHead: git(dir, "symbolic-ref", "HEAD"),
			index: git(dir, "ls-files", "--stage"),
			branches: git(dir, "for-each-ref", "refs/heads"),
		});
		const before = gitState();
		const run = await runPi({
			cwd: dir,
			scratch,
			extensions: [CAPTURE],
			env: { TEST_CAPTURE_FILE: captureFile, PI_TAPE_UPSTREAM: "capture/toy", PI_TAPE_LABEL: "vanilla" },
		});
		assert.equal(run.code, 0, run.stderr);

		// Header: exactly one, before any message.
		const headers = headerOf(run);
		assert.equal(headers.length, 1);
		const header = headers[0];
		const headerIndex = run.branch.findIndex((e) => e.customType === "tape.header");
		assert.ok(headerIndex < run.branch.findIndex((e) => e.type === "message"));
		const sessionId = String(run.entries[0].id);
		assert.deepEqual(
			{ ...header, snapshotBase: null },
			{
				v: 1,
				mode: "record",
				label: "vanilla",
				cwd: dir,
				piVersion: "0.87.1",
				upstream: { provider: "capture", model: "toy" },
				snapshotBase: null,
				refPrefix: `refs/tapes/${sessionId}`,
				source: null,
				forkAt: null,
				lenient: [],
			},
		);

		// One step per response; each request delta expands to exactly what the provider saw.
		const steps = stepsOf(run);
		const captured = normalized(readCapture(captureFile));
		const assistants = run.branch.filter((e) => e.type === "message" && (e.message as { role: string }).role === "assistant");
		assert.equal(steps.length, 4);
		assert.equal(captured.length, 4);
		let previous: NormalizedMessage[] = [];
		steps.forEach((step, i) => {
			assert.equal(step.step, i + 1);
			assert.equal(step.live, true);
			assert.equal(step.responseEntryId, assistants[i].id);
			const full = expandRequestDelta(previous, step.request);
			assert.deepEqual(full, captured[i]);
			assert.equal(step.requestHash, requestHash(full));
			assert.deepEqual(step.usage, (assistants[i].message as { usage: unknown }).usage);
			previous = full;
		});
		assert.equal(steps[0].request.keep, 0);
		assert.ok(steps[1].request.keep > 0, "later steps are deltas");

		// Each tape.step follows its turn's tool results; tools are recorded as executed.
		const byId = new Map(run.entries.map((e) => [e.id, e]));
		for (const step of steps) {
			const stepIndex = run.branch.findIndex((e) => e.customType === "tape.step" && (e.data as { step: number }).step === step.step);
			for (const tool of step.tools) {
				assert.equal(tool.exec, "real");
				const result = byId.get(tool.resultEntryId ?? "")?.message as { toolCallId: string; isError: boolean };
				assert.equal(result.toolCallId, tool.id);
				assert.equal(result.isError, tool.isError);
				assert.ok(run.branch.findIndex((e) => e.id === tool.resultEntryId) < stepIndex);
			}
		}
		assert.deepEqual(
			steps.map((s) => s.tools.map((t) => [t.id, t.name, t.args])),
			[
				[["toy_1_0", "bash", { command: "ls && pwd" }]],
				[
					["toy_2_0", "write", { path: "notes.txt", content: "note\n" }],
					["toy_2_1", "read", { path: "README.md" }],
				],
				[["toy_3_0", "bash", { command: "cat notes.txt" }]],
				[],
			],
		);

		// Snapshots are commits under refs/tapes/<sessionId>/, chained from HEAD.
		const refs = git(dir, "for-each-ref", "--format=%(refname:strip=3) %(objectname)", header.refPrefix).split("\n");
		assert.deepEqual(refs.map((line) => line.split(" ")[0]).sort(), ["base", "s1", "s1-t1", "s2", "s2-t1", "s2-t2", "s3", "s3-t1"]);
		const refSha = (name: string) => refs.find((line) => line.startsWith(`${name} `))?.split(" ")[1];
		assert.equal(header.snapshotBase, refSha("base"));
		assert.equal(git(dir, "rev-parse", `${header.snapshotBase}^`), base);
		assert.equal(git(dir, "rev-parse", `${header.snapshotBase}^{tree}`), git(dir, "rev-parse", `${base}^{tree}`));
		assert.equal(steps[1].tools[0].snapshot, refSha("s2-t1"));
		assert.equal(steps[1].snapshotAfter, refSha("s2"));
		assert.equal(steps[3].snapshotAfter, steps[2].snapshotAfter, "a step without tools keeps the last snapshot");
		assert.equal(git(dir, "cat-file", "-t", String(steps[1].snapshotAfter)), "commit");
		assert.equal(git(dir, "show", `${steps[1].snapshotAfter}:notes.txt`), "note");
		assert.throws(() => git(dir, "show", `${steps[0].snapshotAfter}:notes.txt`));

		// The repository itself is untouched: HEAD, index and branches as before.
		assert.deepEqual(gitState(), before);
		assert.equal(git(dir, "status", "--porcelain"), "?? notes.txt");

		// Report: file and entry agree.
		const report = run.report;
		assert.ok(report);
		const reportEntries = run.branch.filter((e) => e.customType === "tape.report");
		assert.deepEqual(reportEntries.at(-1)?.data, report);
		assert.equal(report.mode, "record");
		assert.deepEqual(report.steps, { replayed: 0, live: 4, total: 4 });
		assert.equal(report.divergence, null);
		assert.equal(report.usage.live.totalTokens, steps.reduce((sum, s) => sum + s.usage.totalTokens, 0));
		assert.ok(report.usage.live.cost > 0);
		assert.equal(report.usage.replayed.totalTokens, 0);
		assert.deepEqual(report.snapshots, { base: header.snapshotBase, final: steps[3].snapshotAfter });
		assert.equal(report.sessionFile, run.sessionFile);
		assert.deepEqual(report.errors, []);
	});

	test("a directory that is not a git repository records with null snapshots", async () => {
		const dir = scratch.next("nogit");
		mkdirSync(dir);
		writeFileSync(`${dir}/README.md`, "# demo\n");
		const run = await runPi({ cwd: dir, scratch, env: { PI_TAPE_UPSTREAM: "scripted/toy", GIT_CEILING_DIRECTORIES: scratch.dir } });
		assert.equal(run.code, 0, run.stderr);
		assert.equal(headerOf(run)[0].snapshotBase, null);
		assert.ok(stepsOf(run).every((s) => s.snapshotAfter === null && s.tools.every((t) => t.snapshot === null)));
		assert.deepEqual(run.report?.errors, []);
	});
});

describe("inactive", { concurrency: true }, () => {
	const noTape = (run: PiRun) => run.branch.every((e) => !String(e.customType ?? "").startsWith("tape."));

	test("PI_TAPE_MODE=off passes requests through and writes nothing", async () => {
		const dir = scratch.next("off");
		makeRepo(dir, FILES);
		const run = await runPi({ cwd: dir, scratch, env: { PI_TAPE_MODE: "off", PI_TAPE_UPSTREAM: "scripted/toy" } });
		assert.equal(run.code, 0, run.stderr);
		assert.ok(noTape(run));
		assert.equal(messagesOf(run, "assistant").length, 4);
		assert.equal(run.report, null);
		assert.equal(git(dir, "for-each-ref", "refs/tapes"), "");
	});

	test("with another model selected pi-tape stays inert and says so once", async () => {
		const dir = scratch.next("inert");
		makeRepo(dir, FILES);
		const run = await runPi({ cwd: dir, scratch, model: "scripted/toy" });
		assert.equal(run.code, 0, run.stderr);
		assert.ok(noTape(run));
		assert.equal(messagesOf(run, "assistant").length, 4);
		assert.equal(run.stderr.match(/pi-tape is inactive/g)?.length, 1);
		assert.equal(git(dir, "for-each-ref", "refs/tapes"), "");
	});
});
