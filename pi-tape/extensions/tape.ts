/**
 * pi-tape — record every pi run as a tape, replay it against a patched harness at zero
 * tokens, and fork live from the first step that changes.
 *
 * Registers the `tape` provider with one model, `tape/main`. Select it (`--model tape/main`)
 * and name the real model in PI_TAPE_UPSTREAM; PI_TAPE_MODE picks record (default), replay,
 * fork or off. See README.md and INTERFACES.md §2 for the full behavior.
 */

import { fileURLToPath } from "node:url";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { type ExtensionAPI, getPackageDir, type ProviderModelConfig, VERSION } from "@earendil-works/pi-coding-agent";
import type { Upstream } from "../src/types.ts";
import { readConfig } from "./tape/config.ts";
import { TapeController } from "./tape/controller.ts";

/**
 * `tape/main` mirrors the upstream model's metadata when pi-ai's built-in catalog knows it,
 * so context-window based behavior (compaction) matches the upstream.
 */
function tapeModel(upstream: Upstream | null): ProviderModelConfig {
	let known: ReturnType<typeof getBuiltinModel> | undefined;
	try {
		// The catalog is typed by known provider and model ids; any string is fine at runtime.
		known = upstream ? getBuiltinModel(upstream.provider as never, upstream.model as never) : undefined;
	} catch {
		known = undefined;
	}
	return {
		id: "main",
		name: upstream ? `Tape (${upstream.provider}/${upstream.model})` : "Tape",
		reasoning: known?.reasoning ?? false,
		input: known?.input ?? ["text", "image"],
		cost: known ? { ...known.cost } : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: known?.contextWindow ?? 200000,
		maxTokens: known?.maxTokens ?? 32000,
		...(known?.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {}),
	};
}

function packageDir(): string | null {
	try {
		return getPackageDir();
	} catch {
		return null;
	}
}

export default function tape(pi: ExtensionAPI) {
	const config = readConfig(process.env);
	const controller = new TapeController(pi, config, {
		piVersion: VERSION,
		piDir: packageDir(),
		selfPath: fileURLToPath(import.meta.url),
	});

	pi.registerProvider("tape", {
		name: "TapeDeck tape",
		baseUrl: "http://127.0.0.1:9",
		apiKey: "tapedeck",
		api: "tapedeck-tape",
		models: [tapeModel(config.upstream)],
		streamSimple: (model, context, options) => controller.stream(model, context, options),
	});

	// Needed in every mode: the provider delegates through the session's model registry.
	pi.on("session_start", (_event, ctx) => controller.start(ctx));
	if (config.mode === "off") return;

	pi.on("before_agent_start", () => controller.beginRun());
	pi.on("turn_start", () => controller.onTurnStart());
	pi.on("message_end", (event) => controller.onMessageEnd(event.message));
	pi.on("tool_call", (event) => controller.onToolCall(event));
	pi.on("tool_execution_end", (event) => controller.onToolEnd(event));
	pi.on("turn_end", (event, ctx) => controller.onTurnEnd(event, ctx));
	pi.on("agent_before_settle", (event, ctx) => controller.onBeforeSettle(event, ctx));
	pi.on("session_shutdown", (_event, ctx) => controller.shutdown(ctx));
}
