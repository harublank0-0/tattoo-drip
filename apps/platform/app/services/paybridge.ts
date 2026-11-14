import logger from "@adonisjs/core/services/logger";
import {
	type BillingCustomer,
	type CreateCheckoutParams,
	type Invoice,
	PayBridgeError,
	PayBridgeNP,
	type Payment,
	type Plan,
	type Refund,
	type RetrievedCheckoutSession,
	type Subscription,
	type WebhookEventType,
} from "@paybridge-np/sdk";
import env from "#start/env";

/**
 * The PayBridgeNP adapter (docs/payments-paybridgenp.md): the only code that
 * calls PayBridgeNP. It wraps the official SDK, hands the app plain objects
 * with one spelling (the REST schema writes camelCase where the SDK types
 * and webhooks write snake_case; both are read), turns every SDK error into
 * a ProviderError with a stable kind, and retries a bounded number of times.
 *
 * Secret keys stay here and in the services that decrypt them: never in a
 * log line, an error message, a job payload or a page's props. Logs carry
 * PayBridgeNP's request id and error code only.
 */

export type ProviderMode = "sandbox" | "live";

/** The key prefix fixes the mode (PayBridgeNP: "A key's mode cannot change"). */
export function modeOfKey(secretKey: string): ProviderMode | null {
	if (secretKey.startsWith("sk_live_")) return "live";
	if (secretKey.startsWith("sk_test_")) return "sandbox";
	return null;
}

/** The shape of a secret key: sk_test_ or sk_live_ and an opaque rest. */
export const SECRET_KEY_FORMAT = /^sk_(?:test|live)_[A-Za-z0-9_-]{8,200}$/;

/** A key's last four characters, the only part ever shown. */
export function keyHint(secretKey: string): string {
	return `…${secretKey.slice(-4)}`;
}

export type ProviderErrorKind =
	| "auth"
	| "permission"
	| "invalid"
	| "not_found"
	| "conflict"
	| "rate_limited"
	| "unavailable"
	| "signature"
	| "unknown";

/**
 * A PayBridgeNP failure, by stable kind and code (the API's `error.type` and
 * `error.code`), never by message text. `retryable` follows the API docs: 429
 * and 5xx are temporary, except `refund_outcome_unknown` (the action may have
 * happened); `idempotency_conflict` means the same key is still in flight.
 */
export class ProviderError extends Error {
	constructor(
		readonly kind: ProviderErrorKind,
		readonly code: string | undefined,
		/** PayBridgeNP's HTTP status (not `status`: Adonis would answer with it). */
		readonly providerStatus: number,
		readonly requestId: string | undefined,
		readonly retryAfterSeconds?: number,
	) {
		super(`PayBridgeNP ${kind}${code ? ` (${code})` : ""}`);
		this.name = "ProviderError";
	}

	get retryable(): boolean {
		if (this.code === "refund_outcome_unknown") return false;
		if (this.code === "idempotency_conflict") return true;
		return this.kind === "rate_limited" || this.kind === "unavailable";
	}

	/** What a log line may carry: no message from the API (it can echo input). */
	toLog() {
		return {
			kind: this.kind,
			code: this.code,
			status: this.providerStatus,
			requestId: this.requestId,
		};
	}
}

/** An SDK or network error as a ProviderError; anything else unchanged. */
export function toProviderError(error: unknown): unknown {
	if (error instanceof ProviderError) return error;
	if (!(error instanceof PayBridgeError)) return error;
	const status = error.statusCode;
	const retryAfter =
		"retryAfter" in error && typeof error.retryAfter === "number"
			? error.retryAfter
			: undefined;
	const kind: ProviderErrorKind = (() => {
		switch (error.type) {
			case "authentication_error":
				return "auth";
			case "account_error":
			case "permission_error":
				return "permission";
			case "idempotency_error":
				return "conflict";
			case "rate_limit_error":
				return "rate_limited";
			case "api_error":
			case "connection_error":
				return "unavailable";
			case "signature_verification_error":
				return "signature";
			case "invalid_request_error":
				if (status === 404) return "not_found";
				if (status === 409) return "conflict";
				return "invalid";
			default:
				return "unknown";
		}
	})();
	return new ProviderError(
		kind,
		error.code,
		status,
		error.requestId,
		retryAfter,
	);
}

