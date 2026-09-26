/**
 * The record / replay / fork state machine (INTERFACES §2.3–§2.7).
 *
 * pi reaches it from three directions: the `tape` provider (each model request), the tool
 * wrappers (each built-in tool call) and event handlers (turn and run boundaries). The provider
 * cannot write session entries, so it leaves the pending step on the current turn and the
 * `turn_end` handler writes the `tape.step` entry.
 *
 * Replay invariant: before a divergence, nothing touches the model or runs a tool for real.
 * A fork restores the workspace to the tape's snapshot at the divergence and then behaves like
 * record mode.
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model, SimpleStreamOptions, ToolCall, TranscriptContext } from "@earendil-works/pi-ai";
import type {
	AgentBeforeSettleEvent,
	AgentToolResult,
	BoundaryResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBoundaryDraft,
	ToolCallEvent,
	ToolCallEventResult,
	ToolExecutionEndEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { requestHash } from "../../src/canonical.ts";
import { encodeRequestDelta } from "../../src/delta.ts";
import { diffValues, firstDifference, firstDifferenceIgnoringSystem, truncate } from "../../src/diff.ts";
import { GitWorkspace } from "../../src/git.ts";
import { contentText, normalizeMessages, type PathContext, rewriteCwd, substitutePaths } from "../../src/normalize.ts";
import { loadTape } from "../../src/tape.ts";
import type {
	DivergenceData,
	DivergenceDetail,
	DivergenceKind,
	NormalizedMessage,
	RecordedUsage,
	Tape,
	TapeHeaderData,
	TapeReport,
	TapeSourceInfo,
	TapeStep,
	TapeStepData,
	TapeStepToolData,
	TapeTool,
	ToolExec,
} from "../../src/types.ts";
import { sumUsage } from "../../src/usage.ts";
import type { TapeConfig } from "./config.ts";
import { errorResponse, forwardStream, playResponse, textResponse } from "./playback.ts";
import { builtinToolDefinitions, type ToolRunner, wrapTool } from "./tools.ts";

/** The error a replay returns for tool calls after its divergence. */
export const REPLAY_STOPPED = "[tape] replay stopped at divergence";

/** Facts about the running pi that the entry point supplies. */
export interface TapeEnvironment {
	piVersion: string;
	/** pi's package directory, substituted by `<pi>` in normalized requests. */
	piDir: string | null;
	/** This extension's entry file, to recognize the tools it registered. */
	selfPath: string;
}

/** What pi-tape knows about one tool call of the current turn. */
interface ToolState {
	/** The wrapper ran for this call (pi-tape decided between the tool and the tape). */
	wrapped: boolean;
	/** pi-tape's `tool_call` handler saw the call. It runs last, so no earlier hook blocked it. */
	seen: boolean;
	/** pi-tape blocked the call itself (a replay reaching a tool it cannot stub). */
	blockedByTape: boolean;
	exec: ToolExec | null;
	/** Arguments after `tool_call` mutations. */
	args: Record<string, unknown> | null;
	snapshot: string | null;
}

/** One agent turn: at most one model request, which is a tape step or a synthetic reply. */
class Turn {
	kind: "open" | "step" | "synthetic" = "open";
	step = 0;
	/** The response comes from the upstream model (not from the tape). */
	live = false;
	/** The tape step being replayed, when the response comes from the tape. */
	tapeStep: TapeStep | null = null;
	request: NormalizedMessage[] = [];
	message: AssistantMessage | null = null;
	realToolRan = false;
	/** The divergence happened during this turn. */
	diverged = false;
	readonly tools = new Map<string, ToolState>();

	startStep(step: number, request: NormalizedMessage[], tapeStep: TapeStep | null): void {
		this.kind = "step";
		this.step = step;
		this.request = request;
		this.tapeStep = tapeStep;
		this.live = tapeStep === null;
	}

	tool(id: string): ToolState {
		let state = this.tools.get(id);
		if (!state) {
			state = { wrapped: false, seen: false, blockedByTape: false, exec: null, args: null, snapshot: null };
			this.tools.set(id, state);
		}
		return state;
	}

	/** 1-based position of a tool call in the response (names snapshot refs `s<step>-t<n>`). */
	toolNumber(id: string): number {
		const calls = (this.message?.content ?? []).filter(isToolCall);
		const index = calls.findIndex((call) => call.id === id);
		return index >= 0 ? index + 1 : calls.length + 1;
	}
}

