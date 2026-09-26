/**
 * pi-tape library: the tape formats and helpers, usable from plain Node without loading pi.
 * See README.md ("Library") for the API.
 */

export { canonicalEqual, canonicalJson, requestHash, sha256Hex } from "./canonical.ts";
export { encodeRequestDelta, expandRequestDelta } from "./delta.ts";
export { DETAIL_LIMIT, diffValues, firstDifference, firstDifferenceIgnoringSystem, truncate, type ValueDifference } from "./diff.ts";
export { GitError, GitWorkspace, type OpenWorkspaceOptions } from "./git.ts";
export {
	contentText,
	normalizeMessage,
	normalizeMessages,
	type PathContext,
	pathSubstitutions,
	rewriteCwd,
	substitutePaths,
} from "./normalize.ts";
export {
	activeBranch,
	parseSessionJsonl,
	readTapeFromSessionFile,
	type SessionEntry,
	type TapeFromSessionOptions,
	tapeFromSessionEntries,
	tapeFromSessionText,
} from "./session.ts";
export { type LoadTapeOptions, loadTape, parseTape, TAPE_FORMAT, TapeFormatError, tapeFromText } from "./tape.ts";
export type * from "./types.ts";
export { addUsage, emptyUsageTotals, sumUsage } from "./usage.ts";
