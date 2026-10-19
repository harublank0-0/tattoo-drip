/*
 * An image's size from its first bytes (TAT-57): a PNG, JPEG or WebP says
 * how many pixels it holds in its header, long before a decoder has to
 * allocate them. A few hundred KB of PNG can declare 16000x16000 pixels
 * (a gigabyte decoded), enough to kill a low-end phone's tab, so the form
 * reads the size first and refuses what is too big without decoding it
 * (images.ts). Pure: bytes in, numbers out.
 */

/** How much of the file's start is read: room for the EXIF, XMP and ICC segments before a JPEG's frame header. */
export const HEADER_WINDOW_BYTES = 256 * 1024;

export interface ImageSize {
	readonly width: number;
	readonly height: number;
}

/**
 * The size the header declares, or null when this isn't a PNG, JPEG or WebP
 * it can read (then the browser's decoder decides). Reads one slice from the
 * start of the file, never the rest.
 */
export async function readImageSize(
	source: Pick<Blob, "slice">,
): Promise<ImageSize | null> {
	let data: Uint8Array;
	try {
		data = new Uint8Array(
			await source.slice(0, HEADER_WINDOW_BYTES).arrayBuffer(),
		);
	} catch {
		return null;
	}
	return pngSize(data) ?? jpegSize(data) ?? webpSize(data);
}

const be16 = (data: Uint8Array, at: number) => (data[at] << 8) | data[at + 1];
const be32 = (data: Uint8Array, at: number) =>
	((data[at] << 24) |
		(data[at + 1] << 16) |
		(data[at + 2] << 8) |
		data[at + 3]) >>>
	0;
const le16 = (data: Uint8Array, at: number) => data[at] | (data[at + 1] << 8);
const le24 = (data: Uint8Array, at: number) =>
	data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
const le32 = (data: Uint8Array, at: number) =>
	(le24(data, at) | (data[at + 3] << 24)) >>> 0;
const text = (data: Uint8Array, at: number, length: number) =>
	String.fromCharCode(...data.subarray(at, at + length));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** IHDR comes first: width and height are the two big-endian words after its name. */
function pngSize(data: Uint8Array): ImageSize | null {
	if (data.length < 24) return null;
	if (!PNG_SIGNATURE.every((byte, index) => data[index] === byte)) return null;
	if (text(data, 12, 4) !== "IHDR") return null;
	return { width: be32(data, 16), height: be32(data, 20) };
}

/** Walks the marker segments to the first start-of-frame (SOF0 to SOF15, bar the tables). */
function jpegSize(data: Uint8Array): ImageSize | null {
	if (data[0] !== 0xff || data[1] !== 0xd8) return null;
	let at = 2;
	while (at + 4 <= data.length) {
		if (data[at] !== 0xff) return null;
		const marker = data[at + 1];
		if (marker === 0xff) {
			at += 1; // fill byte
		} else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			at += 2; // standalone marker: no length
		} else if (marker === 0xd9 || marker === 0xda) {
			return null; // the image ends or its scan starts before any frame header
		} else if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			if (at + 9 > data.length) return null;
			return { height: be16(data, at + 5), width: be16(data, at + 7) };
		} else {
			const length = be16(data, at + 2);
			if (length < 2) return null;
			at += 2 + length;
		}
	}
	return null;
}

/** A WebP's first chunk says it, in one of three forms (extended, lossless, lossy). */
function webpSize(data: Uint8Array): ImageSize | null {
	if (data.length < 21) return null;
	if (text(data, 0, 4) !== "RIFF" || text(data, 8, 4) !== "WEBP") return null;
	switch (text(data, 12, 4)) {
		case "VP8X":
			if (data.length < 30) return null;
			return { width: le24(data, 24) + 1, height: le24(data, 27) + 1 };
		case "VP8L": {
			if (data.length < 25 || data[20] !== 0x2f) return null;
			const bits = le32(data, 21);
			return {
				width: (bits & 0x3fff) + 1,
				height: ((bits >>> 14) & 0x3fff) + 1,
			};
		}
		case "VP8 ":
			if (data.length < 30) return null;
			if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) {
				return null;
			}
			return {
				width: le16(data, 26) & 0x3fff,
				height: le16(data, 28) & 0x3fff,
			};
		default:
			return null;
	}
}
