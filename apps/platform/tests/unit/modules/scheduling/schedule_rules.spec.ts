import { test } from "@japa/runner";
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { SESSION_KINDS } from "#modules/scheduling/models/project_session";
import {
	SCHEDULABLE_STATUSES,
	schedulableKinds,
	scheduledNote,
	scheduleRefusal,
	schedulingHint,
} from "#modules/scheduling/schedule_rules";

const BEFORE_ACCEPTANCE = ["reviewing", "quoted", "on_hold"] as const;

test.group("scheduleRefusal", () => {
	test("open projects take new sessions; finished and closed ones refuse a tattoo session", ({
		assert,
	}) => {
		assert.deepEqual(
			[...SCHEDULABLE_STATUSES],
			[
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
				"booked",
				"in_progress",
			],
		);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [
					status,
					scheduleRefusal(status, "tattoo"),
				]),
			),
			{
				reviewing: null,
				quoted: null,
				on_hold: null,
				deposit_pending: null,
				booked: null,
				in_progress: null,
				completed: "project_finished",
				healing_check: "touch_ups_only",
				declined: "project_closed",
				cancelled: "project_closed",
			},
		);
	});

	test("a healing check takes touch-ups only; a completed project takes nothing (TAT-111)", ({
		assert,
	}) => {
		const all = ["tattoo", "consultation", "touch_up"];
		assert.sameMembers(all, [...SESSION_KINDS]);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [
					status,
					[...schedulableKinds(status)],
				]),
			),
			{
				reviewing: all,
				quoted: all,
				on_hold: all,
				deposit_pending: all,
				booked: all,
				in_progress: all,
				completed: [],
				healing_check: ["touch_up"],
				declined: [],
				cancelled: [],
			},
		);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [
					status,
					scheduleRefusal(status, "touch_up"),
				]),
			),
			{
				reviewing: null,
				quoted: null,
				on_hold: null,
				deposit_pending: null,
				booked: null,
				in_progress: null,
				completed: "project_finished",
				healing_check: null,
				declined: "project_closed",
				cancelled: "project_closed",
			},
		);
		assert.equal(
			scheduleRefusal("healing_check", "consultation"),
			"touch_ups_only",
		);
	});
});

test.group("scheduledNote", () => {
	const note = (projectStatus: ProjectStatus, booked = false, depositDue = 0) =>
		scheduledNote({ kind: "tattoo", booked, projectStatus, depositDue });

	test("what a tattoo session did to the project, in the payments screen's words", ({
		assert,
	}) => {
		assert.equal(note("booked", true), " The project is booked.");
		assert.equal(
			note("deposit_pending", false, 100_000),
			" NPR 1,000 of the deposit is still due: the project is booked once it's paid.",
		);
		assert.equal(
			note("deposit_pending"),
			" The project is booked once its deposit is settled.",
		);
		for (const status of BEFORE_ACCEPTANCE) {
			assert.equal(
				note(status),
				" It holds the date: the project is booked once the client accepts the quote and the deposit is settled.",
				status,
			);
		}
		assert.equal(note("booked"), "");
	});

	test("a consultation or touch-up adds nothing", ({ assert }) => {
		for (const kind of ["consultation", "touch_up"] as const) {
			assert.equal(
				scheduledNote({
					kind,
					booked: false,
					projectStatus: "deposit_pending",
					depositDue: 100_000,
				}),
				"",
				kind,
			);
		}
	});
});

// TAT-108 fix round: an artist is sent no money, so their hint and their flash name no amount.
test.group("schedule messages without an amount", () => {
	test("the hint and the note say the deposit is due, not how much", ({
		assert,
	}) => {
		assert.equal(
			schedulingHint("deposit_pending", 100_000, true, false),
			"A tattoo session holds the date. The project is booked once the deposit is paid.",
		);
		assert.equal(
			scheduledNote({
				kind: "tattoo",
				booked: false,
				projectStatus: "deposit_pending",
				depositDue: 100_000,
				withAmount: false,
			}),
			" The deposit is still due: the project is booked once it's paid.",
		);
	});

	test("an owner still gets the amount, and a settled deposit needs none", ({
		assert,
	}) => {
		assert.include(
			schedulingHint("deposit_pending", 100_000, true),
			"NPR 1,000",
		);
		assert.equal(
			schedulingHint("deposit_pending", 0, true, false),
			"Scheduling a tattoo session books the project.",
		);
	});
});

test.group("schedulingHint", () => {
	test("says what a tattoo session will do to the project", ({ assert }) => {
		for (const status of BEFORE_ACCEPTANCE) {
			assert.equal(
				schedulingHint(status, 0, true),
				"A tattoo session holds the date. The project is booked once the client accepts the quote and the deposit is settled.",
				status,
			);
		}
		assert.equal(
			schedulingHint("deposit_pending", 100_000, true),
			"A tattoo session holds the date. The project is booked once the deposit is paid: NPR 1,000 still due.",
		);
		assert.equal(
			schedulingHint("in_progress", 0, true),
			"Scheduling the next tattoo session books the project again.",
		);
		assert.isNull(schedulingHint("booked", 0, true));
	});

	test("a deposit_pending project whose deposit is settled says scheduling books it", ({
		assert,
	}) => {
		assert.equal(
			schedulingHint("deposit_pending", 0, true),
			"Scheduling a tattoo session books the project.",
		);
	});

	test("a deposit_pending project with no quote is not settled, so the hint doesn't promise a booking", ({
		assert,
	}) => {
		// DepositService.isSettled is false without a quote, so scheduling leaves
		// the project deposit_pending, and scheduledNote says so: the hint says
		// the same.
		const hint = schedulingHint("deposit_pending", 0, false);
		assert.equal(
			hint,
			"A tattoo session holds the date. The project is booked once its deposit is settled.",
		);
		assert.notInclude(hint ?? "", "books the project");
		assert.include(
			scheduledNote({
				kind: "tattoo",
				booked: false,
				projectStatus: "deposit_pending",
				depositDue: 0,
			}),
			"booked once its deposit is settled",
		);
	});

	test("a healing check says it takes touch-ups only (TAT-111)", ({
		assert,
	}) => {
		assert.equal(
			schedulingHint("healing_check", 0, true),
			"The healing check takes touch-up sessions only.",
		);
	});
});
