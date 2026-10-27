/**
 * The state an inline confirmation keeps (TAT-108), as a pure step so a unit test pins it:
 * Playwright is not in CI. `InlineConfirm` replaces `window.confirm` for one-tap actions.
 */

export type ConfirmState = { open: boolean; saving: boolean };
export const CONFIRM_CLOSED: ConfirmState = { open: false, saving: false };

/** ask: the trigger; keep: the safe button or Escape; confirm: the action; finished: the answer. */
export type ConfirmEvent = "ask" | "keep" | "confirm" | "finished";
/** Where focus goes after a step: the safe button, back to the trigger, or nowhere. */
export type ConfirmFocus = "keep" | "trigger" | null;

/**
 * The next state and where focus goes. Asking opens the panel on the safe button. Keeping closes
 * it and returns focus to the trigger. Confirming starts the request; while it is out, asking,
 * keeping (Escape too) and a second confirm change nothing, so a double tap sends one request.
 * The answer closes the panel and returns focus whatever it was: a refusal shows as the page's
 * toast.
 */
export function confirmStep(
	state: ConfirmState,
	event: ConfirmEvent,
): ConfirmState & { focus: ConfirmFocus } {
	const stay = { ...state, focus: null } as const;
	switch (event) {
		case "ask":
			return state.saving ? stay : { open: true, saving: false, focus: "keep" };
		case "keep":
			return state.open && !state.saving
				? { open: false, saving: false, focus: "trigger" }
				: stay;
		case "confirm":
			return state.open && !state.saving
				? { open: true, saving: true, focus: null }
				: stay;
		case "finished":
			return { open: false, saving: false, focus: "trigger" };
	}
}

/**
 * Where focus lands after a step that may remove the button that had it: the trigger when it is
 * still on the page, else the fallback (the page's heading), else nowhere.
 */
export function focusBack<T extends { isConnected: boolean }>(
	trigger: T | null,
	fallback: T | null,
): T | null {
	if (trigger?.isConnected) return trigger;
	return fallback?.isConnected ? fallback : null;
}

/**
 * A trigger's `onKeyDown`: the repeat of a held Enter does nothing. When a sheet or a confirmation
 * closes, focus goes back to its trigger; a key still held down would press it again and reopen
 * what has just been answered (and, in a sheet, submit the next empty form).
 */
export function ignoreHeldEnter(event: {
	key: string;
	repeat: boolean;
	preventDefault(): void;
}): void {
	if (event.key === "Enter" && event.repeat) event.preventDefault();
}
