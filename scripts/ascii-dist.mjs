// Rewrites every non-ASCII character in the built files as an escape (\uXXXX), so the plugin
// works however the server labels the files' code page. Some SAP systems serve uploaded
// JavaScript as Thai (TIS-620) or another code page: then "×" shows up as "ร" plus a box.
// Runs after `ui5 build` (see "build" in package.json).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || "dist";
let changed = 0;

function escapeJs(s) {
	return s.replace(/[^\x00-\x7f]/gu, (c) => {
		const cp = c.codePointAt(0);
		if (cp <= 0xffff) return "\\u" + cp.toString(16).padStart(4, "0");
		return "\\u{" + cp.toString(16) + "}";
	});
}
function escapeCss(s) {
	return s.replace(/[^\x00-\x7f]/gu, (c) => "\\" + c.codePointAt(0).toString(16) + " ");
}

(function walk(dir) {
	for (const name of readdirSync(dir)) {
		const file = path.join(dir, name);
		if (statSync(file).isDirectory()) {
			walk(file);
			continue;
		}
		const ext = path.extname(name);
		if (![".js", ".json", ".css"].includes(ext)) continue;
		const before = readFileSync(file, "utf8");
		const after = ext === ".css" ? escapeCss(before) : escapeJs(before);
		if (after !== before) {
			writeFileSync(file, after);
			changed++;
		}
	}
})(ROOT);
console.log(`ascii-dist: escaped non-ASCII characters in ${changed} file(s) under ${ROOT}`);
