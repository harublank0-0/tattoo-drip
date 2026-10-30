/**
 * Whether focus on `element` opens the phone's keyboard (TAT-84): a text
 * field, a textarea or editable text. Buttons, boxes, files, selects and the
 * date and time inputs open a picker or nothing. No imports: the unit tests
 * load it.
 */

/** The input types that open a picker or nothing, never the keyboard. */
const NO_KEYBOARD = new Set([
	"button",
	"checkbox",
	"color",
	"date",
	"datetime-local",
	"file",
	"hidden",
	"image",
	"month",
	"radio",
	"range",
	"reset",
	"submit",
	"time",
	"week",
]);

export type FocusTarget = {
	tagName: string;
	type?: string;
	readOnly?: boolean;
	isContentEditable?: boolean;
};

export function opensKeyboard(element: FocusTarget | null): boolean {
	if (!element) return false;
	if (element.isContentEditable) return true;
	const tag = element.tagName.toLowerCase();
	if (tag === "textarea") return !element.readOnly;
	if (tag !== "input") return false;
	return (
		!element.readOnly &&
		!NO_KEYBOARD.has((element.type ?? "text").toLowerCase())
	);
}
