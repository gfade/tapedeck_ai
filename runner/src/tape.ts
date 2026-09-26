/**
 * The runner's view of sessions and tapes. Parsing and session → tape conversion come from
 * pi-tape's library (pi-tape/src), so there is one implementation of the formats; this
 * module adds run summaries and fork points from a variant's fork rule.
 */

import { readFileSync } from "node:fs";
import { activeBranch, parseSessionJsonl, type SessionEntry, sumUsage } from "../../pi-tape/src/index.ts";
import type { ForkRule, Tape, Usage } from "./types.ts";

export { loadTape, parseTape, readTapeFromSessionFile } from "../../pi-tape/src/index.ts";

/** The active branch of a session file, root first. */
export function readBranch(file: string): SessionEntry[] {
	return activeBranch(parseSessionJsonl(readFileSync(file, "utf8")));
}

/** The `data` of every custom entry of one type on the branch. */
export function customData<T = any>(branch: SessionEntry[], customType: string): T[] {
	return branch.filter((e) => e.type === "custom" && e.customType === customType).map((e) => e.data as T);
}

export function hasTape(branch: SessionEntry[]): boolean {
	return customData(branch, "tape.header").length > 0;
}

export interface SessionSummary {
	steps: { total: number; replayed: number; live: number };
	usage: Usage;
	savedUsage: Usage;
}

/**
 * Steps and usage straight from a session, for runs without a pi-tape report: from the
 * `tape.step` entries when present, otherwise (a run without pi-tape) from the assistant
 * messages. Replayed steps carry zero cost in a session, so savedUsage.cost is 0 here.
 */
export function summarizeSession(branch: SessionEntry[]): SessionSummary {
	const steps = customData(branch, "tape.step");
	if (steps.length > 0) {
		const live = steps.filter((s) => s.live);
		const replayed = steps.filter((s) => !s.live);
		return {
			steps: { total: steps.length, replayed: replayed.length, live: live.length },
			usage: sumUsage(live.map((s) => s.usage)),
			savedUsage: sumUsage(replayed.map((s) => s.usage)),
		};
	}
	const responses = branch
		.map((e) => (e.type === "message" ? (e.message as { role?: string; stopReason?: string; usage?: Usage }) : undefined))
		.filter((m) => m?.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted");
	return {
		steps: { total: responses.length, replayed: 0, live: responses.length },
		usage: sumUsage(responses.map((m) => m?.usage)),
		savedUsage: sumUsage([]),
	};
}

function stringArg(value: unknown): string {
	return typeof value === "string" ? value : (JSON.stringify(value) ?? "");
}

/** True when a tool call matches a fork rule (§5.6): `tool` is a name or a regex over the whole name. */
export function matchesForkRule(rule: ForkRule, name: string, args: Record<string, unknown>): boolean {
	if (!new RegExp(`^(?:${rule.tool})$`).test(name)) return false;
	return Object.entries(rule.argMatches ?? {}).every(([key, pattern]) => key in args && new RegExp(pattern).test(stringArg(args[key])));
}

/** The first step whose response has a tool call matching the rule, or null. */
export function forkAtFromRule(tape: Tape, rule: ForkRule): number | null {
	for (const step of tape.steps) {
		for (const block of step.response.content) {
			if (block.type === "toolCall" && matchesForkRule(rule, block.name, block.arguments)) return step.step;
		}
	}
	return null;
}
