import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	NEXT_STEP_ACTIONS,
	type NextStep,
	type NextStepAction,
	type NextStepFacts,
	nextStepOf,
	type SessionLine,
	sweepWillCancel,
} from "#modules/projects/next_step";
import { expiresAtFor } from "#modules/projects/quotes";
import {
	WAITING_HASH,
	type WaitingContext,
	type WaitingFacts,
	waitingOf,
	waitingText,
} from "#modules/projects/waiting";

const KTM = "Asia/Kathmandu";
// A Thursday, 10:00 in the studio.
const now = DateTime.fromISO("2026-10-22T10:00:00", { zone: KTM });
const owner: WaitingContext = { isOwner: true, now, timezone: KTM };
const artist: WaitingContext = { isOwner: false, now, timezone: KTM };

const expiresOn = (day: string) => expiresAtFor(day, KTM);

/** A quoted project, quote sent two days ago, valid through 23 Oct (tomorrow), deposit unpaid. */
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

/** A quote that does not end soon (valid through 5 Nov). */
const later = {
	issuedAt: now.minus({ days: 2 }),
	expiresAt: expiresOn("2026-11-05"),
	depositAmount: 300_000,
};
/** A quote that ended a minute ago. */
const ended = {
	issuedAt: now.minus({ days: 5 }),
	expiresAt: now.minus({ minutes: 1 }),
	depositAmount: 300_000,
};

/** Everything the page can offer: an owner's. */
const allCan = (): Record<NextStepAction, boolean> =>
	Object.fromEntries(
		NEXT_STEP_ACTIONS.map((action) => [action, true]),
	) as Record<NextStepAction, boolean>;

/** What an artist's page offers: no money, no deposit link. */
const artistCan = (): Record<NextStepAction, boolean> => ({
	...allCan(),
	verify_proof: false,
	deposit_link: false,
	record_payment: false,
	record_outcome: false,
});

/** The step for a project's facts, with the waiting rule's own words and card. */
function stepOf(
	over: Partial<WaitingFacts>,
	context: WaitingContext = owner,
	extra: Partial<NextStepFacts> = {},
): NextStep {
	const f = facts(over);
	const waiting = waitingOf(f, context);
	return nextStepOf({
		status: f.status,
		waiting,
		waitingText: waiting && waitingText(waiting, f, now, KTM),
		waitingHash: waiting && WAITING_HASH[waiting.reason],
		clientName: "Sita Thapa",
		sweepWillCancel: sweepWillCancel(f, now),
		nextSession: null,
		startedSession: null,
		balanceOwedText: null,
		can: context.isOwner ? allCan() : artistCan(),
		...extra,
	});
}

const tomorrow: SessionLine = {
	startText: "Fri 23 Oct, 11:00",
	artistName: "Asha",
};
const started: SessionLine = {
	startText: "Thu 22 Oct, 09:00",
	artistName: "Asha",
};

