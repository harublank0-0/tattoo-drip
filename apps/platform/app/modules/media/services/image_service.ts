import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import logger from "@adonisjs/core/services/logger";
import drive from "@adonisjs/drive/services/main";
import { ImageDeleteError } from "#modules/media/errors";
import {
	logoTile,
	makeVariants,
	type ProcessedImage,
	type ProcessedVariant,
	processImage,
	squareIcon,
	type TileColours,
} from "#modules/media/services/image_processor";
import {
	COVER_WIDTHS,
	ICON_WIDTHS,
	type ImageExtension,
	NO_VARIANTS,
	originalKey,
	possibleCopyKeys,
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
	studio_logo: { visibility: "public", variants: VARIANT_WIDTHS }, // TAT-56
	studio_icon: { visibility: "public", variants: ICON_WIDTHS }, // TAT-123
	flash_design: { visibility: "public", variants: VARIANT_WIDTHS }, // TAT-129
	// Video angles: a video's poster, with a photo's copies; its MP4
	// renditions sit beside it under the same purpose (VideoService).
	work_video: { visibility: "public", variants: VARIANT_WIDTHS },
	// Reviews and Fresh ink: a client's photos of their healed tattoo, and a
	// client's video's poster (its renditions beside it, VideoService), with a
	// photo's copies. PRIVATE until published: the client's page reads them
	// through 5-minute signed URLs. Slices 2 and 3 copy a post's files to a
	// public purpose only once the studio approved it and the client
	// consented, and delete those copies on a decline, an unpublish, a
	// takedown or a withdrawn consent (backend.md, Reviews and Fresh ink).
	client_post_photo: { visibility: "private", variants: VARIANT_WIDTHS },
	client_post_video: { visibility: "private", variants: VARIANT_WIDTHS },
	// Slice 2: a published post's public copies, the same names under these
	// folders on the public disk (copyTo, PostPublicationService). Made only
	// for an approved post the client allowed a surface for; deleted on a
	// decline, an unpublish, a takedown, a withdrawn consent, a client's
	// change of an approved post and a delete.
	fresh_ink_photo: { visibility: "public", variants: VARIANT_WIDTHS },
	fresh_ink_video: { visibility: "public", variants: VARIANT_WIDTHS },
	// AI Design Lab (docs/design-lab.md): a generated concept, private to the
	// studio, with a photo's copies; downloaded by its members through
	// ImageService.read after the scoped load of its design asset.
	design_concept: { visibility: "private", variants: VARIANT_WIDTHS },
} as const;

export type ImagePurpose = keyof typeof IMAGE_PURPOSES;
export type StoredImage = { key: string; width: number; height: number };
/** A stored logo (TAT-123): the image, the tile it shows on, and its square icon or null. */
export type StoredLogo = StoredImage & {
	tile: "light" | "dark";
	icon: StoredImage | null;
};
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

/**
 * The Cache-Control each object is stored with (TAT-27), so an object store
 * serves it the same way the local /uploads and /files routes do. A public
 * image may be kept but must be revalidated on every use, so a removed
 * photo stops loading at once (its URL is permanent, so it can't be
 * versioned away). A private image is never kept, as its signed URL says.
 * The S3 driver ignores the `cacheControl` that `link()` signs into a URL
 * (only the local drive's route reads it), so this is what R2 sends.
 */
export const STORED_CACHE_CONTROL = {
	public: "no-cache",
	private: PRIVATE_CACHE_CONTROL,
} as const;

const diskFor = (purpose: ImagePurpose) =>
	drive.use(IMAGE_PURPOSES[purpose].visibility);

/**
 * The key a file stored under `from` has under `to`: the same tenant and
 * name in `to`'s folder (`tenants/<id>/<to>/<name>`), so a published copy's
 * key follows from its private original's and needs no column. Throws for a
 * key that is not under `from`: a caller bug.
 */
