import { randomUUID } from "node:crypto";
import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import { GatewayRuleError } from "#modules/payments/errors";
import GatewayAccount from "#modules/payments/models/gateway_account";
import GatewayCheckout, {
	type CheckoutStatus,
	LIVE_CHECKOUT_STATUSES,
} from "#modules/payments/models/gateway_checkout";
import GatewayPayment, {
	type ReviewReason,
} from "#modules/payments/models/gateway_payment";
import GatewayRefund from "#modules/payments/models/gateway_refund";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositPageService, {
	type DepositPage,
	type DepositStudio,
} from "#modules/payments/services/deposit_page_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentService from "#modules/payments/services/payment_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	type GatewayApi,
	isHostedPaymentUrl,
	ProviderError,
	type ProviderEvent,
	type ProviderPayment,
	type ProviderSession,
} from "#services/paybridge";
import { studioPageUrl } from "#services/storefront_url";

type TenantRef = Pick<Tenant, "id">;

/** PayBridgeNP's checkout bounds, in paisa: NPR 10 to NPR 1,000,000. */
export const MIN_CHECKOUT = 1_000;
export const MAX_CHECKOUT = 100_000_000;

/** The methods a checkout can be paid with, as the ledger names them. */
const ONLINE_METHODS = ["esewa", "khalti", "fonepay"] as const;
type OnlineMethod = (typeof ONLINE_METHODS)[number];

/** A reused session must still have this long to run, so the client isn't sent to one about to expire. */
const REUSE_MARGIN_MINUTES = 5;

/** The deposit page's online payment part (openapi.yaml, DepositOnlinePayment). */
export type OnlineState = {
	available: boolean;
	checkout: {
		id: string;
		status: "confirming" | "paid" | "failed" | "expired";
	} | null;
};

function clientStatus(
	status: CheckoutStatus,
): NonNullable<OnlineState["checkout"]>["status"] {
	switch (status) {
		case "paid":
			return "paid";
		case "failed":
			return "failed";
		case "expired":
		case "cancelled":
		case "superseded":
			return "expired";
		default:
			return "confirming";
	}
}

/** What the deposit page needs to send the client to pay. */
export type StartedCheckout = { checkoutId: string; checkoutUrl: string };

/**
 * The amount to charge online, from a deposit's due in stored paisa: the
 * one place it becomes PayBridgeNP's amount, unchanged (it is paisa
 * already), checked to be a safe integer inside the checkout's bounds.
 */
export function checkoutAmount(due: number | bigint): number {
	const paisa = typeof due === "bigint" ? Number(due) : due;
	if (!Number.isSafeInteger(paisa)) {
		throw new GatewayRuleError("amount_out_of_range");
	}
	if (paisa < MIN_CHECKOUT || paisa > MAX_CHECKOUT) {
		throw new GatewayRuleError("amount_out_of_range");
	}
	return paisa;
}

/** The ids every checkout carries in PayBridgeNP's metadata. */
export function checkoutMetadata(checkout: {
	id: string;
	tenantId: string;
	projectId: string;
	purpose: string;
}): Record<string, string> {
	return {
		td_checkout_id: checkout.id,
		td_tenant_id: checkout.tenantId,
		td_project_id: checkout.projectId,
		td_purpose: checkout.purpose,
	};
}

/**
 * Why a reported successful payment must not be recorded for `checkout`,
 * or null when it matches: PayBridgeNP's own advice (status, amount and
 * currency) plus its mode, its session and the ids TattooDrip put in its
 * metadata. Pure, so every rule is unit-tested.
 */
export function reviewReasonFor(
	payment: Pick<
		ProviderPayment,
		| "status"
		| "amount"
		| "currency"
		| "livemode"
		| "sessionId"
		| "metadata"
		| "method"
	>,
	checkout: Pick<
		GatewayCheckout,
		| "id"
		| "tenantId"
		| "projectId"
		| "amount"
		| "currency"
		| "livemode"
		| "providerSessionId"
		| "purpose"
	>,
): ReviewReason | null {
	if (payment.livemode !== checkout.livemode) return "mode_mismatch";
	if (payment.sessionId !== checkout.providerSessionId) {
		return "session_mismatch";
	}
	const expected = checkoutMetadata(checkout);
	for (const [key, value] of Object.entries(expected)) {
		if (payment.metadata[key] !== value) return "metadata_mismatch";
	}
	if (payment.currency !== checkout.currency || payment.currency !== "NPR") {
		return "currency_mismatch";
	}
	if (payment.amount !== checkout.amount) return "amount_mismatch";
	if (!(ONLINE_METHODS as readonly string[]).includes(payment.method)) {
		return "unsupported_method";
	}
	return null;
}

