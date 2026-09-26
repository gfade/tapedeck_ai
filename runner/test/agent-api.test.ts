import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "../src/server.ts";
import { cleanEnv } from "../src/util.ts";
import { tempRunner } from "./helpers.ts";

test("the image API captures, authenticates, restores files and Git, and compares the restored history", async () => {
	const original = tempRunner();
	const restored = tempRunner();
	const servers = [createApiServer(original.runner), createApiServer(restored.runner)];
	const previous = process.env.TAPEDECK_API_TOKEN;
	process.env.TAPEDECK_API_TOKEN = "agent-api-test-token";
	try {
		const addresses: string[] = [];
		for (const server of servers) {
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			addresses.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
		}
		const call = async (base: string, path: string, body?: unknown) => {
			const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer agent-api-test-token", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
			return { status: response.status, data: await response.json() as Record<string, any> };
		};
		assert.equal((await fetch(addresses[0] + "/api/agent/archive")).status, 401);
		const baseline = await original.runner.run({ task: "t01", variant: "vanilla" });
		const captured = await call(addresses[0], "/api/agent/archive");
		assert.equal(captured.status, 200);
		assert.equal(captured.data.format, "tapedeck.archive/v1");
		assert.ok(!JSON.stringify(captured.data).includes("agent-api-test-token"));
		const imported = await call(addresses[1], "/api/agent/restore", { archive: captured.data });
		assert.equal(imported.status, 200, JSON.stringify(imported.data));
		assert.equal(imported.data.runs, 1);
		assert.ok(existsSync(join(restored.store.home, "snapshots", baseline.id, "src/sum.js")));
		const git = await call(addresses[1], "/api/git/t01");
		assert.equal(git.status, 200);
		assert.equal(git.data.repository.status, "available");
		const comparison = await call(addresses[1], "/api/comparisons", { from: baseline.id, variant: "rule-taskrunner", model: "scripted/toy" });
		assert.equal(comparison.status, 200);
		assert.equal(comparison.data.status, "done", JSON.stringify(comparison.data.errors));
		const report = await call(addresses[1], `/api/comparisons/${comparison.data.id}`);
		assert.equal(report.status, 200);
		assert.equal(report.data.baselineRun, baseline.id);
		assert.equal(report.data.runs.replay.usage.totalTokens, 0);
		const gitExport = await call(addresses[1], "/api/git/exports", { runId: baseline.id, branch: "test" });
		assert.equal(gitExport.status, 409);
	} finally {
		if (previous === undefined) delete process.env.TAPEDECK_API_TOKEN;
		else process.env.TAPEDECK_API_TOKEN = previous;
		for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
		original.cleanup();
		restored.cleanup();
	}
});

test("Atlas infrastructure credentials are not inherited by agent tools or Git", () => {
	const previous = process.env.MONGODB_URI;
	process.env.MONGODB_URI = "mongodb://test-secret@localhost";
	try { assert.equal(cleanEnv().MONGODB_URI, undefined); }
	finally {
		if (previous === undefined) delete process.env.MONGODB_URI;
		else process.env.MONGODB_URI = previous;
	}
});
