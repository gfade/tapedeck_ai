/**
 * PI_SCRIPTED_MODEL for tests: at step 1 makes the tool calls listed (as JSON) in
 * PROBE_CALLS, then answers "done".
 */
export default function respond(req) {
	if (req.step === 1) return { text: "probing", toolCalls: JSON.parse(req.env.PROBE_CALLS ?? "[]") };
	return { text: "done" };
}
