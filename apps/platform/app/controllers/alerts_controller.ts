import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	alertCopy,
	alertTarget,
	alertTimeText,
} from "#modules/notifications/alerts";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AlertService from "#modules/notifications/services/alert_service";

/**
 * Each member's own alerts (TAT-52), owners and artists. Every read and
 * write goes through AlertService with the member's user id, so another
 * member's or another studio's alert is a 404.
 */
@inject()
export default class AlertsController {
	constructor(private alerts: AlertService) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const page = Math.max(
			1,
			Number.parseInt(String(ctx.request.qs().page ?? 1), 10) || 1,
		);
		const { alerts, total, lastPage } = await this.alerts.list(
			tenant,
			membership.userId,
			page,
		);
		const isOwner = membership.role === "owner";

		return ctx.inertia.render("alerts/index", {
			alerts: alerts.map((alert) => ({
				id: alert.id,
				...alertCopy(alert.kind, isOwner),
				whenText: alertTimeText(alert.createdAt, tenant.timezone),
				unread: alert.readAt === null,
			})),
			unread: await this.alerts.unreadCount(tenant, membership.userId),
			page: { current: page, last: lastPage, total },
		});
	}

	/**
	 * Marks the alert read and goes where it points: never a URL from the
	 * request. A target with a fragment (a deposit proof's Payments card,
	 * TAT-88) is a location visit for the dashboard's Inertia requests: an
	 * Inertia visit follows a redirect without its fragment, so the page
	 * would open at the top; a full load of the URL keeps it.
	 */
	async open(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const alert = await this.alerts.open(
			tenant,
			membership.userId,
			ctx.params.id,
		);
		const target = alertTarget(alert, membership.role);
		if (!target) {
			return ctx.response
				.redirect()
				.toRoute("tenant.alerts.index", { tenant: tenant.slug });
		}
		const params = { tenant: tenant.slug, id: target.id };
		if ("hash" in target) {
			const path = `${router.makeUrl(target.route, params)}#${target.hash}`;
			if (ctx.inertia.requestInfo().isInertiaRequest) {
				return ctx.inertia.location(path);
			}
			return ctx.response.redirect().toPath(path);
		}
		return ctx.response.redirect().toRoute(target.route, params);
	}

	async readAll(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		await this.alerts.markAllRead(tenant, membership.userId);
		ctx.session.flash("success", "All alerts marked as read.");
		return ctx.response
			.redirect()
			.toRoute("tenant.alerts.index", { tenant: tenant.slug });
	}
}
