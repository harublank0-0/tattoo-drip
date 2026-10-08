# Image Pipeline (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Claude implements this plan test-first; the user reviews the result.

**Goal:** One service that checks, cleans and stores uploaded images on a public or private disk. Studio QR codes (TAT-26) are its first user.

**Architecture:**
- `@adonisjs/drive` has two local disks, `public` and `private`. Production moves them to R2 in TAT-27.
- `processImage(buffer)` is pure. It sniffs magic bytes, then sharp re-encodes the image without metadata.
- `ImageService` maps a purpose to a disk, builds random keys, and gives out public or signed URLs.

**Tech Stack:** AdonisJS 7, `@adonisjs/drive` 4 (flydrive 2), sharp 0.35, Japa.

**Spec:** `docs/superpowers/specs/2026-10-08-image-pipeline-design.md`

## Global Constraints

- **Formats:**
  - Accepted inputs: JPEG, PNG, WebP. Only PNG and JPEG are ever written.
  - Pixel limit: 40,000,000.
  - Output fits 2048 × 2048 and is never enlarged.
  - JPEG quality 85 (mozjpeg); transparency is flattened onto `#ffffff`.
- **Keys:** `tenants/<tenantId>/<purpose>/<uuid v4>.<png|jpg>`.
- **URLs:** private URLs are signed for 5 minutes. `/uploads/*` serves the public disk and `/files/*` serves the private one.
- **Errors:** `InvalidImageError` uses these messages:
  - `Upload a JPEG, PNG or WebP image.`
  - `This image is too large. Use one under 40 megapixels.`
- **No .env:**
  - Never read or edit `.env`, so don't run `node ace add @adonisjs/drive`: its codemod writes `.env`. Configure Drive by hand.
- **Tooling:**
  - Run `node ace codegen` after adding the provider, and commit `.adonisjs/`.
  - If port 3333 is busy, run tests as `PORT=3402 node ace test …`.
- **Commits** use the `platform` scope and end with `Refs: TAT-21`.

## Review Focus

- **An encoded path-traversal request** (`/uploads/..%2F..%2Fpackage.json`) must not return 200 or the file's content. Task 1.
- **A private file requested through the public route** must return neither 200 nor its content. Drive answers 500 for a file it can't find; that's acceptable in dev. Task 1.
- **A signature made for one file, reused on another key**, gets 401. Task 1.
- **An SVG renamed `.png`** must be rejected (sharp *would* decode it), and it must never reach sharp. Task 2.
- **An empty or truncated upload** gets `InvalidImageError`, never a crash. Task 2.

---

### Task 1: Drive disks and file serving

**Files:**
- Create: `apps/platform/config/drive.ts`
- Create: `apps/platform/tests/functional/media/file_serving.spec.ts`
- Modify:
  - `apps/platform/adonisrc.ts` (providers)
  - `apps/platform/.gitignore`
  - `apps/platform/tests/bootstrap.ts` (runnerHooks)
  - `.adonisjs/` (codegen)

**Interfaces:** produces the disks `drive.use("public")` and `drive.use("private")`, and the routes `drive.public.serve` and `drive.private.serve`.

- [ ] **Step 1: Install**
  - Run `pnpm --filter @tattoo-drip/platform add @adonisjs/drive@^4.0.0 sharp@^0.35.5`.
  - sharp has no install script, so `allowBuilds` doesn't change.

- [ ] **Step 2: Write the failing test** (`tests/functional/media/file_serving.spec.ts`)

