import { habit } from "../../toy-lib.mjs";

export default habit({
	read: ["src/clamp.js"],
	fix: {
		path: "src/clamp.js",
		oldText: "return Math.max(lo, x);",
		newText: "return Math.min(hi, Math.max(lo, x));",
		say: "clamp() never applies the upper bound.",
	},
	done: "clamp() applies both bounds",
});
