import type { ImagePurpose } from "#modules/media/services/image_service";

/** The storage meter's breakdown (docs/superpowers/specs/2026-11-16-storage-meter-design.md). */
export type StorageCategory = "portfolio" | "clients" | "design_lab";

export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
	"portfolio",
	"clients",
	"design_lab",
];

/**
 * Which category each stored purpose counts toward; null for what never
 * counts: the public copies of published Fresh ink, which duplicate private
 * originals that already count.
 */
export const STORAGE_CATEGORY: Record<ImagePurpose, StorageCategory | null> = {
	artist_work_photo: "portfolio",
	work_video: "portfolio",
	artist_photo: "portfolio",
	flash_design: "portfolio",
	studio_cover: "portfolio",
	studio_logo: "portfolio",
	studio_icon: "portfolio",
	reference_image: "clients",
	payment_proof: "clients",
	payment_qr: "clients",
	client_post_photo: "clients",
	client_post_video: "clients",
	design_concept: "design_lab",
	fresh_ink_photo: null,
	fresh_ink_video: null,
};

/** The purposes whose files count toward storage. */
export const COUNTED_PURPOSES = (
	Object.keys(STORAGE_CATEGORY) as ImagePurpose[]
).filter((purpose) => STORAGE_CATEGORY[purpose] !== null);

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** One decimal, dropped when whole: 1.5, 340, 5. */
const amount = (value: number) => {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/**
 * A size as people read it, 1024-based: "340 MB", "1.3 GB", "5 GB"; below a
 * megabyte in KB ("0 KB", "1.5 KB").
 */
export function formatBytes(bytes: number): string {
	if (bytes >= GB) return `${amount(bytes / GB)} GB`;
	if (bytes >= MB) return `${amount(bytes / MB)} MB`;
	return `${amount(bytes / KB)} KB`;
}
