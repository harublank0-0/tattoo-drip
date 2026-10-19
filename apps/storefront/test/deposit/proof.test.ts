import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	NO_PROOF,
	PROOF_PROFILE,
	prepareProof,
	previewOf,
	proofReducer,
} from "../../src/deposit/proof.ts";
import {
	type DecodedImage,
	type EncodeRequest,
	type ImageCodec,
	REFERENCE_PROFILE,
} from "../../src/intake/images.ts";

const MIB = 1024 * 1024;

interface FakeImage extends DecodedImage {
	closed: boolean;
}

/** A codec that decodes to the size it is told and encodes blobs of chosen sizes. */
function fakeCodec(
	options: {
		width?: number;
		height?: number;
		sizes?: number[];
		decode?: "fail";
	} = {},
) {
	const encoded: EncodeRequest[] = [];
	const images: FakeImage[] = [];
	let decoded = 0;
	const codec: ImageCodec<FakeImage> = {
		async decode() {
			decoded += 1;
			if (options.decode === "fail") throw new Error("can't decode");
			const image: FakeImage = {
				width: options.width ?? 1080,
				height: options.height ?? 2400,
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
			const size = options.sizes?.[encoded.length - 1] ?? 300_000;
			return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
		},
	};
	return { codec, encoded, images, decodedCount: () => decoded };
}

/** A picked file whose size is `size` without allocating it. */
function picked(
	name = "Screenshot_20261018-141500.png",
	type = "image/png",
	size = 900_000,
) {
	const file = new File([new Uint8Array(8)], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

/** A PNG that is only its header: the size it declares, never the pixels. */
function declaredPng(width: number, height: number) {
	const word = (value: number) => [
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff,
	];
	const bytes = [
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
	];
	return new File([Uint8Array.from(bytes)], "declared.png", {
		type: "image/png",
	});
}

describe("the profiles", () => {
	test("a screenshot keeps 2048 px, like the platform keeps proofs", () => {
		assert.deepEqual(PROOF_PROFILE, {
			steps: [
				{ edge: 2048, quality: 0.85 },
				{ edge: 2048, quality: 0.72 },
				{ edge: 1600, quality: 0.72 },
			],
			targetBytes: 1.5 * MIB,
			maxBytes: 4 * MIB,
			name: "payment.jpg",
		});
	});

	test("the intake form's reference photos are as TAT-57 made them", () => {
		assert.deepEqual(REFERENCE_PROFILE, {
			steps: [
				{ edge: 1600, quality: 0.85 },
				{ edge: 1600, quality: 0.72 },
				{ edge: 1280, quality: 0.72 },
			],
			targetBytes: MIB,
			maxBytes: 3.5 * MIB,
			name: "reference.jpg",
		});
	});
});

describe("prepareProof", () => {
	test("keeps a tall screenshot's text readable: 2048 px, a JPEG on white, payment.jpg", async () => {
		const { codec, encoded, images, decodedCount } = fakeCodec();
		const result = await prepareProof(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.name, "payment.jpg");
		assert.equal(result.file.type, "image/jpeg");
		assert.deepEqual([result.width, result.height], [922, 2048]);
		assert.deepEqual(encoded, [
			{
				width: 922,
				height: 2048,
				quality: 0.85,
				type: "image/jpeg",
				background: "#ffffff",
			},
		]);
		assert.equal(decodedCount(), 1);
		assert.equal(images[0].closed, true);
	});

	test("never enlarges a small screenshot", async () => {
		const { codec, encoded } = fakeCodec({ width: 720, height: 1600 });
		await prepareProof(picked(), codec);

		assert.deepEqual([encoded[0].width, encoded[0].height], [720, 1600]);
	});

	test("lowers the quality, then the size, until it is at most 1.5 MiB", async () => {
		const { codec, encoded } = fakeCodec({
			sizes: [2_200_000, 1_900_000, 1_400_000],
		});
		const result = await prepareProof(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.size, 1_400_000);
		assert.deepEqual(
			encoded.map(({ width, quality }) => [width, quality]),
			[
				[922, 0.85],
				[922, 0.72],
				[720, 0.72],
			],
		);
		assert.deepEqual([result.width, result.height], [720, 1600]);
	});

	test("stops at the first step that is at most 1.5 MiB", async () => {
		const { codec, encoded } = fakeCodec({ sizes: [1_600_000, 1_500_000] });
		await prepareProof(picked(), codec);

		assert.equal(encoded.length, 2);
	});

	test("refuses one that stays over 4 MiB", async () => {
		const { codec, images } = fakeCodec({
			sizes: [5_000_000, 4_500_000, 4_300_000],
		});

		assert.deepEqual(await prepareProof(picked(), codec), {
			ok: false,
			problem: "too-heavy",
		});
		assert.equal(images[0].closed, true);
	});

	test("keeps TAT-57's bounds: type, 50 MiB, 100 megapixels, HEIC", async () => {
		const { codec, decodedCount } = fakeCodec();

		assert.deepEqual(
			await prepareProof(picked("clip.gif", "image/gif"), codec),
			{ ok: false, problem: "unsupported" },
		);
		assert.deepEqual(
			await prepareProof(picked("big.jpg", "image/jpeg", 50 * MIB + 1), codec),
			{ ok: false, problem: "too-big" },
		);
		assert.deepEqual(await prepareProof(declaredPng(20_000, 20_000), codec), {
			ok: false,
			problem: "too-big",
		});
		assert.equal(decodedCount(), 0);
		assert.deepEqual(
			await prepareProof(
				picked("IMG_0042.HEIC", "image/heic"),
				fakeCodec({ decode: "fail" }).codec,
			),
			{ ok: false, problem: "heic" },
		);
	});
});

describe("proofReducer", () => {
	const file = new File([new Uint8Array(4)], "payment.jpg", {
		type: "image/jpeg",
	});

	test("a pick is prepared, then ready", () => {
		const preparing = proofReducer(NO_PROOF, { type: "picked", id: 1 });
		assert.deepEqual(preparing, { kind: "preparing", id: 1 });
		assert.deepEqual(
			proofReducer(preparing, { type: "prepared", id: 1, file }),
			{ kind: "ready", id: 1, file },
		);
	});

	test("a refused pick leaves no screenshot and says why", () => {
		const preparing = proofReducer(NO_PROOF, { type: "picked", id: 2 });
		assert.deepEqual(
			proofReducer(preparing, {
				type: "refused",
				id: 2,
				problem: "heic",
				name: "IMG_0042.HEIC",
			}),
			{ kind: "empty", problem: { kind: "heic", name: "IMG_0042.HEIC" } },
		);
	});

	test("a result for an earlier pick, or after a removal, is dropped", () => {
		const second = proofReducer(
			proofReducer(NO_PROOF, { type: "picked", id: 1 }),
			{ type: "picked", id: 2 },
		);
		assert.equal(
			proofReducer(second, { type: "prepared", id: 1, file }),
			second,
		);
		const removed = proofReducer(second, { type: "removed" });
		assert.equal(removed, NO_PROOF);
		assert.equal(
			proofReducer(removed, { type: "prepared", id: 2, file }),
			NO_PROOF,
		);
	});
});

describe("previewOf", () => {
	test("makes one URL and frees it once, however often it is released", () => {
		const made: Blob[] = [];
		const revoked: string[] = [];
		const handle = previewOf(new Blob(["x"]), {
			create: (blob) => {
				made.push(blob);
				return "blob:preview-1";
			},
			revoke: (url) => {
				revoked.push(url);
			},
		});

		assert.equal(handle.url, "blob:preview-1");
		assert.equal(made.length, 1);
		handle.release();
		handle.release();
		assert.deepEqual(revoked, ["blob:preview-1"]);
	});
});
