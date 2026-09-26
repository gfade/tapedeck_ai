/**
 * The habit engine behind the toy agents (tasks/<id>/toy.mjs).
 *
 * A toy agent is a deterministic stand-in for a model with habits. It never plans ahead:
 * on every request it looks at what it has done so far (its own tool calls and their
 * results) and at the rules in the system prompt, and picks the next move:
 *
 *   setup   run the setup that AGENTS.md documents, first thing, if a rule says so
 *   look    `ls`
 *   read    read the files its habit reads, in order
 *   fix     edit the file (or, when a rule forbids editing generated files, edit the
 *           schema instead and run the generator)
 *   test    run the tests: `npm test` by habit, or the repo's task runner (./tasks test,
 *           make test) when a rule says to use the task runner
 *   react   tests pass → report success; tests fail → revert the fix, then give up
 *
 * Because the state comes from the history rather than the step number, the toy
 * continues sensibly from any prefix, including a prefix replayed from another run's
 * tape (a fork).
 */

const RULES = /<tapedeck-rules>\n?([\s\S]*?)\n?<\/tapedeck-rules>/;
const PROJECT_CONTEXT = /<project_context>([\s\S]*?)<\/project_context>/;
const TEST_COMMANDS = ["npm test", "./tasks test", "make test"];
const MAX_STEPS = 25;

/** Text of the tapedeck-rules prompt section, or "". */
export function readRules(systemPrompt) {
	return RULES.exec(systemPrompt)?.[1] ?? "";
}

/** The one-time setup command that the project instructions (AGENTS.md) document, if any. */
function documentedSetup(systemPrompt) {
	const context = PROJECT_CONTEXT.exec(systemPrompt)?.[1] ?? "";
	return /`((?:make|\.\/tasks) setup)`/.exec(context)?.[1] ?? null;
}

/** The test command of the repo's task runner, judged from an `ls` listing. */
function taskRunner(listing) {
	const names = listing.split("\n").map((line) => line.trim());
	if (names.includes("tasks")) return "./tasks test";
	if (names.includes("Makefile")) return "make test";
	return null;
}

/** Every tool call made so far, oldest first, with its result. */
function toolHistory(messages) {
	const results = new Map();
	for (const m of messages) if (m.role === "toolResult") results.set(m.toolCallId, m);
	const calls = [];
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const call of m.toolCalls) {
			const result = results.get(call.id);
			calls.push({ name: call.name, args: call.arguments ?? {}, ok: result ? !result.isError : false, text: result?.text ?? "" });
		}
	}
	return calls;
}

const bash = (command) => ({ name: "bash", arguments: { command } });
const read = (path) => ({ name: "read", arguments: { path } });
const edit = (path, oldText, newText) => ({ name: "edit", arguments: { path, edits: [{ oldText, newText }] } });

function isEdit(call, path, oldText, newText) {
	const e = call.args.edits?.[0];
	return call.name === "edit" && call.args.path === path && e?.oldText === oldText && e?.newText === newText;
}

function lastIndex(calls, predicate) {
	for (let i = calls.length - 1; i >= 0; i--) if (predicate(calls[i])) return i;
	return -1;
}

/**
 * Builds a toy agent for one task.
 *
 * @param {object} task
 * @param {string[]} task.read    files read before fixing, in order
 * @param {{path:string, oldText:string, newText:string, say:string}} task.fix  the habitual fix
 * @param {{path:string, oldText:string, newText:string, say:string}} [task.schema]
 *        for generated-file tasks: the fix in the schema, used when a rule forbids editing
 *        files under src/generated/
 * @param {string} [task.generator] command that regenerates src/generated/ from the schema
 * @param {string} task.done      what the success message says was fixed
 */
export function habit(task) {
	return function respond(req) {
		if (req.step > MAX_STEPS) return { text: "Stopping: this is taking too many steps." };

		const rules = readRules(req.systemPrompt);
		const useTaskRunner = /task runner/i.test(rules);
		const protectGenerated = /src\/generated\//.test(rules) && /never edit/i.test(rules);
		const calls = toolHistory(req.messages);
		const done = (predicate) => calls.some(predicate);

		// setup: only as the very first move, and only when a rule asks for it.
		if (calls.length === 0 && useTaskRunner && /setup/i.test(rules)) {
			const setup = documentedSetup(req.systemPrompt);
			if (setup) return { text: `AGENTS.md documents a setup step; running it first.`, toolCalls: [bash(setup)] };
		}

		// look
		const listing = calls.find((c) => c.name === "bash" && c.args.command === "ls");
		if (!listing) return { text: "Let me look at the repository.", toolCalls: [bash("ls")] };

		// read
		for (const path of task.read) {
			if (!done((c) => c.name === "read" && c.args.path === path)) return { toolCalls: [read(path)] };
		}

		// fix
		const viaSchema = protectGenerated && task.schema !== undefined;
		const fix = viaSchema ? task.schema : task.fix;
		if (viaSchema && !done((c) => c.name === "read" && c.args.path === fix.path)) {
			return { text: `${task.fix.path} is generated; the change belongs in ${fix.path}.`, toolCalls: [read(fix.path)] };
		}
		const fixAt = lastIndex(calls, (c) => isEdit(c, fix.path, fix.oldText, fix.newText));
		if (fixAt < 0) return { text: fix.say, toolCalls: [edit(fix.path, fix.oldText, fix.newText)] };
		if (!calls[fixAt].ok) return { text: `My edit to ${fix.path} did not apply, so I am stopping here.` };
		if (viaSchema) {
			const genAt = lastIndex(calls, (c) => c.name === "bash" && c.args.command === task.generator);
			if (genAt < fixAt) return { toolCalls: [bash(task.generator)] };
			if (!calls[genAt].ok) return { text: `${task.generator} failed, so I am stopping here.` };
		}

		// test
		const command = (useTaskRunner && taskRunner(listing.text)) || "npm test";
		const testAt = lastIndex(calls, (c) => c.name === "bash" && TEST_COMMANDS.includes(c.args.command));
		if (testAt < fixAt) return { toolCalls: [bash(command)] };

		// react
		const test = calls[testAt];
		if (test.ok) return { text: `Fixed: ${task.done}, and \`${test.args.command}\` passes.` };
		const revertAt = lastIndex(calls, (c) => isEdit(c, fix.path, fix.newText, fix.oldText));
		if (revertAt < testAt) {
			return { text: "The test command fails, so I reverted my change to be safe.", toolCalls: [edit(fix.path, fix.newText, fix.oldText)] };
		}
		return { text: `I could not get the tests to pass: \`${test.args.command}\` fails.` };
	};
}
