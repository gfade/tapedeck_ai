import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { restoreArchive } from "../src/archive.ts";
import { REPO_ROOT } from "../src/paths.ts";
import { Runner } from "../src/runs.ts";
import { createApiServer } from "../src/server.ts";
import { Store } from "../src/store.ts";

const execute = promisify(execFile);
const vm = process.env.PHARO_VM ?? join(REPO_ROOT, "image/pharo/pharo");
const baseImage = process.env.TAPEDECK_BASE_IMAGE ?? join(REPO_ROOT, "image/pharo/TapeDeck.image");

test("Agent.image survives original-store deletion, restores binary files, and reconnects for a live comparison", { timeout: 180000 }, async () => {
	assert.ok(existsSync(vm) && existsSync(baseImage), "Run npm run test:image first, or set PHARO_VM and TAPEDECK_BASE_IMAGE.");
	const scratch = mkdtempSync(join(realpathSync(tmpdir()), "tapedeck-agent-image-"));
	const store = Store.open(join(scratch, "original-store"));
	const runner = new Runner({ store, model: "scripted/toy" });
	const server = createApiServer(runner);
	let restoredServer: ReturnType<typeof createApiServer> | undefined;
	const savedToken = process.env.TAPEDECK_API_TOKEN;
	try {
		process.env.TAPEDECK_API_TOKEN = "image-roundtrip-test-token";
		const baseline = await runner.run({ task: "t01", variant: "vanilla" });
		const fork = await runner.fork({ from: baseline.id, variant: "rule-taskrunner", auto: true });
		assert.equal(fork.pass, true, fork.error ?? "fork failed");
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const image = join(scratch, "Agent.image");
		const environment = { ...process.env, TAPEDECK_RUNNER_URL: address, TAPEDECK_BASE_IMAGE: baseImage, PHARO_VM: vm };
		await execute("bash", [join(REPO_ROOT, "image/scripts/save-agent.sh"), image], { cwd: REPO_ROOT, env: environment, maxBuffer: 8 * 1024 * 1024 });
		assert.ok(existsSync(image));
		const archive = JSON.parse(readFileSync(join(scratch, "Agent.archive.json"), "utf8"));
		assert.equal(archive.format, "tapedeck.archive/v1");
		assert.ok(archive.files.some((file: { path: string }) => file.path === `snapshots/${fork.id}/src/sum.js`));
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(store.home, { recursive: true, force: true });
		const reload = await execute(vm, [image, "eval", "(TdAgentImage current store size = 2 and: [ TdAgentImage current lastError isNil ]) ifFalse: [ Smalltalk exit: 1 ]. Stdio stdout nextPutAll: 'IMAGE_RELOADED'; lf"], { env: environment, cwd: scratch });
		assert.match(reload.stdout, /IMAGE_RELOADED/);
		const recovered = join(scratch, "Agent.files", "snapshots", fork.id, "src/sum.js");
		assert.ok(existsSync(recovered));
		assert.match(readFileSync(recovered, "utf8"), /a \+ b/);
		assert.ok(existsSync(join(scratch, "Agent.files/git-bundles/t01.bundle")));
		const restored = await restoreArchive(archive, join(scratch, "restored-store"));
		restoredServer = createApiServer(new Runner({ store: restored }));
		await new Promise<void>((resolve) => restoredServer!.listen(0, "127.0.0.1", resolve));
		const restoredUrl = `http://127.0.0.1:${(restoredServer.address() as AddressInfo).port}`;
		const compared = await execute(vm, [image, "eval", `| report | report := TdAgentImage current compareRun: '${baseline.id}' variant: 'rule-taskrunner' model: 'scripted/toy'. ((report at: 'status') = 'done' and: [ TdAgentImage current store size >= 5 ]) ifFalse: [ Smalltalk exit: 1 ]. Stdio stdout nextPutAll: 'LIVE_COMPARISON_IMPORTED'; lf`], { env: { ...environment, TAPEDECK_RUNNER_URL: restoredUrl }, cwd: scratch, maxBuffer: 8 * 1024 * 1024 });
		assert.match(compared.stdout, /LIVE_COMPARISON_IMPORTED/);
		assert.ok(restored.listRuns().length >= 5);
	} finally {
		if (savedToken === undefined) delete process.env.TAPEDECK_API_TOKEN;
		else process.env.TAPEDECK_API_TOKEN = savedToken;
		if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
		if (restoredServer?.listening) await new Promise<void>((resolve) => restoredServer!.close(() => resolve()));
		rmSync(scratch, { recursive: true, force: true });
	}
});