```ts
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";

test.group("File serving", () => {
	test("tests write to tmp/storage, not the real storage folder", async ({ assert }) => {
		await drive.use("public").put("tests/where.txt", "here");
		assert.isTrue(existsSync(app.tmpPath("storage/public/tests/where.txt")));
	});

	test("a public file is served", async ({ client }) => {
		await drive.use("public").put("tests/a.txt", "hello");
		const response = await client.get("/uploads/tests/a.txt");
		response.assertStatus(200);
		response.assertTextIncludes("hello");
	});

	test("a private file without a signature gets 401", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");
		(await client.get("/files/tests/b.txt")).assertStatus(401);
	});

	test("a private file with a valid signature is served", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");
		const url = await drive.use("private").getSignedUrl("tests/b.txt", { expiresIn: "5 minutes" });
		const response = await client.get(url);
		response.assertStatus(200);
		response.assertTextIncludes("secret");
	});

	test("a signature for one file doesn't open another", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");
		await drive.use("private").put("tests/c.txt", "other secret");
		const url = await drive.use("private").getSignedUrl("tests/b.txt");
		(await client.get(url.replace("tests/b.txt", "tests/c.txt"))).assertStatus(401);
	});

	test("an expired signature gets 401", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");
		const url = await drive.use("private").getSignedUrl("tests/b.txt", { expiresIn: "1s" });
		await sleep(1500);
		(await client.get(url)).assertStatus(401);
	});

	test("a private file isn't reachable through the public route", async ({ client, assert }) => {
		await drive.use("private").put("tests/d.txt", "secret");
		const response = await client.get("/uploads/tests/d.txt");
		assert.notEqual(response.status(), 200);
		assert.notInclude(response.text(), "secret");
	});

	test("an encoded ../ can't escape the disk", async ({ client, assert }) => {
		const response = await client.get("/uploads/..%2F..%2Fpackage.json");
		assert.notEqual(response.status(), 200);
		assert.notInclude(response.text(), "@tattoo-drip/platform");
	});
});
```

- [ ] **Step 3: Run it.** `node ace test --files tests/functional/media/file_serving.spec.ts`. Expected: it fails because `@adonisjs/drive/services/main` has no config or provider.

- [ ] **Step 4: Configure Drive**

`config/drive.ts`:

```ts
import app from "@adonisjs/core/services/app";
import { defineConfig, services } from "@adonisjs/drive";

/**
 * One disk per visibility. Store images through ImageService
 * (#modules/media/services/image_service), which picks the disk from the
 * image's purpose. Dev and tests use local folders served by the app;
 * production points both disks at R2 (TAT-27).
 */
const root = (disk: string) =>
	app.inTest ? app.tmpPath("storage", disk) : app.makePath("storage", disk);

const driveConfig = defineConfig({
	default: "public",
	services: {
		public: services.fs({
			location: root("public"),
			visibility: "public",
			serveFiles: true,
			routeBasePath: "/uploads",
		}),
		/** Served only through signed URLs; anything else gets 401. */
		private: services.fs({
			location: root("private"),
			visibility: "private",
			serveFiles: true,
			routeBasePath: "/files",
		}),
	},
});

export default driveConfig;

declare module "@adonisjs/drive/types" {
	export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
```

Then:
- `adonisrc.ts`: add `() => import("@adonisjs/drive/drive_provider"),` after the queue provider.
- `apps/platform/.gitignore`: add `# Uploaded files (local Drive disks)` followed by `storage`.
- `tests/bootstrap.ts`, in `runnerHooks`:
  - `setup: [() => rm(app.tmpPath("storage"), { recursive: true, force: true })]`
  - the same function in `teardown`
  - add the imports `rm` from `node:fs/promises` and `app` if they're missing.
- Run `node ace codegen`.

- [ ] **Step 5: Run it again.** Expected: 8 pass. Then run the whole suite.

- [ ] **Step 6: Commit** `feat(platform): add public and private Drive disks`.

---

### Task 2: processImage

**Files:**
- Create: `apps/platform/app/modules/media/errors.ts`
- Create: `apps/platform/app/modules/media/services/image_processor.ts`
- Create: `apps/platform/tests/helpers/images.ts`
- Create: `apps/platform/tests/unit/modules/media/image_processor.spec.ts`

**Interfaces:** produces
- `processImage(input: Buffer): Promise<ProcessedImage>`
- `ProcessedImage = { data: Buffer; format: "png" | "jpeg"; width: number; height: number }`
- `InvalidImageError`, `IMAGE_FORMAT_MESSAGE`, `IMAGE_SIZE_MESSAGE`
- `testImages`

- [ ] **Step 1: Test images** (`tests/helpers/images.ts`)

