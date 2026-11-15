# Online Refunds and Balance Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners refund online payments from the Payments card, and clients pay a balance the owner asks for online, through the existing deposit page.

**Architecture:**
- Refunds are written as `gateway_refunds` request rows before PayBridgeNP is called (one idempotency key per row), then settled from the API answer, webhooks, sync and the reconciliation job. Open requests reserve their amount against every refund limit.
- A balance request is an amount on the project's `deposit_links` row. The deposit page gains a `balance_due` state. The existing checkout path starts a `balance`-purpose checkout and records it as a `balance` ledger payment, clearing the request.

**Tech Stack:** AdonisJS 7, Lucid, VineJS, Inertia + React (platform); TanStack Start (storefront); `packages/types` OpenAPI, `@tattoo-drip/sdk`, `@tattoo-drip/react`; Japa; Biome; `@paybridge-np/sdk` 5.7.0.

**Spec:** `docs/superpowers/specs/2026-11-15-refunds-and-balance-payments-design.md` (approved 2026-11-15). Read it with this plan.

## Global Constraints

- Tenant scoping on every query, under RLS. Each new service query gets an `inTenantAs` test from another tenant's context. Each new tenant route gets a `TENANT_ROUTE_ROLES` entry (OWNERS) and an isolation case in `apps/platform/tests/isolation/cases.ts`.
- Lock order: the project (`ProjectService.lockLive`), then the gateway payment or checkout row.
- Writes the outside world sees (API calls) happen only after the row that records the attempt is committed. Emails and jobs go out with `sendMailInTransaction` / `dispatchInTransaction`.
- Never log or send to a browser a secret key, PayBridgeNP ids in emails, or client data in email subjects.
- Amounts are integer paisa. Checkout bounds are NPR 10 to NPR 1,000,000 (`1000..100000000`).
- Generated files are never hand-edited:
  - `openapi.yaml`, then `pnpm --filter @tattoo-drip/types generate`;
  - a migration, then `pnpm migrate`, then `npx biome check --write database/schema.ts`;
  - `node ace codegen` after route or controller changes;
  - `pnpm --filter @tattoo-drip/storefront generate-routes` if storefront routes change.
- Copy, as the spec fixes it:
  - balance message default: "Hi {client_name}, the balance for your tattoo at {studio_name} ({amount}) can be paid online here: {payment_link}";
  - eSewa card text: "Send NPR X back to the client in the eSewa merchant portal, then mark it completed in PayBridgeNP.";
  - Fonepay row text: "Fonepay refunds are made in your PayBridgeNP dashboard".
- Refund reasons map to PayBridgeNP: Client asked → `customer_request`; Paid twice → `duplicate`; Other → `other`.
- PayBridgeNP sends no webhook for a refund that fails or is marked "not refunded" later. Only sync and the reconciliation job see that.
- Commits: Conventional Commits with an area scope, ending with the session's attribution lines.

## Review Focus

1. **Double submit of the refund form** (two tabs, double tap): one PayBridgeNP refund, one request row. The second call either reuses the open `requested` row's key or is refused by the limit. Test in Task 4.
2. **Studio reconnected a different PayBridgeNP project after the payment:** no Refund button; the row says to refund in PayBridgeNP. The service refuses (`connection_changed`) even if posted directly. Test in Task 4.
3. **Desk payment between issuing a balance request and the client paying:** the page and checkout charge `min(requested, due)`. If the desk payment covered everything, the state is `paid` and checkout is refused (`not_due`). Test in Task 6.
4. **eSewa refund marked "not refunded" in PayBridgeNP days later** (no webhook): the reconciliation job's next run moves it to `failed`, releasing the reserve. Test in Task 4.
5. **Client opens an old balance link after the owner reissued it with a new amount:** the old token is dead (the rotation already does this); the new one shows the new amount. Test in Task 6.

---

### Task 1: Schema changes

