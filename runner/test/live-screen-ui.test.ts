import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../../demo/live-screen.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function element() {
	return {
		textContent: "", disabled: false, className: "", scrollHeight: 500, scrollTop: 180, clientHeight: 320,
		children: [] as unknown[], replacements: 0,
		append(child: unknown) { this.children.push(child); },
		replaceChildren(...children: unknown[]) { this.children = children; this.replacements++; },
	};
}

test("terminal renders real results, stable scrollback, elapsed time and disconnected status", async () => {
	const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], element()]));
	const timers: (() => void)[] = [];
	const intervals: (() => void)[] = [];
	let offline = false;
	const payload = {
		status: "complete", phase: "Proof complete", triggerMode: false, decision: "promoted",
		startedAt: "2026-09-26T20:00:00.000Z", finishedAt: "2026-09-26T20:00:41.000Z",
		replayCalls: 0, providerCalls: 16, tools: { before: ["read", "bash", "write"], after: ["read", "bash"] },
		task: { failure: "sum(2,3) = -1", fix: "return a + b", command: "./tasks test" },
		logs: [{ text: "PASS <script>not executable</script>" }],
		runs: [{ label: "Repair fixture", kind: "fork", status: "done", pass: true, tokens: 10 }],
		atlas: { status: "verified", payloads: 497, runs: 32, snapshot: "snapshot-id" },
	};
	runInNewContext(script, {
		document: { getElementById: (id: string) => elements.get(id), createElement: element },
		fetch: async () => { if (offline) throw new Error("offline"); return { json: async () => payload }; },
		setTimeout: (callback: () => void) => timers.push(callback),
		setInterval: (callback: () => void) => intervals.push(callback),
	});
	await new Promise(setImmediate);
	intervals[0]();
	assert.equal(elements.get("clock")!.textContent, "00:41 · COMPLETE");
	assert.equal(elements.get("start")!.textContent, "Demo complete");
	assert.equal(elements.get("start")!.disabled, true);
	assert.equal(elements.get("atlas-title")!.textContent, "497/497 payload checks PASS");
	const terminal = elements.get("terminal")!;
	assert.equal((terminal.children[0] as { textContent: string }).textContent, payload.logs[0].text);
	terminal.scrollTop = 0;
	timers.shift()!();
	await new Promise(setImmediate);
	assert.equal(terminal.replacements, 1);
	assert.equal(terminal.scrollTop, 0);
	payload.logs.push({ text: "new output" });
	timers.shift()!();
	await new Promise(setImmediate);
	assert.equal(terminal.replacements, 2);
	assert.equal(terminal.scrollTop, 0);
	offline = true;
	timers.shift()!();
	await new Promise(setImmediate);
	assert.equal(elements.get("connection")!.textContent, "disconnected");
	assert.equal(elements.get("stream-label")!.textContent, "connection lost");
	assert.equal(elements.get("start")!.disabled, true);
	assert.match(elements.get("phase")!.textContent, /historical/);
	assert.equal(timers.length, 1);
});
