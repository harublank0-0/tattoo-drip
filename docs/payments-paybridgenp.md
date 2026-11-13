# Online payments with PayBridgeNP

Date: 2026-11-13. Sources: the PayBridgeNP docs (docs.paybridgenp.com: home, introduction, quickstart, confirming payments, webhook verification, idempotency, billing, trials, payments sync, analytics, plans and limits, provider setup, errors, the OpenAPI file) and the official TypeScript SDK `@paybridge-np/sdk` 5.7.0, read on that date. Re-check them before changing the integration: amounts, statuses and event names below are quoted from them, nothing else is assumed.

Two money flows, kept apart end to end:

| | TattooDrip subscription billing (SaaS) | Studio customer payments |
|---|---|---|
| Who pays whom | A studio pays TattooDrip for its plan | A tattoo client pays a studio (a booking deposit) |
| PayBridgeNP project | TattooDrip's own project (`PAYBRIDGE_SECRET_KEY`) | The studio's own project and key, one per studio |
| Where the money settles | TattooDrip's provider merchant accounts | The studio's own eSewa, Khalti or Fonepay merchant accounts |
| Records | `billing_*` tables (`billing` module) | the `payments` ledger plus `gateway_*` tables (`payments` module) |
| Webhook URL | `/api/v1/webhooks/paybridgenp/platform` | `/api/v1/webhooks/paybridgenp/studios/<endpoint key>` |
| Reported on | the platform admin's Billing page | the studio's Transactions page |

## The merchant-account constraint

PayBridgeNP says: "Payments settle directly into your eSewa, Khalti, or Fonepay merchant account. PayBridgeNP does not hold or settle your funds", and "Each project has isolated API keys and provider credentials" (introduction). Provider credentials are added by hand in the PayBridgeNP dashboard (provider setup); the API has no endpoint to create projects, add provider credentials or onboard another merchant, and no connected accounts, sub-merchants, split payments or payouts. The plan page caps projects per account (Free 1, Growth 2, Pro 5, Enterprise unlimited) and says Enterprise is for "teams running several brands from one account".

So a payment taken with a key settles to the provider accounts configured on that key's project. A checkout created with TattooDrip's own key would put a studio's client money in TattooDrip's accounts, which this integration never does:

- **Subscription billing** uses only `PAYBRIDGE_SECRET_KEY`, and only for TattooDrip's own plans, customers, subscriptions and invoices.
- **Studio customer payments** use only the studio's own PayBridgeNP secret key, for a project whose eSewa, Khalti and Fonepay credentials are the studio's own merchant accounts. TattooDrip cannot see provider credentials through the API (they are "not returned by the public API"), so whose accounts they are cannot be verified by software. Studio payments are therefore off unless all of these hold:
  1. `STUDIO_ONLINE_PAYMENTS` is `sandbox` or `live` (default `disabled`), and `PAYMENT_CREDENTIALS_KEY` is set;
  2. the studio owner connected a key of the matching mode, which the server checked with `GET /v1/account` (its project, mode and merchant), and which is not TattooDrip's own project or merchant (`PAYBRIDGE_SECRET_KEY`'s);
  3. the server registered the studio's webhook endpoint on that project with the studio's key (`POST /v1/webhooks`) and stored the returned signing secret;
  4. a TattooDrip platform admin marked the connection verified after checking, outside the software, that the project's provider accounts belong to the studio (Admin, Online payments).

No screen says TattooDrip pays studios out or holds their money, and the Transactions page shows amounts collected, never settlements or payouts: PayBridgeNP provides no settlement data. Whether PayBridgeNP's terms let a platform operate keys on its merchants' behalf is a question for PayBridgeNP before going live; nothing in the docs answers it.

**Provider dependency, precisely:** to take studio payments without each studio holding its own PayBridgeNP account, PayBridgeNP would need a documented way to create a project per studio with that studio's provider credentials and settlement (a connected-accounts or onboarding API). Until it exists, each studio needs its own PayBridgeNP account (or a project its own provider credentials are configured on) and a plan whose limits fit its volume (Free has a NPR 50,000 monthly live cap).

## Facts the code relies on