/** How many times a call is tried in all, and the wait before each retry. */
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [300, 1200];
/** A Retry-After longer than this is not waited for in a request. */
const MAX_WAIT_MS = 5000;

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `call` up to MAX_ATTEMPTS times while it fails with a retryable
 * ProviderError. Only for reads and for writes that carry an idempotency key
 * PayBridgeNP honours (checkout, refunds, webhooks, billing plans, customers
 * and subscriptions): a retried write then returns the first response
 * instead of doing it twice.
 */
export async function withRetries<T>(
	label: string,
	call: () => Promise<T>,
	sleep: Sleep = defaultSleep,
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await call();
		} catch (raw) {
			const error = toProviderError(raw);
			if (
				!(error instanceof ProviderError) ||
				!error.retryable ||
				attempt >= MAX_ATTEMPTS
			) {
				if (error instanceof ProviderError) {
					logger.warn(
						{ provider: "paybridgenp", call: label, attempt, ...error.toLog() },
						"PayBridgeNP call failed",
					);
				}
				throw error;
			}
			const wait = Math.min(
				error.retryAfterSeconds !== undefined
					? error.retryAfterSeconds * 1000
					: BACKOFF_MS[attempt - 1],
				MAX_WAIT_MS,
			);
			await sleep(wait);
		}
	}
}

