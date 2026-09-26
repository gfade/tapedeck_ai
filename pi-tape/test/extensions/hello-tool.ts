/** A custom tool pi-tape cannot stub. Each execution appends a line to TEST_HELLO_LOG. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function helloTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "hello",
		label: "hello",
		description: "Say hello to someone.",
		parameters: Type.Object({ name: Type.String({ description: "Who to greet" }) }),
		async execute(_toolCallId, params) {
			appendFileSync(process.env.TEST_HELLO_LOG ?? "/dev/null", `hello ${params.name}\n`);
			return { content: [{ type: "text", text: `hello ${params.name}` }], details: undefined };
		},
	});
}
