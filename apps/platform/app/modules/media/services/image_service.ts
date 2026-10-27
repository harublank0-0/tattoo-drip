import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import logger from "@adonisjs/core/services/logger";
import drive from "@adonisjs/drive/services/main";
import {
	makeVariants,
	type ProcessedImage,
	type ProcessedVariant,
	processImage,
} from "#modules/media/services/image_processor";
import {
	COVER_WIDTHS,
	type ImageExtension,
	NO_VARIANTS,
	originalKey,
	VARIANT_WIDTHS,
	variantKey,
	variantsOfKey,
} from "#modules/media/variants";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * What each kind of image is for. The purpose picks the disk, so a private
 * image can't be stored publicly by mistake, and its smaller copies
 * (`variants`, TAT-112: the widths below the image's own, never enlarged).
 * Add one per new kind of image and pick its copies here: a QR code or a
 * payment screenshot keeps one size, because it must stay sharp.
 */
export const IMAGE_PURPOSES = {
	payment_qr: { visibility: "public", variants: NO_VARIANTS }, // TAT-26
	payment_proof: { visibility: "private", variants: NO_VARIANTS }, // TAT-65
	artist_photo: { visibility: "public", variants: VARIANT_WIDTHS }, // TAT-31
	reference_image: { visibility: "private", variants: VARIANT_WIDTHS }, // TAT-37
	studio_cover: { visibility: "public", variants: COVER_WIDTHS }, // TAT-116
	artist_work_photo: { visibility: "public", variants: VARIANT_WIDTHS }, // TAT-116
} as const;

export type ImagePurpose = keyof typeof IMAGE_PURPOSES;
export type StoredImage = { key: string; width: number; height: number };
/** The copy that dashboard lists and grids show (ui.md: never the full-size file). */
export const THUMBNAIL_WIDTH = 320;
/** A smaller copy of an image, for `srcset`. */
export type ImageVariant = { url: string; width: number };
/** An image as the public API shows it (the contract's `Image` and `Photo`). */
export type ShownImage = {
	url: string;
	width: number;
	height: number;
	variants: ImageVariant[];
};

const SIGNED_URL_TTL = "5 minutes";

/**
 * What a browser or proxy may do with a private image: show it, never keep
 * it. Signed into the URL (the drive's /files route sends it as
 * Cache-Control), so it can't be stripped.
 */
export const PRIVATE_CACHE_CONTROL = "private, no-store";

const diskFor = (purpose: ImagePurpose) =>
	drive.use(IMAGE_PURPOSES[purpose].visibility);

/**
 * Defence in depth for every URL: the key must be one this tenant stored for
 * this purpose (`tenants/<id>/<purpose>/`). A copy's key only adds a suffix
 * to its image's, so it passes the same check. A mismatch is a caller bug,
 * never a user error.
 */
function assertKeyOf(
	purpose: ImagePurpose,
	key: string,
	tenant: Pick<Tenant, "id">,
) {
	if (
		!key.startsWith(`tenants/${tenant.id}/${purpose}/`) ||
		key.includes("..")
	) {
		throw new Error(
			`ImageService was given a key of another tenant or purpose (${purpose})`,
		);
	}
}

/** The URL of a stored file: signed and `no-store` for a private purpose. */
async function link(purpose: ImagePurpose, key: string): Promise<string> {
	const disk = diskFor(purpose);
	return IMAGE_PURPOSES[purpose].visibility === "private"
		? disk.getSignedUrl(key, {
				expiresIn: SIGNED_URL_TTL,
				cacheControl: PRIVATE_CACHE_CONTROL,
			})
		: disk.getUrl(key);
}

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
		if (!file.tmpPath) {
			throw new Error("The upload has no tmpPath; was it already moved?");
		}
		const input = await readFile(file.tmpPath);
		// The raw upload still has its EXIF and GPS; don't leave it in tmp.
		await rm(file.tmpPath, { force: true });
		return this.storeBytes(input, { tenant, purpose });
	}

	/**
	 * Like `store`, for bytes already in memory (the development seeder's
	 * generated images): the same checks, re-encoding, key layout, copies and
	 * disk.
	 */
	async storeBytes(
		bytes: Buffer,
		{ tenant, purpose }: { tenant: Pick<Tenant, "id">; purpose: ImagePurpose },
	): Promise<StoredImage> {
		const image = await processImage(bytes);
		const extension: ImageExtension = image.format === "png" ? "png" : "jpg";
		const base = `tenants/${tenant.id}/${purpose}/${randomUUID()}`;
		const widths = await this.storeVariants(purpose, base, extension, image);
		const key = originalKey(base, extension, widths);
		try {
			await diskFor(purpose).put(key, image.data, {
				contentType: `image/${image.format}`,
			});
		} catch (error) {
			// No record will point at the copies: take them (and any partial
			// write) away before failing.
			await this.removeAll(purpose, [
				key,
				...widths.map((width) => variantKey(base, width, extension)),
			]);
			throw error;
		}
		return { key, width: image.width, height: image.height };
	}

	/**
	 * Makes and writes the purpose's copies of `image`: the widths written,
	 * or [] when the purpose has none, the image is too narrow, or any copy
	 * failed (then none is left, and the image is stored as before TAT-112).
	 */
	private async storeVariants(
		purpose: ImagePurpose,
		base: string,
		extension: ImageExtension,
		image: ProcessedImage,
	): Promise<number[]> {
		const widths = IMAGE_PURPOSES[purpose].variants;
		if (widths.length === 0) return [];
		const written: string[] = [];
		try {
			const variants = await this.makeVariants(image, widths);
			for (const variant of variants) {
				const key = variantKey(base, variant.width, extension);
				written.push(key); // before the put: a half-written file goes too
				await diskFor(purpose).put(key, variant.data, {
					contentType: `image/${image.format}`,
				});
			}
			return variants.map((variant) => variant.width);
		} catch (error) {
			logger.warn(
				{ err: error, purpose },
				"image copies could not be stored; keeping the image without them",
			);
			await this.removeAll(purpose, written);
			return [];
		}
	}

	/** makeVariants (image_processor), as a method so a test can make it fail. */
	protected makeVariants(
		image: ProcessedImage,
		widths: readonly number[],
	): Promise<ProcessedVariant[]> {
		return makeVariants(image, widths);
	}

	/**
	 * The URL to show an image. Private purposes get a signed URL valid for
	 * 5 minutes that answers with `Cache-Control: private, no-store`. Load
	 * the owning record scoped to the tenant first: that load is the access
	 * check. As defence in depth the key must be one this tenant stored for
	 * this purpose (`tenants/<id>/<purpose>/`), else this throws: a caller
	 * bug, never a user error. Signed URLs are bearer tokens: keep them out of
	 * emails, jobs and logs.
	 */
	async url(
		purpose: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
	): Promise<string> {
		assertKeyOf(purpose, key, tenant);
		return link(purpose, key);
	}

	/**
	 * The smaller copies an image's key names (TAT-112), narrowest first, each
	 * with its URL; [] for an image with none (stored before copies, too
	 * narrow, or a purpose that keeps one size). The same access rule as
	 * `url()`: load the owning record scoped to the tenant first. Private
	 * copies are signed for 5 minutes and `no-store`, like the image. Built
	 * from the key alone: no query, no disk read.
	 */
	async variants(
		purpose: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
	): Promise<ImageVariant[]> {
		assertKeyOf(purpose, key, tenant);
		return Promise.all(
			variantsOfKey(key).map(async (copy) => ({
				url: await link(purpose, copy.key),
				width: copy.width,
			})),
		);
	}

	/**
	 * The URL of what a thumbnail shows (`THUMBNAIL_WIDTH`): the narrowest
	 * copy at least `width` px wide, else the image itself (then it is the
	 * widest there is, or it has no copies). The same rules as `url()`.
	 */
	async urlFor(
		purpose: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
		width: number,
	): Promise<string> {
		assertKeyOf(purpose, key, tenant);
		const copy = variantsOfKey(key).find(
			(candidate) => candidate.width >= width,
		);
		return link(purpose, copy ? copy.key : key);
	}

	/**
	 * An image as the public API shows it (`Image`, `Photo`): its URL, the
	 * size its record stores and its copies. The same rules as `url()`.
	 */
	async shownImage(
		purpose: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
		{ width, height }: { width: number; height: number },
	): Promise<ShownImage> {
		return {
			url: await this.url(purpose, key, tenant),
			width,
			height,
			variants: await this.variants(purpose, key, tenant),
		};
	}

	/**
	 * Removes a stored image and the copies its key names, best effort:
	 * failures are logged, never thrown, so cleanup can't fail a request.
	 * When replacing an image, call this after the transaction commits.
	 */
	async delete(purpose: ImagePurpose, key: string): Promise<void> {
		await this.removeAll(purpose, [
			key,
			...variantsOfKey(key).map((copy) => copy.key),
		]);
	}

	/** Deletes each key on its own: one that fails or is gone leaves the rest. */
	private async removeAll(purpose: ImagePurpose, keys: string[]) {
		for (const key of keys) {
			try {
				await diskFor(purpose).delete(key);
			} catch (error) {
				logger.error(
					{ err: error, purpose, key },
					"could not delete a stored image",
				);
			}
		}
	}
}