test.group("nextStepOf: when something waits", () => {
	test("row 1: a waiting screenshot is the owner's to check, whatever the status", ({
		assert,
	}) => {
		assert.deepEqual(
			stepOf({ status: "deposit_pending", proofWaiting: true, quote: later }),
			{
				kind: "check_proof",
				title: "Check the deposit screenshot",
				text: "Verify it only if the money reached your account.",
				primary: "verify_proof",
				secondary: [],
				anchor: "payments",
				needsYou: true,
			},
		);
		// A client who withdrew while it waited: the screenshot is still the owner's.
		const withdrawn = stepOf({
			status: "cancelled",
			proofWaiting: true,
			quote: null,
		});
		assert.equal(withdrawn.kind, "check_proof");
		assert.equal(
			withdrawn.text,
			"The client withdrew while this screenshot waited. Verify or reject it so the money is recorded right.",
		);
		assert.equal(withdrawn.primary, "verify_proof");
		assert.equal(withdrawn.anchor, "payments");
	});

	test("row 2: a reviewing project needs a price", ({ assert }) => {
		assert.deepEqual(stepOf({ status: "reviewing", quote: null }), {
			kind: "send_price",
			title: "Send Sita a price",
			text: "Accepted 2 days ago, no price yet.",
			primary: "issue_quote",
			secondary: [],
			anchor: "quote-form",
			needsYou: true,
		});
	});

	test("row 3: a quoted project whose price ends soon: remind first, accepting second", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({}), {
			kind: "price_ending",
			title: "Remind Sita before the price ends",
			text: "The price ends tomorrow. If Sita hasn't said yes by then, the project is cancelled.",
			primary: "send_quote",
			secondary: ["client_accepted", "revise_quote"],
			anchor: "quote",
			needsYou: true,
		});
	});

	test("row 4: an on-hold project whose price ends soon: resume, or give more time", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({ status: "on_hold" }), {
			kind: "price_ending",
			title: "Resume, or give more time",
			text: "On hold. The price ends tomorrow, and then the project is cancelled.",
			primary: "resume",
			secondary: ["revise_quote"],
			anchor: "quote",
			needsYou: true,
		});
	});

	test("row 5: a deposit not paid as the price ends: remind about the deposit", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({ status: "deposit_pending" }), {
			kind: "deposit_ending",
			title: "Remind Sita about the deposit",
			text: "Deposit not paid. The price ends tomorrow. If it isn't paid by then, the project is cancelled.",
			primary: "deposit_link",
			secondary: ["record_payment", "revise_quote"],
			anchor: "quote",
			needsYou: true,
		});
	});

	test("row 6: no working deposit link is made first", ({ assert }) => {
		const none = stepOf({ status: "deposit_pending", quote: later });
		assert.deepEqual(none, {
			kind: "make_link",
			title: "Send the deposit link",
			text: "No deposit link yet.",
			primary: "deposit_link",
			secondary: ["record_payment"],
			anchor: "deposit",
			needsYou: true,
		});
		const broken = stepOf({
			status: "deposit_pending",
			quote: later,
			depositLink: { madeAt: now.minus({ days: 1 }), works: false },
		});
		assert.equal(broken.kind, "make_link");
		assert.equal(broken.text, "The deposit link stopped working.");
	});

	test("row 7: a link four days old and unpaid is chased", ({ assert }) => {
		assert.deepEqual(
			stepOf({
				status: "deposit_pending",
				quote: later,
				depositLink: { madeAt: now.minus({ days: 4 }), works: true },
			}),
			{
				kind: "chase_deposit",
				title: "Remind Sita about the deposit",
				text: "Deposit not paid, link made 4 days ago.",
				primary: "deposit_link",
				secondary: ["record_payment"],
				anchor: "deposit",
				needsYou: true,
			},
		);
	});

	test("row 8: booked or paid without a tattoo session in the calendar", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({ status: "booked", quote: null }), {
			kind: "book_session",
			title: "Book the tattoo session",
			text: "Booked, no session in the calendar.",
			primary: "schedule",
			secondary: [],
			anchor: "sessions",
			needsYou: true,
		});
		const paid = stepOf({
			status: "deposit_pending",
			quote: later,
			depositSettled: true,
		});
		assert.equal(paid.kind, "book_session");
		assert.equal(paid.text, "Deposit paid, no session booked.");
	});

	test("row 9: a price sent and not answered: waiting, accepting first", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({ quote: later }), {
			kind: "await_answer",
			title: "Waiting for Sita to answer",
			text: "Price sent 2 days ago.",
			primary: "client_accepted",
			secondary: ["send_quote", "revise_quote"],
			anchor: "quote",
			needsYou: false,
		});
	});

	test("row 10: an on-hold project that does not end soon waits for a resume", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({ status: "on_hold", quote: later }), {
			kind: "on_hold",
			title: "On hold",
			text: "Resume the project when Sita is ready.",
			primary: "resume",
			secondary: ["revise_quote"],
			anchor: null,
			needsYou: false,
		});
	});

	test("row 11: a young deposit link waits on the client", ({ assert }) => {
		assert.deepEqual(
			stepOf({
				status: "deposit_pending",
				quote: later,
				depositLink: { madeAt: now.minus({ days: 1 }), works: true },
			}),
			{
				kind: "link_sent",
				title: "Waiting for the deposit",
				text: "Deposit link sent 1 day ago.",
				primary: "deposit_link",
				secondary: ["record_payment"],
				anchor: "deposit",
				needsYou: false,
			},
		);
	});

	test("row 12: an artist only waits for the deposit", ({ assert }) => {
		assert.deepEqual(
			stepOf({ status: "deposit_pending", quote: later }, artist),
			{
				kind: "await_deposit",
				title: "Waiting for the deposit",
				text: "An owner records it when it is paid.",
				primary: null,
				secondary: [],
				anchor: null,
				needsYou: false,
			},
		);
	});
});

