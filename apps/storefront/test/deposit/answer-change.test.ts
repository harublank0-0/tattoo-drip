import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	answerFocus,
	type ChangeEvent,
	type ChangeState,
	changeReducer,
	NOT_CHANGING,
} from "../../src/deposit/answer-change.ts";
import { answerCollapsed } from "../../src/deposit/view-model.ts";

/*
 * "Change" on the one-line "How did you pay?" (TAT-110 option 2, fix round 5): the
 * state transitions the browser's events drive, as a pure reducer, because the
 * storefront has no DOM to mount the form in. The rules: a pick (a pointer's
 * change, or the same kind tapped), Escape, a focus that moves to a real element
 * outside, a press outside and a pick in step 2 close it; a blur with no element
 * to go to (a press on a label, a window switch, iOS Safari, which doesn't focus
 * radios) never does.
 */

const run = (
	events: readonly ChangeEvent[],
	from: ChangeState = NOT_CHANGING,
) => events.reduce(changeReducer, from);
const OPEN = run([{ type: "open" }]);

describe("changeReducer", () => {
	test("Change opens it", () => {
		assert.deepEqual(OPEN, { changing: true });
	});

	test("while it is not open nothing but Change does anything (the same state back)", () => {
		const events: ChangeEvent[] = [
			{ type: "pick" },
			{ type: "answerChanged", byPointer: true },
			{ type: "answerChanged", byPointer: false },
			{ type: "sameKindTapped" },
			{ type: "escape" },
			{ type: "focusOut", to: "outside" },
			{ type: "pointerDown", where: "outside" },
		];
		for (const event of events) {
			assert.equal(
				changeReducer(NOT_CHANGING, event),
				NOT_CHANGING,
				event.type,
			);
		}
	});

	test("a tap on another chip's label: the press, the blur with nowhere to go, then the change; it closes on the change, never on the blur", () => {
		let state = run(
			[
				{ type: "pointerDown", where: "inside" },
				{ type: "focusOut", to: "none" },
			],
			OPEN,
		);
		assert.equal(state.changing, true, "the blur must not close it");

		state = run([{ type: "answerChanged", byPointer: true }], state);
		assert.deepEqual(state, NOT_CHANGING);
	});

	test("a pointer's tap on the chip that is already the answer fires no change: it closes on the tap", () => {
		const state = run(
			[
				{ type: "pointerDown", where: "inside" },
				{ type: "focusOut", to: "none" },
				{ type: "sameKindTapped" },
			],
			OPEN,
		);

		assert.deepEqual(state, NOT_CHANGING);
	});

	test("the keyboard's arrows change the answer and keep it open; Escape closes it", () => {
		let state = run(
			[
				{ type: "answerChanged", byPointer: false },
				{ type: "answerChanged", byPointer: false },
			],
			OPEN,
		);
		assert.equal(state.changing, true);

		state = run([{ type: "escape" }], state);
		assert.deepEqual(state, NOT_CHANGING);
	});

	test("a focus that moves inside the choices, or to nothing, keeps it open; to a real element outside (Tab out) closes it", () => {
		assert.equal(
			run([{ type: "focusOut", to: "inside" }], OPEN).changing,
			true,
		);
		assert.equal(run([{ type: "focusOut", to: "none" }], OPEN).changing, true);
		assert.deepEqual(
			run([{ type: "focusOut", to: "outside" }], OPEN),
			NOT_CHANGING,
		);
	});

	test("a press outside (blank space too: iOS Safari moves no focus) closes it; a press inside does not", () => {
		assert.equal(
			run([{ type: "pointerDown", where: "inside" }], OPEN).changing,
			true,
		);
		assert.deepEqual(
			run([{ type: "pointerDown", where: "outside" }], OPEN),
			NOT_CHANGING,
		);
	});

	test("a pick in step 2 answers it and closes it", () => {
		assert.deepEqual(run([{ type: "pick" }], OPEN), NOT_CHANGING);
	});

	test("it can be opened again after any way of closing", () => {
		for (const closing of [
			{ type: "answerChanged", byPointer: true },
			{ type: "sameKindTapped" },
			{ type: "escape" },
			{ type: "pick" },
			{ type: "focusOut", to: "outside" },
			{ type: "pointerDown", where: "outside" },
		] as const) {
			assert.deepEqual(
				run([closing, { type: "open" }], OPEN),
				OPEN,
				closing.type,
			);
		}
	});
});

describe("an answer with an error shows its choices, and the line comes back when it clears", () => {
	const base = {
		answer: "bank",
		kinds: ["esewa", "bank"] as const,
		pick: { id: "bank:1", kind: "bank" as const, count: 1 },
	};

	test("collapsed, refused (an error on the field), the choices; then the kind changes and the error clears: collapsed", () => {
		assert.equal(
			answerCollapsed({ ...base, changing: false, hasError: false }),
			true,
		);
		assert.equal(
			answerCollapsed({ ...base, changing: false, hasError: true }),
			false,
		);
		assert.equal(
			answerCollapsed({
				...base,
				answer: "esewa",
				changing: false,
				hasError: false,
			}),
			true,
		);
	});
});

describe("answerFocus", () => {
	const idle = {
		focusChoices: false,
		wasCollapsed: false,
		collapsed: false,
		focusLost: false,
		focusMoving: false,
	};

	test("Change asks for the checked choice", () => {
		assert.equal(answerFocus({ ...idle, focusChoices: true }), "choices");
	});

	test("the choices going while focus was on one of them (a pick, Escape) put it on Change", () => {
		assert.equal(
			answerFocus({
				...idle,
				collapsed: true,
				wasCollapsed: false,
				focusLost: true,
			}),
			"change",
		);
	});

	test("leaving the choices (focus went elsewhere) is left where it went", () => {
		assert.equal(
			answerFocus({
				...idle,
				collapsed: true,
				wasCollapsed: false,
				focusLost: false,
			}),
			null,
		);
	});

	test("the choices closing because focus is on its way elsewhere (Tab out, a press outside) take nothing", () => {
		assert.equal(
			answerFocus({
				...idle,
				collapsed: true,
				wasCollapsed: false,
				focusLost: true,
				focusMoving: true,
			}),
			null,
		);
	});

	test("a form that mounts already collapsed (rebuilt after a refused screenshot) takes no focus", () => {
		// wasCollapsed starts as the first `collapsed`, so there is no change to react to.
		assert.equal(
			answerFocus({
				...idle,
				collapsed: true,
				wasCollapsed: true,
				focusLost: true,
			}),
			null,
		);
	});

	test("nothing else moves focus", () => {
		assert.equal(answerFocus(idle), null);
		assert.equal(
			answerFocus({ ...idle, wasCollapsed: true, focusLost: true }),
			null,
		);
	});
});
