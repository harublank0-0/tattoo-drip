import type { DecodedImage, EncodeRequest, ImageCodec } from "./images.ts";

/*
 * The browser's side of the photo pipeline (TAT-57): its own decoder and a
 * canvas. Node tests can't run it (no DOM); the browser pass checks an
 * upright portrait photo, a transparent PNG on white and the memory of five
 * large photos on a low-end phone.
 */

interface BrowserImage extends DecodedImage {
	readonly drawable: CanvasImageSource;
}

/** createImageBitmap applies EXIF orientation; an <img> is the fallback for browsers whose bitmap can't. */
async function decode(source: Blob): Promise<BrowserImage> {
	try {
		const bitmap = await createImageBitmap(source, {
			imageOrientation: "from-image",
		});
		return {
			width: bitmap.width,
			height: bitmap.height,
			drawable: bitmap,
			close: () => bitmap.close(),
		};
	} catch {
		return decodeWithImage(source);
	}
}

async function decodeWithImage(source: Blob): Promise<BrowserImage> {
	const url = URL.createObjectURL(source);
	const image = new Image();
	image.decoding = "async";
	image.src = url;
	try {
		await image.decode();
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
	return {
		width: image.naturalWidth,
		height: image.naturalHeight,
		drawable: image,
		close: () => {
			URL.revokeObjectURL(url);
			image.removeAttribute("src");
		},
	};
}

async function encode(
	image: BrowserImage,
	request: EncodeRequest,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = request.width;
	canvas.height = request.height;
	try {
		const context = canvas.getContext("2d", { alpha: false });
		if (!context) throw new Error("This browser has no 2D canvas.");
		context.fillStyle = request.background;
		context.fillRect(0, 0, request.width, request.height);
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(image.drawable, 0, 0, request.width, request.height);
		const blob = await new Promise<Blob | null>((done) =>
			canvas.toBlob(done, request.type, request.quality),
		);
		if (!blob || blob.type !== request.type) {
			throw new Error("The canvas didn't make a JPEG.");
		}
		return blob;
	} finally {
		// Free the canvas's memory at once (Safari keeps it otherwise).
		canvas.width = 0;
		canvas.height = 0;
	}
}

export const browserCodec: ImageCodec<BrowserImage> = { decode, encode };
