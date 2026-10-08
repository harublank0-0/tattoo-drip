export const IMAGE_FORMAT_MESSAGE = "Upload a JPEG, PNG or WebP image.";
export const IMAGE_SIZE_MESSAGE =
	"This image is too large. Use one under 40 megapixels.";

/**
 * An upload we can't accept as an image. The message is written for the
 * user: show it as a field error, like SlugTakenError.
 */
export class InvalidImageError extends Error {
	constructor(message: string = IMAGE_FORMAT_MESSAGE) {
		super(message);
		this.name = "InvalidImageError";
	}
}
