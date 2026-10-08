import logger from "@adonisjs/core/services/logger";
import sharp from "sharp";
import {
	IMAGE_FORMAT_MESSAGE,
	IMAGE_SIZE_MESSAGE,
	InvalidImageError,
} from "#modules/media/errors";

/** Larger images are rejected before decoding (decompression bombs). */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Stored images fit in this square; smaller ones are never enlarged. */
export const MAX_DIMENSION = 2048;

export type ProcessedImage = {
	data: Buffer;
	format: "png" | "jpeg";
	width: number;
	height: number;
};

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Recognises the accepted formats by their first bytes, before sharp sees
 * the data, so no other decoder (SVG, GIF, HEIF, PDF…) ever runs on an
 * upload.
 */
function sniff(input: Buffer): "jpeg" | "png" | "webp" | null {
	if (
		input.length >= 3 &&
		input[0] === 0xff &&
		input[1] === 0xd8 &&
		input[2] === 0xff
	) {
		return "jpeg";
	}
	if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
	if (
		input.toString("latin1", 0, 4) === "RIFF" &&
		input.toString("latin1", 8, 12) === "WEBP"
	) {
		return "webp";
	}
	return null;
}

/**
 * Turns an upload into a clean image:
 * - checks that it really is a JPEG, PNG or WebP
 * - applies the EXIF orientation
 * - fits it in 2048 × 2048
 * - re-encodes it with no metadata (EXIF, GPS, camera data, thumbnails)
 *
 * PNG stays PNG, so QR codes stay sharp; everything else becomes JPEG.
 * Throws InvalidImageError for anything it can't accept.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
	const detected = sniff(input);
	if (!detected) throw new InvalidImageError(IMAGE_FORMAT_MESSAGE);
	if ((await pixelCount(input)) > MAX_INPUT_PIXELS) {
		throw new InvalidImageError(IMAGE_SIZE_MESSAGE);
	}

	try {
		// Inside the try: sharp's constructor can throw too (e.g. empty input).
		const image = sharp(input, {
			limitInputPixels: MAX_INPUT_PIXELS,
			failOn: "error",
		})
			.rotate()
			.resize({
				width: MAX_DIMENSION,
				height: MAX_DIMENSION,
				fit: "inside",
				withoutEnlargement: true,
			});
		const { data, info } =
			detected === "png"
				? await image.png().toBuffer({ resolveWithObject: true })
				: await image
						.flatten({ background: "#ffffff" })
						.jpeg({ quality: 85, mozjpeg: true })
						.toBuffer({ resolveWithObject: true });
		return {
			data,
			format: detected === "png" ? "png" : "jpeg",
			width: info.width,
			height: info.height,
		};
	} catch (error) {
		// Usually a broken file, but also any server-side sharp failure, so
		// keep the cause and log it.
		logger.warn({ err: error }, "image could not be processed");
		throw new InvalidImageError(IMAGE_FORMAT_MESSAGE, { cause: error });
	}
}

/**
 * Width × height from the image header, read without decoding the pixels.
 * Unreadable headers count as 0 here and fail in the decode instead.
 */
async function pixelCount(input: Buffer): Promise<number> {
	try {
		const { width = 0, height = 0 } = await sharp(input, {
			limitInputPixels: false,
		}).metadata();
		return width * height;
	} catch {
		return 0;
	}
}
