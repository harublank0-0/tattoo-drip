import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { accessAt, isPaidInFull, paidPeriod } from "#modules/billing/access";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const period = (from: string, to: string) => ({
	startsAt: at(from),
	endsAt: at(to),
});

test.group("Billing access (paid invoices only)", () => {
	test("an active subscription without a paid period grants nothing", ({
		assert,
	}) => {
		const now = at("2026-11-13T12:00:00Z");
		assert.deepEqual(
			accessAt([], { status: "active", trialEndsAt: null }, now),
			{ state: "none" },
		);
		assert.deepEqual(
			accessAt([], { status: "past_due", trialEndsAt: null }, now),
			{ state: "none" },
		);
	});

	test("a paid period covers its days, and back-to-back periods extend it", ({
		assert,
	}) => {
		const now = at("2026-11-13T12:00:00Z");
		const nov = period("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
		const dec = period("2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z");
		const access = accessAt([dec, nov], null, now);
		assert.equal(access.state, "paid");
		assert.equal(
			access.state === "paid" && access.until.toISO(),
			at("2027-01-01T00:00:00Z").toISO(),
		);
		// A gap stops the run.
		const feb = period("2027-02-01T00:00:00Z", "2027-03-01T00:00:00Z");
		const gap = accessAt([nov, feb], null, now);
		assert.equal(
			gap.state === "paid" && gap.until.toISO(),
			at("2026-12-01T00:00:00Z").toISO(),
		);
		// The end is exclusive: the next period must be paid.
		assert.deepEqual(accessAt([nov], null, at("2026-12-01T00:00:00Z")), {
			state: "none",
		});
	});

	test("a trial grants trial access until it ends, never paid access", ({
		assert,
	}) => {
		const now = at("2026-11-13T12:00:00Z");
		const trial = {
			status: "trialing",
			trialEndsAt: at("2026-11-20T00:00:00Z"),
		};
		assert.equal(accessAt([], trial, now).state, "trial");
		assert.equal(accessAt([], trial, at("2026-11-21T00:00:00Z")).state, "none");
	});

	test("an invoice is paid in full only when paid, in NPR, for at least what was due", ({
		assert,
	}) => {
		const paid = {
			status: "paid",
			amountDue: 250_000,
			amountPaid: 250_000,
			currency: "NPR",
		};
		assert.isTrue(isPaidInFull(paid));
		assert.isFalse(isPaidInFull({ ...paid, amountPaid: 249_999 }));
		assert.isFalse(isPaidInFull({ ...paid, status: "open" }));
		assert.isFalse(isPaidInFull({ ...paid, currency: "USD" }));
		assert.isFalse(isPaidInFull({ ...paid, amountPaid: Number.NaN }));
	});

	test("the granted period is the invoice's own, else one plan interval from payment", ({
		assert,
	}) => {
		const paidAt = at("2026-11-02T10:00:00Z");
		const own = paidPeriod(
			{
				periodStart: at("2026-11-01T00:00:00Z"),
				periodEnd: at("2026-12-01T00:00:00Z"),
				paidAt,
			},
			null,
		);
		assert.equal(own?.endsAt.toISO(), at("2026-12-01T00:00:00Z").toISO());
		const quarterly = paidPeriod(
			{ periodStart: null, periodEnd: null, paidAt },
			{ intervalUnit: "quarter", intervalCount: 1 },
		);
		assert.equal(quarterly?.endsAt.toISO(), paidAt.plus({ months: 3 }).toISO());
		assert.isNull(
			paidPeriod({ periodStart: null, periodEnd: null, paidAt }, null),
		);
	});
});
