import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ConfirmModule` below restates its shape and the inertia project type-checks the real one.
import * as confirmModule from "../../../inertia/components/confirm.js";
// @ts-expect-error TS6305: as above, for `SheetsModule`.
import * as sheetsModule from "../../../inertia/components/sheets.js";

type Confirm = { open: boolean; saving: boolean };
type Focus = "keep" | "trigger" | null;
type ConfirmModule = {
	CONFIRM_CLOSED: Confirm;
	confirmStep(
		state: Confirm,
		event: "ask" | "keep" | "confirm" | "finished",
	): Confirm & { focus: Focus };
	focusBack<T extends { isConnected: boolean }>(
		trigger: T | null,
		fallback: T | null,
	): T | null;
};
const { CONFIRM_CLOSED, confirmStep, focusBack } =
	confirmModule as ConfirmModule;

type Flash =
	| { error?: string | null; success?: string | null }
	| null
	| undefined;
type Sheet = { open: boolean; saving: boolean; message: string | null };
type SheetEvent =
	| { type: "open" | "dismiss" | "start" | "finished" }
	| { type: "saved"; flash: Flash };
type SheetsModule = {
	SHEET_CLOSED: Sheet;
	sheetAfterSave(flash: Flash): { close: boolean; message: string | null };
	sheetStep(state: Sheet, event: SheetEvent): Sheet;
};
const { SHEET_CLOSED, sheetAfterSave, sheetStep } =
	sheetsModule as SheetsModule;

const OPEN: Confirm = { open: true, saving: false };
const SAVING: Confirm = { open: true, saving: true };

test.group("confirmStep (TAT-108)", () => {
	test("asking opens the panel with focus on the safe button", ({ assert }) => {
		assert.deepEqual(confirmStep(CONFIRM_CLOSED, "ask"), {
			open: true,
			saving: false,
			focus: "keep",
		});
	});

	test("keeping, which Escape also does, closes it and gives focus back to the trigger", ({
		assert,
	}) => {
		assert.deepEqual(confirmStep(OPEN, "keep"), {
			open: false,
			saving: false,
			focus: "trigger",
		});
	});

	test("confirming starts saving and moves no focus", ({ assert }) => {
		assert.deepEqual(confirmStep(OPEN, "confirm"), {
			open: true,
			saving: true,
			focus: null,
		});
	});

	test("a second confirm, or Escape or Keep, while the request is out changes nothing", ({
		assert,
	}) => {
		for (const event of ["confirm", "keep", "ask"] as const) {
			assert.deepEqual(confirmStep(SAVING, event), { ...SAVING, focus: null });
		}
	});

	test("the answer closes the panel and focus goes back, whether the move worked or was refused", ({
		assert,
	}) => {
		assert.deepEqual(confirmStep(SAVING, "finished"), {
			open: false,
			saving: false,
			focus: "trigger",
		});
		// An answer that arrives with nothing open (the page moved on) is harmless.
		assert.deepEqual(confirmStep(CONFIRM_CLOSED, "finished"), {
			open: false,
			saving: false,
			focus: "trigger",
		});
	});

	test("confirming a panel that is not open does nothing", ({ assert }) => {
		assert.deepEqual(confirmStep(CONFIRM_CLOSED, "confirm"), {
			...CONFIRM_CLOSED,
			focus: null,
		});
		assert.deepEqual(confirmStep(CONFIRM_CLOSED, "keep"), {
			...CONFIRM_CLOSED,
			focus: null,
		});
	});

	test("asking again while open keeps it open on the safe button", ({
		assert,
	}) => {
		assert.deepEqual(confirmStep(OPEN, "ask"), { ...OPEN, focus: "keep" });
	});
});

test.group("focusBack (TAT-108)", () => {
	const connected = { isConnected: true, name: "trigger" };
	const gone = { isConnected: false, name: "gone" };
	const heading = { isConnected: true, name: "heading" };

	test("is the trigger while it is on the page", ({ assert }) => {
		assert.equal(focusBack(connected, heading), connected);
	});

	test("is the fallback when the save removed the trigger", ({ assert }) => {
		assert.equal(focusBack(gone, heading), heading);
		assert.equal(focusBack(null, heading), heading);
	});

	test("is nothing when neither is there", ({ assert }) => {
		assert.isNull(focusBack(gone, null));
		assert.isNull(focusBack(null, null));
		assert.isNull(focusBack(gone, gone));
	});
});

test.group("sheetAfterSave (TAT-108)", () => {
	test("a save without an error flash closes the sheet", ({ assert }) => {
		for (const flash of [
			undefined,
			null,
			{},
			{ error: undefined },
			{ error: null },
			{ error: "" },
			{ success: "Payment recorded." },
		]) {
			assert.deepEqual(
				sheetAfterSave(flash),
				{ close: true, message: null },
				JSON.stringify(flash),
			);
		}
	});

	test("a refused rule keeps it open with the message", ({ assert }) => {
		assert.deepEqual(
			sheetAfterSave({
				error: "This quote was revised while you were editing.",
			}),
			{
				close: false,
				message: "This quote was revised while you were editing.",
			},
		);
	});
});

test.group("sheetStep (TAT-108)", () => {
	const OPENED: Sheet = { open: true, saving: false, message: null };
	const SENDING: Sheet = { open: true, saving: true, message: null };

	test("opens clean and dismisses clean", ({ assert }) => {
		assert.deepEqual(sheetStep(SHEET_CLOSED, { type: "open" }), OPENED);
		assert.deepEqual(
			sheetStep({ ...OPENED, message: "old" }, { type: "dismiss" }),
			SHEET_CLOSED,
		);
		// Reopening shows no message from the last time.
		assert.deepEqual(
			sheetStep(sheetStep({ ...OPENED, message: "old" }, { type: "dismiss" }), {
				type: "open",
			}),
			OPENED,
		);
	});

	test("starting a save clears the last message", ({ assert }) => {
		assert.deepEqual(
			sheetStep({ ...OPENED, message: "old" }, { type: "start" }),
			SENDING,
		);
	});

	test("a save that goes through closes the sheet", ({ assert }) => {
		assert.deepEqual(
			sheetStep(SENDING, { type: "saved", flash: { success: "Saved." } }),
			SHEET_CLOSED,
		);
		assert.deepEqual(
			sheetStep(SENDING, { type: "saved", flash: undefined }),
			SHEET_CLOSED,
		);
	});

	test("a save the rules refuse leaves it open with the message, ready to try again", ({
		assert,
	}) => {
		const refused = sheetStep(SENDING, {
			type: "saved",
			flash: { error: "Nothing to refund." },
		});
		assert.deepEqual(refused, {
			open: true,
			saving: false,
			message: "Nothing to refund.",
		});
		// The next try starts clean; a second refusal shows its own message.
		const again = sheetStep(refused, { type: "start" });
		assert.isNull(again.message);
		assert.equal(
			sheetStep(again, { type: "saved", flash: { error: "Still no." } })
				.message,
			"Still no.",
		);
	});

	test("a refusal never opens a sheet that is closed", ({ assert }) => {
		assert.deepEqual(
			sheetStep(SHEET_CLOSED, { type: "saved", flash: { error: "No." } }),
			SHEET_CLOSED,
		);
		assert.deepEqual(
			sheetStep(SHEET_CLOSED, { type: "saved", flash: null }),
			SHEET_CLOSED,
		);
	});

	test("dismissing while the save is out is ignored, so a refusal is never lost", ({
		assert,
	}) => {
		assert.deepEqual(sheetStep(SENDING, { type: "dismiss" }), SENDING);
	});

	test("a field error (no success) leaves it open; the request ending frees the buttons", ({
		assert,
	}) => {
		assert.deepEqual(sheetStep(SENDING, { type: "finished" }), OPENED);
		assert.deepEqual(sheetStep(OPENED, { type: "finished" }), OPENED);
		assert.deepEqual(
			sheetStep(SHEET_CLOSED, { type: "finished" }),
			SHEET_CLOSED,
		);
	});
});