/** A provider payment status the gateway_payments check accepts. */
function paymentStatus(status: string): GatewayPayment["status"] {
	return [
		"pending",
		"processing",
		"success",
		"failed",
		"cancelled",
		"refunded",
	].includes(status)
		? status
		: "processing";
}

/**
 * A studio's online deposits through its own PayBridgeNP project
 * (docs/payments-paybridgenp.md). The client's deposit page asks for a
 * checkout with its link only: the amount is the deposit still due, read
 * from the database under the project's lock. A payment is recorded in the
 * studio's ledger only from a signed webhook or an explicit sync, after
 * reading the payment back from the API and matching it to the stored
 * checkout (reviewReasonFor); a payment that doesn't match, or a second
 * success for one checkout, is held for review and never recorded twice.
 * The browser's return is navigation only.
 */
@inject()
export default class GatewayCheckoutService {
	constructor(
		private accounts: GatewayAccountService,
		private pages: DepositPageService,
		private payments: PaymentService,
		private projects: ProjectService,
	) {}

	// -------------------------------------------------------------------------
	// Starting a checkout (the client's deposit page)

	/**
	 * A hosted checkout for the deposit behind `token`. Reuses the project's
	 * open session for the same amount while it has time left; otherwise
	 * expires it and starts a new one. The new attempt's row and its
	 * idempotency key are written before PayBridgeNP is called, so when the
	 * call fails the next try repeats the same request.
	 */
	async startDeposit(
		tenant: DepositStudio & Pick<Tenant, "slug">,
		token: string,
	): Promise<StartedCheckout> {
		const availability = await this.accounts.availability(tenant);
		if (!availability.available) throw new GatewayRuleError("unavailable");
		const account = availability.account;
		await this.guardInFlight(tenant, token, account);

		// One savepoint holds the attempt row whatever PayBridgeNP answers.
		const attempt = await withTransaction(async (trx) => {
			const first = await this.pages.show(tenant, token);
			const project = await this.projects.lockLive(
				trx,
				tenant,
				first.projectId,
			);
			if (!project) throw new GatewayRuleError("not_due");
			// Read again under the lock: a screenshot, a desk payment or a
			// revision that committed meanwhile changes what is due.
			const page = await this.pages.show(tenant, token);
			if (page.state !== "due" || page.quote.currency !== "NPR") {
				throw new GatewayRuleError("not_due");
			}
			const amount = checkoutAmount(page.due);

			const live = await GatewayCheckout.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("project_id", project.id)
				.whereIn("status", LIVE_CHECKOUT_STATUSES as CheckoutStatus[])
				.forUpdate()
				.first();
			if (live) {
				const reusable =
					live.amount === amount &&
					live.accountId === account.id &&
					(live.status === "creating" ||
						(live.expiresAt !== null &&
							live.expiresAt >
								DateTime.utc().plus({ minutes: REUSE_MARGIN_MINUTES })));
				if (reusable) return live;
				await this.supersede(account, live);
			}
			const checkout = await GatewayCheckout.create(
				{
					tenantId: tenant.id,
					accountId: account.id,
					projectId: project.id,
					purpose: "deposit",
					amount,
					currency: "NPR",
					livemode: account.livemode,
					idempotencyKey: randomUUID(),
					status: "creating",
				},
				{ client: trx },
			);
			await checkout.refresh();
			return checkout;
		});

		if (attempt.status === "open" && attempt.checkoutUrl) {
			return { checkoutId: attempt.id, checkoutUrl: attempt.checkoutUrl };
		}
		return this.createSession(tenant, account, attempt);
	}

