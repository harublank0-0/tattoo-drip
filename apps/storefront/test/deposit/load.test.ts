import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { onlineManager } from "@tanstack/react-query";
import { createTattooClient } from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement } from "react";
import { DepositLoaded } from "../../src/deposit/components/deposit-screen.tsx";
import { copy } from "../../src/deposit/copy.ts";
import { renderWithProviders } from "../intake/providers.tsx";
import { SHELL, TOKEN } from "./fixtures.ts";
import { attr, tags, textOf } from "./html.ts";

Object.assign(globalThis, { React });

/** The loaded screen as the browser first renders it (no effects run, nothing is fetched). */
const loadedHtml = () =>
	renderWithProviders(
		createTattooClient({
			baseUrl: "http://api.test",
			tenant: "black-needle-48",
			fetch: () => Promise.reject(new Error("no request during a render")),
		}),
		createElement(DepositLoaded, { token: TOKEN, shell: SHELL }),
	);

describe("the screen while the deposit loads", () => {
	test("online: a skeleton marked busy", () => {
		const html = loadedHtml();
		assert.match(html, /aria-busy="true"/);
		assert.doesNotMatch(html, /role="alert"/);
	});

	test("offline: says to check the connection and offers Try again, instead of a skeleton for ever", () => {
		onlineManager.setOnline(false);
		try {
			const html = loadedHtml();
			assert.doesNotMatch(html, /aria-busy="true"/);
			assert.equal(
				tags(html, "p").filter((tag) => /role="alert"/.test(tag)).length,
				1,
			);
			assert.ok(textOf(html).includes(copy.load.failed));
			const retry = tags(html, "button")[0];
			assert.equal(attr(retry, "type"), "button");
			assert.ok(textOf(html).includes(copy.load.retry));
		} finally {
			onlineManager.setOnline(true);
		}
	});
});
