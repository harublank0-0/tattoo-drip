import logger from "@adonisjs/core/services/logger";
import sharp from "sharp";
import { limitConcurrency } from "#modules/media/concurrency";
import {
	IMAGE_FORMAT_MESSAGE,
	IMAGE_SIZE_MESSAGE,
	InvalidImageError,
} from "#modules/media/errors";
import { variantWidths } from "#modules/media/variants";

/** Larger images are rejected before decoding (decompression bombs). */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Stored images fit in this square; smaller ones are never enlarged. */
export const MAX_DIMENSION = 2048;
/** Copies are made from processImage's output only: never more pixels than this. */
const MAX_VARIANT_INPUT_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
/** JPEG copies: a little below the stored image's 85, since they are shown small. */
export const VARIANT_JPEG_QUALITY = 80;
/**
 * Images decoded at once in this process. Each can hold about 160 MB (40 MP
 * at 4 bytes a pixel), and anyone can upload references (TAT-51), so the
 * rest wait their turn.
 */
export const MAX_CONCURRENT_DECODES = 2;

const decodeSlot = limitConcurrency(MAX_CONCURRENT_DECODES);

// Keep no decoded image between calls: an upload's memory goes back as soon
// as it is processed.
sharp.cache(false);

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
 * Throws InvalidImageError for anything it can't accept. At most
 * MAX_CONCURRENT_DECODES run at once; the format check comes before the wait.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
	const detected = sniff(input);
	if (!detected) throw new InvalidImageError(IMAGE_FORMAT_MESSAGE);
	return decodeSlot(() => decode(input, detected));
}

export type ProcessedVariant = { data: Buffer; width: number; height: number };

/**
 * Smaller copies of a processed image (TAT-112): one for each of `widths`
 * below its own width (variantWidths: never enlarged), narrowest first, in
 * its own format (a PNG stays PNG; a JPEG at VARIANT_JPEG_QUALITY), with no
 * metadata. Takes a decode slot like processImage and makes one width at a
 * time. Only processImage's output may come in: an input over 2048 × 2048
 * pixels is refused. Throws on any failure; ImageService then stores the
 * image without copies.
 */
export async function makeVariants(
	image: ProcessedImage,
	widths: readonly number[],
): Promise<ProcessedVariant[]> {
	const wanted = variantWidths(image.width, widths);
	if (wanted.length === 0) return [];
	return decodeSlot(async () => {
		const variants: ProcessedVariant[] = [];
		// One source, a clone for each width: the bytes are those of a separate
		// sharp() per width (tested). A Buffer input is still decoded once per
		// clone, and that is cheap: libvips shrinks a JPEG while it decodes, so
		// the 320 px copy costs a fraction of a full decode (measured: no gain
		// from decoding once, TAT-112).
		const source = sharp(image.data, {
			limitInputPixels: MAX_VARIANT_INPUT_PIXELS,
			failOn: "error",
		});
		for (const width of wanted) {
			const resized = source.clone().resize({ width });
			const { data, info } =
				image.format === "png"
					? await resized.png().toBuffer({ resolveWithObject: true })
					: await resized
							.jpeg({ quality: VARIANT_JPEG_QUALITY, mozjpeg: true })
							.toBuffer({ resolveWithObject: true });
			if (info.width !== width) {
				throw new Error(`a ${width} px copy came out ${info.width} px wide`);
			}
			variants.push({ data, width, height: info.height });
		}
		return variants;
	});
}

/** processImage's work once the format is known and a slot is free. */
async function decode(
	input: Buffer,
	detected: "jpeg" | "png" | "webp",
): Promise<ProcessedImage> {
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
