import type { GalleryPhotoView } from "../../gallery.ts";
import type { StudioPageData } from "../../loaders.ts";
import type { WorkPhotoView } from "../../view-model.ts";

/**
 * What Irezumi's home page shows, worked out from the studio page's data
 * (loadStudioPage: no read of its own). Pure. Every photo is the studio's
 * own; a part without data is null or empty and the page leaves it out.
 */

/** The selected work shows at most this many pieces. */
export const SELECTED_COUNT = 6;

/** The first screen's photo, whole: the studio's cover, or its strongest piece of work. */
export interface IrezumiLead {
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

export interface IrezumiHome {
	readonly lead: IrezumiLead | null;
	/** The selected work after the lead (never repeating it), at most SELECTED_COUNT. */
	readonly selected: readonly GalleryPhotoView[];
	/** Whether any artist is listed on the page (the section is shown and someone is visible). */
	readonly artistsShown: boolean;
}

export function irezumiHome(data: StudioPageData): IrezumiHome {
	const lead = leadOf(data);
	const recent = data.recentWork.photos;
	const leadSrc = lead?.source === "work" ? lead.src : null;
	const rest = recent.filter((photo) => photo.src !== leadSrc);
	return {
		lead,
		selected: rest.slice(0, SELECTED_COUNT),
		artistsShown:
			data.theme.sections.includes("artists") && data.artists.length > 0,
	};
}

/**
 * The cover when the studio has one. Otherwise its strongest piece: of the
 * newest work (then each artist's own work photos, when the gallery read gave
 * none), the photo with the most pixels, the newest on a tie, so the first
 * screen shows the work at its best resolution, whole. With no photo at all
 * the first screen is set in type alone; nothing is made up.
 */
function leadOf(data: StudioPageData): IrezumiLead | null {
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
