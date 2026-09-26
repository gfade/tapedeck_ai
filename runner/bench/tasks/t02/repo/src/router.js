import { routes } from "./generated/routes.js";

/** Returns the handler name for a request, or null when no route matches. */
export function match(method, path) {
  const route = routes.find((r) => r.method === method && r.path === path);
  return route ? route.handler : null;
}
