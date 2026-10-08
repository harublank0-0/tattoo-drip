import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import BaseInertiaMiddleware from "@adonisjs/inertia/inertia_middleware";
import TenancyService from "#modules/tenancy/services/tenancy_service";
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
				? await (await ctx.containerResolver.make(TenancyService)).tenantsFor(
						auth.user,
					)
				: undefined;

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
		await this.init(ctx);

		const output = await next();
		this.dispose(ctx);

		return output;
	}
}

declare module "@adonisjs/inertia/types" {
	type MiddlewareSharedProps = InferSharedProps<InertiaMiddleware>;
	export interface SharedProps extends MiddlewareSharedProps {}
}
