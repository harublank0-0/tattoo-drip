import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { MANUAL_MOVE_NAMES } from "#modules/projects/moves";

/** A manual status move from the project page. */
export const moveValidator = vine.create({
	move: vine.enum(MANUAL_MOVE_NAMES),
});
moveValidator.messagesProvider = new SimpleMessagesProvider({
	"move.required": "Choose a change.",
	"move.enum": "Choose a change.",
});

/** The project's notes; an empty box arrives as null and clears them. */
export const notesValidator = vine.create({
	notes: vine.string().trim().maxLength(4000).nullable(),
});
notesValidator.messagesProvider = new SimpleMessagesProvider({
	"notes.maxLength": "Keep notes under 4,000 characters.",
});

/** The project's artist; "No artist" arrives as null. */
export const artistValidator = vine.create({
	artistId: vine.string().uuid().nullable(),
});
artistValidator.messagesProvider = new SimpleMessagesProvider({
	"artistId.uuid": "Choose an artist from the list.",
});

/**
 * A finish step (TAT-111): the balance due the confirmation named, in paisa
 * as digits; left out, or "0", when the page named none. At most 20 digits,
 * so a hostile value never reaches BigInt.
 */
export const finishValidator = vine.create({
	confirmedDue: vine
		.string()
		.trim()
		.regex(/^\d{1,20}$/)
		.optional(),
});
finishValidator.messagesProvider = new SimpleMessagesProvider({
	"confirmedDue.regex": "Reload the page and try again.",
});
