import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import {
	TattooChangedError,
	TattooGroupError,
	TattooPhotoLimitError,
	WorkPhotoLimitError,
} from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import {
	MAX_TATTOO_PHOTOS,
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
 * The most work photos an artist shows, angles included: a tattoo of four
 * photos takes four places. The database no longer holds this limit: the
 * count under the artist's row lock (`add`, `reassign`) is the only guard.
 */
export const MAX_WORK_PHOTOS = 100;

/** The most photos of one tattoo (the portfolio module's, where the words read it too). */
export { MAX_TATTOO_PHOTOS };

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

/** A tattoo as the public reads and the portfolio show it: its lead and its angles, in order. */
export type Tattoo = { lead: ArtistWorkPhoto; angles: ArtistWorkPhoto[] };

/** What the gallery shows: these artists' photos, optionally one style and healed ones only. */
export type WorkFilter = {
	artistIds: readonly string[];
	style: string | null;
	healed: boolean;
};

/**
 * The photos of an artist's work (TAT-116, TAT-126): up to 100 photos,
 * newest first (`created_at desc, id desc`, nothing reorders them),
 * each with an optional description, up to three styles and a healed mark.
 *
 * Angles: a tattoo is a lead photo (`lead_photo_id` null) and up to seven
 * more photos of the same piece, its angles (`lead_photo_id` its lead,
 * `angle_position` 1 to 7, in order; migration
 * 1791900000000_add_angles_to_artist_work_photos holds the shape). The
 * newest-first order is the leads'; an angle has no place of its own in it.
 * The lead speaks for the tattoo: its `hidden`, `styles` and `healed` are
 * the tattoo's. They are COPIED onto the angles whenever they could differ
 * (grouping, adding an angle, the lead's own changes, a new lead taking
 * over), so the rows never disagree and a photo that leaves its tattoo
 * (`ungroup`) or becomes its lead keeps the state the studio last saw on the
 * tattoo, never a stale one of its own; the public reads still ask the
 * lead's columns only, so a copy that went wrong could never publish an
 * angle. The description (`alt`) stays each photo's own. The public reads
 * list leads only (`lead_photo_id is null`) and give each its angles in one
 * more query (`anglesOf`); `findShown` of an angle answers with its lead.
 * Angles count toward the 100.
 * Every call is scoped to the tenant. Who may change an artist's photos is
 * ArtistService.findEditable (an owner any live artist's, an artist their
 * own linked profile's), and every write checks that again under the
 * artist's row lock, the lock ArtistService.save takes too, so an upload and
 * a profile save never interleave. Files are stored through ImageService and deleted here, after
 * the real commit or rollback. A photo is public while it is not `hidden`
 * (Studio OS: unpublished by the studio, `setHidden`) and its artist is
 * visible and live: every public read (`forArtists`, `page`, `findShown`,
 * `facets`) asks both in its own query; the dashboard's reads show all.
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
	 * newest first; an artist with none has no entry. Tattoos, not angles:
	 * only leads are read, so a tattoo of four photos is one of the six. The caller passes the
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
							and not hidden
							and lead_photo_id is null
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
	 * database, as text with its microseconds (see WorkCursor). Leads only:
	 * one entry per tattoo, filtered by the lead's styles and healed mark
	 * (the tattoo's); `anglesOf` gives the page's angles.
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
			.whereRaw(VISIBLE_ARTIST, [tenant.id])
			.where("hidden", false)
			.whereNull("lead_photo_id");
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
	 * cacheable. An angle's id answers with its tattoo's lead (an old link to
	 * a photo that has since been grouped under another keeps working; the
	 * storefront redirects it to the lead's page), by the lead's own rules:
	 * a hidden tattoo's angle is null like its lead. Still one query.
	 */
	async findShown(
		tenant: TenantRef,
		photoId: string,
		artistIds: readonly string[],
	): Promise<ArtistWorkPhoto | null> {
		if (artistIds.length === 0) return null;
		return ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.whereRaw(
				`id = coalesce(
					(select p.lead_photo_id from artist_work_photos p where p.tenant_id = ? and p.id = ?),
					?::uuid
				)`,
				[tenant.id, photoId, photoId],
			)
			.whereNull("lead_photo_id")
			.whereIn("artist_id", [...artistIds])
			.whereRaw(VISIBLE_ARTIST, [tenant.id])
			.where("hidden", false)
			.first();
	}

	/**
	 * What the gallery can filter by for these artists: the distinct style
	 * slugs their photos carry (as stored, unordered: the caller orders and
	 * filters them) and whether any photo is healed, counting only artists
	 * still visible and live (VISIBLE_ARTIST). Leads only, whose styles and
	 * healed mark are the tattoo's. One query; none for [].
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
				and ${visibleArtistSql("p")}
				and not p.hidden
				and p.lead_photo_id is null`,
			[tenant.id, ...artistIds, tenant.id],
		);
		return { styles: rows[0].styles, healed: rows[0].healed };
	}

	/**
	 * The angles of these leads, each lead's in order (`angle_position`), in
	 * one query; a lead with none has no entry, and there is no query for [].
	 * The caller passes leads it has already read under its own rules (the
	 * public reads: shown leads only), so nothing about the angles' own
	 * `hidden`, `styles` or `healed` is asked: the lead decides for its
	 * tattoo, and the copies agree with it anyway.
	 */
	async anglesOf(
		tenant: TenantRef,
		leadIds: readonly string[],
	): Promise<Map<string, ArtistWorkPhoto[]>> {
		const byLead = new Map<string, ArtistWorkPhoto[]>();
		if (leadIds.length === 0) return byLead;
		const angles = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.whereIn("lead_photo_id", [...leadIds])
			.orderBy("lead_photo_id", "asc")
			.orderBy("angle_position", "asc");
		for (const angle of angles) {
			const lead = angle.leadPhotoId as string;
			const list = byLead.get(lead) ?? [];
			list.push(angle);
			byLead.set(lead, list);
		}
		return byLead;
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
	 * page past the last is the last. No query for []. A tile is a tattoo:
	 * leads only, so `total` counts tattoos, filtered by the lead's status,
	 * styles and healed mark (the tattoo's); the search also finds a tattoo
	 * by one of its angles' descriptions. `anglesOf` gives the page's angles.
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
				.whereIn("artist_id", [...artistIds])
				.whereNull("lead_photo_id");
			// On the page: published and its artist shown. Unpublished: hidden
			// by the studio. Artist hidden: published, but its artist is not.
			if (query.status === "published") {
				rows
					.where("hidden", false)
					.whereRaw(artistWhere(" and artists.visible"), [tenant.id]);
			} else if (query.status === "unpublished") {
				rows.where("hidden", true).whereRaw(artistWhere(""), [tenant.id]);
			} else if (query.status === "artist_hidden") {
				rows
					.where("hidden", false)
					.whereRaw(artistWhere(" and not artists.visible"), [tenant.id]);
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
						.orWhereRaw(
							`exists (
								select 1 from artist_work_photos angle
								where angle.tenant_id = artist_work_photos.tenant_id
									and angle.lead_photo_id = artist_work_photos.id
									and angle.alt ilike ? escape '\\'
							)`,
							[pattern],
						)
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
	 * How many photos each of `artistIds` has, angles included, so an upload
	 * knows the room left before it sends anything (the count under the
	 * artist's lock in `add` is still the one that counts), and how many
	 * tattoos (leads) those make, what the portfolio counts. An artist with
	 * none has no entry. One grouped query.
	 */
	async counts(
		tenant: TenantRef,
		artistIds: readonly string[],
	): Promise<Map<string, { photos: number; tattoos: number }>> {
		const counts = new Map<string, { photos: number; tattoos: number }>();
		if (artistIds.length === 0) return counts;
		const rows = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.whereIn("artist_id", [...artistIds])
			.groupBy("artist_id")
			.select("artist_id")
			.count("* as total")
			.select(
				dbClient().raw(
					"count(*) filter (where lead_photo_id is null) as tattoos",
				),
			);
		for (const row of rows) {
			counts.set(row.artistId, {
				photos: Number(row.$extras.total),
				tattoos: Number(row.$extras.tattoos),
			});
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
	 * With `lead` (a lead photo of this artist, from findEditable), the photo
	 * is added to that tattoo as its last angle instead: the next place, and
	 * the lead's `hidden`, `styles` and `healed` (the tattoo's; `details`
	 * gives only its description). A tattoo already of eight photos is
	 * TattooPhotoLimitError, a lead that is an angle by now (grouped under
	 * another meanwhile) is TattooChangedError, both checked again under the
	 * lock; the artist's 100 still counts every angle.
	 *
	 * The order matters. The unlocked counts refuse a full set before any
	 * decode; the file is stored inside the transaction with its cleanup
	 * registered at once and before the row lock (so the lock is not held
	 * while the image is processed); the lock then serializes uploads, and the
	 * counts under it are the ones that count.
	 */
	async add(
		tenant: TenantRef,
		editor: ProfileEditor,
		artist: Artist,
		upload: Upload,
		details: WorkPhotoDetails & { hidden?: boolean } = NO_DETAILS,
		lead: ArtistWorkPhoto | null = null,
	): Promise<ArtistWorkPhoto> {
		assertOwnedBy(tenant, artist);
		if (lead) {
			assertPhotoOf(tenant, lead);
			if (lead.artistId !== artist.id) {
				throw new Error(`Work photo ${lead.id} is not ${artist.id}'s`);
			}
		}
		const alt = details.alt?.trim();
		// Before any decode: an upload to a profile that isn't the editor's, or
		// to a full set, costs nothing. (The lock below checks both again.)
		if (!mayEdit(editor, artist.userId)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
		}
		if ((await this.countPhotos(tenant, artist.id)) >= MAX_WORK_PHOTOS) {
			throw new WorkPhotoLimitError();
		}
		if (
			lead &&
			(await this.tattooRows(tenant, lead.id)).length >= MAX_TATTOO_PHOTOS
		) {
			throw new TattooPhotoLimitError();
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
			if (!lead) {
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
						hidden: details.hidden ?? false,
					},
					{ client: trx },
				);
			}
			const live = await this.lockedPhoto(trx, tenant, lead);
			if (live.leadPhotoId !== null) throw new TattooChangedError();
			const photos = await this.tattooRows(tenant, live.id, trx);
			if (photos.length >= MAX_TATTOO_PHOTOS) {
				throw new TattooPhotoLimitError();
			}
			return ArtistWorkPhoto.create(
				{
					tenantId: tenant.id,
					artistId: artist.id,
					imageKey: stored.key,
					width: stored.width,
					height: stored.height,
					alt: alt ? alt : null,
					styles: [...live.styles],
					healed: live.healed,
					hidden: live.hidden,
					leadPhotoId: live.id,
					anglePosition: photos.length,
				},
				{ client: trx },
			);
		});
	}

	/**
	 * Groups 2 to 8 photos of one artist as one tattoo (the portfolio's bulk
	 * "Group as one tattoo"): the newest of them (`created_at desc, id desc`,
	 * the gallery's order) becomes the lead and the others its angles, newest
	 * first, each taking the lead's `hidden`, `styles` and `healed`. Nothing
	 * is merged silently: a photo that is already an angle (`angle`) or that
	 * leads a tattoo of its own (`has_angles`) refuses the whole group, as do
	 * photos of more than one artist (`artists`) and too few or too many
	 * (`count`), all TattooGroupError. Under the artist's lock, each photo read
	 * again (one removed or moved meanwhile is E_ROW_NOT_FOUND), and one
	 * UPDATE for the angles, which the database judges at its end. The artist's
	 * count does not change, so there is no room to check.
	 */
	async group(
		tenant: TenantRef,
		editor: ProfileEditor,
		photos: readonly ArtistWorkPhoto[],
	): Promise<Tattoo> {
		for (const photo of photos) assertPhotoOf(tenant, photo);
		const ids = [...new Set(photos.map(({ id }) => id))];
		if (ids.length < 2 || ids.length > MAX_TATTOO_PHOTOS) {
			throw new TattooGroupError("count");
		}
		const artistIds = new Set(photos.map(({ artistId }) => artistId));
		if (artistIds.size !== 1) throw new TattooGroupError("artists");
		const artistId = photos[0].artistId;
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, artistId);
			const live = await ArtistWorkPhoto.query({ client: trx })
				.where("tenant_id", tenant.id)
				.whereIn("id", ids)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc");
			if (
				live.length !== ids.length ||
				live.some((photo) => photo.artistId !== artistId)
			) {
				throw new lucidErrors.E_ROW_NOT_FOUND(ArtistWorkPhoto);
			}
			if (live.some((photo) => photo.leadPhotoId !== null)) {
				throw new TattooGroupError("angle");
			}
			const [{ total }] = (
				await trx.rawQuery(
					"select count(*)::int as total from artist_work_photos where tenant_id = ? and lead_photo_id = any(?::uuid[])",
					[tenant.id, ids],
				)
			).rows as { total: number }[];
			if (total > 0) throw new TattooGroupError("has_angles");
			const [lead, ...angles] = live;
			await this.setAngles(trx, tenant, lead, angles);
			return { lead, angles: await this.tattooAngles(trx, tenant, lead.id) };
		});
	}

	/**
	 * Puts a tattoo's photos in a new order (the details panel's "Move
	 * earlier", "Move later" and "Make this the main photo"): `orderedIds`
	 * names every photo of the tattoo once, the new lead first, then its
	 * angles in order. `photo` is the tattoo's lead as the page knew it.
	 * Under the artist's lock the tattoo is read again, and anything but
	 * exactly its photos (one added, removed or regrouped meanwhile), or a
	 * photo that is no longer a lead, is TattooChangedError, so a stale page
	 * never reorders what it cannot see. A new lead takes the tattoo's
	 * `hidden`, `styles` and `healed` (the old lead's, copied onto every photo),
	 * so its state on the page does not change with its main photo. One
	 * UPDATE, judged by the database at its end.
	 */
	async arrange(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
		orderedIds: readonly string[],
	): Promise<Tattoo> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			if (live.leadPhotoId !== null) throw new TattooChangedError();
			const rows = await this.tattooRows(tenant, live.id, trx);
			const byId = new Map(rows.map((row) => [row.id, row]));
			if (
				orderedIds.length !== rows.length ||
				new Set(orderedIds).size !== rows.length ||
				orderedIds.some((id) => !byId.has(id))
			) {
				throw new TattooChangedError();
			}
			const same = orderedIds.every((id, index) => rows[index].id === id);
			const ordered = orderedIds.map((id) => byId.get(id) as ArtistWorkPhoto);
			const [lead, ...angles] = ordered;
			if (!same) {
				await this.setAngles(trx, tenant, lead, angles, live);
			}
			return { lead, angles: await this.tattooAngles(trx, tenant, lead.id) };
		});
	}

	/**
	 * Takes one angle out of its tattoo ("Remove from this tattoo"): it
	 * becomes a tattoo of its own, keeping its date, its files and the state
	 * it had (the tattoo's, copied), and the angles after it close the gap.
	 * A photo that is not an angle (any more) is TattooChangedError. Two
	 * UPDATEs under the artist's lock.
	 */
	async ungroup(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
	): Promise<ArtistWorkPhoto> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const lead = live.leadPhotoId;
			const place = live.anglePosition;
			if (lead === null || place === null) throw new TattooChangedError();
			live.leadPhotoId = null;
			live.anglePosition = null;
			await live.save();
			await this.closeGap(trx, tenant, lead, place);
			return live;
		});
	}

	/**
	 * Sets the photo's description and, for a lead, its tattoo's styles and
	 * healed mark, in one save (and one more UPDATE copying them onto its
	 * angles). Empty text clears the description (the public page then words
	 * its own). An angle keeps the tattoo's styles and healed mark whatever is
	 * sent: they are the lead's to set. The styles are stored as given: the
	 * validator has checked them against the list and the database holds the
	 * limit of three.
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
			if (live.leadPhotoId === null) {
				live.styles = [...details.styles];
				live.healed = details.healed;
			}
			await live.save();
			if (live.leadPhotoId === null) {
				await this.copyToAngles(trx, tenant, live);
			}
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
	 *
	 * A tattoo goes whole: removing a lead removes its angles too (every
	 * photo's files, then every row in one DELETE, which the key from the
	 * angles to the lead allows only all at once). Removing an angle removes
	 * that photo alone, and the angles after it close the gap. Returns how
	 * many photos went.
	 */
	async remove(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
	): Promise<number> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const lead = live.leadPhotoId;
			const place = live.anglePosition;
			if (lead !== null && place !== null) {
				await this.images.deleteOrThrow(PURPOSE, live.imageKey);
				await live.delete();
				await this.closeGap(trx, tenant, lead, place);
				return 1;
			}
			const rows = await this.tattooRows(tenant, live.id, trx);
			// The angles' files first, the lead's last: a failure part way leaves
			// the tattoo listed under its lead, and the retry finishes the job.
			for (const row of [...rows].reverse()) {
				await this.images.deleteOrThrow(PURPOSE, row.imageKey);
			}
			await ArtistWorkPhoto.query({ client: trx })
				.where("tenant_id", tenant.id)
				.whereIn(
					"id",
					rows.map(({ id }) => id),
				)
				.delete();
			return rows.length;
		});
	}

	/**
	 * Publishes (`hidden` false) or unpublishes the photo's tattoo (Studio
	 * OS), under its artist's lock like every write: the lead and every angle
	 * in one UPDATE (an angle given stands for its tattoo). An unpublished
	 * photo leaves every public read at once (each asks `not hidden`); a
	 * studio page or API answer cached before can still list it for its cache
	 * lifetime (up to about 12 minutes, the work read's `publicCache`), and its
	 * files stay where they are, at the same unguessable URLs, as a hidden
	 * flash design's do. Publishing a photo of a hidden artist changes nothing
	 * on the page until the artist is shown.
	 */
	async setHidden(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
		hidden: boolean,
	): Promise<ArtistWorkPhoto> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const lead = live.leadPhotoId ?? live.id;
			await trx.rawQuery(
				`update artist_work_photos set hidden = ?, updated_at = now()
				where tenant_id = ? and (id = ? or lead_photo_id = ?) and hidden <> ?`,
				[hidden, tenant.id, lead, lead, hidden],
			);
			live.hidden = hidden;
			return live;
		});
	}

	/**
	 * Gives the photo's tattoo to another artist of the tenant (Studio OS):
	 * the lead and every angle together (an angle given stands for its
	 * tattoo), in one UPDATE, since the database never lets a tattoo span two
	 * artists. Both artists must be `editor`'s to edit (an owner any live
	 * artist; an artist only their own, so for them this only ever names the
	 * same profile) and the new one must have room for every photo of it.
	 * Both artists' rows are locked, in id order so two moves the other way
	 * round can't deadlock, and the count is taken under the new artist's
	 * lock, as `add` does, so a move and an upload never take the 101st
	 * place. The photos keep their dates, so the tattoo takes its place among
	 * the new artist's work; its files don't move (their keys name the
	 * tenant, not the artist). Another tenant's or a deleted artist is
	 * E_ROW_NOT_FOUND; a full artist is WorkPhotoLimitError.
	 */
	async reassign(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
		artistId: string,
	): Promise<ArtistWorkPhoto> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			const ids = [...new Set([photo.artistId, artistId])].sort();
			for (const id of ids) {
				await this.artists.lockEditable(trx, tenant, editor, id);
			}
			const live = await this.lockedPhoto(trx, tenant, photo);
			if (live.artistId === artistId) return live;
			const rows = await this.tattooRows(
				tenant,
				live.leadPhotoId ?? live.id,
				trx,
			);
			const count = await this.countPhotos(tenant, artistId, trx);
			if (count + rows.length > MAX_WORK_PHOTOS) {
				throw new WorkPhotoLimitError();
			}
			await ArtistWorkPhoto.query({ client: trx })
				.where("tenant_id", tenant.id)
				.whereIn(
					"id",
					rows.map(({ id }) => id),
				)
				.update({ artist_id: artistId, updated_at: new Date() });
			live.artistId = artistId;
			return live;
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

	/**
	 * A tattoo's rows, the lead first and then its angles in order: every
	 * photo of the tattoo `leadId` leads (just the photo, for one without
	 * angles). With `client`, inside the caller's transaction.
	 */
	private async tattooRows(
		tenant: TenantRef,
		leadId: string,
		client?: QueryClientContract,
	): Promise<ArtistWorkPhoto[]> {
		return ArtistWorkPhoto.query(client ? { client } : undefined)
			.where("tenant_id", tenant.id)
			.where((rows) => {
				rows.where("id", leadId).orWhere("lead_photo_id", leadId);
			})
			.orderByRaw("angle_position asc nulls first");
	}

	/** A lead's angles, in order, read inside the caller's transaction. */
	private async tattooAngles(
		trx: QueryClientContract,
		tenant: TenantRef,
		leadId: string,
	): Promise<ArtistWorkPhoto[]> {
		return ArtistWorkPhoto.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("lead_photo_id", leadId)
			.orderBy("angle_position", "asc");
	}

	/**
	 * Makes `lead` the lead of a tattoo whose angles are `angles`, in that
	 * order (places 1, 2, ...), every photo taking `state`'s `hidden`,
	 * `styles` and `healed` (the lead's own by default): one UPDATE of the
	 * lead and the angles, which the deferrable unique and the guard trigger
	 * judge at its end, so a new lead can take over from the old one, or two
	 * angles swap places, in one statement.
	 */
	private async setAngles(
		trx: QueryClientContract,
		tenant: TenantRef,
		lead: ArtistWorkPhoto,
		angles: readonly ArtistWorkPhoto[],
		state: Pick<ArtistWorkPhoto, "hidden" | "styles" | "healed"> = lead,
	): Promise<void> {
		const ids = [lead.id, ...angles.map(({ id }) => id)];
		const places = angles.map((angle, index) => [angle.id, index + 1]);
		await trx.rawQuery(
			`update artist_work_photos set
				lead_photo_id = case when id = ? then null else ?::uuid end,
				angle_position = case id ${places.map(() => "when ? then ?::smallint").join(" ")} else null end,
				hidden = ?, styles = ?::varchar[], healed = ?, updated_at = now()
			where tenant_id = ? and id in (${ids.map(() => "?").join(", ")})`,
			[
				lead.id,
				lead.id,
				...places.flat(),
				state.hidden,
				[...state.styles],
				state.healed,
				tenant.id,
				...ids,
			],
		);
	}

	/** Copies a lead's `hidden`, `styles` and `healed` onto its angles (none to copy is a no-op). */
	private async copyToAngles(
		trx: QueryClientContract,
		tenant: TenantRef,
		lead: ArtistWorkPhoto,
	): Promise<void> {
		await trx.rawQuery(
			`update artist_work_photos set hidden = ?, styles = ?::varchar[], healed = ?, updated_at = now()
			where tenant_id = ? and lead_photo_id = ?`,
			[lead.hidden, [...lead.styles], lead.healed, tenant.id, lead.id],
		);
	}

	/** The angles after `place` move one place earlier, after one left the tattoo. */
	private async closeGap(
		trx: QueryClientContract,
		tenant: TenantRef,
		leadId: string,
		place: number,
	): Promise<void> {
		await trx.rawQuery(
			`update artist_work_photos set angle_position = angle_position - 1, updated_at = now()
			where tenant_id = ? and lead_photo_id = ? and angle_position > ?`,
			[tenant.id, leadId, place],
		);
	}

	/**
	 * The photo's row, read again under the artist's lock: gone meanwhile is
	 * a 404, and so is one moved to another artist meanwhile (Studio OS,
	 * `reassign`), whose artist the caller did not lock.
	 */
	private async lockedPhoto(
		trx: QueryClientContract,
		tenant: TenantRef,
		photo: ArtistWorkPhoto,
	): Promise<ArtistWorkPhoto> {
		const live = await ArtistWorkPhoto.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", photo.id)
			.firstOrFail();
		if (live.artistId !== photo.artistId) {
			throw new lucidErrors.E_ROW_NOT_FOUND(ArtistWorkPhoto);
		}
		return live;
	}

	/**
	 * Locks these artists' live rows `FOR UPDATE` in id order, for the rest
	 * of the caller's transaction (a released savepoint keeps its locks), each
	 * one `editor`'s to edit, skipping one that isn't (its photos then fail
	 * on their own). The portfolio's bulk change takes them all first, so two
	 * bulk changes, or one and a `reassign` (which locks in id order too),
	 * never wait for each other in opposite orders.
	 */
	async lockArtists(
		tenant: TenantRef,
		editor: ProfileEditor,
		artistIds: readonly string[],
	): Promise<void> {
		const ids = [...new Set(artistIds)].sort();
		if (ids.length === 0) return;
		await withTransaction(async (trx) => {
			for (const id of ids) {
				try {
					await this.artists.lockEditable(trx, tenant, editor, id);
				} catch (error) {
					if (!(error instanceof lucidErrors.E_ROW_NOT_FOUND)) throw error;
				}
			}
		});
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
