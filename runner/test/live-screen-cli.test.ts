import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const script = new URL("../../demo/live-screen.ts", import.meta.url);

test("CLI help exits without creating evidence or requiring a model", () => {
	const directory = mkdtempSync(join(tmpdir(), "tapedeck-cli-"));
	try {
		const output = join(directory, "evidence");
		const result = spawnSync(process.execPath, [script.pathname, "--cli", "--help", "--output", output], { encoding: "utf8", timeout: 15000 });
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /CLI exits 0/);
		assert.equal(existsSync(output), false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("CLI rejects recording triggers before running", () => {
	const result = spawnSync(process.execPath, [script.pathname, "--cli", "--start-file", "unused-trigger"], { encoding: "utf8", timeout: 15000 });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /--cli cannot be combined with --start-file/);
});

test("CLI retains failed evidence and exits nonzero when Ollama is unavailable", () => {
	const directory = mkdtempSync(join(tmpdir(), "tapedeck-cli-"));
	try {
		const preload = join(directory, "offline.mjs");
		const output = join(directory, "evidence");
		writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("Ollama offline test"); };');
		const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, script.pathname, "--cli", "--output", output], { encoding: "utf8", timeout: 15000 });
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stdout, /Ollama offline test/);
		assert.equal(JSON.parse(readFileSync(join(output, "result.json"), "utf8")).status, "error");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
