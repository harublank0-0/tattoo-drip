import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { copy } from "../../src/deposit/copy.ts";
import {
	daysUntil,
	depositContact,
	depositView,
	formatReceived,
	headingTemplate,
	payByLine,
	stateTemplate,
	todayIn,
} from "../../src/deposit/view-model.ts";
import { PAGE, page, QR_URL, SHELL } from "./fixtures.ts";

describe("depositView", () => {
	test("a due deposit: methods in the API's order, its kinds once each, the form", () => {
		const view = depositView(PAGE);

		assert.equal(view.state, "due");
		assert.deepEqual(
			view.methods.map((method) => [method.id, method.kind, method.label]),
			[
				["method-0", "esewa", "eSewa"],
				["method-1", "bank", "Bank transfer"],
			],
		);
		assert.equal(view.methods[0].qr, QR_URL);
		assert.equal(view.methods[0].accountNumber, "9812345678");
		assert.equal(view.methods[1].qr, null);
		assert.equal(view.methods[1].bankName, "Nabil Bank");
		assert.deepEqual(view.kinds, ["esewa", "bank"]);
		assert.equal(view.takesProof, true);
		assert.equal(view.due, 300_000);
		assert.equal(view.dueText, "NPR 3,000");
		assert.equal(view.partial, false);
		assert.equal(view.payBy, "2026-10-28");
		assert.equal(view.referenceCode, "7K3M9Q");
		assert.equal(view.artistName, "Sita Rai");
		assert.equal(
			view.policy,
			"Deposits hold your date.\nThey are kept if you cancel within 48 hours.",
		);
	});

	test("a kind once, kinds it can't take dropped, QR codes only over http(s)", () => {
		const [esewa, bank] = PAGE.paymentMethods;
		const view = depositView(
			page({
				paymentMethods: [
					esewa,
					{
						...esewa,
						label: "eSewa (Sita)",
						qrImageUrl: "javascript:alert(1)",
					},
					{ ...bank, kind: "cash" as never },
				],
			}),
		);

		assert.deepEqual(view.kinds, ["esewa"]);
		assert.deepEqual(
			view.methods.map((method) => method.label),
			["eSewa", "eSewa (Sita)"],
		);
		assert.equal(view.methods[1].qr, null);
	});

	test("a method without a label is named by its kind", () => {
		const view = depositView(
			page({ paymentMethods: [{ ...PAGE.paymentMethods[1], label: "  " }] }),
		);
		assert.equal(view.methods[0].label, "Bank transfer");
	});

	test("no payment details and no form outside due", () => {
		for (const state of [
			"submitted",
			"paid",
			"updating",
			"expired",
			"cancelled",
		] as const) {
			const view = depositView(page({ state }));
			assert.deepEqual(view.methods, [], state);
			assert.deepEqual(view.kinds, [], state);
			assert.equal(view.takesProof, false, state);
		}
	});

	test("no form when the studio shows no way to pay", () => {
		const view = depositView(page({ paymentMethods: [] }));
		assert.equal(view.state, "due");
		assert.equal(view.takesProof, false);
	});

	test("a state this page doesn't know is updating: nothing to pay shown", () => {
		const view = depositView(page({ state: "refunded" as never }));
		assert.equal(view.state, "updating");
		assert.deepEqual(view.methods, []);
	});

	test("part of the deposit received, or none needed", () => {
		const part = depositView(
			page({
				deposit: { ...PAGE.deposit, due: 100_000, dueText: "NPR 1,000" },
			}),
		);
		assert.equal(part.partial, true);

		const none = depositView(
			page({
				state: "paid",
				deposit: {
					...PAGE.deposit,
					amount: 0,
					amountText: "NPR 0",
					due: 0,
					dueText: "NPR 0",
				},
			}),
		);
		assert.equal(none.partial, false);
		assert.equal(none.amount, 0);
	});

	test("the last screenshot's rejection shows only while due", () => {
		assert.equal(
			depositView(page({ lastProofRejected: true })).lastProofRejected,
			true,
		);
		assert.equal(
			depositView(page({ lastProofRejected: true, state: "submitted" }))
				.lastProofRejected,
			false,
		);
	});

	test("folds a brief over 240 characters, counted as characters", () => {
		const brief = (text: string) =>
			depositView(page({ project: { brief: text, artistName: null } }))
				.briefLong;
		assert.equal(brief("a".repeat(240)), false);
		assert.equal(brief("a".repeat(241)), true);
		assert.equal(brief("क".repeat(240)), false);
	});

	test("cleans the API's text", () => {
		const view = depositView(
			page({
				project: {
					brief: "  Fine line\r\n\r\n\r\npeony  ",
					artistName: "  Sita   Rai ",
				},
				depositPolicy: "   ",
				deposit: { ...PAGE.deposit, payBy: "soon" },
			}),
		);
		assert.equal(view.brief, "Fine line\n\npeony");
		assert.equal(view.artistName, "Sita Rai");
		assert.equal(view.policy, null);
		assert.equal(view.payBy, null);
	});
});