test.group("nextStepOf: when nothing waits", () => {
	test("row 13: an expired quote the sweep will cancel", ({ assert }) => {
		const step = stepOf({ quote: ended });
		assert.deepEqual(step, {
			kind: "price_ended",
			title: "The price has ended",
			text: "Send a new price, or the project is cancelled within minutes.",
			primary: "revise_quote",
			secondary: [],
			anchor: null,
			needsYou: false,
		});
	});

	test("row 14: a session that has started is recorded under Sessions", ({
		assert,
	}) => {
		assert.deepEqual(
			stepOf({ status: "in_progress", quote: null }, owner, {
				startedSession: started,
			}),
			{
				kind: "record_session",
				title: "How did the session go?",
				text: "Thu 22 Oct, 09:00 with Asha has started. Record it under Sessions: done, no-show or cancelled.",
				primary: "open_sessions",
				secondary: [],
				anchor: null,
				needsYou: false,
			},
		);
		// Without an artist's name the sentence still reads.
		const unnamed = stepOf({ status: "in_progress", quote: null }, owner, {
			startedSession: { startText: "Thu 22 Oct, 09:00", artistName: null },
		});
		assert.equal(
			unnamed.text,
			"Thu 22 Oct, 09:00 has started. Record it under Sessions: done, no-show or cancelled.",
		);
	});

	test("row 14 beats rows 15 to 18; a waiting reason beats row 14", ({
		assert,
	}) => {
		// A started touch-up during a healing check is still the thing to record.
		const healing = stepOf({ status: "healing_check", quote: null }, owner, {
			startedSession: started,
			nextSession: tomorrow,
		});
		assert.equal(healing.kind, "record_session");
		const inChair = stepOf({ status: "in_progress", quote: null }, owner, {
			startedSession: started,
			nextSession: tomorrow,
		});
		assert.equal(inChair.kind, "record_session");
		// Booked with no tattoo session, but a consultation has started: the studio
		// still has to book the tattoo, and Today says so.
		const booked = stepOf({ status: "booked", quote: null }, owner, {
			startedSession: started,
		});
		assert.equal(booked.kind, "book_session");
	});

	test("row 15: the next session is named when it is the only thing ahead", ({
		assert,
	}) => {
		assert.deepEqual(
			stepOf({ status: "booked", quote: null, scheduledTattoo: true }, owner, {
				nextSession: tomorrow,
			}),
			{
				kind: "next_session",
				title: "Next session: Fri 23 Oct, 11:00",
				text: "With Asha.",
				primary: null,
				secondary: [],
				anchor: null,
				needsYou: false,
			},
		);
		const unnamed = stepOf(
			{ status: "booked", quote: null, scheduledTattoo: true },
			owner,
			{ nextSession: { startText: "Fri 23 Oct, 11:00", artistName: null } },
		);
		assert.isNull(unnamed.text);
		// A paid deposit with the session booked, and an in-progress project: the
		// session first, because finishing is refused while one is scheduled.
		const paid = stepOf(
			{
				status: "deposit_pending",
				quote: later,
				depositSettled: true,
				scheduledTattoo: true,
			},
			owner,
			{ nextSession: tomorrow },
		);
		assert.equal(paid.kind, "next_session");
		const inChair = stepOf({ status: "in_progress", quote: null }, owner, {
			nextSession: tomorrow,
		});
		assert.equal(inChair.kind, "next_session");
		// A healing check names no session: row 18 decides.
		const healing = stepOf({ status: "healing_check", quote: null }, owner, {
			nextSession: tomorrow,
		});
		assert.equal(healing.kind, "healing_check");
	});

	test("row 16: an owner finishes the tattoo", ({ assert }) => {
		assert.deepEqual(stepOf({ status: "in_progress", quote: null }), {
			kind: "finish",
			title: "Finish the tattoo",
			text: null,
			primary: "finish",
			secondary: ["schedule"],
			anchor: null,
			needsYou: false,
		});
	});

	test("row 17: an artist schedules the next session", ({ assert }) => {
		assert.deepEqual(
			stepOf({ status: "in_progress", quote: null }, artist, {
				// An artist's page has no finish step before the healing check.
				can: { ...artistCan(), finish: false },
			}),
			{
				kind: "more_sessions",
				title: "Schedule the next session",
				text: "When the tattoo is done, an owner marks it finished.",
				primary: "schedule",
				secondary: [],
				anchor: null,
				needsYou: false,
			},
		);
	});

	test("row 18: the healing check; the payment is offered only with a fixed price owed", ({
		assert,
	}) => {
		const none = stepOf({ status: "healing_check", quote: null });
		assert.deepEqual(none, {
			kind: "healing_check",
			title: "Healing check",
			text: null,
			primary: "finish",
			secondary: ["schedule"],
			anchor: null,
			needsYou: false,
		});
		const owing = stepOf({ status: "healing_check", quote: null }, owner, {
			balanceOwedText: "NPR 15,000",
		});
		assert.deepEqual(owing.secondary, ["record_payment", "schedule"]);
		// The assigned artist sees the check (the panel has no button) but no money.
		const forArtist = stepOf({ status: "healing_check", quote: null }, artist);
		assert.equal(forArtist.primary, "finish");
		assert.deepEqual(forArtist.secondary, ["schedule"]);
	});

	test("row 19: a completed project with a fixed price owed", ({ assert }) => {
		assert.deepEqual(
			stepOf({ status: "completed", quote: null }, owner, {
				balanceOwedText: "NPR 15,000",
			}),
			{
				kind: "collect_balance",
				title: "NPR 15,000 still due",
				text: "The tattoo is finished. Record the payment when Sita pays.",
				primary: "record_payment",
				secondary: [],
				anchor: "payments",
				needsYou: false,
			},
		);
	});

	test("row 20: a completed project with nothing owed is closed", ({
		assert,
	}) => {
		assert.deepEqual(stepOf({ status: "completed", quote: null }), {
			kind: "closed",
			title: "Completed",
			text: "Nothing left to do. The project stays here for your records.",
			primary: null,
			secondary: [],
			anchor: null,
			needsYou: false,
		});
		// An artist is never told what is owed.
		const forArtist = stepOf({ status: "completed", quote: null }, artist);
		assert.equal(forArtist.kind, "closed");
	});

	test("row 21: a closed project holding a deposit needs its outcome", ({
		assert,
	}) => {
		for (const status of ["declined", "cancelled"] as const) {
			assert.deepEqual(stepOf({ status, quote: null }), {
				kind: "record_outcome",
				title: "Record whether the deposit was kept or refunded",
				text: null,
				primary: "record_outcome",
				secondary: [],
				anchor: "payments",
				needsYou: false,
			});
		}
	});

	test("row 22: a closed project otherwise says so", ({ assert }) => {
		const can = { ...allCan(), record_outcome: false };
		const declined = stepOf({ status: "declined", quote: null }, owner, {
			can,
		});
		assert.deepEqual(declined, {
			kind: "closed",
			title: "Declined",
			text: "This project is closed.",
			primary: null,
			secondary: [],
			anchor: null,
			needsYou: false,
		});
		const cancelled = stepOf({ status: "cancelled", quote: null }, artist);
		assert.equal(cancelled.title, "Cancelled");
		assert.equal(cancelled.kind, "closed");
	});

	test("row 23: anything else is told plainly", ({ assert }) => {
		// A booked project whose only scheduled session started and is not this
		// member's to record: nothing to offer them.
		assert.deepEqual(
			stepOf({ status: "booked", quote: null, scheduledTattoo: true }, artist),
			{
				kind: "nothing",
				title: "Nothing to do right now",
				text: null,
				primary: null,
				secondary: [],
				anchor: null,
				needsYou: false,
			},
		);
	});
});

