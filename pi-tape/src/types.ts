/**
 * Types shared by pi-tape (inside pi), the runner and anything else that reads tapes.
 * They mirror INTERFACES.md §2.4, §2.5, §2.7 and §4 field for field.
 */

export type TapeMode = "record" | "replay" | "fork" | "off";

/** `exec` of a tool call: executed by the wrapper, answered from the tape, or never executed. */
export type ToolExec = "real" | "stub" | "none";

export interface Upstream {
	provider: string;
	model: string;
}

/** A message in normalized form (§2.4). Only `role` is common to every variant. */
export interface NormalizedMessage {
	role: string;
	[key: string]: unknown;
}

/** Token usage as pi records it on an assistant message. */
export interface RecordedUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	[key: string]: unknown;
}

/** An assistant message exactly as the session recorded it (content blocks, usage, stopReason…). */
export interface RecordedResponse {
	role: "assistant";
	content: RecordedBlock[];
	usage: RecordedUsage;
	stopReason: string;
	[key: string]: unknown;
}

export type RecordedBlock =
	| { type: "text"; text: string; [key: string]: unknown }
	| { type: "thinking"; thinking: string; redacted?: boolean; [key: string]: unknown }
	| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown>; [key: string]: unknown };

// ---------------------------------------------------------------------------------------------
// Session entries (§2.5)

export interface TapeSourceInfo {
	kind: "session" | "tape" | "url";
	location: string;
	tapeId: string | null;
	steps: number;
}

export interface TapeHeaderData {
	v: 1;
	mode: TapeMode;
	label: string | null;
	cwd: string;
	piVersion: string;
	upstream: Upstream | null;
	snapshotBase: string | null;
	refPrefix: string;
	source: TapeSourceInfo | null;
	forkAt: number | null;
	lenient: string[];
}

/** Step k's full request = step k-1's full request, first `keep` messages, then `append`. */
export interface RequestDelta {
	keep: number;
	append: NormalizedMessage[];
}

export interface TapeStepToolData {
	id: string;
	name: string;
	args: Record<string, unknown>;
	exec: ToolExec;
	resultEntryId: string | null;
	isError: boolean;
	snapshot: string | null;
}

export interface TapeStepData {
	v: 1;
	step: number;
	live: boolean;
	responseEntryId: string;
	request: RequestDelta;
	requestHash: string;
	tools: TapeStepToolData[];
	snapshotAfter: string | null;
	usage: RecordedUsage;
}

export type DivergenceKind =
	| "context"
	| "tool-args"
	| "tool-blocked"
	| "tool-unblocked"
	| "tool-unknown"
	| "tool-unwrapped"
	| "forced"
	| "tape-end"
	| "early-end";

/** Where the replay and the tape first differ. `recorded`/`live` are truncated to 500 characters. */
export interface DivergenceDetail {
	/** Index of the differing message in the live request, or null when not about a request. */
	index: number | null;
	/** Path of the first differing field, e.g. `content[0].text` or `args.command`. */
	path: string;
	recorded: string | null;
	live: string | null;
}

export interface DivergenceData {
	v: 1;
	step: number;
	kind: DivergenceKind;
	toolId: string | null;
	at: "request" | "tool" | "turn";
	detail: DivergenceDetail | null;
	restoredSnapshot: string | null;
	action: "live" | "stop";
}

// ---------------------------------------------------------------------------------------------
// Report (§2.7)

/** Summed usage; `cost` is the dollar total (sum of `usage.cost.total`). */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

export interface TapeReport {
	format: "tapedeck.report/v1";
	mode: TapeMode;
	label: string | null;
	sessionId: string;
	sessionFile: string | null;
	source: TapeSourceInfo | null;
	forkAt: number | null;
	lenient: string[];
	steps: { replayed: number; live: number; total: number };
	divergence: DivergenceData | null;
	usage: { live: UsageTotals; replayed: UsageTotals };
	snapshots: { base: string | null; final: string | null };
	finalRestore: string | null;
	errors: string[];
}

// ---------------------------------------------------------------------------------------------
// Tape JSON (§4)

export interface TapeToolResult {
	content: unknown[];
	details: unknown;
	isError: boolean;
}

export interface TapeTool {
	id: string;
	name: string;
	args: Record<string, unknown>;
	exec: ToolExec;
	result: TapeToolResult;
	snapshot: string | null;
}

export interface TapeStep {
	step: number;
	live: boolean;
	/** The full normalized request (not a delta). */
	request: NormalizedMessage[];
	requestHash: string;
	response: RecordedResponse;
	tools: TapeTool[];
	snapshotAfter: string | null;
}

export interface TapeEdit {
	step: number;
	toolId?: string | null;
	field?: string;
	note?: string;
	[key: string]: unknown;
}

export interface Tape {
	format: "tapedeck.tape/v1";
	id: string;
	sessionId: string | null;
	sourceSession: string | null;
	cwd: string;
	upstream: Upstream | null;
	snapshotBase: string | null;
	steps: TapeStep[];
	edits: TapeEdit[];
}

/** A tape plus where it came from, as recorded in `tape.header` `source`. */
export interface LoadedTape {
	tape: Tape;
	source: TapeSourceInfo;
}