describe("dates, in the studio's timezone", () => {
	test("today, where the studio is", () => {
		const evening = new Date("2026-10-18T20:00:00Z");
		assert.equal(todayIn("Asia/Kathmandu", evening), "2026-10-19");
		assert.equal(todayIn("UTC", evening), "2026-10-18");
		assert.equal(todayIn("Not/AZone", evening), null);
	});

	test("whole days until the last day to pay", () => {
		assert.equal(daysUntil("2026-10-28", "2026-10-18"), 10);
		assert.equal(daysUntil("2026-10-18", "2026-10-18"), 0);
		assert.equal(daysUntil("2026-10-17", "2026-10-18"), -1);
		assert.equal(daysUntil("2026-11-02", "2026-10-30"), 3);
		assert.equal(daysUntil("soon", "2026-10-18"), null);
	});

	test("the pay-by line", () => {
		const view = { payBy: "2026-10-28", payByText: "28 Oct 2026" };
		assert.equal(
			payByLine(view, "2026-10-18"),
			"Pay by 28 Oct 2026, in 10 days.",
		);
		assert.equal(
			payByLine(view, "2026-10-27"),
			"Pay by tomorrow, 28 Oct 2026.",
		);
		assert.equal(payByLine(view, "2026-10-28"), "Pay by today, 28 Oct 2026.");
		assert.equal(payByLine(view, "2026-10-29"), "Pay by 28 Oct 2026.");
		assert.equal(payByLine(view, null), "Pay by 28 Oct 2026.");
		assert.equal(
			payByLine({ payBy: null, payByText: "28 Oct 2026" }, "2026-10-18"),
			"Pay by 28 Oct 2026.",
		);
	});

	test("when the screenshot came", () => {
		assert.equal(
			formatReceived("2026-10-18T08:20:00.000Z", "Asia/Kathmandu"),
			"18 Oct 2026, 2:05 pm",
		);
		assert.equal(
			formatReceived("2026-10-18T18:30:00.000Z", "Asia/Kathmandu"),
			"19 Oct 2026, 12:15 am",
		);
		assert.equal(formatReceived(null, "Asia/Kathmandu"), null);
		assert.equal(formatReceived("not a date", "Asia/Kathmandu"), null);
		assert.equal(formatReceived("2026-10-18T08:20:00.000Z", "Not/AZone"), null);
	});
});

describe("stateTemplate", () => {
	test("each state's sentence", () => {
		const view = (state: (typeof PAGE)["state"], amount = 300_000) => ({
			state,
			amount,
		});
		assert.equal(
			stateTemplate(view("submitted"), "18 Oct 2026, 2:05 pm"),
			copy.states.submitted,
		);
		assert.equal(
			stateTemplate(view("submitted"), null),
			copy.states.submittedUndated,
		);
		assert.equal(stateTemplate(view("paid"), null), copy.states.paid);
		assert.equal(stateTemplate(view("paid", 0), null), copy.states.paidNone);
		assert.equal(stateTemplate(view("updating"), null), copy.states.updating);
		assert.equal(stateTemplate(view("expired"), null), copy.states.expired);
		assert.equal(stateTemplate(view("cancelled"), null), copy.states.cancelled);
	});
});

describe("headingTemplate", () => {
	test("the page's h1 names the state; before the deposit is read, and while it is due, it names the studio", () => {
		const view = (state: (typeof PAGE)["state"], amount = 300_000) => ({
			state,
			amount,
		});
		assert.equal(headingTemplate(null), "Pay your deposit to {studio}");
		assert.equal(headingTemplate(view("due")), "Pay your deposit to {studio}");
		assert.equal(headingTemplate(view("submitted")), "Screenshot sent");
		assert.equal(headingTemplate(view("paid")), "Deposit paid");
		assert.equal(headingTemplate(view("paid", 0)), "No deposit needed");
		assert.equal(
			headingTemplate(view("updating")),
			"Your quote is being updated",
		);
		assert.equal(headingTemplate(view("expired")), "This quote has expired");
		assert.equal(
			headingTemplate(view("cancelled")),
			"This booking was cancelled",
		);
	});
});

describe("depositContact", () => {
	test("WhatsApp with the reference code, and Viber", () => {
		assert.deepEqual(depositContact(SHELL, "7K3M9Q"), {
			whatsapp: `https://wa.me/9779812345678?text=${encodeURIComponent("Hi Black Needle, about my deposit (reference code 7K3M9Q).")}`,
			viber: "viber://chat?number=%2B9779812345678",
		});
	});

	test("before the code is known, and without a phone", () => {
		assert.equal(
			depositContact(SHELL, null).whatsapp,
			`https://wa.me/9779812345678?text=${encodeURIComponent("Hi Black Needle, about my deposit.")}`,
		);
		assert.deepEqual(depositContact({ ...SHELL, phone: null }, "7K3M9Q"), {
			whatsapp: null,
			viber: null,
		});
	});
});
