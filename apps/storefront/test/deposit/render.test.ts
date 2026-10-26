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
import { type LoadProblem, summaryItems } from "../../src/deposit/problems.ts";
import {
	type DepositView,
	depositContact,
	depositView,
	selectedMethod,
} from "../../src/deposit/view-model.ts";
import { isAllowedHref } from "../../src/studio/links.ts";
import { PAGE, page, QR_URL, SHELL } from "./fixtures.ts";
import { attr, hrefs, tags, textOf } from "./html.ts";

const render = (element: ReactElement) => renderToStaticMarkup(element);
const STUDIO = "Black Needle";

const dueHtml = (
	view = depositView(PAGE),
	today: string | null = "2026-10-18",
	selected = selectedMethod(view.methods, null),
) =>
	render(
		createElement(DueView, {
			view,
			studioName: STUDIO,
			today,
			selected,
			onSelect: () => undefined,
			form: null,
		}),
	);

const FORM_MARK = '<form class="stand-in">';

/** dueHtml with a stand-in for the screenshot form, so the bar shows. */
const dueHtmlWithForm = (view = depositView(PAGE)) =>
	render(
		createElement(DueView, {
			view,
			studioName: STUDIO,
			today: "2026-10-18",
			selected: selectedMethod(view.methods, null),
			onSelect: () => undefined,
			form: createElement("form", { className: "stand-in" }),
		}),
	);

/** The inputs named `name`, as their opening tags. */
const radiosOf = (html: string, name: string) =>
	tags(html, "input").filter(
		(tag) => attr(tag, "type") === "radio" && attr(tag, "name") === name,
	);

const stateHtml = (
	overrides: Partial<DepositPage>,
	received: string | null = null,
	sessionStart: string | null = null,
) =>
	render(
		createElement(StateMessage, {
			view: depositView(page(overrides)),
			studioName: STUDIO,
			received,
			sessionStart,
		}),
	);

