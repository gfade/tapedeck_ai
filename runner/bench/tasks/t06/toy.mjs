import { habit } from "../../toy-lib.mjs";

export default habit({
	read: ["src/words.js"],
	fix: {
		path: "src/words.js",
		oldText: 'return text.split(" ").length;',
		newText: "return text.split(/\\s+/).filter(Boolean).length;",
		say: "wordCount() splits on single spaces, so empty strings and repeated spaces are miscounted.",
	},
	done: "wordCount() counts words separated by any whitespace",
});
