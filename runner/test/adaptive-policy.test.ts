import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ADAPTIVE_TOOLS, MAX_RULE_LENGTH, MAX_RULES, toolAllowed, truncateToolResults, validateAdaptiveVariant } from "../harness/adaptive-policy.ts";
import variant from "../harness/variant.ts";

test("validates bounded adaptive variants and existing variant fields", () => {
	for (const maxToolResultChars of [512, 32000]) {
		const spec = {
			name: "adaptive",
			description: "bounded policy",
			rules: Array(MAX_RULES).fill("r".repeat(MAX_RULE_LENGTH)),
			context: { maxToolResultChars },
			tools: [...ADAPTIVE_TOOLS],
			policy: { denyCommands: ["curl"], denyPaths: ["\\.env$"] },
			fork: { lenient: ["system"], at: { tool: "edit|write", argMatches: { path: "generated/" } } },
		};
		assert.deepEqual(validateAdaptiveVariant(spec), spec);
	}
	assert.deepEqual(validateAdaptiveVariant({ name: "vanilla" }), { name: "vanilla" });
});

test("rejects malformed adaptive inputs, unknown keys, and unbounded rules", () => {
	for (const context of [null, [], "512", {}, { maxToolResultChars: 511 }, { maxToolResultChars: 32001 },
		{ maxToolResultChars: 512.5 }, { maxToolResultChars: "512" }, { maxToolResultChars: NaN },
		{ maxToolResultChars: Infinity }, { maxToolResultChars: 512, truncateUsers: true }]) {
		assert.throws(() => validateAdaptiveVariant({ name: "bad", context }));
	}
	for (const tools of [null, undefined, [], "read", ["unknown"], ["Read"], ["read", "read"], [7], ["read", ""]]) {
		assert.throws(() => validateAdaptiveVariant({ name: "bad", tools }));
	}
	for (const rules of [null, "rule", [42], [" "], Array(MAX_RULES + 1).fill("rule"), ["r".repeat(MAX_RULE_LENGTH + 1)]]) {
		assert.throws(() => validateAdaptiveVariant({ name: "bad", rules }));
	}
	for (const spec of [null, [], {}, { name: "bad", extra: true }, { name: "bad", policy: { extra: [] } },
		{ name: "bad", policy: { denyCommands: ["["] } }, { name: "bad", policy: { denyPaths: "path" } }]) {
		assert.throws(() => validateAdaptiveVariant(spec));
	}
});

test("allowlist gates tool names without treating bash as an OS sandbox", () => {
	assert.equal(toolAllowed("bash", undefined), true);
	assert.equal(toolAllowed("read", ["read"]), true);
	assert.equal(toolAllowed("bash", ["read"]), false);
	assert.equal(toolAllowed("write", ["bash"]), false);
	assert.equal(toolAllowed("bash", ["bash"]), true);
});

function transcript(): ContextEvent["messages"] {
	return [
		{ role: "user", content: "u".repeat(2000), timestamp: 1 },
		{ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "file" } }] },
		{ role: "toolResult", toolCallId: "call-1", toolName: "read", isError: false, timestamp: 2,
			details: { retained: "d".repeat(2000) }, content: [
				{ type: "text", text: "a".repeat(2000) },
				{ type: "image", data: "image-data", mimeType: "image/png" },
				{ type: "text", text: "b".repeat(513) },
				{ type: "text", text: "short" },
				{ type: "text", text: "c".repeat(512) },
			] },
	] as ContextEvent["messages"];
}

test("truncates each tool-result text block without mutating messages or breaking pairs", () => {
	const messages = transcript();
	const before = structuredClone(messages);
	const result = truncateToolResults(messages, 512);
	assert.deepEqual(messages, before);
	assert.equal(result.length, messages.length);
	assert.equal(result[0], messages[0]);
	assert.equal(result[1], messages[1]);
	const toolResult = result[2];
	assert.equal(toolResult.role, "toolResult");
	if (toolResult.role !== "toolResult") throw new Error("missing result");
	assert.deepEqual(toolResult.content, [
		{ type: "text", text: "a".repeat(512) },
		{ type: "image", data: "image-data", mimeType: "image/png" },
		{ type: "text", text: "b".repeat(512) },
		{ type: "text", text: "short" },
		{ type: "text", text: "c".repeat(512) },
	]);
	assert.deepEqual({ ...toolResult, content: undefined }, { ...messages[2], content: undefined });
	assert.deepEqual(truncateToolResults(result, 512), result);
	assert.throws(() => truncateToolResults(messages, 0));
});

test("runtime validates before installing handlers and combines gates with existing policy", () => {
	const directory = mkdtempSync(join(tmpdir(), "adaptive-policy-"));
	const previous = process.env.TAPEDECK_VARIANT;
	const file = join(directory, "variant.json");
	const handlers = new Map<string, (event: any) => any>();
	const api = { on: (name: string, handler: (event: any) => any) => handlers.set(name, handler) } as unknown as ExtensionAPI;
	try {
		process.env.TAPEDECK_VARIANT = file;
		for (const invalid of [{ context: null }, { tools: [] }, { tools: ["exec"] }, { context: { maxToolResultChars: 1 } }]) {
			writeFileSync(file, JSON.stringify({ name: "invalid", ...invalid }));
			assert.throws(() => variant(api));
			assert.equal(handlers.size, 0);
		}
		writeFileSync(file, JSON.stringify({ name: "vanilla" }));
		variant(api);
		assert.equal(handlers.size, 0);
		writeFileSync(file, JSON.stringify({ name: "adaptive", rules: ["Keep pairs."], tools: ["read", "bash"],
			context: { maxToolResultChars: 512 }, policy: { denyCommands: ["curl"], denyPaths: ["\\.env$"] } }));
		variant(api);
		assert.deepEqual([...handlers.keys()].sort(), ["before_agent_start", "context", "tool_call"]);
		const gate = handlers.get("tool_call")!;
		assert.equal(gate({ toolName: "write", input: { path: "file" } }).block, true);
		assert.match(gate({ toolName: "read", input: { path: ".env" } }).reason, /denyPaths/);
		assert.match(gate({ toolName: "bash", input: { command: "curl example.com" } }).reason, /denyCommands/);
		assert.match(gate({ toolName: "bash", input: { command: "cat .env" } }).reason, /denyPaths/);
		assert.equal(gate({ toolName: "read", input: { path: "README.md" } }), undefined);
		assert.equal(gate({ toolName: "bash", input: { command: "printf hello > file" } }), undefined);
		assert.deepEqual(handlers.get("context")!({ messages: transcript() }), { messages: truncateToolResults(transcript(), 512) });
		const start = { systemPromptOptions: { sections: {} as Record<string, string> } };
		handlers.get("before_agent_start")!(start);
		assert.equal(start.systemPromptOptions.sections["tapedeck-rules"], "- Keep pairs.");
		for (const spec of [{ tools: ["read"] }, { context: { maxToolResultChars: 512 } }]) {
			handlers.clear();
			writeFileSync(file, JSON.stringify({ name: "adaptive", ...spec }));
			variant(api);
			assert.deepEqual([...handlers.keys()], ["tools" in spec ? "tool_call" : "context"]);
		}
	} finally {
		if (previous === undefined) delete process.env.TAPEDECK_VARIANT;
		else process.env.TAPEDECK_VARIANT = previous;
		rmSync(directory, { recursive: true, force: true });
	}
});
