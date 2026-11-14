import { createHmac, randomBytes } from "node:crypto";
import app from "@adonisjs/core/services/app";
import PaymentProviders, {
	type BillingApi,
	type CheckoutInput,
	type GatewayApi,
	modeOfKey,
	type ProviderAccount,
	ProviderError,
	type ProviderInvoice,
	type ProviderMode,
	type ProviderPayment,
	type ProviderRefund,
	type ProviderSession,
	type ProviderSubscription,
} from "#services/paybridge";

/**
 * An in-memory PayBridgeNP for the tests (docs/payments-paybridgenp.md):
 * every suite gets it through `installFakePaybridge()` in tests/bootstrap.ts,
 * so no test ever reaches the network. It keeps what the API would (plans,
 * customers, subscriptions, invoices, checkout sessions, payments, refunds,
 * webhook endpoints), records each call with its idempotency key, replays
 * the first answer for a repeated key like the real API, and can be told to
 * fail the next call of a method. Webhook signatures are the real scheme
 * (`sign`), checked by the real SDK's constructEvent.
 */

export const PLATFORM_KEY = "sk_test_platform0123456789";
export const PLATFORM_WEBHOOK_SECRET = "whsec_platform0123456789";
export const PLATFORM_ACCOUNT: ProviderAccount = {
	merchantId: "mer_tattoodrip",
	merchantName: "TattooDrip",
	projectId: "proj_tattoodrip_billing",
	projectName: "TattooDrip billing",
	mode: "sandbox",
};

type Call = { method: string; idempotencyKey?: string; key?: string };

/** The `X-PayBridgeNP-Signature` header PayBridgeNP would send for `body`. */
export function sign(
	body: string,
	secret: string,
	at: number = Math.floor(Date.now() / 1000),
): string {
	const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
	return `t=${at},v1=${v1}`;
}

let counter = 0;
const id = (prefix: string) =>
	`${prefix}_${(++counter).toString(36)}${randomBytes(4).toString("hex")}`;

export class FakePaybridge extends PaymentProviders {
	calls: Call[] = [];
	/** Studio keys the fake knows, with the account each opens. */
	studioAccounts = new Map<string, ProviderAccount>();
	plans = new Map<string, { id: string; livemode: boolean }>();
	customers = new Map<
		string,
		{ id: string; externalCustomerId: string | null }
	>();
	subscriptions = new Map<string, ProviderSubscription>();
	invoices = new Map<string, ProviderInvoice>();
	sessions = new Map<
		string,
		ProviderSession & { key: string; url: string; returnUrl?: string }
	>();
	payments = new Map<string, ProviderPayment & { key: string }>();
	refunds = new Map<string, ProviderRefund>();
	webhooks = new Map<
		string,
		{ id: string; url: string; secret: string; key: string }
	>();
	/** Answers kept per idempotency key, like PayBridgeNP's 24-hour store. */
	replays = new Map<string, unknown>();
	/** The next call of each method fails with this error. */
	failures = new Map<string, ProviderError>();
	platformEnabled = true;

	reset() {
		this.calls = [];
		this.studioAccounts.clear();
		this.plans.clear();
		this.customers.clear();
		this.subscriptions.clear();
		this.invoices.clear();
		this.sessions.clear();
		this.payments.clear();
		this.refunds.clear();
		this.webhooks.clear();
		this.replays.clear();
		this.failures.clear();
		this.platformEnabled = true;
	}

	/** Makes the next call of `method` fail, e.g. failNext("checkout.create", "unavailable"). */
	failNext(
		method: string,
		kind: ProviderError["kind"] = "unavailable",
		code?: string,
	) {
		this.failures.set(
			method,
			new ProviderError(
				kind,
				code,
				kind === "unavailable" ? 503 : 400,
				"req_fake",
			),
		);
	}

	/** A studio key that opens its own account (merchant and project). */
	studioKey(name = "studio", mode: ProviderMode = "sandbox"): string {
		const key = `${mode === "live" ? "sk_live_" : "sk_test_"}${name}${randomBytes(6).toString("hex")}`;
		this.studioAccounts.set(key, {
			merchantId: id("mer"),
			merchantName: `${name} merchant`,
			projectId: id("proj"),
			projectName: `${name} project`,
			mode,
		});
		return key;
	}

	private record(method: string, idempotencyKey?: string, key?: string) {
		this.calls.push({ method, idempotencyKey, key });
		const failure = this.failures.get(method);
		if (failure) {
			this.failures.delete(method);
			throw failure;
		}
	}

	private replay<T>(method: string, idempotencyKey: string, make: () => T): T {
		const slot = `${method}:${idempotencyKey}`;
		if (this.replays.has(slot)) return this.replays.get(slot) as T;
		const answer = make();
		this.replays.set(slot, answer);
		return answer;
	}

	callsOf(method: string) {
		return this.calls.filter((call) => call.method === method);
	}

	// -------------------------------------------------------------------------
	// Platform billing