```ts
import sharp from "sharp";

type Rgba = { r: number; g: number; b: number; alpha?: number };

function canvas(width: number, height: number, background: Rgba = { r: 200, g: 30, b: 30 }) {
	const channels = background.alpha === undefined ? 3 : 4;
	return sharp({ create: { width, height, channels, background } });
}

/** Images made on the fly, so no binary fixtures live in the repo. */
export const testImages = {
	png: (width = 300, height = 200) => canvas(width, height).png().toBuffer(),
	jpeg: (width = 300, height = 200) => canvas(width, height).jpeg().toBuffer(),
	transparentWebp: () => canvas(20, 20, { r: 0, g: 0, b: 0, alpha: 0 }).webp().toBuffer(),
	gif: () => canvas(10, 10).gif().toBuffer(),
	heif: () => canvas(10, 10).heif({ compression: "av1" }).toBuffer(),
	/** 7000 × 7000 = 49 MP, but only ~150 KB as a solid-colour PNG. */
	huge: () => canvas(7000, 7000).png({ compressionLevel: 9 }).toBuffer(),
	/** A phone photo: sideways (EXIF orientation 6), with a description and a GPS position. */
	phonePhoto: () =>
		canvas(300, 200)
			.jpeg()
			.withMetadata({ orientation: 6 })
			.withExifMerge({
				IFD0: { ImageDescription: "Kathmandu studio" },
				IFD3: { GPSLatitudeRef: "N", GPSLatitude: "27/1 42/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "85/1 19/1 0/1" },
			})
			.toBuffer(),
};
```

- [ ] **Step 2: Write the failing tests** (`tests/unit/modules/media/image_processor.spec.ts`)

```ts
import { test } from "@japa/runner";
import sharp from "sharp";
import { IMAGE_FORMAT_MESSAGE, IMAGE_SIZE_MESSAGE, InvalidImageError } from "#modules/media/errors";
import { processImage } from "#modules/media/services/image_processor";
import { testImages } from "#tests/helpers/images";

test.group("processImage", () => {
	test("keeps a PNG as PNG", async ({ assert }) => {
		const result = await processImage(await testImages.png());
		assert.equal(result.format, "png");
		assert.equal((await sharp(result.data).metadata()).format, "png");
		assert.deepEqual([result.width, result.height], [300, 200]);
	});

	test("drops EXIF and GPS from a phone photo", async ({ assert }) => {
		const input = await testImages.phonePhoto();
		assert.exists((await sharp(input).metadata()).exif);
		assert.isTrue(input.includes("Kathmandu studio"));

		const result = await processImage(input);
		const after = await sharp(result.data).metadata();
		assert.equal(result.format, "jpeg");
		assert.isUndefined(after.exif);
		assert.isUndefined(after.xmp);
		assert.isUndefined(after.iptc);
		assert.isFalse(result.data.includes("Kathmandu studio"));
	});

	test("turns a sideways phone photo upright", async ({ assert }) => {
		const result = await processImage(await testImages.phonePhoto());
		assert.deepEqual([result.width, result.height], [200, 300]);
		assert.isUndefined((await sharp(result.data).metadata()).orientation);
	});

	test("fits big images in 2048 px and never enlarges small ones", async ({ assert }) => {
		const big = await processImage(await testImages.jpeg(4000, 3000));
		assert.deepEqual([big.width, big.height], [2048, 1536]);
		const small = await processImage(await testImages.jpeg(300, 200));
		assert.deepEqual([small.width, small.height], [300, 200]);
	});

	test("turns a WebP into a JPEG with transparency on white", async ({ assert }) => {
		const result = await processImage(await testImages.transparentWebp());
		assert.equal(result.format, "jpeg");
		const [r, g, b] = await sharp(result.data).raw().toBuffer();
		assert.deepEqual([r, g, b], [255, 255, 255]);
	});

	test("rejects {$self}")
		.with([
			{ name: "a text file", make: async () => Buffer.from("hello, not an image") },
			{ name: "an empty file", make: async () => Buffer.alloc(0) },
			{ name: "an SVG", make: async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') },
			{ name: "a GIF", make: () => testImages.gif() },
			{ name: "a HEIF/HEIC file", make: () => testImages.heif() },
			{ name: "a truncated PNG", make: async () => { const png = await testImages.png(); return png.subarray(0, png.length - 40); } },
			{ name: "a truncated JPEG", make: async () => { const jpg = await testImages.jpeg(400, 400); return jpg.subarray(0, jpg.length / 2); } },
		])
		.run(async ({ assert }, row) => {
			await assert.rejects(async () => processImage(await row.make()), InvalidImageError);
			await processImage(await row.make()).catch((error) => assert.equal(error.message, IMAGE_FORMAT_MESSAGE));
		});

	test("rejects an image over 40 megapixels with its own message", async ({ assert }) => {
		const error = await processImage(await testImages.huge()).catch((e) => e);
		assert.instanceOf(error, InvalidImageError);
		assert.equal(error.message, IMAGE_SIZE_MESSAGE);
	});
});
```

