import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { errors as vineErrors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { GatewayRuleError } from "#modules/payments/errors";
import GatewayCheckout from "#modules/payments/models/gateway_checkout";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TransactionService from "#modules/payments/services/transaction_service";
import {
	PER_PAGE,
	periodOf,
	type TransactionFilters,
	transactionsCsv,
} from "#modules/payments/transactions";
import { transactionsPage } from "#modules/payments/transactions_page";
import { transactionFiltersValidator } from "#modules/payments/validators/gateway";
import { ProviderError } from "#services/paybridge";

/**
 * The studio's Transactions page (owners only, TENANT_ROUTE_ROLES): its
 * customer-side money records with filters, the period's income summary,
 * a CSV of the same filters, and "Check status" for one online payment.
 */
@inject()
export default class TransactionsController {
	constructor(
		private transactions: TransactionService,
		private checkouts: GatewayCheckoutService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const filters = await this.filters(ctx, tenant.timezone);
		const [{ rows, total }, totals, daily] = [
			await this.transactions.page(tenant, filters, tenant.timezone),
			await this.transactions.totals(tenant, filters, tenant.timezone),
			await this.transactions.daily(tenant, filters, tenant.timezone),
		];
		return ctx.inertia.render(
			"transactions/index",
			transactionsPage({
				rows,
				total,
				totals,
				daily,
				filters,
				perPage: PER_PAGE,
				timezone: tenant.timezone,
			}),
		);
	}

	async exportCsv(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const filters = await this.filters(ctx, tenant.timezone);
		const rows = await this.transactions.export(
			tenant,
			filters,
			tenant.timezone,
		);
		ctx.response.header("Content-Type", "text/csv; charset=utf-8");
		ctx.response.header("Cache-Control", "private, no-store");
		ctx.response.header(
			"Content-Disposition",
			`attachment; filename="transactions-${filters.from}-to-${filters.to}.csv"`,
		);
		return transactionsCsv(rows, tenant.timezone);
	}

	/** Reads one online payment's checkout back from PayBridgeNP, once. */
	async sync(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const checkoutId = await this.transactions.checkoutIdFor(
			tenant,
			ctx.params.id,
		);
		// Another studio's record, or one never paid online: a 404.
		if (!checkoutId) throw new lucidErrors.E_ROW_NOT_FOUND(GatewayCheckout);
		try {
			const checkout = await this.checkouts.syncCheckout(tenant, checkoutId);
			ctx.session.flash(
				"success",
				checkout.status === "paid"
					? "Checked with PayBridgeNP: the payment is recorded."
					: "Checked with PayBridgeNP: no confirmed payment yet.",
			);
		} catch (error) {
			if (
				!(error instanceof ProviderError || error instanceof GatewayRuleError)
			) {
				throw error;
			}
			ctx.session.flash(
				"error",
				"PayBridgeNP didn't answer. Nothing changed; try again in a minute.",
			);
		}
		return ctx.response.redirect().back();
	}

	private async filters(
		ctx: HttpContext,
		timezone: string,
	): Promise<TransactionFilters> {
		let input: Awaited<
			ReturnType<typeof transactionFiltersValidator.validate>
		> = {};
		try {
			// An empty box or "All" arrives as "": it means no filter.
			const given = Object.fromEntries(
				Object.entries(ctx.request.qs()).filter(
					([, value]) => typeof value === "string" && value.trim() !== "",
				),
			);
			input = await transactionFiltersValidator.validate(given);
		} catch (error) {
			if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error;
		}
		const period = periodOf(input.from, input.to, timezone);
		return {
			from: period.from,
			to: period.to,
			status: input.status ?? null,
			provider: input.provider ?? null,
			type: input.type ?? null,
			q: input.q || null,
			page: input.page ?? 1,
		};
	}
}
