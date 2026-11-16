import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { STATUS_WORDS } from "#modules/discovery/publication";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PublicationService, {
	OperatorTargetError,
} from "#modules/discovery/services/publication_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import { VIDEO_PURPOSE } from "#modules/media/services/video_service";
import { entitlementText } from "#modules/packages/entitlement";
import type PilotGrant from "#modules/packages/models/pilot_grant";
import { PACKAGE_KEYS, PACKAGES } from "#modules/packages/packages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import EntitlementService from "#modules/packages/services/entitlement_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PilotGrantService, {
	PilotGrantError,
} from "#modules/packages/services/pilot_grant_service";
import { packageEnforcement } from "#modules/packages/settings";
import { formatDay } from "#modules/projects/quotes";
import {
	reportReasonLabel,
	TAKEDOWN_KIND_LABELS,
	TAKEDOWN_LABELS,
	TAKEDOWN_REASON_OPTIONS,
} from "#modules/reviews/rules";
import type { OperatorItem } from "#modules/reviews/services/review_operator_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ReviewOperatorService from "#modules/reviews/services/review_operator_service";
import Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
import { forEachLiveStudio } from "#services/live_studios";
import {
	discoverReasonValidator,
	pilotGrantValidator,
} from "#validators/admin";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who a grant from the admin pages is recorded as: the admin's account name,
 * else their email, within the service's 100 characters.
 */
export function operatorName(user: {
	fullName: string | null;
	email: string;
}): string {
	return (user.fullName?.trim() || user.email).slice(0, 100);
}

/** A day on admin pages, as the Billing page writes it (UTC). */
const dayText = (value: DateTime) =>
	formatDay(value.toUTC().toISODate() as string);

const grantRow = (grant: PilotGrant) => ({
	packageName: PACKAGES[grant.package].name,
	untilText: dayText(grant.endsAt),
	note: grant.note,
	grantedBy: grant.grantedBy,
	grantedText: at(grant.startsAt),
});

/** Dates on admin pages are UTC. */
const at = (value: DateTime) =>
	value.toUTC().toFormat("yyyy-MM-dd HH:mm 'UTC'");

const takedownProps = (takedown: { at: DateTime; note: string | null }) => ({
	atText: at(takedown.at),
	note: takedown.note,
});

/** What the studio list calls each business type. */
const TYPE_LABELS: Record<string, string> = {
	studio: "Studio",
	independent: "Independent artist",
};

