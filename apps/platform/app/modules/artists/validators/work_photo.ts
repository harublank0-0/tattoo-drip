import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import {
	BULK_ACTIONS,
	MAX_TATTOO_PHOTOS,
	PORTFOLIO_PAGE_SIZE,
} from "#modules/artists/portfolio";
import { MAX_PHOTO_STYLES, STYLE_SLUGS } from "#modules/artists/styles";
import { StylesErrorReporter } from "#modules/artists/validators/artist";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from "#modules/media/video";

/** A file that is not a video we take, before anything is sent. */
const VIDEO_TYPE_MESSAGE = "Use an MP4, MOV or WebM video.";

/** The description of a work photo: one line, up to this many characters. */
export const MAX_WORK_PHOTO_ALT = 200;

/**
 * What the photo's form saves (TAT-126): the description (its alt text, read
 * aloud to clients who can't see it: one line, no control characters or line
 * and paragraph separators, the studio name's rule, up to 200 characters;
 * empty clears it and the service stores null), up to three styles from the
 * list and the healed mark. Unchecked boxes are not sent, so a missing
 * `healed` means false and missing `styles` means none (the controller reads
 * both).
 */
const detailFields = () => ({
	alt: vine
		.string()
		.trim()
		.maxLength(MAX_WORK_PHOTO_ALT)
		.regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u)
		.nullable(),
	styles: vine
		.array(vine.enum(STYLE_SLUGS))
		.distinct()
		.maxLength(MAX_PHOTO_STYLES)
		.optional(),
	healed: vine.boolean().optional(),
});

export const updateWorkPhotoValidator = vine.create(detailFields());

/**
 * One work photo, as the multipart body gives it (TAT-116), and from the
 * portfolio's upload (Studio OS) its details too, by the rules of
 * updateWorkPhotoValidator; the artist's tray sends none, and a missing
 * `alt` is none. The image is only filtered here (size, extension):
 * ImageService checks what it really is.
 */
export const addWorkPhotoValidator = vine.create({
	photo: imageFile(),
	...detailFields(),
	alt: detailFields().alt.optional(),
	// Studio OS: "Publish on your page" unticked uploads it unpublished.
	hidden: vine.boolean().optional(),
	// Angles: add the photo to this tattoo (its lead's id) as its last angle.
	// The lead is loaded through findEditable, so another studio's or another
	// artist's id is a 404; its tattoo's state is the photo's, whatever else
	// is sent.
	lead: vine.string().uuid().optional(),
});

const ALT_MESSAGE = `Keep the description to one line, up to ${MAX_WORK_PHOTO_ALT} characters.`;
updateWorkPhotoValidator.messagesProvider = new SimpleMessagesProvider({
	"alt.maxLength": ALT_MESSAGE,
	"alt.regex": ALT_MESSAGE,
	"alt.string": ALT_MESSAGE,
	"alt.required": ALT_MESSAGE,
	// VineJS's key for an array's length (not "styles.maxLength").
	"styles.array.maxLength": `Pick up to ${MAX_PHOTO_STYLES} styles.`,
	"styles.*.enum": "Pick styles from the list.",
});
// An error on one style is shown under "styles", as on the artist form.
updateWorkPhotoValidator.errorReporter = () => new StylesErrorReporter();

addWorkPhotoValidator.messagesProvider = new SimpleMessagesProvider({
	"photo.required": "Choose a photo to upload.",
	"photo.file": IMAGE_FORMAT_MESSAGE,
	"photo.file.extname": IMAGE_FORMAT_MESSAGE,
	"photo.file.size": "Use an image of 10 MB or less.",
	"alt.maxLength": ALT_MESSAGE,
	"alt.regex": ALT_MESSAGE,
	"alt.string": ALT_MESSAGE,
	"styles.array.maxLength": `Pick up to ${MAX_PHOTO_STYLES} styles.`,
	"styles.*.enum": "Pick styles from the list.",
	"lead.uuid": "Choose a tattoo of this artist.",
});
addWorkPhotoValidator.errorReporter = () => new StylesErrorReporter();

