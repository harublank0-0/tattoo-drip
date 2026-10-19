import { inject } from "@adonisjs/core";
import type { StoredImage } from "#modules/media/services/image_service";
import Payment from "#modules/payments/models/payment";
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";
import type Quote from "#modules/projects/models/quote";
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
 * A project's deposit: whether it is covered, what is left to pay, and the
 * proofs clients send from the deposit page (TAT-65 owns this class). The
 * current quote comes from QuoteService. Only payments in the quote's
 * currency count; another currency is not converted.
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

	/**
	 * What is left to pay of `quote`'s deposit, in minor units: the deposit
	 * minus the verified deposit money in the quote's currency, never below
	 * zero. Zero means nothing is due (a zero deposit too), as in isSettled.
	 */
	async remaining(
		tenant: TenantRef,
		project: ProjectRef,
		quote: Pick<Quote, "depositAmount" | "currency">,
	): Promise<number> {
		const paid = await this.verifiedPaid(tenant, project, quote.currency);
		return Math.max(0, quote.depositAmount - paid);
	}

	/**
	 * The project's newest deposit proof waiting for the studio (a
	 * `submitted` deposit payment), or null. The deposit page takes one at a
	 * time, so there is at most one from it.
	 */
	async pendingProof(
		tenant: TenantRef,
		project: ProjectRef,
	): Promise<Payment | null> {
		return Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "deposit")
			.where("status", "submitted")
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.first();
	}

	/**
	 * Whether the studio's latest decision on one of the project's deposit
	 * payments was a rejection: the deposit page then asks for a new
	 * screenshot.
	 */
	async lastDecisionRejected(
		tenant: TenantRef,
		project: ProjectRef,
	): Promise<boolean> {
		const last = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "deposit")
			.whereNot("status", "submitted")
			.orderBy("verified_at", "desc")
			.orderBy("id", "desc")
			.first();
		return last?.status === "rejected";
	}

	/**
	 * How many deposit proofs wait for the studio: the Projects badge
	 * (TAT-65). Payments have no soft delete and nothing deletes projects
	 * from the dashboard yet, so every waiting deposit payment counts (TAT-42
	 * defines the cascade).
	 */
	async countPendingProofs(tenant: TenantRef): Promise<number> {
		const [row] = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("kind", "deposit")
			.where("status", "submitted")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/**
	 * Records the proof a client sent from the deposit page: a `submitted`
	 * deposit payment of `amount` with its stored image, in one INSERT (a
	 * payment's proof can never be set afterwards: payments_guard). Call it
	 * inside the transaction that stored the image.
	 */
	async recordProof(
		tenant: TenantRef,
		project: ProjectRef,
		input: {
			amount: number;
			currency: string;
			method: PaymentMethodKind;
			proof: StoredImage;
		},
	): Promise<Payment> {
		const payment = await Payment.create({
			tenantId: tenant.id,
			projectId: project.id,
			kind: "deposit",
			amount: input.amount,
			currency: input.currency,
			method: input.method,
			proofImageKey: input.proof.key,
			proofImageWidth: input.proof.width,
			proofImageHeight: input.proof.height,
			status: "submitted",
		});
		// Lucid reads nothing back after an insert: the caller gets the row as
		// the database has it (the decision columns null, the timestamps set).
		await payment.refresh();
		return payment;
	}
}
