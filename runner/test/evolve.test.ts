import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { getVariant } from "../src/bench.ts";
import { assertSafetyFloor, evolve, initialProfile, promotionDecision, proposeProfile, type HarnessProfile } from "../src/evolve.ts";
import type { RunRecord, Variant } from "../src/types.ts";
import { tempRunner } from "./helpers.ts";

function profile(): HarnessProfile {
	return initialProfile("test-user", ["t01"], "scripted/toy");
}

function run(pass = true, totalTokens = 100, status: RunRecord["status"] = "done"): RunRecord {
	return { pass, status, usage: { totalTokens } } as Partial<RunRecord> as RunRecord;
}

test("initial profile records scope and owns independent bounded safety policies", () => {
	const parent = profile();
	assert.equal(parent.format, "tapedeck.harness/v1");
	assert.equal(parent.parent, null);
	assert.equal(parent.user, "test-user");
	assert.deepEqual(parent.tasks, ["t01"]);
	assert.equal(parent.model, "scripted/toy");
	assert.ok(parent.id);
	assert.ok(Number.isFinite(Date.parse(parent.createdAt)));
	assert.deepEqual(parent.variant.rules, []);
	assert.deepEqual(parent.variant.tools, ["read", "bash", "edit", "write", "grep", "find", "ls"]);
	assert.deepEqual(parent.variant.context, { maxToolResultChars: 16000 });
	assert.doesNotThrow(() => assertSafetyFloor(parent.variant));
	const independent = profile();
	assert.notEqual(independent.id, parent.id);
	parent.variant.policy!.denyPaths!.pop();
	parent.variant.tools!.pop();
	assert.deepEqual(profile().variant, independent.variant);
});

test("safety floor rejects removal of every immutable deny rule", () => {
	const parent = profile();
	for (const key of ["denyCommands", "denyPaths"] as const) {
		for (const removed of parent.variant.policy![key]!) {
			const variant = structuredClone(parent.variant);
			variant.policy![key] = variant.policy![key]!.filter((rule) => rule !== removed);
			assert.throws(() => assertSafetyFloor(variant), /immutable safety floor missing/);
		}
	}
	const candidate = structuredClone(parent);
	delete candidate.variant.policy;
	assert.throws(() => proposeProfile(candidate, "npm test"), /immutable safety floor missing/);
	assert.throws(() => promotionDecision([run(false)], [run()], [[run(), run()]], parent, candidate), /immutable safety floor missing/);
});

test("trace templates select taskrunner and generated rules without mutating the parent", () => {
	for (const [evidence, template] of [
		["npm test", "rule-taskrunner"], ["npm run check", "rule-taskrunner"],
		["Makefile", "rule-taskrunner"], ["./tasks test", "rule-taskrunner"],
		["src/generated/routes.js", "rule-generated"], ["schema/routes.json", "rule-generated"],
		["generated-file", "rule-generated"],
	]) {
		const parent = profile();
		const before = structuredClone(parent);
		const proposal = proposeProfile(parent, evidence);
		assert.deepEqual(proposal.profile.variant.rules, getVariant(template).rules, evidence);
		assert.ok(proposal.reasons.length > 0);
		assert.equal(proposal.profile.parent, parent.id);
		assert.notEqual(proposal.profile.id, parent.id);
		assert.deepEqual(parent, before);
		assert.doesNotThrow(() => assertSafetyFloor(proposal.profile.variant));
		if (template === "rule-generated") {
			assert.ok(proposal.profile.variant.policy!.denyCommands!.includes("sed\\s+-i.*src/generated/"));
		}
		const repeated = proposeProfile(proposal.profile, evidence);
		assert.deepEqual(repeated.profile.variant.rules, proposal.profile.variant.rules);
		assert.deepEqual(repeated.profile.variant.policy, proposal.profile.variant.policy);
	}
});

