import { habit } from "../../toy-lib.mjs";

export default habit({
	read: ["src/errors.js", "src/generated/messages.js"],
	fix: {
		path: "src/generated/messages.js",
		oldText: "timed out afer",
		newText: "timed out after",
		say: "The E_TIMEOUT message has the typo.",
	},
	schema: {
		path: "schema/messages.json",
		oldText: "timed out afer",
		newText: "timed out after",
		say: "Fixing the typo in the schema.",
	},
	generator: "node scripts/gen.mjs",
	done: "the E_TIMEOUT message says \"after\"",
});
