import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import { ClosureLimitError } from "#modules/scheduling/errors";
import {
	CLOSED_DAYS_ADDED,
	CLOSED_DAYS_REMOVED,
	closedDaysWhen,
	DEFAULT_CLOSES,
	DEFAULT_OPENS,
	HOURS_SAVED,
	MAX_UPCOMING_CLOSURES,
	TEXTS_SAVED,
	WEEKDAYS,
} from "#modules/scheduling/opening_hours";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import {
	closedDaysValidator,
	openingHoursValidator,
	toClosure,
	toOpeningWeek,
} from "#modules/scheduling/validators/opening_hours";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { updateGoodToKnowValidator } from "#modules/tenancy/validators/good_to_know";

const LIMIT = `You can list up to ${MAX_UPCOMING_CLOSURES} closed days ahead. Remove one to add another.`;

/**
 * Settings, Good to know (TAT-128): the studio's opening hours, closed days
 * and four short texts for clients, owners only (the settings group's role
 * check). One page with three forms, so every write redirects back to it.
 */
@inject()
export default class GoodToKnowController {
	constructor(
		private hours: OpeningHoursService,
		private tenancy: TenancyService,
	) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const today = todayIn(tenant.timezone);
		const open = new Map(
			(await this.hours.week(tenant)).map((day) => [day.day, day]),
		);
		const closures = await this.hours.upcomingClosures(tenant, today);

		return ctx.inertia.render("settings/good_to_know", {
			timezone: tenant.timezone,
			// Sunday first; a closed day carries the times ticking it offers.
			week: WEEKDAYS.map((day) => ({
				day,
				open: open.has(day),
				opens: open.get(day)?.opens ?? DEFAULT_OPENS,
				closes: open.get(day)?.closes ?? DEFAULT_CLOSES,
			})),
			closedDays: closures.map((closure) => ({
				id: closure.id,
				when: closedDaysWhen(
					closure.startsOn.toISODate() as string,
					closure.endsOn.toISODate() as string,
				),
				note: closure.note,
			})),
			dates: { today, max: lastBookableDay(today) },
			texts: {
				walkIns: tenant.walkInsText,
				ageRule: tenant.ageRuleText,
				beforeSession: tenant.beforeSessionText,
				aftercare: tenant.aftercareText,
			},
			// Whether Payments holds a policy; the policy itself is not sent.
			hasDepositPolicy: (tenant.depositPolicy ?? "").trim() !== "",
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(updateGoodToKnowValidator);

		await this.tenancy.updateGoodToKnow(tenant, {
			walkInsText: input.walkIns,
			ageRuleText: input.ageRule,
			beforeSessionText: input.beforeSession,
			aftercareText: input.aftercare,
		});

		ctx.session.flash("success", TEXTS_SAVED);
		return this.back(ctx, tenant.slug);
	}

	async updateHours(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const form = await ctx.request.validateUsing(openingHoursValidator);

		await this.hours.replaceWeek(tenant, toOpeningWeek(form));

		ctx.session.flash("success", HOURS_SAVED);
		return this.back(ctx, tenant.slug);
	}

	async storeClosedDays(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const form = await ctx.request.validateUsing(closedDaysValidator);
		const closure = toClosure(form, tenant.timezone);

		try {
			await this.hours.addClosure(tenant, closure, todayIn(tenant.timezone));
		} catch (error) {
			if (!(error instanceof ClosureLimitError)) throw error;
			throw new errors.E_VALIDATION_ERROR([
				{ field: "closedFrom", message: LIMIT, rule: "limit" },
			]);
		}

		ctx.session.flash("success", CLOSED_DAYS_ADDED);
		return this.back(ctx, tenant.slug);
	}

	async destroyClosedDays(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const closure = await this.hours.findClosure(tenant, ctx.params.id);

		await this.hours.removeClosure(tenant, closure);

		ctx.session.flash("success", CLOSED_DAYS_REMOVED);
		return this.back(ctx, tenant.slug);
	}

	private back(ctx: HttpContext, tenant: string) {
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.good_to_know", { tenant });
	}
}
