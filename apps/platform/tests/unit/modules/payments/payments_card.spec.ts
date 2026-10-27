import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	balanceOf,
	depositMoney,
	settleableDeposit,
} from "#modules/payments/ledger";
import type DepositOutcome from "#modules/payments/models/deposit_outcome";
import type Payment from "#modules/payments/models/payment";
import { paymentsCard } from "#modules/payments/payments_card";
import type { ProjectMoney } from "#modules/payments/services/payment_service";
import type Quote from "#modules/projects/models/quote";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

const KTM = "Asia/Kathmandu";
// 08:20 UTC is 14:05 in Kathmandu (UTC+5:45).
const AT = DateTime.fromISO("2026-10-18T08:20:00Z");
const ASHA = "user-asha";

let next = 0;
function payment(over: Partial<Payment> = {}): Payment {
	next += 1;
	return {
		id: `p${next}`,
		kind: "deposit",
		amount: 300_000,
		currency: "NPR",
		method: "cash",
		status: "verified",
		correctsPaymentId: null,
		verifiedAt: AT,
		verifiedByUserId: ASHA,
		createdAt: AT,
		note: null,
		proofImageKey: null,
		proofImageWidth: null,
		proofImageHeight: null,
		...over,
	} as unknown as Payment;
}

const quote = (over: Partial<Quote> = {}) =>
	({
		kind: "fixed",
		fixedPrice: 1_500_000,
		hourlyRate: null,
		estimatedMinutes: null,
		depositAmount: 300_000,
		currency: "NPR",
		...over,
	}) as unknown as Quote;

/** ProjectMoney the way forProject computes it. */
function money(
	payments: Payment[],
	current: Quote | null = quote(),
	status: ProjectStatus = "booked",
	outcome: DepositOutcome | null = null,
): ProjectMoney {
	const balance = balanceOf(current, payments);
	const depositHeld = depositMoney(payments, balance.currency);
	const depositSettleable = settleableDeposit(payments, balance.currency);
	return {
		quote: current,
		payments,
		balance,
		depositHeld,
		depositSettleable,
		depositDue: current ? Math.max(0, current.depositAmount - depositHeld) : 0,
		outcome,
		outcomeNeeded:
			["cancelled", "declined"].includes(status) &&
			depositSettleable > 0 &&
			!outcome,
	};
}

const card = (
	data: ProjectMoney,
	status: ProjectStatus,
	isOwner = true,
	proofUrls = new Map<string, string>(),
) =>
	paymentsCard({
		money: data,
		status,
		isOwner,
		timezone: KTM,
		names: new Map([[ASHA, "Asha Rai"]]),
		proofUrls,
		referenceCode: "7KQ2MX",
	});

