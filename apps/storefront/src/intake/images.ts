import type { PhotoProblem } from "./copy.ts";

/*
 * Reference photos, prepared in the browser before the upload (TAT-57, spec
 * ruling 5): each one decoded once, shrunk and re-encoded as a JPEG, so an
 * upload on a slow connection stays small and no EXIF or GPS data leaves the
 * phone. The decoder and the canvas sit behind ImageCodec: browser-codec.ts
 * in the page, a fake in test/intake/images.test.ts.
 */

/** The picker's types: with exactly these, iOS hands over a JPEG for a HEIC photo. */
export const ACCEPT = "image/jpeg,image/png,image/webp";
/** At most this many photos per inquiry (the API's limit, TAT-51). */
export const MAX_REFERENCES = 5;

const MIB = 1024 * 1024;
/** Picked files over this are refused before decoding (memory on low-end phones). */
export const MAX_SOURCE_BYTES = 50 * MIB;
/** A prepared photo at most this big is done. */
export const TARGET_BYTES = MIB;
/** A prepared photo over this is refused: five of them stay under the API's 20 MB. */
export const MAX_PREPARED_BYTES = 3.5 * MIB;
/** Tried in order until one gives at most TARGET_BYTES. */
export const ENCODE_STEPS = [
	{ edge: 1600, quality: 0.85 },
	{ edge: 1600, quality: 0.72 },
	{ edge: 1280, quality: 0.72 },
] as const;
export const PREPARED_TYPE = "image/jpeg";
/** The sent file's name, never the picked file's own. */
export const PREPARED_NAME = "reference.jpg";
/** JPEG has no transparency: transparent pixels become white, not black. */
export const BACKGROUND = "#ffffff";

export interface DecodedImage {
	readonly width: number;
	readonly height: number;
	/** Frees the decoded pixels. */
	close(): void;
}

export interface EncodeRequest {
	readonly width: number;
	readonly height: number;
	readonly quality: number;
	readonly type: typeof PREPARED_TYPE;
	readonly background: typeof BACKGROUND;
}

export interface ImageCodec<Image extends DecodedImage = DecodedImage> {
	/** Decodes the file the right way up (EXIF orientation applied). */
	decode(source: Blob): Promise<Image>;
	/** Draws the image at the requested size on the background and encodes it. */
	encode(image: Image, request: EncodeRequest): Promise<Blob>;
}

export type SourceKind = "supported" | "heic" | "unsupported";

export type PreparedReference =
	| {
			readonly ok: true;
			readonly file: File;
			readonly width: number;
			readonly height: number;
	  }
	| { readonly ok: false; readonly problem: PhotoProblem };

const SUPPORTED_TYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/pjpeg",
	"image/png",
	"image/webp",
]);
const HEIC_TYPES = new Set([
	"image/heic",
	"image/heif",
	"image/heic-sequence",
	"image/heif-sequence",
]);
const SUPPORTED_EXTENSION = /\.(jpe?g|png|webp)$/i;
const HEIC_EXTENSION = /\.(heic|heif)$/i;

/** What a picked file is, by its type, or by its name when the phone gives no type. */
export function classifySource(file: {
	readonly name: string;
	readonly type: string;
}): SourceKind {
	const type = file.type.toLowerCase();
	if (SUPPORTED_TYPES.has(type)) return "supported";
	if (HEIC_TYPES.has(type)) return "heic";
	if (type === "" || type === "application/octet-stream") {
		if (SUPPORTED_EXTENSION.test(file.name)) return "supported";
		if (HEIC_EXTENSION.test(file.name)) return "heic";
	}
	return "unsupported";
}

/** The size with the long edge at most `edge`, the same shape, never enlarged. */
export function fitWithin(
	width: number,
	height: number,
	edge: number,
): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= edge) return { width, height };
	const scale = edge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** One picked file as the JPEG the form sends, or why it can't be. */
export async function prepareReference<Image extends DecodedImage>(
	source: File,
	codec: ImageCodec<Image>,
): Promise<PreparedReference> {
	const kind = classifySource(source);
	if (kind === "unsupported") return { ok: false, problem: "unsupported" };
	if (source.size > MAX_SOURCE_BYTES) return { ok: false, problem: "too-big" };

	let image: Image;
	try {
		image = await codec.decode(source);
	} catch {
		return { ok: false, problem: kind === "heic" ? "heic" : "unreadable" };
	}

	try {
		if (!(image.width > 0 && image.height > 0)) {
			return { ok: false, problem: "unreadable" };
		}
		let best: { blob: Blob; width: number; height: number } | null = null;
		for (const step of ENCODE_STEPS) {
			const size = fitWithin(image.width, image.height, step.edge);
			const blob = await codec.encode(image, {
				...size,
				quality: step.quality,
				type: PREPARED_TYPE,
				background: BACKGROUND,
			});
			best = { blob, ...size };
			if (blob.size <= TARGET_BYTES) break;
		}
		if (!best || best.blob.size > MAX_PREPARED_BYTES) {
			return { ok: false, problem: "too-heavy" };
		}
		return {
			ok: true,
			file: new File([best.blob], PREPARED_NAME, { type: PREPARED_TYPE }),
			width: best.width,
			height: best.height,
		};
	} catch {
		return { ok: false, problem: "unreadable" };
	} finally {
		image.close();
	}
}
