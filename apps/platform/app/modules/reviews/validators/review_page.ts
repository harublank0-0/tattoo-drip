import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { FieldContext, Infer } from "@vinejs/vine/types";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from "#modules/media/video";
import {
	charLength,
	MAX_CAPTION_LENGTH,
	MAX_PLACEMENT_LENGTH,
	MAX_POST_MEDIA,
	MAX_POST_STYLES,
	MAX_RATING,
	MAX_REVIEW_LENGTH,
	MAX_SHOWN_NAME_LENGTH,
	MIN_RATING,
	MIN_REVIEW_LENGTH,
	shownNameAllowed,
} from "#modules/reviews/rules";

/** The client's words, as the review page shows them (Reviews and Fresh ink). */
export const REVIEW_MESSAGES = {
	rating: `Choose a rating from ${MIN_RATING} to ${MAX_RATING} stars.`,
	bodyShort: `Write at least ${MIN_REVIEW_LENGTH} characters.`,
	bodyLong: `Keep your review to ${MAX_REVIEW_LENGTH.toLocaleString("en")} characters.`,
	shownName: `Write the name to show: up to ${MAX_SHOWN_NAME_LENGTH} characters, letters you can see.`,
	caption: `Keep the caption to ${MAX_CAPTION_LENGTH} characters.`,
	placement: `Keep it to ${MAX_PLACEMENT_LENGTH} characters.`,
	styles: `Choose up to ${MAX_POST_STYLES} styles from the list.`,
	order: "Reload the page and try again.",
	consent: "Reload the page and try again.",
	text: "Remove the unsupported characters.",
	needsMedia: "Add at least one photo.",
	nothing: "Write a review or add a photo.",
	photo: "Choose a photo to add.",
	video: "Choose a video to upload.",
	videoType: "Use an MP4, MOV or WebM video.",
	videoSize: "Use a video of 100 MB or less.",
} as const;

/**
 * Text the database can hold and a page can show plainly: no NUL and no
 * control character but a line break or a tab (plain text, ruling 5).
 */
const plainText = vine.createRule(
	(value: unknown, _options: undefined, field: FieldContext) => {
		if (typeof value !== "string") return;
		// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
			field.report(REVIEW_MESSAGES.text, "plainText", field);
		}
	},
);

/**
 * One line of text: no control character at all, nor a line or paragraph
 * separator (a shown name, a placement).
 */
const oneLine = vine.createRule(
	(value: unknown, _options: undefined, field: FieldContext) => {
		if (typeof value !== "string") return;
		// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
		if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) {
			field.report(REVIEW_MESSAGES.text, "oneLine", field);
		}
	},
);

/**
 * A shown name (ruling 9, finding 9): 1 to 40 characters, no control,
 * bidi or zero-width character, not blank (shownNameAllowed; the database
 * checks the same).
 */
const shownName = vine.createRule(
	(value: unknown, _options: undefined, field: FieldContext) => {
		if (typeof value !== "string") return;
		if (!shownNameAllowed(value)) {
			field.report(REVIEW_MESSAGES.shownName, "shownName", field);
		}
	},
);

/** A length in characters as PostgreSQL counts them (code points), so any script counts as people see it. */
const characters = vine.createRule(
	(
		value: unknown,
		options: { min: number; max: number; short: string; long: string },
		field: FieldContext,
	) => {
		if (typeof value !== "string") return;
		const length = charLength(value);
		if (length < options.min) field.report(options.short, "characters", field);
		else if (length > options.max)
			field.report(options.long, "characters", field);
	},
);

/**
 * The review page's submit (Reviews and Fresh ink): the shown name and the
 * two consents, which apply to the review and the post alike, and the
 * review, the post or both. Every field is checked again here whatever the
 * page checked. The styles are checked against the studio's list, and the
 * order against the post's media, by the service; the Discover consent is
 * kept as it was while the studio is not listed (the page never showed it).
 */
export const submitReviewPageValidator = vine.create({
	shownName: vine.string().trim().use(shownName()),
	consentStudioPage: vine.boolean({ strict: true }),
	consentDiscover: vine.boolean({ strict: true }),
	review: vine
		.object({
			rating: vine
				.number({ strict: true })
				.withoutDecimals()
				.range([MIN_RATING, MAX_RATING]),
			body: vine
				.string()
				.trim()
				.use(plainText())
				.use(
					characters({
						min: MIN_REVIEW_LENGTH,
						max: MAX_REVIEW_LENGTH,
						short: REVIEW_MESSAGES.bodyShort,
						long: REVIEW_MESSAGES.bodyLong,
					}),
				),
		})
		.optional(),
	post: vine
		.object({
			caption: vine
				.string()
				.trim()
				.use(plainText())
				.use(
					characters({
						min: 0,
						max: MAX_CAPTION_LENGTH,
						short: REVIEW_MESSAGES.caption,
						long: REVIEW_MESSAGES.caption,
					}),
				)
				.nullable()
				.optional(),
			styles: vine
				.array(vine.string().maxLength(64))
				.maxLength(MAX_POST_STYLES)
				.distinct(),
			placement: vine
				.string()
				.trim()
				.use(oneLine())
				.use(
					characters({
						min: 0,
						max: MAX_PLACEMENT_LENGTH,
						short: REVIEW_MESSAGES.placement,
						long: REVIEW_MESSAGES.placement,
					}),
				)
				.nullable()
				.optional(),
			order: vine
				.array(vine.string().uuid())
				.maxLength(MAX_POST_MEDIA)
				.distinct()
				.optional(),
		})
		.optional(),
});

