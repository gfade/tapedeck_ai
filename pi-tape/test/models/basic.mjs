// A four-step run for the scripted model (INTERFACES §6):
//   1. say where we are and run `ls && pwd` (so the cwd shows up in text and tool output)
//   2. write notes.txt and read README.md in one response (a parallel batch)
//   3. read notes.txt back with bash
//   4. finish
// When the system prompt contains RULE-X, step 4 writes fixed.txt and step 5 finishes: a
// harness change that makes the model behave differently (used by the fork tests).
export default function basic(req) {
	const ruled = req.systemPrompt.includes("RULE-X");
	switch (req.step) {
		case 1:
			return { text: `Working in ${req.cwd}.`, toolCalls: [{ name: "bash", arguments: { command: "ls && pwd" } }] };
		case 2:
			return {
				toolCalls: [
					{ name: "write", arguments: { path: "notes.txt", content: "note\n" } },
					{ name: "read", arguments: { path: "README.md" } },
				],
			};
		case 3:
			return { toolCalls: [{ name: "bash", arguments: { command: "cat notes.txt" } }] };
		case 4:
			return ruled ? { toolCalls: [{ name: "bash", arguments: { command: "echo fixed > fixed.txt" } }] } : { text: "Done." };
		default:
			return { text: ruled ? "Fixed." : "Done." };
	}
}
