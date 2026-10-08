import sharp from "sharp";

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
	phonePhoto: () =>
		canvas(300, 200)
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
