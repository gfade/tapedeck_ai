/**
 * Tape JSON (`tapedeck.tape/v1`, INTERFACES §4): validation and loading from a session file,
 * a tape file, or an http(s) URL.
 */

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { tapeFromSessionText } from "./session.ts";
import type { LoadedTape, RecordedResponse, Tape, TapeStep, TapeTool, ToolExec, Upstream } from "./types.ts";

export const TAPE_FORMAT = "tapedeck.tape/v1";

export class TapeFormatError extends Error {
	override name = "TapeFormatError";
}

type Loose = Record<string, unknown>;

function object(value: unknown, where: string): Loose {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TapeFormatError(`${where} must be an object`);
	return value as Loose;
}

function array(value: unknown, where: string): unknown[] {
	if (!Array.isArray(value)) throw new TapeFormatError(`${where} must be an array`);
	return value;
}

function string(value: unknown, where: string): string {
	if (typeof value !== "string") throw new TapeFormatError(`${where} must be a string`);
	return value;
}

function stringOrNull(value: unknown, where: string): string | null {
	if (value === undefined || value === null) return null;
	return string(value, where);
}

const EXECS: readonly ToolExec[] = ["real", "stub", "none"];

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Validate tape JSON and fill optional fields. Steps must be numbered 1, 2, 3… in order.
 * `requestHash` is not checked: it may be stale after an edit (pi-tape compares requests).
 */
export function parseTape(value: unknown): Tape {
	const tape = object(value, "tape");
	if (tape.format !== TAPE_FORMAT) throw new TapeFormatError(`tape.format must be "${TAPE_FORMAT}"`);
	const steps = array(tape.steps, "tape.steps").map((step, i) => parseStep(step, i + 1));
	let upstream: Upstream | null = null;
	if (tape.upstream !== undefined && tape.upstream !== null) {
		const u = object(tape.upstream, "tape.upstream");
		upstream = { provider: string(u.provider, "tape.upstream.provider"), model: string(u.model, "tape.upstream.model") };
	}
	return {
		format: TAPE_FORMAT,
		id: typeof tape.id === "string" && tape.id !== "" ? tape.id : "tape",
		sessionId: stringOrNull(tape.sessionId, "tape.sessionId"),
		sourceSession: stringOrNull(tape.sourceSession, "tape.sourceSession"),
		cwd: string(tape.cwd, "tape.cwd"),
		upstream,
		snapshotBase: stringOrNull(tape.snapshotBase, "tape.snapshotBase"),
		steps,
		edits: Array.isArray(tape.edits) ? (tape.edits as Tape["edits"]) : [],
	};
}

function parseStep(value: unknown, expected: number): TapeStep {
	const where = `tape.steps[${expected - 1}]`;
	const step = object(value, where);
	if (step.step !== expected) throw new TapeFormatError(`${where}.step must be ${expected}`);
	const request = array(step.request, `${where}.request`).map((message, i) => {
		const m = object(message, `${where}.request[${i}]`);
		string(m.role, `${where}.request[${i}].role`);
		return m as { role: string };
	});
	return {
		step: expected,
		live: step.live === undefined ? true : Boolean(step.live),
		request,
		requestHash: typeof step.requestHash === "string" ? step.requestHash : "",
		response: parseResponse(step.response, `${where}.response`),
		tools: array(step.tools ?? [], `${where}.tools`).map((tool, i) => parseTool(tool, `${where}.tools[${i}]`)),
		snapshotAfter: stringOrNull(step.snapshotAfter, `${where}.snapshotAfter`),
	};
}

function parseResponse(value: unknown, where: string): RecordedResponse {
	const response = object(value, where);
	if (response.role !== "assistant") throw new TapeFormatError(`${where}.role must be "assistant"`);
	array(response.content, `${where}.content`).forEach((block, i) => {
		const b = object(block, `${where}.content[${i}]`);
		const at = `${where}.content[${i}]`;
		if (b.type === "text") string(b.text, `${at}.text`);
		else if (b.type === "thinking") string(b.thinking, `${at}.thinking`);
		else if (b.type === "toolCall") {
			string(b.id, `${at}.id`);
			string(b.name, `${at}.name`);
			object(b.arguments, `${at}.arguments`);
		} else throw new TapeFormatError(`${at}.type must be text, thinking or toolCall`);
	});
	const hasToolCall = (response.content as Loose[]).some((b) => b.type === "toolCall");
	return {
		...response,
		usage: response.usage === undefined ? structuredClone(ZERO_USAGE) : (object(response.usage, `${where}.usage`) as RecordedResponse["usage"]),
		stopReason: typeof response.stopReason === "string" ? response.stopReason : hasToolCall ? "toolUse" : "stop",
	} as RecordedResponse;
}

function parseTool(value: unknown, where: string): TapeTool {
	const tool = object(value, where);
	const exec = tool.exec as ToolExec;
	if (!EXECS.includes(exec)) throw new TapeFormatError(`${where}.exec must be real, stub or none`);
	const result = object(tool.result, `${where}.result`);
	return {
		id: string(tool.id, `${where}.id`),
		name: string(tool.name, `${where}.name`),
		args: object(tool.args, `${where}.args`),
		exec,
		result: {
			content: array(result.content, `${where}.result.content`),
			details: result.details ?? null,
			isError: Boolean(result.isError),
		},
		snapshot: stringOrNull(tool.snapshot, `${where}.snapshot`),
	};
}

/**
 * Read a tape from text: tape JSON, or a pi session (JSONL) with `tape.*` entries.
 * `hint` is the file extension when known.
 */
export function tapeFromText(text: string, location: string | null, hint?: ".json" | ".jsonl"): { tape: Tape; kind: "session" | "tape" } {
	if (hint !== ".jsonl") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			if (hint === ".json") throw new TapeFormatError(`not valid JSON: ${(err as Error).message}`);
		}
		if (parsed !== undefined && (parsed as Loose)?.type !== "session") return { tape: parseTape(parsed), kind: "tape" };
	}
	return { tape: tapeFromSessionText(text, { location }), kind: "session" };
}

export interface LoadTapeOptions {
	/** Timeout for URL sources, in milliseconds (default 30 s). */
	timeoutMs?: number;
}

/**
 * Load a tape from a session `.jsonl` path, a tape `.json` path, or an `http(s)://` URL
 * returning tape JSON (a session JSONL body is accepted too). Returns the tape and the
 * `source` object pi-tape records in `tape.header`.
 */
export async function loadTape(source: string, options: LoadTapeOptions = {}): Promise<LoadedTape> {
	if (/^https?:\/\//i.test(source)) {
		const response = await fetch(source, {
			signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
			headers: { accept: "application/json, application/x-ndjson;q=0.9, */*;q=0.1" },
		});
		if (!response.ok) throw new Error(`GET ${source}: HTTP ${response.status}`);
		const { tape } = tapeFromText(await response.text(), source);
		return { tape, source: { kind: "url", location: source, tapeId: tape.id, steps: tape.steps.length } };
	}
	const path = resolve(source);
	const ext = extname(path).toLowerCase();
	const { tape, kind } = tapeFromText(await readFile(path, "utf8"), path, ext === ".json" || ext === ".jsonl" ? ext : undefined);
	return { tape, source: { kind, location: path, tapeId: kind === "tape" ? tape.id : null, steps: tape.steps.length } };
}
