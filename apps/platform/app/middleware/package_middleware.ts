import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { PackageRuleError } from "#modules/packages/errors";
import { capabilityOf } from "#modules/packages/route_capabilities";
import PackageGate from "#modules/packages/services/package_gate";

/**
 * Studio packages, phase 3: after the role middleware, refuses what the
 * studio's package state doesn't allow, by the route's capability
 * (ROUTE_CAPABILITIES). In enforce mode a refusal is flashed and the owner
 * goes to the Billing page, the next step; anyone else, who can't open
 * Billing, goes back. In observe mode (the default) PackageGate only logs.
 * A route without a capability fails loudly, as the role middleware does.
 */
export default class PackageMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const { tenant, membership } = tenantContext(ctx);
		const route = ctx.route?.name;
		const capability = capabilityOf(route);
		if (!capability) {
			throw new Error(
				`No ROUTE_CAPABILITIES entry for ${ctx.request.method()} ${ctx.route?.pattern ?? ctx.request.url()} (#modules/packages/route_capabilities)`,
			);
		}
		if (capability === "open") return next();
		const gate = await ctx.containerResolver.make(PackageGate);
		try {
			await gate.checkCapability(tenant, capability, route as string);
		} catch (error) {
			if (!(error instanceof PackageRuleError)) throw error;
			ctx.session.flash("error", error.message);
			if (membership.role === "owner") {
				return ctx.response
					.redirect()
					.toRoute("tenant.settings.billing", { tenant: tenant.slug });
			}
			// Never the refused request's own query string (redirects forward it).
			return ctx.response
				.redirect()
				.withQs(false)
				.toPath(
					backWithin(
						ctx.request.header("referer"),
						`/t/${tenant.slug}`,
						ctx.request.url(),
					),
				);
		}
		return next();
	}
}

/**
 * Where a refused member who can't open Billing goes: the page they came
 * from, when it is in this studio and isn't the refused route itself (a
 * stale booking page's own lookup form would otherwise loop), else the
 * studio's home, which shows the flash. Only the referer's path is used, so
 * this never redirects off the site.
 */
function backWithin(
	referer: string | undefined,
	studio: string,
	refusedPath: string,
): string {
	if (!referer) return studio;
	let path: string;
	try {
		const url = new URL(referer, "http://referer.invalid");
		if (url.pathname === refusedPath) return studio;
		path = `${url.pathname}${url.search}`;
	} catch {
		return studio;
	}
	return path === studio || path.startsWith(`${studio}/`) ? path : studio;
}