	/**
	 * Before anything replaces the project's open session, asks PayBridgeNP
	 * what became of it, once: a payment on it is recorded now and no second
	 * checkout opens (the client must not pay twice), and a client still on
	 * the provider's page is not offered another one while the session runs.
	 * Its own savepoints, so what it records stays even when it refuses.
	 */
	private async guardInFlight(
		tenant: DepositStudio & Pick<Tenant, "slug">,
		token: string,
		account: GatewayAccount,
	) {
		const page = await this.pages.show(tenant, token);
		const live = await GatewayCheckout.query()
			.where("tenant_id", tenant.id)
			.where("project_id", page.projectId)
			.where("status", "open")
			.whereNotNull("provider_session_id")
			.first();
		if (!live?.providerSessionId) return;
		const reusable =
			page.state === "due" &&
			live.amount === page.due &&
			live.accountId === account.id &&
			live.expiresAt !== null &&
			live.expiresAt > DateTime.utc().plus({ minutes: REUSE_MARGIN_MINUTES });
		if (reusable) return;
		const owner = await GatewayAccount.query()
			.where("tenant_id", tenant.id)
			.where("id", live.accountId)
			.firstOrFail();
		let session: ProviderSession;
		try {
			session = await this.accounts
				.apiFor(owner)
				.getSession(live.providerSessionId);
		} catch (error) {
			if (error instanceof ProviderError) {
				throw new GatewayRuleError("provider_unavailable");
			}
			throw error;
		}
		if (session.paymentId) {
			await this.confirmPayment(tenant, owner, session.paymentId);
			throw new GatewayRuleError("payment_in_progress");
		}
		const running =
			session.expiresAt !== null &&
			DateTime.fromISO(session.expiresAt) > DateTime.utc();
		if (session.status === "initiated" && running) {
			throw new GatewayRuleError("payment_in_progress");
		}
	}

	/** Calls PayBridgeNP for a `creating` attempt and stores its session. */
	private async createSession(
		tenant: DepositStudio & Pick<Tenant, "slug">,
		account: GatewayAccount,
		attempt: GatewayCheckout,
	): Promise<StartedCheckout> {
		// The deposit page's return marker, never the link's token: the
		// token is a bearer secret and must not reach the provider.
		const returnUrl = `${studioPageUrl(storefrontTemplate(), tenant.slug)}/deposit#paid-online`;
		let created: Awaited<ReturnType<GatewayApi["createCheckout"]>>;
		try {
			created = await this.accounts.apiFor(account).createCheckout(
				{
					amount: attempt.amount,
					currency: "NPR",
					returnUrl,
					cancelUrl: returnUrl,
					description: `Deposit for ${tenant.name}`.slice(0, 200),
					metadata: checkoutMetadata(attempt),
				},
				attempt.idempotencyKey,
			);
		} catch (error) {
			if (error instanceof ProviderError) {
				throw new GatewayRuleError("provider_unavailable");
			}
			throw error;
		}
		if (!isHostedPaymentUrl(created.url)) {
			logger.error(
				{ tenantId: tenant.id, checkoutId: attempt.id },
				"PayBridgeNP answered a checkout URL off its own https domains",
			);
			throw new GatewayRuleError("unavailable");
		}
		if (created.livemode !== account.livemode) {
			logger.error(
				{ tenantId: tenant.id, checkoutId: attempt.id },
				"PayBridgeNP answered a checkout in the other mode",
			);
			throw new GatewayRuleError("unavailable");
		}
		await withTransaction(async (trx) => {
			const row = await GatewayCheckout.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", attempt.id)
				.forUpdate()
				.firstOrFail();
			if (row.status !== "creating") return;
			await row
				.merge({
					status: "open",
					providerSessionId: created.id.slice(0, 64),
					checkoutUrl: created.url,
					expiresAt: instant(created.expiresAt),
				})
				.save();
		});
		return { checkoutId: attempt.id, checkoutUrl: created.url };
	}

	/** Expires a replaced session at PayBridgeNP so its URL can't be paid any more. */
	private async supersede(account: GatewayAccount, live: GatewayCheckout) {
		if (live.providerSessionId) {
			try {
				await this.accounts
					.apiFor(account)
					.expireCheckout(live.providerSessionId, `td-expire-${live.id}`);
			} catch (error) {
				// A payment that still settles on it is recorded all the same
				// (it is matched to this attempt's own amount).
				if (!(error instanceof ProviderError)) throw error;
			}
		}
		await live.merge({ status: "superseded" }).save();
	}

	// -------------------------------------------------------------------------
	// Reads

