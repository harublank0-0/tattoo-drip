import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import {
	DEPOSIT_CHASE_DAYS,
	groupOf,
	type NeedsYouReason,
	QUOTE_ENDING_DAYS,
	quoteEndingBefore,
	sinceOf,
	TODAY_GROUP_ORDER,
	WAITING_HASH,
	type Waiting,
	type WaitingContext,
	type WaitingFacts,
	waitingOf,
	waitingText,
} from "#modules/projects/waiting";

const KTM = "Asia/Kathmandu";
// A Thursday.
const now = DateTime.fromISO("2026-10-22T10:00:00", { zone: KTM });
const owner: WaitingContext = { isOwner: true, now, timezone: KTM };
const artist: WaitingContext = { isOwner: false, now, timezone: KTM };

/** The expiry of a quote valid through `day` in the studio. */
const expiresOn = (day: string) => expiresAtFor(day, KTM);
const hoursAgo = (hours: number) => now.minus({ hours });

/** A quoted project, quote sent two days ago, valid until 23 Oct, deposit unpaid. */
function facts(over: Partial<WaitingFacts> = {}): WaitingFacts {
	return {
		status: "quoted",
		since: now.minus({ days: 2 }),
		proofWaiting: false,
		proofSince: null,
		expirySpared: false,
		quote: {
			issuedAt: now.minus({ days: 2 }),
			expiresAt: expiresOn("2026-10-23"),
			depositAmount: 300_000,
		},
		depositSettled: false,
		depositLink: null,
		scheduledTattoo: false,
		...over,
	};
}

const quoteValidUntil = (day: string, depositAmount = 300_000) => ({
	issuedAt: now.minus({ days: 2 }),
	expiresAt: expiresOn(day),
	depositAmount,
});

const studio = (reason: NeedsYouReason): Waiting => ({
	side: "studio",
	reason,
});

