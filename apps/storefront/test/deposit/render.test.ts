import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DepositPage } from "@tattoo-drip/sdk";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ContactLine,
	DepositFrame,
	DepositIntro,
	DepositLoading,
	DueView,
	LoadProblemView,
	StateMessage,
	StateRegion,
} from "../../src/deposit/components/deposit-page.tsx";
import {
	ProofNoticeView,
	ProofSummary,
} from "../../src/deposit/components/notices.tsx";
import { summaryItems } from "../../src/deposit/problems.ts";
import {
	type DepositView,
	depositContact,
	depositView,
} from "../../src/deposit/view-model.ts";
import { isAllowedHref } from "../../src/studio/links.ts";
import { PAGE, page, QR_URL, SHELL } from "./fixtures.ts";
import { attr, hrefs, tags, textOf } from "./html.ts";

const render = (element: ReactElement) => renderToStaticMarkup(element);
const STUDIO = "Black Needle";

const dueHtml = (
	view = depositView(PAGE),
	today: string | null = "2026-10-18",
) =>
	render(
		createElement(DueView, { view, studioName: STUDIO, today, form: null }),
	);

const stateHtml = (
	overrides: Partial<DepositPage>,
	received: string | null = null,
) =>
	render(
		createElement(StateMessage, {
			view: depositView(page(overrides)),
			studioName: STUDIO,
			received,
		}),
	);

/** Every block, for the checks that hold everywhere. */
function everything(): string {
	return [
		render(createElement(DepositFrame, { studioName: STUDIO })),
		render(createElement(DepositLoading, { studioName: STUDIO })),
		render(
			createElement(LoadProblemView, {
				problem: "failed",
				onRetry: () => undefined,
			}),
		),
		render(createElement(DepositIntro, { view: depositView(PAGE) })),
		dueHtml(),
		stateHtml({ state: "submitted" }, "18 Oct 2026, 2:05 pm"),
		render(
			createElement(ContactLine, {
				studioName: STUDIO,
				contact: depositContact(SHELL, "7K3M9Q"),
			}),
		),
		render(
			createElement(ProofNoticeView, {
				code: "changed",
				waitSeconds: null,
				studioName: STUDIO,
			}),
		),
		render(createElement(ProofSummary, { items: summaryItems("x", "y") })),
	].join("\n");
}

