import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { contactedText, daysAgoText } from "#modules/projects/contact";
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	ACTIVE_STATUSES,
	allowedMoves,
	CLOSED_STATUSES,
	MANUAL_MOVES,
	toProjectFilter,
} from "#modules/projects/moves";

const KTM = "Asia/Kathmandu";

test.group("Manual moves", () => {
	test("follow the project rules", ({ assert }) => {
		assert.deepEqual(MANUAL_MOVES, {
			hold: { from: ["quoted"], to: "on_hold", cancelsSessions: false },
			resume: { from: ["on_hold"], to: "quoted", cancelsSessions: false },
			decline: { from: ["reviewing"], to: "declined", cancelsSessions: true },
			withdraw: {
				from: [
					"reviewing",
					"quoted",
					"on_hold",
					"deposit_pending",
					"booked",
					"in_progress",
				],
				to: "cancelled",
				cancelsSessions: true,
			},
		});
	});

	test("allowedMoves lists the moves each status can make", ({ assert }) => {
		const expected: Record<ProjectStatus, string[]> = {
			reviewing: ["decline", "withdraw"],
			quoted: ["hold", "withdraw"],
			on_hold: ["resume", "withdraw"],
			deposit_pending: ["withdraw"],
			booked: ["withdraw"],
			in_progress: ["withdraw"],
			completed: [],
			healing_check: [],
			declined: [],
			cancelled: [],
		};
		for (const status of PROJECT_STATUSES) {
			assert.deepEqual(allowedMoves(status), expected[status], status);
		}
	});

	test("active and closed split the statuses with no overlap", ({ assert }) => {
		assert.deepEqual(
			[...CLOSED_STATUSES],
			["declined", "cancelled", "completed"],
		);
		assert.deepEqual(
			[...ACTIVE_STATUSES],
			[
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
				"booked",
				"in_progress",
				"healing_check",
			],
		);
		assert.sameMembers(
			[...ACTIVE_STATUSES, ...CLOSED_STATUSES],
			[...PROJECT_STATUSES],
		);
	});

	test("toProjectFilter keeps known filters and falls back to active", ({
		assert,
	}) => {
		assert.equal(toProjectFilter("active"), "active");
		assert.equal(toProjectFilter("closed"), "closed");
		assert.equal(toProjectFilter("quoted"), "quoted");
		assert.equal(toProjectFilter("declined"), "declined");
		for (const junk of ["bogus", "", undefined, null, 3, ["quoted"]]) {
			assert.equal(toProjectFilter(junk), "active", String(junk));
		}
	});
});

test.group("contactedText", () => {
	// 10:00 on 15 Oct in Kathmandu (UTC+5:45).
	const now = DateTime.fromISO("2026-10-15T10:00:00", { zone: KTM });

	test("counts calendar days in the studio's timezone", ({ assert }) => {
		assert.equal(contactedText(null, KTM, now), "never contacted");
		assert.equal(
			contactedText(now.set({ hour: 1 }), KTM, now),
			"contacted today",
		);
		// Late yesterday is "yesterday", although it was under 24 hours ago.
		assert.equal(
			contactedText(now.minus({ days: 1 }).set({ hour: 23 }), KTM, now),
			"contacted yesterday",
		);
		assert.equal(
			contactedText(now.minus({ days: 3 }), KTM, now),
			"contacted 3 days ago",
		);
		assert.equal(
			contactedText(now.plus({ hours: 1 }), KTM, now),
			"contacted today",
			"a slightly fast clock is still today",
		);
	});

	test("depends on the timezone", ({ assert }) => {
		// 20:00 UTC on 14 Oct is 01:45 on 15 Oct in Kathmandu.
		const at = DateTime.fromISO("2026-10-14T20:00:00Z");
		assert.equal(contactedText(at, KTM, now), "contacted today");
		assert.equal(contactedText(at, "UTC", now), "contacted yesterday");
	});
});

test.group("daysAgoText", () => {
	const now = DateTime.fromISO("2026-10-15T10:00:00", { zone: KTM });

	test("counts calendar days, a future time counting as today", ({
		assert,
	}) => {
		assert.equal(daysAgoText(now.set({ hour: 1 }), KTM, now), "today");
		assert.equal(daysAgoText(now.plus({ hours: 2 }), KTM, now), "today");
		assert.equal(
			daysAgoText(now.minus({ days: 1 }).set({ hour: 23 }), KTM, now),
			"yesterday",
		);
		assert.equal(daysAgoText(now.minus({ days: 6 }), KTM, now), "6 days ago");
	});
});