- [ ] **Step 3: Run it.** Add an `errors.ts` and a stub `processImage` that returns the input untouched, so the import works (a failed import hangs `node ace test`). Run `node ace test unit --files tests/unit/modules/media/image_processor.spec.ts`. Expected: failures.

- [ ] **Step 4: Implement.**

`app/modules/media/errors.ts`:

```ts
export const IMAGE_FORMAT_MESSAGE = "Upload a JPEG, PNG or WebP image.";
export const IMAGE_SIZE_MESSAGE = "This image is too large. Use one under 40 megapixels.";

/**
 * An upload we can't accept as an image. The message is written for the
 * user: show it as a field error, like SlugTakenError.
 */
export class InvalidImageError extends Error {
	constructor(message: string = IMAGE_FORMAT_MESSAGE) {
		super(message);
		this.name = "InvalidImageError";
	}
}
```

`app/modules/media/services/image_processor.ts`:

```ts
import sharp from "sharp";
import { IMAGE_FORMAT_MESSAGE, IMAGE_SIZE_MESSAGE, InvalidImageError } from "#modules/media/errors";

/** Larger images are rejected before decoding (decompression bombs). */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Stored images fit in this square; smaller ones are never enlarged. */
export const MAX_DIMENSION = 2048;

export type ProcessedImage = { data: Buffer; format: "png" | "jpeg"; width: number; height: number };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Recognises the accepted formats by their first bytes, before sharp sees
 * the data, so no other decoder (SVG, GIF, HEIF, PDF…) ever runs on an upload.
 */
function sniff(input: Buffer): "jpeg" | "png" | "webp" | null {
	if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "jpeg";
	if (input.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
	if (input.toString("latin1", 0, 4) === "RIFF" && input.toString("latin1", 8, 12) === "WEBP") return "webp";
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
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
	const detected = sniff(input);
	if (!detected) throw new InvalidImageError(IMAGE_FORMAT_MESSAGE);

	const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
		.rotate()
		.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true });

	try {
		const { data, info } =
			detected === "png"
				? await image.png().toBuffer({ resolveWithObject: true })
				: await image
						.flatten({ background: "#ffffff" })
						.jpeg({ quality: 85, mozjpeg: true })
						.toBuffer({ resolveWithObject: true });
		return { data, format: detected === "png" ? "png" : "jpeg", width: info.width, height: info.height };
	} catch (error) {
		const tooLarge = error instanceof Error && error.message.includes("pixel limit");
		throw new InvalidImageError(tooLarge ? IMAGE_SIZE_MESSAGE : IMAGE_FORMAT_MESSAGE);
	}
}
```

- [ ] **Step 5: Run it.** Expected: everything passes.
  - **Mutation check 1:** delete the `sniff` check. The SVG row must fail.
  - **Mutation check 2:** remove `.rotate()`. The upright test must fail.
  - Restore the code after each.

- [ ] **Step 6: Commit** `feat(platform): re-encode uploaded images without metadata`.

---

### Task 3: ImageService and the imageFile rule

**Files:**
- Create: `apps/platform/app/modules/media/services/image_service.ts`
- Create: `apps/platform/app/modules/media/validators/image_file.ts`
- Create: `apps/platform/tests/functional/media/image_service.spec.ts`
- Create: `apps/platform/tests/unit/modules/media/image_file.spec.ts`

**Interfaces:**
- Consumes: `processImage` and the disks.
- Produces:
  - `IMAGE_PURPOSES`, `ImagePurpose`, `StoredImage = { key, width, height }`
  - `ImageService.store(file: Pick<MultipartFile, "tmpPath">, { tenant: Pick<Tenant, "id">; purpose })`
  - `ImageService.url(purpose, key)`
  - `ImageService.delete(purpose, key)`
  - `imageFile()`

- [ ] **Step 1: Write the failing tests** (`tests/functional/media/image_service.spec.ts`)