describe("the frame", () => {
	test("one h1 naming the studio in <bdi>, and a footer saying the studio is paid directly", () => {
		const html = render(
			createElement(DepositFrame, { studioName: "मीना Ink" }),
		);
		assert.equal(tags(html, "h1").length, 1);
		assert.match(
			html,
			/<h1[^>]*>Pay your deposit to <bdi>मीना Ink<\/bdi><\/h1>/,
		);
		assert.match(
			textOf(html),
			/You pay मीना Ink directly\. Tattoo Drip runs this page for them and never handles your money\./,
		);
	});

	test("the h1 names the deposit's state once it is read, and the studio before that and while due (TAT-106)", () => {
		const h1 = (view: DepositView | null) => {
			const html = render(
				createElement(DepositFrame, { studioName: STUDIO, view }),
			);
			assert.equal(tags(html, "h1").length, 1);
			return textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "");
		};
		const nothingDue = {
			...PAGE.deposit,
			amount: 0,
			amountText: "NPR 0",
			due: 0,
			dueText: "NPR 0",
		};
		assert.equal(h1(null), "Pay your deposit to Black Needle");
		assert.equal(h1(depositView(PAGE)), "Pay your deposit to Black Needle");
		assert.equal(
			h1(depositView(page({ state: "submitted" }))),
			"Screenshot sent",
		);
		assert.equal(h1(depositView(page({ state: "paid" }))), "Deposit paid");
		assert.equal(
			h1(depositView(page({ state: "paid", deposit: nothingDue }))),
			"No deposit needed",
		);
		assert.equal(
			h1(depositView(page({ state: "updating" }))),
			"Your quote is being updated",
		);
		assert.equal(
			h1(depositView(page({ state: "expired" }))),
			"This quote has expired",
		);
		assert.equal(
			h1(depositView(page({ state: "cancelled" }))),
			"This booking was cancelled",
		);
	});

	test("loading: a skeleton marked busy, words for screen readers, a no-JavaScript line", () => {
		const html = render(createElement(DepositLoading, { studioName: STUDIO }));
		assert.match(html, /aria-busy="true"/);
		assert.match(html, /class="sr-only">Loading your deposit…</);
		assert.match(
			html,
			/<noscript>[\s\S]*Turn on JavaScript to see your deposit, or message [\s\S]*Black Needle[\s\S]*<\/noscript>/,
		);
	});

	test("a load problem is an alert; only a failed read offers to try again", () => {
		const dead = render(createElement(LoadProblemView, { problem: "dead" }));
		assert.match(dead, /<p[^>]*role="alert"/);
		assert.match(
			textOf(dead),
			/This link doesn't work any more\. Ask the studio to send you a new one\./,
		);
		assert.equal(tags(dead, "button").length, 0);

		const limited = render(
			createElement(LoadProblemView, {
				problem: "rate-limited",
				onRetry: () => undefined,
			}),
		);
		assert.equal(tags(limited, "button").length, 0);

		const failed = render(
			createElement(LoadProblemView, {
				problem: "failed",
				onRetry: () => undefined,
			}),
		);
		assert.match(
			textOf(failed),
			/We couldn't load your deposit\. Check your connection\./,
		);
		assert.equal(attr(tags(failed, "button")[0], "type"), "button");
		assert.match(textOf(failed), /Try again/);
	});

	test("while Try again runs, the message and its button stay and it says so once", () => {
		const props = { problem: "failed", onRetry: () => undefined } as const;
		const idle = render(createElement(LoadProblemView, props));
		assert.equal(attr(tags(idle, "button")[0], "aria-disabled"), undefined);
		assert.match(
			idle,
			/<p class="deposit-send-status" aria-live="polite"><\/p>/,
		);

		const running = render(
			createElement(LoadProblemView, { ...props, retrying: true }),
		);
		assert.match(running, /<p[^>]*role="alert"/);
		assert.equal(attr(tags(running, "button")[0], "aria-disabled"), "true");
		assert.match(running, />Trying again…<\/button>/);
		assert.match(
			running,
			/<p class="deposit-send-status" aria-live="polite">Loading your deposit…<\/p>/,
		);
		assert.equal(tags(running, "button").length, 1);
	});
});

describe("the state region", () => {
	test("a polite live region, empty until there is a message; quiet while focus is about to move to the message", () => {
		const message = createElement("p", null, "Your deposit is paid.");
		assert.equal(
			render(createElement(StateRegion, null)),
			'<div class="deposit-live" aria-live="polite"></div>',
		);
		assert.equal(
			render(createElement(StateRegion, null, message)),
			'<div class="deposit-live" aria-live="polite"><p>Your deposit is paid.</p></div>',
		);
		assert.equal(
			render(createElement(StateRegion, { quiet: true }, message)),
			'<div class="deposit-live" aria-live="off"><p>Your deposit is paid.</p></div>',
		);
	});
});

describe("the intro", () => {
	test("a short brief as text, the artist in <bdi>", () => {
		const html = render(
			createElement(DepositIntro, { view: depositView(PAGE) }),
		);
		assert.match(
			html,
			/<p class="user-text" dir="auto">Fine line peony on the left forearm<\/p>/,
		);
		assert.match(html, /with <bdi>Sita Rai<\/bdi>/);
		assert.doesNotMatch(html, /<details/);
	});

	test("a long brief folds, closed, whole", () => {
		const brief = "Fine line peony. ".repeat(20).trim();
		const html = render(
			createElement(DepositIntro, {
				view: depositView(page({ project: { brief, artistName: null } })),
			}),
		);
		assert.match(
			html,
			/<details class="deposit-brief"><summary>Your tattoo idea<\/summary>/,
		);
		assert.doesNotMatch(tags(html, "details")[0], / open/);
		assert.ok(textOf(html).includes(brief));
	});

	test("nothing at all without a brief or an artist", () => {
		const html = render(
			createElement(DepositIntro, {
				view: depositView(page({ project: { brief: " ", artistName: null } })),
			}),
		);
		assert.equal(html, "");
	});
});

