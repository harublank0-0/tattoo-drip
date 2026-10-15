import { inject } from "@adonisjs/core";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;
type ProjectRef = Pick<TattooProject, "id">;

/**
 * Payment kinds that count toward a deposit. A `correction` is a verified
 * reversal of a mistaken verification (negative for a deposit that was
 * counted by mistake), so it counts too.
 */
const COUNTED_KINDS = ["deposit", "correction"];

/**
 * Whether a project's deposit is covered. Read-only; TAT-65 (the deposit page
 * and proofs) will own this class and grow it. The current quote comes from
 * QuoteService.
 */
@inject()
export default class DepositService {
	constructor(private quotes: QuoteService) {}

	/**
	 * True when the project's current quote (its highest version) asks for no
	 * deposit, or the verified deposits and corrections in the quote's currency
	 * reach the amount (another currency is not converted, so it does not
	 * count). A project with no quote is not settled. Payments are summed here,
	 * not in SQL: each amount is an int4 and a project has a handful of
	 * payments, so there is no int8 `sum()` string to parse.
	 */
	async isSettled(tenant: TenantRef, project: ProjectRef): Promise<boolean> {
		const quote = await this.quotes.current(tenant, project);
		if (!quote) return false;
		if (quote.depositAmount === 0) return true;

		const paid = await this.verifiedPaid(tenant, project, quote.currency);
		return paid >= quote.depositAmount;
	}

	/**
	 * The deposit money the project holds in `currency`, in minor units: its
	 * verified deposit and correction payments, summed (a reversal subtracts).
	 * Unverified payments and other kinds don't count. Summed here, not in
	 * SQL, for the same reason as isSettled.
	 */
	async verifiedPaid(
		tenant: TenantRef,
		project: ProjectRef,
		currency: string,
	): Promise<number> {
		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("status", "verified")
			.where("currency", currency)
			.whereIn("kind", COUNTED_KINDS);
		return payments.reduce((sum, { amount }) => sum + amount, 0);
	}
}
