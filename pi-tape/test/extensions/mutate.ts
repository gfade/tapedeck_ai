/** Test harness change: rewrite the bash command TEST_MUTATE_FROM to TEST_MUTATE_TO in place. */
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";

export default function mutate(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (isToolCallEventType("bash", event) && event.input.command === process.env.TEST_MUTATE_FROM) {
			event.input.command = process.env.TEST_MUTATE_TO ?? "";
		}
	});
}
