import { test } from "@japa/runner";
import {
	ApiError,
	AuthenticationError,
	ConnectionError,
	IdempotencyError,
	InvalidRequestError,
	NotFoundError,
	PayBridgeNP,
	RateLimitError,
} from "@paybridge-np/sdk";
import {
	keyHint,
	modeOfKey,
	normalizeInvoice,
	normalizePayment,
	ProviderError,
	toProviderError,
	withRetries,
} from "#services/paybridge";
import {
	checkCredentialsKey,
	checkPaybridgeKey,
	checkPaymentSettings,
	checkStudioPaymentMode,
} from "#services/payment_settings";
import {
	PLATFORM_WEBHOOK_SECRET,
	paybridge,
	sign,
} from "#tests/helpers/paybridge";

const noWait = async () => {};

test.group("PayBridgeNP adapter", () => {
	test("keys: the prefix gives the mode, and only the last four characters are shown", ({
		assert,
	}) => {
		assert.equal(modeOfKey("sk_live_abc"), "live");
		assert.equal(modeOfKey("sk_test_abc"), "sandbox");
		assert.isNull(modeOfKey("pk_live_abc"));
		assert.equal(keyHint("sk_test_0123456789wxyz"), "…wxyz");
	});

	test("SDK errors map to stable kinds by type and status, never by message", ({
		assert,
	}) => {
		const kind = (error: unknown) =>
			(toProviderError(error) as ProviderError).kind;
		assert.equal(kind(new AuthenticationError("x")), "auth");
		assert.equal(kind(new NotFoundError("x")), "not_found");
		assert.equal(kind(new InvalidRequestError("x", 409)), "conflict");
		assert.equal(kind(new InvalidRequestError("x", 400)), "invalid");
		assert.equal(
			kind(new IdempotencyError("x", { code: "idempotency_conflict" })),
			"conflict",
		);
		assert.equal(
			kind(new RateLimitError("x", { retryAfter: 2 })),
			"rate_limited",
		);
		assert.equal(kind(new ApiError("x", 502)), "unavailable");
		assert.equal(kind(new ConnectionError("x")), "unavailable");
		const plain = new Error("not the provider's");
		assert.strictEqual(toProviderError(plain), plain);
	});

	test("retries temporary failures a bounded number of times, never a final or an unknown-outcome one", async ({
		assert,
	}) => {
		let calls = 0;
		const flaky = async () => {
			calls++;
			if (calls < 3) throw new ApiError("busy", 503);
			return "ok";
		};
		assert.equal(await withRetries("t", flaky, noWait), "ok");
		assert.equal(calls, 3);

		calls = 0;
		await assert.rejects(() =>
			withRetries(
				"t",
				async () => {
					calls++;
					throw new ApiError("busy", 503);
				},
				noWait,
			),
		);
		assert.equal(calls, 3);

		calls = 0;
		await assert.rejects(() =>
			withRetries(
				"t",
				async () => {
					calls++;
					throw new InvalidRequestError("bad", 400);
				},
				noWait,
			),
		);
		assert.equal(calls, 1);

		calls = 0;
		await assert.rejects(() =>
			withRetries(
				"t",
				async () => {
					calls++;
					throw new ApiError("maybe", 502, { code: "refund_outcome_unknown" });
				},
				noWait,
			),
		);
		assert.equal(calls, 1);

		const waits: number[] = [];
		calls = 0;
		await withRetries(
			"t",
			async () => {
				calls++;
				if (calls === 1) throw new RateLimitError("slow", { retryAfter: 2 });
				if (calls === 2) throw new RateLimitError("slow", { retryAfter: 60 });
				return "ok";
			},
			async (ms) => {
				waits.push(ms);
			},
		);
		// Retry-After is honoured, capped at 5 seconds inside a request.
		assert.deepEqual(waits, [2000, 5000]);
	});

	test("objects read the same in camelCase (REST) and snake_case (SDK, webhooks)", ({
		assert,
	}) => {
		const camel = normalizePayment({
			id: "pay_1",
			status: "success",
			amount: 1000,
			currency: "NPR",
			provider: "esewa",
			providerRef: "R1",
			checkoutSessionId: "cs_1",
			failureReason: null,
			metadata: { a: "b" },
			livemode: false,
		});
		const snake = normalizePayment({
			id: "pay_1",
			status: "success",
			amount: 1000,
			currency: "NPR",
			provider: "esewa",
			provider_ref: "R1",
			checkout_session_id: "cs_1",
			metadata: { a: "b" },
			livemode: false,
		});
		assert.deepEqual(camel, snake);
		assert.isNaN(
			normalizePayment({ id: "p", status: "success", amount: "1000" }).amount,
		);
		const invoice = normalizeInvoice({
			id: "inv_1",
			status: "paid",
			amount_due: 100,
			amount_paid: 100,
			currency: "NPR",
			customer: { id: "bc_1", external_customer_id: "t" },
			subscription: {
				id: "sub_1",
				current_period_start: "2026-11-01T00:00:00Z",
				current_period_end: "2026-12-01T00:00:00Z",
			},
		});
		assert.equal(invoice.customerId, "bc_1");
		assert.equal(invoice.subscriptionId, "sub_1");
		assert.equal(invoice.periodEnd, "2026-12-01T00:00:00Z");
	});

	test("webhooks: the raw body's signature and timestamp are checked with the SDK", async ({
		assert,
	}) => {
		const body = JSON.stringify({
			id: "evt_1",
			type: "payment.succeeded",
			created: 1,
			livemode: false,
			data: { id: "pay_1" },
		});
		const event = await paybridge.verifyEvent(
			body,
			sign(body, PLATFORM_WEBHOOK_SECRET),
			PLATFORM_WEBHOOK_SECRET,
		);
		assert.equal(event.id, "evt_1");
		// The SDK itself agrees with the fake's signer.
		assert.equal(
			(
				await PayBridgeNP.webhooks.constructEvent(
					body,
					sign(body, "whsec_x"),
					"whsec_x",
				)
			).id,
			"evt_1",
		);
		const refusals = [
			[body, sign(body, "whsec_other")],
			[`${body} `, sign(body, PLATFORM_WEBHOOK_SECRET)],
			[
				body,
				sign(
					body,
					PLATFORM_WEBHOOK_SECRET,
					Math.floor(Date.now() / 1000) - 301,
				),
			],
			[
				body,
				sign(
					body,
					PLATFORM_WEBHOOK_SECRET,
					Math.floor(Date.now() / 1000) + 301,
				),
			],
			[body, null],
			[body, "garbage"],
			[body, "t=1,v1=zz"],
		] as const;
		for (const [raw, header] of refusals) {
			const error = await paybridge
				.verifyEvent(raw, header, PLATFORM_WEBHOOK_SECRET)
				.then(
					() => null,
					(caught: unknown) => caught,
				);
			assert.instanceOf(error, ProviderError);
			assert.equal((error as ProviderError).kind, "signature");
		}
	});

	test("settings: keys, modes and the credentials key are checked at boot", ({
		assert,
	}) => {
		assert.isUndefined(checkPaybridgeKey("K", ""));
		assert.equal(
			checkPaybridgeKey("K", "sk_test_0123456789")?.release(),
			"sk_test_0123456789",
		);
		assert.throws(() => checkPaybridgeKey("K", "pk_live_0123456789"));
		assert.equal(checkStudioPaymentMode("M", undefined), "disabled");
		assert.throws(() => checkStudioPaymentMode("M", "on"));
		assert.throws(() => checkCredentialsKey("C", "c2hvcnQ="));
		assert.equal(
			checkCredentialsKey(
				"C",
				Buffer.alloc(32, 1).toString("base64"),
			)?.release().length,
			32,
		);
		assert.throws(() =>
			checkPaymentSettings({
				platformKey: true,
				webhookSecret: false,
				studioMode: "disabled",
				credentialsKey: false,
			}),
		);
		assert.throws(() =>
			checkPaymentSettings({
				platformKey: false,
				webhookSecret: false,
				studioMode: "live",
				credentialsKey: false,
			}),
		);
		assert.doesNotThrow(() =>
			checkPaymentSettings({
				platformKey: false,
				webhookSecret: false,
				studioMode: "disabled",
				credentialsKey: false,
			}),
		);
	});
});

test.group("Platform admins", () => {
	test("a listed address counts only once confirmed, compared canonically", async ({
		assert,
	}) => {
		const { isPlatformAdmin } = await import("#services/platform_admins");
		assert.isTrue(
			isPlatformAdmin({ email: "Admin@Platform.example", emailVerified: true }),
		);
		assert.isFalse(
			isPlatformAdmin({
				email: "admin@platform.example",
				emailVerified: false,
			}),
		);
		assert.isFalse(
			isPlatformAdmin({ email: "owner@platform.example", emailVerified: true }),
		);
	});
});
