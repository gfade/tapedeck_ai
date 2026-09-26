/**
 * First-difference search between recorded and live data, reported with a field path such
 * as `content[0].text` (INTERFACES §2.5 `tape.divergence` detail).
 */

import { canonicalJson } from "./canonical.ts";
import type { DivergenceDetail, NormalizedMessage } from "./types.ts";

/** `recorded`/`live` strings in a divergence detail are cut to this many characters. */
export const DETAIL_LIMIT = 500;

export interface ValueDifference {
	/** Path of the first differing field; `""` when the values differ at the top. */
	path: string;
	/** The recorded value at that path (strings verbatim, other values as canonical JSON), or null if absent. */
	recorded: string | null;
	live: string | null;
}

export function truncate(text: string, limit = DETAIL_LIMIT): string {
	return text.length <= limit ? text : text.slice(0, limit);
}

function render(value: unknown): string | null {
	if (value === undefined) return null;
	return truncate(typeof value === "string" ? value : canonicalJson(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keyPath(base: string, key: string): string {
	const segment = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
	if (segment.startsWith("[")) return `${base}${segment}`;
	return base === "" ? segment : `${base}.${segment}`;
}

/** The first difference between two JSON-like values, or null when they are canonically equal. */
export function diffValues(recorded: unknown, live: unknown, path = ""): ValueDifference | null {
	if (canonicalJson(recorded) === canonicalJson(live) && (recorded === undefined) === (live === undefined)) return null;
	if (Array.isArray(recorded) && Array.isArray(live)) {
		const length = Math.max(recorded.length, live.length);
		for (let i = 0; i < length; i++) {
			const found = diffValues(recorded[i], live[i], `${path}[${i}]`);
			if (found) return found;
		}
		return null;
	}
	if (isPlainObject(recorded) && isPlainObject(live)) {
		const keys = [...new Set([...Object.keys(recorded), ...Object.keys(live)])].sort();
		for (const key of keys) {
			const found = diffValues(recorded[key], live[key], keyPath(path, key));
			if (found) return found;
		}
		return null;
	}
	return { path, recorded: render(recorded), live: render(live) };
}

/**
 * The first differing message of two normalized requests. `index` is the message's index in
 * the live request; `path` is the field path inside that message.
 */
export function firstDifference(recorded: readonly NormalizedMessage[], live: readonly NormalizedMessage[]): DivergenceDetail | null {
	return firstDifferenceIndexed(
		recorded,
		live.map((message, index) => ({ message, index })),
	);
}

/**
 * Like {@link firstDifference}, but ignores system messages on both sides
 * (`PI_TAPE_LENIENT=system`). Indexes still refer to the unfiltered live request.
 */
export function firstDifferenceIgnoringSystem(recorded: readonly NormalizedMessage[], live: readonly NormalizedMessage[]): DivergenceDetail | null {
	return firstDifferenceIndexed(
		recorded.filter((message) => message.role !== "system"),
		live.map((message, index) => ({ message, index })).filter(({ message }) => message.role !== "system"),
	);
}

function firstDifferenceIndexed(
	recorded: readonly NormalizedMessage[],
	live: readonly { message: NormalizedMessage; index: number }[],
): DivergenceDetail | null {
	const length = Math.max(recorded.length, live.length);
	for (let i = 0; i < length; i++) {
		const found = diffValues(recorded[i], live[i]?.message);
		if (!found) continue;
		// A missing message is reported at the position it would have in the live request.
		const index = live[i]?.index ?? (live.length > 0 ? live[live.length - 1].index + 1 + (i - live.length) : i);
		return { index, ...found };
	}
	return null;
}
