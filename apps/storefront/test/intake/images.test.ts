import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	ACCEPT,
	classifySource,
	type DecodedImage,
	type EncodeRequest,
	fitWithin,
	type ImageCodec,
	MAX_REFERENCES,
	prepareReference,
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
	decode?: "fail" | "empty";
	encode?: "fail";
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
