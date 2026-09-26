// Uses the read-only built-in tools (run pi with `--tools read,grep,ls`): ls, grep, read, finish.
export default function search(req) {
	switch (req.step) {
		case 1:
			return { toolCalls: [{ name: "ls", arguments: { path: "." } }] };
		case 2:
			return { toolCalls: [{ name: "grep", arguments: { pattern: "app", path: "src" } }] };
		case 3:
			return { toolCalls: [{ name: "read", arguments: { path: "src/app.js" } }] };
		default:
			return { text: "Found it." };
	}
}
