/**
 * The portfolio's types, words and small rules (Studio OS). Plain TypeScript
 * with no imports, so a unit test loads it
 * (tests/unit/inertia/portfolio_copy.spec.ts); the page and its panels only
 * lay them out. The server decides everything else (PortfolioController,
 * WorkPhotoService).
 */

/** Where a video angle is: the worker has it, it is on the page, or it was refused with a reason. */
export type VideoState = "processing" | "ready" | "failed";

/**
 * One more photo or video of a tattoo (angles): a thumbnail, its stored
 * image and its own description, in the tattoo's order after the main
 * photo. A video (`kind: "video"`) has its state and, once ready, its
 * poster as the thumbnail and its length; until then no picture or size.
 */
export type PortfolioAngle = {
	id: string;
	kind: "photo" | "video";
	alt: string | null;
	width: number | null;
	height: number | null;
	/** The 320 px copy (a video's poster), for the details panel's list; null for a video not ready. */
	thumbUrl: string | null;
	fullUrl: string | null;
	video: {
		state: VideoState;
		/** Why it was refused, in the server's words; null unless failed. */
		failure: string | null;
		durationMs: number | null;
	} | null;
};

/**
 * A tattoo as the portfolio gets it: its main photo (the lead), with the
 * copies it shows and its artist, and its other photos in order (`angles`,
 * [] for a tattoo of one photo). Its status, styles and healed mark are the
 * whole tattoo's.
 */
export type PortfolioPhoto = {
	id: string;
	artistId: string;
	artistName: string;
	/** Published by the studio (not unpublished). */
	published: boolean;
	/** On the studio page: published and its artist shown. */
	shown: boolean;
	/** Its page on the studio's site, while it is shown there. */
	pageUrl: string | null;
	alt: string | null;
	/** The stored style slugs, in the list's order. */
	styles: string[];
	healed: boolean;
	width: number;
	height: number;
	/** The tile's copy (640 px) and every copy for `srcset`. */
	src: string;
	srcSet: string;
	/** The details panel's copy (1280 px) and the stored image. */
	largeUrl: string;
	fullUrl: string;
	addedText: string;
	/** Whether it shows on Discover (D04), in the server's words. */
	discover: { label: string; note: string };
	discoverState: string;
	angles: PortfolioAngle[];
	/** The 320 px copy, for the details panel's list of the tattoo's photos. */
	thumbUrl: string;
};

export type PortfolioArtist = {
	id: string;
	name: string;
	visible: boolean;
	/** Every photo, angles included: what the artist's limit counts. */
	photoCount: number;
	/** Tattoos (main photos): what the gallery's tiles and count line show. */
	tattooCount: number;
};

export type PortfolioStatus =
	| "all"
	| "published"
	| "unpublished"
	| "artist_hidden";
export type PortfolioSort = "newest" | "oldest";

export type PortfolioFilters = {
	search: string;
	artist: string | null;
	style: string | null;
	status: PortfolioStatus;
	healed: boolean;
	sort: PortfolioSort;
};

export type PortfolioPageProps = {
	photos: PortfolioPhoto[];
	/** The tattoo the details panel follows when it left this page (`open` in the address), else null. */
	openPhoto: PortfolioPhoto | null;
	artists: PortfolioArtist[];
	styleOptions: { slug: string; name: string }[];
	filters: PortfolioFilters;
	page: { current: number; last: number; total: number; size: number };
	maxPhotos: number;
	isOwner: boolean;
	storefront: { galleryUrl: string; devHost: boolean };
};

export const NO_FILTERS: PortfolioFilters = {
	search: "",
	artist: null,
	style: null,
	status: "all",
	healed: false,
	sort: "newest",
};

/**
 * encodeURIComponent, and the five marks it leaves alone too, so an address
 * built here always passes the server's `back` check (portfolioBack allows
 * letters, digits and `-_./?=&%` only).
 */
function strictEncode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*~]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * The portfolio's address for these filters and page: only what differs
 * from the defaults, always in the same order, so one view has one address.
 */
