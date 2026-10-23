/*
 * "Change" on the one-line "How did you pay?" (TAT-110 option 2): whether its
 * choices are revealed again, as a pure reducer over what the browser's events
 * mean, so `node:test` can pin the transitions (the storefront has no DOM to
 * mount the form in). `ProofForm` turns the DOM events into these.
 *
 * What closes the choices: a pointer's pick (the change event of a pointer's
 * click, or a tap on the kind that is already the answer, which fires none), Escape, a focus that
 * moves to a real element outside, a press outside (blank space too: iOS
 * Safari moves no focus on a tap), and a pick in step 2. What never does: a
 * blur with no element to go to. A press on another chip's label blurs the
 * focused radio with `relatedTarget` null before the click lands, so closing
 * on that blur swallows the pick; a window switch blurs the same way. The
 * keyboard's arrows change the answer and keep the choices open (they move one
 * choice at a time).
 */

export interface ChangeState {
	/** The choices are revealed again. */
	readonly changing: boolean;
}

export const NOT_CHANGING: ChangeState = { changing: false };

export type ChangeEvent =
	/** The Change button was pressed. */
	| { readonly type: "open" }
	/** A new pick in step 2 answered it. */
	| { readonly type: "pick" }
	/**
	 * The answer changed (the form's change event). `byPointer` when the click
	 * behind it is a pointer's (its `detail` is above 0; the keyboard's synthetic
	 * click has 0): a pointer's pick closes the choices, the keyboard's doesn't.
	 */
	| { readonly type: "answerChanged"; readonly byPointer: boolean }
	/** A pointer tapped the radio of the kind that is the answer already (no change event). */
	| { readonly type: "sameKindTapped" }
	| { readonly type: "escape" }
	/** Focus left the choices: for a radio inside them, a real element outside, or nothing. */
	| {
			readonly type: "focusOut";
			readonly to: "inside" | "outside" | "none";
	  }
	| { readonly type: "pointerDown"; readonly where: "inside" | "outside" };

/** The next state; the same object when nothing changes, so a React reducer doesn't render. */
export function changeReducer(
	state: ChangeState,
	event: ChangeEvent,
): ChangeState {
	if (event.type === "open") return { changing: true };
	if (!state.changing) return state;
	switch (event.type) {
		case "pick":
		case "escape":
		case "sameKindTapped":
			return NOT_CHANGING;
		case "answerChanged":
			return event.byPointer ? NOT_CHANGING : state;
		case "focusOut":
			return event.to === "outside" ? NOT_CHANGING : state;
		case "pointerDown":
			return event.where === "outside" ? NOT_CHANGING : state;
	}
}

/**
 * Where focus goes after a render of the form: to the checked choice when Change
 * asked for it; to Change when the choices have just gone and focus was on one
 * of them or nowhere (`focusLost`: a pick, Escape). Never when the form mounted
 * already collapsed (`wasCollapsed` starts as the first `collapsed`: nothing
 * takes focus by itself), and never when the choices closed because focus was
 * on its way elsewhere (`focusMoving`: Tab out, a press outside): the browser
 * is about to put it there, and taking it for Change would steal it.
 */
export function answerFocus(input: {
	readonly focusChoices: boolean;
	readonly wasCollapsed: boolean;
	readonly collapsed: boolean;
	readonly focusLost: boolean;
	readonly focusMoving: boolean;
}): "choices" | "change" | null {
	if (input.focusChoices) return "choices";
	if (input.focusMoving) return null;
	return input.collapsed && !input.wasCollapsed && input.focusLost
		? "change"
		: null;
}
