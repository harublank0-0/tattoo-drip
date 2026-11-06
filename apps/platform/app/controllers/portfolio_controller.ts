import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { WorkPhotoLimitError } from "#modules/artists/errors";
import type Artist from "#modules/artists/models/artist";
import {
	type BulkFailure,
	bulkSummary,
	PORTFOLIO_PAGE_SIZE,
	parsePortfolioQuery,
	portfolioBack,
} from "#modules/artists/portfolio";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService, {
	MAX_WORK_PHOTOS,
} from "#modules/artists/services/work_photo_service";
import { knownStyles, TATTOO_STYLES } from "#modules/artists/styles";
import { bulkWorkPhotosValidator } from "#modules/artists/validators/work_photo";
import { ImageDeleteError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import {
	artworkPageUrl,
	galleryPageUrl,
	pointsAtThisMachine,
} from "#services/storefront_url";

const PURPOSE = "artist_work_photo";

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
 */
@inject()
export default class PortfolioController {
	constructor(
		private artists: ArtistService,
		private photos: WorkPhotoService,
		private images: ImageService,
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
		const byId = new Map(artists.map((row) => [row.id, row]));

		const photos = await Promise.all(
			found.photos.map(async (photo) => {
				const of = byId.get(photo.artistId);
				const [src, large, full, variants] = await Promise.all([
					this.images.urlFor(PURPOSE, photo.imageKey, tenant, TILE_WIDTH),
					this.images.urlFor(PURPOSE, photo.imageKey, tenant, LARGE_WIDTH),
					this.images.url(PURPOSE, photo.imageKey, tenant),
					this.images.variants(PURPOSE, photo.imageKey, tenant),
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
					styles: knownStyles(photo.styles).map(({ slug }) => slug),
					healed: photo.healed,
					width: photo.width,
					height: photo.height,
					src,
					srcSet: [
						...variants.map(({ url, width }) => `${url} ${width}w`),
						`${full} ${photo.width}w`,
					].join(", "),
					largeUrl: large,
					fullUrl: full,
					addedText: photo.createdAt
						.setZone(tenant.timezone)
						.toFormat("d LLL yyyy"),
				};
			}),
		);

		return ctx.inertia.render("portfolio/index", {
			photos,
			artists: artists.map((row) => ({
				id: row.id,
				name: row.name,
				visible: row.visible,
				photoCount: counts.get(row.id) ?? 0,
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
		for (const id of data.ids) {
			try {
				const { photo } = await this.photos.findEditable(
					tenant,
					membership,
					id,
				);
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
					await this.photos.remove(tenant, membership, photo);
				}
				done += 1;
			} catch (error) {
				if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
					failures.push("gone");
				} else if (error instanceof WorkPhotoLimitError) {
					failures.push("full");
				} else if (error instanceof ImageDeleteError) {
					failures.push("files");
				} else {
					throw error;
				}
			}
		}

		const summary = bulkSummary(data.action, done, failures, target?.name);
		ctx.session.flash(summary.ok ? "success" : "error", summary.message);
		const back =
			portfolioBack(ctx.request.input("back"), tenant.slug) ??
			`/t/${tenant.slug}/portfolio`;
		return ctx.response.redirect().withQs(false).toPath(back);
	}
}

function fieldError(field: string, message: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule: "bulk" }]);
}
