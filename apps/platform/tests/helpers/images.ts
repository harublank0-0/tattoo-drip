import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import sharp from "sharp";
import ImageService from "#modules/media/services/image_service";

type Rgba = { r: number; g: number; b: number; alpha?: number };

function canvas(
	width: number,
	height: number,
	background: Rgba = { r: 200, g: 30, b: 30 },
) {
	const channels = background.alpha === undefined ? 3 : 4;
	return sharp({ create: { width, height, channels, background } });
}

/**
 * Images made on the fly, so no binary fixtures live in the repo.
 */
export const testImages = {
	png: (width = 300, height = 200) => canvas(width, height).png().toBuffer(),
	jpeg: (width = 300, height = 200) => canvas(width, height).jpeg().toBuffer(),
	/** A PNG with an alpha channel (half see-through), for copies that must keep it. */
	transparentPng: (width = 300, height = 200) =>
		canvas(width, height, { r: 20, g: 120, b: 60, alpha: 0.5 })
			.png()
			.toBuffer(),
	transparentWebp: () =>
		canvas(20, 20, { r: 0, g: 0, b: 0, alpha: 0 }).webp().toBuffer(),
	gif: () => canvas(10, 10).gif().toBuffer(),
	heif: () => canvas(10, 10).heif({ compression: "av1" }).toBuffer(),
	/** 7000 × 7000 = 49 MP, but only ~150 KB as a solid-colour PNG. */
	huge: () => canvas(7000, 7000).png({ compressionLevel: 9 }).toBuffer(),
	/**
	 * A phone photo: sideways (EXIF orientation 6), with a description and a
	 * GPS position.
	 */
	phonePhoto: (width = 300, height = 200) =>
		canvas(width, height)
			.jpeg()
			.withMetadata({ orientation: 6 })
			.withExifMerge({
				IFD0: { ImageDescription: "Kathmandu studio" },
				IFD3: {
					GPSLatitudeRef: "N",
					GPSLatitude: "27/1 42/1 0/1",
					GPSLongitudeRef: "E",
					GPSLongitude: "85/1 19/1 0/1",
				},
			})
			.toBuffer(),
};

/** Bytes a polyglot file hides after its image; neither a stored image nor a copy may keep them. */
export const POLYGLOT_MARKERS = ["<script>", "PK\x03\x04"];

/**
 * A real JPEG with an HTML page and a ZIP header appended: it opens as an
 * image and as the other two.
 */
export async function polyglot() {
	return Buffer.concat([
		await testImages.jpeg(1000, 800),
		Buffer.from("<html><script>alert(1)</script></html>PK\x03\x04polyglot"),
	]);
}

/**
 * What the body parser hands a service: the upload written to a temp file,
 * under tmp/storage, which the test hooks clear.
 */
export async function uploadOf(data: Buffer) {
	await mkdir(app.tmpPath("storage/uploads"), { recursive: true });
	const tmpPath = app.tmpPath("storage/uploads", randomUUID());
	await writeFile(tmpPath, data);
	return { tmpPath };
}

/**
 * ImageService that remembers every key it stored, so a test can check that
 * no stored file is left behind.
 */
export class RecordingImageService extends ImageService {
	keys: string[] = [];

	override async store(...args: Parameters<ImageService["store"]>) {
		const stored = await super.store(...args);
		this.keys.push(stored.key);
		return stored;
	}
}
