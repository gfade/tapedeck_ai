import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { Variant } from "../src/types.ts";

export const ADAPTIVE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export const MAX_RULES = 32;
export const MAX_RULE_LENGTH = 2000;

function object(value: unknown, label: string, keys: string[]): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) throw new Error(`Unknown ${label} key: ${key}`);
	}
	return value as Record<string, unknown>;
}

function strings(value: unknown, label: string, count = MAX_RULES): asserts value is string[] {
	if (!Array.isArray(value) || value.length > count) throw new Error(`${label} must be an array of at most ${count} strings`);
	for (const item of value) {
		if (typeof item !== "string" || !item.trim() || item.length > MAX_RULE_LENGTH) {
			throw new Error(`${label} entries must be nonempty strings of at most ${MAX_RULE_LENGTH} characters`);
		}
	}
}

function contextLimit(value: unknown): asserts value is number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 512 || value > 32000) {
		throw new Error("context.maxToolResultChars must be an integer between 512 and 32000");
	}
}

export function validateAdaptiveVariant(value: unknown): Variant {
	const spec = object(value, "variant", ["name", "description", "rules", "policy", "fork", "context", "tools"]);
	if (typeof spec.name !== "string" || !spec.name.trim()) throw new Error("variant.name must be a nonempty string");
	if ("description" in spec && typeof spec.description !== "string") throw new Error("variant.description must be a string");
	if ("rules" in spec) strings(spec.rules, "rules");
	if ("context" in spec) {
		const context = object(spec.context, "context", ["maxToolResultChars"]);
		contextLimit(context.maxToolResultChars);
	}
	if ("tools" in spec) {
		strings(spec.tools, "tools", ADAPTIVE_TOOLS.length);
		if (!spec.tools.length || new Set(spec.tools).size !== spec.tools.length) throw new Error("tools must be nonempty and unique");
		for (const tool of spec.tools) {
			if (!ADAPTIVE_TOOLS.some((known) => known === tool)) throw new Error(`Unknown tool: ${tool}`);
		}
	}
	if ("policy" in spec) {
		const policy = object(spec.policy, "policy", ["denyCommands", "denyPaths"]);
		for (const key of ["denyCommands", "denyPaths"]) {
			if (!(key in policy)) continue;
			strings(policy[key], `policy.${key}`);
			for (const source of policy[key]) new RegExp(source);
		}
	}
	if ("fork" in spec) {
		const fork = object(spec.fork, "fork", ["lenient", "at"]);
		if ("lenient" in fork) strings(fork.lenient, "fork.lenient");
		if ("at" in fork) {
			const at = object(fork.at, "fork.at", ["tool", "argMatches"]);
			strings([at.tool], "fork.at.tool");
			if ("argMatches" in at) {
				if (at.argMatches === null || typeof at.argMatches !== "object" || Array.isArray(at.argMatches)) {
					throw new Error("fork.at.argMatches must be an object");
				}
				strings(Object.values(at.argMatches), "fork.at.argMatches");
			}
		}
	}
	return spec as unknown as Variant;
}

export function toolAllowed(toolName: string, tools: readonly string[] | undefined): boolean {
	return tools === undefined || tools.includes(toolName);
}

export function truncateToolResults(messages: ContextEvent["messages"], maxToolResultChars: number): ContextEvent["messages"] {
	contextLimit(maxToolResultChars);
	return messages.map((message) => {
		if (message.role !== "toolResult") return message;
		return {
			...message,
			content: message.content.map((block) => block.type === "text" && block.text.length > maxToolResultChars
				? { ...block, text: block.text.slice(0, maxToolResultChars) }
				: block),
		};
	});
}
