import { STYLE_SLUGS, type StyleSlug } from "#modules/artists/styles";

/**
 * The studio's portfolio (Studio OS): every work photo of the artists a
 * member may see, on one page, filtered and paged by the address. Pure, so
 * the unit tests load it; WorkPhotoService.studioPage runs the query.
 */

/** Photos on one page of the portfolio: four or five full rows on a desktop. */
export const PORTFOLIO_PAGE_SIZE = 40;

/**
 * The most photos of one tattoo: its lead and seven angles. The database
 * holds it too (`artist_work_photos_angle_position`: places 1 to 7), so the
 * count under the artist's lock (WorkPhotoService) is a friendly refusal,
 * not the only guard. Here, in the pure module, so the validators and the
 * words read the same number.
 */
export const MAX_TATTOO_PHOTOS = 8;

/**
 * Where a photo stands on the studio page: published and its artist shown
 * (on the page), unpublished by the studio, or published while its artist
 * is hidden (not on the page until the artist is shown).
 */
export const PORTFOLIO_STATUSES = [
	"all",
	"published",
	"unpublished",
	"artist_hidden",
] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUSES)[number];

export const PORTFOLIO_SORTS = ["newest", "oldest"] as const;
export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];

/** The longest search that is read; the rest is cut. */
const MAX_SEARCH = 100;