export function portfolioHref(
	base: string,
	filters: PortfolioFilters,
	page = 1,
): string {
	const parts: string[] = [];
	if (filters.search) parts.push(`q=${strictEncode(filters.search)}`);
	if (filters.artist) parts.push(`artist=${strictEncode(filters.artist)}`);
	if (filters.style) parts.push(`style=${strictEncode(filters.style)}`);
	if (filters.status !== "all") parts.push(`status=${filters.status}`);
	if (filters.healed) parts.push("healed=1");
	if (filters.sort !== "newest") parts.push(`sort=${filters.sort}`);
	if (page > 1) parts.push(`page=${page}`);
	return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

/** Whether any filter is set (the order is not a filter). */
export function isFiltered(filters: PortfolioFilters): boolean {
	return (
		filters.search !== "" ||
		filters.artist !== null ||
		filters.style !== null ||
		filters.status !== "all" ||
		filters.healed
	);
}

export const STATUS_OPTIONS: { value: PortfolioStatus; label: string }[] = [
	{ value: "all", label: "Any status" },
	{ value: "published", label: "On your page" },
	{ value: "unpublished", label: "Unpublished" },
	{ value: "artist_hidden", label: "Artist hidden" },
];

export const SORT_OPTIONS: { value: PortfolioSort; label: string }[] = [
	{ value: "newest", label: "Newest first" },
	{ value: "oldest", label: "Oldest first" },
];

export const PAGE_DESCRIPTION = "Manage and showcase your best work.";

/**
 * The line above the gallery: how many tattoos (a tile is a tattoo, however
 * many photos it has), and of how many when filtered.
 */
export function resultLine(
	matching: number,
	everything: number,
	filtered: boolean,
): string {
	const tattoos = (n: number) => `${n} ${n === 1 ? "tattoo" : "tattoos"}`;
	if (!filtered) return tattoos(everything);
	return matching === 1
		? `1 tattoo matches, of ${everything}`
		: `${matching} tattoos match, of ${everything}`;
}

/** The most photos of one tattoo: its main photo and seven more (the server's MAX_TATTOO_PHOTOS). */
export const MAX_TATTOO_PHOTOS = 8;

/** How many photos a tattoo has: its main photo and its angles. */
export function photoTotal(photo: Pick<PortfolioPhoto, "angles">): number {
	return photo.angles.length + 1;
}

/** A tile's mark for a tattoo of several photos: "3 photos", or "3 photos and videos" when some are videos; null for one. */
export function photosMark(
	photo: Pick<PortfolioPhoto, "angles">,
): string | null {
	const total = photoTotal(photo);
	if (total <= 1) return null;
	return photo.angles.some((angle) => angle.kind === "video")
		? `${total} photos and videos`
		: `${total} photos`;
}

/**
 * Where a photo stands, in the panel, on its tile and in its name: on the
 * page, unpublished by the studio, or published while its artist is hidden.
 */
export function statusText(photo: {
	published: boolean;
	shown: boolean;
}): string {
	if (!photo.published) return "Unpublished";
	return photo.shown ? "On your page" : "Artist hidden";
}

/** Under the status, when the photo is not on the page: why, and what changes it. */
export function statusNote(photo: {
	published: boolean;
	shown: boolean;
}): string | null {
	if (!photo.published) {
		return "Only the studio sees it. Publish it to show it on your page.";
	}
	if (!photo.shown) {
		return "Published, but its artist is hidden from your page, so it isn't shown. Show the artist on your page to show their work.";
	}
	return null;
}

/** Public pages are cached: what a change on them takes (the look's "up to 15 minutes"). */
export const PAGE_DELAY_NOTE =
	"Changes to your page can take up to 15 minutes to appear.";

/** A tile's accessible name: what it shows, by whom, and its status when it is not on the page. */
export function tileLabel(photo: PortfolioPhoto): string {
	const what = photo.alt ? photo.alt : `Photo by ${photo.artistName}`;
	const by = photo.alt ? `, by ${photo.artistName}` : "";
	const mark = photosMark(photo);
	const photos = mark ? `, ${mark}` : "";
	const status = photo.shown ? "" : `, ${statusText(photo).toLowerCase()}`;
	return `${what}${by}${photos}${status}`;
}

/** The small line under a tile: its styles' names and the healed mark, or null. */
export function tileMeta(
	styles: readonly string[],
	healed: boolean,
	names: Record<string, string>,
): string | null {
	const parts = styles.map((slug) => names[slug] ?? slug);
	if (healed) parts.push("Healed");
	return parts.length > 0 ? parts.join(" · ") : null;
}

/** The details panel's title: the description, else whose work it is. */
export function detailsTitle(photo: PortfolioPhoto): string {
	return photo.alt ? photo.alt : `Work by ${photo.artistName}`;
}

/** "1080 × 1350 px". */
export function sizeText(width: number, height: number): string {
	return `${width} × ${height} px`;
}

// The upload.

/** The server's limit for one photo (imageFile: 10 MB). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

/** The server's own words for a file it won't take (IMAGE_FORMAT_MESSAGE, "Use an image of 10 MB or less."). */
export const WRONG_FORMAT = "Use a JPEG, PNG or WebP image.";
export const TOO_LARGE = "Use an image of 10 MB or less.";

/**
 * Why a chosen file can't go up, or null when it can: a first check before
 * anything is sent, so a wrong file is named at once. The server checks
 * again, and what the image really is.
 */
export function fileProblem(file: {
	name: string;
	type: string;
	size: number;
}): string | null {
	const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
	const typeOk = file.type
		? PHOTO_TYPES.includes(file.type)
		: PHOTO_EXTENSIONS.includes(extension);
	if (!typeOk) return WRONG_FORMAT;
	if (file.size > MAX_PHOTO_BYTES) return TOO_LARGE;
	return null;
}

/**
 * Which chosen files an upload sends and which it names without sending:
 * `send` the indices of the files `fileProblem` takes, in the order chosen,
 * and `skip` every other file with the reason, which the server would give
 * in the same words. The room check counts `send` only: a wrong file never
 * takes a place.
 */
export function planUpload(
	files: readonly { name: string; type: string; size: number }[],
): { send: number[]; skip: { index: number; reason: string }[] } {
	const send: number[] = [];
	const skip: { index: number; reason: string }[] = [];
	for (const [index, file] of files.entries()) {
		const reason = fileProblem(file);
		if (reason) skip.push({ index, reason });
		else send.push(index);
	}
	return { send, skip };
}

/** The same file chosen twice is one item: by name, size and date. */
export function fileKey(file: {
	name: string;
	size: number;
	lastModified: number;
}): string {
	return `${file.name}:${file.size}:${file.lastModified}`;
}

/** "2.4 MB", "640 KB". */
export function fileSizeText(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Why the upload can't start yet, or null: an artist must be picked, there
 * must be photos, and they must fit in the artist's room.
 */
export function uploadProblem(
	artist: PortfolioArtist | null,
	ready: number,
	maxPhotos: number,
): string | null {
	if (!artist) return "Choose whose work this is.";
	if (ready === 0) return "Add a photo to upload.";
	const room = Math.max(0, maxPhotos - artist.photoCount);
	if (room === 0) {
		return `${artist.name} already has ${maxPhotos} photos. Remove one to add another.`;
	}
	if (ready > room) {
		return room === 1
			? `${artist.name} has room for 1 more photo. Remove ${ready - 1} from the list.`
			: `${artist.name} has room for ${room} more photos. Remove ${ready - room} from the list.`;
	}
	return null;
}

/** The upload button: what it will send, or where it is. */
export function uploadButton(
	ready: number,
	sending: { index: number; total: number; percentage?: number } | null,
): string {
	if (sending) {
		const head =
			sending.total === 1
				? "Uploading…"
				: `Uploading ${sending.index} of ${sending.total}…`;
		return sending.percentage === undefined
			? head
			: `${head} ${sending.percentage}%`;
	}
	if (ready <= 1) return "Upload photo";
	return `Upload ${ready} photos`;
}

export const STYLES_LIMIT_NOTE = (max: number) =>
	`Up to ${max}. They apply to every photo in this upload.`;

export const UPLOAD_INTRO =
	"Photos of finished and healed work. Published ones show on your studio page, newest first, while their artist is on it.";

export const DROP_HINT = "JPEG, PNG or WebP, up to 10 MB each.";

export const REMOVE_QUESTION =
	"Remove this photo? Clients won't see it any more, and it can't be brought back.";

/** The details panel's question before Remove: a tattoo of several photos goes whole. */
export function removeQuestion(photos: number): string {
	return photos > 1
		? `Remove this tattoo and all ${photos} of its photos? Clients won't see them any more, and they can't be brought back.`
		: REMOVE_QUESTION;
}

/** The details panel's Remove button, in the question. */
export function removeLabel(photos: number, busy: boolean): string {
	if (busy) return "Removing…";
	return photos > 1 ? `Remove ${photos} photos` : "Remove photo";
}

// A tattoo's photos (angles), in the details panel.

export const TATTOO_PHOTOS_NOTE =
	"The main photo shows in your gallery and on your page, with the others beside it. Publishing, styles and healed apply to every photo of the tattoo; each keeps its own description.";

/** One photo of the tattoo as its row names it: its description, else its place. */
export function tattooPhotoName(alt: string | null, n: number): string {
	return alt ? alt : `Photo ${n}`;
}

/**
 * "Move photo 2 of 4 earlier": the Page look sections' words, named by the
 * photo's place, so two photos with the same description stay distinct.
 */
export function movePhotoLabel(
	n: number,
	count: number,
	direction: "up" | "down",
	noun: "photo" | "video" = "photo",
): string {
	return `Move ${noun} ${n} of ${count} ${direction === "up" ? "earlier" : "later"}`;
}

/**
 * The portfolio's address with `open=<id>`: where a write that gives the
 * tattoo a new main photo comes back to, so the details panel stays on it
 * even when its new place in the order is on another page (the server then
 * sends it as `openPhoto`). Any `open` already there is replaced.
 */
export function followBack(back: string, id: string): string {
	const [path, query = ""] = back.split("?");
	const kept = query
		.split("&")
		.filter((part) => part !== "" && !part.startsWith("open="));
	return `${path}?${[...kept, `open=${encodeURIComponent(id)}`].join("&")}`;
}

/** What the details panel says when the tattoo it follows is not on the page shown. */
export const TATTOO_MOVED_NOTE =
	"This tattoo moved in the list: its new main photo puts it on another page. It stays open here.";

/**
 * The tattoo's photo ids with one moved a place earlier or later: the order
 * the server takes (the main photo first). Moving the second photo earlier
 * makes it the main photo. The same order when it cannot move.
 */
export function movedOrder(
	ids: readonly string[],
	index: number,
	direction: "up" | "down",
): string[] {
	const target = direction === "up" ? index - 1 : index + 1;
	if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) {
		return [...ids];
	}
	const moved = [...ids];
	[moved[index], moved[target]] = [moved[target], moved[index]];
	return moved;
}

/** The order with `id` first, the main photo, and the others as they were. */
export function mainFirst(ids: readonly string[], id: string): string[] {
	return ids.includes(id)
		? [id, ...ids.filter((other) => other !== id)]
		: [...ids];
}

/** The question before deleting one of a tattoo's other photos. */
export const DELETE_ANGLE_QUESTION =
	"Delete this photo? It leaves the tattoo, clients won't see it any more, and it can't be brought back.";

/**
 * Why more photos can't be added to this tattoo yet, or null: there must be
 * photos, and they must fit in the tattoo (eight photos at most) and in its
 * artist's room.
 */
export function tattooUploadProblem(
	ready: number,
	photos: number,
	artist: Pick<PortfolioArtist, "name" | "photoCount"> | null,
	maxPhotos: number,
): string | null {
	if (ready === 0) return "Add a photo to upload.";
	const tattooRoom = Math.max(0, MAX_TATTOO_PHOTOS - photos);
	if (tattooRoom === 0) {
		return `This tattoo already has ${MAX_TATTOO_PHOTOS} photos. Remove one to add another.`;
	}
	if (ready > tattooRoom) {
		return tattooRoom === 1
			? `This tattoo has room for 1 more photo. Remove ${ready - 1} from the list.`
			: `This tattoo has room for ${tattooRoom} more photos. Remove ${ready - tattooRoom} from the list.`;
	}
	if (artist) {
		const room = Math.max(0, maxPhotos - artist.photoCount);
		if (ready > room) {
			return room === 0
				? `${artist.name} already has ${maxPhotos} photos. Remove one to add another.`
				: `${artist.name} has room for ${room} more ${room === 1 ? "photo" : "photos"}. Remove ${ready - room} from the list.`;
		}
	}
	return null;
}

export const ADD_TO_TATTOO_INTRO =
	"They join this tattoo after its last photo, and follow its publishing, styles and healed mark. A tattoo has up to 8 photos and videos. A video plays without sound: its audio is removed.";

// Video angles.

/** The server's limits for one video (MAX_VIDEO_BYTES, MAX_VIDEO_MS): 100 MB and 60 seconds. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
/** A clip measured this much over 60 s is still taken (and cut): the server's tolerance. */
const VIDEO_LENGTH_TOLERANCE_MS = 500;

const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const VIDEO_EXTENSIONS: Record<string, string> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
};

