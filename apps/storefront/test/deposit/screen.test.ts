import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DepositForHash,
	DepositScreen,
} from "../../src/deposit/components/deposit-screen.tsx";
import { SHELL } from "./fixtures.ts";
import { hrefs, tags, textOf } from "./html.ts";

Object.assign(globalThis, { React });

test("the server renders the shell only: the studio, a busy skeleton, its chat links", () => {
	const html = renderToStaticMarkup(
		createElement(DepositScreen, { shell: SHELL }),
	);

	assert.equal(tags(html, "h1").length, 1);
	assert.match(
		html,
		/<h1[^>]*>Pay your deposit to <bdi>Black Needle<\/bdi><\/h1>/,
	);
	assert.match(html, /aria-busy="true"/);
	assert.match(textOf(html), /Questions\? Message Black Needle:WhatsAppViber/);
	assert.deepEqual(hrefs(html), [
		`https://wa.me/9779812345678?text=${encodeURIComponent("Hi Black Needle, about my deposit.")}`,
		"viber://chat?number=%2B9779812345678",
	]);
	assert.match(textOf(html), /You pay Black Needle directly\./);
	assert.doesNotMatch(html, /<form|deposits|Deposit due|role="alert"/);
});

test("a missing or malformed token is a dead link, in its h1 as in its message, and asks nothing of the API (TAT-119)", () => {
	for (const hash of ["", "#", "#abc", `#${"x".repeat(42)}`]) {
		const html = renderToStaticMarkup(
			createElement(DepositForHash, { hash, shell: SHELL }),
		);
		assert.equal(tags(html, "h1").length, 1, hash);
		assert.equal(
			textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? ""),
			"This link doesn't work",
			`h1 for "${hash}"`,
		);
		assert.match(
			textOf(html),
			/This link doesn't work any more\. Ask the studio to send you a new one\./,
			hash,
		);
		assert.doesNotMatch(textOf(html), /Pay your deposit/, hash);
		assert.match(html, /role="alert"/, hash);
	}
});

test("before the browser's fragment is known the h1 still asks to pay the studio", () => {
	const html = renderToStaticMarkup(
		createElement(DepositForHash, { hash: undefined, shell: SHELL }),
	);
	assert.match(
		html,
		/<h1[^>]*>Pay your deposit to <bdi>Black Needle<\/bdi><\/h1>/,
	);
	assert.match(html, /aria-busy="true"/);
});
