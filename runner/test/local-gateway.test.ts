import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { localOllamaUrl, startLocalGateway, type LocalRequest } from "../src/local-gateway.ts";

test("local demos refuse non-loopback endpoints and embedded credentials", () => {
	for (const value of ["https://example.com", "http://127.0.0.1.evil.test", "http://user:secret@localhost:11434", "http://127.0.0.1:11434/v1", "http://localhost:11434?token=secret"]) {
		assert.throws(() => localOllamaUrl(value), /loopback-only/);
	}
	assert.equal(localOllamaUrl("http://127.0.0.1:11434").port, "11434");
	assert.equal(localOllamaUrl("http://[::1]:11434").hostname, "[::1]");
});

test("gateway streams real responses and counts allowed model requests without forwarding credentials", async () => {
	const received: { authorization?: string; body: string }[] = [];
	const completed: LocalRequest[] = [];
	const upstream = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		received.push({ authorization: request.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end('data: {"message":"actual fixture response"}\n\ndata: [DONE]\n\n');
	});
	await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
	const address = upstream.address();
	assert.ok(address && typeof address !== "string");
	const gateway = await startLocalGateway({ upstream: `http://127.0.0.1:${address.port}`, models: ["small-model"], onRequest: value => completed.push(value) });
	try {
		gateway.setPhase("record");
		const payload = { model: "small-model", messages: [{ role: "user", content: "hello" }], stream: true };
		const response = await fetch(`${gateway.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer private-token" }, body: JSON.stringify(payload) });
		assert.equal(response.status, 200);
		assert.match(await response.text(), /actual fixture response/);
		assert.equal(received.length, 1);
		assert.equal(received[0].authorization, undefined);
		assert.deepEqual(JSON.parse(received[0].body), payload);
		assert.equal(gateway.requests[0].phase, "record");
		assert.equal(completed.length, 1);
		assert.equal(completed[0].status, 200);
		assert.equal(JSON.stringify(completed).includes("private-token"), false);
		gateway.setPhase("replay");
		const rejected = await fetch(`${gateway.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "unknown-model" }) });
		assert.equal(rejected.status, 400);
		assert.equal((await fetch(`${gateway.url}/models`)).status, 404);
		assert.equal((await fetch(`${gateway.url}/chat/completions`, { method: "POST", body: "{}" })).status, 404);
		assert.equal(gateway.requests.length, 1);
		assert.equal(received.length, 1);
	} finally {
		await gateway.close();
		await gateway.close();
		await new Promise<void>(resolve => { upstream.close(() => resolve()); upstream.closeAllConnections(); });
	}
});
