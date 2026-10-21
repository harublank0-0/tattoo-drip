import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import User from "#models/user";
import { PaymentRuleError } from "#modules/payments/errors";
import {
	type Balance,
	balanceOf,
	decidedLate,
	depositMoney,
	settleableDeposit,
} from "#modules/payments/ledger";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment, { type DeskKind } from "#modules/payments/models/payment";
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";
import { FINISHED_STATUSES, owed } from "#modules/projects/finish";
import type Quote from "#modules/projects/models/quote";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { isExpired } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;

/** The statuses in which deposit money needs a recorded outcome. */
export const CLOSED_FOR_OUTCOME: readonly ProjectStatus[] = [
	"cancelled",
	"declined",
];

/** A project's money, as the Payments card and the writes read it. */
export type ProjectMoney = {
	/** The current quote (the highest version), or null. */
	quote: Quote | null;
	/** Every payment of the project, newest first. */
	payments: Payment[];
	balance: Balance;
	/** The deposit money held, in the balance's currency (depositMoney). */
	depositHeld: number;
	/**
	 * The part of it a closed project's outcome is about: what the project
	 * still holds of the deposit (settleableDeposit), after any refund.
	 */
	depositSettleable: number;
	/** What is left to pay of the current quote's deposit, in paisa: 0 when covered or none. */
	depositDue: number;
	/** The outcome recorded when the project closed, or null. */
	outcome: DepositOutcome | null;
	/** Closed (CLOSED_FOR_OUTCOME), still holding deposit money, and no outcome yet. */
	outcomeNeeded: boolean;
};

/** What the owners' projects list flags on one project (PaymentService.listFlags). */
export type ListFlags = {
	proofWaiting: boolean;
	depositToSettle: boolean;
	quoteLapsed: boolean;
	/**
	 * A finished project (healing check or completed) whose fixed price is
	 * still owed (TAT-111). Hourly totals are estimates, so never flagged.
	 */
	balanceOwed: boolean;
};

/** A verified payment and what it did to its project. */
export type Recorded = {
	payment: Payment;
	/** settleBooking moved the project to booked. */
	booked: boolean;
	status: ProjectStatus;
	/** What is still due of the deposit afterwards, in paisa. */
	depositDue: number;
};

/** A rejected screenshot, and whether the deposit page now asks for a new one. */
export type Rejected = { payment: Payment; asksAgain: boolean };

/** Money taken at the desk, in stored units (paisa > 0). */
export type DeskPayment = {
	kind: DeskKind;
	method: PaymentMethodKind;
	amount: number;
	note: string | null;
};

/** Money given back, in stored units (paisa > 0; stored negative). */
export type RefundInput = {
	method: PaymentMethodKind;
	amount: number;
	note: string | null;
};

/** A reversal, the payment it reverses, and what is due of the deposit afterwards. */
export type Reversal = {
	correction: Payment;
	reversed: Payment;
	depositDue: number;
};

/** What the studio decided about a closed project's deposit (per-session outcomes and `moved` are a follow-up to TAT-85). */
export type OutcomeInput =
	| { outcome: "kept"; note: string | null }
	| {
			outcome: "refunded";
			amount: number;
			method: PaymentMethodKind;
			note: string | null;
	  };

/**
 * The payments of a tenant's projects (TAT-66): the owners' decisions on
 * screenshots, money taken at the desk, refunds, reversals and deposit
 * outcomes, and the reads the project page and the client profile show.
 * Owners only: anyone else gets E_ROW_NOT_FOUND (a 404). Every write locks
 * the project row first (ProjectService.lockLive) and then the payment, the
 * order every project write uses, and decides from the rows it holds, so a
 * double tap or two owners serialize and the second gets a PaymentRuleError.
 * Payments are only inserted, or decided once (payments_guard).
 */
