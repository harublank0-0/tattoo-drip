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

test("imports only the page's own modules, React, the SDK, its hooks, the form kit and icons", () => {
	const allowed = new Set([
		"react",
		"@tattoo-drip/react",
		"@tattoo-drip/sdk",
		"@tanstack/react-form",
		"lucide-react",
	]);
	for (const file of depositFiles()) {
		for (const match of read(file).matchAll(/from "([^"]+)"/g)) {
			assert.ok(
				match[1].startsWith(".") || allowed.has(match[1]),
				`${file} imports ${match[1]}`,
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