	override platform(): BillingApi | null {
		if (!this.platformEnabled) return null;
		const fake = this;
		const live = false;
		return {
			mode: "sandbox",
			async account() {
				fake.record("account");
				return PLATFORM_ACCOUNT;
			},
			async createPlan(input, key) {
				fake.record("plans.create", key);
				return fake.replay("plans.create", key, () => {
					const plan = { id: id("bpl"), livemode: live };
					fake.plans.set(plan.id, plan);
					void input;
					return plan;
				});
			},
			async createCustomer(input, key) {
				fake.record("customers.create", key);
				return fake.replay("customers.create", key, () => {
					const customer = {
						id: id("bc"),
						externalCustomerId: input.externalCustomerId,
						livemode: live,
					};
					fake.customers.set(customer.id, customer);
					return customer;
				});
			},
			async createSubscription(input, key) {
				fake.record("subscriptions.create", key);
				return fake.replay("subscriptions.create", key, () => {
					const subscription: ProviderSubscription = {
						id: id("sub"),
						status: "incomplete",
						customerId: input.customerId,
						customerExternalId:
							fake.customers.get(input.customerId)?.externalCustomerId ?? null,
						planId: input.planId,
						pendingPlanId: null,
						currentPeriodStart: "2026-11-01T00:00:00.000Z",
						currentPeriodEnd: "2026-12-01T00:00:00.000Z",
						nextInvoiceAt: "2026-12-01T00:00:00.000Z",
						trialEndsAt: null,
						cancelAtPeriodEnd: false,
						canceledAt: null,
						cancelEffectiveAt: null,
						endedAt: null,
						pausedAt: null,
						latestInvoiceId: null,
						referenceId: input.referenceId,
						livemode: live,
					};
					fake.subscriptions.set(subscription.id, subscription);
					fake.issueInvoice(subscription.id, 250_000);
					return { ...subscription };
				});
			},
			async getSubscription(subscriptionId) {
				fake.record("subscriptions.get");
				const found = fake.subscriptions.get(subscriptionId);
				if (!found)
					throw new ProviderError("not_found", "not_found", 404, "req_fake");
				return { ...found };
			},
			async listSubscriptions(customerId) {
				fake.record("subscriptions.list");
				return [...fake.subscriptions.values()]
					.filter((subscription) => subscription.customerId === customerId)
					.map((subscription) => ({ ...subscription }));
			},
			async cancelAtPeriodEnd(subscriptionId) {
				fake.record("subscriptions.cancel");
				const found = fake.subscriptions.get(subscriptionId);
				if (!found)
					throw new ProviderError("not_found", "not_found", 404, "req_fake");
				found.cancelAtPeriodEnd = true;
				found.cancelEffectiveAt = found.currentPeriodEnd;
				return { ...found, customerId: null };
			},
			async changePlan(subscriptionId, planId) {
				fake.record("subscriptions.changePlan");
				const found = fake.subscriptions.get(subscriptionId);
				if (!found)
					throw new ProviderError("not_found", "not_found", 404, "req_fake");
				found.pendingPlanId = planId;
			},
			async getInvoice(invoiceId) {
				fake.record("invoices.get");
				const found = fake.invoices.get(invoiceId);
				if (!found)
					throw new ProviderError("not_found", "not_found", 404, "req_fake");
				return { ...found };
			},
			async listInvoices(subscriptionId) {
				fake.record("invoices.list");
				return [...fake.invoices.values()]
					.filter((invoice) => invoice.subscriptionId === subscriptionId)
					.map((invoice) => ({ ...invoice }));
			},
		};
	}

	override platformWebhookSecret(): string | null {
		return this.platformEnabled ? PLATFORM_WEBHOOK_SECRET : null;
	}

	/** Issues an open invoice for the subscription's current period. */
	issueInvoice(subscriptionId: string, amount: number): ProviderInvoice {
		const subscription = this.subscriptions.get(subscriptionId);
		if (!subscription) throw new Error("no such subscription");
		const invoice: ProviderInvoice = {
			id: id("inv"),
			number: `TEST-${counter}`,
			status: "open",
			amountDue: amount,
			amountPaid: 0,
			currency: "NPR",
			issuedAt: subscription.currentPeriodStart,
			dueAt: subscription.currentPeriodStart,
			paidAt: null,
			hostedUrl: `https://checkout.paybridgenp.com/invoice/${counter}`,
			customerId: subscription.customerId,
			customerExternalId: subscription.customerExternalId,
			subscriptionId,
			periodStart: subscription.currentPeriodStart,
			periodEnd: subscription.currentPeriodEnd,
			livemode: subscription.livemode,
		};
		this.invoices.set(invoice.id, invoice);
		subscription.latestInvoiceId = invoice.id;
		return invoice;
	}

	/** The customer paid the invoice on PayBridgeNP's page (in full unless `amount`). */
	payInvoice(invoiceId: string, amount?: number) {
		const invoice = this.invoices.get(invoiceId);
		if (!invoice) throw new Error("no such invoice");
		invoice.amountPaid = amount ?? invoice.amountDue;
		invoice.status = invoice.amountPaid >= invoice.amountDue ? "paid" : "open";
		invoice.paidAt = "2026-11-02T10:00:00.000Z";
		const subscription = invoice.subscriptionId
			? this.subscriptions.get(invoice.subscriptionId)
			: undefined;
		if (subscription && invoice.status === "paid")
			subscription.status = "active";
	}

