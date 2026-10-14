import Payment from "#modules/payments/models/payment";
import Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
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
 * and proofs) will own this class and grow it.
 *
 * It reads the `Quote` model directly because there is no quote service yet:
 * TAT-64 adds one, and this should call it then.
 */
export default class DepositService {
	/**
	 * True when the project's current quote (its highest version) asks for no
	 * deposit, or the verified deposits and corrections in the quote's currency
	 * reach the amount (another currency is not converted, so it does not
	 * count). A project with no quote is not settled. Payments are summed here,
	 * not in SQL: each amount is an int4 and a project has a handful of
	 * payments, so there is no int8 `sum()` string to parse.
	 */
	async isSettled(tenant: TenantRef, project: ProjectRef): Promise<boolean> {
		const quote = await Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();
		if (!quote) return false;
		if (quote.depositAmount === 0) return true;

		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("status", "verified")
			.where("currency", quote.currency)
			.whereIn("kind", COUNTED_KINDS);
		const paid = payments.reduce((sum, { amount }) => sum + amount, 0);
		return paid >= quote.depositAmount;
	}
}
