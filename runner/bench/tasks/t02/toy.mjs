import { habit } from "../../toy-lib.mjs";

export default habit({
	read: ["src/router.js", "src/generated/routes.js"],
	fix: {
		path: "src/generated/routes.js",
		oldText: 'path: "/helth"',
		newText: 'path: "/health"',
		say: "The route table has a typo: /helth instead of /health.",
	},
	schema: {
		path: "schema/routes.json",
		oldText: '"path": "/helth"',
		newText: '"path": "/health"',
		say: "Fixing the /helth typo in the schema.",
	},
	generator: "node scripts/gen.mjs",
	done: "GET /health is routed",
});
