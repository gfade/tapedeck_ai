/** Test harness change: block bash commands matching TEST_GUARD_PATTERN (a regex). */
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";

export default function guard(pi: ExtensionAPI) {
	const pattern = new RegExp(process.env.TEST_GUARD_PATTERN ?? "$^");
	pi.on("tool_call", (event) => {
		if (isToolCallEventType("bash", event) && pattern.test(event.input.command)) {
			return { block: true, reason: `Blocked by test guard: ${event.input.command}` };
		}
		return undefined;
	});
}
