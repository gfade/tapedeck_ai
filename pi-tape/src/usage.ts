/** Usage totals as the report (§2.7) and run.json (§5.2) carry them. */

import type { UsageTotals } from "./types.ts";

export function emptyUsageTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { total?: number } | number;
}

/** Add a pi usage object (whose `cost` is a breakdown with `total`) to running totals. */
export function addUsage(totals: UsageTotals, usage: UsageLike | null | undefined): UsageTotals {
	if (!usage) return totals;
	const cost = typeof usage.cost === "number" ? usage.cost : (usage.cost?.total ?? 0);
	return {
		input: totals.input + (usage.input ?? 0),
		output: totals.output + (usage.output ?? 0),
		cacheRead: totals.cacheRead + (usage.cacheRead ?? 0),
		cacheWrite: totals.cacheWrite + (usage.cacheWrite ?? 0),
		totalTokens: totals.totalTokens + (usage.totalTokens ?? 0),
		cost: totals.cost + cost,
	};
}

/** Sum pi usage objects. The dollar total is rounded to 10 decimals to drop float noise. */
export function sumUsage(usages: Iterable<UsageLike | null | undefined>): UsageTotals {
	let totals = emptyUsageTotals();
	for (const usage of usages) totals = addUsage(totals, usage);
	return { ...totals, cost: Number(totals.cost.toFixed(10)) };
}