**Files:**
- Create: `apps/platform/database/migrations/1791990000000_online_refunds_and_balance_payments.ts`
- Modify:
  - `apps/platform/app/modules/payments/models/gateway_refund.ts`, `gateway_checkout.ts`, `deposit_link.ts` (declared types);
  - `apps/platform/app/modules/notifications/alerts.ts` (`ALERT_KINDS`);
  - `apps/platform/app/modules/notifications/messages.ts` (`MESSAGE_KINDS`);
  - `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (only if a check it pins changes).
- Generated: `apps/platform/database/schema.ts`
- Test: `apps/platform/tests/functional/payments/online_refund_schema.spec.ts`

**Interfaces:**
- Produces:
  - `deposit_links.balance_requested integer null`, checked `balance_requested is null or balance_requested between 1000 and 100000000`;
  - `gateway_checkouts_purpose` check `purpose in ('deposit','balance')`;
  - `gateway_refunds.provider_refund_id` nullable, keeping its unique;
  - new columns `idempotency_key uuid null unique`, `requested_by_user_id uuid null` (FK users, set null), `reason varchar(24) null` (check in `customer_request`, `duplicate`, `other`), `note varchar(500) null`;
  - status check adds `requested`;
  - check `(status = 'requested') <= (provider_refund_id is null)`, plus `provider_refund_id is not null or idempotency_key is not null`;
  - `staff_alerts_kind_check` adds `online_balance`, which counts as a gateway-payment kind in `staff_alerts_subject_matches_kind`;
  - `message_templates_kind_check` and `tattoo_projects_last_contact_kind_check` add `balance_link`;
  - model types `RefundRequestReason = "customer_request" | "duplicate" | "other"`, `CheckoutPurpose = "deposit" | "balance"`.
- `down()` deletes rows using the new values, then restores each previous definition exactly.

- [ ] **Step 1:** Write `online_refund_schema.spec.ts`. In a global transaction, as the owner role through `inTenant`:
  - a `gateway_refunds` row with `status: "requested"`, `provider_refund_id: null` and an idempotency key inserts;
  - the same with neither id nor key is rejected (`/violates check constraint/`);
  - a `gateway_checkouts` row with `purpose: "balance"` inserts;
  - `deposit_links.balance_requested = 500` is rejected.
- [ ] **Step 2:** Run `pnpm test functional --files=online_refund_schema.spec.ts`. Expected: FAIL (constraint names, missing columns).
- [ ] **Step 3:** Write the migration. Model it on `1791980000000_add_online_payments_to_staff_alerts.ts` (raw statements, a down list). Add `balance_link` to `MESSAGE_KINDS` with its label, offered text, placeholders and default (Task 6 fills the UI), and `online_balance` to `ALERT_KINDS`, so `bellKinds` / `LINES` compile (`LINES.online_balance` titles "Balance paid online" / "The balance was paid online for your project").
- [ ] **Step 4:** `pnpm migrate`, regenerate the schema, `pnpm typecheck`, rerun the spec. Expected: PASS. Run `pnpm test unit` and `catalog_guard.spec.ts`. Expected: PASS (update `bellKinds` unit expectations to include `online_balance`).
- [ ] **Step 5:** Commit `feat(platform): schema for online refunds and balance payments`.

### Task 2: PayBridgeNP refund call (adapter and fake)

**Files:**
- Modify: `apps/platform/app/services/paybridge.ts` (`GatewayApi`, `SdkGatewayApi`), `apps/platform/tests/helpers/paybridge.ts`
- Test: `apps/platform/tests/unit/services/paybridge_refunds.spec.ts`

**Interfaces:**
- Produces:
  - `GatewayApi.createRefund(input: RefundInput, idempotencyKey: string): Promise<ProviderRefund>`, where `RefundInput = { paymentId: string; amount: number; reason: "customer_request" | "duplicate" | "other"; notes: string | null }`;
  - it uses the `once()` wrapper (no retry), because a lost answer must not be repeated blindly; the caller retries with the same key;
  - a `502 refund_outcome_unknown` surfaces as `ProviderError` with `code === "refund_outcome_unknown"`; a `422` as kind `invalid`.
- Produces in the fake:
  - `paybridge.refundBehaviour(method: "khalti" | "esewa" | "fonepay", outcome?: "succeeded" | "failed" | "unknown")` drives what `createRefund` answers, by the payment's `method`:
    - khalti: `succeeded` by default, `failed` or `unknown` (throws the 502 and stores the refund as `requires_action`);
    - esewa: `requires_action`;
    - fonepay: throws 422;
  - the same idempotency key returns the same refund;
  - refunds made this way appear in `listRefunds`;
  - `paybridge.settleRefund(id, "succeeded" | "failed")` changes a stored refund's status (the owner marking it in the dashboard).

- [ ] **Step 1:** Unit tests against the fake's `GatewayApi`:
  - khalti → `status: "succeeded"`;
  - the same key twice → same `id`, one entry in `listRefunds`;
  - esewa → `requires_action`;
  - fonepay → rejects with `ProviderError` kind `invalid`;
  - khalti unknown → rejects with `code: "refund_outcome_unknown"` and `listRefunds` holds it as `requires_action`.

  One more test maps a raw SDK error `{ status: 502, code: "refund_outcome_unknown" }` through `toProviderError` and asserts `code` and that `withRetries` is not used (`createRefund` is called once: spy on the SDK client method).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `createRefund` in `SdkGatewayApi` with `this.#client.refunds.create({ paymentId, amount, reason, notes }, idempotencyKey)` through `once("refunds.create", …)` and `normalizeRefund`. Implement the fake.
