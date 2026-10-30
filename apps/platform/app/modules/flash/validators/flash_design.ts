import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";

/** A design's name: one line, up to this many characters. */
export const MAX_FLASH_NAME = 80;
/** A design's size, in words ("About 3 in"): one line, up to this many characters. */
export const MAX_FLASH_SIZE = 60;
/** The most a design can cost, in whole rupees. */
export const MAX_FLASH_PRICE = 10_000_000;

/**
 * One line, no control characters or line and paragraph separators (the work
 * photo description's rule), at least one character after trimming.
 */
const ONE_LINE = /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u;

const line = (max: number) =>
	vine.string().trim().minLength(1).maxLength(max).regex(ONE_LINE);

/** The price in whole rupees; empty (null) keeps it for each client's quote. */
const price = () =>
	vine
		.number()
		.withoutDecimals()
		.range([1, MAX_FLASH_PRICE])
		.nullable()
		.optional();

const NAME = `Give the design a name, up to ${MAX_FLASH_NAME} characters on one line.`;
const SIZE = `Say how big it is, like About 3 in: up to ${MAX_FLASH_SIZE} characters on one line.`;
const PRICE = "Enter whole rupees from 1 to 1,00,00,000, or leave it empty.";

const FIELD_MESSAGES = {
	"name.required": NAME,
	"name.string": NAME,
	"name.minLength": NAME,
	"name.maxLength": NAME,
	"name.regex": NAME,
	"size.required": SIZE,
	"size.string": SIZE,
	"size.minLength": SIZE,
	"size.maxLength": SIZE,
	"size.regex": SIZE,
	"price.number": PRICE,
	"price.withoutDecimals": PRICE,
	"price.range": PRICE,
};

/**
 * A new design as the artist page's multipart form sends it (TAT-129). The
 * picture is only filtered here (size, extension): ImageService checks what
 * it really is.
 */
export const addFlashDesignValidator = vine.create({
	picture: imageFile(),
	name: line(MAX_FLASH_NAME),
	size: line(MAX_FLASH_SIZE),
	price: price(),
});

addFlashDesignValidator.messagesProvider = new SimpleMessagesProvider({
	...FIELD_MESSAGES,
	"picture.required": "Choose a picture of the design.",
	"picture.file": IMAGE_FORMAT_MESSAGE,
	"picture.file.extname": IMAGE_FORMAT_MESSAGE,
	"picture.file.size": "Use an image of 10 MB or less.",
});

/**
 * What the design's sheet saves: the words, the price and whether the design
 * is shown. An unchecked box is not sent, so a missing `shown` means hidden
 * (the controller reads it).
 */
export const updateFlashDesignValidator = vine.create({
	name: line(MAX_FLASH_NAME),
	size: line(MAX_FLASH_SIZE),
	price: price(),
	shown: vine.boolean().optional(),
});

updateFlashDesignValidator.messagesProvider = new SimpleMessagesProvider(
	FIELD_MESSAGES,
);
