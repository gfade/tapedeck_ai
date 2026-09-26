// Calls the `hello` tool of test/extensions/hello-tool.ts once, then finishes.
export default function hello(req) {
	if (req.step === 1) return { toolCalls: [{ name: "hello", arguments: { name: "tape" } }] };
	return { text: "Said hello." };
}