/** What the tattoo's upload accepts: the photos' types and the videos'. */
export const TATTOO_FILE_ACCEPT =
	"image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm";

export const WRONG_VIDEO_FORMAT = "Use an MP4, MOV or WebM video.";
export const VIDEO_TOO_LARGE = "Use a video of 100 MB or less.";
export const VIDEO_TOO_LONG =
	"This video is longer than 60 seconds. Trim it, then add it again.";

/** The tattoo's drop zone hint: both kinds and their limits. */
export const TATTOO_DROP_HINT =
	"Photos: JPEG, PNG or WebP, up to 10 MB. Videos: MP4, MOV or WebM, up to 60 seconds and 100 MB.";

/** The type a chosen video goes up as, or null when it is not a video we take (by its type, else its extension). */
export function videoType(file: { name: string; type: string }): string | null {
	if (VIDEO_TYPES.includes(file.type)) return file.type;
	if (
		file.type &&
		!file.type.startsWith("video/") &&
		file.type !== "application/octet-stream"
	) {
		return null;
	}
	const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
	return VIDEO_EXTENSIONS[extension] ?? null;
}

/** Whether a chosen file is a video (by its type or its extension), so it goes the video's way. */
export function isVideoFile(file: { name: string; type: string }): boolean {
	return file.type.startsWith("video/") || videoType(file) !== null;
}

