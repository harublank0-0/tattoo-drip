/**
 * The portfolio's types, words and small rules (Studio OS). Plain TypeScript
 * with no imports, so a unit test loads it
 * (tests/unit/inertia/portfolio_copy.spec.ts); the page and its panels only
 * lay them out. The server decides everything else (PortfolioController,
 * WorkPhotoService).
 */

/** A work photo as the portfolio gets it, with the copies it shows and its artist. */
export type PortfolioPhoto = {
	id: string;
	artistId: string;
	artistName: string;
	/** On the studio page: its artist is shown there. */
	shown: boolean;
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
};

export type PortfolioArtist = {
	id: string;
	name: string;
	visible: boolean;
	photoCount: number;
};

export type PortfolioStatus = "all" | "shown" | "hidden";
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
	artists: PortfolioArtist[];
	styleOptions: { slug: string; name: string }[];
	filters: PortfolioFilters;
	page: { current: number; last: number; total: number; size: number };
	maxPhotos: number;
	isOwner: boolean;
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
	{ value: "all", label: "Shown and hidden" },
	{ value: "shown", label: "On your page" },
	{ value: "hidden", label: "Hidden" },
];

export const SORT_OPTIONS: { value: PortfolioSort; label: string }[] = [
	{ value: "newest", label: "Newest first" },
	{ value: "oldest", label: "Oldest first" },
];

export const PAGE_DESCRIPTION = "Manage and showcase your best work.";

/** The line above the gallery: how many photos, and of how many when filtered. */
export function resultLine(
	matching: number,
	everything: number,
	filtered: boolean,
): string {
	const photos = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;
	if (!filtered) return photos(everything);
	return matching === 1
		? `1 photo matches, of ${everything}`
		: `${matching} photos match, of ${everything}`;
}

/** What a photo's status says, in the panel and on its tile. */
export function statusText(shown: boolean): string {
	return shown ? "On your page" : "Hidden";
}

/** Why a hidden photo is hidden: photos follow their artist. */
export const HIDDEN_NOTE =
	"Hidden from your page because its artist is. Show the artist on your page to publish their work.";

/** A tile's accessible name: what it shows, by whom, and when it is hidden. */
export function tileLabel(photo: PortfolioPhoto): string {
	const what = photo.alt ? photo.alt : `Photo by ${photo.artistName}`;
	const by = photo.alt ? `, by ${photo.artistName}` : "";
	return `${what}${by}${photo.shown ? "" : ", hidden"}`;
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
	"Photos of finished and healed work. They show on your studio page, newest first, while their artist is on it.";

export const DROP_HINT = "JPEG, PNG or WebP, up to 10 MB each.";

export const REMOVE_QUESTION =
	"Remove this photo? Clients won't see it any more, and it can't be brought back.";