	/**
	 * The deposit page's `onlinePayment` (openapi.yaml, DepositOnlinePayment):
	 * whether to offer paying online, and the latest attempt of the last two
	 * days as the client may read it. `confirming` until a confirmed payment
	 * was recorded: a return from the checkout never reads as paid.
	 */
	async onlineState(
		tenant: TenantRef,
		page: Pick<DepositPage, "projectId" | "state" | "due" | "quote">,
	): Promise<OnlineState> {
		const availability = await this.accounts.availability(tenant);
		const available =
			availability.available &&
			page.state === "due" &&
			page.quote.currency === "NPR" &&
			page.due >= MIN_CHECKOUT &&
			page.due <= MAX_CHECKOUT;
		const latest = await GatewayCheckout.query()
			.where("tenant_id", tenant.id)
			.where("project_id", page.projectId)
			.whereNot("status", "superseded")
			.where(
				"created_at",
				">",
				DateTime.utc().minus({ days: 2 }).toSQL() as string,
			)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.first();
		return {
			available,
			checkout: latest
				? { id: latest.id, status: clientStatus(latest.status) }
				: null,
		};
	}

	// -------------------------------------------------------------------------
	// Confirmation: webhooks and syncs

	/**
	 * A verified webhook event for `account` (already resolved and checked by
	 * the webhook route), processed once: recorded by its id in the same
	 * transaction as its effects.
	 */
	async handleEvent(
		account: GatewayAccount,
		event: ProviderEvent,
	): Promise<"processed" | "duplicate" | "ignored"> {
		if (event.livemode !== account.livemode) return "ignored";
		const tenant = { id: account.tenantId };
		const objectId = eventObjectId(event);
		return withTransaction(async (trx) => {
			const inserted = await trx.rawQuery(
				`insert into gateway_events (tenant_id, account_id, provider_event_id, type, livemode, object_id, occurred_at, received_at)
				 values (?, ?, ?, ?, ?, nullif(?, ''), nullif(?, '')::timestamptz, now())
				 on conflict (account_id, provider_event_id) do nothing
				 returning id`,
				[
					account.tenantId,
					account.id,
					event.id.slice(0, 64),
					event.type.slice(0, 64),
					event.livemode,
					objectId?.slice(0, 64) ?? "",
					event.created
						? (DateTime.fromSeconds(event.created).toUTC().toISO() ?? "")
						: "",
				],
			);
			if (inserted.rows.length === 0) return "duplicate";
			switch (event.type) {
				case "payment.succeeded":
				case "payment.failed":
					if (objectId) await this.confirmPayment(tenant, account, objectId);
					break;
				case "payment.refunded":
				case "refund.succeeded":
					if (objectId) await this.recordRefunds(tenant, account, objectId);
					break;
				default:
					// payment.cancelled: the session stays open for another try;
					// nothing to record beyond the event itself.
					break;
			}
			await trx.rawQuery(
				"update gateway_events set processed_at = now() where account_id = ? and provider_event_id = ?",
				[account.id, event.id.slice(0, 64)],
			);
			return "processed";
		});
	}

	/**
	 * The owner's "Check status" and the reconciliation job: reads the
	 * attempt's session back once and records what it says. No loop: one
	 * read per call.
	 */
	async syncCheckout(
		tenant: TenantRef,
		checkoutId: string,
	): Promise<GatewayCheckout> {
		const checkout = await GatewayCheckout.query()
			.where("tenant_id", tenant.id)
			.where("id", checkoutId)
			.firstOrFail();
		const account = await GatewayAccount.query()
			.where("tenant_id", tenant.id)
			.where("id", checkout.accountId)
			.firstOrFail();
		const api = this.accounts.apiFor(account);
		// One read of the session, before any lock is taken.
		const session = checkout.providerSessionId
			? await api.getSession(checkout.providerSessionId)
			: null;
		await withTransaction(async (trx) => {
			// The project first, then the attempt: every project write's order.
			await this.projects.lockLive(trx, tenant, checkout.projectId);
			const row = await GatewayCheckout.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", checkoutId)
				.forUpdate()
				.firstOrFail();
			row.lastSyncedAt = DateTime.utc();
			if (!session) {
				// Never reached PayBridgeNP: given up an hour on.
				if (
					row.status === "creating" &&
					row.createdAt < DateTime.utc().minus({ hours: 1 })
				) {
					row.status = "failed";
					row.failureReason = "The checkout was never created.";
				}
			} else if (
				!session.paymentId &&
				session.status === "expired" &&
				row.status === "open"
			) {
				row.status = "expired";
			}
			await row.save();
		});
		if (session?.paymentId) {
			await this.confirmPayment(tenant, account, session.paymentId);
		}
		const payments = await GatewayPayment.query()
			.where("tenant_id", tenant.id)
			.where("checkout_id", checkout.id)
			.whereNotNull("payment_id");
		for (const payment of payments) {
			await this.recordRefunds(tenant, account, payment.providerPaymentId);
		}
		return GatewayCheckout.query()
			.where("tenant_id", tenant.id)
			.where("id", checkoutId)
			.firstOrFail();
	}

