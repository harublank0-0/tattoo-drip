import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormDemo } from "./form-demo.tsx";

const html = renderToStaticMarkup(createElement(FormDemo));
const tag = (pattern: RegExp) => html.match(pattern)?.[0] ?? "";

test("text fields are 3rem tall with 17px text and a described label", () => {
	const input = tag(/<input[^>]*id="name"[^>]*>/);

	assert.match(input, /class="[^"]*\bh-12\b/);
	assert.match(input, /text-\[1\.0625rem\]/);
	assert.doesNotMatch(input, /\bh-9\b/);
	assert.match(input, /aria-describedby="name-description"/);
	assert.match(input, / required=""/);
	assert.match(tag(/<label[^>]*for="name"[^>]*>/), /\btext-base\b/);
	assert.match(html, /id="name-description"[^>]*>A hint</);
});

test("a choice is a fieldset of native radios, each inside its label", () => {
	assert.match(html, /<fieldset[^>]*id="pick"/);
	assert.match(html, /<legend[^>]*>Pick one<\/legend>/);
	const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
	assert.equal(radios.length, 2);
	assert.equal(
		(html.match(/<label[^>]*>\s*<input[^>]*type="radio"/g) ?? []).length,
		2,
	);
	assert.match(radios[0], /id="pick-0"/);
	assert.match(radios[0], /name="pick"/);
	assert.doesNotMatch(radios[0], / checked=""/);
	assert.match(radios[1], / checked=""/);
	for (const radio of radios) assert.match(radio, / required=""/);
});

test("no field error is announced on its own", () => {
	assert.doesNotMatch(html, /role="alert"/);
});
