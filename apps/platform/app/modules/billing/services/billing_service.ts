import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import {
	type Access,
	accessAt,
	isPaidInFull,
	paidPeriod,
} from "#modules/billing/access";
import { BillingRuleError } from "#modules/billing/errors";
import BillingAccessPeriod from "#modules/billing/models/billing_access_period";
import BillingCustomer from "#modules/billing/models/billing_customer";
import BillingEvent from "#modules/billing/models/billing_event";
import BillingInvoice, {
	INVOICE_STATUSES,
	type InvoiceStatus,
	PAYABLE_STATUSES,
} from "#modules/billing/models/billing_invoice";
import BillingPlan from "#modules/billing/models/billing_plan";
import BillingSubscription, {
	ENDED_STATUSES,
	SUBSCRIPTION_STATUSES,
	type SubscriptionStatus,
} from "#modules/billing/models/billing_subscription";
import { PLAN_CATALOGUE } from "#modules/billing/plans";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import PaymentProviders, {
	type BillingApi,
	isHostedPaymentUrl,
	ProviderError,
	type ProviderEvent,
	type ProviderInvoice,
	type ProviderSubscription,
} from "#services/paybridge";

type TenantRef = Pick<Tenant, "id">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the studio's Billing page shows. */
export type BillingOverview = {
	configured: boolean;
	mode: "sandbox" | "live" | null;
	plans: BillingPlan[];
	subscription: BillingSubscription | null;
	invoices: BillingInvoice[];
	access: Access;
};

/** How many invoices the Billing page lists. */
export const INVOICE_HISTORY = 24;

/** A synchronised plan, for the sync command's report. */
export type SyncedPlan = {
	code: string;
	providerPlanId: string;
	created: boolean;
};

/**
 * TattooDrip's subscription billing through PayBridgeNP Billing, with
 * TattooDrip's own key only (docs/payments-paybridgenp.md). Studio owners
 * subscribe, cancel at period end, change plan for the next renewal and pay
 * open invoices through PayBridgeNP's hosted page.
 *
 * Local rows are copies of PayBridgeNP's records and are only ever written
 * from objects read back from its API (a create's answer, or a retrieve
 * after a signed webhook or an explicit sync), never from a webhook body.
 * Paid access is granted per billing period, only once that period's
 * invoice reads back as paid in full (#modules/billing/access). Every
 * write for a studio runs under its billing lock, so a webhook and a sync
 * never interleave their reads and writes.
 */
@inject()
export default class BillingService {
	constructor(private providers: PaymentProviders) {}

	/** Whether subscription billing is set up (PAYBRIDGE_SECRET_KEY). */
	configured(): boolean {
		return this.providers.platform() !== null;
	}

	private api(): BillingApi {
		const api = this.providers.platform();
		if (!api) throw new BillingRuleError("billing_unavailable");
		return api;
	}

	// -------------------------------------------------------------------------
	// Reads

