import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@adonisjs/core/http";
import type { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PublicationService from "#modules/discovery/services/publication_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import { TAKEDOWN_REASONS } from "#modules/reviews/rules";
import type { OperatorItem } from "#modules/reviews/services/review_operator_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ReviewOperatorService from "#modules/reviews/services/review_operator_service";
import Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient, withDbContext } from "#services/db_context";

/** Live items the studio page lists; `?more=1` raises it. */
export const LIVE_ITEMS = 20;
export const MORE_LIVE_ITEMS = 200;

/**
 * The live items to list, from one more than the view's limit. The default
 * view offers "Show more" when items remain; the `?more=1` view never does
 * and says so when it cut the list.
 */
export function liveWindow<T>(
	items: T[],
	more: boolean,
	limits = { normal: LIVE_ITEMS, more: MORE_LIVE_ITEMS },
) {
	const limit = more ? limits.more : limits.normal;
	const over = items.length > limit;
	return {
		limit,
		live: items.slice(0, limit),
		hasMore: over && !more,
		truncated: over && more,
	};
}

/** Dates on admin pages are UTC. */
const at = (value: DateTime) =>
	value.toUTC().toFormat("yyyy-MM-dd HH:mm 'UTC'");

const takedownProps = (takedown: { at: DateTime; note: string | null }) => ({
	atText: at(takedown.at),
	note: takedown.note,
});

const itemProps = (item: OperatorItem) => ({
	kind: item.kind,
	id: item.id,
	atText: at(item.at),
	shownName: item.shownName,
	rating: item.rating,
	excerpt: item.excerpt,
	takedown: item.takedown
		? { ...takedownProps(item.takedown), reason: item.takedown.reason }
		: null,
});

/**
 * TattooDrip's operator view of studios (platformAdmin middleware): the
 * list and one studio's read-only moderation state. Studio ids come from
 * `package_tenants()` (ids only) and each studio is read in its own
 * context, so no query here crosses tenants.
 */
@inject()
export default class AdminStudiosController {
	constructor(
		private publication: PublicationService,
		private reviews: ReviewOperatorService,
		private tenancy: TenancyService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id from public.package_tenants()",
		);
		const open = new Map<string, number>();
		for (const report of await this.reviews.openReports()) {
			open.set(report.tenantId, (open.get(report.tenantId) ?? 0) + 1);
		}
		const found: {
			createdAt: DateTime;
			id: string;
			row: {
				slug: string;
				name: string;
				type: Tenant["type"];
				discoverStatus: string;
				takenDown: boolean;
				openReports: number;
			};
		}[] = [];
		for (const { tenant_id: tenantId } of rows as { tenant_id: string }[]) {
			await withDbContext({ tenantId }, async () => {
				const tenant = await Tenant.find(tenantId);
				if (!tenant) return;
				const overview = await this.publication.overview(tenant);
				found.push({
					createdAt: tenant.createdAt,
					id: tenant.id,
					row: {
						slug: tenant.slug,
						name: tenant.name,
						type: tenant.type,
						discoverStatus: overview.status,
						takenDown: tenant.discoverySuspendedAt !== null,
						openReports: open.get(tenant.id) ?? 0,
					},
				});
			});
		}
		found.sort(
			(a, b) =>
				a.createdAt.toMillis() - b.createdAt.toMillis() ||
				a.id.localeCompare(b.id),
		);
		return ctx.inertia.render("admin/studios/index", {
			studios: found.map(({ row }) => row),
		});
	}

	async show(ctx: HttpContext) {
		const slug = ctx.params.slug as string;
		const tenantId = await this.tenancy.tenantIdForSlug(slug);
		const tenant = tenantId
			? await withDbContext({ tenantId }, () => Tenant.find(tenantId))
			: null;
		if (!tenant) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		if (tenant.slug !== slug) {
			return ctx.response.redirect().toRoute("admin.studios.show", {
				slug: tenant.slug,
			});
		}

		const status = await this.publication.operatorStatus(slug);
		const photos = await this.publication.operatorPhotos(slug);
		const more = ctx.request.input("more") === "1";
		// One past the limit tells whether more exist.
		const items = await this.reviews.studioItems(tenant.id, {
			limit: (more ? MORE_LIVE_ITEMS : LIVE_ITEMS) + 1,
		});
		const window = liveWindow(items.live, more);
		const reports = (await this.reviews.openReports()).filter(
			(report) => report.tenantId === tenant.id,
		);
		return ctx.inertia.render("admin/studios/show", {
			studio: { slug: tenant.slug, name: tenant.name },
			discover: {
				status: status.status,
				optedIn: status.optedIn,
				publiclyVisible: status.publiclyVisible,
				takedown: status.takedown ? takedownProps(status.takedown) : null,
			},
			photos: await Promise.all(
				photos.map(async (photo) => ({
					id: photo.id,
					artistName: photo.artistName,
					thumbnailUrl: await this.images.urlFor(
						"artist_work_photo",
						photo.imageKey,
						tenant,
						THUMBNAIL_WIDTH,
					),
					takedown: photo.takedown ? takedownProps(photo.takedown) : null,
				})),
			),
			takenDown: items.takenDown.map(itemProps),
			live: window.live.map(itemProps),
			hasMore: window.hasMore,
			truncated: window.truncated,
			reports: reports.map((report) => ({
				reviewId: report.reviewId,
				reportedText: at(report.reportedAt),
				reason: report.reason,
				note: report.note,
				rating: report.rating,
				shownName: report.shownName,
				body: report.body,
			})),
			takedownReasons: [...TAKEDOWN_REASONS],
		});
	}
}
