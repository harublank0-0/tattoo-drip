import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	mayEdit,
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import type { WorkCursor } from "#modules/artists/work_cursor";
import { FlashInUseError, FlashLimitError } from "#modules/flash/errors";
import FlashDesign from "#modules/flash/models/flash_design";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, dbClient, withTransaction } from "#services/db_context";
import { isForeignKeyViolation } from "#services/db_errors";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

/**
 * The most flash designs an artist offers. The database does not hold this
 * limit: the count under the artist's row lock (`add`) is the only guard.
 */
export const MAX_FLASH_DESIGNS = 100;

const PURPOSE = "flash_design";
const INQUIRY_KEY = "inquiries_flash_design_fk";
const PROJECT_KEY = "tattoo_projects_flash_design_fk";

/**
 * Keeps a design only while its artist is, in this very statement, a live
 * visible artist of the tenant (one `?`: the tenant's id). The public reads
 * get artist ids that were read earlier, and under READ COMMITTED an artist
 * can be hidden or deleted between that read and the designs'; asking again
 * in the same SQL means a cacheable response never carries a design of an
 * artist who is no longer shown. `artists` is soft-deleted, so `deleted_at`
 * is said here (the model's scope is a fetch hook and does not reach a
 * subquery).
 */
const VISIBLE_ARTIST = `exists (
	select 1 from artists
	where artists.id = flash_designs.artist_id
		and artists.tenant_id = ?
		and artists.visible
		and artists.deleted_at is null
)`;

/** What a new design needs besides the picture; `price` is in paisa, null for none. */
export type NewFlashDesign = {
	name: string;
	size: string;
	price: number | null;
};

/** What an owner or an artist can change on a design: its words, price and whether it is shown. */
export type FlashDetails = NewFlashDesign & { hidden: boolean };

/** What a page of designs shows: these artists' shown designs. */
export type FlashFilter = { artistIds: readonly string[] };

/**
 * The flash designs of an artist (TAT-129): up to 100, newest first
 * (`created_at desc, id desc`, nothing reorders them), each a picture, a
 * name, a size and an optional price. Every call is scoped to the tenant.
 * Who may change an artist's designs is ArtistService.findEditable (an owner
 * any live artist's, an artist their own linked profile's), and every write
 * checks that again under the artist's row lock, the lock ArtistService.save
 * takes too. Pictures are stored through ImageService and deleted here.
 *
 * A design is deleted for good, row and files, like a work photo, except
 * that an inquiry or a project naming it keeps it (their keys are NO
 * ACTION): `remove` then throws FlashInUseError and the studio hides the
 * design instead. A hidden design stays in the dashboard and in what the
 * requests name; the public reads (`page`, `findShown`, `artistsWithDesigns`)
 * show shown designs of visible artists only: the caller narrows them to the
 * artist ids it read, and the same query checks again that each artist is
 * still visible and live (VISIBLE_ARTIST), so an id list that went stale
 * shows nothing of an artist hidden or deleted since.
 */
@inject()
export default class FlashService {
	constructor(
		private images: ImageService,
		private artists: ArtistService,
	) {}

