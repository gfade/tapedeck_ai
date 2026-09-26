/** Loads the mini benchmark: tasks (runner/bench/tasks) and variants (runner/bench/variants). */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TASKS_DIR, VARIANTS_DIR } from "./paths.ts";
import type { Task, Variant } from "./types.ts";
import { readJson, UserError } from "./util.ts";

function subdirectories(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
}

function loadTaskFrom(dir: string, id: string): Task {
	const task = readJson<Omit<Task, "dir">>(join(dir, "task.json"));
	const problems: string[] = [];
	if (task.id !== id) problems.push(`id "${task.id}" does not match its directory`);
	if (task.split !== "held-in" && task.split !== "held-out") problems.push(`split must be held-in or held-out`);
	if (!task.prompt) problems.push("prompt is empty");
	if (!task.verify || !existsSync(join(dir, task.verify))) problems.push(`verifier ${task.verify} not found`);
	if (!existsSync(join(dir, "repo"))) problems.push("repo/ is missing");
	if (problems.length > 0) throw new Error(`task ${id}: ${problems.join("; ")}`);
	return { ...task, dir };
}

export function loadTasks(): Task[] {
	return subdirectories(TASKS_DIR)
		.filter((id) => existsSync(join(TASKS_DIR, id, "task.json")))
		.map((id) => loadTaskFrom(join(TASKS_DIR, id), id));
}

export function getTask(id: string): Task {
	const dir = join(TASKS_DIR, id);
	if (!/^[A-Za-z0-9_-]+$/.test(id) || !existsSync(join(dir, "task.json"))) {
		throw new UserError(`unknown task "${id}" (known: ${loadTasks().map((t) => t.id).join(", ")})`);
	}
	return loadTaskFrom(dir, id);
}

/** The public view of a task (GET /api/tasks). */
export function taskSummary(task: Task): Record<string, unknown> {
	const { id, title, split, quirk, prompt, note } = task;
	return note === undefined ? { id, title, split, quirk, prompt } : { id, title, split, quirk, prompt, note };
}

export function variantFile(name: string): string {
	return join(VARIANTS_DIR, name, "variant.json");
}

function checkVariant(variant: Variant, name: string): Variant {
	const problems: string[] = [];
	if (variant.name !== name) problems.push(`name "${variant.name}" does not match its directory`);
	const regexes = [
		...(variant.policy?.denyCommands ?? []),
		...(variant.policy?.denyPaths ?? []),
		...Object.values(variant.fork?.at?.argMatches ?? {}),
		...(variant.fork?.at ? [variant.fork.at.tool] : []),
	];
	for (const source of regexes) {
		try {
			new RegExp(source);
		} catch {
			problems.push(`invalid regex ${JSON.stringify(source)}`);
		}
	}
	if (problems.length > 0) throw new Error(`variant ${name}: ${problems.join("; ")}`);
	return variant;
}

export function loadVariants(): Variant[] {
	return subdirectories(VARIANTS_DIR)
		.filter((name) => existsSync(variantFile(name)))
		.map((name) => checkVariant(readJson<Variant>(variantFile(name)), name));
}

export function getVariant(name: string): Variant {
	if (!/^[A-Za-z0-9_-]+$/.test(name) || !existsSync(variantFile(name))) {
		throw new UserError(`unknown variant "${name}" (known: ${loadVariants().map((v) => v.name).join(", ")})`);
	}
	return checkVariant(readJson<Variant>(variantFile(name)), name);
}
