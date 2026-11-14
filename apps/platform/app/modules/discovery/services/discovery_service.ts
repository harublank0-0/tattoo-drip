import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import {
	knownStyles,
	TATTOO_STYLES,
	type TattooStyleRef,
} from "#modules/artists/styles";
import {
	type DiscoverCursor,
	type DiscoverSort,
	encodeDiscoverCursor,
} from "#modules/discovery/cursor";
import { readDiscovery } from "#modules/discovery/read";
import { linkReferral } from "#modules/discovery/referral";
import { ICON_SIZE } from "#modules/media/services/image_processor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	type ShownImage,
} from "#modules/media/services/image_service";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import { type LogoTile, logoTileOf } from "#modules/storefront/look";
import {
	type PublicSocialLink,
	socialLinks,
} from "#modules/storefront/studio_page";
import {
	artistPageUrl,
	artworkPageUrl,
	bookingPageUrl,
	studioPageUrl,
} from "#services/storefront_url";

/**
 * Discover's public reads (Discover D03, docs/discover/api.md). Every query
 * reads only the `discovery` views (D02: the eligible rows of every listed
 * business, as the discovery role sees them) and `places`, through
 * readDiscovery: no tenant or user context, read-only, rolled back. Every
 * value from a request is a bound parameter; the SQL around it is fixed
 * text chosen from the maps below, never built from input. Every field of
 * an answer is written out here, from the views' public columns.
 *
 * A row the views do not return does not exist for Discover: callers answer
 * 404 for null, whatever the reason (unlisted, taken down, hidden, deleted).
 */

export type DiscoverLocation = {
	country: string;
	slug: string;
	name: string;
	region: string | null;
};
export type DiscoverStudioRef = {
	slug: string;
	name: string;
	type: "studio" | "independent";
};
type Shown = ShownImage;
type ShownWithAlt = ShownImage & { alt: string | null };
type ShownLogo = ShownImage & {
	alt: null;
	tile: LogoTile;
	icon: ShownImage | null;
};

export type DiscoverStudioSummary = {
	id: string;
	slug: string;
	name: string;
	type: "studio";
	location: DiscoverLocation | null;
	logo: ShownLogo | null;
	cover: ShownWithAlt | null;
	styles: TattooStyleRef[];
	storefrontUrl: string;
};
export type DiscoverArtistSummary = {
	id: string;
	slug: string;
	name: string;
	photo: Shown | null;
	styles: TattooStyleRef[];
	acceptingInquiries: boolean;
	independent: boolean;
	studio: DiscoverStudioRef;
	location: DiscoverLocation | null;
	storefrontUrl: string;
};
export type DiscoverTattooSummary = {
	id: string;
	image: ShownWithAlt;
	styles: TattooStyleRef[];
	healed: boolean;
	artist: { id: string; slug: string; name: string };
	studio: DiscoverStudioRef;
};
export type DiscoverStudioDetail = DiscoverStudioSummary & {
	intro: string | null;
	timezone: string;
	socialLinks: PublicSocialLink[];
	artists: DiscoverArtistSummary[];
	tattoos: DiscoverTattooSummary[];
	bookingUrl: string;
};
export type DiscoverArtistDetail = DiscoverArtistSummary & {
	bio: string | null;
	socialLinks: PublicSocialLink[];
	tattoos: DiscoverTattooSummary[];
	bookingUrl: string;
};
export type DiscoverTattooDetail = DiscoverTattooSummary & {
	location: DiscoverLocation | null;
	/** Whether the photo's artist takes new requests (D09: the artwork page's booking words). */
	artistAcceptingInquiries: boolean;
	storefrontUrl: string;
	bookingUrl: string;
};
export type DiscoverPage<T> = { items: T[]; nextCursor: string | null };

/** A sitemap list's page (D10): rows after `after` (an id), by id, at most `limit`. */
export type SitemapQuery = { after: string | null; limit: number };
export type DiscoverSitemapStudio = { slug: string };
export type DiscoverSitemapArtist = {
	slug: string;
	studio: { slug: string; type: "studio" | "independent" };
};
export type DiscoverSitemapTattoo = { id: string };

