/**
 * The words and small rules of the work photo tray and the cover form
 * (TAT-116). Plain TypeScript with no imports, so a unit test loads it
 * (tests/unit/inertia/photos_copy.spec.ts); the components only lay them out.
 */

/** The most work photos an artist shows. The server holds the same limit (WorkPhotoService counts under the artist's lock). */
export const MAX_WORK_PHOTOS = 100;

/** The longest description of a work photo, in characters. */
export const MAX_PHOTO_ALT = 200;

/** The most styles one work photo can carry. The server holds the same limit (a unit test pins them equal). */
export const MAX_PHOTO_STYLES = 3;

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

export const UPLOAD_LABEL = "Add photos";

export const UPLOAD_HELP =
	"Choose one or more. JPEG, PNG or WebP, up to 10 MB each. Photos from a phone work as they are.";

/** A photo whose upload ended with neither an answer nor a reason (the connection, a proxy's limit). */
export const UPLOAD_FAILED = "It didn't upload. Try again.";

/** A photo the upload never sent because the queue was cut short (another visit started while the files were going up). */
export const UPLOAD_INTERRUPTED = "Not sent: the upload was interrupted.";

export const STYLES_HELP = `Up to ${MAX_PHOTO_STYLES}.`;

export const HEALED_LABEL = "Healed";

export const HEALED_HELP = "The photo shows the tattoo once it healed.";

/** Under the details sheet's title. */
export const SHEET_HELP =
	"Tell clients what it shows, and tag it so they can find it.";

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

/** How one file's request ended: the server took it, refused it (with its words), or the visit was cancelled. */
export type UploadOutcome =
	| { kind: "added" }
	| { kind: "refused"; message: string }
	| { kind: "cancelled" };

/**
 * The callbacks of one file's upload visit and, once it has finished, how it
 * ended. Anything but a clear answer counts as refused, never as added (a
 * dropped connection, a proxy's size limit, a server error).
 *
 * `onHttpException` returns false so an HTTP error status leaves the outcome
 * at that default: Inertia otherwise renders the error response (in
 * production the server's error page) over the dashboard and then still runs
 * `onSuccess`, which would count the failed photo as added, unmount the
 * upload while its loop goes on sending, and lose the summary. With false it
 * runs neither `onSuccess` nor `onError`, and `onFinish` still fires.
 * `onNetworkError` returns false for the same reason: a lost connection ends
 * through `onFinish` with the default outcome and nothing else needs to hear
 * of it.
 */
export function trackUpload() {
	let outcome: UploadOutcome = { kind: "refused", message: UPLOAD_FAILED };
	return {
		outcome: () => outcome,
		callbacks: {
			onSuccess: () => {
				outcome = { kind: "added" };
			},
			onError: (errors: Record<string, string | undefined>) => {
				outcome = { kind: "refused", message: errors.photo || UPLOAD_FAILED };
			},
			onCancel: () => {
				outcome = { kind: "cancelled" };
			},
			onHttpException: () => false as const,
			onNetworkError: () => false as const,
		},
	};
}

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
		? `Up to ${MAX_WORK_PHOTOS} photos of this artist's work. Your page shows them newest first: on the artist's page, in Recent work and in All work.`
		: `Up to ${MAX_WORK_PHOTOS} photos of your work. The studio page shows them newest first: on your page, in Recent work and in All work.`;
}

/** The upload button while a photo is on its way. */
export function uploadingText(percentage?: number): string {
	return percentage === undefined ? "Uploading…" : `Uploading… ${percentage}%`;
}

/**
 * The upload button while photo `index` of `total` is on its way (counted from
 * 1); one file needs no count.
 */
export function uploadingPhotos(
	index: number,
	total: number,
	percentage?: number,
): string {
	const head = total === 1 ? "Uploading…" : `Uploading ${index} of ${total}…`;
	return percentage === undefined ? head : `${head} ${percentage}%`;
}

/**
 * What the upload field says when more files are chosen than the tray has room
 * for (nothing is sent then), or null when they fit.
 */
export function roomNote(room: number, chosen: number): string | null {
	if (chosen <= room) return null;
	return room === 1
		? "There's room for 1 more photo. Choose 1."
		: `There's room for ${room} more photos. Choose ${room} or fewer.`;
}

/**
 * The first line of the summary after an upload: what was added and, when some
 * were refused, the lead-in to the list of those (one `failureLine` each).
 */
export function addedLine(added: number, refused: number): string {
	const addedText = `${added} ${added === 1 ? "photo" : "photos"} added.`;
	if (refused === 0) return addedText;
	if (added === 0) {
		return refused === 1
			? "This photo couldn't be added:"
			: `These ${refused} photos couldn't be added:`;
	}
	return refused === 1
		? `${addedText} This one couldn't be added:`
		: `${addedText} These ${refused} couldn't be added:`;
}

/** One refused file: its name and why. */
export function failureLine(name: string, message: string): string {
	return `${name}: ${message}`;
}

/** A tile's name: its place in the set, counted from 1, and its description when it has one. */
export function editLabel(n: number, alt: string | null): string {
	return alt ? `Edit photo ${n}: ${alt}` : `Edit photo ${n}`;
}

/** The small note under a tile: how many styles it carries and whether it is healed, or null when neither. */
export function tileNote(styleCount: number, healed: boolean): string | null {
	const parts: string[] = [];
	if (styleCount > 0) {
		parts.push(`${styleCount} ${styleCount === 1 ? "style" : "styles"}`);
	}
	if (healed) parts.push("Healed");
	return parts.length > 0 ? parts.join(" · ") : null;
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
