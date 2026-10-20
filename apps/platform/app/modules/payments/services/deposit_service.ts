import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import type { StoredImage } from "#modules/media/services/image_service";
import {
	type Balance,
	balanceOf,
	decidedLate,
	depositMoney,
} from "#modules/payments/ledger";
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
 * The payment kinds deposit money is made of: deposits, and the corrections
 * that reverse one (depositMoney decides which corrections those are).
 */
const COUNTED_KINDS = ["deposit", "correction"];

/**
 * A project's deposit: whether it is covered, what is left to pay, and the
 * proofs clients send from the deposit page (TAT-65 owns this class). The
 * current quote comes from QuoteService. Only payments in the quote's
 * currency count; another currency is not converted. TAT-66 owns it from
 * here: corrections count only when they reverse a deposit, and
 * `expirySpared` tells the expiry rule when a decision on the deposit came
 * late.
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
	 * verified deposits plus only the corrections that reverse one of them
	 * (depositMoney in #modules/payments/ledger), so a reversed refund is not
	 * counted as a deposit (TAT-66). Unverified payments and other kinds
	 * don't count. Summed in JavaScript, as in isSettled.
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
		return depositMoney(payments, currency);
	}

	/**
	 * The project's balance (balanceOf over its current quote and every
	 * payment) and whether its total is an hourly estimate. ProjectService's
	 * finish steps read it under the project's lock (TAT-111): PaymentService
	 * shows the same balance but depends on ProjectService, so ProjectService
	 * can't ask it.
	 */
	async balance(
		tenant: TenantRef,
		project: ProjectRef,
	): Promise<{ balance: Balance; estimated: boolean }> {
		const quote = await this.quotes.current(tenant, project);
		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id);
		return {
			balance: balanceOf(quote, payments),
			estimated: quote?.kind === "hourly",
		};
	}

	/**
	 * Whether `quote`'s expiry must spare the project because the studio's
	 * decision on its deposit is still owed or came late: a deposit
	 * screenshot waits, or a deposit was verified, recorded at the desk,
	 * rejected or reversed at or after the expiry (decidedLate).
	 * ProjectService's expiry rule asks it first (TAT-66).
	 */
	async expirySpared(
		tenant: TenantRef,
		project: ProjectRef,
		quote: Pick<Quote, "expiresAt">,
	): Promise<boolean> {
		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.whereIn("kind", COUNTED_KINDS);
		return decidedLate(payments, quote.expiresAt);
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
	 * Each project's first verified deposit, for the projects whose first one
	 * was verified in [from, to): the pilot's inquiry-to-deposit time
	 * (TAT-70). A deposit counts once the studio verified it, a screenshot
	 * from the deposit page or one recorded at the desk (`verified_at` is
	 * when the studio decided); one a correction reverses doesn't count.
	 */
	async firstVerifiedDeposits(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<{ projectId: string; verifiedAt: DateTime }[]> {
		const rows = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("kind", "deposit")
			.where("status", "verified")
			.whereRaw(
				"not exists (select 1 from payments as reversals where reversals.corrects_payment_id = payments.id)",
			)
			.select("project_id")
			.min("verified_at as first_verified_at")
			.groupBy("project_id")
			.havingRaw("min(verified_at) >= ? and min(verified_at) < ?", [
				from.toJSDate(),
				to.toJSDate(),
			]);
		return rows.map((row) => ({
			projectId: row.projectId,
			verifiedAt: DateTime.fromJSDate(row.$extras.first_verified_at),
		}));
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