/** Runs `call` once, turning its error into a ProviderError (writes PayBridgeNP doesn't dedupe). */
async function once<T>(label: string, call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (raw) {
		const error = toProviderError(raw);
		if (error instanceof ProviderError) {
			logger.warn(
				{ provider: "paybridgenp", call: label, attempt: 1, ...error.toLog() },
				"PayBridgeNP call failed",
			);
		}
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Plain objects the app reads.

export type ProviderAccount = {
	merchantId: string;
	merchantName: string;
	projectId: string;
	projectName: string;
	mode: ProviderMode;
};

/** A checkout session's payment status, as PayBridgeNP words it. */
export type SessionStatus =
	| "pending"
	| "initiated"
	| "success"
	| "failed"
	| "cancelled"
	| "expired";

export type CheckoutInput = {
	/** Integer paisa, 1,000 to 100,000,000 (PayBridgeNP's bounds). */
	amount: number;
	currency: "NPR";
	returnUrl: string;
	cancelUrl: string;
	/** At most 200 characters. */
	description: string;
	/** Ids only: returned on the payment and in webhooks. */
	metadata: Record<string, string>;
};

export type ProviderCheckout = {
	id: string;
	url: string;
	expiresAt: string;
	livemode: boolean;
};

export type ProviderSession = {
	id: string;
	status: string;
	amount: number;
	currency: string;
	paymentId: string | null;
	metadata: Record<string, unknown>;
	expiresAt: string | null;
	livemode: boolean;
};

export type ProviderPayment = {
	id: string;
	status: string;
	amount: number;
	currency: string;
	/** esewa, khalti, fonepay (or `card`, a sandbox-only test method). */
	method: string;
	providerRef: string | null;
	sessionId: string | null;
	metadata: Record<string, unknown>;
	failureReason: string | null;
	livemode: boolean;
	createdAt: string | null;
};

export type ProviderRefund = {
	id: string;
	paymentId: string;
	amount: number;
	currency: string;
	status: string;
	failureReason: string | null;
	createdAt: string | null;
};

export type ProviderEvent = {
	id: string;
	type: string;
	created: number;
	livemode: boolean;
	data: Record<string, unknown>;
};

export type PlanInput = {
	name: string;
	amount: number;
	intervalUnit: "day" | "week" | "month" | "quarter" | "year";
	intervalCount: number;
	trialDays: number;
	metadata: Record<string, string>;
};

export type ProviderPlan = { id: string; livemode: boolean };

export type CustomerInput = {
	name: string;
	email: string;
	externalCustomerId: string;
	metadata: Record<string, string>;
};

export type ProviderCustomer = {
	id: string;
	externalCustomerId: string | null;
	livemode: boolean;
};

export type SubscriptionInput = {
	customerId: string;
	planId: string;
	referenceId: string;
	metadata: Record<string, string>;
};

export type ProviderSubscription = {
	id: string;
	status: string;
	customerId: string | null;
	customerExternalId: string | null;
	planId: string | null;
	pendingPlanId: string | null;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	nextInvoiceAt: string | null;
	trialEndsAt: string | null;
	cancelAtPeriodEnd: boolean;
	canceledAt: string | null;
	cancelEffectiveAt: string | null;
	endedAt: string | null;
	pausedAt: string | null;
	latestInvoiceId: string | null;
	referenceId: string | null;
	livemode: boolean;
};

export type ProviderInvoice = {
	id: string;
	number: string | null;
	status: string;
	amountDue: number;
	amountPaid: number;
	currency: string;
	issuedAt: string | null;
	dueAt: string | null;
	paidAt: string | null;
	hostedUrl: string | null;
	customerId: string | null;
	customerExternalId: string | null;
	subscriptionId: string | null;
	periodStart: string | null;
	periodEnd: string | null;
	livemode: boolean;
};

/** A studio's own PayBridgeNP project, used through its own secret key. */
export interface GatewayApi {
	readonly mode: ProviderMode;
	account(): Promise<ProviderAccount>;
	createCheckout(
		input: CheckoutInput,
		idempotencyKey: string,
	): Promise<ProviderCheckout>;
	getSession(id: string): Promise<ProviderSession>;
	expireCheckout(id: string, idempotencyKey: string): Promise<void>;
	getPayment(id: string): Promise<ProviderPayment>;
	listRefunds(paymentId: string): Promise<ProviderRefund[]>;
	registerWebhook(
		url: string,
		events: string[],
		idempotencyKey: string,
	): Promise<{ id: string; secret: string }>;
	deleteWebhook(id: string): Promise<void>;
}

/** TattooDrip's own PayBridgeNP project, for subscription billing. */
export interface BillingApi {
	readonly mode: ProviderMode;
	account(): Promise<ProviderAccount>;
	createPlan(input: PlanInput, idempotencyKey: string): Promise<ProviderPlan>;
	createCustomer(
		input: CustomerInput,
		idempotencyKey: string,
	): Promise<ProviderCustomer>;
	createSubscription(
		input: SubscriptionInput,
		idempotencyKey: string,
	): Promise<ProviderSubscription>;
	getSubscription(id: string): Promise<ProviderSubscription>;
	/** The customer's subscriptions, newest first (at most 100). */
	listSubscriptions(customerId: string): Promise<ProviderSubscription[]>;
	cancelAtPeriodEnd(id: string): Promise<ProviderSubscription>;
	changePlan(id: string, planId: string): Promise<void>;
	getInvoice(id: string): Promise<ProviderInvoice>;
	listInvoices(subscriptionId: string): Promise<ProviderInvoice[]>;
}

/** The webhook events a studio's endpoint is registered for. */
export const STUDIO_WEBHOOK_EVENTS: WebhookEventType[] = [
	"payment.succeeded",
	"payment.failed",
	"payment.cancelled",
	"payment.refunded",
	"refund.succeeded",
];

// ---------------------------------------------------------------------------
// Normalisers. Unknown fields are ignored and missing ones read as null, so
// an additive API change (PayBridgeNP: "Additive response fields and new
// enum values may appear") never breaks a read.

type Loose = Record<string, unknown>;

const str = (value: unknown): string | null =>
	typeof value === "string" && value !== "" ? value : null;
const int = (value: unknown): number =>
	typeof value === "number" && Number.isSafeInteger(value) ? value : Number.NaN;
const obj = (value: unknown): Loose =>
	value !== null && typeof value === "object" ? (value as Loose) : {};
/** The first of the spellings that holds a value. */
const pick = (source: Loose, ...names: string[]) =>
	names.map((name) => source[name]).find((value) => value != null);

export function normalizePayment(raw: Payment | Loose): ProviderPayment {
	const p = raw as Loose;
	return {
		id: String(p.id),
		status: String(p.status),
		amount: int(p.amount),
		currency: String(p.currency ?? ""),
		method: String(p.provider ?? ""),
		providerRef: str(pick(p, "provider_ref", "providerRef")),
		sessionId: str(
			pick(p, "checkout_session_id", "checkoutSessionId", "session_id"),
		),
		metadata: obj(p.metadata),
		failureReason:
			str(pick(p, "failure_reason", "failureReason", "reason"))?.slice(
				0,
				500,
			) ?? null,
		livemode: p.livemode === true,
		createdAt: str(pick(p, "created_at", "createdAt")),
	};
}

export function normalizeSession(
	raw: RetrievedCheckoutSession | Loose,
): ProviderSession {
	const s = raw as Loose;
	return {
		id: String(s.id),
		status: String(s.status),
		amount: int(s.amount),
		currency: String(s.currency ?? ""),
		paymentId: str(pick(s, "paymentId", "payment_id")),
		metadata: obj(s.metadata),
		expiresAt: str(pick(s, "expiresAt", "expires_at")),
		livemode: s.livemode === true,
	};
}

export function normalizeRefund(raw: Refund | Loose): ProviderRefund {
	const r = raw as Loose;
	return {
		id: String(r.id),
		paymentId: String(pick(r, "paymentId", "payment_id") ?? ""),
		amount: int(r.amount),
		currency: String(r.currency ?? ""),
		status: String(r.status),
		failureReason:
			str(pick(r, "failureReason", "failure_reason"))?.slice(0, 500) ?? null,
		createdAt: str(pick(r, "createdAt", "created_at")),
	};
}

export function normalizeSubscription(
	raw: Subscription | Loose,
): ProviderSubscription {
	const s = raw as Loose;
	const customer = obj(s.customer);
	const plan = obj(s.plan);
	const pending = obj(s.pending_plan);
	const latest = obj(s.latest_invoice);
	return {
		id: String(s.id),
		status: String(s.status),
		customerId: str(s.customer_id) ?? str(customer.id),
		customerExternalId: str(customer.external_customer_id),
		planId: str(s.plan_id) ?? str(plan.id),
		pendingPlanId: str(pending.id),
		currentPeriodStart: str(s.current_period_start),
		currentPeriodEnd: str(s.current_period_end),
		nextInvoiceAt: str(s.next_invoice_at),
		trialEndsAt: str(s.trial_ends_at),
		cancelAtPeriodEnd: s.cancel_at_period_end === true,
		canceledAt: str(s.canceled_at),
		cancelEffectiveAt: str(s.cancel_effective_at),
		endedAt: str(s.ended_at),
		pausedAt: str(s.paused_at),
		latestInvoiceId: str(latest.id),
		referenceId: str(s.reference_id),
		livemode: s.livemode === true,
	};
}

export function normalizeInvoice(raw: Invoice | Loose): ProviderInvoice {
	const i = raw as Loose;
	const customer = obj(i.customer);
	const subscription = obj(i.subscription);
	return {
		id: String(i.id),
		number: str(i.number),
		status: String(i.status),
		amountDue: int(i.amount_due),
		amountPaid: int(i.amount_paid),
		currency: String(i.currency ?? ""),
		issuedAt: str(i.issued_at),
		dueAt: str(i.due_at),
		paidAt: str(i.paid_at),
		hostedUrl: str(i.hosted_invoice_url),
		customerId: str(customer.id) ?? str(i.customer_id),
		customerExternalId: str(customer.external_customer_id),
		subscriptionId: str(subscription.id) ?? str(i.subscription_id),
		periodStart: str(subscription.current_period_start),
		periodEnd: str(subscription.current_period_end),
		livemode: i.livemode === true,
	};
}

function normalizeAccount(raw: Loose): ProviderAccount {
	const merchant = obj(raw.merchant);
	const project = obj(raw.project);
	return {
		merchantId: String(merchant.id ?? ""),
		merchantName: String(merchant.name ?? "").slice(0, 200),
		projectId: String(project.id ?? ""),
		projectName: String(project.name ?? "").slice(0, 200),
		mode: project.mode === "live" ? "live" : "sandbox",
	};
}

// ---------------------------------------------------------------------------
// The SDK-backed implementations.

/** Timeout per HTTP call: requests may wait on these while holding a row lock. */
const TIMEOUT_MS = 10_000;

function sdk(secretKey: string, baseUrl?: string) {
	// maxRetries: the SDK retries GETs only; withRetries covers both.
	return new PayBridgeNP({
		apiKey: secretKey,
		baseUrl,
		timeout: TIMEOUT_MS,
		maxRetries: 0,
	});
}

class SdkGatewayApi implements GatewayApi {
	readonly mode: ProviderMode;
	readonly #client: PayBridgeNP;

	constructor(secretKey: string, baseUrl?: string) {
		this.mode = modeOfKey(secretKey) ?? "sandbox";
		this.#client = sdk(secretKey, baseUrl);
	}

	async account() {
		const raw = await withRetries("account", () => this.#client.account.get());
		return normalizeAccount(raw as unknown as Loose);
	}

	async createCheckout(input: CheckoutInput, idempotencyKey: string) {
		const params: CreateCheckoutParams = {
			amount: input.amount,
			currency: input.currency,
			returnUrl: input.returnUrl,
			cancelUrl: input.cancelUrl,
			metadata: input.metadata,
		};
		// `description` is in the API (max 200) but not in the SDK's type.
		const body = { ...params, description: input.description.slice(0, 200) };
		const session = await withRetries("checkout.create", () =>
			this.#client.checkout.create(
				body as CreateCheckoutParams,
				idempotencyKey,
			),
		);
		return {
			id: session.id,
			url: session.checkout_url,
			expiresAt: session.expires_at,
			livemode: session.livemode === true,
		};
	}

	async getSession(id: string) {
		const raw = await withRetries("sessions.retrieve", () =>
			this.#client.checkout.retrieve(id),
		);
		return normalizeSession(raw);
	}

	async expireCheckout(id: string, idempotencyKey: string) {
		// Idempotent by definition: a terminal session answers with its state.
		await withRetries("checkout.expire", () =>
			this.#client.checkout.expire(id, idempotencyKey),
		);
	}

	async getPayment(id: string) {
		const raw = await withRetries("payments.retrieve", () =>
			this.#client.payments.retrieve(id),
		);
		return normalizePayment(raw);
	}

	async listRefunds(paymentId: string) {
		const page = await withRetries("refunds.list", () =>
			this.#client.refunds.list({ paymentId, limit: 100 }),
		);
		return page.data.map(normalizeRefund);
	}

	async registerWebhook(url: string, events: string[], idempotencyKey: string) {
		const endpoint = await withRetries("webhooks.create", () =>
			this.#client.webhooks.create(
				{ url, events: events as WebhookEventType[] },
				idempotencyKey,
			),
		);
		return { id: endpoint.id, secret: endpoint.signing_secret };
	}

	async deleteWebhook(id: string) {
		await once("webhooks.delete", () => this.#client.webhooks.delete(id));
	}
}

class SdkBillingApi implements BillingApi {
	readonly mode: ProviderMode;
	readonly #client: PayBridgeNP;

	constructor(secretKey: string, baseUrl?: string) {
		this.mode = modeOfKey(secretKey) ?? "sandbox";
		this.#client = sdk(secretKey, baseUrl);
	}

	async account() {
		const raw = await withRetries("account", () => this.#client.account.get());
		return normalizeAccount(raw as unknown as Loose);
	}

	async createPlan(input: PlanInput, idempotencyKey: string) {
		const plan: Plan = await withRetries("plans.create", () =>
			this.#client.plans.create(
				{
					name: input.name,
					amount: input.amount,
					currency: "NPR",
					intervalUnit: input.intervalUnit,
					intervalCount: input.intervalCount,
					trialDays: input.trialDays,
					// Renewals are paid through each invoice's link; a late one
					// marks the subscription past_due, never cancels it.
					overdueAction: "mark_past_due",
					metadata: input.metadata,
				},
				idempotencyKey,
			),
		);
		return { id: plan.id, livemode: plan.livemode === true };
	}

	async createCustomer(input: CustomerInput, idempotencyKey: string) {
		const customer: BillingCustomer = await withRetries(
			"customers.create",
			() =>
				this.#client.customers.create(
					{
						name: input.name,
						email: input.email,
						externalCustomerId: input.externalCustomerId,
						metadata: input.metadata,
					},
					idempotencyKey,
				),
		);
		return {
			id: customer.id,
			externalCustomerId: customer.external_customer_id,
			livemode: customer.livemode === true,
		};
	}

	async createSubscription(input: SubscriptionInput, idempotencyKey: string) {
		const raw = await withRetries("subscriptions.create", () =>
			this.#client.subscriptions.create(
				{
					customerId: input.customerId,
					planId: input.planId,
					referenceId: input.referenceId,
					metadata: input.metadata,
				},
				idempotencyKey,
			),
		);
		return normalizeSubscription(raw);
	}

	async getSubscription(id: string) {
		const raw = await withRetries("subscriptions.get", () =>
			this.#client.subscriptions.get(id),
		);
		return normalizeSubscription(raw);
	}

	async listSubscriptions(customerId: string) {
		const page = await withRetries("subscriptions.list", () =>
			this.#client.subscriptions.list({ customerId, limit: 100 }),
		);
		return page.data.map(normalizeSubscription);
	}

	async cancelAtPeriodEnd(id: string) {
		// The cancel endpoint ignores Idempotency-Key, so no automatic retry;
		// asking again is harmless (the owner can press it again).
		const raw = await once("subscriptions.cancel", () =>
			this.#client.subscriptions.cancel(id, { atPeriodEnd: true }),
		);
		return normalizeSubscription(raw);
	}

	async changePlan(id: string, planId: string) {
		// "none": the change waits for the next renewal (pending_plan).
		await once("subscriptions.changePlan", () =>
			this.#client.subscriptions.changePlan(id, {
				newPlanId: planId,
				prorationBehavior: "none",
			}),
		);
	}

	async getInvoice(id: string) {
		const raw = await withRetries("invoices.get", () =>
			this.#client.invoices.get(id),
		);
		return normalizeInvoice(raw);
	}

	async listInvoices(subscriptionId: string) {
		const page = await withRetries("invoices.list", () =>
			this.#client.invoices.list({ subscriptionId, limit: 100 }),
		);
		return page.data.map(normalizeInvoice);
	}
}

