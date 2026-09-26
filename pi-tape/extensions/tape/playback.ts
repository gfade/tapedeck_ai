/**
 * Assistant-message streams pi-tape answers with instead of a model: a recorded response
 * played back event by event, a synthetic final text, or an error.
 */

import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Model,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
	type Usage,
} from "@earendil-works/pi-ai";

const zeroCost = (): Usage["cost"] => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

function zeroUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zeroCost() };
}

type DoneReason = "stop" | "length" | "toolUse";

/**
 * Replay a recorded assistant message: `start`, the block events, then `done`. Token counts are
 * kept (so pi's compaction thresholds behave as recorded); every cost field is zero because
 * nothing was spent. The caller has already rewritten recorded paths.
 */
export function playResponse(recorded: AssistantMessage, signal: AbortSignal | undefined): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output: AssistantMessage = {
		...recorded,
		content: [],
		usage: { ...recorded.usage, cost: zeroCost() },
		timestamp: Date.now(),
	};
	const hasToolCall = recorded.content.some((block) => block.type === "toolCall");
	const reason: DoneReason = ["stop", "length", "toolUse"].includes(recorded.stopReason)
		? (recorded.stopReason as DoneReason)
		: hasToolCall
			? "toolUse"
			: "stop";
	output.stopReason = reason;

	queueMicrotask(() => {
		if (signal?.aborted) {
			stream.push({ type: "error", reason: "aborted", error: { ...output, stopReason: "aborted", errorMessage: "aborted" } });
			stream.end();
			return;
		}
		stream.push({ type: "start", partial: output });
		for (const block of recorded.content) {
			const contentIndex = output.content.length;
			if (block.type === "text") {
				const live: TextContent = { ...block, text: "" };
				output.content.push(live);
				stream.push({ type: "text_start", contentIndex, partial: output });
				live.text = block.text;
				stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: output });
				stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
			} else if (block.type === "thinking") {
				// Redacted thinking is complete at start and has no deltas.
				const live: ThinkingContent = block.redacted ? { ...block } : { ...block, thinking: "" };
				output.content.push(live);
				stream.push({ type: "thinking_start", contentIndex, partial: output });
				if (!block.redacted) {
					live.thinking = block.thinking;
					stream.push({ type: "thinking_delta", contentIndex, delta: block.thinking, partial: output });
				}
				stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
			} else if (block.type === "toolCall") {
				const call: ToolCall = { ...block, arguments: structuredClone(block.arguments) };
				output.content.push(call);
				stream.push({ type: "toolcall_start", contentIndex, partial: output });
				stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(call.arguments), partial: output });
				stream.push({ type: "toolcall_end", contentIndex, toolCall: call, partial: output });
			}
		}
		stream.push({ type: "done", reason, message: output });
		stream.end();
	});
	return stream;
}

function emptyMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

/** A final text answer that costs nothing (used to end a replay at its divergence). */
export function textResponse(model: Model<Api>, text: string): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output = emptyMessage(model);
	queueMicrotask(() => {
		stream.push({ type: "start", partial: output });
		const block: TextContent = { type: "text", text: "" };
		output.content.push(block);
		stream.push({ type: "text_start", contentIndex: 0, partial: output });
		block.text = text;
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
		stream.push({ type: "done", reason: "stop", message: output });
		stream.end();
	});
	return stream;
}

/** A failed response (stopReason `error`) with the given message. */
export function errorResponse(model: Model<Api>, message: string): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "error", reason: "error", error: failedMessage(model, message) });
		stream.end();
	});
	return stream;
}

function failedMessage(model: Model<Api>, message: string): AssistantMessage {
	return { ...emptyMessage(model), stopReason: "error", errorMessage: message };
}

/**
 * A stream available right away that forwards the events of the stream `source` resolves to.
 * Lets the provider do async work (loading, restoring) before it picks a response.
 */
export function forwardStream(model: Model<Api>, source: Promise<AssistantMessageEventStream>): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	source
		.then(async (inner) => {
			for await (const event of inner) stream.push(event);
		})
		.catch((error: unknown) => {
			stream.push({ type: "error", reason: "error", error: failedMessage(model, error instanceof Error ? error.message : String(error)) });
		})
		.finally(() => stream.end());
	return stream;
}