```ts
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import { InvalidImageError } from "#modules/media/errors";
import ImageService from "#modules/media/services/image_service";
import { testImages } from "#tests/helpers/images";

const images = new ImageService();
const tenant = { id: "0199c0de-0000-7000-8000-000000000001" };
const V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

async function upload(data: Buffer) {
	const tmpPath = app.tmpPath(`upload-${randomUUID()}`);
	await writeFile(tmpPath, data);
	return { tmpPath };
}

test.group("ImageService", () => {
	test("stores a QR code on the public disk under tenant and purpose", async ({ assert }) => {
		const stored = await images.store(await upload(await testImages.png()), { tenant, purpose: "payment_qr" });
		assert.match(stored.key, new RegExp(`^tenants/${tenant.id}/payment_qr/${V4}\\.png$`));
		assert.deepEqual([stored.width, stored.height], [300, 200]);
		assert.isTrue(await drive.use("public").exists(stored.key));
		assert.isFalse(await drive.use("private").exists(stored.key));
	});

	test("stores a payment proof on the private disk only, as JPEG", async ({ assert }) => {
		const stored = await images.store(await upload(await testImages.jpeg()), { tenant, purpose: "payment_proof" });
		assert.match(stored.key, new RegExp(`^tenants/${tenant.id}/payment_proof/${V4}\\.jpg$`));
		assert.isTrue(await drive.use("private").exists(stored.key));
		assert.isFalse(await drive.use("public").exists(stored.key));
	});

	test("gives every upload its own random key", async ({ assert }) => {
		const png = await testImages.png();
		const first = await images.store(await upload(png), { tenant, purpose: "payment_qr" });
		const second = await images.store(await upload(png), { tenant, purpose: "payment_qr" });
		assert.notEqual(first.key, second.key);
	});

	test("a public image is served at its URL", async ({ client, assert }) => {
		const stored = await images.store(await upload(await testImages.png()), { tenant, purpose: "payment_qr" });
		const url = await images.url("payment_qr", stored.key);
		assert.equal(url, `/uploads/${stored.key}`);
		const response = await client.get(url);
		response.assertStatus(200);
		assert.match(response.header("content-type"), /^image\/png/);
	});

	test("a private image is served only through its signed URL", async ({ client, assert }) => {
		const stored = await images.store(await upload(await testImages.jpeg()), { tenant, purpose: "payment_proof" });
		const url = await images.url("payment_proof", stored.key);
		assert.include(url, "signature=");
		(await client.get(url)).assertStatus(200);
		(await client.get(`/files/${stored.key}`)).assertStatus(401);
	});

	test("rejects an upload that isn't an image", async ({ assert }) => {
		await assert.rejects(
			async () => images.store(await upload(Buffer.from("hello")), { tenant, purpose: "payment_qr" }),
			InvalidImageError,
		);
	});

	test("delete removes the file, and ignores one that's already gone", async ({ assert }) => {
		const stored = await images.store(await upload(await testImages.png()), { tenant, purpose: "payment_qr" });
		await images.delete("payment_qr", stored.key);
		assert.isFalse(await drive.use("public").exists(stored.key));
		await images.delete("payment_qr", stored.key);
	});
});
```

`tests/unit/modules/media/image_file.spec.ts`:

```ts
import { MultipartFile } from "@adonisjs/core/bodyparser";
import { test } from "@japa/runner";
import vine from "@vinejs/vine";
import { imageFile } from "#modules/media/validators/image_file";

function fakeUpload(clientName: string, size: number) {
	const file = new MultipartFile({ fieldName: "image", clientName, headers: {} }, {});
	file.size = size;
	file.extname = clientName.split(".").pop();
	file.state = "consumed";
	return file;
}

const validator = vine.compile(vine.object({ image: imageFile() }));

test.group("imageFile", () => {
	test("accepts {$self}")
		.with(["qr.png", "qr.jpg", "qr.jpeg", "qr.webp"])
		.run(async ({ assert }, name) => {
			const { image } = await validator.validate({ image: fakeUpload(name, 1000) });
			assert.equal(image.clientName, name);
		});

	test("rejects {$self.name}")
		.with([
			{ name: "a GIF", file: () => fakeUpload("qr.gif", 1000) },
			{ name: "an SVG", file: () => fakeUpload("qr.svg", 1000) },
			{ name: "a PNG over 10 MB", file: () => fakeUpload("qr.png", 11 * 1024 * 1024) },
		])
		.run(async ({ assert }, row) => {
			await assert.rejects(() => validator.validate({ image: row.file() }));
		});
});
```

If `MultipartFile`'s internals differ from what `fakeUpload` sets, adjust `fakeUpload` only and keep the test cases.

- [ ] **Step 2: Run them.** Use stub modules that throw "not implemented" so the imports resolve. Expected: failures.

