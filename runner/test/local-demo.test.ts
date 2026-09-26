import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { localDemo } from "../src/local-demo.ts";
import { tempDir } from "./helpers.ts";

test("local demo preserves failed task outcomes while proving provider-free replay and archive recovery", async () => {
	const temporary = tempDir("local-demo");
	const priorHost = process.env.OLLAMA_HOST;
	let requests = 0;
	const payloads: Record<string, unknown>[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		if (request.url === "/api/version") response.end(JSON.stringify({ version: "test-fixture" }));
		else if (request.url === "/api/tags") response.end(JSON.stringify({ models: [{ name: "qwen3.5:2b", digest: "fixture", size: 0 }] }));
		else if (request.url === "/api/create") response.end(JSON.stringify({ status: "success" }));
		else if (request.url === "/v1/chat/completions") {
			payloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			requests++;
			const base = { id: `request-${requests}`, object: "chat.completion.chunk", created: 1, model: "tapedeck-qwen35-2b" };
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Fixture response with no code changes." }, finish_reason: null }] })}\n\n`);
			response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\n`);
			response.end("data: [DONE]\n\n");
		} else response.writeHead(404).end();
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	process.env.OLLAMA_HOST = `http://127.0.0.1:${address.port}`;
	try {
		const destination = join(temporary.dir, "demo");
		await localDemo(["--model", "qwen3.5:2b", "--destination", destination]);
		const result = JSON.parse(readFileSync(join(destination, "results.json"), "utf8"));
		assert.equal(result.status, "done");
		assert.equal(requests, 3);
		assert.ok(payloads.every(payload => payload.reasoning_effort === "none" && payload.temperature === 0 && payload.seed === 42));
		assert.equal(result.results[0].baseline.pass, false);
		assert.equal(result.results[0].replay.providerRequests, 0);
		assert.equal(result.results[0].replay.usage.totalTokens, 0);
		assert.equal(result.results[0].replayVerified, true);
		assert.equal(result.results[0].fork.providerRequests, 1);
		assert.equal(result.results[0].rerun.providerRequests, 1);
		assert.equal(result.archive.restoredRuns, 4);
		const archive = JSON.parse(readFileSync(join(destination, "Runner.archive.json"), "utf8"));
		assert.ok(archive.files.some((entry: { path: string }) => entry.path === "reports/local-demo.json"));
		assert.ok(archive.files.some((entry: { path: string }) => entry.path === "reports/provider-requests.jsonl"));
		assert.ok(!archive.files.some((entry: { path: string }) => entry.path.endsWith("models.json")));
	} finally {
		if (priorHost === undefined) delete process.env.OLLAMA_HOST;
		else process.env.OLLAMA_HOST = priorHost;
		await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
		temporary.cleanup();
	}
});
