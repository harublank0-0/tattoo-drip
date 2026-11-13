import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	TattooChangedError,
	TattooGroupError,
	WorkPhotoLimitError,
} from "#modules/artists/errors";
import type Artist from "#modules/artists/models/artist";
import type ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import {
	type BulkFailure,
	bulkSummary,
	groupSummary,
	oneByTattoo,
	PORTFOLIO_PAGE_SIZE,
	parsePortfolioQuery,
	portfolioBack,
} from "#modules/artists/portfolio";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService, {
	MAX_WORK_PHOTOS,
	stillOf,
} from "#modules/artists/services/work_photo_service";
import { knownStyles, TATTOO_STYLES } from "#modules/artists/styles";
import { bulkWorkPhotosValidator } from "#modules/artists/validators/work_photo";
import { ARTWORK_STATE_WORDS } from "#modules/discovery/publication";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PublicationService from "#modules/discovery/services/publication_service";
import { ImageDeleteError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import { VIDEO_PURPOSE } from "#modules/media/services/video_service";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import {
	artworkPageUrl,
	galleryPageUrl,
	pointsAtThisMachine,
} from "#services/storefront_url";

const PURPOSE = "artist_work_photo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The gallery's tile copy: a tile is up to about 300 px wide, so 640 is sharp at 2x. */
const TILE_WIDTH = 640;
/** The details panel's preview: up to about 600 px wide, sharp at 2x. */
const LARGE_WIDTH = 1280;

/** The styles the filter and the forms offer, in the list's order. */
const STYLE_OPTIONS = TATTOO_STYLES.map(({ slug, name }) => ({ slug, name }));

/**
 * The studio's portfolio (Studio OS): every work photo of the artists the
 * member may see, as one gallery. An owner sees every live artist's photos,
 * shown or hidden; an artist sees their own linked profile's and nothing
 * else (TENANT_ROUTE_ROLES lets every member in; this list is the rule). The
 * address holds the search, the filters, the order and the page
 * (parsePortfolioQuery); an artist id that is not one of the member's is
 * ignored, so the address can't reach another studio's or another artist's
 * photos. Photos are uploaded, edited and removed through the work photo
 * routes, which come back here (their `back`, portfolioBack). Reads only
 * through the artists and media services.
 *
 * Angles: a tile is a tattoo, its lead, with its angles in order (one more
 * query for the page, WorkPhotoService.anglesOf), so the count, the filters
 * and the bulk changes are about tattoos; each artist carries both counts,
 * its photos (the room under the 100, angles included) and its tattoos
 * (what the count line says).
 */
@inject()
export default class PortfolioController {
	constructor(
		private artists: ArtistService,
		private photos: WorkPhotoService,
		private images: ImageService,
		private publication: PublicationService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const owner = membership.role === "owner";
		const mine = owner
			? null
			: await this.artists.profileOf(tenant, membership.userId);
		const artists: Artist[] = owner
			? await this.artists.list(tenant)
			: mine
				? [mine]
				: [];

		const query = parsePortfolioQuery(ctx.request.qs());
		const template = storefrontTemplate();
		const artistIds = artists.map(({ id }) => id);
		const artist =
			query.artist !== null && artistIds.includes(query.artist)
				? query.artist
				: null;
		const [found, counts] = await Promise.all([
			this.photos.studioPage(tenant, artist ? [artist] : artistIds, query),
			this.photos.counts(tenant, artistIds),
		]);
		// Angles: the tattoo the details panel follows (`open`, after its main
		// photo changed), when it is no longer on this page.
		const open = await this.openTattoo(
			ctx,
			ctx.request.input("open"),
			found.photos,
		);
		const tiles = open ? [...found.photos, open] : found.photos;
		const angles = await this.photos.anglesOf(
			tenant,
			tiles.map(({ id }) => id),
			"studio",
		);
		const byId = new Map(artists.map((row) => [row.id, row]));
		// Each photo's Discover state (D04), from the same rules as the views.
		const discover = await this.publication.artworkStates(
			tenant,
			artists,
			tiles,
		);

		const shownTiles = await Promise.all(
			tiles.map(async (photo) => {
				const of = byId.get(photo.artistId);
				const { key, width, height } = stillOf(photo);
				const [src, thumbUrl, large, full, variants] = await Promise.all([
					this.images.urlFor(PURPOSE, key, tenant, TILE_WIDTH),
					this.images.urlFor(PURPOSE, key, tenant, THUMBNAIL_WIDTH),
					this.images.urlFor(PURPOSE, key, tenant, LARGE_WIDTH),
					this.images.url(PURPOSE, key, tenant),
					this.images.variants(PURPOSE, key, tenant),
				]);
				return {
					id: photo.id,
					artistId: photo.artistId,
					artistName: of?.name ?? "",
					// Published by the studio; on the page while its artist is shown too.
					published: !photo.hidden,
					shown: !photo.hidden && (of?.visible ?? false),
					pageUrl:
						!photo.hidden && of?.visible
							? artworkPageUrl(template, tenant.slug, photo.id)
							: null,
					alt: photo.alt,
					discover:
						ARTWORK_STATE_WORDS[discover.get(photo.id) ?? "studio_not_listed"],
					discoverState: discover.get(photo.id) ?? "studio_not_listed",
					styles: knownStyles(photo.styles).map(({ slug }) => slug),
					healed: photo.healed,
					width,
					height,
					src,
					srcSet: [
						...variants.map((copy) => `${copy.url} ${copy.width}w`),
						`${full} ${width}w`,
					].join(", "),
					largeUrl: large,
					fullUrl: full,
					// The details panel's list of the tattoo's photos: the 320 px copy.
					thumbUrl,
					addedText: photo.createdAt
						.setZone(tenant.timezone)
						.toFormat("d LLL yyyy"),
					// The tattoo's other photos and videos, in order, for the
					// panel's list: a video with its state (processing, ready or
					// failed with the reason) and, once ready, its poster.
					angles: await Promise.all(
						(angles.get(photo.id) ?? []).map((angle) =>
							this.shownAngle(tenant, angle),
						),
					),
				};
			}),
		);

		const photos = open ? shownTiles.slice(0, -1) : shownTiles;
		const openPhoto = open ? (shownTiles.at(-1) ?? null) : null;

		return ctx.inertia.render("portfolio/index", {
			photos,
			// The tattoo the panel follows when it left this page (null otherwise).
			openPhoto,
			artists: artists.map((row) => ({
				id: row.id,
				name: row.name,
				visible: row.visible,
				photoCount: counts.get(row.id)?.photos ?? 0,
				tattooCount: counts.get(row.id)?.tattoos ?? 0,
			})),
			styleOptions: STYLE_OPTIONS,
			filters: {
				search: query.search,
				artist,
				style: query.style,
				status: query.status,
				healed: query.healed,
				sort: query.sort,
			},
			page: {
				current: found.page,
				last: found.lastPage,
				total: found.total,
				size: PORTFOLIO_PAGE_SIZE,
			},
			maxPhotos: MAX_WORK_PHOTOS,
			isOwner: owner,
			storefront: {
				galleryUrl: galleryPageUrl(template, tenant.slug),
				devHost: pointsAtThisMachine(template),
			},
		});
	}

	/** One of a tattoo's other photos or videos, as the details panel lists it. */
	private async shownAngle(tenant: { id: string }, angle: ArtistWorkPhoto) {
		const video =
			angle.kind === "video"
				? {
						state: (angle.videoState ?? "processing") as
							| "processing"
							| "ready"
							| "failed",
						failure: angle.videoFailure,
						durationMs: angle.videoDurationMs,
					}
				: null;
		const purpose = video ? VIDEO_PURPOSE : PURPOSE;
		const key = angle.imageKey;
		const [thumbUrl, fullUrl] = key
			? await Promise.all([
					this.images.urlFor(purpose, key, tenant, THUMBNAIL_WIDTH),
					this.images.url(purpose, key, tenant),
				])
			: [null, null];
		return {
			id: angle.id,
			kind: video ? ("video" as const) : ("photo" as const),
			alt: angle.alt,
			width: angle.width,
			height: angle.height,
			thumbUrl,
			fullUrl,
			video,
		};
	}

	/**
	 * The tattoo the details panel follows (angles), from the address's
	 * `open`: after a new main photo, the tattoo's id changes and its place in
	 * the order can move it off the page shown, so the write comes back with
	 * `open=<the new lead>` and the panel stays on it. Null when it is on the
	 * page anyway, or when the id is not a photo the member may change
	 * (findEditable: never another studio's or another artist's); an angle's
	 * id gives its lead.
	 */
	private async openTattoo(
		ctx: HttpContext,
		value: unknown,
		shown: readonly ArtistWorkPhoto[],
	): Promise<ArtistWorkPhoto | null> {
		if (typeof value !== "string" || !UUID.test(value)) return null;
		if (shown.some(({ id }) => id === value)) return null;
		const { tenant, membership } = tenantContext(ctx);
		try {
			const { photo } = await this.photos.findEditable(
				tenant,
				membership,
				value,
			);
			if (photo.leadPhotoId === null) return photo;
			if (shown.some(({ id }) => id === photo.leadPhotoId)) return null;
			return (
				await this.photos.findEditable(tenant, membership, photo.leadPhotoId)
			).photo;
		} catch (error) {
			if (error instanceof lucidErrors.E_ROW_NOT_FOUND) return null;
			throw error;
		}
	}

	/**
	 * Publish, unpublish, move to another artist or delete several photos at
	 * once (Studio OS). Each photo is loaded and checked on its own
	 * (WorkPhotoService.findEditable: the tenant's, and its artist the
	 * member's to edit), then changed in its own savepoint, so one that
	 * can't be changed (removed meanwhile, another studio's or artist's id,
	 * the new artist full, files that couldn't be deleted) is counted and
	 * named in the answer and the others still go. Moving needs an owner and
	 * an artist of this studio (ArtistService.findEditable). Goes back to the
	 * portfolio as it was (`back`, portfolioBack).
	 */
	async bulk(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(bulkWorkPhotosValidator);
		if (data.action === "group") return this.group(ctx, data.ids);

		let target: Artist | null = null;
		if (data.action === "reassign") {
			if (membership.role !== "owner") {
				throw fieldError(
					"artistId",
					"Only the studio's owners can move work between artists.",
				);
			}
			if (!data.artistId) {
				throw fieldError("artistId", "Choose the artist to move them to.");
			}
			try {
				target = await this.artists.findEditable(
					tenant,
					membership,
					data.artistId,
				);
			} catch (error) {
				if (!(error instanceof lucidErrors.E_ROW_NOT_FOUND)) throw error;
				throw fieldError("artistId", "Choose an artist of this studio.");
			}
		}

		let done = 0;
		const failures: BulkFailure[] = [];
		// Every photo first, then every artist involved locked in id order, so
		// two bulk changes never take the same artists in opposite orders.
		const found: ArtistWorkPhoto[] = [];
		for (const id of data.ids) {
			try {
				found.push(
					(await this.photos.findEditable(tenant, membership, id)).photo,
				);
			} catch (error) {
				if (!(error instanceof lucidErrors.E_ROW_NOT_FOUND)) throw error;
				failures.push("gone");
			}
		}
		await this.photos.lockArtists(tenant, membership, [
			...found.map(({ artistId }) => artistId),
			...(target ? [target.id] : []),
		]);
		// One change per tattoo: a lead and its own angle are one tattoo.
		for (const photo of oneByTattoo(found)) {
			if (target && photo.artistId === target.id) {
				failures.push("same");
				continue;
			}
			try {
				if (data.action === "publish" || data.action === "unpublish") {
					await this.photos.setHidden(
						tenant,
						membership,
						photo,
						data.action === "unpublish",
					);
				} else if (data.action === "reassign" && target) {
					await this.photos.reassign(tenant, membership, photo, target.id);
				} else {
					// A tattoo goes whole, and only as the page showed it: count
					// every photo that went.
					// A tattoo the page didn't size is one it didn't show as it is.
					const shown = data.sizes?.[photo.id];
					if (shown === undefined) throw new TattooChangedError();
					done +=
						(await this.photos.remove(tenant, membership, photo, {
							scope: "tattoo",
							photos: shown,
						})) - 1;
				}
				done += 1;
			} catch (error) {
				if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
					failures.push("gone");
				} else if (error instanceof WorkPhotoLimitError) {
					failures.push("full");
				} else if (error instanceof ImageDeleteError) {
					failures.push("files");
				} else if (error instanceof TattooChangedError) {
					failures.push("changed");
				} else {
					throw error;
				}
			}
		}

		const summary = bulkSummary(data.action, done, failures, target?.name);
		ctx.session.flash(summary.ok ? "success" : "error", summary.message);
		return backToPortfolio(ctx, tenant.slug);
	}

	/**
	 * "Group as one tattoo" (angles): the selected photos, each loaded and
	 * checked like every bulk change (findEditable), become one tattoo, the
	 * newest its lead (WorkPhotoService.group). All or nothing, unlike the
	 * other bulk changes: one photo that can't be loaded, or a refusal (too
	 * few or too many, two artists, a photo already in a tattoo of several),
	 * groups nothing and says why (groupSummary).
	 */
	private async group(ctx: HttpContext, ids: readonly string[]) {
		const { tenant, membership } = tenantContext(ctx);
		const found: ArtistWorkPhoto[] = [];
		let outcome: Parameters<typeof groupSummary>[0] | null = null;
		for (const id of ids) {
			try {
				found.push(
					(await this.photos.findEditable(tenant, membership, id)).photo,
				);
			} catch (error) {
				if (!(error instanceof lucidErrors.E_ROW_NOT_FOUND)) throw error;
				outcome = "gone";
			}
		}
		if (outcome === null) {
			try {
				const tattoo = await this.photos.group(tenant, membership, found);
				outcome = { photos: tattoo.angles.length + 1 };
			} catch (error) {
				if (error instanceof TattooGroupError) outcome = error.reason;
				else if (error instanceof lucidErrors.E_ROW_NOT_FOUND) outcome = "gone";
				else throw error;
			}
		}
		const summary = groupSummary(outcome);
		ctx.session.flash(summary.ok ? "success" : "error", summary.message);
		return backToPortfolio(ctx, tenant.slug);
	}
}

/** Goes back to the portfolio as it was (`back`), or to its first page. */
function backToPortfolio(ctx: HttpContext, slug: string) {
	const back =
		portfolioBack(ctx.request.input("back"), slug) ?? `/t/${slug}/portfolio`;
	return ctx.response.redirect().withQs(false).toPath(back);
}

function fieldError(field: string, message: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule: "bulk" }]);
}
