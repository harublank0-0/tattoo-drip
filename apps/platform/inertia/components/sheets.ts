/**
 * The state a bottom sheet with a form keeps (TAT-108), as pure steps so a unit test pins it:
 * Playwright is not in CI. A sheet closes only after a save that went through; a save the rules
 * refuse (an error flash) keeps it open with the message inside it, and the typed values stay
 * because the page does not remount.
 */

/** The flash a save answered with; only the error matters here. */
export type SheetFlash = { error?: string | null } | null | undefined;

/** What a save's answer does to the sheet: close it, or stay open with the refusal's words. */
export function sheetAfterSave(flash: SheetFlash): {
	close: boolean;
	message: string | null;
} {
	const error = flash?.error ?? null;
	return error
		? { close: false, message: error }
		: { close: true, message: null };
}

export type SheetState = {
	open: boolean;
	/** A request is out: the sheet can't be dismissed, so its answer is never lost. */
	saving: boolean;
	/** A refusal's words, shown inside the sheet in a `role="alert"` paragraph. */
	message: string | null;
};
export const SHEET_CLOSED: SheetState = {
	open: false,
	saving: false,
	message: null,
};

export type SheetEvent =
	| { type: "open" }
	| { type: "dismiss" }
	| { type: "start" }
	| { type: "saved"; flash: SheetFlash }
	| { type: "finished" };

/**
 * open: the trigger. dismiss: Escape, the close button, Cancel or a tap outside; ignored while a
 * save is out. start: the form was submitted. saved: the request went through (a field error is
 * not this: it leaves the sheet as it is). finished: the request ended either way.
 */
export function sheetStep(state: SheetState, event: SheetEvent): SheetState {
	switch (event.type) {
		case "open":
			return { open: true, saving: false, message: null };
		case "dismiss":
			return state.saving ? state : SHEET_CLOSED;
		case "start":
			return state.open ? { ...state, saving: true, message: null } : state;
		case "saved": {
			if (!state.open) return state;
			const { close, message } = sheetAfterSave(event.flash);
			return close ? SHEET_CLOSED : { open: true, saving: false, message };
		}
		case "finished":
			return state.saving ? { ...state, saving: false } : state;
	}
}
