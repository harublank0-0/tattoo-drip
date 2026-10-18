import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DepositScreen } from "../../src/deposit/components/deposit-screen.tsx";
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
