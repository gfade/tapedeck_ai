/**
 * The harness extension (runner/harness/variant.ts) inside real pi runs, driven by a probe
 * model: vanilla is invisible, rules add one prompt section, the policy blocks calls.
 */

import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { variantFile } from "../src/bench.ts";
import { HARNESS_EXTENSION, piPackage, SCRIPTED_EXTENSION } from "../src/paths.ts";
import { launchPi, piEnv } from "../src/pi.ts";
import { readBranch } from "../src/tape.ts";
import { tempDir } from "./helpers.ts";

const PROBE_MODEL = join(import.meta.dirname, "fixtures", "probe-model.mjs");
const CANARY = "canary-probe-5e1f";
const scratch = tempDir("variant");
after(() => scratch.cleanup());

const workspace = join(scratch.dir, "ws");
mkdirSync(join(workspace, "config"), { recursive: true });
writeFileSync(join(workspace, ".env"), `TOKEN=${CANARY}\n`);
writeFileSync(join(workspace, "config", ".env"), `TOKEN=${CANARY}\n`);
writeFileSync(join(workspace, "README.md"), "# probe\n");

let counter = 0;

/** Runs pi with the probe model; returns the messages of its session. */
async function probe(opts: { variant?: string; extension?: boolean; calls?: unknown[] }): Promise<Record<string, any>[]> {
	const dir = join(scratch.dir, `pi-${counter++}`);
	mkdirSync(dir);
	const extensions = [SCRIPTED_EXTENSION, ...(opts.extension === false ? [] : [HARNESS_EXTENSION])];
	const args = [piPackage().cli, "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"];
	args.push("--session-dir", join(dir, "sessions"), "--model", "scripted/toy", ...extensions.flatMap((e) => ["-e", e]), "--", "probe");
	const exit = await launchPi({
		args,
		cwd: workspace,
		env: piEnv({
			PI_CODING_AGENT_DIR: join(dir, "agent"),
			PI_SCRIPTED_MODEL: PROBE_MODEL,
			PROBE_CALLS: JSON.stringify(opts.calls ?? []),
			...(opts.variant ? { TAPEDECK_VARIANT: variantFile(opts.variant) } : {}),
		}),
		eventsFile: join(dir, "events.jsonl"),
		stderrFile: join(dir, "stderr.log"),
		timeoutMs: 60_000,
	});
	assert.equal(exit.code, 0, "pi exits cleanly");
	const [session] = readdirSync(join(dir, "sessions"));
	return readBranch(join(dir, "sessions", session))
		.filter((e) => e.type === "message")
		.map((e) => e.message as Record<string, any>);
}

function systemMessage(messages: Record<string, any>[]): Record<string, any> {
	const { timestamp: _ignored, ...system } = messages.find((m) => m.role === "system") ?? {};
	return system;
}

test("vanilla leaves the system message byte-identical to pi without the extension", async () => {
	const plain = systemMessage(await probe({ extension: false }));
	const vanilla = systemMessage(await probe({ variant: "vanilla" }));
	assert.ok(plain.sections, "pi records prompt sections");
	assert.equal(JSON.stringify(vanilla), JSON.stringify(plain));
});

test("rules become one tapedeck-rules section; nothing else changes", async () => {
	const plain = systemMessage(await probe({ extension: false }));
	const ruled = systemMessage(await probe({ variant: "rule-taskrunner" }));
	const { "tapedeck-rules": rules, ...others } = ruled.sections;
	assert.match(rules, /^<tapedeck-rules>\n- If the repository has a task runner .*\n<\/tapedeck-rules>$/);
	assert.deepEqual(others, plain.sections);
	assert.deepEqual(ruled.toolsAdded, plain.toolsAdded, "tool declarations are untouched");
});

test("the guard policy blocks .env reads and downloads, and lets other calls run", async () => {
	const commands = ["cat .env", "grep TOKEN config/.env | head -1", "curl -s http://example.com", "wget -q http://example.com", "cat README.md", "ls"];
	const calls = [...commands.map((command) => ({ name: "bash", arguments: { command } })), { name: "read", arguments: { path: ".env" } }];
	const results = (await probe({ variant: "guard-secrets", calls })).filter((m) => m.role === "toolResult");
	const text = (m: Record<string, any>) => m.content.map((b: { text?: string }) => b.text ?? "").join("");
	const outcome = results.map((m) => (text(m).startsWith("Blocked by tapedeck policy: ") ? "blocked" : "ran"));
	assert.deepEqual(outcome, ["blocked", "blocked", "blocked", "blocked", "ran", "ran", "blocked"]);
	assert.ok(results.slice(0, 4).every((m) => m.isError), "blocked calls are errors");
	assert.match(text(results[0]), /^Blocked by tapedeck policy: denyPaths /);
	assert.match(text(results[2]), /^Blocked by tapedeck policy: denyCommands /);
	assert.ok(!results.some((m) => text(m).includes(CANARY)), "the secret never reaches the model");
});
