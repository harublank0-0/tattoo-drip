import type { HttpContext } from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import type { NextFn } from "@adonisjs/core/types/http";
import BaseInertiaMiddleware from "@adonisjs/inertia/inertia_middleware";
import type User from "#models/user";
import InquiryService from "#modules/inquiries/services/inquiry_service";
import AlertService from "#modules/notifications/services/alert_service";
import DepositService from "#modules/payments/services/deposit_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { ensureDbContext } from "#services/db_context";
import { encryptsHistory } from "#services/history_encryption";
import { isApiRequest } from "#services/public_api";
import UserTransformer from "#transformers/user_transformer";

export default class InertiaMiddleware extends BaseInertiaMiddleware {
	async share(ctx: HttpContext) {
		/**
		 * The share method is called everytime an Inertia page is rendered. In
		 * certain cases, a page may get rendered before the session middleware
		 * or the auth middleware are executed. For example: During a 404 request.
		 *
		 * In that case, we must always assume that HttpContext is not fully hydrated
		 * with all the properties
		 */
		const { auth, request, tenant, membership } = ctx as Partial<HttpContext>;

		const theme: "light" | "dark" =
			request?.plainCookie("app_theme", {
				defaultValue: "light",
				encoded: false,
			}) ?? "light";

		const tenants =
			tenant && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(await ctx.containerResolver.make(TenancyService)).tenantsFor(
								auth.user as User,
							),
					)
				: undefined;

		// The Inbox badge: owners only, the inbox is theirs.
		const inboxCount =
			tenant && membership?.role === "owner" && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(await ctx.containerResolver.make(InquiryService)).countNew(
								tenant,
							),
					)
				: null;

		// The Projects badge: deposit proofs waiting for an owner (TAT-65).
		const proofCount =
			tenant && membership?.role === "owner" && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(
								await ctx.containerResolver.make(DepositService)
							).countPendingProofs(tenant),
					)
				: null;

		// The Alerts count (TAT-52): every member's own unread alerts here.
		const alertCount =
			tenant && membership && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(await ctx.containerResolver.make(AlertService)).unreadCount(
								tenant,
								membership.userId,
							),
					)
				: null;

		/**
		 * Data shared with all Inertia pages. Make sure you are using
		 * transformers for rich data-types like Models.
		 */
		return {
			errors: ctx.inertia.always(this.getValidationErrors(ctx)),
			user: ctx.inertia.always(
				auth?.user ? UserTransformer.transform(auth.user) : undefined,
			),
			preferences: ctx.inertia.always({ theme }),
			/**
			 * Set on /t/:tenant pages by the tenant middleware, which runs
			 * before the page renders; undefined everywhere else.
			 */
			tenant: ctx.inertia.always(
				tenant && membership
					? {
							name: tenant.name,
							slug: tenant.slug,
							type: tenant.type,
							role: membership.role,
						}
					: undefined,
			),
			/**
			 * The tenant switcher's list: only this user's live tenants.
			 */
			tenants: ctx.inertia.always(
				tenants?.map(({ tenant, role }) => ({
					name: tenant.name,
					slug: tenant.slug,
					role,
				})),
			),
			/** New inquiries waiting in the inbox; null unless an owner is on a tenant page. */
			inboxCount: ctx.inertia.always(inboxCount),
			/** Deposit proofs waiting for an owner; null unless an owner is on a tenant page. */
			proofCount: ctx.inertia.always(proofCount),
			/** The member's unread alerts here (TAT-52); null unless on a tenant page. */
			alertCount: ctx.inertia.always(alertCount),
		};
	}

	flash(ctx: HttpContext) {
		/**
		 * Flash messages travel in the dedicated `flash` field of the page
		 * object instead of props, and the client strips them from history
		 * state so they never reappear when navigating back.
		 */
		const { session } = ctx as Partial<HttpContext>;

		const success: string | undefined = session?.flashMessages.get("success");
		const error: string | undefined = session?.flashMessages.get("error");

		return { success, error };
	}

	async handle(ctx: HttpContext, next: NextFn) {
		// The public API renders no pages, and must not get Inertia's 409 or
		// headers (TAT-32).
		if (isApiRequest(ctx)) return next();
		await this.init(ctx);

		// config/inertia.ts encrypts history; a plain-HTTP visit from another
		// device in development can't (see encryptsHistory).
		if (!encryptsHistory(ctx.request, app.inProduction)) {
			ctx.inertia.encryptHistory(false);
		}

		const output = await next();
		this.dispose(ctx);

		return output;
	}
}

declare module "@adonisjs/inertia/types" {
	type MiddlewareSharedProps = InferSharedProps<InertiaMiddleware>;
	export interface SharedProps extends MiddlewareSharedProps {}
}
