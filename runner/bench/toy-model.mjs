/**
 * PI_SCRIPTED_MODEL module for the bench (INTERFACES.md §6): answers each request with the
 * toy agent of the task named by TAPEDECK_TASK (tasks/<id>/toy.mjs).
 */

export default async function respond(req) {
	const task = req.env.TAPEDECK_TASK;
	if (!task || !/^[A-Za-z0-9_-]+$/.test(task)) {
		return { text: `toy-model: TAPEDECK_TASK is ${task ? `invalid (${task})` : "not set"}.` };
	}
	const toy = await import(new URL(`./tasks/${task}/toy.mjs`, import.meta.url).href);
	return toy.default(req);
}
