import { habit } from "../../toy-lib.mjs";

export default habit({
	read: ["src/sum.js"],
	fix: { path: "src/sum.js", oldText: "a - b", newText: "a + b", say: "sum() subtracts instead of adding." },
	done: "sum() now adds",
});
