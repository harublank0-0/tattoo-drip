import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import vine from "@vinejs/vine";
import { DateTime } from "luxon";
import {
	INVOICE_STATUS_TEXT,
	SUBSCRIPTION_STATUS_TEXT,
} from "#modules/billing/billing_page";
import BillingInvoice from "#modules/billing/models/billing_invoice";
import BillingPlan from "#modules/billing/models/billing_plan";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BillingService from "#modules/billing/services/billing_service";
import type GatewayAccount from "#modules/payments/models/gateway_account";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
import { formatDay, formatMoney } from "#modules/projects/quotes";
import Tenant from "#modules/tenancy/models/tenant";
import { dbClient, withDbContext } from "#services/db_context";

const reviewValidator = vine.create({
	tenantId: vine.string().uuid(),
	accountId: vine.string().uuid(),
	decision: vine.enum(["verify", "suspend"] as const),
});

const day = (at: DateTime | null) =>
	at ? formatDay(at.toUTC().toISODate() as string) : null;

/** Each live studio's id from a SECURITY DEFINER listing (ids only). */
async function tenantIds(fn: "billing_tenants" | "gateway_account_tenants") {
	const { rows } = await dbClient().rawQuery(
		`select tenant_id from public.${fn}()`,
	);
	return rows.map((row: { tenant_id: string }) => row.tenant_id);
}

/**
 * TattooDrip's own staff pages (platformAdmin middleware): TattooDrip's
 * subscription income from studios, and the review of studios' payment
 * connections. Never studio customer money: the Billing page reads only
 * billing_* rows. Each studio is read in its own context (ids from the
 * SECURITY DEFINER listings), so no query here crosses tenants. Dates are
 * UTC on these pages.
 */
@inject()
export default class AdminController {
	constructor(
		private billing: BillingService,
		private accounts: GatewayAccountService,
	) {}

	async billingIndex(ctx: HttpContext) {
		const plans = new Map(
			(await BillingPlan.all()).map((plan) => [plan.id, plan]),
		);
		const studios: {
			tenantId: string;
			name: string;
			planName: string | null;
			statusText: string;
			accessText: string;
		}[] = [];
		const invoices: {
			id: string;
			studio: string;
			number: string | null;
			statusText: string;
			status: string;
			amount: string;
			paid: string | null;
			issuedText: string | null;
			paidText: string | null;
		}[] = [];
		const monthStart = DateTime.utc().startOf("month");
		let paidThisMonth = 0;
		let paidAllTime = 0;
		let outstanding = 0;
		for (const tenantId of await tenantIds("billing_tenants")) {
			await withDbContext({ tenantId }, async () => {
				const tenant = await Tenant.find(tenantId);
				if (!tenant) return;
				const subscription = await this.billing.latestSubscription(tenant);
				const access = await this.billing.access(tenant);
				studios.push({
					tenantId,
					name: tenant.name,
					planName: subscription?.planId
						? (plans.get(subscription.planId)?.name ?? null)
						: null,
					statusText: subscription
						? (SUBSCRIPTION_STATUS_TEXT[subscription.status] ??
							subscription.status)
						: "No subscription",
					accessText:
						access.state === "none"
							? "No paid period"
							: `${access.state === "paid" ? "Paid" : "Trial"} until ${day(access.until)}`,
				});
				const rows = await BillingInvoice.query()
					.where("tenant_id", tenantId)
					.orderBy("created_at", "desc")
					.limit(50);
				for (const invoice of rows) {
					if (invoice.status === "paid" && invoice.currency === "NPR") {
						paidAllTime += invoice.amountPaid;
						if (invoice.paidAt && invoice.paidAt >= monthStart) {
							paidThisMonth += invoice.amountPaid;
						}
					}
					if (
						(invoice.status === "open" || invoice.status === "overdue") &&
						invoice.currency === "NPR"
					) {
						outstanding += Math.max(0, invoice.amountDue - invoice.amountPaid);
					}
					invoices.push({
						id: invoice.id,
						studio: tenant.name,
						number: invoice.number,
						status: invoice.status,
						statusText: INVOICE_STATUS_TEXT[invoice.status] ?? invoice.status,
						amount: formatMoney(invoice.amountDue),
						paid: invoice.amountPaid ? formatMoney(invoice.amountPaid) : null,
						issuedText: day(invoice.issuedAt ?? invoice.createdAt),
						paidText: day(invoice.paidAt),
					});
				}
			});
		}
		invoices.sort((a, b) =>
			(a.issuedText ?? "") < (b.issuedText ?? "") ? 1 : -1,
		);
		return ctx.inertia.render("admin/billing", {
			configured: this.billing.configured(),
			totals: {
				paidThisMonth: formatMoney(paidThisMonth),
				paidAllTime: formatMoney(paidAllTime),
				outstanding: formatMoney(outstanding),
			},
			studios: studios.sort((a, b) => a.name.localeCompare(b.name)),
			invoices: invoices.slice(0, 200),
		});
	}

	async gatewaysIndex(ctx: HttpContext) {
		const accounts: {
			tenantId: string;
			accountId: string;
			studio: string;
			status: GatewayAccount["status"];
			mode: string;
			keyHint: string;
			merchantName: string;
			projectName: string;
			connectedText: string | null;
			verifiedText: string | null;
		}[] = [];
		for (const tenantId of await tenantIds("gateway_account_tenants")) {
			await withDbContext({ tenantId }, async () => {
				const tenant = await Tenant.find(tenantId);
				const account = await this.accounts.current({ id: tenantId });
				if (!tenant || !account) return;
				accounts.push({
					tenantId,
					accountId: account.id,
					studio: tenant.name,
					status: account.status,
					mode: account.livemode ? "live" : "sandbox",
					keyHint: account.keyHint,
					merchantName: account.providerMerchantName,
					projectName: account.providerProjectName,
					connectedText: day(account.createdAt),
					verifiedText: day(account.verifiedAt),
				});
			});
		}
		return ctx.inertia.render("admin/payments", {
			mode: this.accounts.mode(),
			accounts: accounts.sort((a, b) =>
				a.status === b.status
					? a.studio.localeCompare(b.studio)
					: a.status === "pending"
						? -1
						: 1,
			),
		});
	}

	async review(ctx: HttpContext) {
		const input = await ctx.request.validateUsing(reviewValidator);
		const admin = ctx.auth.getUserOrFail();
		const allowed = await tenantIds("gateway_account_tenants");
		if (!allowed.includes(input.tenantId)) {
			ctx.session.flash("error", "That connection no longer exists.");
			return ctx.response.redirect().toRoute("admin.payments");
		}
		await withDbContext({ tenantId: input.tenantId }, () =>
			this.accounts.review(
				{ id: input.tenantId },
				input.accountId,
				admin.id,
				input.decision,
			),
		);
		ctx.session.flash(
			"success",
			input.decision === "verify"
				? "Connection verified: the studio can take deposits online."
				: "Connection suspended: the studio can't take payments online.",
		);
		return ctx.response.redirect().toRoute("admin.payments");
	}
}