	/** The artist's designs, hidden ones too, newest first. */
	async list(tenant: TenantRef, artist: Artist): Promise<FlashDesign[]> {
		assertOwnedBy(tenant, artist);
		return FlashDesign.query()
			.where("tenant_id", tenant.id)
			.where("artist_id", artist.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
	}

	/**
	 * The design and its artist, if `editor` may change them: the design is
	 * the tenant's, and the artist is live and `editor`'s to edit
	 * (ArtistService.findEditable). Another tenant's design, a deleted
	 * artist's, another artist's for an artist member and an unknown id all
	 * throw E_ROW_NOT_FOUND (a 404), so callers can't tell them apart.
	 */
	async findEditable(
		tenant: TenantRef,
		editor: ProfileEditor,
		designId: string,
	): Promise<{ design: FlashDesign; artist: Artist }> {
		const design = await FlashDesign.query()
			.where("tenant_id", tenant.id)
			.where("id", designId)
			.firstOrFail();
		const artist = await this.artists.findEditable(
			tenant,
			editor,
			design.artistId,
		);
		return { design, artist };
	}

	/**
	 * Adds a design, dated now, so it is the artist's newest and shown.
	 * Throws FlashLimitError when the artist already offers 100 (also when
	 * two uploads race for the last place: the second is refused under the
	 * lock and its file is deleted) and InvalidImageError for a file we can't
	 * accept.
	 *
	 * The order matters, as for a work photo. The editor check and the
	 * unlocked count refuse a profile that isn't theirs or a full set before
	 * any decode; the file is stored inside the transaction with its cleanup
	 * registered at once and before the row lock (so the lock is not held
	 * while the image is processed); the lock then serializes uploads, and
	 * the count under it is the one that counts.
	 */
	async add(
		tenant: TenantRef,
		editor: ProfileEditor,
		artist: Artist,
		upload: Upload,
		details: NewFlashDesign,
	): Promise<FlashDesign> {
		assertOwnedBy(tenant, artist);
		if (!mayEdit(editor, artist.userId)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
		}
		if ((await this.countDesigns(tenant, artist.id)) >= MAX_FLASH_DESIGNS) {
			throw new FlashLimitError();
		}
		return withTransaction(async (trx) => {
			const stored = await this.images.store(upload, {
				tenant,
				purpose: PURPOSE,
			});
			afterRollback(() => this.images.delete(PURPOSE, stored.key));
			await this.artists.lockEditable(trx, tenant, editor, artist.id);
			// Again under the lock: another upload may have landed meanwhile.
			const count = await this.countDesigns(tenant, artist.id, trx);
			if (count >= MAX_FLASH_DESIGNS) throw new FlashLimitError();
			return FlashDesign.create(
				{
					tenantId: tenant.id,
					artistId: artist.id,
					imageKey: stored.key,
					width: stored.width,
					height: stored.height,
					name: details.name.trim(),
					size: details.size.trim(),
					price: details.price,
					currency: "NPR",
					hidden: false,
				},
				{ client: trx },
			);
		});
	}

	/**
	 * Saves the design's name, size, price and whether it is hidden, in one
	 * save, from a fresh read under the artist's lock. The picture never
	 * changes: a new picture is a new design.
	 */
	async update(
		tenant: TenantRef,
		editor: ProfileEditor,
		design: FlashDesign,
		details: FlashDetails,
	): Promise<FlashDesign> {
		assertDesignOf(tenant, design);
		return withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, design.artistId);
			const live = await this.lockedDesign(trx, tenant, design);
			live.merge({
				name: details.name.trim(),
				size: details.size.trim(),
				price: details.price,
				hidden: details.hidden,
			});
			await live.save();
			return live;
		});
	}

	/**
	 * Deletes the design for good: under the artist's lock the row goes
	 * first, in its own savepoint, so a design that a request or a project
	 * names (the database's `NO ACTION` keys) becomes FlashInUseError before
	 * any file is touched. Then the files and every copy are deleted; if any
	 * cannot be, this throws ImageDeleteError and the row delete rolls back,
	 * so the owner can try again (a missing file counts as deleted, so a
	 * retry finishes the job). A design a client asked to take down must not
	 * stay fetchable while the studio is told it is gone.
	 */
	async remove(
		tenant: TenantRef,
		editor: ProfileEditor,
		design: FlashDesign,
	): Promise<void> {
		assertDesignOf(tenant, design);
		await withTransaction(async (trx) => {
			await this.artists.lockEditable(trx, tenant, editor, design.artistId);
			const live = await this.lockedDesign(trx, tenant, design);
			try {
				await withTransaction(() => live.delete());
			} catch (error) {
				if (
					isForeignKeyViolation(error, INQUIRY_KEY) ||
					isForeignKeyViolation(error, PROJECT_KEY)
				) {
					throw new FlashInUseError();
				}
				throw error;
			}
			await this.images.deleteOrThrow(PURPOSE, live.imageKey);
		});
	}

	/**
	 * One page of the shown designs of `filter.artistIds`, newest first
	 * (`created_at desc, id desc`), starting after the cursor `after`. The
	 * caller passes the ids of artists it may show; only those still visible
	 * and live in this query count (VISIBLE_ARTIST); no query for []. `next`
	 * is the cursor of the last design
	 * returned when more remain, else null: one more is read to know that.
	 * The cursor's time is read from and compared in the database, as text
	 * with its microseconds (see WorkCursor).
	 */
	async page(
		tenant: TenantRef,
		filter: FlashFilter,
		after: WorkCursor | null,
		limit: number,
	): Promise<{ designs: FlashDesign[]; next: WorkCursor | null }> {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error(`A page needs a limit of 1 or more, got ${limit}`);
		}
		if (filter.artistIds.length === 0) return { designs: [], next: null };
		const query = FlashDesign.query()
			.select("*")
			.select(
				dbClient().raw(
					`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at`,
				),
			)
			.where("tenant_id", tenant.id)
			.where("hidden", false)
			.whereIn("artist_id", [...filter.artistIds])
			.whereRaw(VISIBLE_ARTIST, [tenant.id]);
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
		const designs = rows.slice(0, limit);
		const last = designs[limit - 1];
		const next =
			rows.length > limit
				? { at: String(last.$extras.cursor_at), id: last.id }
				: null;
		return { designs, next };
	}

	/**
	 * Which of these artists, still visible and live in this query, have a
	 * shown design (the filter a page offers). One query; none for [].
	 */
	async artistsWithDesigns(
		tenant: TenantRef,
		artistIds: readonly string[],
	): Promise<Set<string>> {
		if (artistIds.length === 0) return new Set();
		const rows = await FlashDesign.query()
			.where("tenant_id", tenant.id)
			.where("hidden", false)
			.whereIn("artist_id", [...artistIds])
			.whereRaw(VISIBLE_ARTIST, [tenant.id])
			.distinct("artist_id");
		return new Set(rows.map((row) => row.artistId));
	}

	/**
	 * The design when it is shown and its artist is one of `artistIds` and
	 * still visible and live in this query, else null.
	 */
	async findShown(
		tenant: TenantRef,
		designId: string,
		artistIds: readonly string[],
	): Promise<FlashDesign | null> {
		if (artistIds.length === 0) return null;
		return FlashDesign.query()
			.where("tenant_id", tenant.id)
			.where("id", designId)
			.where("hidden", false)
			.whereIn("artist_id", [...artistIds])
			.whereRaw(VISIBLE_ARTIST, [tenant.id])
			.first();
	}

	/**
	 * Holds the design for a request about to name it: the artist's row, then
	 * the design's own, each `FOR KEY SHARE` until the transaction ends (the
	 * locks the request's foreign keys take anyway, taken before the slow work
	 * is over). It returns the design when it is still shown and its artist is
	 * still visible, else null. An owner removing the design (`remove`) then
	 * waits for the request and finds it named (FlashInUseError), or has
	 * removed it first and the request finds nothing. Artist first, like
	 * `remove`, so neither waits for the other while holding what it needs.
	 * Call it inside the request's transaction.
	 */
	async holdShown(
		trx: QueryClientContract,
		tenant: TenantRef,
		artistId: string,
		designId: string,
	): Promise<FlashDesign | null> {
		if (!(await this.artists.holdVisible(trx, tenant, artistId))) return null;
		const query = FlashDesign.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", designId)
			.where("artist_id", artistId)
			.where("hidden", false);
		query.knexQuery.forKeyShare();
		return query.first();
	}

	/**
	 * Any of the tenant's designs by id, hidden ones too: what the dashboard's
	 * inbox and pages show for the design a request or a project names. No
	 * query for [].
	 */
	async forIds(
		tenant: TenantRef,
		ids: readonly string[],
	): Promise<Map<string, FlashDesign>> {
		const found = new Map<string, FlashDesign>();
		if (ids.length === 0) return found;
		const rows = await FlashDesign.query()
			.where("tenant_id", tenant.id)
			.whereIn("id", [...ids]);
		for (const row of rows) found.set(row.id, row);
		return found;
	}

	/** How many designs the artist has now. A hook so a test can stage a racing upload. */
	protected async countDesigns(
		tenant: TenantRef,
		artistId: string,
		client?: QueryClientContract,
	): Promise<number> {
		const [row] = await FlashDesign.query(client ? { client } : undefined)
			.where("tenant_id", tenant.id)
			.where("artist_id", artistId)
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** The design's row, read again under the artist's lock: gone meanwhile is a 404. */
	private async lockedDesign(
		trx: QueryClientContract,
		tenant: TenantRef,
		design: FlashDesign,
	): Promise<FlashDesign> {
		return FlashDesign.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", design.id)
			.firstOrFail();
	}
}

/** A caller bug, not a user error: artists come from findEditable(tenant, editor, id). */
function assertOwnedBy(tenant: TenantRef, artist: Artist) {
	if (artist.tenantId !== tenant.id) {
		throw new Error(`Artist ${artist.id} belongs to another tenant`);
	}
}

function assertDesignOf(tenant: TenantRef, design: FlashDesign) {
	if (design.tenantId !== tenant.id) {
		throw new Error(`Flash design ${design.id} belongs to another tenant`);
	}
}
