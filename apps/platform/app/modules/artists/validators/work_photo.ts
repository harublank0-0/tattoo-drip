import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";

/** The description of a work photo: one line, up to this many characters. */
export const MAX_WORK_PHOTO_ALT = 200;

/**
 * One work photo, as the multipart body gives it (TAT-116). The image is
 * only filtered here (size, extension): ImageService checks what it really
 * is.
 */
export const addWorkPhotoValidator = vine.create({ photo: imageFile() });

addWorkPhotoValidator.messagesProvider = new SimpleMessagesProvider({
	"photo.required": "Choose a photo to upload.",
	"photo.file": IMAGE_FORMAT_MESSAGE,
	"photo.file.extname": IMAGE_FORMAT_MESSAGE,
	"photo.file.size": "Use an image of 10 MB or less.",
});

/**
 * A photo's description (its alt text, read aloud to clients who can't see
 * it): one line, no control characters or line and paragraph separators (the
 * studio name's rule), up to 200 characters. Empty clears it; the service
 * stores null.
 */
export const describeWorkPhotoValidator = vine.create({
	alt: vine
		.string()
		.trim()
		.maxLength(MAX_WORK_PHOTO_ALT)
		.regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u)
		.nullable(),
});

const ALT_MESSAGE = `Keep the description to one line, up to ${MAX_WORK_PHOTO_ALT} characters.`;
describeWorkPhotoValidator.messagesProvider = new SimpleMessagesProvider({
	"alt.maxLength": ALT_MESSAGE,
	"alt.regex": ALT_MESSAGE,
	"alt.string": ALT_MESSAGE,
	"alt.required": ALT_MESSAGE,
});

/** Which way to move a photo in the studio's order. */
export const moveWorkPhotoValidator = vine.create({
	direction: vine.enum(["up", "down"] as const),
});

moveWorkPhotoValidator.messagesProvider = new SimpleMessagesProvider({
	"direction.enum": "Choose up or down.",
	"direction.required": "Choose up or down.",
});
