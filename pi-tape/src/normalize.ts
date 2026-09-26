/**
 * Request normalization (INTERFACES §2.4) and the path rewriting pi-tape applies when it
 * plays recorded data into a live run.
 *
 * A normalized request is what pi-tape stores and compares: provider-visible content only
 * (no timestamps, usage, signatures), with machine-specific paths replaced by placeholders so
 * a tape recorded in one worktree compares equal to a replay in another.
 */

import { sha256Hex } from "./canonical.ts";
import type { NormalizedMessage } from "./types.ts";

export interface PathContext {
	/** The session's working directory; replaced by `<cwd>`. */
	cwd: string;
	/** pi's package directory (`getPackageDir()`); replaced by `<pi>`. Optional. */
	piDir?: string | null;
}

type Pairs = readonly (readonly [string, string])[];

/**
 * The substitutions for a path context, longest source first. Sources shorter than two
 * characters are skipped: substituting `/` would rewrite every path.
 */
export function pathSubstitutions(paths: PathContext): [string, string][] {
	const pairs: [string, string][] = [];
	if (paths.cwd && paths.cwd.length > 1) pairs.push([paths.cwd, "<cwd>"]);
	if (paths.piDir && paths.piDir.length > 1) pairs.push([paths.piDir, "<pi>"]);
	return pairs.sort((a, b) => b[0].length - a[0].length);
}

/** Map every string value at any depth (object keys are kept). Returns plain JSON-like data. */
export function mapStrings(value: unknown, fn: (text: string) => string, skipKeys?: ReadonlySet<string>): unknown {
	if (typeof value === "string") return fn(value);
	if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, skipKeys));
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = skipKeys?.has(key) ? item : mapStrings(item, fn, skipKeys);
		}
		return out;
	}
	return value;
}

function substituteText(text: string, pairs: Pairs): string {
	let out = text;
	for (const [from, to] of pairs) {
		if (out.includes(from)) out = out.split(from).join(to);
	}
	return out;
}

/** Replace the working directory and pi's directory by `<cwd>` and `<pi>` in every string. */
export function substitutePaths<T>(value: T, paths: PathContext): T {
	const pairs = pathSubstitutions(paths);
	if (pairs.length === 0) return value;
	return mapStrings(value, (text) => substituteText(text, pairs)) as T;
}

/** Keys whose values are opaque provider tokens; rewriting them would invalidate them. */
const OPAQUE_KEYS: ReadonlySet<string> = new Set(["thinkingSignature", "textSignature", "thoughtSignature"]);

/**
 * Rewrite a recorded working directory to the live one in every string (signatures excepted),
 * so data played back into a run never mentions the recording's worktree.
 */
export function rewriteCwd<T>(value: T, recordedCwd: string, liveCwd: string): T {
	if (!recordedCwd || recordedCwd === liveCwd || recordedCwd.length < 2) return value;
	return mapStrings(value, (text) => (text.includes(recordedCwd) ? text.split(recordedCwd).join(liveCwd) : text), OPAQUE_KEYS) as T;
}

/** Normalize a request (the provider's `TranscriptContext.messages`). */
export function normalizeMessages(messages: readonly unknown[], paths: PathContext): NormalizedMessage[] {
	return substitutePaths(messages.map(normalizeMessage), paths);
}

type Loose = Record<string, any>;

/** Map one message to its normalized shape (without path substitution). */
export function normalizeMessage(message: unknown): NormalizedMessage {
	const m = (message ?? {}) as Loose;
	switch (m.role) {
		case "system": {
			const out: NormalizedMessage = { role: "system", content: contentText(m.content) };
			if (m.sections != null) {
				out.sections = Object.entries(m.sections as Record<string, string | null>).map(([name, text]) => [name, text ?? null]);
			}
			if (Array.isArray(m.toolsAdded) && m.toolsAdded.length > 0) {
				out.toolsAdded = m.toolsAdded.map((tool: Loose) =>
					jsonRoundTrip({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters,
						constrainedSampling: tool.constrainedSampling,
					}),
				);
			}
			if (Array.isArray(m.toolsRemoved) && m.toolsRemoved.length > 0) {
				out.toolsRemoved = m.toolsRemoved.map((tool: unknown) => (typeof tool === "string" ? tool : (tool as Loose).name));
			}
			if (m.replace) out.replace = true;
			return out;
		}
		case "user":
			return { role: "user", content: normalizeBlocks(typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content) };
		case "assistant":
			return { role: "assistant", content: normalizeBlocks(m.content) };
		case "toolResult":
			return {
				role: "toolResult",
				toolCallId: m.toolCallId,
				toolName: m.toolName,
				isError: Boolean(m.isError),
				content: normalizeBlocks(m.content),
			};
		default:
			return { role: String(m.role), content: contentText(m.content) };
	}
}

function normalizeBlocks(blocks: unknown): unknown[] {
	if (!Array.isArray(blocks)) return [];
	return blocks.map((block: Loose) => {
		switch (block?.type) {
			case "text":
				return { type: "text", text: block.text };
			case "thinking":
				return block.redacted ? { type: "thinking", thinking: block.thinking, redacted: true } : { type: "thinking", thinking: block.thinking };
			case "toolCall":
				return { type: "toolCall", id: block.id, name: block.name, arguments: jsonRoundTrip(block.arguments ?? {}) };
			case "image":
				return { type: "image", mimeType: block.mimeType, sha256: imageHash(block.data) };
			default:
				return jsonRoundTrip(block);
		}
	});
}

/** SHA-256 of the decoded image bytes. */
function imageHash(data: unknown): string {
	return typeof data === "string" ? sha256Hex(Buffer.from(data, "base64")) : sha256Hex("");
}

/** Text of a string or of the text blocks of a content array, joined like pi-ai's `contentText`. */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: Loose) => block?.type === "text")
		.map((block: Loose) => block.text)
		.join("\n");
}

function jsonRoundTrip(value: unknown): unknown {
	return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
