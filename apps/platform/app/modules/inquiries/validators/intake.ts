import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { FieldContext, Infer } from "@vinejs/vine/types";
import { SOURCE_CHANNELS } from "#modules/inquiries/models/inquiry";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";
import { PHONE_MESSAGE, phoneNumber } from "#validators/phone";

/** Reference images per inquiry, at most (docs/requirements.md, Intake). */
export const MAX_REFERENCE_IMAGES = 5;

/** For a `preferredArtistId` that isn't one of the studio's visible artists. */
export const ARTIST_MESSAGE = "Choose an artist from the list, or none.";

const NUL_MESSAGE = "Remove the unsupported characters.";

/** PostgreSQL text can't hold NUL: refuse it as a field error, not a 500. */
const noNul = vine.createRule((value: unknown, _, field: FieldContext) => {
	if (typeof value === "string" && value.includes("\u0000")) {
		field.report(NUL_MESSAGE, "noNul", field);
	}
});

/** Required free text, trimmed, within its column's length. */
const text = (max: number) =>
	vine.string().trim().minLength(1).maxLength(max).use(noNul());

/** Optional free text: empty or missing is none. */
const optionalText = (max: number) =>
	vine.string().trim().maxLength(max).use(noNul()).nullable().optional();

/**
 * An inquiry from the public intake form (TAT-51), as the multipart body
 * gives it: strings, null for empty fields, and the `referenceImages` files
 * (the controller passes `request.files()`, always a list). Lengths are the
 * inquiry columns'; the phone becomes E.164. Images are only filtered here
 * (size, extension): ImageService checks what they really are. The
 * bot-challenge token is taken and ignored until TAT-55; any other field is
 * dropped.
 */
export const intakeValidator = vine.create({
	idea: text(4000),
	placement: text(120),
	approximateSize: text(120),
	preferredDates: text(500),
	preferredArtistId: vine.string().uuid().nullable().optional(),
	budget: optionalText(120),
	sourceChannel: vine.enum(SOURCE_CHANNELS),
	contactName: text(120),
	contactPhone: vine.string().trim().maxLength(40).use(phoneNumber()),
	contactEmail: vine
		.string()
		.trim()
		.maxLength(254)
		.email()
		.nullable()
		.optional(),
	referenceImages: vine
		.array(imageFile())
		.maxLength(MAX_REFERENCE_IMAGES)
		.optional(),
	challengeToken: vine.string().maxLength(2048).optional(),
});

export type IntakeSubmission = Infer<typeof intakeValidator>;

const REQUIRED = "This field is required.";
const CHANNEL = "Choose how you found the studio.";
const COUNT = `Attach up to ${MAX_REFERENCE_IMAGES} images.`;

intakeValidator.messagesProvider = new SimpleMessagesProvider({
	required: REQUIRED,
	minLength: REQUIRED,
	maxLength: "Use at most {{ max }} characters.",
	"sourceChannel.required": CHANNEL,
	"sourceChannel.enum": CHANNEL,
	"preferredArtistId.uuid": ARTIST_MESSAGE,
	"contactEmail.email": "Enter a valid email address, or leave it empty.",
	"contactPhone.required": PHONE_MESSAGE,
	"referenceImages.array.maxLength": COUNT,
	"referenceImages.*.file": IMAGE_FORMAT_MESSAGE,
	"referenceImages.*.file.extname": IMAGE_FORMAT_MESSAGE,
	"referenceImages.*.file.size": "Use images of 10 MB or less.",
});