	// -------------------------------------------------------------------------
	// Studios' own projects

	override studio(secretKey: string): GatewayApi {
		const fake = this;
		const mode = modeOfKey(secretKey) ?? "sandbox";
		const live = mode === "live";
		const account = () => {
			const found = fake.studioAccounts.get(secretKey);
			if (!found)
				throw new ProviderError("auth", "api_key_invalid", 401, "req_fake");
			return found;
		};
		return {
			mode,
			async account() {
				fake.record("account", undefined, secretKey);
				return account();
			},
			async createCheckout(input: CheckoutInput, key: string) {
				fake.record("checkout.create", key, secretKey);
				account();
				return fake.replay("checkout.create", key, () => {
					const session = {
						id: id("cs"),
						status: "pending",
						amount: input.amount,
						currency: input.currency,
						paymentId: null,
						metadata: { ...input.metadata },
						expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
						livemode: live,
						key: secretKey,
						url: `https://checkout.paybridgenp.com/checkout/${counter}`,
						returnUrl: input.returnUrl,
					};
					fake.sessions.set(session.id, session);
					return {
						id: session.id,
						url: session.url,
						expiresAt: session.expiresAt,
						livemode: live,
					};
				});
			},
			async getSession(sessionId) {
				fake.record("sessions.retrieve", undefined, secretKey);
				const found = fake.sessions.get(sessionId);
				if (!found || found.key !== secretKey) {
					throw new ProviderError("not_found", "not_found", 404, "req_fake");
				}
				const { key: _key, url: _url, returnUrl: _return, ...session } = found;
				return { ...session, metadata: { ...session.metadata } };
			},
			async expireCheckout(sessionId, key) {
				fake.record("checkout.expire", key, secretKey);
				const found = fake.sessions.get(sessionId);
				if (found && found.status !== "success") found.status = "expired";
			},
			async getPayment(paymentId) {
				fake.record("payments.retrieve", undefined, secretKey);
				const found = fake.payments.get(paymentId);
				if (!found || found.key !== secretKey) {
					throw new ProviderError("not_found", "not_found", 404, "req_fake");
				}
				const { key: _key, ...payment } = found;
				return { ...payment, metadata: { ...payment.metadata } };
			},
			async listRefunds(paymentId) {
				fake.record("refunds.list", undefined, secretKey);
				return [...fake.refunds.values()].filter(
					(refund) => refund.paymentId === paymentId,
				);
			},
			async registerWebhook(url, _events, key) {
				fake.record("webhooks.create", key, secretKey);
				account();
				return fake.replay("webhooks.create", key, () => {
					const endpoint = {
						id: id("we"),
						url,
						secret: `whsec_${randomBytes(12).toString("hex")}`,
						key: secretKey,
					};
					fake.webhooks.set(endpoint.id, endpoint);
					return { id: endpoint.id, secret: endpoint.secret };
				});
			},
			async deleteWebhook(webhookId) {
				fake.record("webhooks.delete", undefined, secretKey);
				fake.webhooks.delete(webhookId);
			},
		};
	}

	/** The webhook endpoint registered with `secretKey`, as PayBridgeNP keeps it. */
	webhookOf(secretKey: string) {
		const found = [...this.webhooks.values()].find(
			(endpoint) => endpoint.key === secretKey,
		);
		if (!found) throw new Error("no webhook registered with this key");
		return found;
	}

	/**
	 * The client pays the session: a payment is created as PayBridgeNP would
	 * record it. `overrides` changes what the provider reports (an amount
	 * mismatch, another method, a failure).
	 */
	pay(
		sessionId: string,
		overrides: Partial<ProviderPayment> = {},
	): ProviderPayment & { key: string } {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error("no such session");
		const payment = {
			id: id("pay"),
			status: "success",
			amount: session.amount,
			currency: session.currency,
			method: "khalti",
			providerRef: `KHALTI-${counter}`,
			sessionId: session.id,
			metadata: { ...session.metadata },
			failureReason: null,
			livemode: session.livemode,
			createdAt: new Date().toISOString(),
			key: session.key,
			...overrides,
		};
		this.payments.set(payment.id, payment);
		if (payment.status === "success") {
			session.status = "success";
			session.paymentId = payment.id;
		}
		return payment;
	}

	/** A refund of `paymentId` that PayBridgeNP reports as `status`. */
	refund(
		paymentId: string,
		amount: number,
		status = "succeeded",
	): ProviderRefund {
		const refund: ProviderRefund = {
			id: id("rf"),
			paymentId,
			amount,
			currency: "NPR",
			status,
			failureReason: null,
			createdAt: new Date().toISOString(),
		};
		this.refunds.set(refund.id, refund);
		return refund;
	}
}

/** The one fake every suite uses (tests/bootstrap.ts). */
export const paybridge = new FakePaybridge();

/** Swaps PaymentProviders for the fake: a runner hook, before any test. */
export function installFakePaybridge() {
	app.container.swap(PaymentProviders, () => paybridge);
}