	async overview(
		tenant: TenantRef,
		now = DateTime.utc(),
	): Promise<BillingOverview> {
		const api = this.providers.platform();
		const livemode = api?.mode === "live";
		const plans = api
			? await BillingPlan.query()
					.where("livemode", livemode)
					.where("active", true)
					.whereNotNull("provider_plan_id")
					.orderBy("amount")
			: [];
		const subscription = await this.latestSubscription(tenant);
		const invoices = await BillingInvoice.query()
			.where("tenant_id", tenant.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.limit(INVOICE_HISTORY);
		return {
			configured: api !== null,
			mode: api?.mode ?? null,
			plans,
			subscription,
			invoices,
			access: await this.access(tenant, now),
		};
	}

	/** The studio's access now: paid periods first, then a trial (#modules/billing/access). */
	async access(tenant: TenantRef, now = DateTime.utc()): Promise<Access> {
		const periods = await BillingAccessPeriod.query()
			.where("tenant_id", tenant.id)
			.where("ends_at", ">", now.toSQL() as string);
		const live = await this.liveSubscription(tenant);
		return accessAt(periods, live, now);
	}

	/** The subscription that can still bill, or null. */
	async liveSubscription(
		tenant: TenantRef,
	): Promise<BillingSubscription | null> {
		return BillingSubscription.query()
			.where("tenant_id", tenant.id)
			.whereNotIn("status", ENDED_STATUSES as SubscriptionStatus[])
			.first();
	}

	/** The live subscription, else the latest one. */
	async latestSubscription(
		tenant: TenantRef,
	): Promise<BillingSubscription | null> {
		return (
			(await this.liveSubscription(tenant)) ??
			(await BillingSubscription.query()
				.where("tenant_id", tenant.id)
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.first())
		);
	}

	// -------------------------------------------------------------------------
	// Owner actions

	/**
	 * Starts a subscription on `planCode`. The customer is created once per
	 * studio and mode (`externalCustomerId` is the studio's id); both calls
	 * carry stable idempotency keys, so a retried request gets PayBridgeNP's
	 * first answer instead of a second customer or subscription.
	 */
	async subscribe(
		tenant: Pick<Tenant, "id" | "name">,
		owner: { userId: string; email: string },
		planCode: string,
	): Promise<BillingSubscription> {
		const api = this.api();
		// A subscription still counted as live may have ended at PayBridgeNP
		// (expired unpaid, cancelled at period end): read it back first, in a
		// step of its own, so the answer below is the provider's.
		await withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			const live = await this.liveSubscription(tenant);
			if (!live) return;
			const fresh = await provider(() =>
				api.getSubscription(live.providerSubscriptionId),
			);
			await this.storeSubscription(api, tenant.id, fresh);
		});
		// The customer in a step of its own: once PayBridgeNP has created it,
		// the row stays, whatever happens to the subscription below, so its
		// webhooks always find the studio.
		const { plan, customer } = await withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			if (await this.liveSubscription(tenant)) {
				throw new BillingRuleError("already_subscribed");
			}
			return {
				plan: await this.availablePlan(api, planCode),
				customer: await this.ensureCustomer(api, tenant, owner.email),
			};
		});
		return withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			if (await this.liveSubscription(tenant)) {
				throw new BillingRuleError("already_subscribed");
			}
			// A subscription PayBridgeNP made for an earlier try whose answer was
			// lost (a timeout, a rollback) is adopted, never made twice.
			const existing = (
				await provider(() => api.listSubscriptions(customer.providerCustomerId))
			).find(
				(found) =>
					!(ENDED_STATUSES as readonly string[]).includes(found.status),
			);
			if (existing) {
				const adopted = await this.storeSubscription(
					api,
					tenant.id,
					existing,
					owner.userId,
				);
				await this.syncInvoices(api, tenant.id, adopted);
				return adopted;
			}
			const attempts = await BillingSubscription.query()
				.where("tenant_id", tenant.id)
				.count("* as total");
			const attempt = Number(attempts[0].$extras.total) + 1;
			const created = await provider(() =>
				api.createSubscription(
					{
						customerId: customer.providerCustomerId,
						planId: plan.providerPlanId as string,
						referenceId: tenant.id,
						metadata: { tenant_id: tenant.id, plan_code: plan.code },
					},
					`td-billing-subscription-${tenant.id}-${api.mode}-${attempt}`,
				),
			);
			const subscription = await this.storeSubscription(
				api,
				tenant.id,
				created,
				owner.userId,
			);
			await this.syncInvoices(api, tenant.id, subscription);
			return subscription;
		});
	}

	/** Cancels at the end of the paid period (PayBridgeNP `atPeriodEnd`). */
	async cancelAtPeriodEnd(tenant: TenantRef): Promise<BillingSubscription> {
		const api = this.api();
		return withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			const live = await this.liveSubscription(tenant);
			if (!live) throw new BillingRuleError("no_subscription");
			await provider(() => api.cancelAtPeriodEnd(live.providerSubscriptionId));
			// The cancel answer has no expanded customer: read the record back.
			const fresh = await provider(() =>
				api.getSubscription(live.providerSubscriptionId),
			);
			return this.storeSubscription(api, tenant.id, fresh);
		});
	}

	/**
	 * Schedules `planCode` for the next renewal (PayBridgeNP: "The current
	 * period continues on the old plan"); no proration.
	 */
	async changePlan(
		tenant: TenantRef,
		planCode: string,
	): Promise<BillingSubscription> {
		const api = this.api();
		return withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			const live = await this.liveSubscription(tenant);
			if (!live) throw new BillingRuleError("no_subscription");
			const plan = await this.availablePlan(api, planCode);
			if (plan.id === live.planId && !live.pendingPlanId) {
				throw new BillingRuleError("same_plan");
			}
			await provider(() =>
				api.changePlan(
					live.providerSubscriptionId,
					plan.providerPlanId as string,
				),
			);
			const fresh = await provider(() =>
				api.getSubscription(live.providerSubscriptionId),
			);
			return this.storeSubscription(api, tenant.id, fresh);
		});
	}

	/**
	 * Where to pay an invoice: its hosted page, read fresh from the API (the
	 * link can rotate). Null when it turned out to be paid meanwhile; the
	 * fresh copy is stored either way.
	 */
	async payUrl(tenant: TenantRef, invoiceId: string): Promise<string | null> {
		const api = this.api();
		return withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			const invoice = await BillingInvoice.query()
				.where("tenant_id", tenant.id)
				.where("id", invoiceId)
				.firstOrFail();
			const fresh = await provider(() =>
				api.getInvoice(invoice.providerInvoiceId),
			);
			const stored = await this.storeInvoice(api, tenant.id, fresh);
			if (stored?.status === "paid") return null;
			if (
				!stored ||
				!PAYABLE_STATUSES.includes(stored.status) ||
				!isHostedPaymentUrl(stored.hostedInvoiceUrl)
			) {
				throw new BillingRuleError("not_payable");
			}
			return stored.hostedInvoiceUrl;
		});
	}

	/** Reads the studio's subscriptions and their invoices back from the API (the owner's "Check for updates", the daily reconciliation). */
	async syncTenant(tenant: TenantRef): Promise<void> {
		const api = this.api();
		await withTransaction(async (trx) => {
			await lockBilling(trx, tenant.id);
			const subscriptions = await BillingSubscription.query()
				.where("tenant_id", tenant.id)
				.where((query) =>
					query
						.whereNotIn("status", ENDED_STATUSES as SubscriptionStatus[])
						.orWhere(
							"updated_at",
							">",
							DateTime.utc().minus({ days: 40 }).toSQL() as string,
						),
				);
			for (const subscription of subscriptions) {
				const fresh = await provider(() =>
					api.getSubscription(subscription.providerSubscriptionId),
				);
				const stored = await this.storeSubscription(api, tenant.id, fresh);
				await this.syncInvoices(api, tenant.id, stored);
			}
		});
	}

	// -------------------------------------------------------------------------
	// Webhooks

	/**
	 * The studio a platform event is about, by its billing customer. The id
	 * comes from the event's object, or from the object read back from the
	 * API when the event doesn't carry it; null for an event about no studio
	 * (a plan, a coupon) or a customer TattooDrip doesn't know.
	 */
	async tenantForEvent(event: ProviderEvent): Promise<string | null> {
		try {
			return await this.studioOfEvent(event);
		} catch (error) {
			// An object the platform's project doesn't have is about no studio.
			if (error instanceof ProviderError && error.kind === "not_found") {
				return null;
			}
			throw error;
		}
	}

	private async studioOfEvent(event: ProviderEvent): Promise<string | null> {
		const target = eventTarget(event);
		if (!target) return null;
		const api = this.api();
		let customerId = customerOf(event.data);
		let externalId: string | null = null;
		if (!customerId) {
			const object =
				target.kind === "invoice"
					? await api.getInvoice(target.id)
					: await api.getSubscription(target.id);
			customerId = object.customerId;
			externalId = object.customerExternalId;
		}
		if (!customerId) return null;
		const { rows } = await dbClient().rawQuery(
			"select public.billing_tenant_for_customer(?) as tenant_id",
			[customerId],
		);
		const known = (rows[0]?.tenant_id as string | null) ?? null;
		if (known) return known;
		// A customer whose local row was lost (its creating request failed
		// after PayBridgeNP answered): TattooDrip set its external id to the
		// studio's id, read here from the API, never from the event body.
		if (externalId === null) {
			const object =
				target.kind === "invoice"
					? await api.getInvoice(target.id)
					: await api.getSubscription(target.id);
			if (object.customerId !== customerId) return null;
			externalId = object.customerExternalId;
		}
		return externalId && UUID.test(externalId) ? externalId : null;
	}

	/**
	 * Processes a verified platform event for `tenantId`, once: the event is
	 * recorded by its id in the same transaction as its effects, so a repeat
	 * (or one racing the first) does nothing, and a failure rolls both back
	 * for PayBridgeNP to retry. The object is read back from the API under
	 * the studio's billing lock; the event body is never trusted for state.
	 */
	async handleEvent(
		tenantId: string,
		event: ProviderEvent,
	): Promise<"processed" | "duplicate"> {
		const api = this.api();
		const target = eventTarget(event);
		return withDbContext({ tenantId }, async (trx) => {
			const inserted = await trx.rawQuery(
				`insert into billing_events (tenant_id, provider_event_id, type, livemode, object_id, occurred_at, received_at)
				 values (?, ?, ?, ?, nullif(?, ''), nullif(?, '')::timestamptz, now())
				 on conflict (provider_event_id) do nothing
				 returning id`,
				[
					tenantId,
					event.id,
					event.type.slice(0, 64),
					event.livemode,
					target?.id.slice(0, 64) ?? "",
					event.created
						? (DateTime.fromSeconds(event.created).toUTC().toISO() ?? "")
						: "",
				],
			);
			if (inserted.rows.length === 0) return "duplicate";
			await lockBilling(trx, tenantId);
			await this.adoptCustomer(api, tenantId, target);
			if (target?.kind === "subscription") {
				const fresh = await api.getSubscription(target.id);
				if (await this.ownsCustomer(api, tenantId, fresh.customerId)) {
					const stored = await this.storeSubscription(api, tenantId, fresh);
					await this.syncInvoices(api, tenantId, stored);
				}
			} else if (target?.kind === "invoice") {
				const fresh = await api.getInvoice(target.id);
				await this.storeInvoice(api, tenantId, fresh);
			}
			await BillingEvent.query({ client: trx })
				.where("provider_event_id", event.id)
				.update({ processedAt: DateTime.utc().toSQL() });
			return "processed";
		});
	}

	// -------------------------------------------------------------------------
	// Plans

	/**
	 * Creates every catalogue plan missing in the platform key's mode
	 * (`node ace billing:sync-plans`). The idempotency key names the plan's
	 * code, price and interval, so a rerun inside PayBridgeNP's 24-hour
	 * window returns the same plan.
	 */
	async syncPlans(): Promise<SyncedPlan[]> {
		const api = this.api();
		const livemode = api.mode === "live";
		const synced: SyncedPlan[] = [];
		for (const entry of PLAN_CATALOGUE) {
			const existing = await BillingPlan.query()
				.where("code", entry.code)
				.where("livemode", livemode)
				.first();
			if (existing?.providerPlanId) {
				synced.push({
					code: entry.code,
					providerPlanId: existing.providerPlanId,
					created: false,
				});
				continue;
			}
			const created = await provider(() =>
				api.createPlan(
					{
						name: entry.name,
						amount: entry.amount,
						intervalUnit: entry.intervalUnit,
						intervalCount: entry.intervalCount,
						trialDays: entry.trialDays,
						metadata: { tattoo_drip_plan: entry.code },
					},
					`td-billing-plan-${entry.code}-${entry.amount}-${entry.intervalCount}${entry.intervalUnit}-${api.mode}`,
				),
			);
			const values = {
				code: entry.code,
				name: entry.name,
				amount: entry.amount,
				currency: "NPR",
				intervalUnit: entry.intervalUnit,
				intervalCount: entry.intervalCount,
				trialDays: entry.trialDays,
				livemode,
				providerPlanId: created.id,
				active: true,
			};
			if (existing) await existing.merge(values).save();
			else await BillingPlan.create(values);
			synced.push({
				code: entry.code,
				providerPlanId: created.id,
				created: true,
			});
		}
		return synced;
	}

	// -------------------------------------------------------------------------
	// Internals

	private async availablePlan(api: BillingApi, code: string) {
		const plan = await BillingPlan.query()
			.where("code", code)
			.where("livemode", api.mode === "live")
			.where("active", true)
			.whereNotNull("provider_plan_id")
			.first();
		if (!plan) throw new BillingRuleError("plan_unavailable");
		return plan;
	}

	private async ensureCustomer(
		api: BillingApi,
		tenant: Pick<Tenant, "id" | "name">,
		email: string,
	): Promise<BillingCustomer> {
		const livemode = api.mode === "live";
		const existing = await BillingCustomer.query()
			.where("tenant_id", tenant.id)
			.where("livemode", livemode)
			.first();
		if (existing) return existing;
		const created = await provider(() =>
			api.createCustomer(
				{
					name: tenant.name.slice(0, 200),
					email,
					externalCustomerId: tenant.id,
					metadata: { tenant_id: tenant.id },
				},
				`td-billing-customer-${tenant.id}-${api.mode}`,
			),
		);
		if (
			created.externalCustomerId &&
			created.externalCustomerId !== tenant.id
		) {
			throw new BillingRuleError("provider_refused");
		}
		return BillingCustomer.create({
			tenantId: tenant.id,
			livemode,
			providerCustomerId: created.id,
		});
	}

	/**
	 * Records the studio's billing customer when PayBridgeNP has it and the
	 * studio doesn't (see tenantForEvent): read from the API, and only a
	 * customer whose external id is this studio's.
	 */
	private async adoptCustomer(
		api: BillingApi,
		tenantId: string,
		target: { kind: "subscription" | "invoice"; id: string } | null,
	) {
		if (!target) return;
		const livemode = api.mode === "live";
		const known = await BillingCustomer.query()
			.where("tenant_id", tenantId)
			.where("livemode", livemode)
			.first();
		if (known) return;
		const object =
			target.kind === "invoice"
				? await api.getInvoice(target.id)
				: await api.getSubscription(target.id);
		if (
			!object.customerId ||
			object.customerExternalId !== tenantId ||
			object.livemode !== livemode
		) {
			return;
		}
		await BillingCustomer.create({
			tenantId,
			livemode,
			providerCustomerId: object.customerId,
		});
	}

	/** Whether `customerId` is this studio's billing customer in the key's mode. */
	private async ownsCustomer(
		api: BillingApi,
		tenantId: string,
		customerId: string | null,
	): Promise<boolean> {
		if (!customerId) return false;
		const customer = await BillingCustomer.query()
			.where("tenant_id", tenantId)
			.where("livemode", api.mode === "live")
			.where("provider_customer_id", customerId)
			.first();
		if (!customer) {
			logger.warn(
				{ tenantId, provider: "paybridgenp" },
				"Billing object for another customer ignored",
			);
		}
		return customer !== null;
	}

	/** Upserts a subscription read from the API; refuses one of another customer or mode. */
	private async storeSubscription(
		api: BillingApi,
		tenantId: string,
		fresh: ProviderSubscription,
		createdByUserId?: string,
	): Promise<BillingSubscription> {
		const livemode = api.mode === "live";
		if (fresh.livemode !== livemode) {
			throw new Error("A billing subscription from the other mode was read");
		}
		const customer = await BillingCustomer.query()
			.where("tenant_id", tenantId)
			.where("livemode", livemode)
			.where("provider_customer_id", fresh.customerId ?? "")
			.firstOrFail();
		const plans = await BillingPlan.query().whereIn(
			"provider_plan_id",
			[fresh.planId, fresh.pendingPlanId].filter((id): id is string => !!id),
		);
		const planOf = (id: string | null) =>
			plans.find((plan) => plan.providerPlanId === id)?.id ?? null;
		const existing = await BillingSubscription.query()
			.where("tenant_id", tenantId)
			.where("provider_subscription_id", fresh.id)
			.first();
		const status = asStatus(fresh.status, existing?.status);
		const values = {
			customerId: customer.id,
			planId: planOf(fresh.planId) ?? existing?.planId ?? null,
			pendingPlanId: planOf(fresh.pendingPlanId),
			status,
			livemode,
			currentPeriodStart: instant(fresh.currentPeriodStart),
			currentPeriodEnd: instant(fresh.currentPeriodEnd),
			nextInvoiceAt: instant(fresh.nextInvoiceAt),
			trialEndsAt: instant(fresh.trialEndsAt),
			cancelAtPeriodEnd: fresh.cancelAtPeriodEnd,
			canceledAt: instant(fresh.canceledAt),
			cancelEffectiveAt: instant(fresh.cancelEffectiveAt),
			endedAt: instant(fresh.endedAt),
			pausedAt: instant(fresh.pausedAt),
			syncedAt: DateTime.utc(),
		};
		if (existing) return existing.merge(values).save();
		// Another local subscription still counted as live (it ended at the
		// provider without word reaching us): refresh it first, so the one
		// live subscription per studio holds.
		if (!(ENDED_STATUSES as string[]).includes(status)) {
			const stale = await BillingSubscription.query()
				.where("tenant_id", tenantId)
				.whereNotIn("status", ENDED_STATUSES as SubscriptionStatus[])
				.first();
			if (stale) {
				const read = await provider(() =>
					api.getSubscription(stale.providerSubscriptionId),
				);
				await stale
					.merge({
						status: asStatus(read.status, stale.status),
						endedAt: instant(read.endedAt),
						syncedAt: DateTime.utc(),
					})
					.save();
			}
		}
		return BillingSubscription.create({
			tenantId,
			providerSubscriptionId: fresh.id,
			createdByUserId: createdByUserId ?? null,
			...values,
		});
	}

	private async syncInvoices(
		api: BillingApi,
		tenantId: string,
		subscription: BillingSubscription,
	): Promise<void> {
		const invoices = await provider(() =>
			api.listInvoices(subscription.providerSubscriptionId),
		);
		for (const invoice of invoices) {
			await this.storeInvoice(api, tenantId, invoice, subscription);
		}
	}

	/**
	 * Upserts an invoice read from the API and, once it is paid in full,
	 * grants its period (once: unique per invoice). The period is stored the
	 * first time the invoice is seen and never moved. An invoice of another
	 * customer, another mode or no subscription is ignored.
	 */
	private async storeInvoice(
		api: BillingApi,
		tenantId: string,
		fresh: ProviderInvoice,
		knownSubscription?: BillingSubscription,
	): Promise<BillingInvoice | null> {
		const livemode = api.mode === "live";
		if (fresh.livemode !== livemode || !fresh.subscriptionId) return null;
		if (!(await this.ownsCustomer(api, tenantId, fresh.customerId))) {
			return null;
		}
		let subscription =
			knownSubscription?.providerSubscriptionId === fresh.subscriptionId
				? knownSubscription
				: await BillingSubscription.query()
						.where("tenant_id", tenantId)
						.where("provider_subscription_id", fresh.subscriptionId)
						.first();
		if (!subscription) {
			const read = await provider(() =>
				api.getSubscription(fresh.subscriptionId as string),
			);
			subscription = await this.storeSubscription(api, tenantId, read);
		}
		const existing = await BillingInvoice.query()
			.where("tenant_id", tenantId)
			.where("provider_invoice_id", fresh.id)
			.first();
		const values = {
			subscriptionId: subscription.id,
			number: fresh.number?.slice(0, 64) ?? null,
			status: asInvoiceStatus(fresh.status, existing?.status),
			amountDue: safeAmount(fresh.amountDue),
			amountPaid: safeAmount(fresh.amountPaid),
			currency: fresh.currency.slice(0, 3) || "NPR",
			issuedAt: instant(fresh.issuedAt),
			dueAt: instant(fresh.dueAt),
			paidAt: instant(fresh.paidAt),
			hostedInvoiceUrl: isHostedPaymentUrl(fresh.hostedUrl)
				? fresh.hostedUrl
				: null,
			livemode,
			syncedAt: DateTime.utc(),
		};
		const invoice = existing
			? await existing.merge(values).save()
			: await BillingInvoice.create({
					tenantId,
					providerInvoiceId: fresh.id,
					periodStart: instant(fresh.periodStart),
					periodEnd: instant(fresh.periodEnd),
					...values,
				});
		if (isPaidInFull(fresh)) {
			await this.grant(tenantId, invoice, subscription);
		}
		return invoice;
	}

	private async grant(
		tenantId: string,
		invoice: BillingInvoice,
		subscription: BillingSubscription,
	) {
		const plan = subscription.planId
			? await BillingPlan.find(subscription.planId)
			: null;
		const period = paidPeriod(invoice, plan);
		if (!period) {
			logger.warn(
				{ tenantId, invoiceId: invoice.id },
				"Paid invoice without a period or plan: no access granted",
			);
			return;
		}
		await dbClient().rawQuery(
			`insert into billing_access_periods (tenant_id, invoice_id, starts_at, ends_at, created_at)
			 values (?, ?, ?, ?, now())
			 on conflict (invoice_id) do nothing`,
			[
				tenantId,
				invoice.id,
				period.startsAt.toUTC().toISO() as string,
				period.endsAt.toUTC().toISO() as string,
			],
		);
	}
}