test.group("waitingOf", () => {
	test("a waiting screenshot is the owner's to check; for an artist it changes nothing", ({
		assert,
	}) => {
		// An owner's first rule: the screenshot, whatever else the project is.
		const f = facts({ status: "deposit_pending", proofWaiting: true });
		assert.deepEqual(waitingOf(f, owner), studio("proof_to_check"));
		// An artist can't act on money (TAT-107 fix 3): the screenshot is skipped and
		// the project shows under the state it has without it, never nothing.
		assert.deepEqual(waitingOf(f, artist), studio("quote_ending"));
		const later = facts({
			status: "deposit_pending",
			proofWaiting: true,
			quote: quoteValidUntil("2026-11-05"),
		});
		assert.deepEqual(waitingOf(later, artist), {
			side: "client",
			reason: "deposit_due",
		});
		assert.deepEqual(waitingOf(later, owner), studio("proof_to_check"));
		// Without a state of its own, an artist's project is simply absent.
		assert.isNull(
			waitingOf(
				facts({ status: "in_progress", quote: null, proofWaiting: true }),
				artist,
			),
		);
	});

	test("a reviewing project needs a price from both roles", ({ assert }) => {
		const f = facts({ status: "reviewing", quote: null });
		assert.deepEqual(waitingOf(f, owner), studio("price_to_send"));
		assert.deepEqual(waitingOf(f, artist), studio("price_to_send"));
	});

	test("a quote that ends within three studio days needs the studio, a later one waits on the client", ({
		assert,
	}) => {
		for (const day of ["2026-10-22", "2026-10-23", "2026-10-24"]) {
			assert.deepEqual(
				waitingOf(facts({ quote: quoteValidUntil(day) }), owner),
				studio("quote_ending"),
				day,
			);
		}
		assert.deepEqual(
			waitingOf(facts({ quote: quoteValidUntil("2026-10-25") }), owner),
			{ side: "client", reason: "price_sent" },
		);
	});

	test("an expired quote the sweep will cancel shows nowhere", ({ assert }) => {
		const expired = {
			issuedAt: now.minus({ days: 5 }),
			expiresAt: now.minus({ minutes: 1 }),
			depositAmount: 300_000,
		};
		// Quoted, nothing paid.
		assert.isNull(waitingOf(facts({ quote: expired }), owner));
		assert.isNull(waitingOf(facts({ quote: expired }), artist));
		// Deposit pending, nothing paid (and a partly paid one is not covered either).
		const pending = facts({ status: "deposit_pending", quote: expired });
		assert.isNull(waitingOf(pending, owner));
		assert.isNull(waitingOf({ ...pending, depositSettled: false }, owner));
		// On hold, nothing paid.
		assert.isNull(
			waitingOf(facts({ status: "on_hold", quote: expired }), owner),
		);
		// A zero deposit is covered by definition and spares nothing: still the sweep's.
		assert.isNull(
			waitingOf(
				facts({
					quote: { ...expired, depositAmount: 0 },
					depositSettled: true,
				}),
				owner,
			),
		);
	});

	test("an expired quote the sweep spares keeps its work (TAT-107 fix 2)", ({
		assert,
	}) => {
		const expired = {
			issuedAt: now.minus({ days: 20 }),
			expiresAt: now.minus({ days: 2 }),
			depositAmount: 300_000,
		};
		// Deposit covered, no session: the project stays deposit_pending forever,
		// so the booking is still the studio's to make.
		const paid = facts({
			status: "deposit_pending",
			quote: expired,
			depositSettled: true,
		});
		for (const context of [owner, artist]) {
			assert.deepEqual(waitingOf(paid, context), studio("no_session"));
		}
		// Once a session is in the calendar there is nothing to do.
		assert.isNull(waitingOf({ ...paid, scheduledTattoo: true }, owner));
		// A quoted project whose deposit was paid (the quote was revised after) stays quoted.
		assert.deepEqual(
			waitingOf(facts({ quote: expired, depositSettled: true }), owner),
			{ side: "client", reason: "price_sent" },
		);
		assert.deepEqual(
			waitingOf(
				facts({ status: "on_hold", quote: expired, depositSettled: true }),
				owner,
			),
			{ side: "client", reason: "on_hold" },
		);
		// A screenshot waiting spares the sweep too (the deposit batch reads it as
		// `expirySpared`): an artist keeps the project.
		assert.deepEqual(
			waitingOf(
				facts({
					status: "deposit_pending",
					quote: expired,
					proofWaiting: true,
					expirySpared: true,
				}),
				artist,
			),
			{ side: "client", reason: "deposit_due" },
		);
	});

	test("an expired quote whose deposit was decided late falls through to the state it has without the expiry (fix round 2)", ({
		assert,
	}) => {
		const expired = {
			issuedAt: now.minus({ days: 20 }),
			expiresAt: now.minus({ days: 2 }),
			depositAmount: 300_000,
		};
		// The sweep spares it (a rejection, a partial verification or a reversal after
		// the expiry): uncovered, expired, and still the studio's to settle.
		const spared = (over: Partial<WaitingFacts>) =>
			facts({ quote: expired, expirySpared: true, ...over });
		const pending = spared({ status: "deposit_pending" });
		// Owner: the deposit-link rules, as for any unpaid deposit.
		assert.deepEqual(waitingOf(pending, owner), studio("deposit_link_missing"));
		assert.deepEqual(
			waitingOf(
				{
					...pending,
					depositLink: { madeAt: hoursAgo(100), works: true },
				},
				owner,
			),
			studio("deposit_unpaid"),
		);
		// Artist: their usual state for an unpaid deposit.
		assert.deepEqual(waitingOf(pending, artist), {
			side: "client",
			reason: "deposit_due",
		});
		// Quoted and on hold: the price still waits on the client.
		assert.deepEqual(waitingOf(spared({}), owner), {
			side: "client",
			reason: "price_sent",
		});
		assert.deepEqual(waitingOf(spared({ status: "on_hold" }), owner), {
			side: "client",
			reason: "on_hold",
		});
		// The converse: the same facts the sweep does cancel are still hidden.
		for (const context of [owner, artist]) {
			assert.isNull(
				waitingOf(
					spared({ status: "deposit_pending", expirySpared: false }),
					context,
				),
			);
			assert.isNull(waitingOf(spared({ expirySpared: false }), context));
		}
	});

	test("a quote whose expiry would cancel nothing is not ending", ({
		assert,
	}) => {
		// A paid deposit spares a quoted project when it expires.
		assert.deepEqual(waitingOf(facts({ depositSettled: true }), owner), {
			side: "client",
			reason: "price_sent",
		});
		// A zero deposit does not: the quote expiring still cancels it.
		assert.deepEqual(
			waitingOf(
				facts({
					quote: quoteValidUntil("2026-10-23", 0),
					depositSettled: true,
				}),
				owner,
			),
			studio("quote_ending"),
		);
	});

	test("a deposit_pending project: ending, paid or waiting, by whether the deposit is covered", ({
		assert,
	}) => {
		const pending = (over: Partial<WaitingFacts>) =>
			facts({ status: "deposit_pending", ...over });
		for (const context of [owner, artist]) {
			assert.deepEqual(waitingOf(pending({}), context), studio("quote_ending"));
		}
		const later = quoteValidUntil("2026-11-05");
		// Covered: the studio books the session, unless one is already in the calendar.
		const covered = pending({ quote: later, depositSettled: true });
		assert.deepEqual(waitingOf(covered, owner), studio("no_session"));
		assert.isNull(waitingOf({ ...covered, scheduledTattoo: true }, owner));
		// A covered deposit whose quote is ending still doesn't count as ending.
		assert.deepEqual(
			waitingOf(pending({ depositSettled: true }), owner),
			studio("no_session"),
		);
	});

	test("an unpaid deposit: no link, a dead link, a young link, an old link, and the artist's view", ({
		assert,
	}) => {
		const pending = (depositLink: WaitingFacts["depositLink"]) =>
			facts({
				status: "deposit_pending",
				quote: quoteValidUntil("2026-11-05"),
				depositLink,
			});
		assert.deepEqual(
			waitingOf(pending(null), owner),
			studio("deposit_link_missing"),
		);
		assert.deepEqual(
			waitingOf(pending({ madeAt: hoursAgo(1), works: false }), owner),
			studio("deposit_link_missing"),
		);
		assert.deepEqual(
			waitingOf(pending({ madeAt: hoursAgo(71), works: true }), owner),
			{ side: "client", reason: "deposit_link_sent" },
		);
		assert.deepEqual(
			waitingOf(pending({ madeAt: hoursAgo(72), works: true }), owner),
			studio("deposit_unpaid"),
		);
		// Artists never see links: any uncovered deposit is the client's.
		for (const link of [
			null,
			{ madeAt: hoursAgo(200), works: true },
			{ madeAt: hoursAgo(1), works: false },
		]) {
			assert.deepEqual(waitingOf(pending(link), artist), {
				side: "client",
				reason: "deposit_due",
			});
		}
		assert.equal(DEPOSIT_CHASE_DAYS, 3);
	});

	test("booked and the other statuses", ({ assert }) => {
		assert.deepEqual(
			waitingOf(facts({ status: "booked", quote: null }), owner),
			studio("no_session"),
		);
		assert.isNull(
			waitingOf(
				facts({ status: "booked", quote: null, scheduledTattoo: true }),
				owner,
			),
		);
		assert.deepEqual(
			waitingOf(
				facts({ status: "on_hold", quote: quoteValidUntil("2026-11-05") }),
				owner,
			),
			{ side: "client", reason: "on_hold" },
		);
		for (const status of ["in_progress", "healing_check"] as ProjectStatus[]) {
			assert.isNull(waitingOf(facts({ status, quote: null }), owner), status);
		}
	});
});

