import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { onlineManager } from "@tanstack/react-query";
import { createTattooClient, type DepositPage } from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement } from "react";
import { DepositLoaded } from "../../src/deposit/components/deposit-screen.tsx";
import { copy } from "../../src/deposit/copy.ts";
import { renderWithProviders } from "../intake/providers.tsx";
import { PAGE, page, SHELL, TOKEN } from "./fixtures.ts";
import { attr, tags, textOf } from "./html.ts";
import { renderWithDeposit } from "./providers.tsx";

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
			// The h1 says the same as the message, not "Pay your deposit" (TAT-119).
			assert.equal(tags(html, "h1").length, 1);
			assert.equal(
				textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? ""),
				"We couldn't load your deposit",
			);
			const retry = tags(html, "button")[0];
			assert.equal(attr(retry, "type"), "button");
			assert.ok(textOf(html).includes(copy.load.retry));
		} finally {
			onlineManager.setOnline(true);
		}
	});
});

/** The loaded screen once the deposit has been read (TAT-106). */
const readHtml = (deposit: DepositPage) =>
	renderWithDeposit(
		createTattooClient({
			baseUrl: "http://api.test",
			tenant: "black-needle-48",
			fetch: () => Promise.reject(new Error("no request during a render")),
		}),
		TOKEN,
		deposit,
		createElement(DepositLoaded, { token: TOKEN, shell: SHELL }),
	);

describe("the screen once the deposit is read (TAT-106)", () => {
	test("its one h1 names the state, above that state's message", () => {
		const h1 = (html: string) => {
			assert.equal(tags(html, "h1").length, 1);
			return textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "");
		};
		// Due without payment methods: no screenshot form (rendering one keeps the process alive for 5 s).
		const due = readHtml(page({ paymentMethods: [] }));
		assert.equal(h1(due), "Pay your deposit to Black Needle");
		assert.match(textOf(due), /Deposit due/);

		const paid = readHtml(
			page({
				state: "paid",
				deposit: { ...PAGE.deposit, due: 0, dueText: "NPR 0" },
			}),
		);
		assert.equal(h1(paid), "Deposit paid");
		assert.match(textOf(paid), /Your deposit is paid\. Thank you!/);
		assert.match(textOf(paid), /AmountNPR 3,000Reference code7K3M9Q/);

		const expired = readHtml(page({ state: "expired" }));
		assert.equal(h1(expired), "This quote has expired");
		assert.match(
			textOf(expired),
			/This quote has expired\. Message Black Needle if you still want to book\./,
		);
		assert.match(
			textOf(expired),
			/Tattoo Drip runs this page for Black Needle\./,
		);
	});
});