test("proposal keeps only observed existing tools and bounds large-trace context", () => {
	const parent = profile();
	parent.variant.tools = ["read", "bash"];
	const evidence = '{"toolName":"read"}\n{"toolName":"write"}\n' + "x".repeat(32001);
	const { profile: candidate } = proposeProfile(parent, evidence);
	assert.deepEqual(candidate.variant.tools, ["read"]);
	assert.equal(candidate.variant.context!.maxToolResultChars, 8000);
	assert.deepEqual(parent.variant.tools, ["read", "bash"]);
	assert.equal(parent.variant.context!.maxToolResultChars, 16000);
	const unrelated = proposeProfile(parent, "unrelated output");
	assert.deepEqual(unrelated.profile.variant, {
		...parent.variant, name: unrelated.profile.variant.name,
	});
});

test("promotion rejects tool authority expansion even when all checks pass", () => {
	const parent = profile();
	parent.variant.tools = ["read"];
	const candidate = structuredClone(parent);
	candidate.variant.tools = ["read", "bash"];
	const decision = promotionDecision([run(false)], [run()], [[run(), run()]], parent, candidate);
	assert.equal(decision.promote, false);
	assert.match(decision.reason, /authority expansion/);
});

test("promotion retains parent guardrails beyond the immutable floor", () => {
	for (const key of ["denyCommands", "denyPaths"] as const) {
		const parent = profile();
		parent.variant.policy![key]!.push("parent-specific-guardrail");
		const candidate = structuredClone(parent);
		candidate.variant.policy![key]!.pop();
		assert.doesNotThrow(() => assertSafetyFloor(candidate.variant));
		const decision = promotionDecision([run(false)], [run()], [[run(), run()]], parent, candidate);
		assert.equal(decision.promote, false);
		assert.match(decision.reason, /Guardrail removal/);
	}
});

test("candidate failures and fork-fresh disagreements reject promotion", () => {
	const parent = profile();
	const candidate = structuredClone(parent);
	for (const [forks, fresh] of [
		[[run(false)], [[run(false), run(false)]]],
		[[run(false)], [[run(), run()]]],
		[[run()], [[run(), run(false)]]],
		[[run(true, 100, "error")], [[run(), run()]]],
		[[run()], [[run(), run(true, 100, "running")]]],
	] as [RunRecord[], RunRecord[][]][]) {
		const decision = promotionDecision([run(false)], forks, fresh, parent, candidate);
		assert.equal(decision.promote, false);
		assert.match(decision.reason, /Every fork and independent fresh verification must pass/);
	}
});

test("incomplete evidence and baseline infrastructure failures reject promotion", () => {
	const parent = profile();
	for (const [baseline, forks, fresh] of [
		[[], [], []], [[run()], [], [[run(), run()]]], [[run()], [run()], []],
		[[run()], [run()], [[]]], [[run()], [run()], [[run()]]],
		[[run(), run()], [run()], [[run(), run()], [run(), run()]]],
	] as [RunRecord[], RunRecord[], RunRecord[][]][]) {
		const decision = promotionDecision(baseline, forks, fresh, parent, structuredClone(parent));
		assert.equal(decision.promote, false);
		assert.match(decision.reason, /Incomplete evaluation evidence/);
	}
	const decision = promotionDecision([run(false, 100, "error")], [run()], [[run(), run()]], parent, structuredClone(parent));
	assert.equal(decision.promote, false);
	assert.match(decision.reason, /Baseline infrastructure failed/);
});

test("all-pass repair promotes while an all-pass tie retains the parent", () => {
	const parent = profile();
	const candidate = structuredClone(parent);
	const repaired = promotionDecision([run(false), run()], [run(), run()], [[run(), run()], [run(), run()]], parent, candidate);
	assert.equal(repaired.promote, true);
	assert.match(repaired.reason, /repaired without evaluation-set regressions/);
	const tied = promotionDecision([run()], [run()], [[run(), run()]], parent, candidate);
	assert.equal(tied.promote, false);
	assert.match(tied.reason, /No measured improvement/);
});

test("tool reduction promotes with passing checks and unchanged token use", () => {
	const parent = profile();
	const candidate = structuredClone(parent);
	candidate.variant.tools = ["read", "bash", "edit"];
	const decision = promotionDecision([run()], [run()], [[run(), run()]], parent, candidate);
	assert.equal(decision.promote, true);
	assert.match(decision.reason, /fewer direct tools/);
});

