# Online refunds and balance payments: design

Date: 2026-11-15. Follows the PayBridgeNP work in `docs/payments-paybridgenp.md` (PRs #128, #134).

## Intent

Studios that take deposits online through their own PayBridgeNP project still have to:

1. refund in PayBridgeNP's dashboard, then wait for TattooDrip to pick the refund up;
2. collect the rest of the price (the balance) in cash, by bank transfer or by screenshot, because only the deposit can be paid online.

This work lets an owner refund an online payment from the project's Payments card, and lets a client pay the balance online through the same page they paid the deposit on.

## Goals

- **Refund button:** an owner refunds an online payment (whole or part) from the Payments card. TattooDrip asks PayBridgeNP to refund it and records the refund in the ledger once PayBridgeNP confirms it.
- **Online balance payments:** once the deposit is paid, an owner sends the client a payment link for the balance, for an amount they choose (by default the whole balance due). The client opens the same page as the deposit link and pays online. The payment is recorded as a `balance` payment.
- **Safety:** each works safely under double clicks, repeated webhooks, lost answers from PayBridgeNP and concurrent desk payments, as the deposit flow does today.

## Non-goals

- Screenshot proofs for the balance (it is online only); refunding desk payments through PayBridgeNP; card payments; paying per session; asking for the balance automatically when the work is done; refunds started by the client.
- Changing how the deposit outcome of a closed project is recorded (the outcome form stays as it is).

## Anti-goals (failure even if it "works")

- A client is charged twice, or more than the studio asked for.
- A refund larger than what that payment, or the project, still holds.
- One studio's member refunding or reading another studio's payment.
- A secret key, or anything that lets a browser call PayBridgeNP as the studio, reaching the browser or the logs.
- The ledger saying money was refunded before PayBridgeNP confirmed it.

## Constraints

- **PayBridgeNP API** (SDK `@paybridge-np/sdk`): `refunds.create({ paymentId, amount, reason, notes?, mobileNumber? }, idempotencyKey)`.
  - `reason` is one of `customer_request`, `duplicate`, `fraudulent`, `other`.
  - A refund is `pending`, `succeeded` or `failed`; some (eSewa) stay pending until finished in PayBridgeNP.
  - `409 refund_outcome_unknown` must not be retried.
  - Idempotency keys last at least 24 hours.
  - `refund.succeeded` and `payment.refunded` webhooks already reach `GatewayCheckoutService.recordRefunds`.
- **Checkouts:** `gateway_checkouts.purpose` exists with a check of `('deposit')`, and one live checkout per project (`gateway_checkouts_one_open`). Checkout amounts are NPR 10 to NPR 1,000,000.
- **Deposit link:** one `deposit_links` row per project. A token works for 30 days and "New link" rotates it. `issueProblem` today requires `deposit_pending`.
- **Ledger:** `payments` is append-only, with kinds `deposit | session | balance | refund | correction`. Online rows have a null verifier. The desk refund limit is `balance.paid`.
- **Repo rules:**
  - tenant scoping and RLS on every query, with `inTenantAs` tests for new service queries;
  - an isolation case and a `TENANT_ROUTE_ROLES` entry for every new tenant route;
  - `openapi.yaml` changed first, then types regenerated;
  - work outside the database queued in the transaction (`dispatchInTransaction`, `sendMailInTransaction`).

## Approaches considered

**How the client reaches the balance payment:**

- **A. The same link and page, with a new state (chosen by the owner, 2026-11-15).** The deposit link page gains a `balance_due` state. The owner issues a fresh token from the Payments card once the deposit is paid. This reuses the token, page, SDK call and storefront screen.
- **B. A separate balance link.** It has its own table, page and message, so it is clearer in isolation. Rejected: it duplicates the link and page machinery, with two pages to keep in sync.

**How the balance amount is set:**

- The owner picks it, defaulting to the balance due and never above it.
- Always the full balance due was rejected: an hourly quote's balance is only an estimate.

## The design

### 1. Online balance payments

**Owner side (Payments card, owners only).** When all of these hold:

- the project's deposit is covered;
- the status is `booked`, `in_progress`, `healing_check` or `completed`;
- the current quote is in NPR;
- the balance due is at least NPR 10;
- the studio's online payments are available (verified connection);

the card offers **"Ask for the balance online"**. It is a sheet with:

- the amount, prefilled with the balance due, between NPR 10 and the balance due, with the estimate noted for hourly quotes;
- the link, Copy and Share buttons, the same as the deposit panel.

Issuing:

- rotates the project's `deposit_links` token, as "New link" does, and keeps the reference code;
- sets a new `balance_requested` amount (paisa, nullable) on the link row;
- gives the link 30 days.

`issueProblem` gets a balance variant with its own reasons: `deposit_not_covered`, `nothing_due`, `online_unavailable`, `status`. Issuing again replaces the amount and the token.

**Messages.** A new message kind, `balance_link` (label "Balance link"), offered with the balance link to owners. Placeholders: `client_name`, `studio_name`, `amount`, `payment_link`. Default text: "Hi {client_name}, the balance for your tattoo at {studio_name} ({amount}) can be paid online here: {payment_link}". It needs:

- the messages module;
- the Settings, Messages page and its validators;
- the `message_templates` and `tattoo_projects.last_contact_kind` checks (new migration).

**Client side (the existing page, `GET /deposit/{token}`).** `depositState` gains `balance_due`, which applies when the deposit is settled, the link has a `balance_requested`, and the amount still to pay is above zero. That amount is `min(balance_requested, current balance due)`.

`DepositPage` gains a nullable `balance` object (`requested`, `requestedText`, `due`, `dueText`). `onlinePayment.available` is true in `due` or `balance_due` when online payments are available. Once the balance due reaches zero, by this payment or a desk payment, the state is `paid` again.

In `balance_due` the page offers only "Pay online": no screenshot methods.

The storefront deposit screen gets a `balance_due` view:

- "Balance due: NPR X" and a Pay online button;
- the same confirming / paid / failed handling as the deposit.

`openapi.yaml`, the SDK, the React hooks and the storefront are updated.

**Checkout.** The existing `startDepositCheckout` endpoint starts the right purpose for the page's state:

- in `due`, the deposit (as now);
- in `balance_due`, a `balance` checkout for the amount still to pay, read again under the project lock.

Changes:

- a migration adds `'balance'` to `gateway_checkouts_purpose`;
- reuse, supersede and `guardInFlight` work the same;
- `confirmPayment` records the ledger row with `kind = checkout.purpose`: `recordOnlineDeposit` is generalised to a deposit or a balance;
- review reasons are unchanged; an amount above what is still due at confirmation is held as `amount_mismatch`, so it is never recorded over the balance.

**Alerts.** There is a new staff alert kind, `online_balance` ("Balance paid online", owners and the project's artist, opening the Payments card), added to the kind check with its email copy. Held balance payments use the existing `online_review`.

### 2. The refund button

**Where.** A row on the Payments card that PayBridgeNP made (`onlineIds`, a deposit or balance), seen by an owner, gets **"Refund online"** when:

- the gateway payment is recorded;
- PayBridgeNP's status is `success` or partly refunded;
- something is left to refund;
- its connection is the studio's current, verified one.

Otherwise the row says "Refund it in PayBridgeNP" when something is left but the connection changed. The button shows whether or not a deposit outcome is needed: a refund lowers what the project holds (`settleableDeposit`), so the outcome form then asks only about the rest.

**Form (sheet).**

- the amount, between NPR 10 (or the remainder, if smaller) and the limit;
- the reason: "Client asked", "Paid twice" or "Other";
- an optional note.

The limit is the smallest of:

- the payment's amount minus what PayBridgeNP has refunded;
- minus the refunds TattooDrip requested that are still pending or unknown;
- `balance.paid`.

**Recording requests.** `gateway_refunds` is extended so a request exists before PayBridgeNP is called:

- `provider_refund_id` becomes nullable (still unique when set);
- new `idempotency_key` (unique), `requested_by_user_id` (users, set null), `reason` and `note`;
- `status` adds `requested` (written, PayBridgeNP not yet answered) and `unknown` (outcome unknown).

Refunds PayBridgeNP reports that TattooDrip didn't request keep working as now.

**Flow (`GatewayRefundService.request`, owners only).**

1. Lock the project, then the gateway payment row (the project-first order).
2. Check the limit and insert the `requested` row with a fresh idempotency key. Commit.
3. Call `refunds.create` with that key.
4. Store the answer:
   - `succeeded`: run the existing `recordRefunds`, which writes the negative ledger refund once;
   - `pending`: wait for the webhook or a sync;
   - `failed`: keep it with its reason, which the card shows;
   - `refund_outcome_unknown` (or a lost answer after retries): mark it `unknown`.
5. Another try of a `requested` row repeats the same key, so a double click or a retry never refunds twice.

The owner's "Check status" (sync) reads `listRefunds` and settles `requested` and `unknown` rows by matching PayBridgeNP's refunds for that payment. The reconciliation job does the same for rows older than 10 minutes.

**Ledger and card.** The ledger refund row stays verifier-less. The card reads "Refunded through PayBridgeNP by {owner}, {day}" when a TattooDrip request is linked to it, and the current wording otherwise. Pending requests show under the payment as "Refund of NPR X requested, waiting for PayBridgeNP".

**Routes.**

- `POST /t/:tenant/payments/:id/online-refunds` (owners): `TENANT_ROUTE_ROLES` entry, isolation case, CSRF, the usual flash.
- The balance link reuses the project's deposit-link route with an amount, or adds `POST /t/:tenant/projects/:id/balance-link` (builder's call).

### 3. Tests and docs

- **Service tests** cover each rule above:
  - limits, double requests, the lost answer, pending to succeeded by webhook, failed;
  - the balance state's edge cases: desk payment meanwhile, hourly quote, amount change, link reissue;
  - a balance checkout recorded as `balance`, and an over-amount held.
- **Isolation:** `inTenantAs` tests for every new query; isolation harness cases for the new routes.
- **The fake** (`tests/helpers/paybridge.ts`) gains `refunds.create` with idempotency and the pending, succeeded, failed and unknown outcomes.
- **Sandbox:** one check against the real API: create and read a refund of a sandbox payment, if a sandbox payment can be made.
- **Docs:** `docs/payments-paybridgenp.md`, `apps/platform/docs/backend.md`, `jobs-and-email.md`, `database/README.md`, the storefront docs and the openapi descriptions.

## Left to the builder

- Exact component layout inside the existing sheets.
- Whether the balance link uses its own route.
- The wording of error flashes.
- Matching rules for settling `unknown` refunds.
- Whether the Khalti `mobileNumber` is asked for up front, or only after PayBridgeNP says it is needed. Default: only after; show a message asking the owner to refund in PayBridgeNP.
