import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { WorkPhotoLimitError } from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import {
	PORTFOLIO_PAGE_SIZE,
	type PortfolioQuery,
} from "#modules/artists/portfolio";
import ArtistService, {
	mayEdit,
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import type { StyleSlug } from "#modules/artists/styles";
import { visibleArtistSql } from "#modules/artists/visibility";
import type { WorkCursor } from "#modules/artists/work_cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, dbClient, withTransaction } from "#services/db_context";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

/** The photo's artist is still shown (see visibleArtistSql). */
const VISIBLE_ARTIST = visibleArtistSql("artist_work_photos");

/**
 * The most work photos an artist shows. The database no longer holds this
 * limit: the count under the artist's row lock (`add`) is the only guard.
 */
export const MAX_WORK_PHOTOS = 100;

const PURPOSE = "artist_work_photo";

/** What an artist or an owner sets on a photo besides the file (TAT-126). */
export type WorkPhotoDetails = {
	alt: string | null;
	styles: readonly StyleSlug[];
	healed: boolean;
};

/** The most pages of the portfolio that are read; a later page is the last one. */
const MAX_PORTFOLIO_PAGE = 1000;

/** One page of the portfolio: the photos, how many match, the page shown and the last. */
export type PortfolioPage = {
	photos: ArtistWorkPhoto[];
	total: number;
	page: number;
	lastPage: number;
};

const NO_DETAILS: WorkPhotoDetails = { alt: null, styles: [], healed: false };

/** What the gallery shows: these artists' photos, optionally one style and healed ones only. */
export type WorkFilter = {
	artistIds: readonly string[];
	style: string | null;
	healed: boolean;
};

/**
 * The photos of an artist's work (TAT-116, TAT-126): up to 100 public
 * photos, newest first (`created_at desc, id desc`, nothing reorders them),
 * each with an optional description, up to three styles and a healed mark.
 * Every call is scoped to the tenant. Who may change an artist's photos is
 * ArtistService.findEditable (an owner any live artist's, an artist their
 * own linked profile's), and every write checks that again under the
 * artist's row lock, the lock ArtistService.save takes too, so an upload and
 * a profile save never interleave. Files are stored through ImageService and deleted here, after
 * the real commit or rollback.
 */
@inject()
export default class WorkPhotoService {
	constructor(
		private images: ImageService,
		private artists: ArtistService,
	) {}

	/** The artist's photos, newest first. */
	async list(tenant: TenantRef, artist: Artist): Promise<ArtistWorkPhoto[]> {
		assertOwnedBy(tenant, artist);
		return ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where("artist_id", artist.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
	}

	/**
	 * Many artists' newest `perArtist` photos in one query, each artist's
	 * newest first; an artist with none has no entry. The caller passes the
	 * ids of artists it may show (the public reads pass only visible ones);
	 * only those still visible and live in this query count (VISIBLE_ARTIST);
	 * no query for []. The cut is made in the database by ranking each artist's
	 * photos in the order of `list`, so a tie in dates is broken by id and the
	 * same photos come back every time.
	 */
	async forArtists(
		tenant: TenantRef,
		artistIds: readonly string[],
		perArtist: number,
	): Promise<Map<string, ArtistWorkPhoto[]>> {
		const byArtist = new Map<string, ArtistWorkPhoto[]>();
		if (artistIds.length === 0) return byArtist;
		const photos = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.whereRaw(
				`id in (
					select id from (
						select id, row_number() over (
							partition by artist_id order by created_at desc, id desc
						) as place
						from artist_work_photos
						where tenant_id = ? and artist_id in (${artistIds.map(() => "?").join(", ")})
							and ${VISIBLE_ARTIST}
					) as ranked
					where place <= ?
				)`,
				[tenant.id, ...artistIds, tenant.id, perArtist],
			)
			.orderBy("artist_id", "asc")
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
		for (const photo of photos) {
			const list = byArtist.get(photo.artistId) ?? [];
			list.push(photo);
			byArtist.set(photo.artistId, list);
		}
		return byArtist;
	}

	/**
	 * One page of the photos of `filter.artistIds`, newest first
	 * (`created_at desc, id desc`), starting after the cursor `after`. The
	 * caller passes the ids of artists it may show (the public reads pass only
	 * visible ones); only those still visible and live in this query count
	 * (VISIBLE_ARTIST, as in findShown); no query for []. `style` keeps the photos tagged with
	 * that slug and `healed` the healed ones. `next` is the cursor of the
	 * last photo returned when more remain, else null: one more photo is read
	 * to know that. The cursor's time is read from and compared in the
	 * database, as text with its microseconds (see WorkCursor).
	 */
	async page(
		tenant: TenantRef,
		filter: WorkFilter,
		after: WorkCursor | null,
		limit: number,
	): Promise<{ photos: ArtistWorkPhoto[]; next: WorkCursor | null }> {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error(`A page needs a limit of 1 or more, got ${limit}`);
		}
		if (filter.artistIds.length === 0) return { photos: [], next: null };
		const query = ArtistWorkPhoto.query()
			.select("*")
			.select(
				dbClient().raw(
					`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at`,
				),
			)
			.where("tenant_id", tenant.id)
			.whereIn("artist_id", [...filter.artistIds])
			.whereRaw(VISIBLE_ARTIST, [tenant.id]);
		if (filter.style !== null) {
			query.whereRaw("styles @> array[?]::varchar[]", [filter.style]);
		}
		if (filter.healed) query.where("healed", true);
		if (after) {
			query.whereRaw("(created_at, id) < (?::timestamptz, ?::uuid)", [
				after.at,
				after.id,
			]);
		}
		const rows = await query
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.limit(limit + 1);
		const photos = rows.slice(0, limit);
		const last = photos[limit - 1];
		const next =
			rows.length > limit
				? { at: String(last.$extras.cursor_at), id: last.id }
				: null;
		return { photos, next };
	}

	/**
	 * One photo of `artistIds` by id, or null (the photo's own page): the
	 * caller passes the ids of artists it may show (the public read passes
	 * only visible ones), so another artist's, another tenant's, a removed
	 * and an unknown photo are all null; no query for []. The same query asks
	 * again that its artist is visible and live (VISIBLE_ARTIST, as
	 * FlashService.findShown does): under READ COMMITTED an artist can be
	 * hidden between the caller's read and this one, and the answer is
	 * cacheable.
	 */
	async findShown(
		tenant: TenantRef,
		photoId: string,
		artistIds: readonly string[],
	): Promise<ArtistWorkPhoto | null> {
		if (artistIds.length === 0) return null;
		return ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where("id", photoId)
			.whereIn("artist_id", [...artistIds])
			.whereRaw(VISIBLE_ARTIST, [tenant.id])
			.first();
	}

	/**
	 * What the gallery can filter by for these artists: the distinct style
	 * slugs their photos carry (as stored, unordered: the caller orders and
	 * filters them) and whether any photo is healed, counting only artists
	 * still visible and live (VISIBLE_ARTIST). One query; none for [].
	 */
	async facets(
		tenant: TenantRef,
		artistIds: readonly string[],
	): Promise<{ styles: string[]; healed: boolean }> {
		if (artistIds.length === 0) return { styles: [], healed: false };
		const { rows } = await dbClient().rawQuery(
			`select
				coalesce(array_agg(distinct s.style) filter (where s.style is not null), '{}') as styles,
				coalesce(bool_or(p.healed), false) as healed
			from artist_work_photos p
			left join lateral unnest(p.styles) as s(style) on true
			where p.tenant_id = ? and p.artist_id in (${artistIds.map(() => "?").join(", ")})
				and ${visibleArtistSql("p")}`,
			[tenant.id, ...artistIds, tenant.id],
		);
		return { styles: rows[0].styles, healed: rows[0].healed };
	}

	/**
	 * One page of the studio's portfolio (Studio OS): the photos of
	 * `artistIds` (the caller passes the live artists the member may see: an
	 * owner every one, an artist their own profile), matching the query, newest
	 * or oldest first (`created_at`, then `id`, the order of `list`). Unlike the
	 * public reads, a hidden artist's photos count: `status` keeps those of
	 * shown artists or of hidden ones. The search matches the description or
	 * the artist's name, with LIKE's wildcards taken literally. Each query asks
	 * again that the artist is live and the tenant's (`artists` is soft-deleted
	 * and a subquery skips the model's hook, so `deleted_at` is said here). A
	 * page past the last is the last. No query for [].
	 */
	async studioPage(
		tenant: TenantRef,
		artistIds: readonly string[],
		query: Omit<PortfolioQuery, "artist">,
	): Promise<PortfolioPage> {
		if (artistIds.length === 0) {
			return { photos: [], total: 0, page: 1, lastPage: 1 };
		}
		const wanted = Math.min(query.page, MAX_PORTFOLIO_PAGE);
		const artistWhere = (extra: string) =>
			`exists (
				select 1 from artists
				where artists.id = artist_work_photos.artist_id
					and artists.tenant_id = ?
					and artists.deleted_at is null${extra}
			)`;
		const find = (at: number) => {
			const rows = ArtistWorkPhoto.query()
				.where("tenant_id", tenant.id)
				.whereIn("artist_id", [...artistIds]);
			if (query.status === "shown") {
				rows.whereRaw(artistWhere(" and artists.visible"), [tenant.id]);
			} else if (query.status === "hidden") {
				rows.whereRaw(artistWhere(" and not artists.visible"), [tenant.id]);
			} else {
				rows.whereRaw(artistWhere(""), [tenant.id]);
			}
			if (query.style !== null) {
				rows.whereRaw("styles @> array[?]::varchar[]", [query.style]);
			}
			if (query.healed) rows.where("healed", true);
			if (query.search) {
				const pattern = `%${escapeLike(query.search)}%`;
				rows.where((group) => {
					group
						.whereRaw("alt ilike ? escape '\\'", [pattern])
						.orWhereRaw(artistWhere(" and artists.name ilike ? escape '\\'"), [
							tenant.id,
							pattern,
						]);
				});
			}
			const direction = query.sort === "oldest" ? "asc" : "desc";
			return rows
				.orderBy("created_at", direction)
				.orderBy("id", direction)
				.paginate(at, PORTFOLIO_PAGE_SIZE);
		};
		let result = await find(wanted);
		if (wanted > result.lastPage && result.total > 0) {
			result = await find(result.lastPage);
		}
		return {
			photos: result.all(),
			total: result.total,
			page: Math.max(1, Math.min(wanted, result.lastPage)),
			lastPage: Math.max(1, result.lastPage),
		};
	}

	/**
	 * How many photos each of `artistIds` has (an artist with none has no
	 * entry), so an upload knows the room left before it sends anything. The
	 * count under the artist's lock in `add` is still the one that counts.
	 */
	async counts(
		tenant: TenantRef,
		artistIds: readonly string[],
	): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		if (artistIds.length === 0) return counts;
		const rows = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.whereIn("artist_id", [...artistIds])
			.groupBy("artist_id")
			.select("artist_id")
			.count("* as total");
		for (const row of rows) {
			counts.set(row.artistId, Number(row.$extras.total));
		}
		return counts;
	}

	/**
	 * The photo and its artist, if `editor` may change them: the photo is the
	 * tenant's, and the artist is live and `editor`'s to edit
	 * (ArtistService.findEditable). Another tenant's photo, a deleted artist's,
	 * another artist's for an artist member and an unknown id all throw
	 * E_ROW_NOT_FOUND (a 404), so callers can't tell them apart.
	 */
	async findEditable(
		tenant: TenantRef,
		editor: ProfileEditor,
		photoId: string,
	): Promise<{ photo: ArtistWorkPhoto; artist: Artist }> {
		const photo = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where("id", photoId)
			.firstOrFail();
		const artist = await this.artists.findEditable(
			tenant,
			editor,
			photo.artistId,
		);
		return { photo, artist };
	}

	/**
	 * Adds a photo, dated now, so it is the artist's newest, with the
	 * `details` given at upload (none by default; the portfolio's upload
	 * sends them, the same rules as updateDetails). Throws
	 * WorkPhotoLimitError when the artist already shows 100 (also when two
	 * uploads race for the last place: the second is refused under the lock
	 * and its file is deleted) and InvalidImageError for a file we can't
	 * accept.
	 *
	 * The order matters. The unlocked count refuses a full set before any
	 * decode; the file is stored inside the transaction with its cleanup
	 * registered at once and before the row lock (so the lock is not held
	 * while the image is processed); the lock then serializes uploads, and the
	 * count under it is the one that counts.
	 */
	async add(
		tenant: TenantRef,
		editor: ProfileEditor,
		artist: Artist,
		upload: Upload,
		details: WorkPhotoDetails = NO_DETAILS,
	): Promise<ArtistWorkPhoto> {
		assertOwnedBy(tenant, artist);
		const alt = details.alt?.trim();
		// Before any decode: an upload to a profile that isn't the editor's, or
		// to a full set, costs nothing. (The lock below checks both again.)
		if (!mayEdit(editor, artist.userId)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
		}
		if ((await this.countPhotos(tenant, artist.id)) >= MAX_WORK_PHOTOS) {
			throw new WorkPhotoLimitError();
		}
		return withTransaction(async (trx) => {
			const stored = await this.images.store(upload, {
				tenant,
				purpose: PURPOSE,
			});
			afterRollback(() => this.images.delete(PURPOSE, stored.key));
			await this.artists.lockEditable(trx, tenant, editor, artist.id);
			// Again under the lock: another upload may have landed meanwhile.
			const count = await this.countPhotos(tenant, artist.id, trx);
			if (count >= MAX_WORK_PHOTOS) throw new WorkPhotoLimitError();
			return ArtistWorkPhoto.create(
				{
					tenantId: tenant.id,
					artistId: artist.id,
					imageKey: stored.key,
					width: stored.width,
					height: stored.height,
					alt: alt ? alt : null,
					styles: [...details.styles],
					healed: details.healed,
				},
				{ client: trx },
			);
		});
	}

	/**
	 * Sets the photo's description, styles and healed mark in one save. Empty
	 * text clears the description (the public page then words its own). The
	 * styles are stored as given: the validator has checked them against the
	 * list and the database holds the limit of three.
	 */
	async updateDetails(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
		details: WorkPhotoDetails,
	): Promise<ArtistWorkPhoto> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const text = details.alt?.trim();
			live.alt = text ? text : null;
			live.styles = [...details.styles];
			live.healed = details.healed;
			await live.save();
			return live;
		});
	}

	/**
	 * Deletes the photo for good, files first (TAT-116): under the artist's
	 * lock the photo's files and every copy are deleted, and only then the row
	 * goes; the other photos keep their dates, so their order stays. A photo a
	 * client asked to take down must not stay fetchable while the studio is
	 * told it is gone, so if any file cannot be deleted this throws
	 * ImageDeleteError (the controller says so and the row stays, so the owner
	 * can try again: a missing file counts as deleted, so a retry finishes the
	 * job). The deletes are real the moment they run, before the commit; the
	 * transaction only has the row delete left to fail.
	 */
	async remove(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
	): Promise<void> {
		assertPhotoOf(tenant, photo);
		await withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			await this.images.deleteOrThrow(PURPOSE, live.imageKey);
			await live.delete();
		});
	}

	/** How many photos the artist has now. A hook so a test can stage a racing upload. */
	protected async countPhotos(
		tenant: TenantRef,
		artistId: string,
		client?: QueryClientContract,
	): Promise<number> {
		const [row] = await ArtistWorkPhoto.query(client ? { client } : undefined)
			.where("tenant_id", tenant.id)
			.where("artist_id", artistId)
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** The photo's row, read again under the artist's lock: gone meanwhile is a 404. */
	private async lockedPhoto(
		trx: QueryClientContract,
		tenant: TenantRef,
		photo: ArtistWorkPhoto,
	): Promise<ArtistWorkPhoto> {
		return ArtistWorkPhoto.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", photo.id)
			.firstOrFail();
	}
}

/** A caller bug, not a user error: artists come from findEditable(tenant, editor, id). */
function assertOwnedBy(tenant: TenantRef, artist: Artist) {
	if (artist.tenantId !== tenant.id) {
		throw new Error(`Artist ${artist.id} belongs to another tenant`);
	}
}

function assertPhotoOf(tenant: TenantRef, photo: ArtistWorkPhoto) {
	if (photo.tenantId !== tenant.id) {
		throw new Error(`Work photo ${photo.id} belongs to another tenant`);
	}
}

/** Escapes LIKE's wildcards and its escape character. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