/** The studio's billing lock, held to the end of the transaction. */
async function lockBilling(trx: TransactionClientContract, tenantId: string) {
	await trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
		`billing:${tenantId}`,
	]);
}

/** A provider call whose failure the owner reads as a BillingRuleError. */
async function provider<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (error instanceof ProviderError) {
			throw new BillingRuleError(
				error.retryable || error.kind === "unavailable"
					? "provider_unavailable"
					: "provider_refused",
			);
		}
		throw error;
	}
}

/** What an event is about: a subscription or an invoice, by id. */
export function eventTarget(
	event: Pick<ProviderEvent, "type" | "data">,
): { kind: "subscription" | "invoice"; id: string } | null {
	const kind = event.type.startsWith("subscription.")
		? "subscription"
		: event.type.startsWith("invoice.")
			? "invoice"
			: null;
	if (!kind) return null;
	const data = event.data;
	const nested = data[kind];
	const id =
		typeof data.id === "string"
			? data.id
			: typeof data[`${kind}_id`] === "string"
				? (data[`${kind}_id`] as string)
				: nested && typeof nested === "object" && "id" in nested
					? String((nested as { id: unknown }).id)
					: null;
	return id ? { kind, id } : null;
}

function customerOf(data: Record<string, unknown>): string | null {
	if (typeof data.customer_id === "string") return data.customer_id;
	const customer = data.customer;
	if (customer && typeof customer === "object" && "id" in customer) {
		const id = (customer as { id: unknown }).id;
		return typeof id === "string" ? id : null;
	}
	return null;
}

/** A known status, else the stored one (logged): a new provider status never breaks a sync. */
function asStatus(
	status: string,
	current: SubscriptionStatus | undefined,
): SubscriptionStatus {
	if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
		return status as SubscriptionStatus;
	}
	logger.warn(
		{ status },
		"Unknown PayBridgeNP subscription status kept as before",
	);
	return current ?? "incomplete";
}

function asInvoiceStatus(
	status: string,
	current: InvoiceStatus | undefined,
): InvoiceStatus {
	if ((INVOICE_STATUSES as readonly string[]).includes(status)) {
		return status as InvoiceStatus;
	}
	logger.warn({ status }, "Unknown PayBridgeNP invoice status kept as before");
	return current ?? "open";
}

function instant(value: string | null): DateTime | null {
	if (!value) return null;
	const parsed = DateTime.fromISO(value, { zone: "utc" });
	return parsed.isValid ? parsed : null;
}

function safeAmount(value: number): number {
	return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
		? value
		: 0;
}