- [ ] **Step 3: Implement.**

`app/modules/media/validators/image_file.ts`:

```ts
import vine from "@vinejs/vine";

/**
 * The field rule for every image upload. Only a first filter on size and
 * extension: ImageService.store() checks what the file really is.
 */
export const imageFile = () => vine.file({ size: "10mb", extnames: ["jpg", "jpeg", "png", "webp"] });
```

`app/modules/media/services/image_service.ts`:

```ts
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import logger from "@adonisjs/core/services/logger";
import drive from "@adonisjs/drive/services/main";
import { processImage } from "#modules/media/services/image_processor";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * What each kind of image is for. The purpose picks the disk, so a private
 * image can't be stored publicly by mistake. Add one per new kind of image.
 */
export const IMAGE_PURPOSES = {
	payment_qr: { visibility: "public" }, // TAT-26
	payment_proof: { visibility: "private" }, // TAT-65
} as const;

export type ImagePurpose = keyof typeof IMAGE_PURPOSES;
export type StoredImage = { key: string; width: number; height: number };

const SIGNED_URL_TTL = "5 minutes";

const diskFor = (purpose: ImagePurpose) => drive.use(IMAGE_PURPOSES[purpose].visibility);

export default class ImageService {
	/**
	 * Checks and re-encodes an upload (see processImage), then writes it to
	 * the purpose's disk under a random key. Throws InvalidImageError for
	 * anything we can't accept. Save the key on the owning record; if that
	 * save fails, call delete() so no file is left behind.
	 */
	async store(
		file: Pick<MultipartFile, "tmpPath">,
		{ tenant, purpose }: { tenant: Pick<Tenant, "id">; purpose: ImagePurpose },
	): Promise<StoredImage> {
		if (!file.tmpPath) throw new Error("The upload has no tmpPath; was it already moved?");
		const image = await processImage(await readFile(file.tmpPath));
		const key = `tenants/${tenant.id}/${purpose}/${randomUUID()}.${image.format === "png" ? "png" : "jpg"}`;
		await diskFor(purpose).put(key, image.data, { contentType: `image/${image.format}` });
		return { key, width: image.width, height: image.height };
	}

	/**
	 * The URL to show an image. Private purposes get a signed URL valid for
	 * 5 minutes. Load the owning record scoped to the tenant first: that load
	 * is the access check.
	 */
	async url(purpose: ImagePurpose, key: string): Promise<string> {
		const disk = diskFor(purpose);
		return IMAGE_PURPOSES[purpose].visibility === "private"
			? disk.getSignedUrl(key, { expiresIn: SIGNED_URL_TTL })
			: disk.getUrl(key);
	}

	/**
	 * Removes a stored image, best effort: failures are logged, never thrown,
	 * so cleanup can't fail a request. When replacing an image, call this
	 * after the transaction commits.
	 */
	async delete(purpose: ImagePurpose, key: string): Promise<void> {
		try {
			await diskFor(purpose).delete(key);
		} catch (error) {
			logger.error({ err: error, purpose, key }, "could not delete a stored image");
		}
	}
}
```

- [ ] **Step 4: Run them.** Expected: everything passes.
  - **Mutation check:** map `payment_proof` to `"public"`. The private-disk test must fail.
  - Restore the code.

- [ ] **Step 5: Commit** `feat(platform): add ImageService and the imageFile rule`.

---

### Task 4: Docs, Linear, review, PR

- [ ] **`apps/platform/AGENTS.md`**: add a "Media" bullet:
  - Every upload goes through `imageFile()` and `ImageService.store()`.
  - Purposes decide visibility; add a purpose per new kind of image.
  - Owners keep the key in a column.
  - Call `delete()` in the `catch` of a failed save, and after the commit when replacing an image.
  - Files live under `storage/` in dev and `tmp/storage/` in tests.
- [ ] **`docs/architecture.md`, Files section**: note that HEIC decoding and worker variants are deferred.
- [ ] **Verify:** run `pnpm check`, `pnpm typecheck`, `pnpm build`, then the full `node ace test`.
- [ ] **Linear:**
  - TAT-21: tick the delivered items, and add "Later: worker variants, HEIC decoding".
  - Add TAT-21 as blocking TAT-26 and TAT-31.
- [ ] **Reviews:** run `/code-review` and `/security-review` (uploads), then fix what matters.
- [ ] **PR:** push and open the PR when the user says so.
