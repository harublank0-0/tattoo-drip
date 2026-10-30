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

/** A logo's two tiles (TAT-123), "#rrggbb": the colour behind it on the studio page. */
export type TileColours = { light: string; dark: string };

/** A logo is judged on a copy at most this many pixels on a side: enough for shares, cheap to read. */
const TILE_SAMPLE = 64;
/** WCAG's minimum for graphics (1.4.11): a pixel under 3:1 against a tile is hard to see on it. */
const MIN_TILE_CONTRAST = 3;
/**
 * The icon's side (TAT-123): Apple's home-screen size; its 32 px copy is the browser tab's (ICON_WIDTHS).
 * The public contract advertises this as the stored icon's width and height without reading the
 * file, so changing it needs a backfill of every `logo_icon_key` row (the stored icons keep the old size).
 */
export const ICON_SIZE = 180;
/** The margin around the logo inside its icon, a tenth of each side, so iOS's rounded corners never cut it. */
export const ICON_PADDING = 18;

function linear(value: number): number {
	const c = value / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function hexLuminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((start) =>
		Number.parseInt(hex.slice(start, start + 2), 16),
	);
	return luminance(r, g, b);
}

function contrast(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The tile a logo shows on (TAT-123): "dark" when more than half of what can
 * be seen of it is under 3:1 on the light tile and less of it is under 3:1 on
 * the dark one (a white or yellow logo); "light" otherwise, and always for a
 * logo with nothing see-through (a JPEG, an opaque PNG: the tile is only a thin
 * frame around it) or nothing visible. Pixels count by their opacity, on a copy
 * at most TILE_SAMPLE px on a side. Takes a decode slot; only processImage's
 * output may come in.
 */
export async function logoTile(
	image: ProcessedImage,
	tiles: TileColours,
): Promise<"light" | "dark"> {
	if (image.format !== "png") return "light";
	return decodeSlot(async () => {
		const { data, info } = await sharp(image.data, {
			limitInputPixels: MAX_VARIANT_INPUT_PIXELS,
			failOn: "error",
		})
			.toColourspace("srgb")
			.ensureAlpha()
			.resize({ width: TILE_SAMPLE, height: TILE_SAMPLE, fit: "inside" })
			.raw()
			.toBuffer({ resolveWithObject: true });
		if (info.channels !== 4) {
			throw new Error(`a tile sample came out with ${info.channels} channels`);
		}
		const light = hexLuminance(tiles.light);
		const dark = hexLuminance(tiles.dark);
		let seen = 0;
		let hiddenOnLight = 0;
		let hiddenOnDark = 0;
		let seeThrough = false;
		for (let index = 0; index < data.length; index += 4) {
			const alpha = data[index + 3];
			if (alpha < 255) seeThrough = true;
			if (alpha === 0) continue;
			const weight = alpha / 255;
			const pixel = luminance(data[index], data[index + 1], data[index + 2]);
			seen += weight;
			if (contrast(pixel, light) < MIN_TILE_CONTRAST) hiddenOnLight += weight;
			if (contrast(pixel, dark) < MIN_TILE_CONTRAST) hiddenOnDark += weight;
		}
		if (!seeThrough || seen === 0) return "light";
		return hiddenOnLight > seen / 2 && hiddenOnDark < hiddenOnLight
			? "dark"
			: "light";
	});
}

/**
 * A logo's square icon (TAT-123): an ICON_SIZE px PNG, the logo fitted inside a
 * margin of ICON_PADDING (enlarged when smaller), centred on `background` (a
 * tile's "#rrggbb"), never see-through: a home screen fills transparency with
 * black. Takes a decode slot. Store it with storeBytes: its copies come from
 * its purpose.
 */
export async function squareIcon(
	image: ProcessedImage,
	background: string,
): Promise<Buffer> {
	return decodeSlot(async () => {
		const inner = ICON_SIZE - 2 * ICON_PADDING;
		const fitted = await sharp(image.data, {
			limitInputPixels: MAX_VARIANT_INPUT_PIXELS,
			failOn: "error",
		})
			.resize({ width: inner, height: inner, fit: "inside" })
			.png()
			.toBuffer();
		return sharp({
			create: { width: ICON_SIZE, height: ICON_SIZE, channels: 3, background },
		})
			.composite([{ input: fitted, gravity: "centre" }])
			.png()
			.toBuffer();
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
