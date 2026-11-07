#!/usr/bin/env node
// Fails when the browser build holds anything meant for the server only
// (D05, docs/discover/frontend.md). Runs after `vite build` (the `build`
// script) and alone as `pnpm check:bundle`. A server-only name in the
// browser bundle means a module that reads process.env or parses the
// settings was pulled into code the browser runs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/** Text that exists only in server code: the settings' names and their parser. */
const SERVER_ONLY = [
	"API_URL",
	"MEDIA_URL",
	"DISCOVER_URL",
	"DISCOVER_INDEXING",
	"DISCOVER_MARKETS",
	"DISCOVER_DEFAULT_COUNTRY",
	"DISCOVER_GEO_HEADER",
	"getRequest",
	"APP_URL",
	"parseDiscoverConfig",
	"discoverConfig",
	"process.env",
	"Discover's settings are incomplete",
];

/**
 * Text the browser build must hold: the SDK's own timeout message. Without
 * it this is not the browser build, and "no server-only text" proves nothing.
 */
const REQUIRED = ["did not answer in time"];

const TEXT_FILES = new Set([
	".js",
	".mjs",
	".css",
	".html",
	".json",
	".map",
	".txt",
	".svg",
]);

function main() {
	const root = resolve(import.meta.dirname, "..");
	const dir = resolve(process.argv[2] ?? join(root, ".output/public"));
	if (!existsSync(dir))
		fail(["There is no browser output to check. Run pnpm build first."]);

	const contents = textFiles(dir).map((file) => ({
		name: relative(dir, file),
		text: readFileSync(file, "utf8"),
	}));
	const problems = [];
	for (const name of SERVER_ONLY) {
		for (const file of contents) {
			if (file.text.includes(name))
				problems.push(`${file.name} contains server-only text "${name}".`);
		}
	}
	for (const name of REQUIRED) {
		if (!contents.some((file) => file.text.includes(name))) {
			problems.push(
				`No file holds "${name}": ${dir} is not the browser build, so the check proves nothing.`,
			);
		}
	}
	if (problems.length > 0) fail(problems);
	console.log(
		`Client bundle check: ${contents.length} files, no server-only text.`,
	);
}

function textFiles(dir) {
	const found = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) found.push(...textFiles(path));
		else if (TEXT_FILES.has(extname(path))) found.push(path);
	}
	return found;
}

function fail(problems) {
	console.error(
		`Client bundle check failed (docs/discover/frontend.md):\n${problems.map((p) => `- ${p}`).join("\n")}`,
	);
	process.exit(1);
}

main();