test.group("nextStepOf: what the page can offer", () => {
	test("row 3 without a phone makes accepting the primary action", ({
		assert,
	}) => {
		const step = stepOf({}, owner, {
			can: { ...allCan(), send_quote: false },
		});
		assert.equal(step.primary, "client_accepted");
		assert.deepEqual(step.secondary, ["revise_quote"]);
	});

	test("row 9 with nothing to accept has no primary action", ({ assert }) => {
		const step = stepOf({ quote: later }, owner, {
			can: { ...allCan(), client_accepted: false },
		});
		assert.isNull(step.primary);
		assert.deepEqual(step.secondary, ["send_quote", "revise_quote"]);
	});

	test("row 5 for an artist waits for the deposit and offers only the revision", ({
		assert,
	}) => {
		const step = stepOf({ status: "deposit_pending" }, artist);
		assert.equal(step.title, "Waiting for the deposit");
		assert.isNull(step.primary);
		assert.deepEqual(step.secondary, ["revise_quote"]);
	});

	test("an action the page cannot offer is never named", ({ assert }) => {
		const none = Object.fromEntries(
			NEXT_STEP_ACTIONS.map((action) => [action, false]),
		) as Record<NextStepAction, boolean>;
		const steps = [
			stepOf({}, owner, { can: none }),
			stepOf({ status: "reviewing", quote: null }, owner, { can: none }),
			stepOf({ status: "deposit_pending", quote: later }, owner, {
				can: none,
			}),
			stepOf({ status: "healing_check", quote: null }, owner, { can: none }),
		];
		for (const step of steps) {
			assert.isNull(step.primary);
			assert.deepEqual(step.secondary, []);
		}
	});

	test("every action a step names is on the list", ({ assert }) => {
		const statuses = [
			"reviewing",
			"quoted",
			"on_hold",
			"deposit_pending",
			"booked",
			"in_progress",
			"healing_check",
			"completed",
			"declined",
			"cancelled",
		] as const;
		for (const status of statuses) {
			for (const quote of [null, later, ended]) {
				for (const context of [owner, artist]) {
					const step = stepOf({ status, quote }, context, {
						balanceOwedText: "NPR 1",
						nextSession: tomorrow,
					});
					for (const action of [step.primary, ...step.secondary]) {
						if (action === null) continue;
						assert.include(NEXT_STEP_ACTIONS, action, `${status}`);
					}
					assert.notInclude(step.secondary, step.primary);
				}
			}
		}
	});
});

