export const IMAGE_FORMAT_MESSAGE = "Upload a JPEG, PNG or WebP image.";
export const IMAGE_SIZE_MESSAGE =
	"This image is too large. Use one under 40 megapixels.";

/**
 * An upload we can't accept as an image. The message is written for the
 * user: show it as a field error, like SlugTakenError.
 */
export class InvalidImageError extends Error {
	constructor(message: string = IMAGE_FORMAT_MESSAGE, options?: ErrorOptions) {
		super(message, options);
		this.name = "InvalidImageError";
	}
}

/**
 * Some of an image's files could not be deleted (TAT-116), so the image is
 * still reachable: the caller must not report the image as removed. `failed`
 * lists the keys left. The message is for developers; the dashboard words its
 * own.
 */
export class ImageDeleteError extends Error {
	constructor(
		readonly purpose: string,
		readonly failed: readonly string[],
	) {
		super(
			`${failed.length} stored file(s) of a ${purpose} image were not deleted`,
		);
		this.name = "ImageDeleteError";
	}
}