/** What the address asks the portfolio for, every value checked. */
export type PortfolioQuery = {
	search: string;
	/** An artist id from the address. The controller keeps it only if it is one of the member's. */
	artist: string | null;
	style: StyleSlug | null;
	status: PortfolioStatus;
	healed: boolean;
	sort: PortfolioSort;
	page: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(
	list: readonly T[],
	value: unknown,
	fallback: T,
): T =>
	typeof value === "string" && (list as readonly string[]).includes(value)
		? (value as T)
		: fallback;

/**
 * The query string read with every value checked: an unknown style, status
 * or sort is the default, a page below 1 or not a number is 1, an artist
 * that is not a uuid is none. Never throws, so a hand-edited address shows
 * the portfolio, not an error.
 */
export function parsePortfolioQuery(
	input: Record<string, unknown>,
): PortfolioQuery {
	const search =
		typeof input.q === "string" ? input.q.trim().slice(0, MAX_SEARCH) : "";
	const artist =
		typeof input.artist === "string" && UUID.test(input.artist)
			? input.artist.toLowerCase()
			: null;
	const page = Number(input.page);
	return {
		search,
		artist,
		style: oneOf<StyleSlug | "">(STYLE_SLUGS, input.style, "") || null,
		status: oneOf(PORTFOLIO_STATUSES, input.status, "all"),
		healed: input.healed === "1",
		sort: oneOf(PORTFOLIO_SORTS, input.sort, "newest"),
		page: Number.isInteger(page) && page >= 1 ? page : 1,
	};
}

/**
 * Where a work photo's write goes back to when it was made from the
 * portfolio: `value` if it is this studio's portfolio with a plain query
 * string, else null (the write then goes to the artist's profile, as
 * before). The rule of calendarBack, so the field can never send anyone off
 * the site or to another studio's page.
 */
export function portfolioBack(value: unknown, slug: string): string | null {
	if (typeof value !== "string") return null;
	const page = `/t/${slug}/portfolio`;
	if (value !== page && !value.startsWith(`${page}?`)) return null;
	return /^[\w\-./?=&%]*$/.test(value) ? value : null;
}

/**
 * What the portfolio can do to several photos at once. A tile is a tattoo,
 * so each acts on whole tattoos (a tattoo's angles follow its lead), except
 * `group`, which makes one tattoo of the selected photos and is all or
 * nothing (WorkPhotoService.group).
 */
export const BULK_ACTIONS = [
	"publish",
	"unpublish",
	"reassign",
	"delete",
	"group",
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** Why one photo of a bulk change was not changed. */
export type BulkFailure = "gone" | "full" | "files" | "same" | "changed";

const BULK_DONE: Record<BulkAction, string> = {
	publish: "published",
	unpublish: "unpublished",
	reassign: "moved",
	delete: "deleted",
	group: "grouped",
};

/** Why the selected photos could not be grouped as one tattoo (TattooGroupError's reasons, and `gone`). */
export type GroupRefusal =
	| "count"
	| "artists"
	| "angle"
	| "has_angles"
	| "mixed"
	| "gone";

/**
 * What "Group as one tattoo" says when it ends: how many photos the tattoo
 * now has and which is its main photo, or, refused, why and what to do
 * instead. Nothing is merged silently: a photo that already is a tattoo of
 * several photos refuses the group, and the message says how to add photos
 * to it instead.
 */
export function groupSummary(outcome: { photos: number } | GroupRefusal): {
	ok: boolean;
	message: string;
} {
	if (typeof outcome === "object") {
		return {
			ok: true,
			message: `Grouped as one tattoo of ${outcome.photos} photos. The newest is its main photo, and the tattoo takes its styles and healed mark.`,
		};
	}
	const reasons: Record<GroupRefusal, string> = {
		count: `Select 2 to ${MAX_TATTOO_PHOTOS} photos to group as one tattoo.`,
		artists:
			"Select photos of one artist: a tattoo is one artist's work. Move them to the same artist first.",
		angle: "One of these photos is already part of another tattoo.",
		has_angles:
			"One of these is already a tattoo of several photos, so nothing was grouped. To add photos to it, open it and choose Add photos or videos to this tattoo.",
		mixed:
			"Some of these photos are unpublished. Publish or unpublish them all first, then group them.",
		gone: "Some of these photos were removed or changed meanwhile, so nothing was grouped.",
	};
	return { ok: false, message: `Not grouped. ${reasons[outcome]}` };
}

const photos = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;
const tattoos = (n: number) => `${n} ${n === 1 ? "tattoo" : "tattoos"}`;

/**
 * What a bulk change says when it ends: how many were changed and, for
 * those that weren't, how many and why, so no failure goes unsaid. `artist`
 * is the artist a move went to. `ok` is false when any photo failed: the
 * message is then an error flash.
 */
export function bulkSummary(
	action: BulkAction,
	done: number,
	failures: readonly BulkFailure[],
	artist?: string,
): { ok: boolean; message: string } {
	const verb =
		action === "reassign" && artist ? `moved to ${artist}` : BULK_DONE[action];
	if (failures.length === 0) {
		return { ok: true, message: `${upperFirst(photos(done))} ${verb}.` };
	}
	const count = (kind: BulkFailure) =>
		failures.filter((failure) => failure === kind).length;
	const reasons = [
		count("gone") > 0
			? `${photos(count("gone"))} removed or changed meanwhile`
			: "",
		count("full") > 0
			? `${photos(count("full"))} over ${artist ?? "the artist"}'s limit of 100`
			: "",
		count("files") > 0
			? `${photos(count("files"))} whose files couldn't be removed (try again)`
			: "",
		count("same") > 0
			? `${photos(count("same"))} already with ${artist ?? "that artist"}`
			: "",
		count("changed") > 0
			? `${tattoos(count("changed"))} changed since you opened them (check and try again)`
			: "",
	].filter(Boolean);
	const head =
		done > 0
			? `${upperFirst(photos(done))} ${verb}.`
			: `No photos were ${BULK_DONE[action]}.`;
	return {
		ok: false,
		message: `${head} Not changed: ${reasons.join("; ")}.`,
	};
}

function upperFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a page says when the tattoo it asked to remove is not the one it showed. */
export const TATTOO_CHANGED_SINCE =
	"This tattoo changed since you opened it. Check it and try again.";

/**
 * The photos a bulk change acts on, one per tattoo (angles): a tile is a
 * tattoo, and a change to an angle is a change to its tattoo, so a lead and
 * its own angle selected together are one change, not a failure. The lead
 * stands for its tattoo when it is there; otherwise the first photo of it
 * given. Order kept. Pure.
 */
export function oneByTattoo<
	T extends { id: string; leadPhotoId: string | null },
>(photos: readonly T[]): T[] {
	const chosen = new Map<string, T>();
	for (const photo of photos) {
		const key = photo.leadPhotoId ?? photo.id;
		const held = chosen.get(key);
		if (!held || (held.leadPhotoId !== null && photo.leadPhotoId === null)) {
			chosen.set(key, photo);
		}
	}
	const kept = new Set(chosen.values());
	return photos.filter((photo) => kept.has(photo));
}