test.group("quoteEndingBefore", () => {
	test("is the studio's midnight three days ahead, across a clock change", ({
		assert,
	}) => {
		assert.equal(QUOTE_ENDING_DAYS, 3);
		const zone = "America/New_York";
		const start = DateTime.fromISO("2026-10-31T12:00", { zone });
		assert.equal(
			quoteEndingBefore(start, zone).toISO(),
			"2026-11-03T00:00:00.000-05:00",
		);
		assert.equal(
			quoteEndingBefore(now, KTM).toISO(),
			"2026-10-25T00:00:00.000+05:45",
		);
	});

	test("at 23:30 in the studio, today's quotes still count as ending", ({
		assert,
	}) => {
		const late = DateTime.fromISO("2026-10-22T23:30:00", { zone: KTM });
		const before = quoteEndingBefore(late, KTM).toMillis();
		for (const day of ["2026-10-22", "2026-10-23", "2026-10-24"]) {
			assert.isAtMost(expiresOn(day).toMillis(), before, day);
		}
		assert.isAbove(expiresOn("2026-10-25").toMillis(), before);
	});
});

test.group("waitingText", () => {
	const text = (waiting: Waiting, f: WaitingFacts, at = now) =>
		waitingText(waiting, f, at, KTM);

	test("studio reasons", ({ assert }) => {
		assert.equal(
			text(studio("proof_to_check"), facts()),
			"Deposit screenshot to check",
		);
		assert.equal(
			text(studio("price_to_send"), facts({ status: "reviewing" })),
			"Accepted 2 days ago, no price yet",
		);
		assert.equal(
			text(
				studio("quote_ending"),
				facts({ quote: quoteValidUntil("2026-10-22") }),
			),
			"The price ends today",
		);
		assert.equal(
			text(
				studio("quote_ending"),
				facts({ quote: quoteValidUntil("2026-10-23") }),
			),
			"The price ends tomorrow",
		);
		assert.equal(
			text(
				studio("quote_ending"),
				facts({ quote: quoteValidUntil("2026-10-24") }),
			),
			"The price ends on Sat 24 Oct",
		);
		assert.equal(
			text(
				studio("quote_ending"),
				facts({
					status: "deposit_pending",
					quote: quoteValidUntil("2026-10-23"),
				}),
			),
			"Deposit not paid. The price ends tomorrow",
		);
		assert.equal(
			text(
				studio("deposit_link_missing"),
				facts({ status: "deposit_pending" }),
			),
			"No deposit link yet",
		);
		assert.equal(
			text(
				studio("deposit_link_missing"),
				facts({
					status: "deposit_pending",
					depositLink: { madeAt: hoursAgo(10), works: false },
				}),
			),
			"The deposit link stopped working",
		);
		assert.equal(
			text(
				studio("deposit_unpaid"),
				facts({
					status: "deposit_pending",
					depositLink: { madeAt: now.minus({ days: 4 }), works: true },
				}),
			),
			"Deposit not paid, link made 4 days ago",
		);
		assert.equal(
			text(studio("no_session"), facts({ status: "booked" })),
			"Booked, no session in the calendar",
		);
		assert.equal(
			text(
				studio("no_session"),
				facts({ status: "deposit_pending", depositSettled: true }),
			),
			"Deposit paid, no session booked",
		);
	});

	test("client reasons", ({ assert }) => {
		assert.equal(
			text({ side: "client", reason: "price_sent" }, facts()),
			"Price sent 2 days ago",
		);
		assert.equal(
			text({ side: "client", reason: "on_hold" }, facts({ status: "on_hold" })),
			"On hold",
		);
		assert.equal(
			text(
				{ side: "client", reason: "deposit_link_sent" },
				facts({ depositLink: { madeAt: now.minus({ days: 1 }), works: true } }),
			),
			"Deposit link sent 1 day ago",
		);
		assert.equal(
			text(
				{ side: "client", reason: "deposit_link_sent" },
				facts({ depositLink: { madeAt: hoursAgo(2), works: true } }),
			),
			"Deposit link sent less than a day ago",
		);
		assert.equal(
			text({ side: "client", reason: "deposit_due" }, facts()),
			"Waiting for the deposit",
		);
	});

	test("a deposit link's age in words follows the 72-hour rule (TAT-107 fix 4)", ({
		assert,
	}) => {
		const link = (hours: number) =>
			facts({
				status: "deposit_pending",
				quote: quoteValidUntil("2026-11-05"),
				depositLink: { madeAt: hoursAgo(hours), works: true },
			});
		const wordsAt = (hours: number) => {
			const f = link(hours);
			const waiting = waitingOf(f, owner);
			return [waiting?.reason, waiting && text(waiting, f)];
		};
		assert.deepEqual(wordsAt(1), [
			"deposit_link_sent",
			"Deposit link sent less than a day ago",
		]);
		assert.deepEqual(wordsAt(23), [
			"deposit_link_sent",
			"Deposit link sent less than a day ago",
		]);
		assert.deepEqual(wordsAt(25), [
			"deposit_link_sent",
			"Deposit link sent 1 day ago",
		]);
		assert.deepEqual(wordsAt(71), [
			"deposit_link_sent",
			"Deposit link sent 2 days ago",
		]);
		assert.deepEqual(wordsAt(72), [
			"deposit_unpaid",
			"Deposit not paid, link made 3 days ago",
		]);
		assert.deepEqual(wordsAt(73), [
			"deposit_unpaid",
			"Deposit not paid, link made 3 days ago",
		]);
		assert.deepEqual(wordsAt(100), [
			"deposit_unpaid",
			"Deposit not paid, link made 4 days ago",
		]);
	});

	test("missing facts fall back to plain words, never a crash", ({
		assert,
	}) => {
		assert.equal(
			text(studio("quote_ending"), facts({ quote: null })),
			"The price ends soon",
		);
		assert.equal(
			text(studio("deposit_unpaid"), facts({ depositLink: null })),
			"Deposit not paid",
		);
		assert.equal(
			text({ side: "client", reason: "price_sent" }, facts({ quote: null })),
			"Price sent",
		);
	});
});