- [ ] **Step 4:** Run. Expected: PASS. `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(platform): PayBridgeNP refund call`.

### Task 3: Open online refunds reserve money

**Files:**
- Modify:
  - `apps/platform/app/modules/payments/services/payment_service.ts` (`forProject`, `refund`, `recordOutcome`);
  - `apps/platform/app/modules/payments/ledger.ts` (`ProjectMoney` gains `onlineRefundsOpen: number`);
  - `apps/platform/app/modules/payments/payments_card.ts` (`refundMax` and the outcome limit use the reserve).
- Test: `apps/platform/tests/functional/payments/refund_reserve.spec.ts`, `apps/platform/tests/unit/modules/payments/payments_card.spec.ts`

**Interfaces:**
- Produces:
  - `PaymentService.openOnlineRefunds(tenant: TenantRef, projectId: string): Promise<number>`: the sum of `gateway_refunds.amount` with status in `requested`, `processing`, `requires_action`, for the project; one query on `(tenant_id, project_id)` (add that index in Task 1's migration if absent);
  - `ProjectMoney.onlineRefundsOpen`;
  - `refund()` refuses `refund_too_large` above `balance.paid - onlineRefundsOpen`;
  - `recordOutcome` refuses above `depositSettleable - onlineRefundsOpen`;
  - the card's `refundMax` is `balance.paid - onlineRefundsOpen` (null when ≤ 0).

- [ ] **Step 1:** Tests:
  - a project holding NPR 3,000 with an open `requires_action` refund of NPR 1,000: a desk refund of 2,500 is refused with `refund_too_large`, and 2,000 is accepted;
  - with the project cancelled holding the deposit, an outcome refund above 2,000 is refused;
  - a `failed` request reserves nothing;
  - `openOnlineRefunds` from another tenant's context (`inTenantAs`) is 0;
  - unit: `paymentsCard` with `onlineRefundsOpen: 100_000` gives `refundMaxText: "NPR 2,000"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run these, `deposits.spec.ts` and `payment_service` specs. Expected: PASS.
- [ ] **Step 5:** Commit `feat(platform): open online refunds reserve their amount`.

### Task 4: Refund requests (service, route, settling)

**Files:**
- Create:
  - `apps/platform/app/modules/payments/services/gateway_refund_service.ts`;
  - `apps/platform/app/controllers/online_refunds_controller.ts`;
  - `apps/platform/app/modules/payments/validators/online_refund.ts`.
- Modify:
  - `apps/platform/start/routes.ts`;
  - `apps/platform/app/modules/tenancy/access.ts`;
  - `apps/platform/tests/isolation/cases.ts`;
  - `apps/platform/app/modules/payments/errors.ts` (`GatewayRuleError` reasons);
  - `apps/platform/app/modules/payments/services/gateway_checkout_service.ts` (`recordRefunds` links an incoming refund to an open `requested` row);
  - `apps/platform/app/modules/payments/jobs/reconcile_payments_job.ts` (settles open requests).
- Test: `apps/platform/tests/functional/payments/online_refunds.spec.ts`

**Interfaces:**
- Consumes: `GatewayApi.createRefund` (Task 2), `PaymentService.openOnlineRefunds` (Task 3), `GatewayCheckoutService.recordRefunds`.
- Produces:
  - `GatewayRefundService.request(tenant, member: Member, ledgerPaymentId: string, input: { amount: number; reason: RefundRequestReason; note: string | null }): Promise<GatewayRefund>`, owners only (`assertOwner`); refusals are `GatewayRuleError` with reasons `not_online`, `fonepay`, `connection_changed`, `refund_too_large` (with the limit), `provider_refused`;
  - `GatewayRefundService.refundable(tenant, ledgerPaymentIds: string[]): Promise<Map<string, RefundableInfo>>`, where `RefundableInfo = { method: OnlineMethod; max: number; connectionCurrent: boolean; open: { amount: number; status: string }[]; requestedBy: string | null }` (for the card);
  - `GatewayRefundService.settleOpen(tenant, gatewayPaymentId: string): Promise<void>` (sync and job);
  - route `POST /t/:tenant/payments/:id/online-refunds`, named `tenant.payments.online_refunds.store`, OWNERS;
  - validator: `amount` number in rupees, converted to paisa as the desk refund validator does; `reason` in the three; `note` optional, max 500.
- Flow and limits are exactly the spec's "Flow" and "limit" bullets. Matching in `recordRefunds`: a provider refund not yet known is linked to the open `requested` row of the same gateway payment and amount (oldest first) before creating a new row.

- [ ] **Step 1:** Tests, end to end through the route as the owner, with the fake:
  - khalti refund of part → flash success; a ledger refund row with `-amount`; the request `succeeded` with `requested_by_user_id` = owner;
  - the same POST twice concurrently (`Promise.all`) → one PayBridgeNP refund, one request (Review Focus 1);
  - esewa → request `requires_action`, no ledger row, card text includes "eSewa merchant portal";
  - `paybridge.settleRefund(id, "succeeded")` plus the `refund.succeeded` webhook → ledger row;
  - esewa then `settleRefund(id, "failed")` and running `ReconcilePaymentsJob` → request `failed`, reserve released (Review Focus 4);
  - fonepay → refused `fonepay`, no PayBridgeNP call;
  - khalti unknown → request `requires_action` with its provider id read back; a second request above the remaining limit is refused;
  - amount above `min(payment remaining, balance.paid - open)` → `refund_too_large`;
  - studio reconnected another key → `connection_changed` (Review Focus 2);
  - an artist → 403 (route roles);
  - another tenant's owner posting this payment id → 404 and no PayBridgeNP call;
  - `refundable` and `settleOpen` from another tenant's context (`inTenantAs`) find nothing.
- [ ] **Step 2:** Run `pnpm test functional --files=online_refunds.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the service, controller (flash copy per reason), route, roles and isolation case (positive control: a successful refund changes `onlinePaymentRows`), `recordRefunds` matching and the job step: open requests up to 30 days old, oldest first, at most 500 per run, through the existing `gateway_checkouts_to_reconcile` pattern or a new definer function `open_gateway_refunds()` that returns `(tenant_id, gateway_payment_id)`. If you add the function, add it to `DEFINER_FUNCTIONS` with its own property spec.
- [ ] **Step 4:** Run this spec, `online_deposits.spec.ts`, `cross_tenant`, `role_access`, `tenant_routes`, `catalog_guard`. Expected: PASS. `node ace codegen`, `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(platform): refund online payments from TattooDrip`.

### Task 5: Refund button on the Payments card

**Files:**
- Modify:
  - `apps/platform/app/modules/payments/payments_card.ts` (`PaymentRowProps.onlineRefund`);
  - `apps/platform/app/controllers/projects_controller.ts` (passes `refundable`);
  - `apps/platform/inertia/components/payments_card.tsx` (row action and sheet).
- Test: `apps/platform/tests/unit/modules/payments/payments_card.spec.ts`, plus one HTTP check in `online_refunds.spec.ts`

**Interfaces:**
- Consumes: `GatewayRefundService.refundable` (Task 4).
- Produces: `PaymentRowProps.onlineRefund: null | { kind: "button"; max: number; maxText: string } | { kind: "dashboard"; text: string }` (owners only; null for artists), and `PaymentRowProps.refundNotes: string[]`:
  - open requests: "Refund of NPR 1,000 requested, waiting for PayBridgeNP", or the eSewa or Khalti-unknown text;
  - failed: "Refund of NPR 1,000 failed: <reason>".

  The decision text for a refund linked to a request is "Refunded through PayBridgeNP by {name}, {day}".

- [ ] **Step 1:** Unit tests for each prop shape:
  - khalti refundable → button with `maxText`;
  - fonepay → dashboard text (spec copy);
  - connection changed → "Refund it in PayBridgeNP";
  - artist → null;
  - an open esewa request → the eSewa note;
  - a refund row requested by Asha → "Refunded through PayBridgeNP by Asha Rai, 18 Oct 2026".

  HTTP: the project page as the owner, after a khalti payment, has `onlineRefund.kind === "button"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The sheet is modelled on the desk "Record a refund" sheet (`FormSheetTrigger`, route `tenant.payments.online_refunds.store`, amount with max, reason select, note).
- [ ] **Step 4:** Run. Expected: PASS. `pnpm typecheck`, `pnpm check`.
- [ ] **Step 5:** Commit `feat(platform): Refund online button on the Payments card`.

### Task 6: Asking for the balance (owner side and page state)

**Files:**
- Modify:
  - `apps/platform/app/modules/payments/services/deposit_link_service.ts` (`issueBalance`, `balanceProblem`);
  - `apps/platform/app/modules/payments/deposit_page.ts` (`depositState` gains `balance_due`; `DepositFacts` gains `balanceRequested: number | null`);
  - `apps/platform/app/modules/payments/services/deposit_page_service.ts` (`DepositPage.balance`);
  - `apps/platform/app/controllers/deposit_links_controller.ts` (`storeBalance`);
  - `apps/platform/start/routes.ts`, `access.ts`, `tests/isolation/cases.ts`;
  - `apps/platform/app/modules/notifications/messages.ts`, the Settings, Messages validators and page;
  - `apps/platform/inertia/components/payments_card.tsx` (the "Ask for the balance online" sheet with link, copy and share, rendering `balance_link`).
- Test: `apps/platform/tests/functional/payments/balance_requests.spec.ts`, `apps/platform/tests/unit/modules/payments/deposit_page.spec.ts`

**Interfaces:**
- Produces:
  - `DepositLinkService.issueBalance(tenant, member, project, amount: number): Promise<{ link: DepositLink; token: string; replaced: boolean }>`;
  - `balanceProblem(tenant, project): Promise<BalanceLinkRuleReason | null>`, with `BalanceLinkRuleReason = "deposit_not_covered" | "nothing_due" | "online_unavailable" | "status" | "amount_out_of_range"`;
  - route `POST /t/:tenant/projects/:id/balance-link`, named `tenant.projects.balance_link.store`, OWNERS;
  - `DepositState` adds `"balance_due"`;
  - `DepositPage.balance: null | { requested: number; due: number }`, where `due = min(requested, max(0, balance due))`;
  - `depositState` returns `balance_due` when settled, `balanceRequested !== null` and that `due > 0`;
  - message kind `balance_link` with placeholders `client_name`, `studio_name`, `amount`, `payment_link` (a new placeholder; help text "the payment page link").

- [ ] **Step 1:** Tests:
  - issue for NPR 5,000 of a 20,000 balance on a booked project → page `balance_due`, `balance.due` 500000, no screenshot methods, `onlinePayment.available` true;
  - a desk payment of 18,000 meanwhile → `balance.due` 200000;
  - a desk payment covering everything → `paid` (Review Focus 3);
  - reissue with 3,000 → the old token 404s, the new one shows 300000 (Review Focus 5);
  - refusals: deposit not covered, online unavailable (unverified connection), amount above balance or below NPR 10, status `deposit_pending`;
  - an hourly quote can be asked for an amount within the estimated balance;
  - an artist posting → 403;
  - another tenant → 404;
  - unit `depositState` cases for `balance_due`;
  - messages unit: `balance_link` renders its default.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `issueBalance` reuses `issue`'s token rotation under the project lock and sets `balance_requested`; plain `issue` (deposit) sets it to null.
- [ ] **Step 4:** Run these and `deposits.spec.ts`, `deposit_page_service.spec.ts`, `cross_tenant`, `tenant_routes`, settings message specs. Expected: PASS. `node ace codegen`, `pnpm typecheck`.
- [ ] **Step 5:** Commit `feat(platform): ask for the balance online`.

### Task 7: Paying the balance (checkout, recording, alert)

**Files:**
- Modify:
  - `apps/platform/app/modules/payments/services/gateway_checkout_service.ts` (`startDeposit` starts the purpose for the page state; `confirmPayment`);
  - `apps/platform/app/modules/payments/services/payment_service.ts` (`recordOnlineDeposit` becomes `recordOnlinePayment(tenant, projectId, input & { kind: "deposit" | "balance" })`; callers updated);
  - `apps/platform/app/modules/payments/jobs/online_payment_alert_job.ts` and `alert_service.ts` (`online_balance`);
  - `alerts.ts` (`alertTarget`, `onlinePaymentIntro`, subject for balance).
- Test: `apps/platform/tests/functional/payments/balance_checkout.spec.ts`

**Interfaces:**
- Consumes: `DepositPage.balance` and the `balance_due` state (Task 6).
- Produces:
  - a `balance` checkout's amount is `checkoutAmount(page.balance.due)`;
  - `confirmPayment` holds `amount_mismatch` when the paid amount is above what is still due under the lock;
  - it records `kind: checkout.purpose`;
  - in the same transaction it sets the project link's `balance_requested = null` when `purpose === "balance"`;
  - the alert job picks `online_balance` for a recorded balance payment.

- [ ] **Step 1:** Tests:
  - `balance_due` page → `POST …/checkout` creates a `purpose: "balance"` checkout for 500000; the webhook records a `balance` ledger payment, the page reads `paid`, and `balance_requested` is null;
  - after that, an online refund of it leaves the page `paid` (no reopening);
  - a desk payment between checkout start and webhook that leaves less due than paid → held `amount_mismatch`;
  - the alert job writes `online_balance` alerts for owner and artist with subject "Balance paid online for Black Needle";
  - the deposit flow is unchanged (`online_deposits.spec.ts` passes).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run this spec, `online_deposits`, `online_payment_alerts`, `online_payment_race`, `transactions`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(platform): pay the balance online`.

### Task 8: API contract, SDK and storefront

**Files:**
- Modify:
  - `packages/types/openapi.yaml` (`DepositState` enum adds `balance_due` with a description; `DepositPage` gains required nullable `balance` `{ requested, requestedText, due, dueText }`; `DepositOnlinePayment.available` description);
  - regenerate `packages/types/src/openapi.gen.ts`;
  - `apps/platform/app/transformers/public_deposit_transformer.ts`;
  - SDK and React types if they restate the shape;
  - `apps/storefront/src/deposit/view-model.ts`, `components/deposit-screen.tsx`, `components/online-pay.tsx`, `copy.ts`.
- Test: `apps/platform/tests/functional/api/deposits.spec.ts`, `apps/storefront/test/deposit/view-model.test.ts`, `screen.test.ts`

**Interfaces:**
- Consumes: `DepositPage.balance` (Task 6).
- Produces: the public JSON `balance: { requested, requestedText, due, dueText } | null`. The storefront `balance_due` view shows:
  - heading "Balance due";
  - `dueText`;
  - the Pay online button (the existing `online-pay` component);
  - no proof form;
  - the confirming, paid and failed states as for the deposit.

- [ ] **Step 1:** Tests:
  - API: a `balance_due` page's JSON matches the schema (`assertApiData`), with `balance.dueText` "NPR 5,000";
  - storefront view-model: a `balance_due` page gives the balance view with the pay button and no proof form;
  - screen render test for that view.
- [ ] **Step 2:** Run (`pnpm --filter @tattoo-drip/storefront test`, platform API spec). Expected: FAIL.
- [ ] **Step 3:** Implement: openapi first, then generate, transformer, storefront.
- [ ] **Step 4:** Run, plus `pnpm typecheck` and `pnpm build` at the root. Expected: PASS.
- [ ] **Step 5:** Commit `feat(storefront): pay the balance online`.

### Task 9: Docs, full checks, sandbox check

**Files:**
- Modify: `docs/payments-paybridgenp.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/jobs-and-email.md`, `apps/platform/database/README.md`, the storefront deposit docs.

- [ ] **Step 1:** Update the docs. Remove "Refunds issued from TattooDrip" from the not-built list in `payments-paybridgenp.md`, and describe the per-provider behaviour, the reserve and balance requests.
- [ ] **Step 2:** Run `pnpm check`, `pnpm typecheck`, `pnpm test` (unit and functional separately in platform). Expected: PASS, except `rls/discovery.spec.ts` on a PostgreSQL 16 machine.
- [ ] **Step 3:** Sandbox: with the session's proxy-injected key, run a throwaway ace command (deleted after) that lists a sandbox payment's refunds through `SdkGatewayApi`. Create a refund only if a sandbox payment exists. Report what was and wasn't exercised.
- [ ] **Step 4:** Fable review on high effort (Opus max fallback) of the branch diff; fix the findings.
- [ ] **Step 5:** Commit `docs: online refunds and balance payments`, push, open the PR following `.github/pull_request_template.md`.