describe("due", () => {
	test("the amount, part paid, the last day, the reference code", () => {
		const html = dueHtml(
			depositView(
				page({
					deposit: { ...PAGE.deposit, due: 100_000, dueText: "NPR 1,000" },
				}),
			),
		);
		const text = textOf(html);
		assert.match(html, /<h2 id="deposit-due-title">Deposit due<\/h2>/);
		assert.match(html, /<p class="deposit-amount"[^>]*>NPR 1,000<\/p>/);
		assert.match(text, /Part of your NPR 3,000 deposit was already received\./);
		assert.match(text, /Pay by 28 Oct 2026, in 10 days\./);
		assert.match(html, /<p class="deposit-code"[^>]*>7K3M9Q<\/p>/);
		assert.match(text, /Write this code in the payment remark \(or note\)\./);
	});

	test("the code and every number have a copy button named after what it copies", () => {
		const html = dueHtml();
		const buttons = tags(html, "button");
		assert.deepEqual(
			buttons.map((button) => attr(button, "aria-label")),
			["Copy code 7K3M9Q", "Copy 9812345678", "Copy 01234567890123"],
		);
		for (const button of buttons) assert.equal(attr(button, "type"), "button");
		assert.match(html, /aria-label="Copy code 7K3M9Q">.*Copy code<\/button>/s);
		assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 3);
	});

	test("each method: its label, its QR with alt text and reserved size, its details", () => {
		const html = dueHtml();
		const text = textOf(html);
		assert.match(html, /<h3 dir="auto">eSewa<\/h3>/);
		assert.match(html, /<h3 dir="auto">Bank transfer<\/h3>/);
		const images = tags(html, "img");
		assert.equal(images.length, 1);
		assert.equal(attr(images[0], "src"), QR_URL);
		assert.equal(attr(images[0], "alt"), "eSewa QR code for Black Needle");
		assert.equal(attr(images[0], "width"), "280");
		assert.equal(attr(images[0], "height"), "280");
		assert.equal(attr(images[0], "loading"), "eager");
		assert.equal(attr(images[0], "referrerpolicy"), "no-referrer");
		assert.match(text, /Scan it with your eSewa app\./);
		assert.match(text, /eSewa ID9812345678/);
		assert.match(
			text,
			/BankNabil BankAccount nameBlack Needle Pvt LtdAccount number01234567890123/,
		);
		assert.match(
			text,
			/Paying from this phone\? Press and hold a QR code to save it/,
		);
	});

	test("the first QR loads at once, the others when scrolled to", () => {
		const html = dueHtml(
			depositView(
				page({
					paymentMethods: [
						PAGE.paymentMethods[0],
						{
							kind: "khalti",
							label: "Khalti",
							qrImageUrl: "https://api.example.com/uploads/khalti.png",
							accountName: null,
							accountNumber: "9800000000",
							bankName: null,
						},
					],
				}),
			),
		);
		assert.deepEqual(
			tags(html, "img").map((image) => attr(image, "loading")),
			["eager", "lazy"],
		);
	});

	test("the deposit policy keeps its line breaks", () => {
		const html = dueHtml();
		assert.match(html, /<h2 id="deposit-policy-title">Deposit policy<\/h2>/);
		assert.match(
			html,
			/<p class="user-text" dir="auto">Deposits hold your date\.\nThey are kept/,
		);
	});

	test("no payment details: the note, no methods and no same-phone hint", () => {
		const html = dueHtml(depositView(page({ paymentMethods: [] })));
		assert.match(
			textOf(html),
			/The studio hasn't added payment details yet\. Message them to ask how to pay\./,
		);
		assert.doesNotMatch(html, /How to pay|<img|Paying from this phone/);
	});
});

