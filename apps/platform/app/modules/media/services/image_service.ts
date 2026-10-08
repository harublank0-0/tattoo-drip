import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
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

const diskFor = (purpose: ImagePurpose) =>
	drive.use(IMAGE_PURPOSES[purpose].visibility);

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
		const image = await processImage(input);
		const extension = image.format === "png" ? "png" : "jpg";
		const key = `tenants/${tenant.id}/${purpose}/${randomUUID()}.${extension}`;
		await diskFor(purpose).put(key, image.data, {
			contentType: `image/${image.format}`,
		});
		return { key, width: image.width, height: image.height };
	}

	/**
	 * The URL to show an image. Private purposes get a signed URL valid for
	 * 5 minutes. Load the owning record scoped to the tenant first: that
	 * load is the access check.
	 */
	async url(purpose: ImagePurpose, key: string): Promise<string> {
		const disk = diskFor(purpose);
		return IMAGE_PURPOSES[purpose].visibility === "private"
			? disk.getSignedUrl(key, { expiresIn: SIGNED_URL_TTL })
			: disk.getUrl(key);
	}

	/**
	 * Removes a stored image, best effort: failures are logged, never
	 * thrown, so cleanup can't fail a request. When replacing an image,
	 * call this after the transaction commits.
	 */
	async delete(purpose: ImagePurpose, key: string): Promise<void> {
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
