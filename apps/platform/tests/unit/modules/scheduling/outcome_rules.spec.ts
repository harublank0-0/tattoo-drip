import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	mayChangeSession,
	outcomeRefusal,
	outcomesFor,
	SESSION_OUTCOMES,
} from "#modules/scheduling/outcomes";

const NOW = DateTime.fromISO("2026-11-02T10:00:00Z");

type Subject = Parameters<typeof outcomeRefusal>[0];

/** A scheduled tattoo session that started an hour ago. */
const session = (over: Partial<Subject> = {}): Subject => ({
	status: "scheduled",
	kind: "tattoo",
	startsAt: NOW.minus({ hours: 1 }),
	...over,
});

test.group("outcomeRefusal and outcomesFor", () => {
	test("a started tattoo session of a booked project takes every outcome", ({
		assert,
	}) => {
		assert.deepEqual(
			[...SESSION_OUTCOMES],
			["completed", "no_show", "cancelled"],
		);
		for (const status of [
			"booked",
			"in_progress",
			"completed",
			"healing_check",
		] as const) {
			assert.deepEqual(
				outcomesFor(session(), status, NOW),
				["completed", "no_show", "cancelled"],
				status,
			);
		}
	});

	test("before its start a session can only be cancelled; at its start it has started", ({
		assert,
	}) => {
		const later = session({ startsAt: NOW.plus({ minutes: 1 }) });
		assert.equal(
			outcomeRefusal(later, "booked", "completed", NOW),
			"not_started",
		);
		assert.equal(
			outcomeRefusal(later, "booked", "no_show", NOW),
			"not_started",
		);
		assert.isNull(outcomeRefusal(later, "booked", "cancelled", NOW));
		assert.deepEqual(outcomesFor(later, "booked", NOW), ["cancelled"]);
		assert.deepEqual(outcomesFor(session({ startsAt: NOW }), "booked", NOW), [
			"completed",
			"no_show",
			"cancelled",
		]);
	});

	test("tattoo work is marked done only once the project is booked; other kinds any time", ({
		assert,
	}) => {
		for (const status of [
			"reviewing",
			"quoted",
			"on_hold",
			"deposit_pending",
		] as const) {
			assert.equal(
				outcomeRefusal(session(), status, "completed", NOW),
				"not_booked",
				status,
			);
			assert.deepEqual(
				outcomesFor(session(), status, NOW),
				["no_show", "cancelled"],
				status,
			);
			for (const kind of ["consultation", "touch_up"] as const) {
				assert.isNull(
					outcomeRefusal(session({ kind }), status, "completed", NOW),
					`${kind} in ${status}`,
				);
			}
		}
	});

	test("a recorded outcome is final", ({ assert }) => {
		for (const status of ["completed", "no_show", "cancelled"] as const) {
			for (const outcome of SESSION_OUTCOMES) {
				assert.equal(
					outcomeRefusal(session({ status }), "booked", outcome, NOW),
					"not_scheduled",
					`${status} to ${outcome}`,
				);
			}
			assert.deepEqual(outcomesFor(session({ status }), "booked", NOW), []);
		}
	});
});

test.group("mayChangeSession", () => {
	const OWNER = { role: "owner" };
	const ARTIST = { role: "artist" };
	const mine = { artistId: "profile-sita" };
	const theirs = { artistId: "profile-anu" };

	test("owners change any session", ({ assert }) => {
		for (const subject of [mine, theirs]) {
			for (const project of [
				{ artistId: "profile-sita" },
				{ artistId: "profile-anu" },
				{ artistId: null },
			]) {
				assert.isTrue(mayChangeSession(OWNER, null, subject, project));
			}
		}
	});

	test("an artist changes only their own session, on a project assigned to them", ({
		assert,
	}) => {
		assert.isTrue(
			mayChangeSession(ARTIST, "profile-sita", mine, {
				artistId: "profile-sita",
			}),
		);
		assert.isFalse(
			mayChangeSession(ARTIST, "profile-sita", theirs, {
				artistId: "profile-sita",
			}),
			"another artist's session on my project",
		);
		assert.isFalse(
			mayChangeSession(ARTIST, "profile-sita", mine, {
				artistId: "profile-anu",
			}),
			"my session on someone else's project",
		);
		assert.isFalse(
			mayChangeSession(ARTIST, "profile-sita", mine, { artistId: null }),
			"a project without an artist",
		);
		assert.isFalse(
			mayChangeSession(ARTIST, null, mine, { artistId: "profile-sita" }),
			"no linked profile",
		);
	});
});