test("t01 evolution promotes, persists its scope, and strictly replays the persisted fresh variant", async () => {
	const { runner, store, cleanup } = tempRunner({ tape: true, model: "scripted/toy" });
	try {
		const result = await evolve(runner, { user: "evolve-test", tasks: ["t01"], repeat: 2 });
		const report = JSON.parse(readFileSync(result.report, "utf8")) as {
			status: string; parent: HarnessProfile; proposal: { profile: HarnessProfile };
			baseline: RunRecord[]; replays: RunRecord[]; forks: RunRecord[]; fresh: RunRecord[][];
		};
		assert.equal(report.status, "promoted");
		assert.equal(report.baseline.length, 1);
		assert.equal(report.baseline[0].task, "t01");
		assert.equal(report.baseline[0].status, "done");
		assert.equal(report.baseline[0].pass, false);
		assert.equal(report.replays.length, 1);
		const replay = report.replays[0];
		assert.equal(replay.status, "done", replay.error ?? "strict replay failed");
		assert.equal(replay.divergence, null);
		assert.equal(replay.usage.totalTokens, 0);
		assert.equal(replay.steps.live, 0);
		assert.ok(report.baseline[0].steps.total > 0);
		assert.equal(replay.steps.replayed, report.baseline[0].steps.total);
		assert.equal(report.forks.length, 1);
		assert.equal(report.fresh.length, 1);
		assert.equal(report.fresh[0].length, 2);
		for (const evaluated of [...report.forks, ...report.fresh.flat()]) {
			assert.equal(evaluated.status, "done", evaluated.error ?? evaluated.id);
			assert.equal(evaluated.pass, true);
		}
		const candidate = report.proposal.profile;
		const directory = dirname(result.report);
		const scope = createHash("sha256").update(JSON.stringify({ user: "evolve-test", tasks: ["t01"], model: runner.model })).digest("hex").slice(0, 24);
		assert.equal(directory, join(store.home, "reports", "harness", scope));
		assert.deepEqual(JSON.parse(readFileSync(join(directory, "active.json"), "utf8")), candidate);
		assert.deepEqual(JSON.parse(readFileSync(join(directory, `${candidate.id}.profile.json`), "utf8")), candidate);
		assert.equal(candidate.parent, report.parent.id);
		assert.equal(existsSync(join(directory, "evolution.lock")), false);
		const fresh = report.fresh[0][0];
		const persisted = JSON.parse(readFileSync(join(store.runDir(fresh.id), "variant.json"), "utf8")) as Variant;
		assert.deepEqual(persisted, candidate.variant);
		const restored = await runner.replay({ from: fresh.id, variant: persisted.name });
		assert.equal(restored.status, "done", restored.error ?? "promoted replay failed");
		assert.equal(restored.pass, null);
		assert.equal(restored.verify, null);
		assert.equal(restored.divergence, null);
		assert.equal(restored.usage.totalTokens, 0);
		assert.equal(restored.steps.live, 0);
		assert.equal(restored.steps.replayed, fresh.steps.total);
		const activeBefore = readFileSync(join(directory, "active.json"), "utf8");
		const repeated = await evolve(runner, { user: "evolve-test", tasks: ["t01"], repeat: 2 });
		const retained = JSON.parse(readFileSync(repeated.report, "utf8")) as typeof report & {
			decision: { promote: boolean; reason: string };
		};
		assert.equal(dirname(repeated.report), directory);
		assert.equal(retained.status, "rejected");
		assert.equal(retained.decision.promote, false);
		assert.match(retained.decision.reason, /No measured improvement/);
		assert.equal(retained.parent.id, candidate.id);
		assert.deepEqual(retained.parent, candidate);
		assert.equal(retained.proposal.profile.parent, candidate.id);
		for (const evaluated of [...retained.baseline, ...retained.forks, ...retained.fresh.flat()]) {
			assert.equal(evaluated.status, "done", evaluated.error ?? evaluated.id);
			assert.equal(evaluated.pass, true);
		}
		assert.equal(readFileSync(join(directory, "active.json"), "utf8"), activeBefore);
		assert.deepEqual(JSON.parse(readFileSync(join(directory, "active.json"), "utf8")), candidate);
		assert.equal(existsSync(join(directory, "evolution.lock")), false);
	} finally {
		cleanup();
	}
});