export function keyUnder(key: string, from: string, to: string): string {
	const match = /^tenants\/([0-9a-f-]{36})\/([a-z_]+)\/([^/]+)$/.exec(key);
	if (!match || match[2] !== from || key.includes("..")) {
		throw new Error(`A key under ${from} was expected`);
	}
	return `tenants/${match[1]}/${to}/${match[3]}`;
}

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

/**
 * An upload's bytes, and the temp file removed: the raw upload still has its
 * EXIF and GPS, so none is left in tmp.
 */
async function takeUpload(
	file: Pick<MultipartFile, "tmpPath">,
): Promise<Buffer> {
	if (!file.tmpPath) {
		throw new Error("The upload has no tmpPath; was it already moved?");
	}
	const input = await readFile(file.tmpPath);
	await rm(file.tmpPath, { force: true });
	return input;
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
		return this.storeBytes(await takeUpload(file), { tenant, purpose });
	}

	/**
	 * Stores a studio's logo (TAT-123): `store`'s checks and copies under
	 * `studio_logo`, then, best effort, its tile (logoTile) and its square icon
	 * on that tile's colour under `studio_icon`, with the icon's copy. A failure
	 * after the logo is stored is logged and leaves the light tile or no icon;
	 * the caller registers the cleanup of the logo and of the icon it returns.
	 */
	async storeLogo(
		file: Pick<MultipartFile, "tmpPath">,
		{ tenant, tiles }: { tenant: Pick<Tenant, "id">; tiles: TileColours },
	): Promise<StoredLogo> {
		const image = await processImage(await takeUpload(file));
		const logo = await this.storeProcessed(image, {
			tenant,
			purpose: "studio_logo",
		});
		let tile: "light" | "dark" = "light";
		try {
			tile = await logoTile(image, tiles);
		} catch (error) {
			logger.warn(
				{ err: error },
				"a logo's tile could not be picked; using the light one",
			);
		}
		let icon: StoredImage | null = null;
		try {
			icon = await this.storeBytes(await squareIcon(image, tiles[tile]), {
				tenant,
				purpose: "studio_icon",
			});
		} catch (error) {
			logger.warn(
				{ err: error },
				"a logo's icon could not be stored; keeping the logo without it",
			);
		}
		return { ...logo, tile, icon };
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
		return this.storeProcessed(await processImage(bytes), { tenant, purpose });
	}

	/** Writes an image processImage has accepted, with the purpose's copies. */
	private async storeProcessed(
		image: ProcessedImage,
		{ tenant, purpose }: { tenant: Pick<Tenant, "id">; purpose: ImagePurpose },
	): Promise<StoredImage> {
		const extension: ImageExtension = image.format === "png" ? "png" : "jpg";
		const base = `tenants/${tenant.id}/${purpose}/${randomUUID()}`;
		const widths = await this.storeVariants(purpose, base, extension, image);
		const key = originalKey(base, extension, widths);
		try {
			await diskFor(purpose).put(key, image.data, {
				contentType: `image/${image.format}`,
				cacheControl: STORED_CACHE_CONTROL[IMAGE_PURPOSES[purpose].visibility],
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
					cacheControl:
						STORED_CACHE_CONTROL[IMAGE_PURPOSES[purpose].visibility],
				});
			}
			return variants.map((variant) => variant.width);
		} catch (error) {
			logger.warn(
				{ err: error, purpose },
				"image copies could not be stored; keeping the image without them",
			);
			const stray = await this.removeAll(purpose, written);
			if (stray.length > 0) {
				// The image is stored without copies now, so nothing names these:
				// say which, once, so they can be found (and removal looks for them).
				logger.error(
					{ purpose, base, stray },
					"copies of an image stored without them could not be deleted",
				);
			}
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
	 * The stored image's own bytes and type, for a download served by the
	 * app (AI Design Lab). The same access rule as `url()`: load the owning
	 * record scoped to the tenant first; the key must be this tenant's for
	 * this purpose.
	 */
	async read(
		purpose: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
	): Promise<{ bytes: Uint8Array; contentType: string }> {
		assertKeyOf(purpose, key, tenant);
		const bytes = await diskFor(purpose).getBytes(key);
		return {
			bytes,
			contentType: key.endsWith(".png") ? "image/png" : "image/jpeg",
		};
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
	 * Copies a stored image and the copies its key names from `from`'s disk
	 * to `to`'s, under the same names in `to`'s folder (`keyUnder`), and
	 * returns the new key: a Fresh ink photo published (private to public).
	 * The same access rule as `url()`. A failure removes what it wrote and
	 * throws. Writing a file that is already there replaces it, so a retry
	 * is safe.
	 */
	async copyTo(
		from: ImagePurpose,
		to: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
	): Promise<string> {
		assertKeyOf(from, key, tenant);
		const files = [key, ...variantsOfKey(key).map((copy) => copy.key)];
		const written: string[] = [];
		try {
			for (const file of files) {
				const target = keyUnder(file, from, to);
				written.push(target);
				await diskFor(to).putStream(
					target,
					await diskFor(from).getStream(file),
					{
						contentType: file.endsWith(".png") ? "image/png" : "image/jpeg",
						cacheControl: STORED_CACHE_CONTROL[IMAGE_PURPOSES[to].visibility],
					},
				);
			}
		} catch (error) {
			await this.removeAll(to, written);
			throw error;
		}
		return keyUnder(key, from, to);
	}

	/**
	 * How many file deletes have failed on this instance (TAT-116): each one
	 * is also logged at error level with its purpose and key, so a test (or
	 * an operator) can see that a best-effort cleanup left something behind.
	 */
	deleteFailures = 0;

	/**
	 * Removes a stored image, the copies its key names and every copy its
	 * purpose could have made for it (`filesOf`), best effort: every file is tried, a failure is counted (`deleteFailures`) and logged
	 * with its purpose and key, never thrown, so cleanup can't fail a request.
	 * Use it for what no record points at any more or what a rollback leaves
	 * (a replaced image after the commit); a file that fails stays unreferenced
	 * until the orphan sweep (TAT-140). A removal that must not report success
	 * while a file is still reachable uses `deleteOrThrow`.
	 */
	async delete(purpose: ImagePurpose, key: string): Promise<void> {
		await this.removeAll(purpose, this.filesOf(purpose, key));
	}

	/**
	 * Removes a stored image and every copy its key names, or throws
	 * ImageDeleteError naming the files left (TAT-116: a photo a client asked
	 * to take down must not stay fetchable while the studio is told it is
	 * gone). Every file is tried even after one fails, and a file that is
	 * already missing counts as deleted, so a retry finishes the job. Call it
	 * before the record that names the image is deleted, so a failure leaves
	 * the record for the owner to try again.
	 */
	async deleteOrThrow(purpose: ImagePurpose, key: string): Promise<void> {
		const failed = await this.removeAll(purpose, this.filesOf(purpose, key));
		if (failed.length > 0) throw new ImageDeleteError(purpose, failed);
	}

	/**
	 * Every file an image can have: the image, the copies its key names, and
	 * every copy its purpose could have made for the same base name. The
	 * second set is for the fallback state: if a copy was written, a later one
	 * failed and the cleanup of the first failed too, the image is stored under
	 * a plain key (it names no copies) while a copy stays on the disk, and a
	 * removal that trusted the key would leave that copy fetchable. A file that
	 * was never written is not an error to delete.
	 */
	private filesOf(purpose: ImagePurpose, key: string): string[] {
		return [
			...new Set([
				key,
				...variantsOfKey(key).map((copy) => copy.key),
				...possibleCopyKeys(key, IMAGE_PURPOSES[purpose].variants),
			]),
		];
	}

	/** Deletes each key on its own (one that fails or is gone leaves the rest) and returns the keys that failed. */
	private async removeAll(
		purpose: ImagePurpose,
		keys: string[],
	): Promise<string[]> {
		const failed: string[] = [];
		for (const key of keys) {
			try {
				await diskFor(purpose).delete(key);
			} catch (error) {
				this.deleteFailures++;
				failed.push(key);
				logger.error(
					{ err: error, purpose, key },
					"could not delete a stored image",
				);
			}
		}
		return failed;
	}
}
