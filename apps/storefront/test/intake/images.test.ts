import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	ACCEPT,
	classifySource,
	DECODE_TIMEOUT_MS,
	type DecodedImage,
	ENCODE_TIMEOUT_MS,
	type EncodeRequest,
	fitWithin,
	type ImageCodec,
	MAX_REFERENCES,
	MAX_SOURCE_PIXELS,
	prepareReference,
	type Timer,
} from "../../src/intake/images.ts";

const MIB = 1024 * 1024;

interface FakeImage extends DecodedImage {
	closed: boolean;
}

interface FakeOptions {
	/** The decoded size, the right way up (EXIF orientation applied). */
	width?: number;
	height?: number;
	/** What each encode returns, in bytes, in order. */
	sizes?: number[];
	decode?: "fail" | "empty" | "never";
	encode?: "fail" | "never";
}

/** A codec that decodes to the size it is told and encodes blobs of chosen sizes. */
function fakeCodec(options: FakeOptions = {}) {
	const encoded: EncodeRequest[] = [];
	const images: FakeImage[] = [];
	let decoded = 0;
	const codec: ImageCodec<FakeImage> = {
		async decode() {
			decoded += 1;
			if (options.decode === "fail") throw new Error("can't decode");
			if (options.decode === "never") return new Promise<FakeImage>(() => {});
			const empty = options.decode === "empty";
			const image: FakeImage = {
				width: empty ? 0 : (options.width ?? 4032),
				height: empty ? 0 : (options.height ?? 3024),
				closed: false,
				close: () => {
					image.closed = true;
				},
			};
			images.push(image);
			return image;
		},
		async encode(_image, request) {
			encoded.push(request);
			if (options.encode === "fail") throw new Error("no canvas");
			if (options.encode === "never") return new Promise<Blob>(() => {});
			const size = options.sizes?.[encoded.length - 1] ?? 400_000;
			return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
		},
	};
	return { codec, encoded, images, decodedCount: () => decoded };
}