@inject()
export default class PaymentService {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private sessions: SessionService,
	) {}

	/**
	 * Owners only: anyone else gets E_ROW_NOT_FOUND (a 404). The controllers
	 * call it before they validate a body, so who may act is decided first and
	 * an artist gets the same 404 whatever they post. Every method below
	 * checks again.
	 */
	requireOwner(member: Member): void {
		assertOwner(member);
	}

	/**
	 * The tenant's payment with this id, for an owner. Anyone else, an
	 * unknown id and another tenant's payment are E_ROW_NOT_FOUND (a 404).
	 * The routes then load its project through ProjectService.findFor, so a
	 * payment of a deleted project is a 404 too.
	 */
	async findFor(
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<Payment> {
		assertOwner(member);
		return Payment.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * The project's money: its current quote, every payment newest first,
	 * the balance (balanceOf), the deposit money it holds and what is left of
	 * the deposit, the outcome recorded when it closed, and whether one is
	 * needed. The caller loaded the project for the member.
	 */
	async forProject(
		tenant: TenantRef,
		project: Pick<TattooProject, "id" | "status">,
	): Promise<ProjectMoney> {
		const quote = await this.quotes.current(tenant, project);
		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
		const balance = balanceOf(quote, payments);
		const depositHeld = depositMoney(payments, balance.currency);
		const depositSettleable = settleableDeposit(payments, balance.currency);
		const outcome = await DepositOutcome.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.whereNull("session_id")
			.first();
		return {
			quote,
			payments,
			balance,
			depositHeld,
			depositSettleable,
			depositDue: quote ? Math.max(0, quote.depositAmount - depositHeld) : 0,
			outcome,
			outcomeNeeded:
				CLOSED_FOR_OUTCOME.includes(project.status) &&
				depositSettleable > 0 &&
				outcome === null,
		};
	}

	/** The payments of these projects (the client profile), newest first. */
	async forProjects(
		tenant: TenantRef,
		projectIds: string[],
	): Promise<Payment[]> {
		if (projectIds.length === 0) return [];
		return Payment.query()
			.where("tenant_id", tenant.id)
			.whereIn("project_id", projectIds)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
	}

	/** Each project's balance (balanceOf over its current quote and payments). */
	async balancesFor(
		tenant: TenantRef,
		projects: Pick<TattooProject, "id">[],
	): Promise<Map<string, Balance>> {
		const all = await this.forProjects(
			tenant,
			projects.map(({ id }) => id),
		);
		const balances = new Map<string, Balance>();
		for (const project of projects) {
			const quote = await this.quotes.current(tenant, project);
			balances.set(
				project.id,
				balanceOf(
					quote,
					all.filter(({ projectId }) => projectId === project.id),
				),
			);
		}
		return balances;
	}

	/**
	 * The owners' flags on the projects list: a deposit screenshot waits
	 * (`proofWaiting`), a closed project still holds deposit money
	 * (settleableDeposit) with no outcome recorded (`depositToSettle`), or a
	 * deposit_pending project's quote has expired but the studio's late
	 * decision on the deposit spares it from the sweep (`quoteLapsed`): it
	 * waits for the owner to revise the quote, take the rest at the desk or
	 * withdraw. A finished project whose fixed price is still owed is
	 * `balanceOwed` (TAT-111): the owner confirmed finishing with it, and the
	 * board keeps it in sight.
	 */
	async listFlags(
		tenant: TenantRef,
		projects: Pick<TattooProject, "id" | "status">[],
	): Promise<Map<string, ListFlags>> {
		const ids = projects.map(({ id }) => id);
		const rows =
			ids.length === 0
				? []
				: await Payment.query()
						.where("tenant_id", tenant.id)
						.whereIn("project_id", ids);
		const closed = projects.filter(({ status }) =>
			CLOSED_FOR_OUTCOME.includes(status),
		);
		const outcomes =
			closed.length === 0
				? []
				: await DepositOutcome.query()
						.where("tenant_id", tenant.id)
						.whereIn(
							"project_id",
							closed.map(({ id }) => id),
						)
						.whereNull("session_id");
		const settled = new Set(outcomes.map(({ projectId }) => projectId));
		const flags = new Map<string, ListFlags>();
		for (const project of projects) {
			const own = rows.filter(({ projectId }) => projectId === project.id);
			const proofWaiting = own.some(
				({ kind, status }) => kind === "deposit" && status === "submitted",
			);
			let depositToSettle = false;
			let quoteLapsed = false;
			if (
				CLOSED_FOR_OUTCOME.includes(project.status) &&
				!settled.has(project.id)
			) {
				const quote = await this.quotes.current(tenant, project);
				depositToSettle = settleableDeposit(own, quote?.currency ?? "NPR") > 0;
			}
			if (project.status === "deposit_pending" && !proofWaiting) {
				const quote = await this.quotes.current(tenant, project);
				quoteLapsed =
					quote !== null &&
					isExpired(quote) &&
					decidedLate(own, quote.expiresAt);
			}
			let balanceOwed = false;
			if (FINISHED_STATUSES.includes(project.status)) {
				const quote = await this.quotes.current(tenant, project);
				balanceOwed =
					quote !== null &&
					quote.kind === "fixed" &&
					owed(balanceOf(quote, own).due) > 0n;
			}
			flags.set(project.id, {
				proofWaiting,
				depositToSettle,
				quoteLapsed,
				balanceOwed,
			});
		}
		return flags;
	}

	/**
	 * Who decided or recorded, for the page: each user's full name, else
	 * their email. Users are global identity with no module service, so this
	 * reads them by id; unknown ids (deleted accounts) are left out.
	 */
	async memberNames(userIds: (string | null)[]): Promise<Map<string, string>> {
		const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
		if (ids.length === 0) return new Map();
		const users = await User.query().whereIn("id", ids);
		return new Map(users.map((user) => [user.id, user.fullName ?? user.email]));
	}

	/**
	 * Verifies a waiting payment (a client's screenshot): the money reached
	 * the studio. Under the project's and then the payment's lock it must
	 * still be `submitted`, else PaymentRuleError "already_decided" (a double
	 * tap, another tab, another owner). Records the owner, the time and the
	 * note. A deposit then goes through settleBooking, which books a
	 * deposit_pending project once its deposit is covered and a tattoo
	 * session is scheduled.
	 */
	async verify(
		tenant: TenantRef,
		member: Member,
		payment: Payment,
		note: string | null,
	): Promise<Recorded> {
		assertOwner(member);
		assertPaymentOf(tenant, payment);
		return withTransaction(async (trx) => {
			const project = await this.lockProject(trx, tenant, payment.projectId);
			const live = await lockPayment(trx, tenant, payment.id);
			if (live.status !== "submitted") {
				throw new PaymentRuleError("already_decided");
			}
			live.merge({
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: member.userId,
				note: clean(note),
			});
			await live.save();
			return this.afterPayment(tenant, project, live);
		});
	}

	/**
	 * Rejects a waiting payment: the money didn't arrive, or not as shown (a
	 * different amount is rejected and recorded at the desk, TAT-37). The
	 * same lock and "already_decided" rule as verify. The proof stays.
	 * `asksAgain` is whether the deposit page now asks the client for a new
	 * screenshot (deposit_pending, a live quote, deposit still due).
	 */
	async reject(
		tenant: TenantRef,
		member: Member,
		payment: Payment,
		note: string | null,
	): Promise<Rejected> {
		assertOwner(member);
		assertPaymentOf(tenant, payment);
		return withTransaction(async (trx) => {
			const project = await this.lockProject(trx, tenant, payment.projectId);
			const live = await lockPayment(trx, tenant, payment.id);
			if (live.status !== "submitted") {
				throw new PaymentRuleError("already_decided");
			}
			live.merge({
				status: "rejected",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: member.userId,
				note: clean(note),
			});
			await live.save();
			const money = await this.forProject(tenant, project);
			return {
				payment: live,
				asksAgain:
					project.status === "deposit_pending" &&
					money.quote !== null &&
					!isExpired(money.quote) &&
					money.depositDue > 0,
			};
		});
	}

	/**
	 * Records money taken at the desk (cash, bank or a QR app), verified at
	 * once by the recording owner, in the current quote's currency (NPR
	 * without a quote). A deposit only while the project is deposit_pending
	 * ("deposit_not_pending"); session and balance payments in any status but
	 * declined ("project_declined"). Overpaying is allowed. A deposit then
	 * goes through settleBooking, as a verified screenshot does.
	 */
	async record(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		input: DeskPayment,
	): Promise<Recorded> {
		assertOwner(member);
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await this.lockProject(trx, tenant, project.id);
			if (input.kind === "deposit" && live.status !== "deposit_pending") {
				throw new PaymentRuleError("deposit_not_pending");
			}
			if (live.status === "declined") {
				throw new PaymentRuleError("project_declined");
			}
			const quote = await this.quotes.current(tenant, live);
			const payment = await Payment.create(
				{
					tenantId: tenant.id,
					projectId: live.id,
					kind: input.kind,
					amount: input.amount,
					currency: quote?.currency ?? "NPR",
					method: input.method,
					status: "verified",
					verifiedAt: DateTime.utc(),
					verifiedByUserId: member.userId,
					note: clean(input.note),
				},
				{ client: trx },
			);
			// Lucid reads nothing back after an insert: the columns left unset
			// (proof, correction target) would be undefined, not null.
			await payment.refresh();
			return this.afterPayment(tenant, live, payment);
		});
	}

	/**
	 * Records money given back: a negative `refund`, verified at once, up to
	 * what the project holds (its net verified payments in its currency;
	 * PaymentRuleError "refund_too_large" with that limit). On a closed
	 * project still waiting for its deposit outcome the outcome comes first
	 * ("outcome_first"), so a refund is never recorded twice. A refund
	 * doesn't touch the deposit: booking is unaffected.
	 */
	async refund(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		input: RefundInput,
	): Promise<Payment> {
		assertOwner(member);
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await this.lockProject(trx, tenant, project.id);
			const money = await this.forProject(tenant, live);
			if (money.outcomeNeeded) throw new PaymentRuleError("outcome_first");
			const held = Number(money.balance.paid);
			if (input.amount > held) {
				throw new PaymentRuleError("refund_too_large", Math.max(0, held));
			}
			const payment = await Payment.create(
				{
					tenantId: tenant.id,
					projectId: live.id,
					kind: "refund",
					amount: -input.amount,
					currency: money.balance.currency,
					method: input.method,
					status: "verified",
					verifiedAt: DateTime.utc(),
					verifiedByUserId: member.userId,
					note: clean(input.note),
				},
				{ client: trx },
			);
			await payment.refresh();
			return payment;
		});
	}

	/**
	 * Reverses a verified payment recorded by mistake (the money never
	 * arrived, or the entry was wrong): a `correction` of minus its amount,
	 * in its currency and method, naming it, verified at once. Only a
	 * verified payment that isn't itself a correction ("not_reversible"), and
	 * only once ("already_reversed": the check under the payment's lock, and
	 * the unique index if two requests pass it together). The project's
	 * status never changes; a reversed deposit is simply due again.
	 */
	async reverse(
		tenant: TenantRef,
		member: Member,
		payment: Payment,
		note: string | null,
	): Promise<Reversal> {
		assertOwner(member);
		assertPaymentOf(tenant, payment);
		return withTransaction(async (trx) => {
			const project = await this.lockProject(trx, tenant, payment.projectId);
			const live = await lockPayment(trx, tenant, payment.id);
			if (live.status !== "verified" || live.kind === "correction") {
				throw new PaymentRuleError("not_reversible");
			}
			const existing = await Payment.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("corrects_payment_id", live.id)
				.first();
			if (existing) throw new PaymentRuleError("already_reversed");
			let correction: Payment;
			try {
				correction = await withTransaction(async (inner) => {
					const created = await Payment.create(
						{
							tenantId: tenant.id,
							projectId: live.projectId,
							kind: "correction",
							amount: -live.amount,
							currency: live.currency,
							method: live.method,
							correctsPaymentId: live.id,
							status: "verified",
							verifiedAt: DateTime.utc(),
							verifiedByUserId: member.userId,
							note: clean(note),
						},
						{ client: inner },
					);
					await created.refresh();
					return created;
				});
			} catch (error) {
				if (isUniqueViolation(error, "payments_corrects_payment_id_unique")) {
					throw new PaymentRuleError("already_reversed");
				}
				throw error;
			}
			const { depositDue } = await this.forProject(tenant, project);
			return { correction, reversed: live, depositDue };
		});
	}

	/**
	 * Records what happened to the deposit of a closed project (cancelled or
	 * declined) that still holds deposit money and has no outcome yet, else
	 * PaymentRuleError "no_outcome_needed" (a deposit already refunded at the
	 * desk needs none). `kept`: the studio keeps it. `refunded`: a refund
	 * payment of `amount` (up to the deposit the project still holds,
	 * settleableDeposit; "refund_too_large" with that limit; the rest is
	 * kept), named by the outcome, in the same transaction. The outcome's
	 * amount is that deposit money. The app only records the studio's
	 * decision; its deposit policy is its own.
	 */
	async recordOutcome(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		input: OutcomeInput,
	): Promise<DepositOutcome> {
		assertOwner(member);
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await this.lockProject(trx, tenant, project.id);
			const money = await this.forProject(tenant, live);
			if (!money.outcomeNeeded) throw new PaymentRuleError("no_outcome_needed");
			const note = clean(input.note);
			let refundPaymentId: string | null = null;
			if (input.outcome === "refunded") {
				if (input.amount > money.depositSettleable) {
					throw new PaymentRuleError(
						"refund_too_large",
						money.depositSettleable,
					);
				}
				const refund = await Payment.create(
					{
						tenantId: tenant.id,
						projectId: live.id,
						kind: "refund",
						amount: -input.amount,
						currency: money.balance.currency,
						method: input.method,
						status: "verified",
						verifiedAt: DateTime.utc(),
						verifiedByUserId: member.userId,
						note,
					},
					{ client: trx },
				);
				refundPaymentId = refund.id;
			}
			try {
				return await withTransaction((inner) =>
					DepositOutcome.create(
						{
							tenantId: tenant.id,
							projectId: live.id,
							sessionId: null,
							outcome: input.outcome,
							amount: money.depositSettleable,
							currency: money.balance.currency,
							refundPaymentId,
							note,
							recordedByUserId: member.userId,
						},
						{ client: inner },
					),
				);
			} catch (error) {
				if (isUniqueViolation(error, "deposit_outcomes_project_close_unique")) {
					throw new PaymentRuleError("no_outcome_needed");
				}
				throw error;
			}
		});
	}

	/**
	 * After a payment is verified or recorded: a deposit goes through
	 * settleBooking. Returns whether that booked the project, its status and
	 * what is still due of the deposit.
	 */
	private async afterPayment(
		tenant: TenantRef,
		project: TattooProject,
		payment: Payment,
	): Promise<Recorded> {
		const booked =
			payment.kind === "deposit" &&
			(await this.sessions.settleBooking(tenant, project));
		const status: ProjectStatus = booked ? "booked" : project.status;
		const { depositDue } = await this.forProject(tenant, {
			id: project.id,
			status,
		});
		return { payment, booked, status, depositDue };
	}

	/**
	 * Locks the live project (ProjectService.lockLive: the lock every project
	 * write takes first). A deleted or unknown one is E_ROW_NOT_FOUND.
	 */
	private async lockProject(
		trx: TransactionClientContract,
		tenant: TenantRef,
		id: string,
	): Promise<TattooProject> {
		const live = await this.projects.lockLive(trx, tenant, id);
		if (!live) throw new lucidErrors.E_ROW_NOT_FOUND(TattooProject);
		return live;
	}
}

/**
 * Locks the payment row, after its project's: the copy a caller holds can
 * be stale, the row decides.
 */
function lockPayment(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return Payment.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/** Owners only: anyone else gets the 404 of a payment that isn't theirs. */
function assertOwner(member: Member) {
	if (member.role !== "owner") throw new lucidErrors.E_ROW_NOT_FOUND(Payment);
}

/** A note as stored: trimmed, and a blank one is none. */
function clean(note: string | null | undefined): string | null {
	const text = note?.trim();
	return text ? text : null;
}

/**
 * A caller bug, not a user error: payments come from the tenant's own reads.
 */
function assertPaymentOf(tenant: TenantRef, payment: Payment) {
	if (payment.tenantId !== tenant.id) {
		throw new Error(`Payment ${payment.id} belongs to another tenant`);
	}
}

/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}
