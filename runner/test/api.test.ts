/** HTTP API smoke test (INTERFACES.md §5.5) on a random port. */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Runner } from "../src/runs.ts";
import { createApiServer } from "../src/server.ts";
import type { RunRecord } from "../src/types.ts";
import { runProblems, tempRunner } from "./helpers.ts";

let runner: Runner;
let cleanup: () => void;
let base: string;
let close: () => Promise<void>;

before(async () => {
	({ runner, cleanup } = tempRunner());
	const server = createApiServer(runner);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	close = () => new Promise((resolve) => server.close(() => resolve()));
});

after(async () => {
	await close();
	cleanup();
});

async function call(method: string, path: string, body?: unknown, contentType = "application/json") {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: body === undefined ? {} : { "content-type": contentType },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	const type = response.headers.get("content-type") ?? "";
	return { status: response.status, type, text, json: type.startsWith("application/json") ? JSON.parse(text) : undefined };
}

test("GET /api/health, /api/tasks, /api/variants", async () => {
	const health = await call("GET", "/api/health");
	assert.equal(health.status, 200);
	assert.equal(health.json.ok, true);
	assert.equal(health.json.version, "0.1.0");
	assert.equal(health.json.pi, "0.87.1");
	assert.equal(health.json.store, runner.store.home);

	const tasks = (await call("GET", "/api/tasks")).json;
	assert.equal(tasks.length, 6);
	for (const task of tasks) for (const key of ["id", "title", "split", "quirk", "prompt"]) assert.ok(key in task, `${task.id}.${key}`);

	const variants = (await call("GET", "/api/variants")).json;
	assert.deepEqual(variants.map((v: { name: string }) => v.name).sort(), ["guard-secrets", "rule-generated", "rule-taskrunner", "vanilla"]);
});

test("POST /api/runs runs synchronously, or asynchronously with async: true", async () => {
	const sync = await call("POST", "/api/runs", { task: "t03", variant: "vanilla" });
	assert.equal(sync.status, 200);
	assert.deepEqual(runProblems(sync.json), []);
	assert.equal(sync.json.pass, true);

	const started = await call("POST", "/api/runs", { task: "t06", variant: "rule-taskrunner", async: true });
	assert.equal(started.status, 202);
	assert.deepEqual(Object.keys(started.json).sort(), ["id", "status"]);
	assert.equal(started.json.status, "running");
	let run: RunRecord = (await call("GET", `/api/runs/${started.json.id}`)).json;
	for (let i = 0; i < 300 && run.status === "running"; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		run = (await call("GET", `/api/runs/${started.json.id}`)).json;
	}
	assert.equal(run.status, "done");
	assert.equal(run.pass, true);
	assert.ok("report" in run, "GET /api/runs/:id adds the tape report");

	const listed = (await call("GET", "/api/runs")).json as RunRecord[];
	assert.deepEqual(listed.map((r) => r.id), [started.json.id, sync.json.id], "newest first");
	assert.deepEqual((await call("GET", "/api/runs?task=t03")).json.map((r: RunRecord) => r.id), [sync.json.id]);
	assert.deepEqual((await call("GET", "/api/runs?kind=fork")).json, []);

	const session = await call("GET", `/api/runs/${sync.json.id}/session`);
	assert.equal(session.status, 200);
	assert.match(session.type, /^application\/x-ndjson/);
	assert.equal(JSON.parse(session.text.split("\n")[0]).type, "session");

	const tape = await call("GET", `/api/runs/${sync.json.id}/tape`);
	if (runner.tape) {
		assert.equal(tape.json.format, "tapedeck.tape/v1");
		assert.equal(tape.json.steps.length, sync.json.steps.total);
	} else {
		assert.equal(tape.status, 409, "runs without pi-tape have no tape");
	}
});

test("errors are JSON with a 4xx status", async () => {
	const unknownRun = await call("GET", "/api/runs/nope");
	assert.equal(unknownRun.status, 404);
	assert.match(unknownRun.json.error, /unknown run/);
	const badTask = await call("POST", "/api/runs", { task: "t99", variant: "vanilla" });
	assert.equal(badTask.status, 400);
	assert.match(badTask.json.error, /unknown task/);
	assert.equal((await call("POST", "/api/runs", { variant: "vanilla" })).status, 400);
	assert.equal((await call("POST", "/api/runs", { task: "t01", variant: "vanilla" }, "text/plain")).status, 415);
	assert.equal((await call("GET", "/api/nothing")).status, 404);
	assert.equal((await call("GET", "/api/reports/nope")).status, 404);
});

test("GET /api/reports lists gate reports; GET / serves the dashboard", async () => {
	assert.deepEqual((await call("GET", "/api/reports")).json, []);
	const page = await call("GET", "/");
	assert.equal(page.status, 200);
	assert.match(page.type, /^text\/html/);
	assert.match(page.text, /<title>/);
});