const itemProps = (item: OperatorItem) => ({
	kind: item.kind,
	kindLabel: TAKEDOWN_KIND_LABELS[item.kind],
	id: item.id,
	atText: at(item.at),
	shownName: item.shownName,
	rating: item.rating,
	excerpt: item.excerpt,
	takedown: item.takedown
		? {
				...takedownProps(item.takedown),
				reasonLabel: TAKEDOWN_LABELS[item.takedown.reason],
			}
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
		private pilots: PilotGrantService,
		private entitlements: EntitlementService,
	) {}

	async index(ctx: HttpContext) {
		const open = new Map<string, number>();
		for (const report of await this.reviews.openReports()) {
			open.set(report.tenantId, (open.get(report.tenantId) ?? 0) + 1);
		}
		const studios = await forEachLiveStudio(async (tenant) => ({
			slug: tenant.slug,
			name: tenant.name,
			typeLabel: TYPE_LABELS[tenant.type] ?? tenant.type,
			// A taken-down listing's status is "Removed by TattooDrip".
			discoverStatusLabel:
				STATUS_WORDS[(await this.publication.overview(tenant)).status].label,
			openReports: open.get(tenant.id) ?? 0,
		}));
		return ctx.inertia.render("admin/studios/index", {
			studios: studios.map(({ value }) => value),
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
			pilot: await this.pilotProps(tenant),
			discover: {
				statusLabel: STATUS_WORDS[status.status].label,
				optedIn: status.optedIn,
				publiclyVisible: status.publiclyVisible,
				takedown: status.takedown ? takedownProps(status.takedown) : null,
			},
			photos: await Promise.all(
				photos.map(async (photo) => ({
					id: photo.id,
					artistName: photo.artistName,
					kind: photo.kind,
					// A video's poster is under the video's purpose, as the portfolio reads it.
					thumbnailUrl: photo.imageKey
						? await this.images.urlFor(
								photo.kind === "video" ? VIDEO_PURPOSE : "artist_work_photo",
								photo.imageKey,
								tenant,
								THUMBNAIL_WIDTH,
							)
						: null,
					placeholder: photo.imageKey
						? null
						: photo.videoState === "failed"
							? "Video failed"
							: "Video processing",
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
				reasonLabel: reportReasonLabel(report.reason),
				note: report.note,
				rating: report.rating,
				shownName: report.shownName,
				body: report.body,
			})),
			takedownReasons: TAKEDOWN_REASON_OPTIONS,
		});
	}

	async suspendDiscover(ctx: HttpContext) {
		const { reason } = await ctx.request.validateUsing(discoverReasonValidator);
		return this.operate(ctx, async (slug) => {
			await this.publication.suspendStudio(slug, reason);
			return "The listing is off Discover. The studio page and bookings are unchanged. Public caches can keep it for up to two minutes.";
		});
	}

	async restoreDiscover(ctx: HttpContext) {
		return this.operate(ctx, async (slug) => {
			await this.publication.restoreStudio(slug);
			return this.liftedMessage(slug);
		});
	}

	async suspendPhoto(ctx: HttpContext) {
		const { reason } = await ctx.request.validateUsing(discoverReasonValidator);
		return this.operate(ctx, async (slug, photoId) => {
			await this.publication.suspendPhoto(slug, photoId, reason);
			return "The photo is off Discover. It stays on the studio page. Public caches can keep it for up to two minutes.";
		});
	}

	async restorePhoto(ctx: HttpContext) {
		return this.operate(ctx, async (slug, photoId) => {
			await this.publication.restorePhoto(slug, photoId);
			return this.liftedMessage(slug);
		});
	}

	/** Gives the studio a pilot grant from its admin page (the same service as `packages:pilot`). */
	async grantPilot(ctx: HttpContext) {
		const input = await ctx.request.validateUsing(pilotGrantValidator);
		return this.pilotAction(ctx, async (slug) => {
			const endsAt = DateTime.fromISO(input.until, { zone: "utc" });
			if (!endsAt.isValid) {
				throw new PilotGrantError("Give an until date as YYYY-MM-DD.");
			}
			const grant = await this.pilots.grant(slug, {
				package: input.package,
				endsAt,
				note: input.note,
				grantedBy: operatorName(ctx.auth.getUserOrFail()),
			});
			const studio = await withDbContext({ tenantId: grant.tenantId }, () =>
				Tenant.findOrFail(grant.tenantId),
			);
			return `${studio.name} is a ${PACKAGES[input.package].name} pilot until ${dayText(endsAt)}.`;
		});
	}

	/** Ends the studio's running pilot grant now. */
	async endPilot(ctx: HttpContext) {
		return this.pilotAction(ctx, async (slug) => {
			await this.pilots.end(slug);
			return "The pilot grant has ended. The studio's package now follows its payments.";
		});
	}

	/** The Package section: the studio's state in the Billing page's words, its running and past grants. */
	private pilotProps(tenant: Tenant) {
		return withDbContext({ tenantId: tenant.id }, async () => {
			const now = DateTime.utc();
			const grants = await this.pilots.forTenant(tenant);
			const running = grants.find(
				(grant) => grant.startsAt <= now && grant.endsAt > now,
			);
			return {
				stateText: entitlementText(
					await this.entitlements.forLoaded(tenant, now),
					dayText,
					packageEnforcement() === "enforce",
				),
				running: running ? grantRow(running) : null,
				past: grants
					.filter((grant) => grant.endsAt <= now)
					.reverse()
					.map(grantRow),
				packages: PACKAGE_KEYS.map((key) => ({
					value: key,
					label: PACKAGES[key].name,
				})),
			};
		});
	}

	/** Runs a pilot grant action; the service's refusals become an error flash. */
	private async pilotAction(
		ctx: HttpContext,
		run: (slug: string) => Promise<string>,
	) {
		try {
			ctx.session.flash("success", await run(ctx.params.slug as string));
		} catch (error) {
			if (!(error instanceof PilotGrantError)) throw error;
			ctx.session.flash("error", error.message);
		}
		return ctx.response.redirect().back();
	}

	private async liftedMessage(slug: string) {
		const status = await this.publication.operatorStatus(slug);
		return `Takedown lifted. The listing is now: ${STATUS_WORDS[status.status].label}${status.optedIn ? "" : " (the owner's listing is off)"}.`;
	}

	/** Runs a takedown action; the service's refusals become an error flash. */
	private async operate(
		ctx: HttpContext,
		run: (slug: string, photoId: string) => Promise<string>,
	) {
		try {
			const photoId = ctx.params.photo as string | undefined;
			// A malformed id can't name a photo; Postgres would reject it as a 500.
			if (photoId !== undefined && !UUID.test(photoId)) {
				throw new OperatorTargetError("That studio has no photo with this id.");
			}
			ctx.session.flash(
				"success",
				await run(ctx.params.slug as string, photoId as string),
			);
		} catch (error) {
			if (!(error instanceof OperatorTargetError)) throw error;
			ctx.session.flash("error", error.message);
		}
		return ctx.response.redirect().back();
	}
}