	/**
	 * Reads the payment back from the API and records it once: a success
	 * that matches its checkout becomes a verified deposit in the ledger; a
	 * failure is kept with its reason; anything else is held for review.
	 * The checkout row is locked first, so two deliveries of one payment, or
	 * two payments of one checkout, are decided one after the other.
	 */
	async confirmPayment(
		tenant: TenantRef,
		account: GatewayAccount,
		providerPaymentId: string,
	): Promise<GatewayPayment | null> {
		const payment = await this.accounts
			.apiFor(account)
			.getPayment(providerPaymentId);
		const stored = await withTransaction(async (trx) => {
			const found = await this.checkoutOf(trx, tenant, account, payment);
			// The project first, then the attempt: every project write's order,
			// so a checkout started at the same moment can't deadlock with this.
			if (found) await this.projects.lockLive(trx, tenant, found.projectId);
			const checkout = found
				? await GatewayCheckout.query({ client: trx })
						.where("tenant_id", tenant.id)
						.where("id", found.id)
						.forUpdate()
						.firstOrFail()
				: null;
			if (!checkout) {
				logger.warn(
					{ tenantId: tenant.id, accountId: account.id },
					"PayBridgeNP payment for no checkout of this studio ignored",
				);
				return null;
			}
			const stored = await this.storePayment(trx, tenant, checkout, payment);
			if (
				payment.status !== "success" ||
				stored.paymentId ||
				stored.reviewReason
			) {
				if (payment.status === "failed" && checkout.status === "open") {
					await checkout.merge({ failureReason: payment.failureReason }).save();
				}
				return stored;
			}
			let reason = reviewReasonFor(payment, checkout);
			if (!reason) {
				const recorded = await GatewayPayment.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("checkout_id", checkout.id)
					.whereNotNull("payment_id")
					.whereNot("id", stored.id)
					.first();
				if (recorded) reason = "duplicate";
			}
			if (reason) {
				logger.warn(
					{
						tenantId: tenant.id,
						checkoutId: checkout.id,
						gatewayPaymentId: stored.id,
						reason,
					},
					"Online payment held for review",
				);
				await stored.merge({ reviewReason: reason }).save();
				return stored;
			}
			const recorded = await this.payments.recordOnlineDeposit(
				tenant,
				checkout.projectId,
				{
					amount: checkout.amount,
					currency: checkout.currency,
					method: payment.method as OnlineMethod,
					note: `Paid online through PayBridgeNP${payment.providerRef ? ` (ref. ${payment.providerRef.slice(0, 64)})` : ""}.`,
				},
			);
			if (!recorded) {
				await stored.merge({ reviewReason: "project_deleted" }).save();
				return stored;
			}
			await stored.merge({ paymentId: recorded.payment.id }).save();
			await checkout.merge({ status: "paid", failureReason: null }).save();
			logger.info(
				{
					tenantId: tenant.id,
					checkoutId: checkout.id,
					paymentId: recorded.payment.id,
				},
				"Online deposit recorded",
			);
			return stored;
		});
		// A refund may have been reported before the payment was recorded.
		if (stored?.paymentId) {
			await this.recordRefunds(tenant, account, providerPaymentId);
		}
		return stored;
	}

