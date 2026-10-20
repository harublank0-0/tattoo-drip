import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	FINISH_STEPS,
	FINISHED_STATUSES,
	finishedFlash,
	finishRefusal,
	finishStepFor,
	HEALING_CHECK_DAYS,
	healingCheckDueOn,
	owed,
} from "#modules/projects/finish";
import { PROJECT_STATUSES } from "#modules/projects/models/tattoo_project";
import type {
	SessionKind,
	SessionStatus,
} from "#modules/scheduling/models/project_session";

const KTM = "Asia/Kathmandu";

/** Nothing scheduled, nothing owed, nothing confirmed. */
const clear = { sessionScheduled: false, due: 0n, confirmedDue: null };

const session = (
	kind: SessionKind,
	status: SessionStatus,
	endsAt: DateTime,
) => ({
	kind,
	status,
	endsAt,
});

test.group("Finish steps", () => {
	test("in progress finishes into the healing check, which completes", ({
		assert,
	}) => {
		assert.deepEqual(FINISH_STEPS, {
			finish: { from: "in_progress", to: "healing_check" },
			complete: { from: "healing_check", to: "completed" },
		});
		assert.deepEqual([...FINISHED_STATUSES], ["healing_check", "completed"]);
		assert.equal(HEALING_CHECK_DAYS, 28);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [status, finishStepFor(status)]),
			),
			{
				reviewing: null,
				quoted: null,
				on_hold: null,
				deposit_pending: null,
				booked: null,
				in_progress: "finish",
				completed: null,
				healing_check: "complete",
				declined: null,
				cancelled: null,
			},
		);
	});
});

test.group("finishRefusal", () => {
	test("each step only from its own status", ({ assert }) => {
		for (const step of ["finish", "complete"] as const) {
			for (const status of PROJECT_STATUSES) {
				assert.equal(
					finishRefusal(step, { ...clear, status }),
					status === FINISH_STEPS[step].from ? null : "move_not_allowed",
					`${step} from ${status}`,
				);
			}
		}
	});

	test("a scheduled session comes before the balance; the status before both", ({
		assert,
	}) => {
		assert.equal(
			finishRefusal("finish", {
				status: "in_progress",
				sessionScheduled: true,
				due: 500n,
				confirmedDue: null,
			}),
			"session_scheduled",
		);
		assert.equal(
			finishRefusal("complete", {
				...clear,
				status: "healing_check",
				sessionScheduled: true,
			}),
			"session_scheduled",
		);
		assert.equal(
			finishRefusal("finish", {
				status: "booked",
				sessionScheduled: true,
				due: 500n,
				confirmedDue: null,
			}),
			"move_not_allowed",
		);
	});

	test("money owed must be exactly what the owner confirmed; nothing owed needs no confirmation", ({
		assert,
	}) => {
		const owing = {
			status: "in_progress" as const,
			sessionScheduled: false,
			due: 1_200_000n,
		};
		for (const confirmedDue of [null, 0n, 1_000_000n, 1_500_000n]) {
			assert.equal(
				finishRefusal("finish", { ...owing, confirmedDue }),
				"balance_changed",
				String(confirmedDue),
			);
		}
		assert.isNull(
			finishRefusal("finish", { ...owing, confirmedDue: 1_200_000n }),
		);
		assert.isNull(finishRefusal("finish", { ...clear, status: "in_progress" }));
		assert.isNull(
			finishRefusal("finish", {
				...clear,
				status: "in_progress",
				confirmedDue: 1_200_000n,
			}),
		);
	});

	test("owed keeps only money still due", ({ assert }) => {
		assert.equal(owed(null), 0n);
		assert.equal(owed(0n), 0n);
		assert.equal(owed(-50_000n), 0n);
		assert.equal(owed(1_200_000n), 1_200_000n);
	});
});

test.group("healingCheckDueOn", () => {
	test("four weeks after the studio's day the latest tattoo session ended", ({
		assert,
	}) => {
		assert.equal(
			healingCheckDueOn(
				[
					session("tattoo", "completed", DateTime.utc(2026, 10, 1, 10)),
					session("tattoo", "completed", DateTime.utc(2026, 10, 20, 10)),
				],
				KTM,
			),
			"2026-11-17",
		);
		// 20:00 UTC on 1 Nov is 01:45 on 2 Nov in Kathmandu.
		const lateEvening = [
			session("tattoo", "completed", DateTime.utc(2026, 11, 1, 20)),
		];
		assert.equal(healingCheckDueOn(lateEvening, KTM), "2026-11-30");
		assert.equal(healingCheckDueOn(lateEvening, "UTC"), "2026-11-29");
	});

	test("only completed tattoo sessions count", ({ assert }) => {
		assert.equal(
			healingCheckDueOn(
				[
					session("tattoo", "completed", DateTime.utc(2026, 10, 20, 10)),
					session("touch_up", "completed", DateTime.utc(2026, 11, 5, 10)),
					session("consultation", "completed", DateTime.utc(2026, 11, 6, 10)),
					session("tattoo", "scheduled", DateTime.utc(2026, 11, 7, 10)),
					session("tattoo", "no_show", DateTime.utc(2026, 11, 8, 10)),
					session("tattoo", "cancelled", DateTime.utc(2026, 11, 9, 10)),
				],
				KTM,
			),
			"2026-11-17",
		);
		assert.isNull(healingCheckDueOn([], KTM));
		assert.isNull(
			healingCheckDueOn(
				[session("touch_up", "completed", DateTime.utc(2026, 10, 20, 10))],
				KTM,
			),
		);
	});
});

test.group("finishedFlash", () => {
	test("says when the healing check is due and points at the aftercare message", ({
		assert,
	}) => {
		const none = { due: 0n, estimated: false };
		assert.equal(
			finishedFlash("finish", { ...none, dueOn: "2026-11-17" }),
			"Tattoo finished: the healing check is due 17 Nov 2026. Send the aftercare message from Message the client.",
		);
		assert.equal(
			finishedFlash("finish", { ...none, dueOn: null }),
			"Tattoo finished: the healing check is next. Send the aftercare message from Message the client.",
		);
		assert.equal(
			finishedFlash("complete", { ...none, dueOn: "2026-11-17" }),
			"Healing check done: the project is completed.",
		);
	});

	test("names money still owed, and an hourly estimate as one", ({
		assert,
	}) => {
		assert.equal(
			finishedFlash("finish", {
				dueOn: "2026-11-17",
				due: 1_200_000n,
				estimated: false,
			}),
			"Tattoo finished: the healing check is due 17 Nov 2026. Send the aftercare message from Message the client. NPR 12,000 of the balance is still due: record it under Payments when it's paid.",
		);
		assert.equal(
			finishedFlash("complete", {
				dueOn: null,
				due: 150_050n,
				estimated: true,
			}),
			"Healing check done: the project is completed. NPR 1,500.50 of the estimated balance is still due: record it under Payments when it's paid.",
		);
	});
});
