#!/usr/bin/env node
// Fails when the browser build holds anything meant for the server only
// (TAT-23, spec ruling 8). Runs after `vite build` (see the `build` script)
// and on its own as `pnpm check:bundle`. A server-only name in the browser
// bundle means a module that reads the settings or the server key was pulled
// into code the browser runs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/**
 * Text that exists only in server code: the settings and the key, the tenant
 * middleware and its pages and log line. Each is in the server output of the
 * current build, and none is in the browser's.
 */
const SERVER_ONLY = [
	"STOREFRONT_SERVER_KEY",
	"STOREFRONT_URL",
	"API_URL",
	"serverKey",
	"requestStudio",
	"storefrontConfig",
	"parseStorefrontConfig",
	"tenantMiddleware",
	"handleTenantRequest",
	"lookUpTenant",
	"process.env",
	"Studio lookup failed",
	"Studio not found",
	"The storefront's settings",
	"s-maxage=60",
];

/**
 * Text the browser build must hold: the SDK's own timeout message. If it is
 * missing, this was not the browser build, and "no server-only text" proves
 * nothing.
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
	".webmanifest",
]);

/** Where `vite build` writes what the browser gets (Nitro's node-server, then Vercel's preset). */
const OUTPUT_DIRS = [".output/public", ".vercel/output/static"];

function main() {
	const root = resolve(import.meta.dirname, "..");
	const given = process.argv[2];
	const dir = given
		? resolve(given)
		: OUTPUT_DIRS.map((path) => join(root, path)).find((path) =>
				existsSync(path),
			);
	if (!dir || !existsSync(dir)) {
		fail(["There is no browser output to check. Run pnpm build first."]);
	}

	const files = textFiles(dir);
	const contents = files.map((file) => ({
		name: relative(dir, file),
		text: readFileSync(file, "utf8"),
	}));
	const problems = [];
	for (const name of SERVER_ONLY) {
		for (const file of contents) {
			if (file.text.includes(name)) {
				problems.push(`${file.name} contains server-only text "${name}".`);
			}
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
		`Client bundle check: ${contents.length} files in ${relative(process.cwd(), dir) || "."}, no server-only text.`,
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
		`Client bundle check failed (apps/storefront/docs/development.md, "Secrets"):\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
	);
	process.exit(1);
}

main();