test.group("nextStepOf: names", () => {
	test("a Devanagari first name is used whole", ({ assert }) => {
		const step = stepOf({ status: "reviewing", quote: null }, owner, {
			clientName: "सीता थापा",
		});
		assert.equal(step.title, "Send सीता a price");
		const waits = stepOf({ quote: later }, owner, { clientName: "सीता थापा" });
		assert.equal(waits.title, "Waiting for सीता to answer");
	});

	test("no name reads as the client", ({ assert }) => {
		for (const clientName of [null, "", "   "]) {
			const step = stepOf({ status: "reviewing", quote: null }, owner, {
				clientName,
			});
			assert.equal(step.title, "Send the client a price", String(clientName));
		}
		const ending = stepOf({}, owner, { clientName: null });
		assert.equal(
			ending.text,
			"The price ends tomorrow. If the client hasn't said yes by then, the project is cancelled.",
		);
	});
});

test.group("sweepWillCancel", () => {
	test("an expired quote on a project with no deposit is cancelled by the sweep", ({
		assert,
	}) => {
		assert.isTrue(sweepWillCancel(facts({ quote: ended }), now));
		assert.isTrue(
			sweepWillCancel(facts({ status: "on_hold", quote: ended }), now),
		);
		assert.isTrue(
			sweepWillCancel(facts({ status: "deposit_pending", quote: ended }), now),
		);
	});

	test("it spares a quote the sweep spares", ({ assert }) => {
		// A waiting screenshot or a late decision on the deposit.
		assert.isFalse(
			sweepWillCancel(facts({ quote: ended, expirySpared: true }), now),
		);
		// The deposit is covered.
		assert.isFalse(
			sweepWillCancel(
				facts({
					status: "deposit_pending",
					quote: ended,
					depositSettled: true,
				}),
				now,
			),
		);
	});

	test("it does nothing before the expiry, without a quote or outside the quote statuses", ({
		assert,
	}) => {
		assert.isFalse(sweepWillCancel(facts(), now));
		assert.isFalse(sweepWillCancel(facts({ quote: null }), now));
		for (const status of [
			"reviewing",
			"booked",
			"in_progress",
			"healing_check",
			"completed",
			"declined",
			"cancelled",
		] as const) {
			assert.isFalse(sweepWillCancel(facts({ status, quote: ended }), now));
		}
	});

	test("it is exactly waitingOf's null branch for a quote status with a quote", ({
		assert,
	}) => {
		for (const status of ["quoted", "on_hold", "deposit_pending"] as const) {
			for (const quote of [ended, later]) {
				for (const depositSettled of [false, true]) {
					for (const expirySpared of [false, true]) {
						for (const depositAmount of [0, 300_000]) {
							const f = facts({
								status,
								quote: { ...quote, depositAmount },
								depositSettled,
								expirySpared,
								scheduledTattoo: true,
							});
							const label = JSON.stringify({
								status,
								depositSettled,
								expirySpared,
								depositAmount,
								expired: quote === ended,
							});
							if (sweepWillCancel(f, now)) {
								assert.isNull(waitingOf(f, owner), label);
								assert.isNull(waitingOf(f, artist), label);
							} else if (status !== "deposit_pending") {
								assert.isNotNull(waitingOf(f, owner), label);
							}
						}
					}
				}
			}
		}
	});
});