/**
 * A change to several work photos at once from the portfolio (Studio OS):
 * what to do, the photos (at most a page of them, each named once) and, to
 * move them, the artist. Each photo is still loaded and checked on its own
 * (PortfolioController.bulk).
 */
export const bulkWorkPhotosValidator = vine.create({
	action: vine.enum(BULK_ACTIONS),
	ids: vine
		.array(vine.string().uuid())
		.minLength(1)
		.maxLength(PORTFOLIO_PAGE_SIZE)
		.distinct(),
	artistId: vine.string().uuid().optional(),
	// Angles: for a delete, how many photos each selected tattoo had on the
	// page (by its id), so a tattoo that changed since is not deleted.
	sizes: vine
		.record(vine.number().withoutDecimals().range([1, MAX_TATTOO_PHOTOS]))
		.optional()
		.requiredWhen("action", "=", "delete"),
});

bulkWorkPhotosValidator.messagesProvider = new SimpleMessagesProvider({
	"action.enum": "Choose what to do with the photos.",
	"ids.array.minLength": "Select a photo first.",
	"ids.array.maxLength": `Select up to ${PORTFOLIO_PAGE_SIZE} photos at a time.`,
	"ids.*.uuid": "Select photos from the portfolio.",
	"artistId.uuid": "Choose an artist of this studio.",
	"sizes.required": "Reload the page and try again.",
});

/**
 * A tattoo's photos in a new order (angles): every photo of the tattoo once,
 * the main photo first. The service checks that they are exactly the
 * tattoo's photos, under the artist's lock (WorkPhotoService.arrange).
 */
export const orderWorkPhotosValidator = vine.create({
	ids: vine
		.array(vine.string().uuid())
		.minLength(1)
		.maxLength(MAX_TATTOO_PHOTOS)
		.distinct(),
});

orderWorkPhotosValidator.messagesProvider = new SimpleMessagesProvider({
	"ids.array.minLength": "Send the tattoo's photos in their new order.",
	"ids.array.maxLength": `A tattoo has at most ${MAX_TATTOO_PHOTOS} photos.`,
	"ids.*.uuid": "Send the tattoo's photos in their new order.",
});

/**
 * What the page asked to remove (angles): `photo`, one of a tattoo's other
 * photos, or `tattoo`, a whole tattoo with the number of photos it showed.
 * Sent in the query of the DELETE, beside `back`. WorkPhotoService.remove
 * checks it under the lock, so a stale page never deletes more than it
 * showed.
 */
export const removeWorkPhotoValidator = vine.create({
	scope: vine.enum(["photo", "tattoo"] as const),
	photos: vine
		.number()
		.withoutDecimals()
		.range([1, MAX_TATTOO_PHOTOS])
		.optional()
		.requiredWhen("scope", "=", "tattoo"),
});

/**
 * Video angles, before the upload: what the browser will send, its declared
 * type (MP4, MOV or WebM) and its exact length in bytes (at most 100 MB). The
 * signature binds both, and the worker checks what the file really is.
 */
export const signWorkVideoValidator = vine.create({
	type: vine.enum(VIDEO_TYPES),
	size: vine.number().withoutDecimals().min(1).max(MAX_VIDEO_BYTES),
});
signWorkVideoValidator.messagesProvider = new SimpleMessagesProvider({
	"type.required": VIDEO_TYPE_MESSAGE,
	"type.enum": VIDEO_TYPE_MESSAGE,
	"size.max": "Use a video of 100 MB or less.",
	"size.min": "This file is empty.",
	"size.required": "Choose a video to upload.",
	"size.number": "Choose a video to upload.",
	"size.withoutDecimals": "Choose a video to upload.",
});

/**
 * Video angles, once the upload has arrived: the token the sign step gave
 * (what was signed, checked by readVideoUploadToken) and the video's own
 * description, by the photos' rule.
 */
export const addWorkVideoValidator = vine.create({
	upload: vine.string().maxLength(2048),
	alt: detailFields().alt.optional(),
});
addWorkVideoValidator.messagesProvider = new SimpleMessagesProvider({
	"upload.required": "Choose a video to upload.",
	"alt.maxLength": ALT_MESSAGE,
	"alt.regex": ALT_MESSAGE,
	"alt.string": ALT_MESSAGE,
});
