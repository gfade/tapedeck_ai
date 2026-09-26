/**
 * variant — the harness patch under test, as a pi extension.
 *
 * Reads the variant JSON named by TAPEDECK_VARIANT (INTERFACES.md §5.6) and applies it:
 *
 * - `rules` become one system prompt section named `tapedeck-rules` (pi wraps the value in
 *   `<tapedeck-rules>` tags and places custom sections after `cwd`);
 * - `policy` becomes a `tool_call` gate. A blocked call is answered by pi with the error
 *   "Blocked by tapedeck policy: <rule>" and never executes.
 *
 * It never registers or overrides tools (pi-tape wraps the built-ins and must see them),
 * and a variant without rules or policy (vanilla) installs no handlers at all, so the model
 * sees exactly what pi alone would send.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { toolAllowed, truncateToolResults, validateAdaptiveVariant } from "./adaptive-policy.ts";

interface Rule {
	label: string;
	re: RegExp;
}

function compile(kind: string, sources: string[] | undefined): Rule[] {
	return (sources ?? []).map((source) => ({ label: `${kind} ${source}`, re: new RegExp(source) }));
}

/**
 * Rough shell tokenization: enough to find file arguments such as `.env` in
 * `cat .env`, `source ./.env` or `grep KEY config/.env | head`. Quotes are stripped and
 * redirections and separators split words.
 */
function commandWords(command: string): string[] {
	return command
		.split(/[\s;&|()<>`]+/)
		.map((word) => word.replace(/^['"]+|['"]+$/g, ""))
		.filter((word) => word.length > 0);
}

/** Returns the label of the first rule that forbids this call, or undefined. */
function violation(toolName: string, input: Record<string, unknown>, denyCommands: Rule[], denyPaths: Rule[]): string | undefined {
	if (toolName === "bash" && typeof input.command === "string") {
		const command = input.command;
		const byCommand = denyCommands.find((rule) => rule.re.test(command));
		if (byCommand) return byCommand.label;
		const words = commandWords(command);
		const byPath = denyPaths.find((rule) => words.some((word) => rule.re.test(word)));
		if (byPath) return byPath.label;
		return undefined;
	}
	if (typeof input.path === "string") {
		const path = input.path;
		return denyPaths.find((rule) => rule.re.test(path))?.label;
	}
	return undefined;
}

export default function variant(pi: ExtensionAPI) {
	const file = process.env.TAPEDECK_VARIANT;
	if (!file) return;
	const spec = validateAdaptiveVariant(JSON.parse(readFileSync(file, "utf8")));

	if (spec.context) {
		const { maxToolResultChars } = spec.context;
		pi.on("context", (event) => ({ messages: truncateToolResults(event.messages, maxToolResultChars) }));
	}

	const rules = (spec.rules ?? []).map((rule) => rule.trim()).filter((rule) => rule.length > 0);
	if (rules.length > 0) {
		const section = rules.map((rule) => `- ${rule}`).join("\n");
		pi.on("before_agent_start", (event) => {
			event.systemPromptOptions.sections["tapedeck-rules"] = section;
		});
	}

	const denyCommands = compile("denyCommands", spec.policy?.denyCommands);
	const denyPaths = compile("denyPaths", spec.policy?.denyPaths);
	if (spec.tools || denyCommands.length > 0 || denyPaths.length > 0) {
		pi.on("tool_call", (event) => {
			if (!toolAllowed(event.toolName, spec.tools)) {
				return { block: true, reason: `Blocked by tapedeck policy: tool ${event.toolName} is not allowed` };
			}
			const rule = violation(event.toolName, event.input as Record<string, unknown>, denyCommands, denyPaths);
			if (rule) return { block: true, reason: `Blocked by tapedeck policy: ${rule}` };
			return undefined;
		});
	}
}
