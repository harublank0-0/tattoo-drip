import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DepositPage } from "@tattoo-drip/sdk";
import { copy, type DepositMethodKind } from "../../src/deposit/copy.ts";
import {
	answerFor,
	type DepositView,
	daysUntil,
	depositContact,
	depositView,
	formatReceived,
	formatSessionStart,
	headingTemplate,
	type MethodPick,
	payByLine,
	pickMethod,
	receiptAmount,
	selectedMethod,
	stateTemplate,
	studioInitial,
	todayIn,
} from "../../src/deposit/view-model.ts";
import { PAGE, page, QR_URL, SHELL } from "./fixtures.ts";

describe("depositView", () => {
	test("a due deposit: methods in the API's order, its kinds once each, the form", () => {
		const view = depositView(PAGE);

		assert.equal(view.state, "due");
		assert.deepEqual(
			view.methods.map((method) => [method.kind, method.label]),
			[
				["esewa", "eSewa"],
				["bank", "Bank transfer"],
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

	test("a link that doesn't work, a rate limit and a failed read each get a heading that matches their message (TAT-119)", () => {
		assert.equal(headingTemplate(null, "dead"), "This link doesn't work");
		assert.equal(headingTemplate(null, "rate-limited"), "Too many tries");
		assert.equal(
			headingTemplate(null, "failed"),
			"We couldn't load your deposit",
		);
		// A problem wins over a page already shown: a link that was replaced
		// must stop saying "Deposit paid".
		assert.equal(
			headingTemplate({ state: "paid", amount: 300_000 }, "dead"),
			"This link doesn't work",
		);
		// No problem: the studio, as before.
		assert.equal(headingTemplate(null, null), "Pay your deposit to {studio}");
	});
});

describe("receiptAmount", () => {
	test("submitted repeats what was sent, a paid deposit its amount; nothing otherwise (TAT-106)", () => {
		const amount = (state: (typeof PAGE)["state"], deposit = PAGE.deposit) =>
			receiptAmount(depositView(page({ state, deposit })));
		const partPaid = { ...PAGE.deposit, due: 100_000, dueText: "NPR 1,000" };
		const paidUp = { ...PAGE.deposit, due: 0, dueText: "NPR 0" };
		const nothingDue = {
			...PAGE.deposit,
			amount: 0,
			amountText: "NPR 0",
			due: 0,
			dueText: "NPR 0",
		};
		assert.equal(amount("submitted", partPaid), "NPR 1,000");
		assert.equal(amount("paid", paidUp), "NPR 3,000");
		assert.equal(amount("paid", nothingDue), null);
		for (const state of ["due", "updating", "expired", "cancelled"] as const) {
			assert.equal(amount(state), null, state);
		}
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

describe("selectedMethod (TAT-110)", () => {
	const methods = depositView(PAGE).methods;

	test("the picked method while it is listed, else the first, else null", () => {
		assert.equal(selectedMethod(methods, methods[1].id), methods[1]);
		assert.equal(selectedMethod(methods, "nope"), methods[0]);
		assert.equal(selectedMethod(methods, null), methods[0]);
		assert.equal(selectedMethod([], methods[0].id), null);
		assert.equal(selectedMethod([], null), null);
	});
});

describe("formatSessionStart (TAT-110)", () => {
	test("weekday, date and 12-hour time in the studio's timezone", () => {
		assert.equal(
			formatSessionStart("2026-10-24T05:15:00.000Z", "Asia/Kathmandu"),
			"Sat 24 Oct 2026, 11:00 am",
		);
		assert.equal(
			formatSessionStart("2026-10-24T18:45:00.000Z", "Asia/Kathmandu"),
			"Sun 25 Oct 2026, 12:30 am",
		);
	});

	test("null for a start that isn't a date or a zone this browser doesn't know, never UTC", () => {
		assert.equal(formatSessionStart("nope", "Asia/Kathmandu"), null);
		assert.equal(
			formatSessionStart("2026-10-24T05:15:00.000Z", "Not/AZone"),
			null,
		);
	});
});

describe("studioInitial (TAT-110)", () => {
	test("the first user-perceived character, as typed", () => {
		assert.equal(studioInitial("Black Needle"), "B");
		assert.equal(studioInitial("कालो सुई"), "का");
		assert.equal(studioInitial("  x"), "x");
		assert.equal(studioInitial("   "), "");
	});
});

describe("depositView's session (TAT-110)", () => {
	const startsAt = "2026-10-24T05:15:00.000Z";

	test("a paid page keeps the next session's start and its cleaned artist", () => {
		const view = depositView(
			page({
				state: "paid",
				nextSession: { startsAt, artistName: "  Aarav  " },
			}),
		);

		assert.deepEqual(view.session, { startsAt, artistName: "Aarav" });
	});

	test("only a paid page has one", () => {
		for (const state of [
			"due",
			"submitted",
			"updating",
			"expired",
			"cancelled",
		] as const) {
			const view = depositView(
				page({ state, nextSession: { startsAt, artistName: "Aarav" } }),
			);
			assert.equal(view.session, null, state);
		}
	});

	test("an API before TAT-110 (no field), a null, or a start that isn't a date is no session", () => {
		const paid = page({ state: "paid" });
		assert.equal(
			depositView({ ...paid, nextSession: undefined } as never).session,
			null,
		);
		assert.equal(depositView({ ...paid, nextSession: null }).session, null);
		assert.equal(
			depositView({
				...paid,
				nextSession: { startsAt: "soon", artistName: "Aarav" },
			}).session,
			null,
		);
		assert.equal(
			depositView({
				...paid,
				nextSession: { startsAt: 5, artistName: null } as never,
			}).session,
			null,
		);
	});

	test("a session without an artist name keeps its start", () => {
		const view = depositView(
			page({ state: "paid", nextSession: { startsAt, artistName: null } }),
		);

		assert.deepEqual(view.session, { startsAt, artistName: null });
	});
});

describe("a method's identity (TAT-110 fix rounds 1 and 2)", () => {
	const [esewa, bank] = PAGE.paymentMethods;
	const fonepay = (label: string, n: number | null) => ({
		kind: "fonepay" as const,
		label,
		qrImageUrl:
			n === null ? null : `https://api.example.com/uploads/fonepay-${n}.png`,
		accountName: null,
		accountNumber: null,
		bankName: null,
	});
	const [a, b, c] = [
		fonepay("Fonepay A", 1),
		fonepay("Fonepay B", 2),
		fonepay("Fonepay C", 3),
	];
	const methodsOf = (paymentMethods: DepositPage["paymentMethods"]) =>
		depositView(page({ paymentMethods })).methods;
	const idOf = (methods: ReturnType<typeof methodsOf>, label: string) => {
		const found = methods.find((method) => method.label === label);
		assert.ok(found, label);
		return found.id;
	};
	/** What the client has picked is still what shows after `after` is read. */
	const shownAfter = (
		before: DepositPage["paymentMethods"],
		pickLabel: string,
		after: DepositPage["paymentMethods"],
	) => {
		const picked = idOf(methodsOf(before), pickLabel);
		return selectedMethod(methodsOf(after), picked);
	};

	test("is made of everything that tells a method apart: kind, number, names, label and QR", () => {
		const [m] = methodsOf([{ ...bank, qrImageUrl: QR_URL }]);
		const changed = (over: Partial<(typeof PAGE.paymentMethods)[number]>) =>
			methodsOf([{ ...bank, qrImageUrl: QR_URL, ...over }])[0].id;

		assert.notEqual(changed({ accountNumber: "1" }), m.id);
		assert.notEqual(changed({ accountName: "Someone else" }), m.id);
		assert.notEqual(changed({ bankName: "Global IME" }), m.id);
		assert.notEqual(changed({ label: "Bank 2" }), m.id);
		assert.notEqual(changed({ qrImageUrl: `${QR_URL}?v=2` }), m.id);
		assert.notEqual(changed({ qrImageUrl: null }), m.id);
		assert.equal(changed({}), m.id);
	});

	test("is cleaned the way the page shows it: spacing and a blank name don't make another method", () => {
		const [tidy] = methodsOf([{ ...bank, accountNumber: "98765 43210" }]);
		const [messy] = methodsOf([
			{ ...bank, accountNumber: "  98765  43210 ", bankName: " Nabil Bank " },
		]);

		assert.equal(messy.id, tidy.id);
	});

	test("is the same after a reorder, after other methods go, and after one is added", () => {
		const all = [a, b, c, esewa, bank];
		const id = (list: DepositPage["paymentMethods"], label: string) =>
			idOf(methodsOf(list), label);

		for (const label of [
			"Fonepay A",
			"Fonepay B",
			"Fonepay C",
			"eSewa",
			"Bank transfer",
		]) {
			const base = id(all, label);
			assert.equal(id([...all].reverse(), label), base, `${label}: reversed`);
			assert.equal(
				id([bank, c, esewa, a, b], label),
				base,
				`${label}: shuffled`,
			);
			assert.equal(
				id(
					all.filter((m) => m.label === label || m.kind === "bank"),
					label,
				),
				base,
				`${label}: others removed`,
			);
			assert.equal(
				id([...all, fonepay("Fonepay D", 4)], label),
				base,
				`${label}: one added`,
			);
		}
	});

	test("differs for QR-only methods with different QR codes, and for the same QR under another label", () => {
		const sameQr = { ...b, label: "Fonepay B again", qrImageUrl: b.qrImageUrl };
		const ids = methodsOf([a, b, c, sameQr]).map((method) => method.id);

		assert.equal(new Set(ids).size, 4);
		assert.ok(
			ids.every((id) => !id.includes("#")),
			"no ordinal among distinct methods",
		);
		const noQr = methodsOf([
			fonepay("Fonepay", null),
			fonepay("Fonepay again", null),
		]);
		assert.notEqual(noQr[0].id, noQr[1].id);
	});

	test("the order among them is used only for methods identical in every field", () => {
		const twin = { ...a };
		const ids = methodsOf([a, twin, b]).map((method) => method.id);

		assert.equal(ids[1], `${ids[0]}#1`);
		assert.ok(!ids[2].includes("#"), "a method of its own has no ordinal");
		assert.deepEqual(
			methodsOf([a, twin, twin]).map((method) => method.id.split("#")[1]),
			[undefined, "1", "2"],
		);
	});

	test("a part that looks like an ordinal or a separator can't make two methods one", () => {
		const ids = methodsOf([
			{ ...bank, accountNumber: "7", bankName: "x" },
			{ ...bank, accountNumber: "7|x", bankName: null },
			{ ...bank, accountNumber: "7#1", bankName: "x" },
		]).map((method) => method.id);

		assert.equal(new Set(ids).size, 3);
		assert.ok(
			ids.every((id) => !id.includes("#")),
			ids.join(" "),
		);
	});

	test("a kind the page can't take doesn't shift anyone's identity", () => {
		const cash = { ...bank, kind: "cash" as never };

		assert.deepEqual(
			methodsOf([cash, esewa, bank]).map((method) => method.id),
			methodsOf([esewa, bank]).map((method) => method.id),
		);
	});

	test("a picked QR-only method survives [A,B,C] -> [B,C], [C,B] and [A,B,C] again: its own QR shows", () => {
		for (const after of [[b, c], [c, b], [a, b, c], [c, a, b], [b]]) {
			const shown = shownAfter([a, b, c], "Fonepay B", after);
			assert.equal(
				shown?.label,
				"Fonepay B",
				after.map((m) => m.label).join(","),
			);
			assert.equal(shown?.qr, b.qrImageUrl);
		}
	});

	test("when the picked method is gone, or its QR was re-uploaded, the first one shows", () => {
		assert.equal(
			shownAfter([a, b, c], "Fonepay B", [a, c])?.label,
			"Fonepay A",
		);
		assert.equal(
			shownAfter([a, b, c], "Fonepay B", [c, a])?.label,
			"Fonepay C",
		);
		const reuploaded = {
			...b,
			qrImageUrl: "https://api.example.com/uploads/fonepay-2b.png",
		};
		assert.equal(
			shownAfter([a, b, c], "Fonepay B", [a, reuploaded, c])?.label,
			"Fonepay A",
		);
	});
});

describe("the answer follows an explicit pick (TAT-110 fix round 1)", () => {
	const [esewa, bank] = PAGE.paymentMethods;
	const bankB = {
		...bank,
		label: "Bank B",
		bankName: "Global IME",
		accountNumber: "555000111",
	};
	const view = (...paymentMethods: DepositPage["paymentMethods"]) =>
		depositView(page({ paymentMethods }));

	test("every pick is a new event, a second one of the same kind too", () => {
		const first = pickMethod(null, { id: "bank:1", kind: "bank" });
		const second = pickMethod(first, { id: "bank:2", kind: "bank" });

		assert.deepEqual(first, { id: "bank:1", kind: "bank", count: 1 });
		assert.deepEqual(second, { id: "bank:2", kind: "bank", count: 2 });
	});

	test("a pick gives its kind once; the same pick again, no pick, or a kind the form lacks gives nothing", () => {
		const pick: MethodPick = { id: "bank:1", kind: "bank", count: 3 };
		const kinds: readonly DepositMethodKind[] = ["esewa", "bank"];

		assert.equal(answerFor(pick, 2, kinds), "bank");
		assert.equal(answerFor(pick, 3, kinds), null);
		assert.equal(answerFor(null, 0, kinds), null);
		assert.equal(answerFor(pick, 2, ["esewa"]), null);
	});

	/**
	 * What the page does, with the page's own functions: the radios call
	 * pickMethod, the form applies answerFor after every render, a refetch
	 * only replaces the view, and the client can change the answer by hand.
	 */
	function client(first: DepositView) {
		let current = first;
		let picked: MethodPick | null = null;
		let applied = 0;
		let answer = "";
		const render = () => {
			const kind = answerFor(picked, applied, current.kinds);
			if (picked) applied = picked.count;
			if (kind) answer = kind;
		};
		return {
			pick(label: string) {
				const method = current.methods.find((each) => each.label === label);
				assert.ok(method, label);
				picked = pickMethod(picked, method);
				render();
			},
			setAnswer(kind: string) {
				answer = kind;
			},
			refetch(next: DepositView) {
				current = next;
				render();
			},
			get answer() {
				return answer;
			},
			get shown() {
				return selectedMethod(current.methods, picked?.id ?? null);
			},
		};
	}

	test("nothing is answered before a pick, though the first method shows", () => {
		const page = client(view(esewa, bank));

		assert.equal(page.answer, "");
		assert.equal(page.shown?.kind, "esewa");
	});

	test("picking the bank, then the studio reorders: the details and the answer stay the bank", () => {
		const page = client(view(esewa, bank));
		page.pick("Bank transfer");

		page.refetch(view(bank, esewa));

		assert.equal(page.shown?.kind, "bank");
		assert.equal(page.shown?.bankName, "Nabil Bank");
		assert.equal(page.answer, "bank");
	});

	test("two bank accounts and eSewa: bank A, a hand-made eSewa answer, bank B: the answer is the bank again", () => {
		const page = client(view(esewa, bank, bankB));
		page.pick("Bank transfer");
		assert.equal(page.answer, "bank");
		page.setAnswer("esewa");

		page.pick("Bank B");

		assert.equal(page.shown?.bankName, "Global IME");
		assert.equal(page.answer, "bank");
	});

	test("a refetch with the same methods changes nothing, a hand-made answer included", () => {
		const page = client(view(esewa, bank));
		page.pick("Bank transfer");
		page.setAnswer("esewa");

		page.refetch(view(esewa, bank));
		page.refetch(view(esewa, bank));

		assert.equal(page.shown?.kind, "bank");
		assert.equal(page.answer, "esewa");
	});

	test("a refetch after which the picked method is gone shows the first and keeps the answer", () => {
		const page = client(view(esewa, bank));
		page.pick("Bank transfer");
		page.setAnswer("bank");

		page.refetch(view(esewa));

		assert.equal(page.shown?.kind, "esewa");
		assert.equal(page.answer, "bank");
	});
});
