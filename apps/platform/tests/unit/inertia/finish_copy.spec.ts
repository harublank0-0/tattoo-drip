import { test } from "@japa/runner";
import { NEXT_STEP_ACTIONS, nextStepOf } from "#modules/projects/next_step";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `FinishModule` below restates its shape and the inertia project type-checks the real one.
import * as finishModule from "../../../inertia/components/finish.js";

type Step = "finish" | "complete";
type FinishModule = {
	FINISH_TITLES: Record<Step, string>;
	FINISH_BUTTONS: Record<Step, string>;
	FINISH_CONFIRMS: Record<Step, string>;
	SESSION_FIRST: string;
	finishIntro(step: Step, dueText: string | null, overdue: boolean): string;
	balanceLine(amountText: string, estimated: boolean): string;
	finishQuestion(
		step: Step,
		dueText: string | null,
		balanceDueText: string | null,
		estimated: boolean,
	): string;
};
const {
	FINISH_TITLES,
	FINISH_BUTTONS,
	FINISH_CONFIRMS,
	SESSION_FIRST,
	finishIntro,
	balanceLine,
	finishQuestion,
} = finishModule as FinishModule;

const ASK =
	"Ask the client for a photo of the healed tattoo. If it needs a touch-up, schedule a touch-up session under Sessions.";

test.group("The finish card's words (TAT-111)", () => {
	test("titles, buttons and the text under each title", ({ assert }) => {
		assert.deepEqual(FINISH_TITLES, {
			finish: "Finish the tattoo",
			complete: "Healing check",
		});
		assert.deepEqual(FINISH_BUTTONS, {
			finish: "Mark the tattoo finished",
			complete: "Healing check done",
		});
		assert.deepEqual(FINISH_CONFIRMS, {
			finish: "Mark finished",
			complete: "Close the project",
		});
		assert.equal(
			SESSION_FIRST,
			"Record or cancel the scheduled session under Sessions first.",
		);
		assert.equal(
			finishIntro("finish", "6 Nov 2026", false),
			"Once the work is done, mark the tattoo finished. Its healing check will be due 6 Nov 2026, four weeks after the last tattoo session.",
		);
		assert.equal(
			finishIntro("finish", null, false),
			"Once the work is done, mark the tattoo finished. Its healing check comes next.",
		);
		assert.equal(
			finishIntro("complete", "7 Nov 2026", false),
			`Due 7 Nov 2026. ${ASK}`,
		);
		assert.equal(
			finishIntro("complete", "7 Nov 2026", true),
			`Was due 7 Nov 2026. ${ASK}`,
		);
		assert.equal(finishIntro("complete", null, false), ASK);
		assert.equal(balanceLine("NPR 15,000", false), "Balance due: NPR 15,000.");
		assert.equal(
			balanceLine("NPR 15,000", true),
			"Balance due: NPR 15,000 (estimated).",
		);
	});

	test("the question names the healing check's day and money still owed", ({
		assert,
	}) => {
		assert.equal(
			finishQuestion("finish", "6 Nov 2026", null, false),
			"Mark the tattoo finished? The project moves to Healing check, due 6 Nov 2026, and takes only touch-up sessions from now on.",
		);
		assert.equal(
			finishQuestion("finish", null, null, false),
			"Mark the tattoo finished? The project moves to Healing check and takes only touch-up sessions from now on.",
		);
		assert.equal(
			finishQuestion("complete", "7 Nov 2026", "NPR 12,000", false),
			"Close the project? It moves to Completed and takes no more sessions. NPR 12,000 of the balance is still due: it stays on the Payments card.",
		);
		assert.equal(
			finishQuestion("finish", "6 Nov 2026", "NPR 12,000", true),
			"Mark the tattoo finished? The project moves to Healing check, due 6 Nov 2026, and takes only touch-up sessions from now on. NPR 12,000 of the estimated balance is still due: it stays on the Payments card.",
		);
	});
});

// TAT-108: the Next step card's title and the panel's own words come from two places (the server's
// table, the client's finish.ts); this keeps them one phrase.
test.group(
	"The Next step card names the finish steps as the panel does (TAT-108)",
	() => {
		const can = Object.fromEntries(
			NEXT_STEP_ACTIONS.map((action) => [action, true]),
		) as Record<(typeof NEXT_STEP_ACTIONS)[number], boolean>;
		const stepFor = (status: "in_progress" | "healing_check") =>
			nextStepOf({
				status,
				waiting: null,
				waitingText: null,
				waitingHash: null,
				clientName: null,
				sweepWillCancel: false,
				nextSession: null,
				startedSession: null,
				balanceOwedText: null,
				can,
			});

		test("an in-progress project and a healing check carry the panel's titles", ({
			assert,
		}) => {
			assert.equal(stepFor("in_progress").title, FINISH_TITLES.finish);
			assert.equal(stepFor("healing_check").title, FINISH_TITLES.complete);
		});
	},
);