test.group("paymentsCard", () => {
	test("an owner gets a waiting screenshot next to what was asked and the reference code", ({
		assert,
	}) => {
		const proof = payment({
			status: "submitted",
			verifiedAt: null,
			verifiedByUserId: null,
			method: "esewa",
			proofImageKey: "k",
			proofImageWidth: 600,
			proofImageHeight: 800,
		});
		const props = card(
			money([proof], quote(), "deposit_pending"),
			"deposit_pending",
			true,
			new Map([[proof.id, "https://files/signed"]]),
		);

		assert.deepEqual(props.pending, [
			{
				paymentId: proof.id,
				imageUrl: "https://files/signed",
				width: 600,
				height: 800,
				expectedText: "NPR 3,000",
				referenceCode: "7KQ2MX",
				method: "esewa",
				sentText: "18 Oct 2026, 14:05",
				dueNowText: null,
			},
		]);
		assert.deepInclude(props.rows[0], {
			decisionText: "Waiting for an owner",
			proofUrl: null,
			canReverse: false,
		});
	});

	test("a screenshot sent before a revision says what is due now", ({
		assert,
	}) => {
		const proof = payment({
			status: "submitted",
			verifiedAt: null,
			verifiedByUserId: null,
		});
		const props = card(
			money([proof], quote({ depositAmount: 400_000 }), "deposit_pending"),
			"deposit_pending",
		);
		assert.equal(props.pending[0].dueNowText, "NPR 4,000");
	});

	test("a screenshot waiting while a part of the deposit came in at the desk says what is due now", ({
		assert,
	}) => {
		const proof = payment({
			status: "submitted",
			verifiedAt: null,
			verifiedByUserId: null,
		});
		const desk = payment({ amount: 100_000 });
		const props = card(
			money([proof, desk], quote(), "deposit_pending"),
			"deposit_pending",
		);
		// The quote is unchanged (NPR 3,000): the amount due moved because
		// NPR 1,000 was received, which the screen's sentence must not blame
		// on a quote change.
		assert.equal(props.pending[0].dueNowText, "NPR 2,000");
	});

	test("rows say who decided and how; reversals point both ways", ({
		assert,
	}) => {
		const desk = payment();
		const shot = payment({
			proofImageKey: "k",
			proofImageWidth: 1,
			proofImageHeight: 1,
		});
		const turnedDown = payment({ status: "rejected", verifiedByUserId: null });
		const reversal = payment({
			kind: "correction",
			amount: -300_000,
			correctsPaymentId: desk.id,
			createdAt: AT.plus({ days: 1 }),
		});
		const props = card(
			money([reversal, turnedDown, shot, desk]),
			"booked",
			true,
			new Map([[shot.id, "https://files/shot"]]),
		);
		const row = (id: string) => props.rows.find((r) => r.id === id);

		assert.deepInclude(row(desk.id), {
			decisionText: "Recorded by Asha Rai, 18 Oct 2026",
			reversalText: "Reversed 19 Oct 2026",
			canReverse: false,
		});
		assert.deepInclude(row(shot.id), {
			decisionText: "Verified by Asha Rai, 18 Oct 2026",
			proofUrl: "https://files/shot",
			canReverse: true,
		});
		assert.deepInclude(row(turnedDown.id), {
			decisionText: "Rejected by a deleted account, 18 Oct 2026",
			canReverse: false,
		});
		assert.deepInclude(row(reversal.id), {
			amountText: "−NPR 3,000",
			reversalText: "Reverses the NPR 3,000 deposit of 18 Oct 2026",
			canReverse: false,
		});
	});

	test("the balance: due, paid in full, overpaid, no price, and a closed project's holding", ({
		assert,
	}) => {
		const state = (data: ProjectMoney, status: ProjectStatus = "booked") => {
			const { balance } = card(data, status);
			return [balance.state, balance.amountText];
		};

		assert.deepEqual(state(money([payment()])), ["due", "NPR 12,000"]);
		assert.deepEqual(state(money([payment({ amount: 1_500_000 })])), [
			"paid",
			null,
		]);
		assert.deepEqual(state(money([payment({ amount: 1_550_000 })])), [
			"overpaid",
			"NPR 500",
		]);
		assert.deepEqual(state(money([], null)), ["no_price", null]);
		assert.deepEqual(
			state(money([payment()], quote(), "cancelled"), "cancelled"),
			["closed", "NPR 3,000"],
		);
		// Refunded beyond what it received: no "Holds −NPR x".
		const refunded = (amount: number) =>
			money(
				[payment(), payment({ kind: "refund", amount: -amount })],
				quote(),
				"cancelled",
			);
		assert.deepEqual(state(refunded(300_000), "cancelled"), [
			"closed",
			"NPR 0",
		]);
		assert.deepEqual(state(refunded(450_000), "cancelled"), [
			"over_refunded",
			"NPR 1,500",
		]);
		const hourly = card(
			money(
				[],
				quote({
					kind: "hourly",
					fixedPrice: null,
					hourlyRate: 300_000,
					estimatedMinutes: 300,
				}),
			),
			"booked",
		);
		assert.deepEqual(
			[hourly.balance.totalText, hourly.balance.totalNote],
			["NPR 15,000", "estimated: 5 h at NPR 3,000/hour"],
		);
	});

	test("the summary is one line for every balance state (TAT-108)", ({
		assert,
	}) => {
		const summary = (data: ProjectMoney, status: ProjectStatus = "booked") =>
			card(data, status).summary;

		assert.equal(
			summary(money([payment()])),
			"Paid NPR 3,000 of NPR 15,000 · Balance NPR 12,000",
		);
		assert.equal(
			summary(money([])),
			"Paid NPR 0 of NPR 15,000 · Balance NPR 15,000",
		);
		// An hourly quote's total is an estimate, and so is what is left.
		const hourly = quote({
			kind: "hourly",
			fixedPrice: null,
			hourlyRate: 300_000,
			estimatedMinutes: 300,
		});
		assert.equal(
			summary(money([payment()], hourly)),
			"Paid NPR 3,000 of NPR 15,000 · Balance NPR 12,000 (estimated)",
		);
		assert.equal(
			summary(money([payment({ amount: 1_500_000 })])),
			"Paid in full: NPR 15,000",
		);
		assert.equal(
			summary(money([payment({ amount: 1_550_000 })])),
			"Paid NPR 15,500 of NPR 15,000 · Overpaid by NPR 500",
		);
		assert.equal(summary(money([], null)), "No price yet");
		assert.equal(
			summary(money([payment()], null)),
			"Paid NPR 3,000 · No price yet",
		);
		// A declined or cancelled project holds what it received, or nothing.
		assert.equal(
			summary(money([payment()], quote(), "cancelled"), "cancelled"),
			"Holds NPR 3,000",
		);
		assert.equal(
			summary(money([], quote(), "declined"), "declined"),
			"Nothing paid",
		);
		const refunded = (amount: number) =>
			money(
				[payment(), payment({ kind: "refund", amount: -amount })],
				quote(),
				"cancelled",
			);
		assert.equal(summary(refunded(300_000), "cancelled"), "Nothing paid");
		assert.equal(
			summary(refunded(450_000), "cancelled"),
			"Refunded NPR 1,500 more than it received",
		);
		// The artist's card carries the same line: it holds no more than the balance.
		assert.equal(
			card(money([payment()]), "booked", false).summary,
			"Paid NPR 3,000 of NPR 15,000 · Balance NPR 12,000",
		);
	});

	test("the deposit line: received, covered, and lapsed after a reversal on a booked project", ({
		assert,
	}) => {
		const deposit = payment({ amount: 100_000 });
		assert.deepEqual(card(money([deposit]), "deposit_pending").deposit, {
			amountText: "NPR 3,000",
			receivedText: "NPR 1,000",
			dueText: "NPR 2,000",
			covered: false,
			lapsed: false,
		});
		assert.isTrue(card(money([payment()]), "booked").deposit?.covered);
		const full = payment();
		const reversed = money([
			payment({
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: full.id,
			}),
			full,
		]);
		assert.isTrue(card(reversed, "booked").deposit?.lapsed);
		assert.isNull(
			card(money([], quote({ depositAmount: 0 })), "booked").deposit,
		);
	});

	test("an owner's actions follow the status; an artist gets none, no screenshots and no outcome form", ({
		assert,
	}) => {
		const waitingDeposit = card(
			money([], quote(), "deposit_pending"),
			"deposit_pending",
		);
		assert.deepEqual(waitingDeposit.actions, {
			recordKinds: ["deposit", "session", "balance"],
			depositDue: 3000,
			balanceDue: 15000,
			refundMax: null,
			refundMaxText: null,
		});
		assert.deepEqual(card(money([payment()]), "booked").actions?.recordKinds, [
			"session",
			"balance",
		]);
		assert.deepEqual(
			card(money([payment()]), "booked").actions?.refundMax,
			3000,
		);
		assert.deepEqual(
			card(money([], quote(), "declined"), "declined").actions?.recordKinds,
			[],
		);

		const closed = money([payment()], quote(), "cancelled");
		const owner = card(closed, "cancelled");
		assert.deepEqual(owner.outcome.needed, {
			held: 3000,
			heldText: "NPR 3,000",
		});
		assert.isNull(owner.actions?.refundMax ?? null, "the outcome comes first");

		// Part of the deposit went back before the close: the form is about the rest.
		const partly = card(
			money(
				[payment(), payment({ kind: "refund", amount: -200_000 })],
				quote(),
				"cancelled",
			),
			"cancelled",
		);
		assert.deepEqual(partly.outcome.needed, {
			held: 1000,
			heldText: "NPR 1,000",
		});
		// All of it went back: nothing to record, and the refund form is not blocked.
		const none = card(
			money(
				[payment(), payment({ kind: "refund", amount: -300_000 })],
				quote(),
				"cancelled",
			),
			"cancelled",
		);
		assert.isNull(none.outcome.needed);

		const shot = payment({
			proofImageKey: "k",
			proofImageWidth: 1,
			proofImageHeight: 1,
		});
		const artist = card(
			money([shot], quote(), "cancelled"),
			"cancelled",
			false,
			new Map([[shot.id, "u"]]),
		);
		assert.isNull(artist.actions);
		assert.deepEqual(artist.pending, []);
		assert.isNull(artist.outcome.needed);
		assert.deepInclude(artist.rows[0], { proofUrl: null, canReverse: false });
	});

	test("a recorded outcome reads as what the studio decided", ({ assert }) => {
		const refund = payment({ kind: "refund", amount: -200_000 });
		const outcome = {
			outcome: "refunded",
			amount: 300_000,
			refundPaymentId: refund.id,
			recordedByUserId: ASHA,
			createdAt: AT,
			note: "Half back",
		} as unknown as DepositOutcome;
		const props = card(
			money([refund, payment()], quote(), "cancelled", outcome),
			"cancelled",
		);

		assert.deepEqual(props.outcome.recorded, {
			text: "Deposit refunded: NPR 2,000 of NPR 3,000 back to the client.",
			recordedText: "Recorded 18 Oct 2026 by Asha Rai",
			note: "Half back",
		});
		const kept = {
			...outcome,
			outcome: "kept",
			refundPaymentId: null,
		} as unknown as DepositOutcome;
		assert.equal(
			card(money([payment()], quote(), "cancelled", kept), "cancelled").outcome
				.recorded?.text,
			"Deposit kept by the studio: NPR 3,000.",
		);
	});
});