/**
 * Where the app gets its PayBridgeNP clients. Resolved from the container,
 * so tests swap it for a fake (`app.container.swap(PaymentProviders, …)`).
 */
export default class PaymentProviders {
	/** TattooDrip's own billing project, or null when PAYBRIDGE_SECRET_KEY is unset. */
	platform(): BillingApi | null {
		const key = env.get("PAYBRIDGE_SECRET_KEY");
		return key ? new SdkBillingApi(key.release(), apiUrl()) : null;
	}

	/** The signing secret of the platform's webhook endpoint, or null. */
	platformWebhookSecret(): string | null {
		return env.get("PAYBRIDGE_WEBHOOK_SECRET")?.release() ?? null;
	}

	/** A studio's own project, through the key it connected. */
	studio(secretKey: string): GatewayApi {
		return new SdkGatewayApi(secretKey, apiUrl());
	}

	/**
	 * A webhook delivery checked with the SDK's constructEvent: the HMAC of
	 * `<t>.<raw body>` with `secret`, in constant time, and a timestamp at
	 * most 300 seconds away (replay protection). Throws a ProviderError of
	 * kind `signature` otherwise.
	 */
	async verifyEvent(
		rawBody: string,
		signature: string | null,
		secret: string,
	): Promise<ProviderEvent> {
		let event: unknown;
		try {
			event = await PayBridgeNP.webhooks.constructEvent(
				rawBody,
				signature,
				secret,
			);
		} catch (error) {
			if (error instanceof PayBridgeError || error instanceof SyntaxError) {
				throw new ProviderError("signature", undefined, 0, undefined);
			}
			// The SDK splits the header without checking it: a malformed one can
			// throw a plain TypeError or RangeError. Still a bad signature.
			if (error instanceof TypeError || error instanceof RangeError) {
				throw new ProviderError("signature", undefined, 0, undefined);
			}
			throw error;
		}
		const e = obj(event);
		if (typeof e.id !== "string" || typeof e.type !== "string") {
			throw new ProviderError("signature", "malformed_event", 0, undefined);
		}
		return {
			id: e.id,
			type: e.type,
			created: typeof e.created === "number" ? e.created : 0,
			livemode: e.livemode === true,
			data: obj(e.data),
		};
	}
}

/** PAYBRIDGE_API_URL overrides the SDK's https://api.paybridgenp.com (a mock server). */
function apiUrl(): string | undefined {
	return env.get("PAYBRIDGE_API_URL") || undefined;
}

/**
 * Only an https page of PayBridgeNP's own (or a subdomain, such as its
 * checkout host) is ever sent to a browser as the place to pay.
 */
export function isHostedPaymentUrl(url: string | null): url is string {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		return (
			parsed.protocol === "https:" &&
			(host === "paybridgenp.com" || host.endsWith(".paybridgenp.com"))
		);
	} catch {
		return false;
	}
}
