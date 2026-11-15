import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	accessAt,
	accessMode,
	isPaidInFull,
	paidPeriod,
} from "#modules/billing/access";

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
				issuedAt: at("2026-11-01T00:00:00Z"),
				paidAt,
			},
			null,
		);
		assert.equal(own?.endsAt.toISO(), at("2026-12-01T00:00:00Z").toISO());
		const quarterly = paidPeriod(
			{ periodStart: null, periodEnd: null, issuedAt: null, paidAt },
			{ intervalUnit: "quarter", intervalCount: 1 },
		);
		assert.equal(quarterly?.endsAt.toISO(), paidAt.plus({ months: 3 }).toISO());
		assert.isNull(
			paidPeriod(
				{ periodStart: null, periodEnd: null, issuedAt: null, paidAt },
				null,
			),
		);
	});

	test("a stored period that doesn't hold the invoice's issue date was read later: one plan interval from the issue date instead", ({
		assert,
	}) => {
		const monthly = { intervalUnit: "month", intervalCount: 1 } as const;
		// A December invoice first read in January, when the subscription
		// had renewed onto a yearly plan: its stored window is the year.
		const late = {
			periodStart: at("2027-01-01T00:00:00Z"),
			periodEnd: at("2028-01-01T00:00:00Z"),
			issuedAt: at("2026-12-01T00:00:00Z"),
			paidAt: at("2027-01-03T09:00:00Z"),
		};
		const period = paidPeriod(late, monthly);
		assert.equal(period?.startsAt.toISO(), at("2026-12-01T00:00:00Z").toISO());
		assert.equal(period?.endsAt.toISO(), at("2027-01-01T00:00:00Z").toISO());
		// Without the invoice's plan there is nothing sound to grant.
		assert.isNull(paidPeriod(late, null));
		// Issued a little before its period starts still counts as its own.
		const early = paidPeriod(
			{
				periodStart: at("2026-12-01T00:00:00Z"),
				periodEnd: at("2027-01-01T00:00:00Z"),
				issuedAt: at("2026-11-30T22:00:00Z"),
				paidAt: null,
			},
			null,
		);
		assert.equal(early?.startsAt.toISO(), at("2026-12-01T00:00:00Z").toISO());
		// No issue date to check the stored period against: it stands, since
		// the payment date can't check it (an overdue invoice is paid after
		// its period started, or even after it ended).
		const undated = paidPeriod(
			{
				periodStart: at("2026-11-01T00:00:00Z"),
				periodEnd: at("2026-12-01T00:00:00Z"),
				issuedAt: null,
				paidAt: at("2026-12-05T00:00:00Z"),
			},
			monthly,
		);
		assert.equal(undated?.startsAt.toISO(), at("2026-11-01T00:00:00Z").toISO());
		// Never from today's date: no issue or payment date, no period.
		assert.isNull(
			paidPeriod(
				{ periodStart: null, periodEnd: null, issuedAt: null, paidAt: null },
				monthly,
			),
		);
	});

	test("a revoked period counts until its revocation, and a run of periods stops there", ({
		assert,
	}) => {
		const nov = {
			...period("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
			revokedAt: at("2026-11-10T08:00:00Z"),
		};
		const dec = period("2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z");
		const before = accessAt([nov, dec], null, at("2026-11-09T00:00:00Z"));
		assert.equal(before.state, "paid");
		assert.equal(
			before.state === "paid" && before.until.toISO(),
			at("2026-11-10T08:00:00Z").toISO(),
		);
		assert.deepEqual(accessAt([nov, dec], null, at("2026-11-12T00:00:00Z")), {
			state: "none",
		});
		const later = accessAt([nov, dec], null, at("2026-12-05T00:00:00Z"));
		assert.equal(
			later.state === "paid" && later.until.toISO(),
			at("2027-01-01T00:00:00Z").toISO(),
		);
		// Revoked before it began: it never grants anything.
		const unused = {
			...period("2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z"),
			revokedAt: at("2026-11-20T00:00:00Z"),
		};
		assert.deepEqual(accessAt([unused], null, at("2026-12-05T00:00:00Z")), {
			state: "none",
		});
	});

	test("access reads the key's mode; with no key, live in production and nothing elsewhere", ({
		assert,
	}) => {
		assert.equal(accessMode("sandbox", false), "sandbox");
		assert.equal(accessMode("live", false), "live");
		assert.equal(accessMode("sandbox", true), "sandbox");
		assert.equal(accessMode(null, true), "live");
		assert.isNull(accessMode(null, false));
	});
});
