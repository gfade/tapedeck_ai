/**
 * Reading pi session files (INTERFACES §3) and turning their `tape.*` entries into the
 * self-contained tape JSON of §4.
 */

import { readFileSync } from "node:fs";
import { expandRequestDelta } from "./delta.ts";
import type {
	NormalizedMessage,
	RecordedResponse,
	Tape,
	TapeHeaderData,
	TapeStep,
	TapeStepData,
	TapeTool,
	TapeToolResult,
} from "./types.ts";

/** One line of a session file. Every entry but the `session` header has `id` and `parentId`. */
export interface SessionEntry {
	type: string;
	id?: string;
	parentId?: string | null;
	[key: string]: unknown;
}

/**
 * Parse session JSONL. Records are split on LF only (pi's framing). A final line that does
 * not parse is ignored, since it can be a write cut short by a crash; any other bad line throws.
 */
export function parseSessionJsonl(text: string): SessionEntry[] {
	const lines = text.split("\n");
	const entries: SessionEntry[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].replace(/\r$/, "");
		if (line.trim() === "") continue;
		try {
			entries.push(JSON.parse(line));
		} catch (err) {
			const isLast = lines.slice(i + 1).every((rest) => rest.trim() === "");
			if (isLast) break;
			throw new Error(`session line ${i + 1} is not valid JSON: ${(err as Error).message}`);
		}
	}
	return entries;
}

/** The active branch: from the last entry of the file, follow `parentId` to the root. Oldest first. */
export function activeBranch(entries: readonly SessionEntry[]): SessionEntry[] {
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) if (typeof entry.id === "string") byId.set(entry.id, entry);
	const last = [...entries].reverse().find((entry) => typeof entry.id === "string");
	const branch: SessionEntry[] = [];
	const seen = new Set<string>();
	for (let entry = last; entry && typeof entry.id === "string" && !seen.has(entry.id); ) {
		seen.add(entry.id);
		branch.push(entry);
		entry = entry.parentId ? byId.get(entry.parentId) : undefined;
	}
	return branch.reverse();
}

function customData<T>(entry: SessionEntry, customType: string): T | undefined {
	return entry.type === "custom" && entry.customType === customType ? (entry.data as T) : undefined;
}

export interface TapeFromSessionOptions {
	/** Tape `id`; defaults to the session id. */
	id?: string;
	/** Stored as `sourceSession`. */
	location?: string | null;
}

/** Build tape JSON from parsed session entries. Throws when the session holds no tape. */
export function tapeFromSessionEntries(entries: readonly SessionEntry[], options: TapeFromSessionOptions = {}): Tape {
	const sessionHeader = entries.find((entry) => entry.type === "session");
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) if (typeof entry.id === "string") byId.set(entry.id, entry);
	const branch = activeBranch(entries);

	let header: TapeHeaderData | undefined;
	const steps: TapeStep[] = [];
	let previousRequest: NormalizedMessage[] = [];
	for (let index = 0; index < branch.length; index++) {
		const entry = branch[index];
		header ??= customData<TapeHeaderData>(entry, "tape.header");
		const data = customData<TapeStepData>(entry, "tape.step");
		if (!data) continue;
		const request = expandRequestDelta(previousRequest, data.request);
		previousRequest = request;
		const responseEntry = data.responseEntryId ? byId.get(data.responseEntryId) : undefined;
		const response = (responseEntry?.message ?? undefined) as RecordedResponse | undefined;
		if (!response || response.role !== "assistant") {
			throw new Error(`tape.step ${data.step}: response entry ${data.responseEntryId} not found`);
		}
		const tools: TapeTool[] = (data.tools ?? []).map((tool) => ({
			id: tool.id,
			name: tool.name,
			args: tool.args,
			exec: tool.exec,
			result: toolResult(byId, branch, index, tool.resultEntryId, tool.id, data.step),
			snapshot: tool.snapshot ?? null,
		}));
		steps.push({
			step: data.step,
			live: data.live,
			request,
			requestHash: data.requestHash,
			response,
			tools,
			snapshotAfter: data.snapshotAfter ?? null,
		});
	}
	if (!header && steps.length === 0) throw new Error("not a tape: the session has no tape.header or tape.step entries");

	const sessionId = typeof sessionHeader?.id === "string" ? sessionHeader.id : null;
	return {
		format: "tapedeck.tape/v1",
		id: options.id ?? sessionId ?? "tape",
		sessionId,
		sourceSession: options.location ?? null,
		cwd: header?.cwd ?? (typeof sessionHeader?.cwd === "string" ? sessionHeader.cwd : ""),
		upstream: header?.upstream ?? null,
		snapshotBase: header?.snapshotBase ?? null,
		steps,
		edits: [],
	};
}

/**
 * Find a tool's result message: by entry id, or (when the id was not recorded) by tool-call id
 * among the entries before the step entry.
 */
function toolResult(
	byId: ReadonlyMap<string, SessionEntry>,
	branch: readonly SessionEntry[],
	stepIndex: number,
	entryId: string | null,
	toolCallId: string,
	step: number,
): TapeToolResult {
	let entry = entryId ? byId.get(entryId) : undefined;
	for (let i = stepIndex - 1; !entry && i >= 0; i--) {
		const message = branch[i].message as { role?: string; toolCallId?: string } | undefined;
		if (branch[i].type === "message" && message?.role === "toolResult" && message.toolCallId === toolCallId) entry = branch[i];
	}
	const message = entry?.message as { content?: unknown[]; details?: unknown; isError?: boolean } | undefined;
	if (!message) throw new Error(`tape.step ${step}: no result for tool call ${toolCallId}`);
	return { content: message.content ?? [], details: message.details ?? null, isError: Boolean(message.isError) };
}

/** Build tape JSON from the text of a session file. */
export function tapeFromSessionText(text: string, options: TapeFromSessionOptions = {}): Tape {
	return tapeFromSessionEntries(parseSessionJsonl(text), options);
}

/** Read a session `.jsonl` file and build its tape JSON (`sourceSession` is the path). */
export function readTapeFromSessionFile(path: string, options: TapeFromSessionOptions = {}): Tape {
	return tapeFromSessionText(readFileSync(path, "utf8"), { location: path, ...options });
}
