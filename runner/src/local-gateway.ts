import { createServer, request as httpRequest, type Server } from "node:http";

export interface LocalRequest {
	phase: string;
	model: string;
	startedAt: string;
	status: number | null;
	durationMs: number | null;
}

export function localOllamaUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new Error("The local demo requires a loopback-only Ollama HTTP address without credentials or a path");
	}
	return url;
}

export async function startLocalGateway(options: {
	upstream: string;
	models: string[];
	onRequest?: (record: LocalRequest) => void;
}): Promise<{ url: string; requests: LocalRequest[]; setPhase: (phase: string) => void; close: () => Promise<void> }> {
	const upstream = localOllamaUrl(options.upstream);
	const models = new Set(options.models);
	const requests: LocalRequest[] = [];
	let phase = "unassigned";
	const server: Server = createServer(async (incoming, outgoing) => {
		if (incoming.method !== "POST" || incoming.url !== "/v1/chat/completions" || !incoming.headers["content-type"]?.startsWith("application/json")) {
			outgoing.writeHead(404).end();
			return;
		}
		try {
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of incoming) {
				size += chunk.length;
				if (size > 16 * 1024 * 1024) {
					outgoing.writeHead(413).end();
					return;
				}
				chunks.push(chunk);
			}
			const body = Buffer.concat(chunks);
			const payload = JSON.parse(body.toString("utf8")) as { model?: string };
			if (!payload.model || !models.has(payload.model)) {
				outgoing.writeHead(400).end("Model is outside this local demo");
				return;
			}
			const started = Date.now();
			const record: LocalRequest = { phase, model: payload.model, startedAt: new Date(started).toISOString(), status: null, durationMs: null };
			requests.push(record);
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				record.durationMs = Date.now() - started;
				options.onRequest?.({ ...record });
			};
			const forwarded = httpRequest(new URL("/v1/chat/completions", upstream), {
				method: "POST", headers: { "content-type": "application/json", "content-length": body.length },
			}, (response) => {
				record.status = response.statusCode ?? 502;
				outgoing.writeHead(record.status, { "content-type": response.headers["content-type"] ?? "text/event-stream" });
				response.on("error", () => outgoing.destroy());
				response.pipe(outgoing);
			});
			forwarded.setTimeout(120_000, () => forwarded.destroy(new Error("Local inference idle timeout")));
			forwarded.on("error", () => {
				if (!outgoing.headersSent) outgoing.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "Local Ollama request failed" }));
				else outgoing.destroy();
			});
			outgoing.on("close", () => { forwarded.destroy(); finish(); });
			forwarded.end(body);
		} catch {
			if (!outgoing.headersSent) outgoing.writeHead(400).end("Invalid local-model request");
			else outgoing.destroy();
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No local gateway address");
	let closing: Promise<void> | undefined;
	return {
		url: `http://127.0.0.1:${address.port}/v1`, requests,
		setPhase: (value) => { phase = value; },
		close: () => closing ??= new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }),
	};
}