/** A picked file whose size is `size` without allocating it. */
function picked(name = "IMG_0042.JPG", type = "image/jpeg", size = 3_000_000) {
	const file = new File([new Uint8Array(8)], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

/** A timer that runs only when told to, and records what was asked of it. */
function fakeTimer() {
	const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
	const timer: Timer = (run, ms) => {
		const entry = { run, ms, cancelled: false };
		timers.push(entry);
		return () => {
			entry.cancelled = true;
		};
	};
	return { timers, timer };
}

/** Lets the work in flight run until `ready` (a few event-loop turns at most). */
async function until(ready: () => boolean): Promise<void> {
	for (let turn = 0; turn < 50 && !ready(); turn += 1) {
		await new Promise((done) => setImmediate(done));
	}
}

/** A picked PNG that is only its header: the size it declares, never the pixels. */
function pngOf(width: number, height: number, name = "declared.png") {
	const word = (value: number) => [
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff,
	];
	return new File(
		[
			Uint8Array.from([
				0x89,
				0x50,
				0x4e,
				0x47,
				0x0d,
				0x0a,
				0x1a,
				0x0a,
				0,
				0,
				0,
				13,
				0x49,
				0x48,
				0x44,
				0x52,
				...word(width),
				...word(height),
				8,
				6,
				0,
				0,
				0,
			]),
		],
		name,
		{ type: "image/png" },
	);
}

describe("the picker", () => {
	test("asks for JPEG, PNG or WebP, so iOS converts HEIC itself", () => {
		assert.equal(ACCEPT, "image/jpeg,image/png,image/webp");
		assert.equal(MAX_REFERENCES, 5);
	});
});

describe("classifySource", () => {
	test("by type", () => {
		for (const type of [
			"image/jpeg",
			"image/jpg",
			"image/png",
			"image/webp",
			"IMAGE/PNG",
		]) {
			assert.equal(classifySource({ name: "x", type }), "supported", type);
		}
		for (const type of ["image/heic", "image/heif", "image/heic-sequence"]) {
			assert.equal(classifySource({ name: "x", type }), "heic", type);
		}
		for (const type of [
			"image/gif",
			"image/avif",
			"image/svg+xml",
			"video/mp4",
			"application/pdf",
		]) {
			assert.equal(
				classifySource({ name: "x.jpg", type }),
				"unsupported",
				type,
			);
		}
	});

	test("by extension when the phone gives no type", () => {
		assert.equal(classifySource({ name: "a.JPG", type: "" }), "supported");
		assert.equal(
			classifySource({ name: "a.webp", type: "application/octet-stream" }),
			"supported",
		);
		assert.equal(classifySource({ name: "a.HEIC", type: "" }), "heic");
		assert.equal(classifySource({ name: "a.gif", type: "" }), "unsupported");
		assert.equal(classifySource({ name: "photo", type: "" }), "unsupported");
	});
});

describe("fitWithin", () => {
	test("shrinks the long edge to the limit and keeps the shape", () => {
		assert.deepEqual(fitWithin(4032, 3024, 1600), {
			width: 1600,
			height: 1200,
		});
		assert.deepEqual(fitWithin(3024, 4032, 1600), {
			width: 1200,
			height: 1600,
		});
		assert.deepEqual(fitWithin(5000, 5000, 1280), {
			width: 1280,
			height: 1280,
		});
		assert.deepEqual(fitWithin(16000, 9, 1600), { width: 1600, height: 1 });
	});

	test("never enlarges", () => {
		assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
		assert.deepEqual(fitWithin(1600, 1600, 1600), {
			width: 1600,
			height: 1600,
		});
	});
});

describe("prepareReference", () => {
	test("makes a 1600 px JPEG on white, named reference.jpg, from one decode", async () => {
		const { codec, encoded, images, decodedCount } = fakeCodec();
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.name, "reference.jpg");
		assert.equal(result.file.type, "image/jpeg");
		assert.equal(result.file.size, 400_000);
		assert.deepEqual([result.width, result.height], [1600, 1200]);
		assert.deepEqual(encoded, [
			{
				width: 1600,
				height: 1200,
				quality: 0.85,
				type: "image/jpeg",
				background: "#ffffff",
			},
		]);
		assert.equal(decodedCount(), 1);
		assert.equal(images[0].closed, true);
	});

	test("goes by the decoded size, so a portrait phone photo stays portrait", async () => {
		const { codec, encoded } = fakeCodec({ width: 3024, height: 4032 });
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.deepEqual([encoded[0].width, encoded[0].height], [1200, 1600]);
	});

	test("never enlarges a small photo", async () => {
		const { codec, encoded } = fakeCodec({ width: 800, height: 600 });
		await prepareReference(picked("a.png", "image/png"), codec);

		assert.deepEqual([encoded[0].width, encoded[0].height], [800, 600]);
	});

	test("lowers the quality, then the size, until a photo is at most 1 MiB", async () => {
		const { codec, encoded } = fakeCodec({
			sizes: [2 * MIB, 1.5 * MIB, 0.9 * MIB],
		});
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.size, Math.floor(0.9 * MIB));
		assert.deepEqual(
			encoded.map(({ width, quality }) => [width, quality]),
			[
				[1600, 0.85],
				[1600, 0.72],
				[1280, 0.72],
			],
		);
		assert.deepEqual([result.width, result.height], [1280, 960]);
	});

	test("stops at the first step under 1 MiB", async () => {
		const { codec, encoded } = fakeCodec({ sizes: [1.2 * MIB, 0.8 * MIB] });
		await prepareReference(picked(), codec);

		assert.equal(encoded.length, 2);
	});

	test("keeps the last step when it is over 1 MiB but at most 3.5 MiB", async () => {
		const { codec } = fakeCodec({ sizes: [3 * MIB, 3 * MIB, 3.5 * MIB] });
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.size, 3.5 * MIB);
	});

	test("refuses a photo that stays over 3.5 MiB, so five stay under the API's 20 MB", async () => {
		const { codec, images } = fakeCodec({
			sizes: [5 * MIB, 4 * MIB, 3.6 * MIB],
		});

		assert.deepEqual(await prepareReference(picked(), codec), {
			ok: false,
			problem: "too-heavy",
		});
		assert.equal(images[0].closed, true);
	});

	test("refuses other types and huge files without decoding them", async () => {
		const { codec, decodedCount } = fakeCodec();

		assert.deepEqual(
			await prepareReference(picked("clip.mp4", "video/mp4"), codec),
			{
				ok: false,
				problem: "unsupported",
			},
		);
		assert.deepEqual(
			await prepareReference(
				picked("big.jpg", "image/jpeg", 50 * MIB + 1),
				codec,
			),
			{
				ok: false,
				problem: "too-big",
			},
		);
		assert.equal(decodedCount(), 0);
	});

	test("takes a file of exactly 50 MiB", async () => {
		const { codec } = fakeCodec();
		const result = await prepareReference(
			picked("big.jpg", "image/jpeg", 50 * MIB),
			codec,
		);

		assert.equal(result.ok, true);
	});

	test("converts a HEIC the browser can decode, and names one it can't", async () => {
		const heic = () => picked("IMG_0001.HEIC", "image/heic");

		const converted = await prepareReference(heic(), fakeCodec().codec);
		assert.ok(converted.ok);
		assert.equal(converted.file.type, "image/jpeg");

		assert.deepEqual(
			await prepareReference(heic(), fakeCodec({ decode: "fail" }).codec),
			{
				ok: false,
				problem: "heic",
			},
		);
	});

	test("a JPEG that won't decode, or decodes to nothing, is unreadable", async () => {
		assert.deepEqual(
			await prepareReference(picked(), fakeCodec({ decode: "fail" }).codec),
			{
				ok: false,
				problem: "unreadable",
			},
		);
		const empty = fakeCodec({ decode: "empty" });
		assert.deepEqual(await prepareReference(picked(), empty.codec), {
			ok: false,
			problem: "unreadable",
		});
		assert.equal(empty.images[0].closed, true);
	});

	test("a failed encode is unreadable, and the decoded image is still released", async () => {
		const { codec, images } = fakeCodec({ encode: "fail" });

		assert.deepEqual(await prepareReference(picked(), codec), {
			ok: false,
			problem: "unreadable",
		});
		assert.equal(images[0].closed, true);
	});

	test("never sends the original: the result is always a new file", async () => {
		const original = picked();
		const result = await prepareReference(original, fakeCodec().codec);

		assert.ok(result.ok);
		assert.notEqual(result.file, original);
		assert.notEqual(result.file.name, original.name);
	});
});