/**
 * Why a chosen file can't join a tattoo, or null: a video by its type and
 * size (its length is read once the browser has opened it,
 * `videoLengthProblem`), anything else by the photos' rule. The server
 * checks everything again, and what the file really is.
 */
export function tattooFileProblem(file: {
	name: string;
	type: string;
	size: number;
}): string | null {
	if (!isVideoFile(file)) return fileProblem(file);
	if (videoType(file) === null) return WRONG_VIDEO_FORMAT;
	if (file.size > MAX_VIDEO_BYTES) return VIDEO_TOO_LARGE;
	if (file.size === 0) return WRONG_VIDEO_FORMAT;
	return null;
}

/** An early word on a video's length as the browser measured it: null when it may go (the server measures again). */
export function videoLengthProblem(durationMs: number): string | null {
	return Number.isFinite(durationMs) &&
		durationMs > MAX_VIDEO_SECONDS * 1000 + VIDEO_LENGTH_TOLERANCE_MS
		? VIDEO_TOO_LONG
		: null;
}

/** "0:42", "1:00": a video's length. */
export function durationText(durationMs: number): string {
	const seconds = Math.max(0, Math.round(durationMs / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A video's name in the list: "Video, 0:42", or "Video" before its length is known. */
export function videoLabel(durationMs: number | null): string {
	return durationMs === null ? "Video" : `Video, ${durationText(durationMs)}`;
}

/** Where a video is, as its row says it. */
export function videoStateText(video: {
	state: VideoState;
	failure: string | null;
}): string {
	if (video.state === "processing") return "Processing…";
	if (video.state === "ready") return "Ready";
	return `Couldn't process: ${video.failure ?? "try uploading it again."}`;
}

/** Whether any tattoo shown has a video the worker still has: the page then checks again every few seconds. */
export function anyProcessing(
	photos: readonly Pick<PortfolioPhoto, "angles">[],
): boolean {
	return photos.some((photo) =>
		photo.angles.some((angle) => angle.video?.state === "processing"),
	);
}

/** How often the page asks again while a video is processing. */
export const VIDEO_POLL_MS = 4000;

/** Why a video's row can't make it the main photo, or move it to the top. */
export const VIDEO_LEAD_NOTE =
	"Videos can't be a tattoo's main photo, so they never move to the top.";

/** Why a video's row has no "Remove from this tattoo": on its own it would be a tattoo of one video. */
export const VIDEO_UNGROUP_NOTE =
	"A video stays with its tattoo. To take it off, delete it.";

/** The question before deleting one of a tattoo's videos. */
export const DELETE_VIDEO_QUESTION =
	"Delete this video? It leaves the tattoo, clients won't see it any more, and it can't be brought back.";

/**
 * Whether the tattoo's order after a move would put a video first, which
 * the server refuses: the move button is then disabled, with VIDEO_LEAD_NOTE.
 */
export function moveMakesVideoLead(
	kinds: readonly ("photo" | "video")[],
	index: number,
	direction: "up" | "down",
): boolean {
	if (direction === "up") return index === 1 && kinds[1] === "video";
	return index === 0 && kinds[1] === "video";
}

/** The tattoo's upload button: what it will send ("Upload 2 videos", "Upload 3 files"), or where it is. */
export function tattooUploadButton(
	kinds: readonly ("photo" | "video")[],
	sending: { index: number; total: number; percentage?: number } | null,
): string {
	if (sending) return uploadButton(kinds.length, sending);
	const videos = kinds.filter((kind) => kind === "video").length;
	if (videos === 0) return uploadButton(kinds.length, null);
	if (videos === kinds.length) {
		return videos === 1 ? "Upload video" : `Upload ${videos} videos`;
	}
	return `Upload ${kinds.length} files`;
}

// Selecting several photos.

export type BulkAction =
	| "publish"
	| "unpublish"
	| "reassign"
	| "delete"
	| "group";

/** "3 selected". */
export function selectedText(count: number): string {
	return `${count} selected`;
}

/** What each bulk button says while its request is out. */
export const BULK_BUSY: Record<BulkAction, string> = {
	publish: "Publishing…",
	unpublish: "Unpublishing…",
	reassign: "Moving…",
	delete: "Deleting…",
	group: "Grouping…",
};

/**
 * Whether "Group as one tattoo" is offered for this selection: 2 to 8
 * photos. The server decides the rest (one artist, none already a tattoo of
 * several photos) and says why it refuses.
 */
export function canGroup(count: number): boolean {
	return count >= 2 && count <= MAX_TATTOO_PHOTOS;
}

export const GROUP_HINT =
	"Photos of one tattoo from different angles: the newest becomes its main photo, and the tattoo takes its styles and healed mark. Publish or unpublish them all first.";

/**
 * What the bar says after a refusal, after the server's words: a group is
 * all or nothing, so its photos are all still selected; the other changes
 * keep only those they didn't change.
 */
export function bulkErrorTail(action: BulkAction): string {
	return action === "group"
		? "Nothing was grouped, and they are all still selected."
		: "The photos that weren't changed are still selected.";
}

/**
 * The question before a bulk delete, which can't be undone. `photos` counts
 * every photo that goes: a tattoo of several photos goes whole, so the
 * question says so when it is more than the tiles selected.
 */
export function deleteQuestion(count: number, photos = count): string {
	if (photos > count) {
		return count === 1
			? `Delete this tattoo and all ${photos} of its photos? Clients won't see them any more, and they can't be brought back.`
			: `Delete these ${count} tattoos, ${photos} photos in all? Clients won't see them any more, and they can't be brought back.`;
	}
	return count === 1
		? "Delete this photo? Clients won't see it any more, and it can't be brought back."
		: `Delete these ${count} photos? Clients won't see them any more, and they can't be brought back.`;
}

/**
 * The selected photos a bulk change did not change, judged from the page it
 * came back with: still there after a delete, still unpublished after a
 * publish (and the other way round), still with another artist after a
 * move. A photo the answer no longer lists left the view (it was changed
 * out of the filter, or deleted), so it counts as done; the server's
 * message gives the real counts. They stay selected so they can be tried
 * again.
 */
export function stillUnchanged(
	action: Exclude<BulkAction, "group">,
	ids: readonly string[],
	photos: readonly Pick<PortfolioPhoto, "id" | "published" | "artistId">[],
	artistId: string | null,
): string[] {
	const byId = new Map(photos.map((photo) => [photo.id, photo]));
	return ids.filter((id) => {
		const photo = byId.get(id);
		if (!photo) return false;
		if (action === "delete") return true;
		if (action === "publish") return !photo.published;
		if (action === "unpublish") return photo.published;
		return photo.artistId !== artistId;
	});
}

/**
 * What a remove asks for (angles), in the DELETE's query beside `back`:
 * `photo`, one of a tattoo's other photos, or `tattoo` with the number of
 * photos the page shows. The server checks it under the lock and deletes
 * nothing when the tattoo changed since (`removeWorkPhotoValidator`).
 */
export type RemoveIntent =
	| { scope: "photo" }
	| { scope: "tattoo"; photos: number };

/** The DELETE's query for `intent`, with `back` first when there is one. */
export function removeQuery(intent: RemoveIntent, back?: string): string {
	const parts = back ? [`back=${encodeURIComponent(back)}`] : [];
	parts.push(`scope=${intent.scope}`);
	if (intent.scope === "tattoo") parts.push(`photos=${intent.photos}`);
	return `?${parts.join("&")}`;
}

/** A bulk delete's `sizes`: how many photos each selected tattoo shows, by its id. */
export function deleteSizes(
	photos: readonly Pick<PortfolioPhoto, "id" | "angles">[],
): Record<string, number> {
	return Object.fromEntries(
		photos.map((photo) => [photo.id, photoTotal(photo)]),
	);
}
