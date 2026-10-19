import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	COPIED_MS,
	CopyButton,
	copyReducer,
	FAILED_MS,
	resultMs,
} from "../../src/deposit/components/copy-button.tsx";
import { copy } from "../../src/deposit/copy.ts";
import { attr, tags, textOf } from "./html.ts";

Object.assign(globalThis, { React });

describe("the copy button's result", () => {
	test("a tap clears the last result, so a second failure is a change a screen reader announces", () => {
		let state = copyReducer(null, { type: "done", ok: false });
		assert.equal(state, "failed");
		state = copyReducer(state, { type: "tap" });
		assert.equal(state, null);
		assert.equal(copyReducer(state, { type: "done", ok: false }), "failed");
		assert.equal(copyReducer(state, { type: "done", ok: true }), "copied");
	});

	test("both results go away on their own, the failure later because it says what to do instead", () => {
		assert.equal(copyReducer("copied", { type: "expire" }), null);
		assert.equal(copyReducer("failed", { type: "expire" }), null);
		assert.equal(resultMs(null), null);
		assert.equal(resultMs("copied"), COPIED_MS);
		assert.equal(resultMs("failed"), FAILED_MS);
		assert.ok(FAILED_MS > COPIED_MS);
	});

	test("renders the button named by its visible words and an empty polite region", () => {
		const html = renderToStaticMarkup(
			createElement(CopyButton, {
				text: "7K3M9Q",
				label: "Copy code 7K3M9Q",
				visible: "Copy code",
			}),
		);
		assert.equal(
			attr(tags(html, "button")[0], "aria-label"),
			"Copy code 7K3M9Q",
		);
		assert.match(
			html,
			/<span class="deposit-copied" aria-live="polite"><\/span>/,
		);
		assert.ok(!textOf(html).includes(copy.copyFailed));
	});
});
