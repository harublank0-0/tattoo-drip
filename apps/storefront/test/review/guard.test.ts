import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { REVIEW_PAGE_HEADERS, reviewHead } from "../../src/review/seo.ts";
import { isUnthemedPage } from "../../src/studio/theme/html.ts";

/*
 * What must never come into the review page's code (Reviews and Fresh ink):
 * the token stays in the URL's fragment and the API's X-Review-Token header,
 * nowhere else; the page is never stored or indexed.
 */

const SRC = new URL("../../src/", import.meta.url);
const REVIEW = new URL("review/", SRC);
const files = () =>
	readdirSync(REVIEW, { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx)$/.test(file))
		.sort();
const read = (file: string) => readFileSync(new URL(file, REVIEW), "utf8");

test("nothing on the review page stores, logs, tracks or reads the query", () => {
	for (const file of files()) {
		const text = read(file);
		for (const banned of [
			/localStorage/,
			/indexedDB/i,
			/document\.cookie/,
			/dangerouslySetInnerHTML/,
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

test("only the screen keeps the token, in this tab's sessionStorage, and takes it out of the address bar", () => {
	assert.deepEqual(
		files().filter((file) => /sessionStorage/.test(read(file))),
		["components/review-screen.tsx"],
	);
	const screen = read("components/review-screen.tsx");
	assert.match(screen, /history\.replaceState\(/);
	assert.doesNotMatch(screen, /history\.pushState/);
});

test("no in-page fragment link, and only the screen reads the fragment", () => {
	for (const file of files()) {
		assert.doesNotMatch(read(file), /href=["{`]+#/, file);
	}
	assert.deepEqual(
		files().filter((file) => /location\.hash/.test(read(file))),
		["components/review-screen.tsx"],
	);
});

test("the token is never in the route's path: /review takes no parameter", () => {
	const route = readFileSync(new URL("routes/review.tsx", SRC), "utf8");
	assert.match(route, /createFileRoute\("\/review"\)/);
	assert.doesNotMatch(route, /\/review\/\$/);
});

test("never stored, never indexed, no Referer; unthemed like the deposit page", () => {
	assert.deepEqual(REVIEW_PAGE_HEADERS, {
		"Cache-Control": "private, no-store",
		"Referrer-Policy": "no-referrer",
		"X-Robots-Tag": "noindex, nofollow",
	});
	const head = reviewHead("Black Needle");
	assert.ok(
		head.meta.some(
			(meta) =>
				"name" in meta &&
				meta.name === "robots" &&
				meta.content === "noindex, nofollow",
		),
	);
	assert.ok(
		head.meta.some(
			(meta) =>
				"name" in meta &&
				meta.name === "referrer" &&
				meta.content === "no-referrer",
		),
	);
	assert.ok(
		head.meta.some(
			(meta) =>
				"title" in meta && meta.title === "Your tattoo review · Black Needle",
		),
	);
	assert.equal(head.links.length, 0, "no canonical link");
	assert.equal(isUnthemedPage([{ routeId: "/review" }]), true);
});

test("every image the page draws sends no Referer", () => {
	for (const file of files().filter((name) => name.endsWith(".tsx"))) {
		for (const img of read(file).match(/<img\b[^>]*>/gs) ?? []) {
			if (/src=\{upload\.preview\}/.test(img)) continue; // a local object URL
			assert.match(
				img,
				/referrerPolicy="no-referrer"/,
				`${file}: ${img.slice(0, 60)}`,
			);
		}
	}
});
