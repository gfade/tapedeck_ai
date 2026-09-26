/** pi-tape's environment variables (INTERFACES §2.2). */

import type { TapeMode, Upstream } from "../../src/types.ts";

export interface TapeConfig {
	mode: TapeMode;
	upstream: Upstream | null;
	source: string | null;
	forkAt: number | null;
	/** Known values only; `system` is the one defined value. */
	lenient: string[];
	reportPath: string | null;
	snapshots: boolean;
	restore: boolean;
	label: string | null;
	/** Problems that stop pi-tape from working once `tape/main` is used. */
	problems: string[];
	/** Problems worth reporting that do not stop it. */
	warnings: string[];
}

const MODES: readonly TapeMode[] = ["record", "replay", "fork", "off"];
const LENIENT: readonly string[] = ["system"];

/** Split `provider/modelId` at the first slash. */
export function parseUpstream(value: string | undefined): Upstream | null {
	const text = value?.trim();
	if (!text) return null;
	const slash = text.indexOf("/");
	if (slash <= 0 || slash === text.length - 1) return null;
	return { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

export function readConfig(env: Record<string, string | undefined>): TapeConfig {
	const problems: string[] = [];
	const warnings: string[] = [];
	const rawMode = (env.PI_TAPE_MODE ?? "").trim() || "record";
	// An unknown mode is reported (as a problem) through the record path rather than ignored.
	const mode = MODES.includes(rawMode as TapeMode) ? (rawMode as TapeMode) : "record";
	if (mode !== rawMode) problems.push(`PI_TAPE_MODE must be record, replay, fork or off (got "${rawMode}")`);

	const upstream = parseUpstream(env.PI_TAPE_UPSTREAM);
	if (env.PI_TAPE_UPSTREAM?.trim() && !upstream) problems.push(`PI_TAPE_UPSTREAM must be provider/modelId (got "${env.PI_TAPE_UPSTREAM}")`);
	else if (!upstream && (mode === "record" || mode === "fork")) problems.push(`PI_TAPE_UPSTREAM is required in ${mode} mode`);

	const source = env.PI_TAPE_SOURCE?.trim() || null;
	if (!source && (mode === "replay" || mode === "fork")) problems.push(`PI_TAPE_SOURCE is required in ${mode} mode`);

	let forkAt: number | null = null;
	if (env.PI_TAPE_FORK_AT?.trim()) {
		const n = Number(env.PI_TAPE_FORK_AT);
		if (Number.isInteger(n) && n >= 1) forkAt = n;
		else problems.push(`PI_TAPE_FORK_AT must be an integer >= 1 (got "${env.PI_TAPE_FORK_AT}")`);
	}

	const lenient: string[] = [];
	for (const item of (env.PI_TAPE_LENIENT ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
		if (LENIENT.includes(item)) {
			if (!lenient.includes(item)) lenient.push(item);
		} else warnings.push(`PI_TAPE_LENIENT: unknown value "${item}" ignored`);
	}

	const flag = (name: string, value: string | undefined): boolean => {
		const v = (value ?? "git").trim() || "git";
		if (v !== "git" && v !== "off") warnings.push(`${name} must be git or off (got "${v}"); using git`);
		return v !== "off";
	};

	return {
		mode,
		upstream,
		source,
		forkAt,
		lenient,
		reportPath: env.PI_TAPE_REPORT?.trim() || null,
		snapshots: flag("PI_TAPE_SNAPSHOTS", env.PI_TAPE_SNAPSHOTS),
		restore: flag("PI_TAPE_RESTORE", env.PI_TAPE_RESTORE),
		label: env.PI_TAPE_LABEL ?? null,
		problems,
		warnings,
	};
}
