/**
 * Canonical JSON and hashing (INTERFACES §2.4 step 3).
 *
 * Canonical JSON: object keys sorted (JavaScript's default string order), arrays in order,
 * no whitespace, numbers and strings as `JSON.stringify` writes them. Like `JSON.stringify`,
 * object properties whose value is `undefined` or a function are dropped and such array
 * elements become `null`.
 */

import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => (isOmitted(item) ? "null" : canonicalJson(item))).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record)
		.filter((key) => !isOmitted(record[key]))
		.sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isOmitted(value: unknown): boolean {
	return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/** Lowercase hex SHA-256 of a string's UTF-8 bytes. */
export function sha256Hex(text: string | Uint8Array): string {
	return createHash("sha256").update(text).digest("hex");
}

/** `requestHash` of a normalized request: SHA-256 of its canonical JSON. */
export function requestHash(messages: readonly unknown[]): string {
	return sha256Hex(canonicalJson(messages));
}

/** Deep equality under canonical JSON. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}
