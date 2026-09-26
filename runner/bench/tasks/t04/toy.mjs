import { habit } from "../../toy-lib.mjs";

export default habit({
	read: ["src/slug.js"],
	fix: {
		path: "src/slug.js",
		oldText: '.replace(/\\s+/g, "-")',
		newText: '.replace(/[^a-z0-9\\s-]/g, "").replace(/\\s+/g, "-")',
		say: "slugify() keeps punctuation; it should drop it before joining words.",
	},
	done: "slugify() drops punctuation",
});
