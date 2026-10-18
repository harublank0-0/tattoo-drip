import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	HEADER_WINDOW_BYTES,
	readImageSize,
} from "../../src/intake/image-size.ts";

/*
 * Tiny hand-built headers: just the bytes a decoder reads to learn an
 * image's size, never an image of that size.
 */

const bytes = (...parts: ReadonlyArray<ArrayLike<number>>): Uint8Array =>
	Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const ascii = (text: string): number[] =>
	Array.from(text, (char) => char.charCodeAt(0));
const u16be = (value: number) => [value >> 8, value & 0xff];
const u32be = (value: number) => [
	(value >>> 24) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 8) & 0xff,
	value & 0xff,
];
const u24le = (value: number) => [
	value & 0xff,
	(value >> 8) & 0xff,
	(value >> 16) & 0xff,
];
const u32le = (value: number) => [...u24le(value), (value >>> 24) & 0xff];
const blob = (data: Uint8Array, type = "") =>
	new Blob([data as BlobPart], { type });

function png(width: number, height: number): Uint8Array {
	return bytes(
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		u32be(13),
		ascii("IHDR"),
		u32be(width),
		u32be(height),
		[8, 6, 0, 0, 0],
	);
}

/** A JPEG header: SOI, optional segments, then a start-of-frame segment. */
function jpeg(
	width: number,
	height: number,
	options: { sof?: number; before?: ReadonlyArray<ArrayLike<number>> } = {},
): Uint8Array {
	const frame = bytes(
		[0xff, options.sof ?? 0xc0],
		u16be(17),
		[8],
		u16be(height),
		u16be(width),
		[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
	);
	return bytes([0xff, 0xd8], ...(options.before ?? []), frame);
}

/** A marker segment of `size` payload bytes. */
const segment = (marker: number, size: number) =>
	bytes([0xff, marker], u16be(size + 2), new Uint8Array(size));

function webpHeader(chunk: string, payload: number[]): Uint8Array {
	return bytes(
		ascii("RIFF"),
		u32le(4 + 8 + payload.length),
		ascii("WEBP"),
		ascii(chunk),
		u32le(payload.length),
		payload,
	);
}
const vp8x = (width: number, height: number) =>
	webpHeader("VP8X", [0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]);
const vp8l = (width: number, height: number) =>
	webpHeader("VP8L", [
		0x2f,
		...u32le(((width - 1) | ((height - 1) << 14)) >>> 0),
	]);
const vp8 = (width: number, height: number) =>
	webpHeader("VP8 ", [
		...[0, 0, 0], // frame tag
		...[0x9d, 0x01, 0x2a], // start code
		width & 0xff,
		(width >> 8) & 0x3f,
		height & 0xff,
		(height >> 8) & 0x3f,
	]);

describe("readImageSize", () => {
	test("reads a PNG's IHDR", async () => {
		assert.deepEqual(await readImageSize(blob(png(16000, 12000))), {
			width: 16000,
			height: 12000,
		});
		assert.deepEqual(await readImageSize(blob(png(1, 1))), {
			width: 1,
			height: 1,
		});
	});

	test("reads a JPEG's start of frame, baseline or progressive", async () => {
		assert.deepEqual(await readImageSize(blob(jpeg(4032, 3024))), {
			width: 4032,
			height: 3024,
		});
		assert.deepEqual(
			await readImageSize(blob(jpeg(30000, 20000, { sof: 0xc2 }))),
			{ width: 30000, height: 20000 },
		);
	});

	test("walks past big segments before the frame, and past a Huffman table", async () => {
		const header = jpeg(8000, 6000, {
			before: [
				segment(0xe0, 14),
				segment(0xe1, 65_000),
				segment(0xe2, 60_000),
				segment(0xdb, 130),
				segment(0xc4, 30),
			],
		});

		assert.ok(header.length > 120_000);
		assert.ok(header.length < HEADER_WINDOW_BYTES);
		assert.deepEqual(await readImageSize(blob(header)), {
			width: 8000,
			height: 6000,
		});
	});

	test("reads a WebP of each kind", async () => {
		assert.deepEqual(await readImageSize(blob(vp8x(5000, 3000))), {
			width: 5000,
			height: 3000,
		});
		assert.deepEqual(await readImageSize(blob(vp8l(16383, 16000))), {
			width: 16383,
			height: 16000,
		});
		assert.deepEqual(await readImageSize(blob(vp8(1200, 900))), {
			width: 1200,
			height: 900,
		});
	});

	test("says nothing about what it can't read, so the decoder decides", async () => {
		const cases: Array<[string, Uint8Array]> = [
			["nothing", new Uint8Array(0)],
			["zeros", new Uint8Array(64)],
			["a GIF", bytes(ascii("GIF89a"), [1, 0, 1, 0], new Uint8Array(20))],
			["a cut-off PNG", png(10, 10).slice(0, 20)],
			["a cut-off JPEG", jpeg(10, 10).slice(0, 8)],
			["a cut-off WebP", vp8x(10, 10).slice(0, 20)],
			[
				"a JPEG whose scan starts before any frame",
				bytes([0xff, 0xd8], [0xff, 0xda], u16be(2)),
			],
			[
				"a JPEG with no frame in the window",
				bytes(
					[0xff, 0xd8],
					segment(0xe1, 65_000),
					segment(0xe2, 65_000),
					segment(0xe3, 65_000),
					segment(0xe4, 65_000),
					segment(0xe5, 65_000),
					jpeg(9, 9).slice(2),
				),
			],
		];
		for (const [name, data] of cases) {
			assert.equal(await readImageSize(blob(data)), null, name);
		}
	});

	test("reads one slice from the start of the file, and no more", async () => {
		const slices: Array<[number | undefined, number | undefined]> = [];
		const source = blob(jpeg(3000, 2000));
		const spy = {
			slice(start?: number, end?: number) {
				slices.push([start, end]);
				return source.slice(start, end);
			},
		};

		assert.deepEqual(await readImageSize(spy), { width: 3000, height: 2000 });
		assert.deepEqual(slices, [[0, HEADER_WINDOW_BYTES]]);
	});
});