	/**
	 * Records the refunds PayBridgeNP reports for one recorded payment: each
	 * succeeded refund once, as a negative ledger refund (gateway_refunds is
	 * unique by PayBridgeNP's refund id). Refunds of a payment held for
	 * review are kept without a ledger row: it was never recorded as income.
	 */
	async recordRefunds(
		tenant: TenantRef,
		account: GatewayAccount,
		providerPaymentId: string,
	): Promise<void> {
		const api = this.accounts.apiFor(account);
		const refunds = await api.listRefunds(providerPaymentId);
		await withTransaction(async (trx) => {
			const found = await GatewayPayment.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("provider_payment_id", providerPaymentId)
				.first();
			// Not recorded yet: confirmPayment pulls the refunds once it is.
			if (!found) return;
			await this.projects.lockLive(trx, tenant, found.projectId);
			const payment = await GatewayPayment.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", found.id)
				.forUpdate()
				.firstOrFail();
			let refunded = 0;
			for (const refund of refunds) {
				if (refund.paymentId !== providerPaymentId) continue;
				if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0)
					continue;
				const status = [
					"processing",
					"succeeded",
					"failed",
					"requires_action",
				].includes(refund.status)
					? refund.status
					: "processing";
				let row = await GatewayRefund.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("provider_refund_id", refund.id)
					.forUpdate()
					.first();
				if (!row) {
					row = await GatewayRefund.create(
						{
							tenantId: tenant.id,
							gatewayPaymentId: payment.id,
							projectId: payment.projectId,
							providerRefundId: refund.id.slice(0, 64),
							amount: refund.amount,
							currency: refund.currency.slice(0, 3) || "NPR",
							status,
							failureReason: refund.failureReason,
						},
						{ client: trx },
					);
				} else {
					await row
						.merge({ status, failureReason: refund.failureReason })
						.save();
				}
				if (status !== "succeeded") continue;
				refunded += refund.amount;
				if (row.paymentId || !payment.paymentId) continue;
				const ledger = await this.payments.recordOnlineRefund(
					tenant,
					payment.projectId,
					{
						amount: refund.amount,
						currency: row.currency,
						method: (payment.method ?? "khalti") as OnlineMethod,
						note: "Refunded through PayBridgeNP.",
					},
				);
				if (ledger) await row.merge({ paymentId: ledger.id }).save();
			}
			await payment
				.merge({
					refundedAmount: refunded,
					status:
						refunded > 0 && refunded >= payment.amount
							? "refunded"
							: payment.status,
				})
				.save();
		});
	}

	// -------------------------------------------------------------------------
	// Internals

	/** The checkout a provider payment belongs to: by its session, else by its metadata (not locked). */
	private async checkoutOf(
		trx: TransactionClientContract,
		tenant: TenantRef,
		account: GatewayAccount,
		payment: ProviderPayment,
	): Promise<GatewayCheckout | null> {
		const bySession = payment.sessionId
			? await GatewayCheckout.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("account_id", account.id)
					.where("provider_session_id", payment.sessionId)
					.first()
			: null;
		if (bySession) return bySession;
		const id = payment.metadata.td_checkout_id;
		if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
		return GatewayCheckout.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("account_id", account.id)
			.where("id", id)
			.first();
	}

	private async storePayment(
		trx: TransactionClientContract,
		tenant: TenantRef,
		checkout: GatewayCheckout,
		payment: ProviderPayment,
	): Promise<GatewayPayment> {
		const existing = await GatewayPayment.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("provider_payment_id", payment.id)
			.forUpdate()
			.first();
		const method = (
			["esewa", "khalti", "fonepay", "card"] as string[]
		).includes(payment.method)
			? payment.method
			: null;
		const values = {
			status: existing?.paymentId
				? existing.refundedAmount > 0
					? existing.status
					: "success"
				: paymentStatus(payment.status),
			method,
			providerRef: payment.providerRef?.slice(0, 128) ?? null,
			amount:
				Number.isSafeInteger(payment.amount) && payment.amount >= 0
					? payment.amount
					: 0,
			currency: payment.currency.slice(0, 3) || "NPR",
			livemode: payment.livemode,
			failureReason: payment.failureReason,
			paidAt:
				payment.status === "success"
					? (existing?.paidAt ?? DateTime.utc())
					: (existing?.paidAt ?? null),
		};
		if (existing) return existing.merge(values).save();
		return GatewayPayment.create(
			{
				tenantId: tenant.id,
				checkoutId: checkout.id,
				projectId: checkout.projectId,
				providerPaymentId: payment.id.slice(0, 64),
				...values,
			},
			{ client: trx },
		);
	}
}

/** The payment (or refund's payment) an event names. */
export function eventObjectId(
	event: Pick<ProviderEvent, "type" | "data">,
): string | null {
	const data = event.data;
	const read = (key: string) =>
		typeof data[key] === "string" && data[key] !== ""
			? (data[key] as string)
			: null;
	if (event.type === "refund.succeeded") {
		return read("paymentId") ?? read("payment_id");
	}
	if (event.type === "payment.cancelled") return read("session_id");
	return read("id") ?? read("payment_id");
}

function instant(value: string | null): DateTime | null {
	if (!value) return null;
	const parsed = DateTime.fromISO(value, { zone: "utc" });
	return parsed.isValid ? parsed : null;
}

/** Runs `fn` in the studio's context (the webhook and the jobs). */
export function inStudio<T>(
	tenantId: string,
	fn: () => Promise<T>,
): Promise<T> {
	return withDbContext({ tenantId }, () => fn());
}
