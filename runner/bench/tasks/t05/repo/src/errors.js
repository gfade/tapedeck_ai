import { messages } from "./generated/messages.js";

/** Formats the message for an error code, filling {placeholders} from params. */
export function formatError(code, params = {}) {
  const template = messages[code];
  if (!template) return `Unknown error ${code}`;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}
