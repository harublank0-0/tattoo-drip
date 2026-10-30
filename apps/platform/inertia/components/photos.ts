/**
 * The words and small rules of the work photo tray and the cover form
 * (TAT-116). Plain TypeScript with no imports, so a unit test loads it
 * (tests/unit/inertia/photos_copy.spec.ts); the components only lay them out.
 */

/** The most work photos an artist shows. The server holds the same limit (WorkPhotoService counts under the artist's lock). */
export const MAX_WORK_PHOTOS = 100;

/** The longest description of a work photo, in characters. */
export const MAX_PHOTO_ALT = 200;

/**
 * A work photo as the artist form gets it, newest first: its id, its 320 px
 * copy, its description, its styles (the stored slugs) and the healed mark.
 */
export type WorkPhotoProps = {
	id: string;
	thumbnailUrl: string;
	alt: string | null;
	styles: string[];
	healed: boolean;
};

/** The studio's cover as Settings, Profile gets it: the 960 px copy and its own size. */
export type CoverProps = { previewUrl: string; width: number; height: number };

export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

export const NO_PHOTOS = "No photos yet.";

export const TRAY_FULL = `That's ${MAX_WORK_PHOTOS} photos, the most an artist can show. Remove one to add another.`;

export const TRAY_CREATE_NOTE = `Once the artist is saved, you can add up to ${MAX_WORK_PHOTOS} photos of their work here.`;

export const REMOVE_PHOTO_QUESTION =
	"Remove this photo? Clients won't see it any more, and it can't be brought back.";

export const REMOVE_COVER_QUESTION =
	"Remove the cover photo? Your page will open with your studio's name on its own.";

export const NO_COVER =
	"No cover yet. Your page opens with your studio's name on its own.";

export const COVER_PREVIEW_NOTE =
	"Phones show it like this. Wide screens show a wider strip of it.";

export const COVER_INTRO =
	"The first thing clients see on your studio page, with your studio's name over it. A wide photo of your work or your studio works best.";

/** "37 of 100 photos". */
export function photoCount(count: number): string {
	return `${count} of ${MAX_WORK_PHOTOS} photos`;
}

/** What a thumbnail's alt text says: its description, else its place in the set. */
export function photoAlt(alt: string | null, n: number, count: number): string {
	return alt ? alt : `Photo ${n} of ${count}`;
}

/** The line under the tray's title: an owner speaks about the artist, an artist about themselves. */
export function trayIntro(owner: boolean): string {
	return owner
		? `Up to ${MAX_WORK_PHOTOS} photos of this artist's work. The first three show on the studio page and all of them on the artist's own page, in this order.`
		: `Up to ${MAX_WORK_PHOTOS} photos of your work. The first three show on the studio page and all of them on your own page, in this order.`;
}

/** The upload button while a photo is on its way. */
export function uploadingText(percentage?: number): string {
	return percentage === undefined ? "Uploading…" : `Uploading… ${percentage}%`;
}

/** The cover form's button: upload, replace, or the wait. */
export function coverButton(
	hasCover: boolean,
	processing: boolean,
	percentage?: number,
): string {
	if (processing) return uploadingText(percentage);
	return hasCover ? "Replace cover" : "Upload cover";
}

/** Whether the tray offers an upload: there is room for one more. */
export function canAddPhoto(count: number): boolean {
	return count < MAX_WORK_PHOTOS;
}

/** The remove button is named for the photo, counted from 1. */
export function removeLabel(n: number): string {
	return `Remove photo ${n}`;
}
