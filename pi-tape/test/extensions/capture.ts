/**
 * Test provider `capture/toy`: the scripted model, plus a record of every request it gets.
 * Each request appends `{cwd, piDir, messages}` as one JSON line to TEST_CAPTURE_FILE.
 */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { streamScripted } from "../../extensions/scripted.ts";

export default function capture(pi: ExtensionAPI) {
	pi.registerProvider("capture", {
		baseUrl: "http://127.0.0.1:9",
		apiKey: "capture-offline",
		api: "tapedeck-capture",
		models: [
			{
				id: "toy",
				name: "Capturing toy model",
				reasoning: false,
				input: ["text"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
		],
		streamSimple: (model, context, options) => {
			const file = process.env.TEST_CAPTURE_FILE;
			if (file) appendFileSync(file, `${JSON.stringify({ cwd: process.cwd(), piDir: getPackageDir(), messages: context.messages })}\n`);
			return streamScripted(model, context, options);
		},
	});
}
