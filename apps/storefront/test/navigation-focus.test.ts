import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { focusAction, focusTargetIds } from "../src/navigation-focus.ts";

/**
 * Focus after a client-side navigation (src/navigation-focus.ts): a link the
 * router takes over swaps the page without a load, so focus is moved to the
 * new page's content, as a load would start there, except for a filter that
 * changes the page in place. Checked in Chromium too (keyboard, the phone
 * menu, Back, a `/#artists` link, the directory's filters and its reset).
 */
const at = (path: string, searchStr = "", hash = "") => ({
	href: `${path}${searchStr}${hash ? `#${hash}` : ""}`,
	searchStr,
	hash,
});

describe("focusAction: where focus goes after a navigation", () => {
	test("a new path moves it", () => {
		assert.equal(
			focusAction(
				{ fromLocation: at("/"), toLocation: at("/work"), pathChanged: true },
				null,
			),
			"move",
		);
	});

	test("a new query moves it too: a nav link from a filtered page", () => {
		assert.equal(
			focusAction(
				{
					fromLocation: at("/work", "?style=fine-line"),
					toLocation: at("/work"),
					pathChanged: false,
				},
				null,
			),
			"move",
		);
	});

	test("a filter link that changed the page in place keeps it, when it is the address asked for", () => {
		const change = {
			fromLocation: at("/artists"),
			toLocation: at("/artists", "?style=fine-line"),
			pathChanged: false,
		};
		assert.equal(focusAction(change, "/artists?style=fine-line"), "keep");
		// Another navigation (Back, or a link that did not ask) still moves it.
		assert.equal(focusAction(change, null), "move");
		assert.equal(focusAction(change, "/artists?style=blackwork"), "move");
	});

	test("the first load and a jump within the page leave it to the browser", () => {
		assert.equal(
			focusAction({ toLocation: at("/work"), pathChanged: true }, null),
			"none",
		);
		assert.equal(
			focusAction(
				{
					fromLocation: at("/"),
					toLocation: at("/", "", "artists"),
					pathChanged: false,
				},
				null,
			),
			"none",
		);
	});
});

describe("focusTargetIds: where focus lands", () => {
	test("the fragment's target first, else the page's <main>", () => {
		assert.deepEqual(focusTargetIds(""), ["main"]);
		assert.deepEqual(focusTargetIds("artists"), ["artists", "main"]);
	});

	test("the browser's router moves it, never the server's", () => {
		const router = readFileSync(
			new URL("../src/router.tsx", import.meta.url),
			"utf8",
		);
		assert.match(
			router,
			/if \(typeof document !== "undefined"\) focusAfterNavigation\(router\);/,
		);
		const source = readFileSync(
			new URL("../src/navigation-focus.ts", import.meta.url),
			"utf8",
		);
		// Without moving the page: scroll restoration and fragment scrolling stay the router's.
		assert.match(source, /\.focus\(\{ preventScroll: true \}\)/);
	});
});
