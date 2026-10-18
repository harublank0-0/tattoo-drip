import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	PaymentRuleError,
	type PaymentRuleReason,
} from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentService, {
	type Recorded,
} from "#modules/payments/services/payment_service";
import {
	decisionValidator,
	deskPaymentValidator,
	outcomeValidator,
	refundValidator,
	toOutcomeInput,
	toPaisa,
} from "#modules/payments/validators/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { formatMoney } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

/** What a refused payment action tells the owner; `refund_too_large` is a field error instead. */
const PAYMENT_RULE_MESSAGES: Record<
	Exclude<PaymentRuleReason, "refund_too_large">,
	string
> = {
	already_decided:
		"This payment was already verified or rejected. Check the list.",
	not_reversible:
		"Only a verified payment that isn't a reversal can be reversed.",
	already_reversed: "This payment was already reversed.",
	deposit_not_pending:
		"A deposit can be recorded only while the project waits for it. Mark the quote accepted first.",
	project_declined: "This project was declined: it takes no payments.",
	outcome_first: "Record what happened to the deposit first.",
	no_outcome_needed: "There's no deposit outcome to record for this project.",
};

/**
 * The owners' payment actions on the project page (TAT-66). A payment's :id
 * loads through PaymentService.findFor (owners only, scoped to the tenant)
 * and its project through ProjectService.findFor; a project's :id loads
 * through ProjectService.findFor, after `requireOwner` has refused anyone
 * but an owner (before the body is validated, so an artist always gets the
 * 404). Another tenant's payment or project, a deleted project and an
 * artist all get a 404. Every action goes back to the project page.
 */
@inject()
export default class PaymentsController {
	constructor(
		private payments: PaymentService,
		private projects: ProjectService,
	) {}

	async verify(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { payment, project } = await this.paymentAndProject(ctx);
		const { note } = await ctx.request.validateUsing(decisionValidator);
		await refusalsAsFlash(ctx, async () => {
			const recorded = await this.payments.verify(
				tenant,
				membership,
				payment,
				note ?? null,
			);
			ctx.session.flash("success", `Payment verified.${bookingNote(recorded)}`);
		});
		return backTo(ctx, tenant, project);
	}

	async reject(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { payment, project } = await this.paymentAndProject(ctx);
		const { note } = await ctx.request.validateUsing(decisionValidator);
		await refusalsAsFlash(ctx, async () => {
			const { asksAgain } = await this.payments.reject(
				tenant,
				membership,
				payment,
				note ?? null,
			);
			ctx.session.flash(
				"success",
				asksAgain
					? "Screenshot rejected. The deposit page now asks the client for a new one."
					: "Screenshot rejected.",
			);
		});
		return backTo(ctx, tenant, project);
	}

	async reverse(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { payment, project } = await this.paymentAndProject(ctx);
		const { note } = await ctx.request.validateUsing(decisionValidator);
		await refusalsAsFlash(ctx, async () => {
			const { reversed, depositDue } = await this.payments.reverse(
				tenant,
				membership,
				payment,
				note ?? null,
			);
			const due =
				reversed.kind === "deposit" && depositDue > 0
					? ` ${formatMoney(depositDue)} of the deposit is due again.`
					: "";
			ctx.session.flash("success", `Payment reversed.${due}`);
		});
		return backTo(ctx, tenant, project);
	}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		this.payments.requireOwner(membership);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(deskPaymentValidator);
		await refusalsAsFlash(ctx, async () => {
			const recorded = await this.payments.record(tenant, membership, project, {
				kind: form.kind,
				method: form.method,
				amount: toPaisa(form.amount),
				note: form.note ?? null,
			});
			ctx.session.flash("success", `Payment recorded.${bookingNote(recorded)}`);
		});
		return backTo(ctx, tenant, project);
	}

	async refund(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		this.payments.requireOwner(membership);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(refundValidator);
		await refusalsAsFlash(ctx, async () => {
			await this.payments.refund(tenant, membership, project, {
				method: form.method,
				amount: toPaisa(form.amount),
				note: form.note ?? null,
			});
			ctx.session.flash("success", "Refund recorded.");
		});
		return backTo(ctx, tenant, project);
	}

	async outcome(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		this.payments.requireOwner(membership);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const input = toOutcomeInput(
			await ctx.request.validateUsing(outcomeValidator),
		);
		await refusalsAsFlash(ctx, async () => {
			await this.payments.recordOutcome(tenant, membership, project, input);
			ctx.session.flash(
				"success",
				input.outcome === "kept"
					? "Recorded: the studio keeps the deposit."
					: `Recorded: ${formatMoney(input.amount)} of the deposit refunded.`,
			);
		});
		return backTo(ctx, tenant, project);
	}

	/** The payment (owners only, the tenant's) and its live project, else a 404. */
	private async paymentAndProject(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const payment = await this.payments.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const project = await this.projects.findFor(
			tenant,
			membership,
			payment.projectId,
		);
		return { payment, project };
	}
}

/** What a verified or recorded deposit did next, for the flash. */
function bookingNote({
	payment,
	booked,
	status,
	depositDue,
}: Recorded): string {
	if (payment.kind !== "deposit") return "";
	if (booked) return " The project is booked.";
	if (status !== "deposit_pending") return "";
	return depositDue > 0
		? ` ${formatMoney(depositDue)} of the deposit is still due.`
		: " Schedule a tattoo session under Sessions to book the project.";
}

/**
 * Runs `work`, turning a refused payment action into the flash error, or
 * for `refund_too_large` into a field error on `amount`. The service
 * already rolled its savepoint back, so the request goes on.
 */
async function refusalsAsFlash(ctx: HttpContext, work: () => Promise<void>) {
	try {
		await work();
	} catch (error) {
		if (!(error instanceof PaymentRuleError)) throw error;
		if (error.reason === "refund_too_large") {
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "amount",
					message: `You can refund at most ${formatMoney(error.limit ?? 0)}.`,
					rule: "max",
				},
			]);
		}
		ctx.session.flash("error", PAYMENT_RULE_MESSAGES[error.reason]);
	}
}

function backTo(
	ctx: HttpContext,
	tenant: { slug: string },
	project: TattooProject,
) {
	return ctx.response
		.redirect()
		.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
}