describe("the other states", () => {
	test("each state's message, focusable, in the studio's name", () => {
		const cases: Array<[Partial<DepositPage>, RegExp]> = [
			[{ state: "paid" }, /^Your deposit is paid\. Thank you!$/],
			[
				{
					state: "paid",
					deposit: {
						...PAGE.deposit,
						amount: 0,
						amountText: "NPR 0",
						due: 0,
						dueText: "NPR 0",
					},
				},
				/^No deposit is needed for this booking\.$/,
			],
			[
				{ state: "updating" },
				/^Black Needle is updating your quote\. They'll message you when it's ready\.$/,
			],
			[
				{ state: "expired" },
				/^This quote has expired\. Message Black Needle if you still want to book\.$/,
			],
			[
				{ state: "cancelled" },
				/^This booking was cancelled\. Message Black Needle if you think this is a mistake\.$/,
			],
		];
		for (const [overrides, expected] of cases) {
			const html = stateHtml(overrides);
			const message =
				/<p[^>]*class="deposit-state-title"[^>]*>(.*?)<\/p>/s.exec(html);
			assert.ok(message, String(overrides.state));
			assert.match(textOf(message[1]), expected, String(overrides.state));
			assert.match(message[0], /tabindex="-1"/i);
			const receipt =
				overrides.state === "paid" && overrides.deposit === undefined;
			assert.equal(
				tags(html, "dl").length,
				receipt ? 1 : 0,
				String(overrides.state),
			);
		}
	});

	test("paid is a receipt: the deposit's amount and the reference code (TAT-106)", () => {
		const html = stateHtml({
			state: "paid",
			deposit: { ...PAGE.deposit, due: 0, dueText: "NPR 0" },
		});
		const text = textOf(html);
		assert.match(text, /^Your deposit is paid\. Thank you!/);
		assert.equal(tags(html, "dl").length, 1);
		assert.match(html, /<dt>Amount<\/dt><dd translate="no">NPR 3,000<\/dd>/);
		assert.match(text, /Reference code7K3M9Q/);
		assert.doesNotMatch(text, /NPR 0/);
	});

	test("submitted says when it came, and repeats the amount and the code", () => {
		const html = stateHtml({ state: "submitted" }, "18 Oct 2026, 2:05 pm");
		const text = textOf(html);
		assert.match(
			text,
			/We've sent your screenshot to Black Needle, received 18 Oct 2026, 2:05 pm\. They'll check it and confirm on WhatsApp or Viber\./,
		);
		assert.match(text, /AmountNPR 3,000/);
		assert.match(text, /Reference code7K3M9Q/);
		assert.match(
			textOf(stateHtml({ state: "submitted" })),
			/^We've sent your screenshot to Black Needle\. They'll check/,
		);
	});
});

describe("contact, notices and the summary", () => {
	test("WhatsApp with the code and Viber; nothing without a phone", () => {
		const html = render(
			createElement(ContactLine, {
				studioName: STUDIO,
				contact: depositContact(SHELL, "7K3M9Q"),
			}),
		);
		assert.match(
			textOf(html),
			/^Questions\? Message Black Needle:WhatsAppViber$/,
		);
		const anchors = tags(html, "a");
		assert.equal(anchors.length, 2);
		assert.equal(attr(anchors[0], "rel"), "noopener noreferrer");
		assert.equal(attr(anchors[1], "rel"), undefined);
		assert.equal(
			render(
				createElement(ContactLine, {
					studioName: STUDIO,
					contact: depositContact({ ...SHELL, phone: null }, "7K3M9Q"),
				}),
			),
			"",
		);
	});

	test("a notice is an alert with fixed words", () => {
		const changed = render(
			createElement(ProofNoticeView, {
				code: "changed",
				waitSeconds: null,
				studioName: STUDIO,
			}),
		);
		assert.match(changed, /<div class="deposit-alert" role="alert">/);
		assert.match(
			textOf(changed),
			/The deposit amount changed\. Check the new amount\.If you already paid the old amount, message Black Needle before you send a screenshot\./,
		);
		const limited = render(
			createElement(ProofNoticeView, {
				code: "rate-limited",
				waitSeconds: 1200,
				studioName: STUDIO,
			}),
		);
		assert.match(
			textOf(limited),
			/^Too many tries\. Wait 20 minutes and try again\.$/,
		);
	});

	test("the summary is focusable and its items are buttons, not fragment links", () => {
		const html = render(
			createElement(ProofSummary, {
				items: summaryItems(
					"Choose how you paid.",
					"Add a screenshot of your payment.",
				),
			}),
		);
		assert.match(html, /<section[^>]*tabindex="-1"/i);
		assert.match(html, /aria-labelledby="proof-summary-title"/);
		assert.match(textOf(html), /Check these 2 things before sending/);
		assert.equal(tags(html, "button").length, 2);
		assert.equal(hrefs(html).length, 0);
	});
});

describe("everywhere", () => {
	test("only allowed links, none to a fragment, no style or target", () => {
		const html = everything();
		for (const href of hrefs(html)) {
			assert.ok(isAllowedHref(href), href);
			assert.ok(!href.startsWith("#"), href);
		}
		assert.doesNotMatch(html, / style=| target=/);
	});
});