interface StepSummary {
	live: boolean;
	usage: RecordedUsage;
	/** For a replayed step: the recorded usage, i.e. what the replay did not spend again. */
	recordedUsage: RecordedUsage | null;
	snapshotAfter: string | null;
}

type ToolMatch = { recorded: TapeTool } | { kind: DivergenceKind; detail: DivergenceDetail };

function isToolCall(block: { type: string }): block is ToolCall {
	return block.type === "toolCall";
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function samePath(a: string, b: string): boolean {
	const real = (path: string) => {
		try {
			return realpathSync(path);
		} catch {
			return resolve(path);
		}
	};
	return real(a) === real(b);
}

export class TapeController {
	private readonly pi: ExtensionAPI;
	private readonly config: TapeConfig;
	private readonly env: TapeEnvironment;

	// Set at session_start.
	private ctx: ExtensionContext | null = null;
	private active = false;
	private cwd = process.cwd();
	/** Built-in tool names whose registered implementation is pi-tape's wrapper. */
	private readonly wrapped = new Set<string>();

	// Set when the first run starts.
	private ready: Promise<void> | null = null;
	private sessionId = "";
	private header: TapeHeaderData | null = null;
	private git: GitWorkspace | null = null;
	private tape: Tape | null = null;
	private source: TapeSourceInfo | null = null;
	/** A problem that stops pi-tape from answering requests (bad config, unreadable tape). */
	private fatal: string | null = null;

	// Progress.
	private turn: Turn | null = null;
	private stepCount = 0;
	private lastRequest: NormalizedMessage[] = [];
	private readonly steps: StepSummary[] = [];
	/** The latest snapshot of the (real or virtual) workspace. */
	private lastSnapshot: string | null = null;
	/** Snapshot after the last tool that matched the tape: where a fork restores. */
	private restorePoint: string | null = null;
	private divergence: DivergenceData | null = null;
	/** Settles when the divergence's restore and entry are done; live work waits for it. */
	private diverging: Promise<void> = Promise.resolve();
	private tapeSettled = false;
	private finalRestore: string | null = null;
	private readonly errors: string[] = [];
	private lastReportText: string | null = null;

	constructor(pi: ExtensionAPI, config: TapeConfig, env: TapeEnvironment) {
		this.pi = pi;
		this.config = config;
		this.env = env;
	}

	// -------------------------------------------------------------------------------------------
	// Lifecycle

	/** session_start: stay inert unless `tape/main` is selected; otherwise wrap the built-in tools. */
	start(ctx: ExtensionContext): void {
		this.ctx = ctx;
		this.cwd = ctx.cwd;
		if (this.config.mode === "off") return;
		const model = ctx.model;
		if (model?.provider !== "tape" || model.id !== "main") {
			const selected = model ? `${model.provider}/${model.id}` : "none";
			this.notify(ctx, `pi-tape is inactive: the selected model is ${selected}, not tape/main.`);
			return;
		}
		this.active = true;
		this.wrapBuiltinTools(ctx);
	}

	/**
	 * Register wrappers for the built-in tools pi currently offers. Registering after startup
	 * replaces the implementations without changing which tools are active (registering
	 * `grep` while loading the extension would activate it).
	 */
	private wrapBuiltinTools(ctx: ExtensionContext): void {
		const available = new Set(this.pi.getAllTools().map((tool) => tool.name));
		const definitions = builtinToolDefinitions(ctx.cwd, ctx.isProjectTrusted());
		for (const [name, definition] of definitions) {
			if (available.has(name)) this.pi.registerTool(wrapTool(definition, this.runTool));
		}
		// Another extension that registered a built-in name first keeps it; such a tool is not ours to stub.
		for (const tool of this.pi.getAllTools()) {
			if (definitions.has(tool.name) && samePath(tool.sourceInfo.path, this.env.selfPath)) this.wrapped.add(tool.name);
		}
	}

	/** before_agent_start: set up on the first run so the header lands before any message. */
	async beginRun(): Promise<void> {
		if (this.active) await this.ensureInitialized();
	}

	private ensureInitialized(): Promise<void> {
		this.ready ??= this.initialize().catch((error) => {
			this.fatal ??= `initialization failed: ${errorText(error)}`;
			this.error(this.fatal);
		});
		return this.ready;
	}

	private async initialize(): Promise<void> {
		const ctx = this.ctx;
		if (!ctx) throw new Error("no session");
		const { mode } = this.config;
		this.sessionId = ctx.sessionManager.getSessionId();
		const refPrefix = `refs/tapes/${this.sessionId}`;
		for (const warning of this.config.warnings) this.error(warning);
		if (this.config.problems.length > 0) this.fatal = this.config.problems.join("; ");

		if (this.config.snapshots || (this.config.restore && mode !== "record")) {
			try {
				this.git = await GitWorkspace.open(this.cwd, { refPrefix });
			} catch (error) {
				this.error(`git: ${errorText(error)}`);
			}
		}

		let base: string | null = null;
		if (mode === "record") {
			base = await this.takeSnapshot("base", `tape ${this.sessionId} base`);
		} else if (this.config.source && !this.fatal) {
			try {
				const loaded = await loadTape(this.config.source);
				this.tape = loaded.tape;
				this.source = loaded.source;
				base = loaded.tape.snapshotBase;
			} catch (error) {
				this.fatal = `could not load the tape from ${this.config.source}: ${errorText(error)}`;
			}
		}
		if (!this.source && this.config.source && mode !== "record") {
			const kind = /^https?:\/\//i.test(this.config.source) ? "url" : this.config.source.endsWith(".jsonl") ? "session" : "tape";
			this.source = { kind, location: this.config.source, tapeId: null, steps: 0 };
		}
		if (this.fatal) this.error(this.fatal);
		this.lastSnapshot = base;
		this.restorePoint = base;

		this.header = {
			v: 1,
			mode,
			label: this.config.label,
			cwd: this.cwd,
			piVersion: this.env.piVersion,
			upstream: this.config.upstream ?? this.tape?.upstream ?? null,
			snapshotBase: base,
			refPrefix,
			source: this.source,
			forkAt: this.config.forkAt,
			lenient: [...this.config.lenient],
		};
		this.pi.appendEntry("tape.header", this.header);
	}

	/** session_shutdown: make sure the report file is current, drop the private index. */
	shutdown(ctx: ExtensionContext): void {
		if (this.header && this.config.reportPath) {
			const text = this.reportText(this.buildReport(ctx));
			if (text !== this.lastReportText) this.writeReport(text);
		}
		this.git?.dispose();
		this.git = null;
	}

	// -------------------------------------------------------------------------------------------
	// Model requests (the `tape` provider)

	/** The `tape/main` stream function. */
	stream(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
		return forwardStream(model, this.respond(model, context, options));
	}

	private async respond(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): Promise<AssistantMessageEventStream> {
		if (!this.active) return this.delegate(model, context, options);
		await this.ensureInitialized();
		if (this.fatal) return errorResponse(model, `[tape] ${this.fatal}`);

		const turn = this.turn;
		if (!turn || turn.kind !== "open") return this.requestOutsideStep(model, context, options);
		const request = normalizeMessages(context.messages, this.livePaths());
		const step = this.stepCount + 1;

		if (this.isLive()) {
			await this.diverging;
			turn.startStep(step, request, null);
			return this.delegate(model, context, options);
		}
		if (this.divergence) {
			// A replay that already diverged: end the run with a final message.
			turn.kind = "synthetic";
			return textResponse(model, this.stopText());
		}

		const tape = this.tape as Tape;
		const tapeStep = tape.steps[step - 1];
		const found = this.checkRequest(step, tapeStep, request);
		if (found) {
			await this.diverge(found.kind, "request", null, found.detail, step);
			if (this.isLive()) {
				turn.startStep(step, request, null);
				return this.delegate(model, context, options);
			}
			turn.kind = "synthetic";
			return textResponse(model, this.stopText());
		}
		turn.startStep(step, request, tapeStep);
		const recorded = rewriteCwd(tapeStep.response, tape.cwd, this.cwd) as unknown as AssistantMessage;
		return playResponse(recorded, options?.signal);
	}

	/** Steps 1–3 of §2.7 for the request of step `step`: the first reason to diverge, if any. */
	private checkRequest(step: number, tapeStep: TapeStep | undefined, request: NormalizedMessage[]) {
		if (!tapeStep) {
			const steps = String(this.tape?.steps.length ?? 0);
			return { kind: "tape-end" as const, detail: { index: null, path: "steps", recorded: steps, live: String(step) } };
		}
		if (this.config.forkAt === step) return { kind: "forced" as const, detail: null };
		const detail = this.config.lenient.includes("system")
			? firstDifferenceIgnoringSystem(tapeStep.request, request)
			: firstDifference(tapeStep.request, request);
		return detail ? { kind: "context" as const, detail } : null;
	}

	/** A request that is not a turn's model call (compaction, branch summary). Not a step. */
	private requestOutsideStep(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
		if (this.isLive()) return this.delegate(model, context, options);
		const message = "[tape] a request outside a turn (compaction or summary) cannot be replayed";
		this.error(message);
		return errorResponse(model, message);
	}

	/** Send the request to the upstream model with the upstream's own credentials. */
	private delegate(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream {
		const upstream = this.config.upstream;
		const registry = this.ctx?.modelRegistry;
		if (!upstream) return errorResponse(model, "[tape] PI_TAPE_UPSTREAM is not set");
		if (!registry) return errorResponse(model, "[tape] the model registry is not available yet");
		const target = registry.find(upstream.provider, upstream.model);
		if (!target) return errorResponse(model, `[tape] unknown upstream model ${upstream.provider}/${upstream.model}`);
		const { apiKey: _tapeKey, ...rest } = options ?? {};
		return registry.streamSimple(target, context, rest);
	}

	// -------------------------------------------------------------------------------------------
	// Tools

	/** Execute a wrapped built-in tool: real, or the recorded result, or not at all (replay stop). */
	private readonly runTool: ToolRunner = async (definition, toolCallId, params, signal, onUpdate, ctx) => {
		const turn = this.turn;
		const execute = () => definition.execute(toolCallId, params, signal, onUpdate, ctx);
		if (!this.active) return execute();
		if (!turn || turn.kind !== "step") {
			if (this.isLive()) return execute();
			throw new Error(REPLAY_STOPPED);
		}
		const state = turn.tool(toolCallId);
		state.wrapped = true;
		state.args = structuredClone(params);

		if (!this.divergence && turn.tapeStep) {
			const match = this.matchTool(turn.tapeStep, toolCallId, params);
			if ("recorded" in match) {
				// Update the restore point before any await: parallel siblings run concurrently.
				state.exec = "stub";
				state.snapshot = match.recorded.snapshot;
				if (match.recorded.snapshot) this.restorePoint = match.recorded.snapshot;
				return this.stubResult(match.recorded);
			}
			await this.diverge(match.kind, "tool", toolCallId, match.detail, turn.step);
		}
		await this.diverging;
		if (!this.isLive()) {
			state.exec = "none";
			throw new Error(REPLAY_STOPPED);
		}
		state.exec = "real";
		turn.realToolRan = true;
		try {
			return await execute();
		} finally {
			state.snapshot = await this.snapshotTool(turn, toolCallId);
		}
	};

	/** Compare a wrapped call with the tape (§2.7 tool checks). */
	private matchTool(tapeStep: TapeStep, toolCallId: string, params: Record<string, unknown>): ToolMatch {
		const recorded = tapeStep.tools.find((tool) => tool.id === toolCallId);
		if (!recorded) return { kind: "tool-unknown", detail: { index: null, path: "id", recorded: null, live: toolCallId } };
		if (recorded.exec === "none") return { kind: "tool-unblocked", detail: { index: null, path: "exec", recorded: "none", live: "real" } };
		const difference = diffValues(substitutePaths(recorded.args, this.tapePaths()), substitutePaths(params, this.livePaths()), "args");
		if (difference) return { kind: "tool-args", detail: { index: null, ...difference } };
		return { recorded };
	}

	/** The recorded result, as the tool would have returned it. Errors are thrown, as tools do. */
	private stubResult(recorded: TapeTool): AgentToolResult<unknown> {
		const tape = this.tape as Tape;
		const result = rewriteCwd(recorded.result, tape.cwd, this.cwd);
		if (result.isError) throw new Error(contentText(result.content));
		return { content: result.content as AgentToolResult<unknown>["content"], details: result.details ?? undefined };
	}

	/** tool_call (pi-tape's handler runs last). Guards tools pi-tape cannot stub. */
	async onToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		const turn = this.turn;
		if (!this.active || !turn) return undefined;
		try {
			const state = turn.tool(event.toolCallId);
			state.seen = true;
			state.args = structuredClone(event.input);
			if (this.wrapped.has(event.toolName) || this.config.mode === "record") return undefined;
			// Another extension's tool would run for real: a divergence before it executes.
			if (!this.divergence && turn.tapeStep) {
				const recorded = turn.tapeStep.tools.find((tool) => tool.id === event.toolCallId);
				const detail = { index: null, path: "name", recorded: recorded?.name ?? null, live: event.toolName };
				await this.diverge("tool-unwrapped", "tool", event.toolCallId, detail, turn.step);
			}
			await this.diverging;
			if (this.isLive()) return undefined;
			state.blockedByTape = true;
			return { block: true, reason: REPLAY_STOPPED };
		} catch (error) {
			this.error(`tool_call ${event.toolCallId}: ${errorText(error)}`);
			return this.config.mode === "replay" ? { block: true, reason: REPLAY_STOPPED } : undefined;
		}
	}

	/** tool_execution_end: settle calls the wrapper never ran (blocked, unknown, invalid, or not ours). */
	async onToolEnd(event: ToolExecutionEndEvent): Promise<void> {
		const turn = this.turn;
		if (!this.active || !turn || turn.kind !== "step") return;
		try {
			const state = turn.tool(event.toolCallId);
			if (state.wrapped) return;
			if (state.seen && !state.blockedByTape && !this.wrapped.has(event.toolName)) {
				// Another extension's tool, executed by pi: snapshot its effects.
				state.exec = "real";
				turn.realToolRan = true;
				state.snapshot = await this.snapshotTool(turn, event.toolCallId);
				return;
			}
			state.exec = "none";
			if (this.divergence || !turn.tapeStep) return;
			const recorded = turn.tapeStep.tools.find((tool) => tool.id === event.toolCallId);
			if (!recorded) {
				await this.diverge("tool-unknown", "tool", event.toolCallId, { index: null, path: "id", recorded: null, live: event.toolCallId }, turn.step);
			} else if (recorded.exec !== "none") {
				const reason = truncate(`none: ${contentText(event.result?.content)}`);
				await this.diverge("tool-blocked", "tool", event.toolCallId, { index: null, path: "exec", recorded: recorded.exec, live: reason }, turn.step);
			}
		} catch (error) {
			this.error(`tool_execution_end ${event.toolCallId}: ${errorText(error)}`);
		}
	}

	// -------------------------------------------------------------------------------------------
	// Turns

	onTurnStart(): void {
		if (this.active) this.turn = new Turn();
	}

	onMessageEnd(message: { role: string }): void {
		if (this.turn && message.role === "assistant") this.turn.message = message as AssistantMessage;
	}

	/** turn_end: write the `tape.step` entry (after the turn's tool results). */
	async onTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<BoundaryResult | undefined> {
		const turn = this.turn;
		this.turn = null;
		if (!this.active || !turn || turn.kind !== "step") return undefined;
		const message = event.message as AssistantMessage;
		// Failed responses are not steps; pi may retry them.
		if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return undefined;
		try {
			await this.diverging;
			const entry = await this.finishStep(turn, event, ctx);
			return { entries: [...event.entries, entry] };
		} catch (error) {
			this.error(`step ${turn.step}: ${errorText(error)}`);
			return undefined;
		}
	}

	private async finishStep(turn: Turn, event: TurnEndEvent, ctx: ExtensionContext): Promise<SessionBoundaryDraft> {
		const message = event.message as AssistantMessage;
		const step = turn.step;
		const results = this.toolResults(event, ctx);
		const tools: TapeStepToolData[] = message.content.filter(isToolCall).map((call) => {
			const state = turn.tools.get(call.id);
			const exec = state?.exec ?? "none";
			const result = results.get(call.id);
			return {
				id: call.id,
				name: call.name,
				args: exec === "none" || !state?.args ? call.arguments : state.args,
				exec,
				resultEntryId: result?.entryId ?? null,
				isError: result?.isError ?? false,
				snapshot: exec === "none" ? null : (state?.snapshot ?? null),
			};
		});

		let snapshotAfter: string | null;
		if (turn.realToolRan) snapshotAfter = await this.takeSnapshot(`s${step}`, `tape ${this.sessionId} step ${step}`);
		else if (turn.tapeStep && !turn.diverged) snapshotAfter = turn.tapeStep.snapshotAfter;
		else if (turn.tapeStep) snapshotAfter = this.restorePoint;
		else snapshotAfter = this.lastSnapshot;
		if (snapshotAfter) this.lastSnapshot = snapshotAfter;
		if (turn.tapeStep && !this.divergence && turn.tapeStep.snapshotAfter) this.restorePoint = turn.tapeStep.snapshotAfter;

		const data: TapeStepData = {
			v: 1,
			step,
			live: turn.live,
			responseEntryId: event.messageEntryId,
			request: encodeRequestDelta(this.lastRequest, turn.request),
			requestHash: requestHash(turn.request),
			tools,
			snapshotAfter,
			usage: message.usage as RecordedUsage,
		};
		this.lastRequest = turn.request;
		this.stepCount = step;
		this.steps.push({
			live: turn.live,
			usage: message.usage as RecordedUsage,
			recordedUsage: turn.tapeStep?.response.usage ?? null,
			snapshotAfter,
		});
		return { type: "custom", customType: "tape.step", data };
	}

	/** Entry id and error flag of each tool result of the turn, by tool-call id. */
	private toolResults(event: TurnEndEvent, ctx: ExtensionContext): Map<string, { entryId: string | null; isError: boolean }> {
		const results = new Map<string, { entryId: string | null; isError: boolean }>();
		for (const entryId of event.toolResultEntryIds) {
			const entry = ctx.sessionManager.getEntry(entryId);
			const message = entry?.type === "message" ? (entry.message as { role: string; toolCallId?: string; isError?: boolean }) : undefined;
			if (message?.role === "toolResult" && message.toolCallId) results.set(message.toolCallId, { entryId, isError: Boolean(message.isError) });
		}
		for (const result of event.toolResults) {
			if (!results.has(result.toolCallId)) results.set(result.toolCallId, { entryId: null, isError: result.isError });
		}
		return results;
	}

	/** agent_before_settle: end-of-tape checks, the final restore, and the report. */
	async onBeforeSettle(event: AgentBeforeSettleEvent, ctx: ExtensionContext): Promise<BoundaryResult | undefined> {
		if (!this.active || !this.header) return undefined;
		const entries: SessionBoundaryDraft[] = [];
		try {
			await this.diverging;
			const tape = this.tape;
			if (tape && !this.fatal && !this.divergence && !this.tapeSettled) {
				this.tapeSettled = true;
				if (this.stepCount < tape.steps.length) {
					// The run ended before the tape did: leave the workspace as the tape had it at that point.
					const restored = await this.restore(this.restorePoint, "early end");
					this.finalRestore = restored;
					this.divergence = {
						v: 1,
						step: this.stepCount + 1,
						kind: "early-end",
						toolId: null,
						at: "turn",
						detail: { index: null, path: "steps", recorded: String(tape.steps.length), live: String(this.stepCount) },
						restoredSnapshot: restored,
						action: "stop",
					};
					entries.push({ type: "custom", customType: "tape.divergence", data: this.divergence });
				} else {
					// The whole tape replayed: end where the recording ended.
					const final = tape.steps.at(-1)?.snapshotAfter ?? tape.snapshotBase;
					this.finalRestore = await this.restore(final, "final restore");
				}
			}
		} catch (error) {
			this.error(`agent_before_settle: ${errorText(error)}`);
		}
		const report = this.buildReport(ctx);
		this.writeReport(this.reportText(report));
		entries.push({ type: "custom", customType: "tape.report", data: report });
		return { entries: [...event.entries, ...entries] };
	}

	// -------------------------------------------------------------------------------------------
	// Divergence

	/** Record live execution: record mode, or a fork past its divergence. */
	private isLive(): boolean {
		return this.config.mode === "record" || (this.config.mode === "fork" && this.divergence !== null);
	}

	/**
	 * Mark the (single) divergence. The state flips synchronously so concurrent tool calls see
	 * it; a fork's restore finishes before `diverging` settles, and live work waits for that.
	 */
	private diverge(kind: DivergenceKind, at: DivergenceData["at"], toolId: string | null, detail: DivergenceDetail | null, step: number): Promise<void> {
		if (this.divergence) return this.diverging;
		const fork = this.config.mode === "fork";
		const data: DivergenceData = { v: 1, step, kind, toolId, at, detail, restoredSnapshot: null, action: fork ? "live" : "stop" };
		this.divergence = data;
		if (this.turn) this.turn.diverged = true;
		this.diverging = (async () => {
			try {
				if (fork) {
					data.restoredSnapshot = await this.restore(this.restorePoint, `fork at step ${step}`);
					this.lastSnapshot = this.restorePoint;
				}
				this.pi.appendEntry("tape.divergence", data);
			} catch (error) {
				this.error(`divergence: ${errorText(error)}`);
			}
		})();
		return this.diverging;
	}

	/** The final message of a replay that diverged. */
	private stopText(): string {
		const d = this.divergence as DivergenceData;
		const detail = d.detail;
		const what: Record<DivergenceKind, string> = {
			context: `request message ${detail?.index} differs at ${detail?.path || "the whole message"}`,
			"tool-args": `tool call ${d.toolId} ran with a different ${detail?.path}`,
			"tool-blocked": `tool call ${d.toolId} was not executed`,
			"tool-unblocked": `tool call ${d.toolId} was recorded as not executed`,
			"tool-unknown": `tool call ${d.toolId} is not on the tape`,
			"tool-unwrapped": `tool ${detail?.live} (call ${d.toolId}) cannot be replayed`,
			forced: `PI_TAPE_FORK_AT=${d.step}`,
			"tape-end": `the tape has ${detail?.recorded} steps`,
			"early-end": `the run ended after step ${detail?.live}`,
		};
		return `[tape] diverged at step ${d.step} (${d.kind}): ${what[d.kind]}`;
	}

	// -------------------------------------------------------------------------------------------
	// Snapshots

	private async takeSnapshot(name: string, message: string): Promise<string | null> {
		if (!this.config.snapshots || !this.git) return null;
		try {
			return await this.git.snapshot(name, message);
		} catch (error) {
			this.error(`snapshot ${name}: ${errorText(error)}`);
			return null;
		}
	}

	private snapshotTool(turn: Turn, toolCallId: string): Promise<string | null> {
		const n = turn.toolNumber(toolCallId);
		return this.takeSnapshot(`s${turn.step}-t${n}`, `tape ${this.sessionId} step ${turn.step} tool ${n}`);
	}

	/** Restore the workspace to a snapshot. Returns the snapshot, or null (with an error) if it could not. */
	private async restore(commit: string | null, why: string): Promise<string | null> {
		if (!this.config.restore) return null;
		if (!commit) {
			this.error(`${why}: the tape has no snapshot to restore`);
			return null;
		}
		if (!this.git) {
			this.error(`${why}: ${this.cwd} is not a git repository, cannot restore ${commit}`);
			return null;
		}
		try {
			await this.git.restore(commit);
			return commit;
		} catch (error) {
			this.error(`${why}: ${errorText(error)}`);
			return null;
		}
	}

	// -------------------------------------------------------------------------------------------
	// Report

	private buildReport(ctx: ExtensionContext): TapeReport {
		const replayed = this.steps.filter((step) => !step.live);
		const live = this.steps.filter((step) => step.live);
		const base = this.header?.snapshotBase ?? null;
		return {
			format: "tapedeck.report/v1",
			mode: this.config.mode,
			label: this.config.label,
			sessionId: this.sessionId,
			sessionFile: ctx.sessionManager.getSessionFile() ?? null,
			source: this.source,
			forkAt: this.config.forkAt,
			lenient: [...this.config.lenient],
			steps: { replayed: replayed.length, live: live.length, total: this.steps.length },
			divergence: this.divergence,
			usage: {
				live: sumUsage(live.map((step) => step.usage)),
				replayed: sumUsage(replayed.map((step) => step.recordedUsage)),
			},
			snapshots: { base, final: this.steps.at(-1)?.snapshotAfter ?? base },
			finalRestore: this.finalRestore,
			errors: [...this.errors],
		};
	}

	private reportText(report: TapeReport): string {
		return `${JSON.stringify(report, null, 2)}\n`;
	}

	private writeReport(text: string): void {
		this.lastReportText = text;
		const path = this.config.reportPath;
		if (!path) return;
		try {
			mkdirSync(dirname(resolve(path)), { recursive: true });
			writeFileSync(path, text);
		} catch (error) {
			this.error(`report ${path}: ${errorText(error)}`);
		}
	}

	// -------------------------------------------------------------------------------------------
	// Helpers

	private livePaths(): PathContext {
		return { cwd: this.cwd, piDir: this.env.piDir };
	}

	private tapePaths(): PathContext {
		return { cwd: this.tape?.cwd ?? this.cwd, piDir: this.env.piDir };
	}

	private error(message: string): void {
		if (!this.errors.includes(message)) this.errors.push(message);
	}

	private notify(ctx: ExtensionContext, message: string): void {
		if (ctx.hasUI) ctx.ui.notify(message, "info");
		else console.error(message);
	}
}