export type ReviewPageSubmission = Infer<typeof submitReviewPageValidator>;

submitReviewPageValidator.messagesProvider = new SimpleMessagesProvider({
	"shownName.required": REVIEW_MESSAGES.shownName,
	"shownName.string": REVIEW_MESSAGES.shownName,
	"consentStudioPage.required": REVIEW_MESSAGES.consent,
	"consentStudioPage.boolean": REVIEW_MESSAGES.consent,
	"consentDiscover.required": REVIEW_MESSAGES.consent,
	"consentDiscover.boolean": REVIEW_MESSAGES.consent,
	"review.object": REVIEW_MESSAGES.rating,
	"review.rating.required": REVIEW_MESSAGES.rating,
	"review.rating.number": REVIEW_MESSAGES.rating,
	"review.rating.withoutDecimals": REVIEW_MESSAGES.rating,
	"review.rating.range": REVIEW_MESSAGES.rating,
	"review.body.required": REVIEW_MESSAGES.bodyShort,
	"review.body.string": REVIEW_MESSAGES.bodyShort,
	"post.object": REVIEW_MESSAGES.order,
	"post.caption.string": REVIEW_MESSAGES.caption,
	"post.placement.string": REVIEW_MESSAGES.placement,
	"post.styles.required": REVIEW_MESSAGES.styles,
	"post.styles.array": REVIEW_MESSAGES.styles,
	"post.styles.maxLength": REVIEW_MESSAGES.styles,
	"post.styles.distinct": REVIEW_MESSAGES.styles,
	"post.styles.*.string": REVIEW_MESSAGES.styles,
	"post.styles.*.maxLength": REVIEW_MESSAGES.styles,
	"post.order.array": REVIEW_MESSAGES.order,
	"post.order.maxLength": REVIEW_MESSAGES.order,
	"post.order.distinct": REVIEW_MESSAGES.order,
	"post.order.*.string": REVIEW_MESSAGES.order,
	"post.order.*.uuid": REVIEW_MESSAGES.order,
});

/** One photo for the post, as the multipart body gives it (the first `photo` part). */
export const addPostPhotoValidator = vine.create({ photo: imageFile() });
addPostPhotoValidator.messagesProvider = new SimpleMessagesProvider({
	"photo.required": REVIEW_MESSAGES.photo,
	"photo.file": REVIEW_MESSAGES.photo,
	"photo.file.size": "Use a photo of 10 MB or less.",
	"photo.file.extname": IMAGE_FORMAT_MESSAGE,
});

/** A video's type and exact length, before its upload is signed. */
export const signPostVideoValidator = vine.create({
	type: vine.enum(VIDEO_TYPES),
	size: vine.number().withoutDecimals().min(1).max(MAX_VIDEO_BYTES),
});
signPostVideoValidator.messagesProvider = new SimpleMessagesProvider({
	"type.required": REVIEW_MESSAGES.videoType,
	"type.enum": REVIEW_MESSAGES.videoType,
	"size.max": REVIEW_MESSAGES.videoSize,
	"size.min": "This file is empty.",
	"size.required": REVIEW_MESSAGES.video,
	"size.number": REVIEW_MESSAGES.video,
	"size.withoutDecimals": REVIEW_MESSAGES.video,
});

/** The finished upload: the token the sign step gave. */
export const addPostVideoValidator = vine.create({
	upload: vine.string().maxLength(2048),
});
addPostVideoValidator.messagesProvider = new SimpleMessagesProvider({
	"upload.required": REVIEW_MESSAGES.video,
	"upload.string": REVIEW_MESSAGES.video,
	"upload.maxLength": REVIEW_MESSAGES.video,
});

/** The post's new order alone ("Make photo 3 the main photo"): every item's id, a photo first. */
export const reorderPostValidator = vine.create({
	order: vine
		.array(vine.string().uuid())
		.minLength(1)
		.maxLength(MAX_POST_MEDIA)
		.distinct(),
});
reorderPostValidator.messagesProvider = new SimpleMessagesProvider({
	"order.required": REVIEW_MESSAGES.order,
	"order.array": REVIEW_MESSAGES.order,
	"order.minLength": REVIEW_MESSAGES.order,
	"order.maxLength": REVIEW_MESSAGES.order,
	"order.distinct": REVIEW_MESSAGES.order,
	"order.*.string": REVIEW_MESSAGES.order,
	"order.*.uuid": REVIEW_MESSAGES.order,
});