- Base URL `https://api.paybridgenp.com/v1`, `Authorization: Bearer sk_test_…|sk_live_…`; the key prefix fixes the mode. Amounts are integer paisa; checkout takes `NPR` only, 1,000 to 100,000,000 paisa.
- Checkout: `POST /v1/checkout` (`amount`, `currency`, `returnUrl`, `cancelUrl`, `description` ≤ 200, `metadata` ≤ 8 KB, `customer`) returns `id` (`cs_…`), `checkout_url`, `expires_at`; sessions expire 30 minutes after creation; `GET /v1/sessions/{id}` gives `status` (`pending`, `initiated`, `success`, `failed`, `cancelled`, `expired`) and `paymentId` once paid; `POST /v1/checkout/{id}/expire` stops an old URL being payable.
- Payments: `GET /v1/payments/{id}`; `status` is `pending`, `processing`, `success`, `failed`, `cancelled` or `refunded`. The REST schema names fields in camelCase (`checkoutSessionId`, `providerRef`, `failureReason`); the SDK types and webhook payloads use snake_case (`provider_ref`, `session_id`). The adapter reads both.
- Webhooks: header `X-PayBridgeNP-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 of `<t>.<raw body>`; the SDK's `constructEvent` refuses timestamps more than 300 seconds away. Events are `{ id, type, created, livemode, data }`; deliveries repeat, and failed ones are retried after 30 s, 5 min, 30 min, 2 h and 8 h. `payment.cancelled` carries no payment id. "Fulfil on `payment.succeeded` … key fulfilment on the payment `id` and ignore repeats." A return URL is navigation only.
- Idempotency: `Idempotency-Key` is honoured on `POST /v1/checkout`, `/v1/refunds`, `/v1/webhooks`, and on billing `plans`, `customers`, `subscriptions`; "other write endpoints ignore the header" (cancel and change plan among them). Keys live at least 24 hours, are scoped to the project and mode; `409 idempotency_conflict` is safe to retry after a delay, `409 idempotency_key_already_used` is not.
- Errors: `{ error: { message, type, code, request_id } }`; retry `429` (honour `Retry-After`) and `5xx` with bounded backoff, except `refund_outcome_unknown`. Every response has `X-Request-Id`.
- Billing (live needs PayBridgeNP Growth or higher; sandbox works on every plan): plans, customers (`externalCustomerId`), subscriptions (`referenceId`, `metadata`), invoices with `hosted_invoice_url`. "PayBridgeNP generates invoices automatically at each renewal, sends payment links to customers": renewals are not charged automatically, the studio pays each invoice through its link. A subscription without a trial starts `incomplete` and becomes `incomplete_expired` (its invoice voided) if the first invoice isn't paid in 24 hours. "Do not grant paid access from `status` alone … Base access for a billing period on that period's `invoice.paid` event or paid invoice record." Cancel takes `atPeriodEnd`; change plan with `prorationBehavior: "none"` schedules the new plan for the next renewal (`pending_plan`). Subscription statuses: `incomplete`, `incomplete_expired`, `draft`, `trialing`, `active`, `past_due`, `paused`, `cancelled`, `completed`; invoice statuses: `draft`, `open`, `paid`, `overdue`, `void`, `uncollectible`.
- An invoice has no period of its own in the API; its `subscription.current_period_start` / `current_period_end` describe the subscription when read. TattooDrip stores them the first time it reads an invoice (an invoice is generated at its period's start), never changes them afterwards, and grants access for that stored period once the invoice is paid. When they are missing, the paid period is the plan's interval from `paid_at`.
- Refunds: `refund.succeeded` and `payment.refunded` events; a refund issued from the provider's own panel reaches PayBridgeNP only through its dashboard's "Sync with provider", which then sends `payment.refunded`. Partial provider-panel refunds must be entered in PayBridgeNP by hand.

## What is built

- **Provider adapter** (`#services/paybridge`): the only code that calls PayBridgeNP. It wraps the SDK, normalises objects, maps errors to stable kinds, retries reads and idempotent writes a bounded number of times, and verifies webhooks with `constructEvent`. Tests swap it for a fake (`PaymentProviders` in the container).
- **SaaS billing** (`billing` module): plan catalogue in code synchronised with `node ace billing:sync-plans`; subscribe, cancel at period end, change plan (next renewal), pay an invoice through its hosted link, sync now; the studio's Billing settings page; access periods granted only from paid invoices confirmed with the API; the admin Billing page.
- **Studio payments** (`payments` module): the studio's PayBridgeNP connection (key encrypted with `PAYMENT_CREDENTIALS_KEY`, never sent to a browser, never logged); online deposit checkout from the deposit page; fulfilment only from a verified webhook or an explicit one-off sync, after matching status, amount, currency, livemode, session and metadata with the stored checkout; duplicate, mismatched and late payments are recorded for review and never fulfil twice; refunds made in PayBridgeNP are recorded as refund adjustments; the owner's per-payment "Check status".
- **Ledger and income**: online deposits are ordinary `payments` rows (verified, method `esewa`/`khalti`/`fonepay`, no verifier), so the Payments card, balance due and booking rules apply unchanged. The Transactions page lists the studio's records with gross collected, refunds, net collected and pending totals.
- **Reconciliation**: `ReconcilePaymentsJob` every 15 minutes (the existing scheduler) checks open checkouts 10 minutes to 2 days old once each, and subscriptions once a day; no tight polling.

## Not built, and why

- Refunds issued from TattooDrip: the studio refunds in its PayBridgeNP dashboard (eSewa refunds are completed there by hand anyway); TattooDrip records the result.
- Paying a booking balance online: the client-facing surface for it doesn't exist (the deposit page covers the deposit only).
- Enforcing a paid plan on the dashboard: `BillingService.access` computes it; no route is gated yet, so pilots keep working until the product decides the paywall.
- Settlement or payout reports: PayBridgeNP exposes none.
