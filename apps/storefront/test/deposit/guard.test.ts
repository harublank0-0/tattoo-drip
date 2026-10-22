import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * What must never come into the deposit page's code (TAT-65b, spec ruling 4):
 * the token stays in the URL's fragment and in the API's path, nowhere else.
 */

const SRC = new URL("../../src/", import.meta.url);
const DEPOSIT = new URL("deposit/", SRC);

function depositFiles(): string[] {
	return readdirSync(DEPOSIT, { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx)$/.test(file))
		.sort();
}

const read = (file: string) => readFileSync(new URL(file, DEPOSIT), "utf8");

test("nothing on the deposit page stores, logs, tracks or reads the query", () => {
	for (const file of depositFiles()) {
		const text = read(file);
		for (const banned of [
			/localStorage/,
			/sessionStorage/,
			/indexedDB/i,
			/document\.cookie/,
			/dangerouslySetInnerHTML/,
			/\bstyle=\{/,
			/\btarget=/,
			/console\./,
			/location\.search/,
			/searchParams/,
			/sendBeacon/,
			/posthog/i,
			/sentry/i,
		]) {
			assert.doesNotMatch(text, banned, `${file}: ${banned}`);
		}
	}
});

test("no in-page fragment link: following one would replace the token", () => {
	for (const file of depositFiles()) {
		assert.doesNotMatch(read(file), /href=["{`]+#/, file);
	}
});

test("only the screen reads the fragment", () => {
	assert.deepEqual(
		depositFiles().filter((file) => /location\.hash/.test(read(file))),
		["components/deposit-screen.tsx"],
	);
});

/**
 * Every module a source file pulls in, however it asks: `from "x"`, a bare
 * `import "x"`, a dynamic `import("x")` and `require("x")`. A specifier that
 * isn't a plain string comes back as "<computed>", which no list allows.
 */
function importsOf(text: string): string[] {
	const specifiers: string[] = [];
	for (const pattern of [
		/\bfrom\s+["']([^"']+)["']/g,
		/\bimport\s+["']([^"']+)["']/g,
		/\b(?:import|require)\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
	]) {
		for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
	}
	for (const match of text.matchAll(/\b(?:import|require)\(\s*([^\s"'`)])/g)) {
		specifiers.push(`<computed:${match[1]}>`);
	}
	return specifiers;
}

test("the import guard sees every way to pull a module in", () => {
	assert.deepEqual(importsOf("import { a } from \"x\";\nimport b from 'y';"), [
		"x",
		"y",
	]);
	assert.deepEqual(importsOf('import "side-effect";'), ["side-effect"]);
	assert.deepEqual(importsOf('const m = await import("posthog-js");'), [
		"posthog-js",
	]);
	assert.deepEqual(importsOf("const m = await import(`lazy`);"), ["lazy"]);
	assert.deepEqual(importsOf('const f = require("fs");'), ["fs"]);
	assert.deepEqual(importsOf('import x = require("old");'), ["old"]);
	assert.deepEqual(importsOf("await import(name)"), ["<computed:n>"]);
	assert.deepEqual(importsOf("const { a } = props; // no import here"), []);
});

test("imports only the page's own modules, React, the SDK, its hooks, the form kit and icons", () => {
	const allowed = new Set([
		"react",
		"@tattoo-drip/react",
		"@tattoo-drip/sdk",
		"@tanstack/react-form",
		"lucide-react",
	]);
	for (const file of depositFiles()) {
		for (const specifier of importsOf(read(file))) {
			assert.ok(
				specifier.startsWith(".") || allowed.has(specifier),
				`${file} imports ${specifier}`,
			);
		}
	}
});

test("the route reads no URL itself, and the router never keys storage by href", () => {
	const route = readFileSync(new URL("routes/deposit.tsx", SRC), "utf8");
	assert.doesNotMatch(route, /\.hash\b|useLocation|window\.location|useSearch/);
	const router = readFileSync(new URL("router.tsx", SRC), "utf8");
	assert.match(router, /getScrollRestorationKey: scrollRestorationKey/);
});

test("no control is natively disabled: a focused one would drop focus to the body (use aria-disabled and ignore the input)", () => {
	for (const file of depositFiles()) {
		assert.doesNotMatch(read(file), /(?<![-\w])disabled=/, file);
	}
});

test("the head (seo.ts) imports only the head strings, never the page's copy: the route's head runs in the entry chunk of every page", () => {
	const imports = Array.from(
		read("seo.ts").matchAll(/from "([^"]+)"/g),
		(match) => match[1],
	).sort();
	assert.deepEqual(imports, [
		"../intake/template.ts",
		"../studio/seo.ts",
		"./head-copy.ts",
	]);
	assert.doesNotMatch(read("head-copy.ts"), /\bimport\b/);
});

test("takes the intake form's words only as types: `fill` comes from template.ts, so the deposit chunk doesn't carry the form's copy (TAT-105)", () => {
	for (const file of depositFiles()) {
		for (const match of read(file).matchAll(
			/import\s+(type\s+)?[^;]*?from\s+["'][^"']*intake\/copy\.ts["']/g,
		)) {
			assert.ok(
				match[1],
				`${file} imports a value from intake/copy.ts: ${match[0]}`,
			);
		}
	}
});
