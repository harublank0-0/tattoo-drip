import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { GatewayRuleError } from "#modules/payments/errors";
import {
	checkoutAmount,
	checkoutMetadata,
	eventObjectId,
	reviewReasonFor,
} from "#modules/payments/services/gateway_checkout_service";
import {
	netOf,
	periodOf,
	type TransactionRecord,
	transactionsCsv,
} from "#modules/payments/transactions";

const checkout = {
	id: "0190f000-0000-7000-8000-000000000001",
	tenantId: "0190f000-0000-7000-8000-0000000000aa",
	projectId: "0190f000-0000-7000-8000-0000000000bb",
	purpose: "deposit" as const,
	amount: 300_000,
	currency: "NPR",
	livemode: false,
	providerSessionId: "cs_1",
};
const good = {
	status: "success",
	amount: 300_000,
	currency: "NPR",
	livemode: false,
	sessionId: "cs_1",
	metadata: checkoutMetadata(checkout),
	method: "esewa",
};

test.group("Online payments: amounts and matching", () => {
	test("the stored paisa is the checkout amount, unchanged, inside PayBridgeNP's bounds", ({
		assert,
	}) => {
		assert.equal(checkoutAmount(300_000), 300_000);
		assert.equal(checkoutAmount(300_000n), 300_000);
		assert.equal(checkoutAmount(1_000), 1_000);
		assert.equal(checkoutAmount(100_000_000), 100_000_000);
		for (const bad of [999, 100_000_001, 1_000.5, Number.NaN, 2n ** 60n]) {
			assert.throws(() => checkoutAmount(bad), GatewayRuleError);
		}
	});

	test("a payment matching its checkout in every way is recorded", ({
		assert,
	}) => {
		assert.isNull(reviewReasonFor(good, checkout));
		for (const method of ["esewa", "khalti", "fonepay"]) {
			assert.isNull(reviewReasonFor({ ...good, method }, checkout));
		}
	});

	test("any mismatch holds the payment for review, with its reason", ({
		assert,
	}) => {
		assert.equal(
			reviewReasonFor({ ...good, amount: 299_999 }, checkout),
			"amount_mismatch",
		);
		assert.equal(
			reviewReasonFor({ ...good, amount: 300_001 }, checkout),
			"amount_mismatch",
		);
		assert.equal(
			reviewReasonFor({ ...good, currency: "USD" }, checkout),
			"currency_mismatch",
		);
		assert.equal(
			reviewReasonFor({ ...good, livemode: true }, checkout),
			"mode_mismatch",
		);
		assert.equal(
			reviewReasonFor({ ...good, sessionId: "cs_2" }, checkout),
			"session_mismatch",
		);
		assert.equal(
			reviewReasonFor(
				{
					...good,
					metadata: { ...good.metadata, td_tenant_id: "someone else" },
				},
				checkout,
			),
			"metadata_mismatch",
		);
		assert.equal(
			reviewReasonFor({ ...good, metadata: {} }, checkout),
			"metadata_mismatch",
		);
		assert.equal(
			reviewReasonFor({ ...good, method: "card" }, checkout),
			"unsupported_method",
		);
	});

	test("an event names its payment, or a refund's payment", ({ assert }) => {
		assert.equal(
			eventObjectId({ type: "payment.succeeded", data: { id: "pay_1" } }),
			"pay_1",
		);
		assert.equal(
			eventObjectId({ type: "payment.refunded", data: { id: "pay_1" } }),
			"pay_1",
		);
		assert.equal(
			eventObjectId({
				type: "refund.succeeded",
				data: { id: "rf_1", paymentId: "pay_1" },
			}),
			"pay_1",
		);
		assert.equal(
			eventObjectId({
				type: "refund.succeeded",
				data: { id: "rf_1", payment_id: "pay_2" },
			}),
			"pay_2",
		);
		assert.equal(
			eventObjectId({
				type: "payment.cancelled",
				data: { session_id: "cs_1" },
			}),
			"cs_1",
		);
		assert.isNull(eventObjectId({ type: "payment.succeeded", data: {} }));
	});
});

test.group("Transactions: periods, totals and the CSV", () => {
	test("the period is the studio's days, 30 by default, at most a year", ({
		assert,
	}) => {
		const now = DateTime.fromISO("2026-11-13T20:00:00Z");
		const period = periodOf(null, null, "Asia/Kathmandu", now);
		// 20:00 UTC is already the 14th in Kathmandu (UTC+5:45).
		assert.equal(period.to, "2026-11-14");
		assert.equal(period.from, "2026-10-16");
		assert.equal(period.startsAt.toISO(), "2026-10-15T18:15:00.000Z");
		assert.equal(period.endsBefore.toISO(), "2026-11-14T18:15:00.000Z");
		const swapped = periodOf("2026-11-10", "2026-11-01", "Asia/Kathmandu", now);
		assert.deepEqual([swapped.from, swapped.to], ["2026-11-01", "2026-11-10"]);
		const long = periodOf("2020-01-01", "2026-11-01", "Asia/Kathmandu", now);
		assert.equal(long.from, "2025-11-01");
		const junk = periodOf("2026-13-45", "nope", "Asia/Kathmandu", now);
		assert.equal(junk.to, "2026-11-14");
	});

	test("net collected is gross less refunds, with reversals", ({ assert }) => {
		assert.equal(
			netOf({ gross: 900_000, refunds: 100_000, reversals: 0 }),
			800_000,
		);
		assert.equal(
			netOf({ gross: 900_000, refunds: 100_000, reversals: -300_000 }),
			500_000,
		);
	});

	test("the CSV is safe in spreadsheets and in the studio's time zone", ({
		assert,
	}) => {
		const row: TransactionRecord = {
			id: "x",
			source: "ledger",
			type: "deposit",
			status: "succeeded",
			provider: "khalti",
			online: true,
			amount: 300_050,
			currency: "NPR",
			createdAt: DateTime.fromISO("2026-11-13T20:00:00Z"),
			settledAt: DateTime.fromISO("2026-11-13T20:00:00Z"),
			occurredAt: DateTime.fromISO("2026-11-13T20:00:00Z"),
			projectId: "p",
			projectBrief: '=HYPERLINK("x")',
			clientId: "c",
			clientName: 'Asha, "Rai"',
			note: "+1",
			providerRef: "@ref",
			providerId: "pay_1",
			failureReason: null,
			reviewReason: null,
			onlineRefunded: 0,
			checkoutId: "g",
		};
		const [header, line] = transactionsCsv([row], "Asia/Kathmandu").split(
			"\r\n",
		);
		assert.isTrue(header.startsWith("date,time,type,status,provider"));
		assert.isTrue(
			line.startsWith(
				"2026-11-14,01:45,deposit,succeeded,khalti,yes,3000.50,NPR,",
			),
		);
		assert.include(line, `"Asha, ""Rai"""`);
		assert.include(line, `"'=HYPERLINK(""x"")"`);
		assert.include(line, `"'+1"`);
		assert.include(line, `"'@ref"`);
	});
});
