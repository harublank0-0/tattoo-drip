import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { focusTargetIds, movesFocus } from "../src/navigation-focus.ts";

/**
 * Focus after a client-side navigation (src/navigation-focus.ts): a link the
 * router takes over swaps the page without a load, so focus is moved to the
 * new page's content, as a load would start there. Checked in Chromium too
 * (keyboard, the phone menu, Back and a `/#artists` link).
 */
const at = (searchStr: string, hash = "") => ({ searchStr, hash });

describe("movesFocus: which navigations show a new page", () => {
	test("a new path or a new query does", () => {
		assert.equal(
			movesFocus({
				fromLocation: at(""),
				toLocation: at(""),
				pathChanged: true,
			}),
			true,
		);
		assert.equal(
			movesFocus({
				fromLocation: at(""),
				toLocation: at("?style=fine-line"),
				pathChanged: false,
			}),
			true,
		);
	});

	test("the first load and a jump within the page do not", () => {
		assert.equal(movesFocus({ toLocation: at(""), pathChanged: true }), false);
		assert.equal(
			movesFocus({
				fromLocation: at(""),
				toLocation: at("", "artists"),
				pathChanged: false,
			}),
			false,
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