describe("a photo that declares too many pixels", () => {
	test("is refused before any decode: 16000 x 16000 is a gigabyte of pixels", async () => {
		const { codec, decodedCount } = fakeCodec();

		assert.equal(MAX_SOURCE_PIXELS, 100_000_000);
		assert.deepEqual(await prepareReference(pngOf(16000, 16000), codec), {
			ok: false,
			problem: "too-big",
		});
		assert.equal(decodedCount(), 0);
	});

	test("takes exactly 100 megapixels, and refuses one row more", async () => {
		const exact = fakeCodec();
		assert.equal(
			(await prepareReference(pngOf(10000, 10000), exact.codec)).ok,
			true,
		);
		assert.equal(exact.decodedCount(), 1);

		const over = fakeCodec();
		assert.deepEqual(await prepareReference(pngOf(10000, 10001), over.codec), {
			ok: false,
			problem: "too-big",
		});
		assert.equal(over.decodedCount(), 0);
	});

	test("a normal phone photo goes on to the decoder, and so does a file whose header can't be read", async () => {
		const normal = fakeCodec();
		assert.equal(
			(await prepareReference(pngOf(4032, 3024), normal.codec)).ok,
			true,
		);
		assert.equal(normal.decodedCount(), 1);

		const unknown = fakeCodec();
		assert.equal((await prepareReference(picked(), unknown.codec)).ok, true);
		assert.equal(unknown.decodedCount(), 1);
	});
});

describe("a photo that takes too long", () => {
	test("a decode that never settles ends as unreadable after 20 s, so the tray is freed", async () => {
		const { codec } = fakeCodec({ decode: "never" });
		const { timers, timer } = fakeTimer();
		const result = prepareReference(picked(), codec, { timer });

		await until(() => timers.length > 0);
		assert.equal(DECODE_TIMEOUT_MS, 20_000);
		assert.equal(timers[0].ms, DECODE_TIMEOUT_MS);
		timers[0].run();

		assert.deepEqual(await result, { ok: false, problem: "unreadable" });
	});

	test("a HEIC that never decodes is unreadable too, not 'a HEIC this browser can't convert'", async () => {
		const { codec } = fakeCodec({ decode: "never" });
		const { timers, timer } = fakeTimer();
		const result = prepareReference(picked("IMG_1.HEIC", "image/heic"), codec, {
			timer,
		});

		await until(() => timers.length > 0);
		timers[0].run();

		assert.deepEqual(await result, { ok: false, problem: "unreadable" });
	});

	test("an image that decodes after the timeout is released, not leaked", async () => {
		const late: FakeImage = {
			width: 4000,
			height: 3000,
			closed: false,
			close: () => {
				late.closed = true;
			},
		};
		let arrive: (image: FakeImage) => void = () => {};
		const codec: ImageCodec<FakeImage> = {
			decode: () =>
				new Promise<FakeImage>((done) => {
					arrive = done;
				}),
			encode: async () => new Blob([new Uint8Array(10)]),
		};
		const { timers, timer } = fakeTimer();
		const result = prepareReference(picked(), codec, { timer });

		await until(() => timers.length > 0);
		timers[0].run();
		assert.equal((await result).ok, false);
		arrive(late);
		await until(() => late.closed);

		assert.equal(late.closed, true);
	});

	test("an encode that never settles ends as unreadable after 20 s, and the image is released", async () => {
		const { codec, images } = fakeCodec({ encode: "never" });
		const { timers, timer } = fakeTimer();
		const result = prepareReference(picked(), codec, { timer });

		await until(() => timers.length > 1);
		assert.equal(ENCODE_TIMEOUT_MS, 20_000);
		assert.equal(timers[1].ms, ENCODE_TIMEOUT_MS);
		timers[1].run();

		assert.deepEqual(await result, { ok: false, problem: "unreadable" });
		assert.equal(images[0].closed, true);
	});

	test("a photo that makes it leaves no timer running", async () => {
		const { codec } = fakeCodec({ sizes: [2 * MIB, 0.5 * MIB] });
		const { timers, timer } = fakeTimer();

		assert.equal((await prepareReference(picked(), codec, { timer })).ok, true);
		assert.equal(timers.length, 3, "one decode and two encodes");
		assert.ok(timers.every((entry) => entry.cancelled));
	});
});
