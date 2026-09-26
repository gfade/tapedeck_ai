import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tempRunner } from "./helpers.ts";

test("record and fork make real HTTP calls to a configured API while replay stays offline", async () => {
	const requests: { authorization: string | undefined; body: Record<string, unknown> }[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		requests.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
		response.writeHead(200, { "content-type": "text/event-stream" });
		const common = { id: "test-completion", object: "chat.completion.chunk", created: 1, model: "fixture" };
		response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: `Live API response ${requests.length}` }, finish_reason: null }] })}\n\n`);
		response.write(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } })}\n\n`);
		response.end("data: [DONE]\n\n");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { runner, store, cleanup } = tempRunner();
	const priorModels = process.env.TAPEDECK_MODELS_FILE;
	const priorKey = process.env.LIVE_API_KEY;
	try {
		const config = join(store.home, "custom-models.json");
		writeFileSync(config, JSON.stringify({ providers: { fixture: {
			baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
			api: "openai-completions", apiKey: "${LIVE_API_KEY}",
			models: [{ id: "fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 256 }],
		} } }));
		process.env.TAPEDECK_MODELS_FILE = config;
		process.env.LIVE_API_KEY = "local-test-key";
		const recorded = await runner.run({ task: "t03", variant: "vanilla", model: "fixture/fixture" });
		assert.equal(recorded.status, "done", recorded.error ?? "recording failed");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].authorization, "Bearer local-test-key");
		assert.equal(requests[0].body.model, "fixture");
		const replay = await runner.replay({ from: recorded.id, variant: "vanilla" });
		assert.equal(replay.status, "done", replay.error ?? "replay failed");
		assert.equal(replay.usage.totalTokens, 0);
		assert.equal(requests.length, 1);
		process.env.LIVE_API_KEY = "rotated-test-key";
		const fork = await runner.fork({ from: recorded.id, variant: "vanilla", model: "fixture/fixture", forkAt: 1 });
		assert.equal(fork.status, "done", fork.error ?? "fork failed");
		assert.equal(requests.length, 2);
		assert.equal(requests[1].authorization, "Bearer rotated-test-key");
		const session = readFileSync(join(store.home, fork.sessionFile as string), "utf8");
		assert.match(session, /Live API response 2/);
		assert.ok(!session.includes("local-test-key") && !session.includes("rotated-test-key"));
	} finally {
		if (priorModels === undefined) delete process.env.TAPEDECK_MODELS_FILE;
		else process.env.TAPEDECK_MODELS_FILE = priorModels;
		if (priorKey === undefined) delete process.env.LIVE_API_KEY;
		else process.env.LIVE_API_KEY = priorKey;
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		cleanup();
	}
});
