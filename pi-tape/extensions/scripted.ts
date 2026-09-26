/**
 * scripted — an offline, deterministic "model" for pi.
 *
 * Registers provider `scripted` with model `toy`. Each model request is answered by a
 * plain JavaScript module named by the PI_SCRIPTED_MODEL environment variable. The
 * module's default export receives a flattened view of the request and returns text,
 * optional thinking, and tool calls. No network, no API key.
 *
 * It exists so the whole record → replay → fork pipeline can be tested and demoed
 * without spending tokens. Token counts are estimated from character counts (4 chars
 * per token) and priced with the model's cost table, so accounting code paths run too.
 *
 *   PI_SCRIPTED_MODEL=/abs/path/toy.mjs pi -e ./extensions/scripted.ts --model scripted/toy
 *
 * See INTERFACES.md ("Scripted model") for the module contract.
 */

import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	calculateCost,
	createAssistantMessageEventStream,
	getCurrentSystemPrompt,
	getCurrentTools,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type ScriptedMessage =
	| { role: "user"; text: string }
	| { role: "assistant"; text: string; toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] }
	| { role: "toolResult"; toolCallId: string; toolName: string; text: string; isError: boolean };

export interface ScriptedRequest {
	/** 1-based: number of assistant messages already in the request, plus one. */
	step: number;
	/** The current system prompt, rendered from the transcript's system messages. */
	systemPrompt: string;
	/** Names of the tools the model can call right now. */
	tools: string[];
	/** Non-system messages, oldest first, with content flattened to text. */
	messages: ScriptedMessage[];
	cwd: string;
	env: Record<string, string | undefined>;
}

export interface ScriptedResponse {
	text?: string;
	thinking?: string;
	toolCalls?: { name: string; arguments: Record<string, unknown>; id?: string }[];
}

type ScriptFn = (req: ScriptedRequest) => ScriptedResponse | Promise<ScriptedResponse>;

const scriptCache = new Map<string, Promise<ScriptFn>>();

function loadScript(path: string): Promise<ScriptFn> {
	const abs = resolve(path);
	let p = scriptCache.get(abs);
	if (!p) {
		p = import(pathToFileURL(abs).href).then((mod) => {
			const fn = mod.default ?? mod.respond;
			if (typeof fn !== "function") throw new Error(`PI_SCRIPTED_MODEL ${abs} has no default export function`);
			return fn as ScriptFn;
		});
		scriptCache.set(abs, p);
	}
	return p;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b: any) => (b?.type === "text" ? b.text : b?.type === "image" ? `[image ${b.mimeType ?? ""}]` : ""))
		.filter((s: string) => s.length > 0)
		.join("\n");
}

export function toScriptedRequest(context: TranscriptContext, cwd: string, env: Record<string, string | undefined>): ScriptedRequest {
	const messages: ScriptedMessage[] = [];
	for (const m of context.messages as any[]) {
		if (m.role === "user") messages.push({ role: "user", text: textOf(m.content) });
		else if (m.role === "assistant") {
			const blocks = Array.isArray(m.content) ? m.content : [];
			messages.push({
				role: "assistant",
				text: blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n"),
				toolCalls: blocks
					.filter((b: any) => b.type === "toolCall")
					.map((b: any) => ({ id: b.id, name: b.name, arguments: b.arguments ?? {} })),
			});
		} else if (m.role === "toolResult") {
			messages.push({
				role: "toolResult",
				toolCallId: m.toolCallId,
				toolName: m.toolName,
				text: textOf(m.content),
				isError: Boolean(m.isError),
			});
		}
	}
	const step = messages.filter((m) => m.role === "assistant").length + 1;
	return {
		step,
		systemPrompt: getCurrentSystemPrompt(context.messages),
		tools: getCurrentTools(context.messages).map((t) => t.name),
		messages,
		cwd,
		env,
	};
}

function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function streamScripted(model: Model<any>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: Date.now(),
	};

	const run = async () => {
		const cwd = process.cwd();
		const scriptPath = process.env.PI_SCRIPTED_MODEL;
		const req = toScriptedRequest(context, cwd, { ...process.env });
		let res: ScriptedResponse;
		if (!scriptPath) {
			res = { text: "scripted model: set PI_SCRIPTED_MODEL to a script module to get answers." };
		} else {
			const fn = await loadScript(scriptPath);
			res = (await fn(req)) ?? {};
		}
		if (options?.signal?.aborted) throw Object.assign(new Error("aborted"), { aborted: true });

		stream.push({ type: "start", partial: output });

		if (res.thinking) {
			const block: ThinkingContent = { type: "thinking", thinking: "" };
			output.content.push(block);
			const i = output.content.length - 1;
			stream.push({ type: "thinking_start", contentIndex: i, partial: output });
			block.thinking = res.thinking;
			stream.push({ type: "thinking_delta", contentIndex: i, delta: res.thinking, partial: output });
			stream.push({ type: "thinking_end", contentIndex: i, content: res.thinking, partial: output });
		}
		if (res.text) {
			const block: TextContent = { type: "text", text: "" };
			output.content.push(block);
			const i = output.content.length - 1;
			stream.push({ type: "text_start", contentIndex: i, partial: output });
			block.text = res.text;
			stream.push({ type: "text_delta", contentIndex: i, delta: res.text, partial: output });
			stream.push({ type: "text_end", contentIndex: i, content: res.text, partial: output });
		}
		(res.toolCalls ?? []).forEach((tc, n) => {
			const call: ToolCall = {
				type: "toolCall",
				id: tc.id ?? `toy_${req.step}_${n}`,
				name: tc.name,
				arguments: (tc.arguments ?? {}) as ToolCall["arguments"],
			};
			output.content.push(call);
			const i = output.content.length - 1;
			stream.push({ type: "toolcall_start", contentIndex: i, partial: output });
			stream.push({ type: "toolcall_delta", contentIndex: i, delta: JSON.stringify(call.arguments), partial: output });
			stream.push({ type: "toolcall_end", contentIndex: i, toolCall: call, partial: output });
		});

		// Deterministic token estimate: request size without the working directory, which
		// differs between worktrees of the same task.
		const requestText = JSON.stringify(context.messages).split(cwd).join("<cwd>");
		const responseText = JSON.stringify(output.content);
		output.usage.input = estimateTokens(requestText);
		output.usage.output = estimateTokens(responseText);
		output.usage.totalTokens = output.usage.input + output.usage.output;
		calculateCost(model, output.usage);

		output.stopReason = output.content.some((b) => b.type === "toolCall") ? "toolUse" : "stop";
		stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse", message: output });
		stream.end();
	};

	run().catch((err: any) => {
		output.stopReason = err?.aborted || options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = err instanceof Error ? err.message : String(err);
		stream.push({ type: "error", reason: output.stopReason as "aborted" | "error", error: output });
		stream.end();
	});
	return stream;
}

export default function scripted(pi: ExtensionAPI) {
	pi.registerProvider("scripted", {
		name: "Scripted (offline)",
		baseUrl: "http://127.0.0.1:9",
		apiKey: "scripted-offline",
		api: "tapedeck-scripted",
		models: [
			{
				id: "toy",
				name: "Toy scripted model",
				reasoning: false,
				input: ["text"],
				// Priced like a mid-size frontier model so dollar figures are meaningful in demos.
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
		],
		streamSimple: streamScripted,
	});
}
