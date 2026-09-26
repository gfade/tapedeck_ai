/**
 * Request deltas (INTERFACES §2.5 `tape.step` `request`): step k's full request is step k-1's
 * full request cut to its first `keep` messages, followed by `append`. Step 1 has `keep: 0`.
 */

import { canonicalJson } from "./canonical.ts";
import type { NormalizedMessage, RequestDelta } from "./types.ts";

/** Encode `current` against the previous step's full request (the longest common prefix is kept). */
export function encodeRequestDelta(previous: readonly NormalizedMessage[], current: readonly NormalizedMessage[]): RequestDelta {
	const limit = Math.min(previous.length, current.length);
	let keep = 0;
	while (keep < limit && canonicalJson(previous[keep]) === canonicalJson(current[keep])) keep++;
	return { keep, append: current.slice(keep) };
}

/** Rebuild a full request from the previous step's full request and a delta. */
export function expandRequestDelta(previous: readonly NormalizedMessage[], delta: RequestDelta): NormalizedMessage[] {
	if (!Number.isInteger(delta.keep) || delta.keep < 0 || delta.keep > previous.length) {
		throw new Error(`invalid request delta: keep=${delta.keep} but the previous request has ${previous.length} messages`);
	}
	if (!Array.isArray(delta.append)) throw new Error("invalid request delta: append is not an array");
	return [...previous.slice(0, delta.keep), ...delta.append];
}