test.group("groups, cards and the date a wait starts", () => {
	test("every studio reason is in exactly one group, in page order", ({
		assert,
	}) => {
		assert.deepEqual(TODAY_GROUP_ORDER, [
			"proofs",
			"requests",
			"prices",
			"ending",
			"deposits",
			"sessions",
		]);
		const reasons: NeedsYouReason[] = [
			"proof_to_check",
			"price_to_send",
			"quote_ending",
			"deposit_link_missing",
			"deposit_unpaid",
			"no_session",
		];
		assert.deepEqual(reasons.map(groupOf), [
			"proofs",
			"prices",
			"ending",
			"deposits",
			"deposits",
			"sessions",
		]);
		for (const reason of reasons) {
			assert.include(TODAY_GROUP_ORDER, groupOf(reason));
		}
	});

	test("each reason opens a card on the project page", ({ assert }) => {
		assert.deepEqual(
			[
				"proof_to_check",
				"price_to_send",
				"quote_ending",
				"deposit_link_missing",
				"deposit_unpaid",
				"no_session",
				"price_sent",
				"on_hold",
				"deposit_link_sent",
				"deposit_due",
			].map((reason) => WAITING_HASH[reason as keyof typeof WAITING_HASH]),
			[
				"payments",
				"quote-form",
				"quote",
				"deposit",
				"deposit",
				"sessions",
				"quote",
				null,
				"deposit",
				null,
			],
		);
	});

	test("sinceOf: the expiry, the link, the quote or the project", ({
		assert,
	}) => {
		const f = facts({
			depositLink: { madeAt: now.minus({ days: 4 }), works: true },
		});
		assert.equal(
			sinceOf(studio("quote_ending"), f).toMillis(),
			f.quote?.expiresAt.toMillis(),
		);
		for (const waiting of [
			studio("deposit_unpaid"),
			{ side: "client", reason: "deposit_link_sent" } as const,
		]) {
			assert.equal(
				sinceOf(waiting, f).toMillis(),
				f.depositLink?.madeAt.toMillis(),
			);
		}
		assert.equal(
			sinceOf({ side: "client", reason: "price_sent" }, f).toMillis(),
			f.quote?.issuedAt.toMillis(),
		);
		// A screenshot waits since it was sent, not since the project began (fix 5);
		// without the time it falls back to the project's.
		const sent = now.minus({ hours: 5 });
		assert.equal(
			sinceOf(studio("proof_to_check"), { ...f, proofSince: sent }).toMillis(),
			sent.toMillis(),
		);
		assert.equal(
			sinceOf(studio("proof_to_check"), f).toMillis(),
			f.since.toMillis(),
		);
		for (const waiting of [
			studio("price_to_send"),
			studio("no_session"),
			studio("deposit_link_missing"),
			{ side: "client", reason: "on_hold" } as const,
			{ side: "client", reason: "deposit_due" } as const,
		]) {
			assert.equal(sinceOf(waiting, f).toMillis(), f.since.toMillis());
		}
	});
});