const SESSION_AT = "2026-10-24T05:15:00.000Z";
const SESSION_TEXT = "Sat 24 Oct 2026, 11:00 am";
const PAID = { ...PAGE.deposit, due: 0, dueText: "NPR 0" };

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
	test("one h1 naming the studio in <bdi>, and a footer saying who runs the page", () => {
		const html = render(
			createElement(DepositFrame, { studioName: "मीना Ink" }),
		);
		assert.equal(tags(html, "h1").length, 1);
		assert.match(
			html,
			/<h1[^>]*>Pay your deposit to <bdi>मीना Ink<\/bdi><\/h1>/,
		);
		assert.match(textOf(html), /Tattoo Drip runs this page for मीना Ink\./);
	});

	test("a header above the h1: the studio's initial as a mark, its name, no artist before the deposit is read (TAT-110)", () => {
		const html = render(
			createElement(DepositFrame, { studioName: "मीना Ink" }),
		);

		assert.match(html, /<header class="deposit-header">/);
		assert.match(
			html,
			/<span class="deposit-mark" aria-hidden="true">मी<\/span>/,
		);
		assert.match(html, /<p class="deposit-studio" dir="auto">मीना Ink<\/p>/);
		assert.equal(tags(html, "img").length, 0);
		assert.doesNotMatch(textOf(html), /\bwith\b/);
		assert.ok(html.indexOf("deposit-header") < html.indexOf("<h1"));
		assert.equal(tags(html, "h1").length, 1);
	});

	test("a wide frame sets the page and its footer in the desktop's two columns (TAT-110)", () => {
		const wide = render(
			createElement(DepositFrame, { studioName: STUDIO, wide: true }),
		);
		const plain = render(createElement(DepositFrame, { studioName: STUDIO }));

		assert.match(wide, /<main class="deposit deposit-wide">/);
		assert.match(wide, /<footer class="deposit-footer deposit-wide">/);
		assert.match(plain, /<main class="deposit">/);
		assert.match(plain, /<footer class="deposit-footer">/);
	});

	test("the checked logo replaces the mark: decoration (alt empty), no Referer, its size reserved (TAT-110)", () => {
		const html = render(
			createElement(DepositFrame, {
				studioName: STUDIO,
				logo: {
					src: "https://api.example.com/logo.png",
					width: 600,
					height: 200,
				},
			}),
		);
		const images = tags(html, "img");

		assert.equal(images.length, 1);
		assert.equal(attr(images[0], "class"), "deposit-logo");
		assert.equal(attr(images[0], "src"), "https://api.example.com/logo.png");
		assert.equal(attr(images[0], "width"), "600");
		assert.equal(attr(images[0], "height"), "200");
		assert.equal(attr(images[0], "alt"), "");
		assert.equal(attr(images[0], "referrerpolicy"), "no-referrer");
		assert.doesNotMatch(html, /deposit-mark/);
		assert.match(
			html,
			/<p class="deposit-studio" dir="auto">Black Needle<\/p>/,
		);
	});

	test("a logo with copies carries srcset and sizes and keeps its Referer rule (TAT-112)", () => {
		const srcSet =
			"https://api.example.com/logo.320w.png 320w, https://api.example.com/logo.png 600w";
		const html = render(
			createElement(DepositFrame, {
				studioName: STUDIO,
				logo: {
					src: "https://api.example.com/logo.png",
					width: 600,
					height: 200,
					srcSet,
				},
			}),
		);
		const [image] = tags(html, "img");

		assert.equal(attr(image, "srcset"), srcSet);
		assert.equal(attr(image, "sizes"), "8rem");
		assert.equal(attr(image, "referrerpolicy"), "no-referrer");
		assert.equal(attr(image, "src"), "https://api.example.com/logo.png");
	});

	test("a logo without copies has no srcset or sizes", () => {
		const html = render(
			createElement(DepositFrame, {
				studioName: STUDIO,
				logo: {
					src: "https://api.example.com/logo.png",
					width: 600,
					height: 200,
				},
			}),
		);

		assert.doesNotMatch(html, / srcset=/i);
		assert.doesNotMatch(html, / sizes=/);
	});

	test("the project's artist sits under the studio's name, in <bdi> (TAT-110)", () => {
		const html = render(
			createElement(DepositFrame, {
				studioName: STUDIO,
				artistName: "Sita Rai",
			}),
		);

		assert.match(html, /with <bdi>Sita Rai<\/bdi>/);
		assert.ok(html.indexOf("Sita Rai") < html.indexOf("<h1"));
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

	test("a link that doesn't work, a rate limit and a failed read have an h1 that matches their message, not 'Pay your deposit' (TAT-119)", () => {
		const h1 = (problem: LoadProblem) => {
			const html = render(
				createElement(
					DepositFrame,
					{ studioName: STUDIO, problem },
					createElement(LoadProblemView, { problem }),
				),
			);
			assert.equal(tags(html, "h1").length, 1);
			return textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "");
		};
		assert.equal(h1("dead"), "This link doesn't work");
		assert.equal(h1("rate-limited"), "Too many tries");
		assert.equal(h1("failed"), "We couldn't load your deposit");
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
	test("a short brief as text; the artist moved to the header (TAT-110)", () => {
		const html = render(
			createElement(DepositIntro, { view: depositView(PAGE) }),
		);
		assert.match(
			html,
			/<p class="user-text" dir="auto">Fine line peony on the left forearm<\/p>/,
		);
		assert.doesNotMatch(html, /Sita Rai|\bwith\b/);
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

	test("nothing at all without a brief, an artist or not", () => {
		for (const artistName of [null, "Sita Rai"]) {
			const html = render(
				createElement(DepositIntro, {
					view: depositView(page({ project: { brief: " ", artistName } })),
				}),
			);
			assert.equal(html, "", String(artistName));
		}
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
		assert.match(
			html,
			/<h2 id="deposit-due-title" class="sr-only">Deposit due<\/h2>/,
		);
		assert.match(html, /<p class="deposit-amount"[^>]*>NPR 1,000<\/p>/);
		assert.match(
			text,
			/NPR 1,000.*You pay Black Needle directly\. Tattoo Drip never handles your money\./s,
		);
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
			["Copy code 7K3M9Q", "Copy 9812345678"],
		);
		for (const button of buttons) assert.equal(attr(button, "type"), "button");
		assert.match(html, /aria-label="Copy code 7K3M9Q">.*Copy code<\/button>/s);
		assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 2);

		const view = depositView(PAGE);
		const bank = dueHtml(view, "2026-10-18", view.methods[1]);
		assert.deepEqual(
			tags(bank, "button").map((button) => attr(button, "aria-label")),
			["Copy code 7K3M9Q", "Copy 01234567890123"],
		);
	});

	test("steps 1 and 2 are numbered h2s: a hidden numeral, 'Step N: ' for screen readers, then the title (TAT-110)", () => {
		const html = dueHtml();

		assert.match(
			html,
			/<h2 id="deposit-code-title" class="deposit-step-title"><span class="deposit-step-number" aria-hidden="true">1<\/span><span class="sr-only">Step 1: <\/span>Copy the code<\/h2>/,
		);
		assert.match(
			html,
			/<h2 id="deposit-pay-title" class="deposit-step-title"><span class="deposit-step-number" aria-hidden="true">2<\/span><span class="sr-only">Step 2: <\/span>Pay<\/h2>/,
		);
		assert.doesNotMatch(html, /Reference code|How to pay/);
	});

	test("Pay with: a native radio group of the methods, the picked one checked, the labels in the studio's own words (TAT-110)", () => {
		const html = dueHtml();
		const radios = radiosOf(html, "pay-with");

		assert.match(html, /<fieldset class="deposit-paywith">/);
		assert.match(html, /<legend class="sr-only">Pay with<\/legend>/);
		assert.deepEqual(
			radios.map((radio) => [attr(radio, "id"), attr(radio, "value")]),
			[
				["pay-with-0", "0"],
				["pay-with-1", "1"],
			],
		);
		assert.match(radios[0], / checked=""/);
		assert.doesNotMatch(radios[1], / checked=""/);
		assert.match(html, /<span dir="auto">eSewa<\/span>/);
		assert.match(html, /<span dir="auto">Bank transfer<\/span>/);
		assert.equal(tags(html, "form").length, 0);
		assert.equal(tags(html, "h3").length, 0);
	});

	test("a method's identity stays out of the markup: no attribute holds it, for a script or the clipboard to read (TAT-110 fix round 2)", () => {
		const view = depositView(PAGE);
		const html = dueHtml(view);

		for (const method of view.methods) {
			assert.ok(!html.includes(method.id), method.kind);
			assert.ok(!html.includes(encodeURIComponent(method.id)), method.kind);
		}
		assert.doesNotMatch(html, /%7C/);
	});

	test("only the picked method is on the page: its QR (eager, no Referer, reserved size), its caption, its details", () => {
		const html = dueHtml();
		const text = textOf(html);
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
		assert.match(text, /On this phone\? Press and hold the QR code to save it/);
		assert.doesNotMatch(text, /Nabil Bank|01234567890123/);
		assert.match(html, /class="deposit-method-panel"/);
	});

	test("the bank picked: no image, its details, its radio checked", () => {
		const view = depositView(PAGE);
		const html = dueHtml(view, "2026-10-18", view.methods[1]);
		const radios = radiosOf(html, "pay-with");

		assert.equal(tags(html, "img").length, 0);
		assert.match(
			textOf(html),
			/BankNabil BankAccount nameBlack Needle Pvt LtdAccount number01234567890123/,
		);
		assert.doesNotMatch(textOf(html), /On this phone|eSewa ID/);
		assert.doesNotMatch(radios[0], / checked=""/);
		assert.match(radios[1], / checked=""/);
	});

	test("every QR on the page is the picked one's, whatever the studio lists", () => {
		const view = depositView(
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
		);

		const first = dueHtml(view);
		const second = dueHtml(view, "2026-10-18", view.methods[1]);

		assert.deepEqual(
			tags(first, "img").map((image) => attr(image, "src")),
			[QR_URL],
		);
		assert.deepEqual(
			tags(second, "img").map((image) => attr(image, "src")),
			["https://api.example.com/uploads/khalti.png"],
		);
	});

	test("one method: no radios, the panel opens with 'Pay with <label>'", () => {
		const html = dueHtml(
			depositView(page({ paymentMethods: [PAGE.paymentMethods[0]] })),
		);

		assert.equal(tags(html, "fieldset").length, 0);
		assert.equal(radiosOf(html, "pay-with").length, 0);
		assert.match(html, /Pay with <bdi>eSewa<\/bdi>/);
		assert.equal(tags(html, "img").length, 1);
	});

	test("a method with a QR and no details, and one with details and no QR", () => {
		const qrOnly = dueHtml(
			depositView(
				page({
					paymentMethods: [
						{
							kind: "fonepay",
							label: "Fonepay",
							qrImageUrl: QR_URL,
							accountName: null,
							accountNumber: null,
							bankName: null,
						},
					],
				}),
			),
		);
		assert.equal(tags(qrOnly, "img").length, 1);
		assert.equal(tags(qrOnly, "dl").length, 0);
		assert.doesNotMatch(textOf(qrOnly), /Ask Black Needle/);
	});

	test("a method with neither a QR that passes the check nor details says to ask the studio", () => {
		const html = dueHtml(
			depositView(
				page({
					paymentMethods: [
						{
							kind: "khalti",
							label: "Khalti",
							qrImageUrl: "javascript:alert(1)",
							accountName: null,
							accountNumber: null,
							bankName: null,
						},
					],
				}),
			),
		);

		assert.match(textOf(html), /Ask Black Needle for these details\./);
		assert.equal(tags(html, "img").length, 0);
	});

	test("an I've paid button between the panel and step 3: a plain button, never a link (TAT-110)", () => {
		const html = dueHtmlWithForm();
		const bars = html.match(/<div class="deposit-paid-bar">.*?<\/div>/gs) ?? [];

		assert.equal(bars.length, 1);
		const button = tags(bars[0], "button");
		assert.equal(button.length, 1);
		assert.equal(attr(button[0], "type"), "button");
		assert.equal(attr(button[0], "class"), "action action-secondary");
		assert.equal(textOf(bars[0]), "I've paid: send the screenshot");
		assert.equal(hrefs(bars[0]).length, 0);
		assert.ok(
			html.indexOf("deposit-method-panel") < html.indexOf("deposit-paid-bar"),
		);
		assert.ok(html.indexOf("deposit-paid-bar") < html.indexOf(FORM_MARK));
	});

	test("no form to send, no I've paid button", () => {
		assert.doesNotMatch(dueHtml(), /deposit-paid-bar/);
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
		assert.doesNotMatch(html, /<img|On this phone|<fieldset|<h3/);
		assert.match(html, /<h2 id="deposit-pay-title"/);
		assert.doesNotMatch(html, /deposit-method-panel/);
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

	test("a paid receipt adds the next session's date and time, and its artist (TAT-110)", () => {
		const html = stateHtml(
			{
				state: "paid",
				deposit: PAID,
				nextSession: { startsAt: SESSION_AT, artistName: "आरव श्रेष्ठ" },
			},
			null,
			SESSION_TEXT,
		);

		assert.equal(tags(html, "dl").length, 1);
		assert.match(
			html,
			/<dt>Amount<\/dt><dd translate="no">NPR 3,000<\/dd><dt>Reference code<\/dt><dd class="deposit-number" translate="no">7K3M9Q<\/dd><dt>Your session<\/dt><dd><time dateTime="2026-10-24T05:15:00.000Z">Sat 24 Oct 2026, 11:00 am<\/time><\/dd><dt>Artist<\/dt><dd dir="auto">आरव श्रेष्ठ<\/dd>/,
		);
	});

	test("no artist name, no Artist row; no session or an unknown zone, the receipt as it was", () => {
		const base = { state: "paid", deposit: PAID } as const;
		const noArtist = stateHtml(
			{ ...base, nextSession: { startsAt: SESSION_AT, artistName: null } },
			null,
			SESSION_TEXT,
		);
		assert.match(textOf(noArtist), /Your session.*Sat 24 Oct 2026, 11:00 am/);
		assert.doesNotMatch(textOf(noArtist), /Artist/);

		const without = stateHtml(base);
		const unknownZone = stateHtml(
			{
				...base,
				nextSession: { startsAt: SESSION_AT, artistName: "Aarav" },
			},
			null,
			null,
		);
		assert.equal(unknownZone, without);
		assert.doesNotMatch(without, /Your session|<time/);
	});

	test("a paid deposit of nothing with a session shows the session rows alone", () => {
		const html = stateHtml(
			{
				state: "paid",
				deposit: {
					...PAGE.deposit,
					amount: 0,
					amountText: "NPR 0",
					due: 0,
					dueText: "NPR 0",
				},
				nextSession: { startsAt: SESSION_AT, artistName: "Aarav" },
			},
			null,
			SESSION_TEXT,
		);

		assert.equal(tags(html, "dl").length, 1);
		assert.doesNotMatch(textOf(html), /Amount|Reference code/);
		assert.match(
			textOf(html),
			/^No deposit is needed for this booking\.Your sessionSat 24 Oct 2026, 11:00 amArtistAarav$/,
		);
	});

	test("no other state shows a session, even if the page carries one", () => {
		for (const state of [
			"submitted",
			"updating",
			"expired",
			"cancelled",
		] as const) {
			const withSession = stateHtml(
				{
					state,
					nextSession: { startsAt: SESSION_AT, artistName: "Aarav" },
				},
				"18 Oct 2026, 2:05 pm",
				SESSION_TEXT,
			);
			assert.equal(
				withSession,
				stateHtml({ state }, "18 Oct 2026, 2:05 pm", null),
				state,
			);
		}
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
