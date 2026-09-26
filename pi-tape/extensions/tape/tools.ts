/**
 * Wrapped copies of pi's built-in tools (INTERFACES §2.3).
 *
 * Each wrapper is pi's own definition (`createBashToolDefinition(cwd)` etc., built with the
 * same settings pi uses) spread into a new object with a different `execute`, so the model
 * sees byte-identical declarations and prompt sections.
 */

import type { AgentToolResult, AgentToolUpdateCallback, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createPowerShellToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

/** The built-in tools pi-tape can stub. */
export const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"] as const;

// Tool definitions differ in parameter and detail types.
type AnyToolDefinition = ToolDefinition<any, any, any>;

/** Options pi passes to its built-in tools, read from the same settings files. */
function builtinToolSettings(cwd: string, projectTrusted: boolean) {
	try {
		const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted });
		return {
			autoResizeImages: settings.getImageAutoResize(),
			commandPrefix: settings.getShellCommandPrefix(),
			shellPath: settings.getShellPath(),
		};
	} catch {
		return { autoResizeImages: true, commandPrefix: undefined, shellPath: undefined };
	}
}

/** pi's own definitions of the built-in tools for this working directory. */
export function builtinToolDefinitions(cwd: string, projectTrusted: boolean): Map<string, AnyToolDefinition> {
	const s = builtinToolSettings(cwd, projectTrusted);
	return new Map<string, AnyToolDefinition>([
		["read", createReadToolDefinition(cwd, { autoResizeImages: s.autoResizeImages })],
		["bash", createBashToolDefinition(cwd, { commandPrefix: s.commandPrefix, shellPath: s.shellPath })],
		["edit", createEditToolDefinition(cwd)],
		["write", createWriteToolDefinition(cwd)],
		["grep", createGrepToolDefinition(cwd)],
		["find", createFindToolDefinition(cwd)],
		["ls", createLsToolDefinition(cwd)],
		["powershell", createPowerShellToolDefinition(cwd)],
	]);
}

/** Runs a wrapped tool call; the controller decides between the real tool and the tape. */
export type ToolRunner = (
	definition: AnyToolDefinition,
	toolCallId: string,
	params: Record<string, unknown>,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<unknown> | undefined,
	ctx: ExtensionContext,
) => Promise<AgentToolResult<unknown>>;

/** The definition with `execute` routed through `run`; everything the model sees is unchanged. */
export function wrapTool(definition: AnyToolDefinition, run: ToolRunner): AnyToolDefinition {
	return {
		...definition,
		execute: (toolCallId, params, signal, onUpdate, ctx) => run(definition, toolCallId, params as Record<string, unknown>, signal, onUpdate, ctx),
	};
}
