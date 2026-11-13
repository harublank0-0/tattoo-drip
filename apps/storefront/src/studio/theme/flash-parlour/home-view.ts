import { FLASH_WALL_COUNT, type FlashDesignView } from "../../flash.ts";
import type { GalleryPhotoView } from "../../gallery.ts";
import type { StudioPageData } from "../../loaders.ts";
import type { WorkPhotoView } from "../../view-model.ts";

/**
 * What Flash Parlour's home page shows, worked out from the studio page's
 * data (loadStudioPage, which reads FLASH_WALL_COUNT available designs for
 * this theme: homeFlashCount). Pure. Every design and photo is the studio's
 * own; a part without data is empty and the page leaves it out.
 */

/** The work section shows at most this many pieces. */
export const WORK_COUNT = 6;

/** The first screen's photo when there is no flash: the cover, or the strongest piece. */
export interface FlashParlourLead {
	readonly src: string;
	readonly srcSet?: string;
	readonly width: number;
	readonly height: number;
	readonly alt: string;
	/** `cover` is the studio's own cover photo; `work` a piece from its portfolio. */
	readonly source: "cover" | "work";
	/** A piece's own page, when it has one. */
	readonly href: string | null;
}

export interface FlashParlourHome {
	/**
	 * The wall: the studio's newest available designs (the Flash section
	 * shown and the read gave some), at most FLASH_WALL_COUNT. Never a claimed
	 * one, and never a design that isn't the studio's.
	 */
	readonly wall: readonly FlashDesignView[];
	/** Only when the wall is empty: the work leads instead (else type alone). */
	readonly lead: FlashParlourLead | null;
	/** The work section after the lead (never repeating it), at most WORK_COUNT. */
	readonly work: readonly GalleryPhotoView[];
	/** Whether any artist is listed on the page (the section is shown and someone is visible). */
	readonly artistsShown: boolean;
}

export function flashParlourHome(data: StudioPageData): FlashParlourHome {
	const wall = data.theme.sections.includes("flash")
		? data.flash.designs
				.filter((design) => !design.claimed)
				.slice(0, FLASH_WALL_COUNT)
		: [];
	const lead = wall.length > 0 ? null : leadOf(data);
	const leadSrc = lead?.source === "work" ? lead.src : null;
	return {
		wall,
		lead,
		work: data.recentWork.photos
			.filter((photo) => photo.src !== leadSrc)
			.slice(0, WORK_COUNT),
		artistsShown:
			data.theme.sections.includes("artists") && data.artists.length > 0,
	};
}

/**
 * The cover when the studio has one. Otherwise its strongest piece: of the
 * newest work (then each artist's own work photos, when the gallery read gave
 * none), the photo with the most pixels, the newest on a tie. With no photo
 * at all the first screen is set in type alone; nothing is made up.
 */
function leadOf(data: StudioPageData): FlashParlourLead | null {
	const cover = data.theme.heroImage;
	if (cover) {
		return {
			src: cover.src,
			...(cover.srcSet ? { srcSet: cover.srcSet } : {}),
			width: cover.width,
			height: cover.height,
			alt: cover.alt,
			source: "cover",
			href: null,
		};
	}
	const recent: readonly (WorkPhotoView & { href?: string | null })[] =
		data.recentWork.photos;
	const candidates =
		recent.length > 0
			? recent
			: data.artists.flatMap((artist) => artist.workPhotos);
	let best: (WorkPhotoView & { href?: string | null }) | null = null;
	for (const photo of candidates) {
		if (
			best === null ||
			photo.width * photo.height > best.width * best.height
		) {
			best = photo;
		}
	}
	if (best === null) return null;
	return {
		src: best.src,
		...(best.srcSet ? { srcSet: best.srcSet } : {}),
		width: best.width,
		height: best.height,
		alt: best.alt,
		source: "work",
		href: best.href ?? null,
	};
}
