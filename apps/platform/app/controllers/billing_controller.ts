import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { billingPage } from "#modules/billing/billing_page";
import { BillingRuleError } from "#modules/billing/errors";
import BillingPlan from "#modules/billing/models/billing_plan";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BillingService from "#modules/billing/services/billing_service";
import { planChoiceValidator } from "#modules/billing/validators/billing";

/**
 * The studio's TattooDrip subscription (Settings, Billing), owners only
 * (TENANT_ROUTE_ROLES). Every action redirects back with a flash; paying an
 * invoice leaves for PayBridgeNP's hosted invoice page.
 */
@inject()
export default class BillingController {
	constructor(private billing: BillingService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const overview = await this.billing.overview(tenant);
		const ids = [
			...overview.plans.map((plan) => plan.id),
			overview.subscription?.planId,
			overview.subscription?.pendingPlanId,
		].filter((id): id is string => !!id);
		const plans = ids.length
			? await BillingPlan.query().whereIn("id", ids)
			: [];
		return ctx.inertia.render(
			"settings/billing",
			billingPage(
				overview,
				new Map(plans.map((plan) => [plan.id, plan])),
				tenant.timezone,
			),
		);
	}

	async subscribe(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { plan } = await ctx.request.validateUsing(planChoiceValidator);
		const user = ctx.auth.getUserOrFail();
		return this.act(ctx, async () => {
			await this.billing.subscribe(
				tenant,
				{ userId: user.id, email: user.email },
				plan,
			);
			return "Subscription started. Pay the first invoice below to start your paid period.";
		});
	}

	async cancel(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		return this.act(ctx, async () => {
			await this.billing.cancelAtPeriodEnd(tenant);
			return "Your subscription will end at the end of the current period.";
		});
	}

	async changePlan(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { plan } = await ctx.request.validateUsing(planChoiceValidator);
		return this.act(ctx, async () => {
			await this.billing.changePlan(tenant, plan);
			return "Plan change scheduled for your next renewal.";
		});
	}

	async sync(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		return this.act(ctx, async () => {
			await this.billing.syncTenant(tenant);
			return "Billing is up to date.";
		});
	}

	async pay(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		try {
			const url = await this.billing.payUrl(tenant, ctx.params.id);
			if (url) {
				// Inertia's visit follows a 409 with the location; a plain form
				// post (no JavaScript) gets an ordinary redirect.
				if (ctx.request.header("x-inertia")) return ctx.inertia.location(url);
				return ctx.response.redirect(url);
			}
			ctx.session.flash("success", "This invoice is already paid.");
		} catch (error) {
			if (!(error instanceof BillingRuleError)) throw error;
			ctx.session.flash("error", error.message);
		}
		return this.back(ctx);
	}

	private async act(ctx: HttpContext, action: () => Promise<string>) {
		try {
			ctx.session.flash("success", await action());
		} catch (error) {
			if (!(error instanceof BillingRuleError)) throw error;
			ctx.session.flash("error", error.message);
		}
		return this.back(ctx);
	}

	private back(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.billing", { tenant: tenant.slug });
	}
}