export type LocationFilter = { country?: string; city?: string };
export type StudioQuery = LocationFilter & {
	q?: string;
	style?: string;
	sort: DiscoverSort;
	cursor: DiscoverCursor | null;
	limit: number;
};
export type ArtistQuery = StudioQuery & {
	studio?: string;
	independent?: boolean;
};
export type TattooQuery = LocationFilter & {
	q?: string;
	style?: string;
	studio?: string;
	artist?: string;
	healed?: boolean;
	cursor: DiscoverCursor | null;
	limit: number;
};

/** A studio's or artist's newest published photos on its profile. */
export const PROFILE_TATTOOS = 12;
/** The most artists one studio's profile lists. */
export const MAX_STUDIO_ARTISTS = 100;

/** The instant as the cursor carries it: UTC, microseconds, written by the database. */
const AT_TEXT = (column: string) =>
	`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Per sort: the cursor's value, the keyset condition after a cursor (value
 * then id) and the order, all fixed SQL. `name` is the name in lower case,
 * `time` the column of `newest`.
 */
export function sortSql(
	sort: DiscoverSort,
	name: string,
	time: string,
	id: string,
) {
	switch (sort) {
		case "name":
			return {
				value: `lower(${name})`,
				after: `(lower(${name}), ${id}) > (?, ?::uuid)`,
				order: `lower(${name}) asc, ${id} asc`,
			};
		case "-name":
			return {
				value: `lower(${name})`,
				after: `(lower(${name}), ${id}) < (?, ?::uuid)`,
				order: `lower(${name}) desc, ${id} desc`,
			};
		case "newest":
			return {
				value: AT_TEXT(time),
				after: `(${time}, ${id}) < (?::timestamptz, ?::uuid)`,
				order: `${time} desc, ${id} desc`,
			};
	}
}

const STUDIO_COLUMNS = `s.id, s.slug, s.type, s.name, s.intro, s.timezone, s.place_id,
	s.cover_image_key, s.cover_image_width, s.cover_image_height,
	s.logo_image_key, s.logo_image_width, s.logo_image_height, s.logo_tile, s.logo_icon_key,
	s.instagram_url, s.facebook_url, s.tiktok_url, s.website_url, s.listed_at`;
export const ARTIST_COLUMNS = `a.id, a.studio_id, a.slug, a.name, a.bio, a.photo_key, a.photo_width,
	a.photo_height, a.styles, a.accepting_inquiries, a.instagram_url, a.facebook_url,
	a.tiktok_url, a.created_at,
	s.slug as studio_slug, s.name as studio_name, s.type as studio_type, s.place_id`;
const TATTOO_COLUMNS = `w.id, w.studio_id, w.artist_id, w.image_key, w.width, w.height, w.alt,
	w.styles, w.healed, w.created_at,
	a.slug as artist_slug, a.name as artist_name,
	s.slug as studio_slug, s.name as studio_name, s.type as studio_type, s.place_id`;
const TATTOO_FROM = `discovery.artworks w
	join discovery.artists a on a.id = w.artist_id
	join discovery.studios s on s.id = w.studio_id`;

export type StudioRow = {
	id: string;
	slug: string;
	type: "studio" | "independent";
	name: string;
	intro: string | null;
	timezone: string;
	place_id: string | null;
	cover_image_key: string | null;
	cover_image_width: number | null;
	cover_image_height: number | null;
	logo_image_key: string | null;
	logo_image_width: number | null;
	logo_image_height: number | null;
	logo_tile: string;
	logo_icon_key: string | null;
	instagram_url: string | null;
	facebook_url: string | null;
	tiktok_url: string | null;
	website_url: string | null;
	cursor_value?: string;
};
export type ArtistRow = {
	id: string;
	studio_id: string;
	slug: string;
	name: string;
	bio: string | null;
	photo_key: string | null;
	photo_width: number | null;
	photo_height: number | null;
	styles: string[];
	accepting_inquiries: boolean;
	instagram_url: string | null;
	facebook_url: string | null;
	tiktok_url: string | null;
	studio_slug: string;
	studio_name: string;
	studio_type: "studio" | "independent";
	place_id: string | null;
	cursor_value?: string;
};
type TattooRow = {
	id: string;
	studio_id: string;
	artist_id: string;
	image_key: string;
	width: number;
	height: number;
	alt: string | null;
	styles: string[];
	healed: boolean;
	artist_slug: string;
	artist_name: string;
	studio_slug: string;
	studio_name: string;
	studio_type: "studio" | "independent";
	place_id: string | null;
	cursor_value?: string;
};

/** One transaction's connection: its queries run one after another, never in parallel. */
export type Client = TransactionClientContract;

/** The SQL condition and bindings of a location filter on `s.place_id`. */
export function placeFilter({ country, city }: LocationFilter): {
	sql: string;
	bindings: unknown[];
} {
	if (!country) return { sql: "", bindings: [] };
	if (!city) {
		return {
			sql: " and s.place_id in (select p.id from public.places p where p.country_code = ?)",
			bindings: [country],
		};
	}
	return {
		sql: " and s.place_id in (select p.id from public.places p where p.country_code = ? and p.slug = ?)",
		bindings: [country, city],
	};
}

@inject()
export default class DiscoveryService {
	constructor(private images: ImageService) {}

	/** The listed studios (not independent artists: they are artists), a page at a time. */
	async studios(
		query: StudioQuery,
	): Promise<DiscoverPage<DiscoverStudioSummary>> {
		return readDiscovery(async (client) => {
			const sort = sortSql(query.sort, "s.name", "s.listed_at", "s.id");
			const bindings: unknown[] = [];
			let where = "s.type = 'studio'";
			if (query.q) {
				where += " and strpos(lower(s.name), lower(?)) > 0";
				bindings.push(query.q);
			}
			const place = placeFilter(query);
			where += place.sql;
			bindings.push(...place.bindings);
			if (query.style) {
				where +=
					" and exists (select 1 from discovery.artists x where x.studio_id = s.id and x.styles @> array[?]::varchar[])";
				bindings.push(query.style);
			}
			if (query.cursor) {
				where += ` and ${sort.after}`;
				bindings.push(query.cursor.value, query.cursor.id);
			}
			const rows = await rowsOf<StudioRow>(
				client,
				`select ${STUDIO_COLUMNS}, ${sort.value} as cursor_value
				 from discovery.studios s where ${where}
				 order by ${sort.order} limit ?`,
				[...bindings, query.limit + 1],
			);
			const page = rows.slice(0, query.limit);
			const places = await placesOf(
				client,
				page.map(({ place_id }) => place_id),
			);
			const styles = await studioStylesOf(
				client,
				page.map(({ id }) => id),
			);
			return {
				items: await Promise.all(
					page.map((row) =>
						this.studioSummary(row, places, styles.get(row.id) ?? []),
					),
				),
				nextCursor: nextCursorOf(rows, query.limit, query.sort),
			};
		});
	}

	/** One listed studio by its current or an old slug, with its artists and newest photos. */
	async studio(slug: string): Promise<DiscoverStudioDetail | null> {
		return readDiscovery(async (client) => {
			const row = await studioBySlug(client, slug, "studio");
			if (!row) return null;
			const places = await placesOf(client, [row.place_id]);
			const styles = await studioStylesOf(client, [row.id]);
			const artists = await this.artistsOf(client, row.id);
			const tattoos = await this.tattoosOf(client, { studioId: row.id });
			const summary = await this.studioSummary(
				row,
				places,
				styles.get(row.id) ?? [],
			);
			return {
				...summary,
				intro: row.intro,
				timezone: row.timezone,
				socialLinks: socialLinks(profileLinks(row)),
				artists,
				tattoos,
				bookingUrl: bookingPageUrl(storefrontTemplate(), row.slug, {
					ref: linkReferral(row.id),
				}),
			};
		});
	}

	/** A listed studio's shown artists by name, or null for an unknown studio. */
	async studioArtists(slug: string): Promise<DiscoverArtistSummary[] | null> {
		return readDiscovery(async (client) => {
			const row = await studioBySlug(client, slug, "studio");
			return row ? this.artistsOf(client, row.id) : null;
		});
	}

	/** The shown artists of every listed business, a page at a time. */
	async artists(
		query: ArtistQuery,
	): Promise<DiscoverPage<DiscoverArtistSummary>> {
		return readDiscovery(async (client) => {
			const sort = sortSql(query.sort, "a.name", "a.created_at", "a.id");
			const bindings: unknown[] = [];
			let where = "true";
			if (query.q) {
				where += " and strpos(lower(a.name), lower(?)) > 0";
				bindings.push(query.q);
			}
			const place = placeFilter(query);
			where += place.sql;
			bindings.push(...place.bindings);
			if (query.style) {
				where += " and a.styles @> array[?]::varchar[]";
				bindings.push(query.style);
			}
			if (query.studio) {
				where += " and s.slug = ?";
				bindings.push(query.studio);
			}
			if (query.independent !== undefined) {
				where += query.independent
					? " and s.type = 'independent'"
					: " and s.type = 'studio'";
			}
			if (query.cursor) {
				where += ` and ${sort.after}`;
				bindings.push(query.cursor.value, query.cursor.id);
			}
			const rows = await rowsOf<ArtistRow>(
				client,
				`select ${ARTIST_COLUMNS}, ${sort.value} as cursor_value
				 from discovery.artists a join discovery.studios s on s.id = a.studio_id
				 where ${where} order by ${sort.order} limit ?`,
				[...bindings, query.limit + 1],
			);
			const page = rows.slice(0, query.limit);
			const places = await placesOf(
				client,
				page.map(({ place_id }) => place_id),
			);
			return {
				items: await Promise.all(
					page.map((row) => this.artistSummary(row, places)),
				),
				nextCursor: nextCursorOf(rows, query.limit, query.sort),
			};
		});
	}

	/** One shown artist at a listed studio, by the studio's slug and the artist's. */
	async studioArtist(
		studioSlug: string,
		artistSlug: string,
	): Promise<DiscoverArtistDetail | null> {
		return readDiscovery(async (client) => {
			const studio = await studioBySlug(client, studioSlug, "studio");
			if (!studio) return null;
			const [row] = await rowsOf<ArtistRow>(
				client,
				`select ${ARTIST_COLUMNS} from discovery.artists a
				 join discovery.studios s on s.id = a.studio_id
				 where a.studio_id = ? and a.slug = ?`,
				[studio.id, artistSlug],
			);
			return row ? this.artistDetail(client, row) : null;
		});
	}

	/**
	 * A listed independent artist by their business's slug: its shown artist
	 * profile, the first made if it has more than one.
	 */
	async independentArtist(slug: string): Promise<DiscoverArtistDetail | null> {
		return readDiscovery(async (client) => {
			const business = await studioBySlug(client, slug, "independent");
			if (!business) return null;
			const [row] = await rowsOf<ArtistRow>(
				client,
				`select ${ARTIST_COLUMNS} from discovery.artists a
				 join discovery.studios s on s.id = a.studio_id
				 where a.studio_id = ? order by a.created_at asc, a.id asc limit 1`,
				[business.id],
			);
			return row ? this.artistDetail(client, row) : null;
		});
	}

	/**
	 * The published photos of every shown artist, newest first, a page at a
	 * time. The page is read from `discovery.artworks` alone (whose rows
	 * already have a shown artist at a listed business) and only its rows are
	 * joined to their artist and studio: joining first makes PostgreSQL read
	 * every published photo before it sorts (docs/discover/api.md,
	 * "Performance"). A studio's filters (place, slug) pick its ids.
	 */
	async tattoos(
		query: TattooQuery,
	): Promise<DiscoverPage<DiscoverTattooSummary>> {
		return readDiscovery(async (client) => {
			const sort = sortSql("newest", "a.name", "w.created_at", "w.id");
			const bindings: unknown[] = [];
			let where = "true";
			const place = placeFilter(query);
			if (place.sql || query.studio) {
				where += ` and w.studio_id in (select s.id from discovery.studios s where true${place.sql}`;
				bindings.push(...place.bindings);
				if (query.studio) {
					where += " and s.slug = ?";
					bindings.push(query.studio);
				}
				where += ")";
			}
			if (query.q) {
				// D09: the photo's own public text (its alt text), its artist's or
				// business's name, or the name of a style it is tagged with, as a
				// case-insensitive substring (strpos, so `%` and `_` are literal).
				// Names come from the views; style names from the platform's fixed
				// list, matched here and bound as an array of slugs.
				where += ` and (strpos(lower(coalesce(w.alt, '')), lower(?)) > 0
					or w.artist_id in (select x.id from discovery.artists x where strpos(lower(x.name), lower(?)) > 0)
					or w.studio_id in (select y.id from discovery.studios y where strpos(lower(y.name), lower(?)) > 0)
					or w.styles && ?::varchar[])`;
				bindings.push(query.q, query.q, query.q, stylesNamed(query.q));
			}
			if (query.style) {
				where += " and w.styles @> array[?]::varchar[]";
				bindings.push(query.style);
			}
			if (query.artist) {
				where += " and w.artist_id = ?::uuid";
				bindings.push(query.artist);
			}
			if (query.healed) where += " and w.healed";
			if (query.cursor) {
				where += ` and ${sort.after}`;
				bindings.push(query.cursor.value, query.cursor.id);
			}
			const rows = await rowsOf<TattooRow>(
				client,
				`select ${TATTOO_COLUMNS}, ${sort.value} as cursor_value
				 from (select w.* from discovery.artworks w where ${where}
				       order by ${sort.order} limit ?) w
				 join discovery.artists a on a.id = w.artist_id
				 join discovery.studios s on s.id = w.studio_id
				 order by ${sort.order}`,
				[...bindings, query.limit + 1],
			);
			const page = rows.slice(0, query.limit);
			return {
				items: await Promise.all(page.map((row) => this.tattooSummary(row))),
				nextCursor: nextCursorOf(rows, query.limit, "newest"),
			};
		});
	}

	/**
	 * One published photo by id, with where to see it and to ask for one like
	 * it. Angles: the id of one of a tattoo's other photos answers with the
	 * tattoo (`discovery.artwork_angles` resolves it to its lead, in the same
	 * query), whose `id` is then the lead's: the Discover app redirects the old
	 * address there.
	 */
	async tattoo(id: string): Promise<DiscoverTattooDetail | null> {
		return readDiscovery(async (client) => {
			const [row] = await rowsOf<TattooRow & { accepting_inquiries: boolean }>(
				client,
				`select ${TATTOO_COLUMNS}, a.accepting_inquiries
				 from ${TATTOO_FROM}
				 where w.id = coalesce(
					(select g.artwork_id from discovery.artwork_angles g where g.id = ?::uuid),
					?::uuid
				 )`,
				[id, id],
			);
			if (!row) return null;
			const places = await placesOf(client, [row.place_id]);
			return {
				...(await this.tattooSummary(row)),
				location: locationOf(row.place_id, places),
				artistAcceptingInquiries: row.accepting_inquiries,
				storefrontUrl: artworkPageUrl(
					storefrontTemplate(),
					row.studio_slug,
					row.id,
				),
				bookingUrl: bookingPageUrl(storefrontTemplate(), row.studio_slug, {
					artwork: row.id,
					ref: linkReferral(row.studio_id),
				}),
			};
		});
	}

	/** The places at least one listed business is in, by country and name. */
	async locations(): Promise<DiscoverLocation[]> {
		return readDiscovery(async (client) => {
			const rows = await rowsOf<PlaceRow>(
				client,
				`select p.id, p.country_code, p.slug, p.name, p.region from public.places p
				 where exists (select 1 from discovery.studios s where s.place_id = p.id)
				 order by p.country_code, lower(p.name), p.id`,
				[],
			);
			return rows.map(locationFromRow);
		});
	}

	/**
	 * The sitemap lists (D10): only the canonical identifiers of what the
	 * lists above show, from the same views (so the same eligibility), by id
	 * with keyset paging (`id > after`), so a page never needs an offset and
	 * rows added later (uuidv7: later ids) land on the last page.
	 */
	async sitemapStudios(
		query: SitemapQuery,
	): Promise<DiscoverPage<DiscoverSitemapStudio>> {
		return readDiscovery(async (client) => {
			const rows = await rowsOf<{ id: string; slug: string }>(
				client,
				`select s.id, s.slug from discovery.studios s
				 where s.type = 'studio'${query.after ? " and s.id > ?::uuid" : ""}
				 order by s.id limit ?`,
				sitemapBindings(query),
			);
			return sitemapPage(rows, query.limit, ({ slug }) => ({ slug }));
		});
	}

	/**
	 * Every shown artist at a listed studio, and one row per listed
	 * independent business: the artist `independentArtist` answers (the
	 * first made), whose profile is the business's address.
	 */
	async sitemapArtists(
		query: SitemapQuery,
	): Promise<DiscoverPage<DiscoverSitemapArtist>> {
		return readDiscovery(async (client) => {
			const rows = await rowsOf<{
				id: string;
				slug: string;
				studio_slug: string;
				studio_type: "studio" | "independent";
			}>(
				client,
				`select a.id, a.slug, s.slug as studio_slug, s.type as studio_type
				 from discovery.artists a join discovery.studios s on s.id = a.studio_id
				 where (s.type = 'studio' or a.id = (
				   select x.id from discovery.artists x where x.studio_id = a.studio_id
				   order by x.created_at asc, x.id asc limit 1))${query.after ? " and a.id > ?::uuid" : ""}
				 order by a.id limit ?`,
				sitemapBindings(query),
			);
			return sitemapPage(rows, query.limit, (row) => ({
				slug: row.slug,
				studio: { slug: row.studio_slug, type: row.studio_type },
			}));
		});
	}

	/** Every published photo's id. */
	async sitemapTattoos(
		query: SitemapQuery,
	): Promise<DiscoverPage<DiscoverSitemapTattoo>> {
		return readDiscovery(async (client) => {
			const rows = await rowsOf<{ id: string }>(
				client,
				`select w.id from discovery.artworks w
				 ${query.after ? "where w.id > ?::uuid " : ""}order by w.id limit ?`,
				sitemapBindings(query),
			);
			return sitemapPage(rows, query.limit, ({ id }) => ({ id }));
		});
	}

	/** The platform's styles, in the list's order (the filter's values). */
	styles(): TattooStyleRef[] {
		return TATTOO_STYLES.map(({ slug, name }) => ({ slug, name }));
	}

	private async artistsOf(
		client: Client,
		studioId: string,
	): Promise<DiscoverArtistSummary[]> {
		const rows = await rowsOf<ArtistRow>(
			client,
			`select ${ARTIST_COLUMNS} from discovery.artists a
			 join discovery.studios s on s.id = a.studio_id
			 where a.studio_id = ? order by lower(a.name), a.id limit ?`,
			[studioId, MAX_STUDIO_ARTISTS],
		);
		const places = await placesOf(
			client,
			rows.map(({ place_id }) => place_id),
		);
		return Promise.all(rows.map((row) => this.artistSummary(row, places)));
	}

	private async tattoosOf(
		client: Client,
		{ studioId, artistId }: { studioId: string; artistId?: string },
	): Promise<DiscoverTattooSummary[]> {
		const rows = await rowsOf<TattooRow>(
			client,
			`select ${TATTOO_COLUMNS} from ${TATTOO_FROM}
			 where w.studio_id = ?::uuid${artistId ? " and w.artist_id = ?::uuid" : ""}
			 order by w.created_at desc, w.id desc limit ?`,
			artistId
				? [studioId, artistId, PROFILE_TATTOOS]
				: [studioId, PROFILE_TATTOOS],
		);
		return Promise.all(rows.map((row) => this.tattooSummary(row)));
	}

	private async artistDetail(
		client: Client,
		row: ArtistRow,
	): Promise<DiscoverArtistDetail> {
		const places = await placesOf(client, [row.place_id]);
		const tattoos = await this.tattoosOf(client, {
			studioId: row.studio_id,
			artistId: row.id,
		});
		return {
			...(await this.artistSummary(row, places)),
			bio: row.bio,
			socialLinks: socialLinks({
				instagramUrl: row.instagram_url,
				facebookUrl: row.facebook_url,
				tiktokUrl: row.tiktok_url,
			}),
			tattoos,
			bookingUrl: bookingPageUrl(storefrontTemplate(), row.studio_slug, {
				artist: row.slug,
				ref: linkReferral(row.studio_id),
			}),
		};
	}

	private async studioSummary(
		row: StudioRow,
		places: Map<string, PlaceRow>,
		styles: string[],
	): Promise<DiscoverStudioSummary> {
		const tenant = { id: row.id };
		const cover =
			row.cover_image_key && row.cover_image_width && row.cover_image_height
				? {
						...(await this.images.shownImage(
							"studio_cover",
							row.cover_image_key,
							tenant,
							{ width: row.cover_image_width, height: row.cover_image_height },
						)),
						alt: null,
					}
				: null;
		const logo =
			row.logo_image_key && row.logo_image_width && row.logo_image_height
				? {
						...(await this.images.shownImage(
							"studio_logo",
							row.logo_image_key,
							tenant,
							{ width: row.logo_image_width, height: row.logo_image_height },
						)),
						alt: null,
						tile: logoTileOf(row.logo_tile),
						icon: row.logo_icon_key
							? await this.images.shownImage(
									"studio_icon",
									row.logo_icon_key,
									tenant,
									{ width: ICON_SIZE, height: ICON_SIZE },
								)
							: null,
					}
				: null;
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			type: "studio",
			location: locationOf(row.place_id, places),
			logo,
			cover,
			styles: knownStyles(styles),
			storefrontUrl: studioPageUrl(storefrontTemplate(), row.slug),
		};
	}

	private async artistSummary(
		row: ArtistRow,
		places: Map<string, PlaceRow>,
	): Promise<DiscoverArtistSummary> {
		const photo =
			row.photo_key && row.photo_width && row.photo_height
				? await this.images.shownImage(
						"artist_photo",
						row.photo_key,
						{ id: row.studio_id },
						{ width: row.photo_width, height: row.photo_height },
					)
				: null;
		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			photo,
			styles: knownStyles(row.styles),
			acceptingInquiries: row.accepting_inquiries,
			independent: row.studio_type === "independent",
			studio: studioRef(row),
			location: locationOf(row.place_id, places),
			storefrontUrl: artistPageUrl(
				storefrontTemplate(),
				row.studio_slug,
				row.slug,
			),
		};
	}

	private async tattooSummary(row: TattooRow): Promise<DiscoverTattooSummary> {
		return {
			id: row.id,
			image: {
				...(await this.images.shownImage(
					"artist_work_photo",
					row.image_key,
					{ id: row.studio_id },
					{ width: row.width, height: row.height },
				)),
				alt: row.alt,
			},
			styles: knownStyles(row.styles),
			healed: row.healed,
			artist: {
				id: row.artist_id,
				slug: row.artist_slug,
				name: row.artist_name,
			},
			studio: studioRef(row),
		};
	}
}

export type PlaceRow = {
	id: string;
	country_code: string;
	slug: string;
	name: string;
	region: string | null;
};

export async function rowsOf<T>(
	client: Client,
	sql: string,
	bindings: unknown[],
): Promise<T[]> {
	return (await client.rawQuery(sql, bindings as never)).rows as T[];
}

/** A listed business of `type` by its current slug, else by an old one (tenant_for_slug). */
export async function studioBySlug(
	client: Client,
	slug: string,
	type: "studio" | "independent",
): Promise<StudioRow | null> {
	const [current] = await rowsOf<StudioRow>(
		client,
		`select ${STUDIO_COLUMNS} from discovery.studios s where s.slug = ? and s.type = ?`,
		[slug, type],
	);
	if (current) return current;
	// An old slug names the same tenant for good (TAT-24). The function gives
	// the id of any live tenant; only the view says whether it is listed, so an
	// unlisted one is the same null as an unknown slug.
	const [alias] = await rowsOf<{ id: string | null }>(
		client,
		"select public.tenant_for_slug(?) as id",
		[slug],
	);
	if (!alias?.id) return null;
	const [row] = await rowsOf<StudioRow>(
		client,
		`select ${STUDIO_COLUMNS} from discovery.studios s where s.id = ? and s.type = ?`,
		[alias.id, type],
	);
	return row ?? null;
}

export async function placesOf(
	client: Client,
	ids: (string | null)[],
): Promise<Map<string, PlaceRow>> {
	const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
	if (wanted.length === 0) return new Map();
	const rows = await rowsOf<PlaceRow>(
		client,
		"select p.id, p.country_code, p.slug, p.name, p.region from public.places p where p.id = any(?::uuid[])",
		[wanted],
	);
	return new Map(rows.map((row) => [row.id, row]));
}

/** The styles each studio's shown artists name. */
async function studioStylesOf(
	client: Client,
	ids: string[],
): Promise<Map<string, string[]>> {
	if (ids.length === 0) return new Map();
	const rows = await rowsOf<{ studio_id: string; style: string }>(
		client,
		`select distinct a.studio_id, st.style
		 from discovery.artists a cross join lateral unnest(a.styles) as st(style)
		 where a.studio_id = any(?::uuid[])`,
		[ids],
	);
	const styles = new Map<string, string[]>();
	for (const { studio_id, style } of rows) {
		styles.set(studio_id, [...(styles.get(studio_id) ?? []), style]);
	}
	return styles;
}

/**
 * The slugs of the styles whose name contains `q`, whatever its case (the
 * gallery search's style match, D09); none is an empty array, which
 * overlaps nothing.
 */
export function stylesNamed(q: string): string[] {
	const text = q.toLowerCase();
	return TATTOO_STYLES.filter(({ name }) =>
		name.toLowerCase().includes(text),
	).map(({ slug }) => slug);
}

function locationFromRow(row: PlaceRow): DiscoverLocation {
	return {
		country: row.country_code,
		slug: row.slug,
		name: row.name,
		region: row.region,
	};
}

export function locationOf(
	placeId: string | null,
	places: Map<string, PlaceRow>,
): DiscoverLocation | null {
	const place = placeId ? places.get(placeId) : undefined;
	return place ? locationFromRow(place) : null;
}

export function studioRef(row: {
	studio_slug: string;
	studio_name: string;
	studio_type: "studio" | "independent";
}): DiscoverStudioRef {
	return {
		slug: row.studio_slug,
		name: row.studio_name,
		type: row.studio_type,
	};
}

function profileLinks(row: StudioRow) {
	return {
		instagramUrl: row.instagram_url,
		facebookUrl: row.facebook_url,
		tiktokUrl: row.tiktok_url,
		websiteUrl: row.website_url,
	};
}

function sitemapBindings({ after, limit }: SitemapQuery): unknown[] {
	return after ? [after, limit + 1] : [limit + 1];
}

/** A sitemap page: `limit` rows and, when one more came back, the last one's id as the cursor. */
function sitemapPage<R extends { id: string }, T>(
	rows: R[],
	limit: number,
	item: (row: R) => T,
): DiscoverPage<T> {
	const page = rows.slice(0, limit);
	return {
		items: page.map(item),
		nextCursor:
			rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
	};
}

/** The cursor after a page of `limit` rows when one more row came back. */
export function nextCursorOf(
	rows: { id: string; cursor_value?: string }[],
	limit: number,
	sort: DiscoverSort,
): string | null {
	if (rows.length <= limit) return null;
	const last = rows[limit - 1];
	return encodeDiscoverCursor({
		sort,
		value: String(last.cursor_value),
		id: last.id,
	});
}
