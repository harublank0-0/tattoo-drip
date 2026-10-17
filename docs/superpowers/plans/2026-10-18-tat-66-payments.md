# Payment verification, desk payments and balance due (TAT-66) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners verify or reject deposit screenshots next to the expected amount and reference code, record desk payments, refunds and reversals (never editing a row), record what happened to a closed project's deposit, and see the balance due on the project and the client; a direct booking without a price can get one once.

**Architecture:** Two migrations: `payments.corrects_payment_id` and `payments.note` (with a replaced `payments_guard`), and a tenant-owned `deposit_outcomes` table. Pure money maths lives in `#modules/payments/ledger` (bigint balance, deposit money that counts only corrections of deposits, the "decided late" expiry rule). A new `PaymentService` does every owner write under the project's row lock (then the payment's) and the page reads; `DepositService` and `ProjectService` get the fixed deposit count, the expiry spare, the relaxed withdraw and `setPrice`. A pure `paymentsCard` builds the project page's Payments card props; the dashboard renders them.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, VineJS 4.4, `@adonisjs/drive` 4 (fs disks, signed URLs), Japa; Inertia + React 19 + shadcn for the dashboard.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-66-payments-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …` (check `node --version` prints v24.3.0 before the first test run). The machine's default Node 26 stalls the multipart parser (found in TAT-51's build).
- `<repo>` is the checkout you build in (this branch's worktree is `/home/blank/Coding/tattoo-drip-worktrees/tat-66`). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls, so every command uses `-C <repo>` or absolute paths.
- **TAT-65 first.** The coordinator rebases this branch onto TAT-65's final, reviewed tip before Task 1. Every task runs on that base. Tasks marked **(edits TAT-65 code)** change files TAT-65 wrote; the names below are those of TAT-65's plan (`docs/superpowers/plans/2026-10-18-tat-65-deposit-page.md`). If a review renamed one, use the real name and note the deviation in your report.
- **Two migrations:** `apps/platform/database/migrations/1791660000000_add_corrections_and_notes_to_payments.ts` and `apps/platform/database/migrations/1791660000001_create_deposit_outcomes_table.ts`. `database/schema.ts` changes only through `pnpm -C <repo>/apps/platform migrate`. The dev database is shared with other checkouts: after Task 1 it has the new columns, so another checkout's `pnpm migrate` would regenerate its `schema.ts` with them. Say so in your report.
- Fixture slugs in new tests end in `-66` (`pay-needle-66`, …): the tests share the dev database, where a slug someone once used stays taken.
- Money is integer paisa; totals are bigint (`quoteTotal`); never `sum(amount)::int`. Payments are summed in JavaScript (a project has a handful). Signed text uses U+2212 ("−NPR 3,000") through `formatSignedMoney`; `formatMoney` only gets amounts ≥ 0.
- Values (verbatim): note max 500 characters; desk and refund amounts `vine.number().min(0.01).max(10_000_000).decimal([0, 2])` rupees, stored as `Math.round(rupees * 100)` paisa; `PRIVATE_CACHE_CONTROL = "private, no-store"`; `CLOSED_FOR_OUTCOME = ["cancelled", "declined"]`; `DESK_KINDS = ["deposit", "session", "balance"]`.
- Flash messages (verbatim). Success: verify "Payment verified." + `bookingNote` (" The project is booked." / " Schedule a tattoo session to book the project." / " NPR 1,000 of the deposit is still due."); reject "Screenshot rejected." + (" The deposit page now asks the client for a new one." when it does); record "Payment recorded." + `bookingNote`; refund "Refund recorded."; reverse "Payment reversed." + (" NPR 3,000 of the deposit is due again." when a deposit is no longer covered); outcome kept "Recorded: the studio keeps the deposit."; outcome refunded "Recorded: NPR 2,000 of the deposit refunded."; price "Price set."; withdraw with a deposit held "Client withdrew: project cancelled. Record what happened to the deposit under Payments." Errors (`PAYMENT_RULE_MESSAGES`): `already_decided` "This payment was already verified or rejected. Check the list."; `not_reversible` "Only a verified payment that isn't a reversal can be reversed."; `already_reversed` "This payment was already reversed."; `deposit_not_pending` "A deposit can be recorded only while the project waits for it. Mark the quote accepted first."; `project_declined` "This project was declined: it takes no payments."; `outcome_first` "Record what happened to the deposit first."; `no_outcome_needed` "There's no deposit outcome to record for this project."; `refund_too_large` is a field error on `amount`: "You can refund at most NPR 3,000."; `price_locked` "This project already has a price, or isn't booked yet."
- Field messages (verbatim): amount "Enter an amount from 0.01 to 1,00,00,000 rupees, with at most 2 decimals."; kind "Choose what was paid."; method "Choose how it was paid."; note "Keep it under 500 characters."; outcome "Choose what happened to the deposit."; price `PRICE` from the quote validators ("Enter whole rupees from 1 to 1,00,00,000.").
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After route or controller changes run `pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- Tests: `PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module hangs Japa, so RED steps run as `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background). `pnpm typecheck` is the authority over editor diagnostics. The pre-commit hook runs Biome and may rewrite staged files: re-read a file before editing it again, and keep Biome's import order.
- A write by a member records `verified_by_user_id = member.userId`, a foreign key to `users`: tests pass a real user's id (`owner.id`), never a random one.
- Commits: Conventional Commits with the area scope (`platform`), ending with your session's attribution line (e.g. `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Never push, never open a PR.

## Review Focus

1. **A double tap or two owners on one screenshot.** The second Verify (or a Reject after a Verify) must be the `already_decided` flash with the first decision intact, never a 500 from the guard trigger. Tests: Task 9 "a second decision is refused under the lock, and the first stands", Task 13 "a second Verify is a flash, not an error".
2. **The latent underfunded booking.** A deposit, a mistaken refund and the reversal of that refund must count the deposit once. Tests: Task 3 "a reversed refund is not deposit money (the latent TAT-36 bug)", Task 4 "the refund-and-reversal case does not settle a bigger deposit".
3. **A reversal or rejection after the quote expired.** The project must survive every later sweep run, and an early decision must not spare it. Tests: Task 5 "spares it once the studio rejects the screenshot after the expiry; an earlier rejection still cancels", "a deposit reversed after the expiry spares a deposit_pending or quoted project; one reversed before doesn't", and the sweep test "through the worker, spares a waiting screenshot and a deposit reversed after the expiry".
4. **A screenshot key from another studio.** A key outside `tenants/<id>/payment_proof/` must never be signed, and a signed proof must answer `Cache-Control: private, no-store`. Tests: Task 8 "url refuses a key of another tenant or another purpose", "a private image is served only through its signed URL" (the header), "the Cache-Control is part of the signature: dropping it is a 401".
5. **An artist on the project.** The assigned artist sees the list and balance, never a screenshot URL or an action, and every write route is their 404. Tests: Task 13 "the assigned artist gets a 404 on every payment write", Task 14 "the assigned artist's card has the list and balance, no screenshots and no actions".

---

## Before Task 1: preconditions

- [ ] **Branch and base.** `git -C <repo> status -sb` shows `harublank00/tat-66-payment-verification-desk-payments-and-balance-due` and a clean tree. `git -C <repo> merge-base --is-ancestor harublank00/tat-65-deposit-page-amount-studio-qr-codes-reference-code-proof HEAD; echo $?` prints `0` (TAT-65's tip, with its review fixes, is in). If not, stop and report.
- [ ] **TAT-65 names this plan uses.** Each prints a match (else find the real name, use it, and note the deviation):
  - `rg -n 'async (remaining|pendingProof|lastDecisionRejected|countPendingProofs|recordProof)\(' <repo>/apps/platform/app/modules/payments/services/deposit_service.ts`
  - `rg -n 'async (findLive|lockLive)\(' <repo>/apps/platform/app/modules/projects/services/project_service.ts`
  - `rg -n 'async forProject\(' <repo>/apps/platform/app/modules/payments/services/deposit_link_service.ts` (returns the link with `referenceCode`)
  - `rg -n 'export function (depositServices|depositReady)' <repo>/apps/platform/tests/helpers/deposits.ts`
  - `rg -n 'depositProject|depositToken' <repo>/apps/platform/tests/helpers/tenants.ts`
  - `rg -n '"depositProject"' <repo>/apps/platform/tests/isolation/cases.ts`
  - `rg -n 'proofCount' <repo>/apps/platform/app/middleware/inertia_middleware.ts <repo>/apps/platform/inertia/components/shell/nav_items.ts`
  - `rg -n 'function DepositCard|Payment screenshot received' <repo>/apps/platform/inertia/pages/projects/show.tsx`
  - `rg -n 'private depositLinks|private deposits' <repo>/apps/platform/app/controllers/projects_controller.ts`
  - `ls <repo>/apps/platform/database/migrations | tail -3` (the last is `1791650000000_create_deposit_links_table.ts`; ours sort after it)
- [ ] **Every caller that Task 8 changes, and every test that makes a correction (Task 1 changes them).** Note the lists:
  - `rg -n '\.url\("(reference_image|payment_qr|payment_proof|artist_photo)"' <repo>/apps/platform/app <repo>/apps/platform/tests <repo>/apps/platform/database`
  - `rg -n 'kind: "correction"|"correction", -?[0-9]' <repo>/apps/platform/tests`
- [ ] **Install and migrate.** `pnpm -C <repo> install`, then `pnpm -C <repo>/apps/platform migrate` (applies TAT-65's migration if it isn't yet).
- [ ] **Baseline.** `PORT=3402 timeout 500 pnpm -C <repo>/apps/platform test functional --files=payments_table.spec.ts --files=deposit_service.spec.ts --files=deposit_reads.spec.ts --files=project_service.spec.ts --files=project_page.spec.ts --files=project_changes.spec.ts --files=image_service.spec.ts --files=file_serving.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts` passes.

---

### Task 1: Corrections name what they reverse, and payments get a note

**Files:**
- Create: `apps/platform/database/migrations/1791660000000_add_corrections_and_notes_to_payments.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts` (`PaymentOver`), `apps/platform/tests/functional/payments/payments_table.spec.ts`, `apps/platform/tests/functional/payments/deposit_service.spec.ts`, `apps/platform/tests/functional/projects/project_service.spec.ts`, and any other test from the precondition's correction list
- Regenerate: `apps/platform/database/schema.ts` (by `pnpm migrate`)

**Interfaces:**
- Produces: columns `payments.corrects_payment_id` (`Payment.correctsPaymentId: string | null`) and `payments.note` (`Payment.note: string | null`); constraints `payments_tenant_project_id_unique`, `payments_corrects_payment_foreign`, `payments_correction_target`, `payments_correction_not_itself`; unique index `payments_corrects_payment_id_unique`; guard errors `payments_guard: note cannot change` and `payments_guard: corrects_payment_id cannot change`. `makePayment`'s overrides accept `correctsPaymentId` and `note`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/helpers/pipeline.ts`, in `type PaymentOver`, add `| "correctsPaymentId"` and `| "note"` after `| "verifiedAt"`.

In `apps/platform/tests/functional/payments/payments_table.spec.ts`:

- Replace the body of "a refund is negative, a correction is non-zero, every other kind is positive" from `await withDbContext({ tenantId: a.id }, async () => {` to the end of the test with (each correction needs a payment to correct, and a payment is corrected at most once):

```ts
		await withDbContext({ tenantId: a.id }, async (trx) => {
			for (const [kind, amount, allowed] of cases) {
				const target =
					kind === "correction"
						? {
								corrects_payment_id: idOf(
									await insertRow(trx, "payments", newPayment(a.id, mine.id)),
								),
							}
						: {};
				const insert = () =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { kind, amount, ...target }),
						),
					);
				if (allowed) await insert();
				else await assert.rejects(insert, /payments_amount_sign/);
			}
		});
	});
```

- In "every kind, status and method in the model is accepted by the database", replace

```ts
			for (const kind of PAYMENT_KINDS) {
				const negative = kind === "refund" || kind === "correction";
				await makePayment(tenant, project, {
					kind,
					amount: negative ? -100_000 : 100_000,
				});
			}
```

with

```ts
			// A correction names the payment it reverses.
			const corrected = await makePayment(tenant, project);
			for (const kind of PAYMENT_KINDS) {
				const negative = kind === "refund" || kind === "correction";
				await makePayment(tenant, project, {
					kind,
					amount: negative ? -100_000 : 100_000,
					...(kind === "correction" ? { correctsPaymentId: corrected.id } : {}),
				});
			}
```

and change the final count to `1 + PAYMENT_KINDS.length + PAYMENT_STATUSES.length + PAYMENT_METHOD_KINDS.length`.

- Append these tests at the end of the `payments table` group (`note` is not in "the guard freezes the money facts": it has its own rule, tested here):

```ts
	test("a correction names a payment of its own project, once, and only a correction does", async ({
		assert,
	}) => {
		const { a, b, mine, other, theirs } = await twoTenants();
		const theirPayment = await withDbContext({ tenantId: b.id }, async (trx) =>
			idOf(await insertRow(trx, "payments", newPayment(b.id, theirs.id))),
		);
		const correction = (corrects: string | null, over = {}) =>
			newPayment(a.id, mine.id, {
				kind: "correction",
				amount: -300_000,
				corrects_payment_id: corrects,
				...over,
			});
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() => withTransaction((inner) => insertRow(inner, "payments", values)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const deposit = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			const elsewhere = idOf(
				await insertRow(trx, "payments", newPayment(a.id, other.id)),
			);

			await rejects(correction(null), /payments_correction_target/);
			await rejects(
				newPayment(a.id, mine.id, { corrects_payment_id: deposit }),
				/payments_correction_target/,
			);
			await rejects(correction(elsewhere), /payments_corrects_payment_foreign/);
			await rejects(correction(theirPayment), /payments_corrects_payment_foreign/);
			const self = randomUUID();
			await rejects(
				correction(self, { id: self }),
				/payments_correction_not_itself/,
			);

			const first = idOf(await insertRow(trx, "payments", correction(deposit)));
			await rejects(correction(deposit), /payments_corrects_payment_id_unique/);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "payments", first, {
							corrects_payment_id: elsewhere,
						}),
					),
				/payments_guard: corrects_payment_id cannot change/,
			);
		});
	});

	test("a note is written at insert or with the decision, and afterwards only cleared", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const rejects = (id: string, set: Record<string, unknown>) =>
			assert.rejects(
				() => withTransaction((inner) => updateRow(inner, "payments", id, set)),
				/payments_guard: note cannot change/,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			// A desk payment: recorded verified, with its note.
			const desk = idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(a.id, mine.id, {
						...verified(owner.id),
						note: "Paid by her brother",
					}),
				),
			);
			await rejects(desk, { note: "Something else" });
			await updateRow(trx, "payments", desk, { note: null });

			// A screenshot: no note until it is decided, then frozen.
			const proof = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			await rejects(proof, { note: "Before deciding" });
			await updateRow(
				trx,
				"payments",
				proof,
				verified(owner.id, { status: "rejected", note: "Not on the statement" }),
			);
			await rejects(proof, { note: "Changed my mind" });
			await updateRow(trx, "payments", proof, { note: null });

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { note: "x".repeat(501) }),
						),
					),
				/value too long/,
			);
		});
	});
```

Add `import { randomUUID } from "node:crypto";` at the top of the file.

In `apps/platform/tests/functional/payments/deposit_service.spec.ts`:

- In "a verified correction reverses a deposit; other kinds do not count", replace `await makePayment(tenant, project, verified());` (the line before `assert.isTrue(… "deposit")`) with `const deposit = await makePayment(tenant, project, verified());`, and add `correctsPaymentId: deposit.id,` to the correction's overrides after `amount: -300_000,`.
- In "sums the verified deposits and corrections in the currency", replace `await makePayment(tenant, project, { amount: 50_000, ...verified() });` with `const second = await makePayment(tenant, project, { amount: 50_000, ...verified() });`, and add `correctsPaymentId: second.id,` to the correction's overrides after `amount: -20_000,`.

In `apps/platform/tests/functional/projects/project_service.spec.ts`, in "a reversed payment no longer holds money", replace the first `await makePayment(tenant, project, {` (the verified deposit) with `const deposit = await makePayment(tenant, project, {`, and add `correctsPaymentId: deposit.id,` to the correction's overrides after `amount: -300_000,`.

Apply the same change (name the deposit, pass `correctsPaymentId`) to every other test the precondition listed.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=payments_table.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: `column "corrects_payment_id" of relation "payments" does not exist` (and `note`), and the type check of `makePayment`'s overrides once the schema lacks the columns.

- [ ] **Step 3: The migration**

Create `apps/platform/database/migrations/1791660000000_add_corrections_and_notes_to_payments.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * TAT-37's guard body, which down() restores. Kept verbatim: the pinned
 * search_path, the free columns and the finality rules.
 */
const GUARD_TAT_37 = `
create or replace function payments_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array['status', 'verified_by_user_id', 'verified_at', 'updated_at', 'proof_image_key', 'proof_image_width', 'proof_image_height'];
	changed text;
begin
	if tg_op = 'DELETE' then
		raise exception 'payments_guard: payments are never deleted';
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'payments_guard: % cannot change', changed;
	end if;
	-- The proof can only be cleared (TAT-42), never set to a new value.
	if (new.proof_image_key, new.proof_image_width, new.proof_image_height)
			is distinct from (old.proof_image_key, old.proof_image_width, old.proof_image_height)
		and (new.proof_image_key is not null or new.proof_image_width is not null or new.proof_image_height is not null) then
		raise exception 'payments_guard: proof can only be cleared';
	end if;
	-- A decided payment is final. The one change allowed is the verifier
	-- becoming null, and only once that user row is gone: ON DELETE SET NULL
	-- runs after the delete, so the row is invisible to it, while an ordinary
	-- UPDATE with the account still there would erase who decided. The table is
	-- schema-qualified because the search_path is pinned.
	if old.status <> 'submitted' then
		if new.status is distinct from old.status then
			raise exception 'payments_guard: status cannot change';
		end if;
		if new.verified_at is distinct from old.verified_at then
			raise exception 'payments_guard: verified_at cannot change';
		end if;
		if new.verified_by_user_id is distinct from old.verified_by_user_id
			and (new.verified_by_user_id is not null
				or exists (select 1 from public.users where id = old.verified_by_user_id)) then
			raise exception 'payments_guard: verified_by_user_id cannot change';
		end if;
	end if;
	return new;
end
$$`;

/**
 * The guard with the note rule (TAT-66): `note` is written at insert or in
 * the one update that decides a submitted payment, and afterwards can only
 * be cleared (TAT-42), like the proof. Every other column it doesn't name,
 * `corrects_payment_id` included, stays frozen.
 */
const GUARD_WITH_NOTE = `
create or replace function payments_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array['status', 'verified_by_user_id', 'verified_at', 'updated_at', 'proof_image_key', 'proof_image_width', 'proof_image_height', 'note'];
	changed text;
begin
	if tg_op = 'DELETE' then
		raise exception 'payments_guard: payments are never deleted';
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'payments_guard: % cannot change', changed;
	end if;
	-- The proof can only be cleared (TAT-42), never set to a new value.
	if (new.proof_image_key, new.proof_image_width, new.proof_image_height)
			is distinct from (old.proof_image_key, old.proof_image_width, old.proof_image_height)
		and (new.proof_image_key is not null or new.proof_image_width is not null or new.proof_image_height is not null) then
		raise exception 'payments_guard: proof can only be cleared';
	end if;
	-- The note goes with the decision, or is cleared (TAT-42); nothing else.
	if new.note is distinct from old.note and new.note is not null
		and not (old.status = 'submitted' and new.status <> 'submitted') then
		raise exception 'payments_guard: note cannot change';
	end if;
	-- A decided payment is final. The one change allowed is the verifier
	-- becoming null, and only once that user row is gone: ON DELETE SET NULL
	-- runs after the delete, so the row is invisible to it, while an ordinary
	-- UPDATE with the account still there would erase who decided. The table is
	-- schema-qualified because the search_path is pinned.
	if old.status <> 'submitted' then
		if new.status is distinct from old.status then
			raise exception 'payments_guard: status cannot change';
		end if;
		if new.verified_at is distinct from old.verified_at then
			raise exception 'payments_guard: verified_at cannot change';
		end if;
		if new.verified_by_user_id is distinct from old.verified_by_user_id
			and (new.verified_by_user_id is not null
				or exists (select 1 from public.users where id = old.verified_by_user_id)) then
			raise exception 'payments_guard: verified_by_user_id cannot change';
		end if;
	end if;
	return new;
end
$$`;

/**
 * Corrections and notes on the ledger (TAT-66). A correction names the
 * payment it reverses: same tenant and project (the composite key), never
 * itself, at most once (the unique index). Only a correction names one. A
 * payment can carry a staff note (payments_guard decides when it may
 * change). The guard's trigger stays bound; only its function is replaced.
 */
export default class extends BaseSchema {
	protected tableName = "payments";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.uuid("corrects_payment_id").nullable();
			table.string("note", 500).nullable();
		});
		for (const statement of [
			// The target of the correction's composite key.
			"alter table payments add constraint payments_tenant_project_id_unique unique (tenant_id, project_id, id)",
			"alter table payments add constraint payments_corrects_payment_foreign foreign key (tenant_id, project_id, corrects_payment_id) references payments (tenant_id, project_id, id) on delete no action",
			// One reversal per payment; also the foreign key's index.
			"create unique index payments_corrects_payment_id_unique on payments (corrects_payment_id)",
			"alter table payments add constraint payments_correction_target check ((kind = 'correction') = (corrects_payment_id is not null))",
			"alter table payments add constraint payments_correction_not_itself check (corrects_payment_id <> id)",
			GUARD_WITH_NOTE,
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const statement of [
			GUARD_TAT_37,
			"alter table payments drop constraint payments_correction_not_itself",
			"alter table payments drop constraint payments_correction_target",
			"drop index payments_corrects_payment_id_unique",
			"alter table payments drop constraint payments_corrects_payment_foreign",
			"alter table payments drop constraint payments_tenant_project_id_unique",
		]) {
			this.schema.raw(statement);
		}
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("note");
			table.dropColumn("corrects_payment_id");
		});
	}
}
```

Before running it, diff `GUARD_TAT_37` against the function body in `1791590000005_create_payments_table.ts`: they must be identical except for `create` → `create or replace`.

Run: `pnpm -C <repo>/apps/platform migrate`
Expected: the migration runs; `database/schema.ts` gains `correctsPaymentId` and `note` on `PaymentSchema`. If it fails on `payments_correction_target`, a correction row already exists in the dev database: stop and report (nothing in the app creates one, so it would be someone's hand-made row).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=payments_table.spec.ts --files=guard_search_path.spec.ts --files=deposit_service.spec.ts --files=project_service.spec.ts --files=deposit_reads.spec.ts`
Expected: PASS (the guard's pinned `search_path` is still checked by `guard_search_path.spec.ts`).

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/database apps/platform/tests/helpers/pipeline.ts apps/platform/tests/functional
git -C <repo> commit -m "feat(platform): make corrections name the payment they reverse, and add payment notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `deposit_outcomes` table

**Files:**
- Create: `apps/platform/database/migrations/1791660000001_create_deposit_outcomes_table.ts`, `apps/platform/app/modules/payments/models/deposit_outcome.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`EXPECTED_POLICIES`)
- Test: `apps/platform/tests/functional/payments/deposit_outcomes_table.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `payments_tenant_project_id_unique`.
- Produces: table `deposit_outcomes` (columns `id`, `tenant_id`, `project_id`, `session_id`, `outcome`, `amount`, `currency`, `refund_payment_id`, `note`, `recorded_by_user_id`, `created_at`, `updated_at`); constraints `deposit_outcomes_tenant_id_project_id_foreign`, `deposit_outcomes_session_foreign`, `deposit_outcomes_refund_payment_foreign`, `deposit_outcomes_amount_positive`, `deposit_outcomes_refund_matches`, `deposit_outcomes_moved_needs_session`; unique indexes `deposit_outcomes_project_close_unique`, `deposit_outcomes_session_unique`, `deposit_outcomes_refund_payment_unique`; `project_sessions_tenant_project_id_unique`. Model `DepositOutcome` (`#modules/payments/models/deposit_outcome`) with `DEPOSIT_OUTCOMES = ["kept", "moved", "refunded"] as const` and `type DepositOutcomeKind`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/deposit_outcomes_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** A closed project with a refund and a session, in `tenant`. */
const seeded = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		const project = await makeProject(tenant, client, { status: "cancelled" });
		const other = await makeProject(tenant, client, { status: "cancelled" });
		const refund = await makePayment(tenant, project, {
			kind: "refund",
			amount: -100_000,
		});
		const otherRefund = await makePayment(tenant, other, {
			kind: "refund",
			amount: -100_000,
		});
		const session = await makeSession(tenant, project, await makeArtist(tenant));
		return { project, other, refund, otherRefund, session };
	});

const outcome = (
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	outcome: "kept",
	amount: 300_000,
	currency: "NPR",
	...over,
});

test.group("deposit_outcomes table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		// The seed runs more than once per tenant: a fresh project each time,
		// nothing with a fixed slug or time.
		await assertRowLevelSecurity(assert, "deposit_outcomes", async (tenant) => {
			const project = await inTenant(tenant, async () =>
				makeProject(tenant, await makeClient(tenant), { status: "cancelled" }),
			);
			return outcome(tenant.id, project.id);
		});
	});

	test("an outcome belongs to its own tenant's project, and so do its refund and session", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("outcome-a-66", "A");
		const { tenant: b } = await studioWithOwner("outcome-b-66", "B");
		const mine = await seeded(a);
		const theirs = await seeded(b);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_outcomes", values),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects(
				outcome(a.id, theirs.project.id),
				/deposit_outcomes_tenant_id_project_id_foreign/,
			);
			await rejects(
				outcome(a.id, mine.project.id, {
					outcome: "refunded",
					refund_payment_id: mine.otherRefund.id,
				}),
				/deposit_outcomes_refund_payment_foreign/,
			);
			await rejects(
				outcome(a.id, mine.other.id, { session_id: mine.session.id }),
				/deposit_outcomes_session_foreign/,
			);
		});
	});

	test("refunded goes with its refund, moved with a session, and the amount is positive", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("outcome-rules-66", "Rules");
		const { project, refund, session } = await seeded(tenant);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_outcomes", values),
					),
				message,
			);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await rejects(
				outcome(tenant.id, project.id, { outcome: "refunded" }),
				/deposit_outcomes_refund_matches/,
			);
			await rejects(
				outcome(tenant.id, project.id, { refund_payment_id: refund.id }),
				/deposit_outcomes_refund_matches/,
			);
			await rejects(
				outcome(tenant.id, project.id, { outcome: "moved" }),
				/deposit_outcomes_moved_needs_session/,
			);
			await rejects(
				outcome(tenant.id, project.id, { amount: 0 }),
				/deposit_outcomes_amount_positive/,
			);
			await rejects(
				outcome(tenant.id, project.id, { outcome: "lost" }),
				/deposit_outcomes_outcome_check/,
			);

			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, {
					outcome: "refunded",
					refund_payment_id: refund.id,
				}),
			);
			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, {
					outcome: "moved",
					session_id: session.id,
				}),
			);
		});
	});

	test("one outcome per project close, one per session, and a refund is used once", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("outcome-once-66", "Once");
		const { project, refund, session } = await seeded(tenant);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_outcomes", values),
					),
				message,
			);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, {
					outcome: "refunded",
					refund_payment_id: refund.id,
				}),
			);
			await rejects(
				outcome(tenant.id, project.id),
				/deposit_outcomes_project_close_unique/,
			);
			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, { session_id: session.id }),
			);
			await rejects(
				outcome(tenant.id, project.id, { session_id: session.id }),
				/deposit_outcomes_session_unique/,
			);
			await rejects(
				outcome(tenant.id, project.id, {
					outcome: "refunded",
					refund_payment_id: refund.id,
					session_id: session.id,
				}),
				/deposit_outcomes_(session|refund_payment)_unique/,
			);
		});
	});

	test("deleting the recorder's account keeps the outcome and clears who recorded it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("outcome-user-66", "User");
		const { project } = await seeded(tenant);
		const recorder = await User.create({
			email: "recorder-66@example.com",
			password: "secret-password",
		});
		const id = await withDbContext({ tenantId: tenant.id }, async (trx) =>
			idOf(
				await insertRow(
					trx,
					"deposit_outcomes",
					outcome(tenant.id, project.id, {
						recorded_by_user_id: recorder.id,
					}),
				),
			),
		);

		await recorder.delete();

		const rows = await sql(
			{ tenantId: tenant.id },
			"select recorded_by_user_id from deposit_outcomes where id = ?",
			[id],
		);
		assert.deepEqual(rows.rows, [{ recorded_by_user_id: null }]);
	});
});
```

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, in `EXPECTED_POLICIES`, add after `clients: ["tenant_isolation:ALL"],`:

```ts
	deposit_outcomes: ["tenant_isolation:ALL"],
```

(keep the keys in alphabetical order; TAT-65 added `deposit_links` next to it).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposit_outcomes_table.spec.ts --files=catalog_guard.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: `relation "deposit_outcomes" does not exist`, and the catalog guard's policy list differs.

- [ ] **Step 3: The migration and the model**

Create `apps/platform/database/migrations/1791660000001_create_deposit_outcomes_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * What happened to a deposit (TAT-66): the studio kept it, moved it to a new
 * date or refunded it, when a project closed holding deposit money (no
 * session) or, from TAT-85, when a session was missed or cancelled. The app
 * only records what the studio decided; its deposit policy is its own.
 * `amount` is the deposit money held when it was recorded; a refund is a
 * real `refund` payment of the same project, named here. One outcome per
 * project close and one per session. Not soft-deleted and append-only by
 * convention (PaymentService only inserts): the money itself is a guarded
 * payment.
 */
export default class extends BaseSchema {
	protected tableName = "deposit_outcomes";

	async up() {
		// The target of the session's composite key: a session of this project.
		this.schema.raw(
			"alter table project_sessions add constraint project_sessions_tenant_project_id_unique unique (tenant_id, project_id, id)",
		);
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.uuid("session_id").nullable();
			table.enum("outcome", ["kept", "moved", "refunded"]).notNullable();
			// Paisa: the deposit money held when the outcome was recorded.
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.uuid("refund_payment_id").nullable();
			table.string("note", 500).nullable();
			table
				.uuid("recorded_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "project_id"]);
			table.index(["recorded_by_user_id"]);
		});
		for (const statement of [
			"alter table deposit_outcomes add constraint deposit_outcomes_session_foreign foreign key (tenant_id, project_id, session_id) references project_sessions (tenant_id, project_id, id) on delete no action",
			"alter table deposit_outcomes add constraint deposit_outcomes_refund_payment_foreign foreign key (tenant_id, project_id, refund_payment_id) references payments (tenant_id, project_id, id) on delete no action",
			"alter table deposit_outcomes add constraint deposit_outcomes_amount_positive check (amount > 0)",
			"alter table deposit_outcomes add constraint deposit_outcomes_refund_matches check ((outcome = 'refunded') = (refund_payment_id is not null))",
			"alter table deposit_outcomes add constraint deposit_outcomes_moved_needs_session check (outcome <> 'moved' or session_id is not null)",
			"create unique index deposit_outcomes_project_close_unique on deposit_outcomes (tenant_id, project_id) where session_id is null",
			"create unique index deposit_outcomes_session_unique on deposit_outcomes (session_id) where session_id is not null",
			"create unique index deposit_outcomes_refund_payment_unique on deposit_outcomes (refund_payment_id)",
			...enableTenantRls(this.tableName),
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
		this.schema.raw(
			"alter table project_sessions drop constraint project_sessions_tenant_project_id_unique",
		);
	}
}
```

Run: `pnpm -C <repo>/apps/platform migrate`
Expected: the migration runs; `database/schema.ts` gains `DepositOutcomeSchema`.

Create `apps/platform/app/modules/payments/models/deposit_outcome.ts`:

```ts
import { DepositOutcomeSchema } from "#database/schema";

export const DEPOSIT_OUTCOMES = ["kept", "moved", "refunded"] as const;
export type DepositOutcomeKind = (typeof DEPOSIT_OUTCOMES)[number];

/**
 * What happened to a deposit (TAT-66): kept, moved to a new date (TAT-85:
 * with the missed or cancelled session) or refunded (with the refund
 * payment). `amount` is the deposit money held when it was recorded. One per
 * project close (`sessionId` null) and one per session. Append-only by
 * convention: PaymentService only inserts. Not soft-deleted.
 */
export default class DepositOutcome extends DepositOutcomeSchema {
	declare outcome: DepositOutcomeKind;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=deposit_outcomes_table.spec.ts --files=catalog_guard.spec.ts --files=project_sessions_table.spec.ts --files=policies.spec.ts`
Expected: PASS. (Knex names the enum's check `deposit_outcomes_outcome_check`; if your Postgres names it otherwise, use the real name in the test and note it.)

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/database apps/platform/app/modules/payments/models/deposit_outcome.ts apps/platform/tests/functional/payments/deposit_outcomes_table.spec.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> commit -m "feat(platform): add deposit outcomes, recorded once per project close or session

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 3: The ledger: deposit money, balance due and late decisions

**Files:**
- Create: `apps/platform/app/modules/payments/ledger.ts`
- Test: `apps/platform/tests/unit/modules/payments/ledger.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `Payment.correctsPaymentId`; `quoteTotal`, `formatMoney`, `QuoteAmounts` (`#modules/projects/quotes`).
- Produces (all pure, in `#modules/payments/ledger`):
  - `type LedgerPayment = Pick<Payment, "id" | "kind" | "amount" | "currency" | "status" | "correctsPaymentId" | "verifiedAt">`
  - `depositMoney(payments: readonly LedgerPayment[], currency: string): number`
  - `netPaid(payments: readonly LedgerPayment[], currency: string): bigint`
  - `type Balance = { currency: string; total: bigint | null; paid: bigint; due: bigint | null }`
  - `balanceOf(quote: (QuoteAmounts & Pick<Quote, "currency">) | null, payments: readonly LedgerPayment[]): Balance`
  - `decidedLate(payments: readonly LedgerPayment[], expiresAt: DateTime): boolean`
  - `formatSignedMoney(paisa: bigint | number): string`

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/payments/ledger.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	balanceOf,
	decidedLate,
	depositMoney,
	formatSignedMoney,
	type LedgerPayment,
	netPaid,
} from "#modules/payments/ledger";

let next = 0;
/** A verified NPR deposit of NPR 3,000 unless overridden. */
function pay(over: Partial<LedgerPayment> = {}): LedgerPayment {
	next += 1;
	return {
		id: `p${next}`,
		kind: "deposit",
		amount: 300_000,
		currency: "NPR",
		status: "verified",
		correctsPaymentId: null,
		verifiedAt: DateTime.utc(),
		...over,
	};
}

const fixed = (fixedPrice: number, currency = "NPR") => ({
	kind: "fixed" as const,
	fixedPrice,
	hourlyRate: null,
	estimatedMinutes: null,
	currency,
});
const hourly = (hourlyRate: number, estimatedMinutes: number) => ({
	kind: "hourly" as const,
	fixedPrice: null,
	hourlyRate,
	estimatedMinutes,
	currency: "NPR",
});

test.group("depositMoney", () => {
	test("sums verified deposits in the currency; waiting, rejected, other kinds and currencies don't count", ({
		assert,
	}) => {
		assert.equal(
			depositMoney(
				[
					pay(),
					pay({ amount: 100_000 }),
					pay({ status: "submitted" }),
					pay({ status: "rejected" }),
					pay({ kind: "session" }),
					pay({ kind: "balance" }),
					pay({ kind: "refund", amount: -50_000 }),
					pay({ currency: "USD" }),
				],
				"NPR",
			),
			400_000,
		);
	});

	test("a reversal of a deposit subtracts it", ({ assert }) => {
		const deposit = pay();
		assert.equal(
			depositMoney(
				[deposit, pay({ kind: "correction", amount: -300_000, correctsPaymentId: deposit.id })],
				"NPR",
			),
			0,
		);
	});

	test("a reversed refund is not deposit money (the latent TAT-36 bug)", ({
		assert,
	}) => {
		const deposit = pay();
		const refund = pay({ kind: "refund", amount: -300_000 });
		const reversal = pay({
			kind: "correction",
			amount: 300_000,
			correctsPaymentId: refund.id,
		});
		assert.equal(depositMoney([deposit, refund, reversal], "NPR"), 300_000);
	});

	test("a reversal of a session payment, or of a payment not in the list, doesn't count", ({
		assert,
	}) => {
		const session = pay({ kind: "session" });
		assert.equal(
			depositMoney(
				[
					session,
					pay({ kind: "correction", amount: -300_000, correctsPaymentId: session.id }),
					pay({ kind: "correction", amount: -300_000, correctsPaymentId: "elsewhere" }),
				],
				"NPR",
			),
			0,
		);
	});
});

test.group("netPaid", () => {
	test("every verified payment in the currency, signed", ({ assert }) => {
		const deposit = pay();
		assert.equal(
			netPaid(
				[
					deposit,
					pay({ kind: "session", amount: 500_000 }),
					pay({ kind: "refund", amount: -100_000 }),
					pay({ kind: "correction", amount: -300_000, correctsPaymentId: deposit.id }),
					pay({ status: "submitted" }),
					pay({ status: "rejected" }),
					pay({ currency: "USD" }),
				],
				"NPR",
			),
			400_000n,
		);
		assert.equal(netPaid([], "NPR"), 0n);
	});
});

test.group("balanceOf", () => {
	test("no quote: no total and no balance due; what was paid counts in NPR", ({
		assert,
	}) => {
		assert.deepEqual(balanceOf(null, [pay({ kind: "balance" })]), {
			currency: "NPR",
			total: null,
			paid: 300_000n,
			due: null,
		});
	});

	test("the total minus what was paid: due, paid in full and overpaid", ({
		assert,
	}) => {
		const quote = fixed(1_500_000);
		assert.equal(balanceOf(quote, []).due, 1_500_000n);
		assert.equal(balanceOf(quote, [pay()]).due, 1_200_000n);
		assert.equal(
			balanceOf(quote, [pay(), pay({ kind: "balance", amount: 1_200_000 })]).due,
			0n,
		);
		assert.equal(
			balanceOf(quote, [pay({ kind: "balance", amount: 1_550_000 })]).due,
			-50_000n,
		);
		assert.equal(
			balanceOf(quote, [pay(), pay({ kind: "refund", amount: -300_000 })]).due,
			1_500_000n,
			"a refund raises the balance due",
		);
	});

	test("payments in another currency than the quote's are left out", ({
		assert,
	}) => {
		const balance = balanceOf(fixed(10_000, "USD"), [pay()]);
		assert.equal(balance.currency, "USD");
		assert.equal(balance.paid, 0n);
		assert.equal(balance.due, 10_000n);
	});

	test("an hourly total is bigint past 2^53 and rounds half away from zero", ({
		assert,
	}) => {
		const max = 2_147_483_647;
		const huge = balanceOf(hourly(max, max), []);
		assert.equal(huge.total, (BigInt(max) * BigInt(max) * 2n + 60n) / 120n);
		assert.isAbove(Number(huge.total), Number.MAX_SAFE_INTEGER);
		// 90 paisa an hour for one minute is 1.5 paisa: 2. 30 for one minute
		// is 0.5: 1. 20 for one minute is 0.33: 0.
		assert.equal(balanceOf(hourly(90, 1), []).total, 2n);
		assert.equal(balanceOf(hourly(30, 1), []).total, 1n);
		assert.equal(balanceOf(hourly(20, 1), []).total, 0n);
	});
});

test.group("decidedLate", () => {
	const expiry = DateTime.utc().minus({ hours: 1 });
	const before = expiry.minus({ hours: 1 });
	const after = expiry.plus({ minutes: 30 });

	test("a waiting screenshot is a decision still owed", ({ assert }) => {
		assert.isTrue(
			decidedLate([pay({ status: "submitted", verifiedAt: null })], expiry),
		);
		assert.isFalse(decidedLate([], expiry));
	});

	test("a rejection at or after the expiry is late; one before it isn't", ({
		assert,
	}) => {
		assert.isTrue(
			decidedLate([pay({ status: "rejected", verifiedAt: after })], expiry),
		);
		assert.isTrue(
			decidedLate([pay({ status: "rejected", verifiedAt: expiry })], expiry),
		);
		assert.isFalse(
			decidedLate([pay({ status: "rejected", verifiedAt: before })], expiry),
		);
	});

	test("reversing a deposit at or after the expiry is late; reversing a refund isn't", ({
		assert,
	}) => {
		const deposit = pay({ verifiedAt: before });
		const refund = pay({ kind: "refund", amount: -300_000, verifiedAt: before });
		const reverse = (target: LedgerPayment, at: DateTime) =>
			pay({
				kind: "correction",
				amount: -target.amount,
				correctsPaymentId: target.id,
				verifiedAt: at,
			});

		assert.isTrue(decidedLate([deposit, reverse(deposit, after)], expiry));
		assert.isFalse(decidedLate([deposit, reverse(deposit, before)], expiry));
		assert.isFalse(decidedLate([refund, reverse(refund, after)], expiry));
	});

	test("a verification after the expiry is not a late decision (the deposit is paid)", ({
		assert,
	}) => {
		assert.isFalse(decidedLate([pay({ verifiedAt: after })], expiry));
	});
});

test.group("formatSignedMoney", () => {
	test("money going back gets a minus sign", ({ assert }) => {
		assert.equal(formatSignedMoney(300_000), "NPR 3,000");
		assert.equal(formatSignedMoney(-300_000n), "−NPR 3,000");
		assert.equal(formatSignedMoney(-150), "−NPR 1.50");
		assert.equal(formatSignedMoney(0), "NPR 0");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=ledger.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 with "Cannot find module" for `#modules/payments/ledger`.

- [ ] **Step 3: The ledger**

Create `apps/platform/app/modules/payments/ledger.ts`:

```ts
import type { DateTime } from "luxon";
import type Payment from "#modules/payments/models/payment";
import type Quote from "#modules/projects/models/quote";
import {
	formatMoney,
	type QuoteAmounts,
	quoteTotal,
} from "#modules/projects/quotes";

/**
 * The money maths of a project's payments (TAT-66), pure so it can be
 * tested without a database. Amounts are signed int4 paisa and a project has
 * a handful of payments, so sums of amounts are exact in numbers; totals and
 * balances are bigint because an hourly total can pass 2^53.
 */
export type LedgerPayment = Pick<
	Payment,
	| "id"
	| "kind"
	| "amount"
	| "currency"
	| "status"
	| "correctsPaymentId"
	| "verifiedAt"
>;

/**
 * The deposit money in `currency`: the verified deposits plus the verified
 * corrections whose corrected payment is one of those deposits. A reversal
 * of a refund or a session payment is not deposit money, so a deposit, a
 * mistaken refund and the refund's reversal count the deposit once.
 */
export function depositMoney(
	payments: readonly LedgerPayment[],
	currency: string,
): number {
	const counted = payments.filter(
		(payment) => payment.status === "verified" && payment.currency === currency,
	);
	const deposits = new Set(
		counted.filter(({ kind }) => kind === "deposit").map(({ id }) => id),
	);
	return counted.reduce((sum, payment) => {
		const reversesDeposit =
			payment.kind === "correction" &&
			payment.correctsPaymentId !== null &&
			deposits.has(payment.correctsPaymentId);
		return payment.kind === "deposit" || reversesDeposit
			? sum + payment.amount
			: sum;
	}, 0);
}

/**
 * What the project holds in `currency`: every verified payment, signed
 * (refunds and reversals subtract). Waiting and rejected payments don't
 * count.
 */
export function netPaid(
	payments: readonly LedgerPayment[],
	currency: string,
): bigint {
	return payments
		.filter(
			(payment) =>
				payment.status === "verified" && payment.currency === currency,
		)
		.reduce((sum, { amount }) => sum + BigInt(amount), 0n);
}

/** A project's money: its total (null without a price), what it holds and the balance due. */
export type Balance = {
	currency: string;
	total: bigint | null;
	paid: bigint;
	due: bigint | null;
};

/**
 * The balance due: the current quote's total (`quoteTotal`: the fixed price,
 * or the rate for the estimated minutes, rounded half away from zero) minus
 * netPaid in the quote's currency. Negative when overpaid. Without a quote
 * there is no total and nothing due, and what was paid counts in NPR.
 * Computed on every read, never stored.
 */
export function balanceOf(
	quote: (QuoteAmounts & Pick<Quote, "currency">) | null,
	payments: readonly LedgerPayment[],
): Balance {
	const currency = quote?.currency ?? "NPR";
	const paid = netPaid(payments, currency);
	if (!quote) return { currency, total: null, paid, due: null };
	const total = quoteTotal(quote);
	return { currency, total, paid, due: total - paid };
}

/**
 * Whether the studio's decision on the deposit came late for a quote that
 * expires at `expiresAt`: a deposit screenshot still waits for it, or it
 * rejected a deposit screenshot or reversed a deposit at or after the
 * expiry. ProjectService.expireQuote then spares the project, so whether
 * the sweep cancels it never depends on how late the owner decided
 * (TAT-66). A rejection or reversal before the expiry is not late: the
 * client had time to pay.
 */
export function decidedLate(
	payments: readonly LedgerPayment[],
	expiresAt: DateTime,
): boolean {
	const at = expiresAt.toMillis();
	const deposits = new Set(
		payments.filter(({ kind }) => kind === "deposit").map(({ id }) => id),
	);
	const decidedAfter = (payment: LedgerPayment) =>
		payment.verifiedAt !== null && payment.verifiedAt.toMillis() >= at;
	return payments.some(
		(payment) =>
			(payment.kind === "deposit" && payment.status === "submitted") ||
			(payment.kind === "deposit" &&
				payment.status === "rejected" &&
				decidedAfter(payment)) ||
			(payment.kind === "correction" &&
				payment.status === "verified" &&
				payment.correctsPaymentId !== null &&
				deposits.has(payment.correctsPaymentId) &&
				decidedAfter(payment)),
	);
}

/**
 * Money for people with its sign: "NPR 3,000", or "−NPR 3,000" (U+2212)
 * for money going back. formatMoney itself takes amounts of zero or more.
 */
export function formatSignedMoney(paisa: bigint | number): string {
	const value = BigInt(paisa);
	return value < 0n ? `−${formatMoney(-value)}` : formatMoney(value);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=ledger.spec.ts --files=quotes.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/ledger.ts apps/platform/tests/unit/modules/payments/ledger.spec.ts
git -C <repo> commit -m "feat(platform): add the payments ledger: deposit money, balance due, late decisions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `DepositService` counts only corrections of deposits, and knows a late decision

**Files:**
- Modify: `apps/platform/app/modules/payments/services/deposit_service.ts` (TAT-65 grew this file; keep its additions)
- Test: `apps/platform/tests/functional/payments/deposit_service.spec.ts` (append)

**Interfaces:**
- Consumes: Task 3's `depositMoney`, `decidedLate`.
- Produces: `DepositService.verifiedPaid(tenant, project, currency): Promise<number>` (same signature, fixed counting); `DepositService.expirySpared(tenant: Pick<Tenant, "id">, project: Pick<TattooProject, "id">, quote: Pick<Quote, "expiresAt">): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/payments/deposit_service.spec.ts` (add `makeClient`/`makeProject` are already imported; nothing new to import):

```ts
test.group("DepositService: corrections count only for deposits (TAT-66)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the refund-and-reversal case does not settle a bigger deposit", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			// The quote asks NPR 6,000; the client paid NPR 3,000. A refund was
			// recorded by mistake and then reversed: the studio holds NPR 3,000.
			await makeQuote(tenant, project, { depositAmount: 600_000 });
			await makePayment(tenant, project, verified());
			const refund = await makePayment(tenant, project, {
				kind: "refund",
				amount: -300_000,
				...verified(),
			});
			await makePayment(tenant, project, {
				kind: "correction",
				amount: 300_000,
				correctsPaymentId: refund.id,
				...verified(),
			});

			assert.equal(await deposits.verifiedPaid(tenant, project, "NPR"), 300_000);
			assert.isFalse(await deposits.isSettled(tenant, project));
		});
	});

	test("reversing a session payment doesn't touch the deposit", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, verified());
			const session = await makePayment(tenant, project, {
				kind: "session",
				...verified(),
			});
			await makePayment(tenant, project, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: session.id,
				...verified(),
			});

			assert.isTrue(await deposits.isSettled(tenant, project));
		});
	});
});

test.group("DepositService.expirySpared", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a waiting screenshot, a late rejection or a late reversal spares; nothing else does", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const expiresAt = DateTime.utc().minus({ hours: 1 });
		const spared = (project: { id: string }) =>
			inTenant(tenant, () =>
				deposits.expirySpared(tenant, project, { expiresAt }),
			);

		const waiting = await projectIn(tenant);
		const lateNo = await projectIn(tenant);
		const earlyNo = await projectIn(tenant);
		const reversedLate = await projectIn(tenant);
		const plain = await projectIn(tenant);
		await inTenant(tenant, async () => {
			await makePayment(tenant, waiting);
			await makePayment(tenant, lateNo, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
			await makePayment(tenant, earlyNo, {
				status: "rejected",
				verifiedAt: expiresAt.minus({ hours: 1 }),
			});
			const deposit = await makePayment(tenant, reversedLate, {
				status: "verified",
				verifiedAt: expiresAt.minus({ hours: 2 }),
			});
			await makePayment(tenant, reversedLate, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: deposit.id,
				...verified(),
			});
			await makePayment(tenant, plain, { kind: "session", ...verified() });
		});

		assert.isTrue(await spared(waiting), "a screenshot waits");
		assert.isTrue(await spared(lateNo), "rejected after the expiry");
		assert.isFalse(await spared(earlyNo), "rejected before the expiry");
		assert.isTrue(await spared(reversedLate), "reversed after the expiry");
		assert.isFalse(await spared(plain), "nothing about the deposit");
	});

	test("another studio's context sees none of it", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("spared-a-66", "A");
		const { tenant: b } = await studioWithOwner("spared-b-66", "B");
		const project = await projectIn(a);
		await inTenant(a, () => makePayment(a, project));

		assert.isFalse(
			await inTenant(b, () =>
				deposits.expirySpared(a, project, { expiresAt: DateTime.utc() }),
			),
		);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposit_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: "the refund-and-reversal case" (`verifiedPaid` is 600,000 and `isSettled` true), "reversing a session payment" (the session reversal is counted against the deposit), and `deposits.expirySpared is not a function`.

- [ ] **Step 3: The service**

In `apps/platform/app/modules/payments/services/deposit_service.ts`:

- Add the import `import { decidedLate, depositMoney } from "#modules/payments/ledger";` (keep Biome's order). `Quote` is already imported as a type (TAT-65); if not, add `import type Quote from "#modules/projects/models/quote";`.
- Replace the `COUNTED_KINDS` comment with:

```ts
/**
 * The payment kinds deposit money is made of: deposits, and the corrections
 * that reverse one (depositMoney decides which corrections those are).
 */
```

- Replace the body of `verifiedPaid` (and its comment's middle sentence) so it reads:

```ts
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
```

- After `verifiedPaid`, add:

```ts
	/**
	 * Whether `quote`'s expiry must spare the project because the studio's
	 * decision on its deposit is still owed or came late: a deposit
	 * screenshot waits, or a deposit screenshot was rejected or a deposit
	 * reversed at or after the expiry (decidedLate). ProjectService's expiry
	 * rule asks it first (TAT-66).
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
```

- In the class comment, add the sentence: "TAT-66 owns it from here: corrections count only when they reverse a deposit, and `expirySpared` tells the expiry rule when a decision on the deposit came late."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=deposit_service.spec.ts --files=deposit_reads.spec.ts --files=session_service.spec.ts --files=project_service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/services/deposit_service.ts apps/platform/tests/functional/payments/deposit_service.spec.ts
git -C <repo> commit -m "fix(platform): count only reversals of deposits as deposit money

A verified deposit, a mistaken refund and the refund's reversal counted
the deposit twice, so a project could book underfunded.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A late decision on the deposit spares the project from expiry

**Files:**
- Modify: `apps/platform/app/modules/projects/services/project_service.ts` (`expiryCancels`, `expireQuote`'s comment)
- Test: `apps/platform/tests/functional/projects/project_service.spec.ts` (the `ProjectService.expireQuote` group), `apps/platform/tests/functional/projects/sweep_expired_quotes_job.spec.ts` (append)

**Interfaces:**
- Consumes: Task 4's `DepositService.expirySpared`.
- Produces: `expireQuote` returns false (and changes nothing) for a project whose deposit decision is owed or came late.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/projects/project_service.spec.ts`, inside `test.group("ProjectService.expireQuote", …)`, after "still cancels a quoted project with a zero deposit that nobody accepted", add:

```ts
	test("spares a project while a deposit screenshot waits, on every run", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			await makePayment(tenant, project);

			assert.isFalse(await projects.expireQuote(tenant, project.id, quote.id));
			assert.isFalse(await projects.expireQuote(tenant, project.id, quote.id));
			assert.equal(await statusOf(project), "deposit_pending");
		});
	});

	test("spares it once the studio rejects the screenshot after the expiry; an earlier rejection still cancels", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const late = await expiredQuote(tenant, "deposit_pending");
			await makePayment(tenant, late.project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
			const early = await expiredQuote(tenant, "deposit_pending");
			await makePayment(tenant, early.project, {
				status: "rejected",
				verifiedAt: early.quote.expiresAt.minus({ hours: 1 }),
			});

			assert.isFalse(
				await projects.expireQuote(tenant, late.project.id, late.quote.id),
			);
			assert.equal(await statusOf(late.project), "deposit_pending");
			assert.isTrue(
				await projects.expireQuote(tenant, early.project.id, early.quote.id),
			);
			assert.equal(await statusOf(early.project), "cancelled");
		});
	});

	test("a deposit reversed after the expiry spares a deposit_pending or quoted project; one reversed before doesn't", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const reverse = async (
				project: TattooProject,
				at: DateTime,
			) => {
				const deposit = await makePayment(tenant, project, {
					status: "verified",
					verifiedAt: at.minus({ hours: 1 }),
				});
				await makePayment(tenant, project, {
					kind: "correction",
					amount: -300_000,
					correctsPaymentId: deposit.id,
					status: "verified",
					verifiedAt: at,
				});
			};
			const pending = await expiredQuote(tenant, "deposit_pending");
			await reverse(pending.project, DateTime.utc());
			const revised = await expiredQuote(tenant, "quoted");
			await reverse(revised.project, DateTime.utc());
			const early = await expiredQuote(tenant, "deposit_pending");
			await reverse(early.project, early.quote.expiresAt.minus({ minutes: 5 }));

			for (const { project, quote } of [pending, revised]) {
				assert.isFalse(await projects.expireQuote(tenant, project.id, quote.id));
				assert.notEqual(await statusOf(project), "cancelled");
			}
			assert.isTrue(
				await projects.expireQuote(tenant, early.project.id, early.quote.id),
			);
		});
	});

	test("after a late decision, a revision's own expiry cancels as usual", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project } = await expiredQuote(tenant, "deposit_pending");
			// Rejected 50 minutes ago: after v1 expired (an hour ago), before
			// v2 expired (10 minutes ago).
			await makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc().minus({ minutes: 50 }),
			});
			const v2 = await makeQuote(tenant, project, {
				version: 2,
				expiresAt: DateTime.utc().minus({ minutes: 10 }),
			});

			assert.isTrue(await projects.expireQuote(tenant, project.id, v2.id));
			assert.equal(await statusOf(project), "cancelled");
		});
	});
```

(The `expiredQuote` helper's quote expired an hour ago; v1's expiry is before the rejection 50 minutes ago, v2's 10 minutes ago is after it.)

In `apps/platform/tests/functional/projects/sweep_expired_quotes_job.spec.ts`, inside the `SweepExpiredQuotesJob` group, after "through the worker, cancels both tenants' missed expiries and spares a paid deposit", add:

```ts
	test("through the worker, spares a waiting screenshot and a deposit reversed after the expiry", async ({
		assert,
	}) => {
		const a = await studioWithOwner("sweep-late-66", "Late");
		const waiting = await projectWithQuote(a.tenant, "deposit_pending");
		const reversed = await projectWithQuote(a.tenant, "deposit_pending");
		const unpaid = await projectWithQuote(a.tenant, "deposit_pending");
		await inTenant(a.tenant, async () => {
			await makePayment(a.tenant, waiting.project);
			const deposit = await makePayment(a.tenant, reversed.project, {
				status: "verified",
				verifiedAt: DateTime.utc().minus({ hours: 2 }),
			});
			await makePayment(a.tenant, reversed.project, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: deposit.id,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
		});

		const fake = queue.fake();
		await runSweep();
		const mine = fake
			.getPushedJobs()
			.map(({ job }) => job)
			.filter(({ name }) => name === ExpireQuoteJob.name)
			.map(({ payload }) => payload as ExpirePayload)
			.filter(({ tenantId }) => tenantId === a.tenant.id);
		queue.restore();
		assert.sameDeepMembers(mine, [
			payloadOf(a.tenant, waiting),
			payloadOf(a.tenant, reversed),
			payloadOf(a.tenant, unpaid),
		]);

		for (const payload of mine) {
			await dispatchInTransaction(ExpireQuoteJob.dispatch(payload), trx());
		}
		await processQueued();

		assert.equal(await statusIn(a.tenant, waiting.project), "deposit_pending");
		assert.equal(await statusIn(a.tenant, reversed.project), "deposit_pending");
		assert.equal(await statusIn(a.tenant, unpaid.project), "cancelled");
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=project_service.spec.ts --files=sweep_expired_quotes_job.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL in the four new expireQuote tests (the project is cancelled) and in the sweep test (`waiting` and `reversed` are cancelled).

- [ ] **Step 3: The rule**

In `apps/platform/app/modules/projects/services/project_service.ts`, add above the class (after `PROJECTS_PER_PAGE`):

```ts
/** The statuses a quote's expiry can cancel. */
const EXPIRING_STATUSES: readonly ProjectStatus[] = [
	"quoted",
	"on_hold",
	"deposit_pending",
];
```

Replace `expiryCancels` (its comment and body) with:

```ts
	/**
	 * Whether the expired `quote` cancels a project in its current status.
	 * Only `quoted`, `on_hold` and `deposit_pending` projects can be
	 * cancelled, and none whose deposit decision is owed or came late
	 * (DepositService.expirySpared: a screenshot waits, or the studio rejected
	 * one or reversed a deposit after the expiry; TAT-66): the owner decides
	 * what happens next. A `quoted` or `on_hold` project is then cancelled
	 * unless its (non-zero) deposit was paid: it can hold a payment when staff
	 * revised the quote after the client paid. A zero deposit is "settled" by
	 * definition, so it doesn't spare a quote nobody accepted.
	 */
	private async expiryCancels(
		tenant: TenantRef,
		project: TattooProject,
		quote: Quote,
	): Promise<boolean> {
		if (!EXPIRING_STATUSES.includes(project.status)) return false;
		if (await this.deposits.expirySpared(tenant, project, quote)) return false;
		if (project.status === "deposit_pending") {
			return !(await this.deposits.isSettled(tenant, project));
		}
		return (
			quote.depositAmount === 0 ||
			!(await this.deposits.isSettled(tenant, project))
		);
	}
```

In `expireQuote`'s comment, after "A deposit that was paid is never cancelled by expiry, not even on a `quoted` project that was revised after the client paid.", add: "Nor is a project whose deposit screenshot waits, or whose screenshot the studio rejected or deposit it reversed after the expiry (TAT-66): the owner who decided late chooses what happens next, so a later sweep run changes nothing."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=project_service.spec.ts --files=sweep_expired_quotes_job.spec.ts --files=expire_quote_job.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/projects/services/project_service.ts apps/platform/tests/functional/projects
git -C <repo> commit -m "feat(platform): spare a project from expiry while its deposit decision is owed or late

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Withdrawing a project that holds a deposit, and from booked or in progress

**Files:**
- Modify: `apps/platform/app/modules/projects/moves.ts`, `apps/platform/app/modules/projects/errors.ts`, `apps/platform/app/modules/projects/services/project_service.ts` (`move`, `depositHeld`'s comment), `apps/platform/app/controllers/project_changes_controller.ts`, `apps/platform/app/controllers/projects_controller.ts` (**edits TAT-65 code**: the controller has TAT-65's `deposits`), `apps/platform/inertia/components/projects.ts`, `apps/platform/inertia/pages/projects/show.tsx`
- Test: `apps/platform/tests/functional/projects/project_service.spec.ts`, `apps/platform/tests/functional/projects/project_changes.spec.ts`, `apps/platform/tests/functional/projects/project_page.spec.ts`

**Interfaces:**
- Produces: `MANUAL_MOVES.withdraw.from` = `["reviewing", "quoted", "on_hold", "deposit_pending", "booked", "in_progress"]`; `PROJECT_RULE_REASONS = ["move_not_allowed"]`; the project page prop `depositHeldText: string | null` (the deposit money held, `formatMoney`, or null) replacing `withdrawBlocked`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/projects/project_service.spec.ts`:

- In `EXPECTED_FROM`, change `withdraw` to `["reviewing", "quoted", "on_hold", "deposit_pending", "booked", "in_progress"]`.
- Replace the test "a withdrawal is refused while any verified deposit money is held" with:

```ts
	test("a withdrawal closes a project that holds deposit money, booked and in progress ones too", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const status of [
				"deposit_pending",
				"quoted",
				"on_hold",
				"booked",
				"in_progress",
			] as const) {
				const project = await makeProject(tenant, client, { status });
				await makeQuote(tenant, project);
				await makePayment(tenant, project, {
					status: "verified",
					verifiedAt: DateTime.utc(),
				});
				assert.equal(
					await projects.move(tenant, OWNER, project, "withdraw"),
					"cancelled",
					status,
				);
				assert.isTrue(await projects.depositHeld(tenant, project), status);
			}
		});
	});
```

In `apps/platform/tests/functional/projects/project_changes.spec.ts`, after "a client withdrawing cancels the project and its sessions", add:

```ts
	test("withdrawing a project that holds a deposit asks for its outcome", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const booked = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
			});
			await makeQuote(tenant, booked);
			await makePayment(tenant, booked, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return booked;
		});

		const response = await client
			.post(`/t/black-needle/projects/${project.id}/moves`)
			.form({ move: "withdraw" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"Client withdrew: project cancelled. Record what happened to the deposit under Payments.",
		);
		await inTenant(tenant, () => project.refresh());
		assert.equal(project.status, "cancelled");
	});
```

(Add `makePayment` and `makeQuote` to that file's `#tests/helpers/pipeline` import.)

In `apps/platform/tests/functional/projects/project_page.spec.ts`, replace "withdrawing is hidden and flagged while deposit money is held" with:

```ts
	test("withdrawing stays offered, and the page names the deposit it holds", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const paid = await withLiveQuote(tenant, "deposit_pending");
		await inTenant(tenant, () =>
			makePayment(tenant, paid, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			}),
		);
		const unpaid = await withLiveQuote(tenant, "deposit_pending");

		const heldProps = (
			await client.get(page(paid.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(heldProps.moves, ["withdraw"]);
		assert.equal(heldProps.depositHeldText, "NPR 3,000");
		assert.notProperty(heldProps, "withdrawBlocked");

		const freeProps = (
			await client.get(page(unpaid.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(freeProps.moves, ["withdraw"]);
		assert.isNull(freeProps.depositHeldText);
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=project_service.spec.ts --files=project_changes.spec.ts --files=project_page.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: withdrawing from booked and in_progress is `move_not_allowed`, a held deposit is `deposit_paid`, the flash and `depositHeldText` are missing.

- [ ] **Step 3: The rule, the controllers and the page**

In `apps/platform/app/modules/projects/moves.ts`, replace the `MANUAL_MOVES` comment's last two sentences ("Withdrawing after booking, or while the project holds deposit money, waits for TAT-66, which records what happens to the deposit (ProjectService.move refuses it as `deposit_paid`).") with "A client can withdraw until the work is done (up to `in_progress`); when the project holds deposit money, the owner then records whether the studio keeps it or refunds it (TAT-66, the Payments card)." and change the `withdraw` entry's `from` to `["reviewing", "quoted", "on_hold", "deposit_pending", "booked", "in_progress"]`.

In `apps/platform/app/modules/projects/errors.ts`, change `PROJECT_RULE_REASONS` to `["move_not_allowed"] as const` and remove the `deposit_paid` entry from `PROJECT_MESSAGES`.

In `apps/platform/app/modules/projects/services/project_service.ts`:
- In `move`, delete the two lines

```ts
			if (move === "withdraw" && (await this.depositHeld(tenant, live))) {
				throw new ProjectRuleError("deposit_paid");
			}
```

and in its comment replace "A client withdrawing is refused as "deposit_paid" while the project holds verified deposit money: closing it would hide the client's money, and recording what happens to it (kept, moved, refunded) is TAT-66's." with "A client may withdraw while the project holds deposit money: the owner then records the deposit's outcome (PaymentService.recordOutcome, TAT-66)."
- In `depositHeld`'s comment, replace "The projects page uses it to hide the withdraw move; `move` enforces it." with "The withdraw flash asks for the deposit's outcome when it is true."

In `apps/platform/app/controllers/project_changes_controller.ts`:
- Remove the `deposit_paid` entry from `RULE_MESSAGES`.
- In `move`, replace `ctx.session.flash("success", MOVE_DONE[move]);` with:

```ts
			const outcomeNext =
				move === "withdraw" &&
				(await this.projects.depositHeld(tenant, project));
			ctx.session.flash(
				"success",
				outcomeNext
					? `${MOVE_DONE[move]} Record what happened to the deposit under Payments.`
					: MOVE_DONE[move],
			);
```

In `apps/platform/app/controllers/projects_controller.ts` (`show`):
- Replace `const depositHeld = await this.projects.depositHeld(tenant, project);` with (after `const current = versions.at(0) ?? null;`, so move it below that line):

```ts
		const held = current
			? await this.deposits.verifiedPaid(tenant, project, current.currency)
			: 0;
```

- Replace the `moves: …` and `withdrawBlocked: …` entries (and their comment) with:

```ts
			moves: allowedMoves(project.status),
			// The withdraw confirm names the deposit the project holds (TAT-66).
			depositHeldText: held > 0 ? formatMoney(held) : null,
```

In `apps/platform/inertia/components/projects.ts`, in `ProjectPageProps`, replace

```ts
	/** Withdrawing would be allowed, but the project holds deposit money. */
	withdrawBlocked: boolean;
```

with

```ts
	/** The deposit money the project holds ("NPR 3,000"), for the withdraw confirm; null when none. */
	depositHeldText: string | null;
```

In `apps/platform/inertia/pages/projects/show.tsx`:
- In `ProjectShow`'s destructured props, replace `withdrawBlocked,` with `depositHeldText,`.
- Delete the `{withdrawBlocked && ( <p …> … </p> )}` block.
- Pass the text to the buttons: `<MoveButtons projectId={project.id} moves={moves} scheduledSessionCount={scheduledSessionCount} depositHeldText={depositHeldText} />`.
- Replace the `CONFIRM` constant with:

```tsx
/** Moves that close a project ask first. */
const CONFIRM: Partial<
	Record<ManualMoveName, (sessions: number, deposit: string | null) => string>
> = {
	decline: (sessions) =>
		sessions > 0
			? `Decline this project? It moves to Closed and cancels ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
			: "Decline this project? It moves to Closed.",
	withdraw: (sessions, deposit) => {
		const base =
			sessions > 0
				? `Mark that the client withdrew? This cancels the project and ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
				: "Mark that the client withdrew? This cancels the project.";
		return deposit
			? `${base} The client's deposit of ${deposit} stays recorded: you then record whether the studio keeps it or refunds it.`
			: base;
	},
};
```

- In `MoveButtons`, add the prop `depositHeldText: string | null` (destructure it and add it to the props type) and change `const question = CONFIRM[move]?.(scheduledSessionCount);` to `const question = CONFIRM[move]?.(scheduledSessionCount, depositHeldText);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=project_service.spec.ts --files=project_changes.spec.ts --files=project_page.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors (server and `inertia/`; `rg -n 'withdrawBlocked|deposit_paid' <repo>/apps/platform` finds nothing).

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/inertia apps/platform/tests/functional/projects
git -C <repo> commit -m "feat(platform): let a client withdraw while a deposit is held, or after booking

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The price of a direct booking made without one

**Files:**
- Modify: `apps/platform/app/modules/projects/errors.ts`, `apps/platform/app/modules/projects/services/project_service.ts`, `apps/platform/app/modules/projects/validators/quote.ts`, `apps/platform/app/controllers/quotes_controller.ts`, `apps/platform/app/controllers/projects_controller.ts`, `apps/platform/start/routes.ts`, `apps/platform/inertia/components/projects.ts`, `apps/platform/inertia/pages/projects/show.tsx`, `apps/platform/tests/helpers/tenants.ts`, `apps/platform/tests/isolation/cases.ts`
- Regenerate: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/projects/project_service.spec.ts`, `apps/platform/tests/functional/projects/quotes_http.spec.ts`, `apps/platform/tests/functional/projects/project_page.spec.ts`

**Interfaces:**
- Produces: `QuoteRuleReason` `"price_locked"`; `ProjectService.setPrice(tenant: Pick<Tenant, "id" | "timezone">, member: Member, project: TattooProject, fixedPrice: number): Promise<Quote>` (paisa); `priceValidator` (`{ fixedPrice }` in rupees); route `POST /t/:tenant/projects/:id/price` named `tenant.projects.price.store` (`QuotesController.price`); page prop `canSetPrice: boolean`; fixture `pricelessProject` on `Studio`; `IsolationCase.resource` gains `"pricelessProject"`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/projects/project_service.spec.ts`, add a group after `ProjectService.acceptQuote`:

```ts
test.group("ProjectService.setPrice", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a booked project without a quote gets version 1: fixed, no deposit, status unchanged, no job", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const jobsBefore = await queuedJobs();

		await inTenant(tenant, async () => {
			for (const status of ["booked", "in_progress", "completed", "healing_check"] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				const quote = await projects.setPrice(tenant, OWNER, project, 800_000);
				assert.deepEqual(
					[quote.version, quote.kind, quote.fixedPrice, quote.depositAmount],
					[1, "fixed", 800_000, 0],
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
		assert.equal(await queuedJobs(), jobsBefore, "no ExpireQuoteJob");
	});

	test("a project that has a quote, or isn't booked yet, is refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const priced = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, priced);
			const early = await makeProject(tenant, client, { status: "quoted" });
			const closed = await makeProject(tenant, client, { status: "cancelled" });

			for (const project of [priced, early, closed]) {
				assert.equal(
					await reasonOf(() => projects.setPrice(tenant, OWNER, project, 800_000)),
					"price_locked",
					project.status,
				);
			}
			assert.lengthOf(await quotes.history(tenant, priced), 1);
		});
	});

	test("the assigned artist may set it; another artist gets a 404", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ravi = await artistIn(tenant, "ravi@example.com");

		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: profile.id,
			});

			await assert.rejects(
				() =>
					projects.setPrice(tenant, { userId: ravi.id, role: "artist" }, project, 800_000),
				/Row not found/,
			);
			const quote = await projects.setPrice(
				tenant,
				{ userId: asha.id, role: "artist" },
				project,
				800_000,
			);
			assert.equal(quote.version, 1);
		});
	});
});
```

(`makeProject` accepts `artistId` through its overrides.)

In `apps/platform/tests/functional/projects/quotes_http.spec.ts`, append:

```ts
test.group("Setting a direct booking's price", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const priceUrl = (id: string) => `/t/black-needle/projects/${id}/price`;

	test("an owner sets it once; the second time is refused", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "booked");
		const post = (fixedPrice: string) =>
			client
				.post(priceUrl(project.id))
				.form({ fixedPrice })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const first = await post("8000");
		first.assertHeader("location", pageUrl(project.id));
		first.assertFlashMessage("success", "Price set.");
		const second = await post("9000");
		second.assertFlashMessage(
			"error",
			"This project already has a price, or isn't booked yet.",
		);
		const all = await versions(tenant, project);
		assert.deepEqual(
			all.map(({ fixedPrice }) => fixedPrice),
			[800_000],
		);
	});

	test("a price outside 1 to 1,00,00,000 whole rupees is a field error", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "booked");

		for (const fixedPrice of ["0", "12.5", "100000001", ""]) {
			const response = await client
				.post(priceUrl(project.id))
				.form({ fixedPrice })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(
				response,
				"fixedPrice",
				"Enter whole rupees from 1 to 1,00,00,000.",
			);
		}
	});
});
```

In `apps/platform/tests/functional/projects/project_page.spec.ts`, in "a project with no quote, and a booked one that can't be re-quoted", add at the end (adapt the variable names to that test's: it renders a project with no quote and a booked one):

```ts
		// A booked project with no quote can get its price once (TAT-66).
		const priceless = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "booked" }),
		);
		const pricelessProps = (
			await client.get(page(priceless.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isTrue(pricelessProps.canSetPrice);
```

and assert `canSetPrice` is false on that test's other two projects (`assert.isFalse(<props>.canSetPrice)` next to its `canQuote` assertions).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=project_service.spec.ts --files=quotes_http.spec.ts --files=project_page.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL (`projects.setPrice is not a function` at type check, the POST is a 404, `canSetPrice` undefined).

- [ ] **Step 3: The rule and the service**

In `apps/platform/app/modules/projects/errors.ts`, add `"price_locked",` to `QUOTE_RULE_REASONS` and to `MESSAGES`:

```ts
	price_locked:
		"Only a booked project without a quote can get its price this way",
```

In `apps/platform/app/modules/projects/services/project_service.ts`:
- Add `BOOKED_STATUSES`, `expiresAtFor` and `todayIn` to the import from `#modules/projects/quotes` (keep `isExpired`, `QUOTABLE_STATUSES`).
- After `acceptQuote`, add:

```ts
	/**
	 * Records the price of a project booked without one (TAT-43's direct
	 * booking): quote version 1, fixed, no deposit, valid through today in
	 * the studio's timezone. Only for a booked-or-later project with no quote
	 * (QuoteRuleError "price_locked" otherwise, checked under the lock), so
	 * quotes stay locked once a project is booked: the price is set once. No
	 * status change and no ExpireQuoteJob (expiry never acts from booked on).
	 * Owners and the assigned artist, as for quotes.
	 */
	async setPrice(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
		project: TattooProject,
		fixedPrice: number,
	): Promise<Quote> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			if (
				!BOOKED_STATUSES.includes(live.status) ||
				(await this.quotes.current(tenant, live))
			) {
				throw new QuoteRuleError("price_locked");
			}
			return this.quotes.create(trx, tenant, live, {
				kind: "fixed",
				fixedPrice,
				depositAmount: 0,
				expiresAt: expiresAtFor(todayIn(tenant.timezone), tenant.timezone),
			});
		});
	}
```

In `apps/platform/app/modules/projects/validators/quote.ts`, append:

```ts
/** A direct booking's price, set once after booking (TAT-66): whole rupees. */
export const priceValidator = vine.create({
	fixedPrice: vine.number().withoutDecimals().range([1, 10_000_000]),
});
priceValidator.messagesProvider = new SimpleMessagesProvider({
	"fixedPrice.required": PRICE,
	"fixedPrice.number": PRICE,
	"fixedPrice.withoutDecimals": PRICE,
	"fixedPrice.range": PRICE,
});
```

- [ ] **Step 4: The route, the controller and the page**

In `apps/platform/app/controllers/quotes_controller.ts`:
- Add `priceValidator` to the import from `#modules/projects/validators/quote`.
- Add to `RULE_MESSAGES`: `price_locked: "This project already has a price, or isn't booked yet.",`
- After `accept`, add:

```ts
	async price(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { fixedPrice } = await ctx.request.validateUsing(priceValidator);

		await flashRuleErrors(ctx, async () => {
			await this.projects.setPrice(
				tenant,
				membership,
				project,
				fixedPrice * 100,
			);
			ctx.session.flash("success", "Price set.");
		});
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}
```

In `apps/platform/start/routes.ts`, inside the `/projects` group, after the `tenant.projects.quotes.accept` route, add:

```ts
				// A direct booking's price, once (TAT-66).
				router
					.post(":id/price", [controllers.Quotes, "price"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.price.store");
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains the route `tenant.projects.price.store`.

In `apps/platform/app/controllers/projects_controller.ts` (`show`), after the `canAccept` entry add:

```ts
			// A booking made without a price can get one once (TAT-66).
			canSetPrice: BOOKED_STATUSES.includes(project.status) && current === null,
```

In `apps/platform/inertia/components/projects.ts`, in `ProjectPageProps` after `canAccept: boolean;`, add:

```ts
	/** Booked without a price: the Quote card offers "Set price" once. */
	canSetPrice: boolean;
```

In `apps/platform/inertia/pages/projects/show.tsx`:
- Add `canSetPrice,` to the destructured props.
- In the Quote card, replace `<p className="text-sm text-muted-foreground">No quote yet.</p>` with:

```tsx
							canSetPrice ? (
								<PriceForm projectId={project.id} />
							) : (
								<p className="text-sm text-muted-foreground">No quote yet.</p>
							)
```

(the surrounding ternary becomes `quote ? (<QuoteSummary …/>) : canSetPrice ? (…) : (…)`).
- After `AcceptQuote`, add:

```tsx
/**
 * The price of a project booked without one (TAT-66): set once, behind a
 * confirm, because quotes are locked from booked on.
 */
function PriceForm({ projectId }: { projectId: string }) {
	const tenant = useTenant();
	const [price, setPrice] = useState("");

	return (
		<Form
			route="tenant.projects.price.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onBefore={() =>
				window.confirm(
					`Set the price to ${formatRupees(Number(price))}? It can't be changed afterwards.`,
				)
			}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<p className="text-sm text-muted-foreground">
						No price was set at booking. Set it once you know it: it can&apos;t
						be changed afterwards.
					</p>
					<Field data-invalid={!!errors.fixedPrice}>
						<FieldLabel htmlFor="finalPrice">Price (NPR)</FieldLabel>
						<Input
							id="finalPrice"
							name="fixedPrice"
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={price}
							onChange={(event) => setPrice(event.target.value)}
							aria-invalid={!!errors.fixedPrice}
							aria-describedby={errors.fixedPrice ? "finalPrice-error" : undefined}
						/>
						{errors.fixedPrice && (
							<FieldError id="finalPrice-error">{errors.fixedPrice}</FieldError>
						)}
					</Field>
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Set price"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}
```

(Inertia's `<Form>` cancels the visit when `onBefore` returns false. If the Adonis wrapper doesn't pass `onBefore` through in this version, wrap the button's `onClick` in the same confirm and call `event.preventDefault()` when it is declined.)

- [ ] **Step 5: The isolation fixture and case**

In `apps/platform/tests/helpers/tenants.ts`, in `studio()`, after the `newInquiry` block, add:

```ts
	// A project booked directly with no price, for the price route (TAT-66).
	const pricelessProject = await inTenant(tenant, () =>
		makeProject(tenant, pipeline.client, { status: "booked" }),
	);
```

and in the returned object, after `quotedQuote: quoted.quote,`: `pricelessProject,`.

In `apps/platform/tests/isolation/cases.ts`, add `| "pricelessProject"` to `IsolationCase.resource`, and after the case for `/t/:tenant/projects/:id/quotes/accept` add:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/price",
		resource: "pricelessProject",
		actor: "owner",
		body: () => ({ fixedPrice: "8000" }),
		ownStatus: 302,
		snapshot: projectRows,
	},
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=project_service.spec.ts --files=quotes_http.spec.ts --files=project_page.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/inertia apps/platform/tests
git -C <repo> commit -m "feat(platform): let a direct booking without a price get one, once

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Signed image URLs check the tenant and are never cached

**Files:**
- Modify: `apps/platform/app/modules/media/services/image_service.ts`, every caller from the precondition's list (at least `apps/platform/app/controllers/projects_controller.ts`, `clients_controller.ts`, `inquiries_controller.ts`, `payment_methods_controller.ts`, `artists_controller.ts`, and TAT-65's deposit page code that signs `payment_qr`), `apps/platform/app/modules/inquiries/models/reference_image.ts` (its comment)
- Test: `apps/platform/tests/functional/media/image_service.spec.ts`

**Interfaces:**
- Produces: `ImageService.url(purpose: ImagePurpose, key: string, tenant: Pick<Tenant, "id">): Promise<string>` (throws `Error` for a key outside `tenants/<tenant id>/<purpose>/` or containing `..`); `PRIVATE_CACHE_CONTROL = "private, no-store"` (exported from `#modules/media/services/image_service`); private URLs carry it as the signed `cacheControl`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/media/image_service.spec.ts`:
- Change the two existing calls to `images.url("payment_qr", stored.key, tenant)` and `images.url("payment_proof", stored.key, tenant)`.
- In "a private image is served only through its signed URL", after `(await client.get(pathOf(url))).assertStatus(200);` replace that line with:

```ts
		const served = await client.get(pathOf(url));
		served.assertStatus(200);
		// Proofs and references are never kept by a browser or a proxy.
		served.assertHeader("cache-control", "private, no-store");
```

- Append, inside the same group:

```ts
	test("url refuses a key of another tenant or another purpose", async ({
		assert,
	}) => {
		const stored = await images.store(await upload(await testImages.jpeg()), {
			tenant,
			purpose: "payment_proof",
		});
		const other = { id: "0199c0de-0000-7000-8000-000000000002" };

		await assert.rejects(
			() => images.url("payment_proof", stored.key, other),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() => images.url("reference_image", stored.key, tenant),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() =>
				images.url(
					"payment_proof",
					`tenants/${tenant.id}/payment_proof/../reference_image/x.webp`,
					tenant,
				),
			/another tenant or purpose/,
		);
	});

	test("the Cache-Control is part of the signature: dropping it is a 401", async ({
		client,
	}) => {
		const stored = await images.store(await upload(await testImages.jpeg()), {
			tenant,
			purpose: "payment_proof",
		});
		const url = new URL(await images.url("payment_proof", stored.key, tenant));
		url.searchParams.delete("cacheControl");

		(await client.get(`${url.pathname}${url.search}`)).assertStatus(401);
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=image_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: no `cache-control: private, no-store` on the served proof, the refusals don't throw, and dropping a parameter that isn't there leaves a valid URL (200).

- [ ] **Step 3: The service and its callers**

In `apps/platform/app/modules/media/services/image_service.ts`:
- Add `import type Tenant from "#modules/tenancy/models/tenant";` if the file doesn't import it yet.
- After `const SIGNED_URL_TTL = "5 minutes";`, add:

```ts
/**
 * What a browser or proxy may do with a private image: show it, never keep
 * it. Signed into the URL (the drive's /files route sends it as
 * Cache-Control), so it can't be stripped.
 */
export const PRIVATE_CACHE_CONTROL = "private, no-store";
```

- Replace `url` (comment and body) with:

```ts
	/**
	 * The URL to show an image. Private purposes get a signed URL valid for
	 * 5 minutes that answers with `Cache-Control: private, no-store`. Load
	 * the owning record scoped to the tenant first: that load is the access
	 * check. As defence in depth the key must be one this tenant stored for
	 * this purpose (`tenants/<id>/<purpose>/`), else this throws: a caller
	 * bug, never a user error. Signed URLs are bearer tokens: keep them out of
	 * emails, jobs and logs.
	 */
	async url(
		purpose: ImagePurpose,
		key: string,
		tenant: Pick<Tenant, "id">,
	): Promise<string> {
		if (!key.startsWith(`tenants/${tenant.id}/${purpose}/`) || key.includes("..")) {
			throw new Error(
				`url() was given a key of another tenant or purpose (${purpose})`,
			);
		}
		const disk = diskFor(purpose);
		return IMAGE_PURPOSES[purpose].visibility === "private"
			? disk.getSignedUrl(key, {
					expiresIn: SIGNED_URL_TTL,
					cacheControl: PRIVATE_CACHE_CONTROL,
				})
			: disk.getUrl(key);
	}
```

- In every caller from the precondition's list, pass the tenant the controller already has as the third argument, e.g. in `projects_controller.ts`: `url: await this.images.url("reference_image", image.imageKey, tenant),`; in `payment_methods_controller.ts`: `await this.images.url("payment_qr", method.qrImageKey, tenant)`; the same in `clients_controller.ts`, `inquiries_controller.ts`, `artists_controller.ts` and TAT-65's deposit page code (the public tenant of the request).
- In `apps/platform/app/modules/inquiries/models/reference_image.ts`, change the comment's `ImageService.url("reference_image", key)` to `ImageService.url("reference_image", key, tenant)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=image_service.spec.ts --files=file_serving.spec.ts --files=project_page.spec.ts --files=clients_pages.spec.ts --files=inbox.spec.ts --files=payments_page.spec.ts --files=artists_page.spec.ts`
Expected: PASS. Then run the TAT-65 public deposit page specs (`rg -l 'payment_qr' <repo>/apps/platform/tests/functional` lists them) the same way.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors (the compiler finds any caller you missed).

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/tests/functional/media/image_service.spec.ts
git -C <repo> commit -m "feat(platform): check the tenant before signing an image URL, and never cache private ones

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `PaymentService`: the project's money, and verifying or rejecting a screenshot

**Files:**
- Create: `apps/platform/app/modules/payments/services/payment_service.ts`, `apps/platform/tests/helpers/payments.ts`
- Modify: `apps/platform/app/modules/payments/errors.ts` (append), `apps/platform/app/modules/payments/models/payment.ts` (`DESK_KINDS`)
- Test: `apps/platform/tests/functional/payments/payment_decisions.spec.ts` (create)

**Interfaces:**
- Consumes: Task 3's `balanceOf`, `depositMoney`, `Balance`; Task 2's `DepositOutcome`; TAT-65's `ProjectService.lockLive`, `depositServices`, `depositReady`, `DepositService.countPendingProofs`; `SessionService.settleBooking`, `QuoteService.current`, `isExpired`.
- Produces:
  - `PAYMENT_RULE_REASONS`, `type PaymentRuleReason`, `class PaymentRuleError { reason; limit: number | null }` in `#modules/payments/errors`.
  - `DESK_KINDS = ["deposit", "session", "balance"] as const`, `type DeskKind` in `#modules/payments/models/payment`.
  - In `#modules/payments/services/payment_service`: `CLOSED_FOR_OUTCOME`, `type ProjectMoney = { quote: Quote | null; payments: Payment[]; balance: Balance; depositHeld: number; depositDue: number; outcome: DepositOutcome | null; outcomeNeeded: boolean }`, `type Recorded = { payment: Payment; booked: boolean; status: ProjectStatus; depositDue: number }`, `type Rejected = { payment: Payment; asksAgain: boolean }`, and `PaymentService` (constructor `(projects: ProjectService, quotes: QuoteService, sessions: SessionService)`) with `findFor(tenant, member, id): Promise<Payment>`, `forProject(tenant, project: Pick<TattooProject, "id" | "status">): Promise<ProjectMoney>`, `verify(tenant, member, payment, note: string | null): Promise<Recorded>`, `reject(tenant, member, payment, note: string | null): Promise<Rejected>`.
  - In `#tests/helpers/payments`: `paymentServices(images?)` (`depositServices()`'s services plus `sessions` and `payments`), `ownerMember(user): Member`, `proofFor(tenant, project, over?)` (a submitted NPR 3,000 eSewa deposit with a proof key, inside `inTenant`).

- [ ] **Step 1: Write the test helper**

Create `apps/platform/tests/helpers/payments.ts`:

```ts
import { randomUUID } from "node:crypto";
import ImageService from "#modules/media/services/image_service";
import PaymentService from "#modules/payments/services/payment_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import SessionService from "#modules/scheduling/services/session_service";
import { depositServices } from "#tests/helpers/deposits";
import { makePayment } from "#tests/helpers/pipeline";

/** depositServices() plus the session and payment services (TAT-66). */
export function paymentServices(images: ImageService = new ImageService()) {
	const base = depositServices(images);
	const sessions = new SessionService(base.artists, base.deposits);
	const payments = new PaymentService(base.projects, base.quotes, sessions);
	return { ...base, sessions, payments };
}

/** The member a studio's owner acts as. */
export const ownerMember = (owner: { id: string }) => ({
	userId: owner.id,
	role: "owner" as const,
});

/**
 * A deposit screenshot waiting for the studio: a submitted NPR 3,000
 * (300,000 paisa) eSewa deposit with a proof key in `tenant`'s
 * payment_proof folder (no file behind it). Call it inside
 * `inTenant(tenant, …)`.
 */
export function proofFor(
	tenant: { id: string },
	project: TattooProject,
	over: Parameters<typeof makePayment>[2] = {},
) {
	return makePayment(tenant, project, {
		method: "esewa",
		proofImageKey: `tenants/${tenant.id}/payment_proof/${randomUUID()}.webp`,
		proofImageWidth: 600,
		proofImageHeight: 800,
		...over,
	});
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/platform/tests/functional/payments/payment_decisions.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import Payment from "#modules/payments/models/payment";
import TattooProject from "#modules/projects/models/tattoo_project";
import { depositReady } from "#tests/helpers/deposits";
import { ownerMember, paymentServices, proofFor } from "#tests/helpers/payments";
import {
	makeArtist,
	makePayment,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments, deposits } = paymentServices();

/** The PaymentRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof PaymentRuleError) return error.reason;
		throw error;
	}
}

/**
 * A studio whose deposit_pending project (deposit NPR 3,000) has its
 * client's screenshot waiting.
 */
async function waiting(
	slug: string,
	quote: Parameters<typeof depositReady>[1] = {},
) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const { project } = await inTenant(tenant, () => depositReady(tenant, quote));
	const proof = await inTenant(tenant, () => proofFor(tenant, project));
	return { owner, tenant, member: ownerMember(owner), project, proof };
}

const fresh = <T extends Payment | TattooProject>(
	tenant: { id: string },
	model: T,
) =>
	inTenant(tenant, async () => {
		await model.refresh();
		return model;
	});

test.group("PaymentService.forProject", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the current quote, the payments newest first, the balance and what is left of the deposit", async ({
		assert,
	}) => {
		const { tenant, project, proof } = await waiting("money-66");
		const desk = await inTenant(tenant, async () => {
			await makeQuote(tenant, project, { version: 2, depositAmount: 500_000 });
			return makePayment(tenant, project, {
				amount: 200_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
		});

		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);

		assert.equal(money.quote?.version, 2);
		assert.deepEqual(
			money.payments.map(({ id }) => id),
			[desk.id, proof.id],
		);
		assert.deepEqual(money.balance, {
			currency: "NPR",
			total: 1_500_000n,
			paid: 200_000n,
			due: 1_300_000n,
		});
		assert.equal(money.depositHeld, 200_000);
		assert.equal(money.depositDue, 300_000);
		assert.isNull(money.outcome);
		assert.isFalse(money.outcomeNeeded);
	});
});

test.group("PaymentService.verify and reject", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("verifying records who decided, when, and the note; a blank note is none", async ({
		assert,
	}) => {
		const one = await waiting("verify-66");
		const two = await waiting("verify-blank-66");

		await inTenant(one.tenant, () =>
			payments.verify(one.tenant, one.member, one.proof, "  On the statement  "),
		);
		await inTenant(two.tenant, () =>
			payments.verify(two.tenant, two.member, two.proof, "   "),
		);

		const decided = await fresh(one.tenant, one.proof);
		assert.equal(decided.status, "verified");
		assert.equal(decided.verifiedByUserId, one.owner.id);
		assert.isBelow(
			Math.abs(decided.verifiedAt?.diffNow().as("seconds") ?? 99),
			30,
		);
		assert.equal(decided.note, "On the statement");
		assert.isNull((await fresh(two.tenant, two.proof)).note);
	});

	test("verifying a deposit books a project with a scheduled tattoo session", async ({
		assert,
	}) => {
		const { tenant, member, project, proof } = await waiting("verify-book-66");
		await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const result = await inTenant(tenant, () =>
			payments.verify(tenant, member, proof, null),
		);

		assert.isTrue(result.booked);
		assert.equal(result.status, "booked");
		assert.equal(result.depositDue, 0);
		assert.equal((await fresh(tenant, project)).status, "booked");
	});

	test("without a session the project waits; a partial deposit leaves the rest due", async ({
		assert,
	}) => {
		const covered = await waiting("verify-wait-66");
		const partial = await waiting("verify-part-66", { depositAmount: 500_000 });

		const done = await inTenant(covered.tenant, () =>
			payments.verify(covered.tenant, covered.member, covered.proof, null),
		);
		const part = await inTenant(partial.tenant, () =>
			payments.verify(partial.tenant, partial.member, partial.proof, null),
		);

		assert.deepEqual(
			[done.booked, done.status, done.depositDue],
			[false, "deposit_pending", 0],
		);
		assert.deepEqual(
			[part.booked, part.status, part.depositDue],
			[false, "deposit_pending", 200_000],
		);
	});

	test("rejecting keeps the proof and asks the client again, unless the quote expired", async ({
		assert,
	}) => {
		const live = await waiting("reject-66");
		const expired = await waiting("reject-late-66", {
			expiresAt: DateTime.utc().minus({ hours: 1 }),
		});
		const key = live.proof.proofImageKey;

		const asked = await inTenant(live.tenant, () =>
			payments.reject(live.tenant, live.member, live.proof, "Not on the statement"),
		);
		const late = await inTenant(expired.tenant, () =>
			payments.reject(expired.tenant, expired.member, expired.proof, null),
		);

		assert.isTrue(asked.asksAgain);
		assert.isFalse(late.asksAgain);
		const rejected = await fresh(live.tenant, live.proof);
		assert.deepEqual(
			[rejected.status, rejected.verifiedByUserId, rejected.note, rejected.proofImageKey],
			["rejected", live.owner.id, "Not on the statement", key],
		);
		assert.equal((await fresh(live.tenant, live.project)).status, "deposit_pending");
	});

	test("a second decision is refused under the lock, and the first stands", async ({
		assert,
	}) => {
		const { tenant, member, owner, proof } = await waiting("twice-66");
		// Two tabs loaded the same waiting screenshot; the first one verifies.
		const stale = await inTenant(tenant, () => Payment.findOrFail(proof.id));
		await inTenant(tenant, () => payments.verify(tenant, member, proof, null));

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => payments.verify(tenant, member, stale, null)),
			),
			"already_decided",
		);
		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => payments.reject(tenant, member, stale, "Late")),
			),
			"already_decided",
		);
		const kept = await fresh(tenant, proof);
		assert.deepEqual(
			[kept.status, kept.verifiedByUserId, kept.note],
			["verified", owner.id, null],
		);
	});

	test("the Projects badge drops as screenshots are decided", async ({
		assert,
	}) => {
		const { tenant, member, project, proof } = await waiting("badge-66");
		const second = await inTenant(tenant, () => proofFor(tenant, project));
		const count = () =>
			inTenant(tenant, () => deposits.countPendingProofs(tenant));

		assert.equal(await count(), 2);
		await inTenant(tenant, () => payments.verify(tenant, member, proof, null));
		assert.equal(await count(), 1);
		await inTenant(tenant, () => payments.reject(tenant, member, second, null));
		assert.equal(await count(), 0);
	});

	test("only owners decide, and only the studio's own payments are found", async ({
		assert,
	}) => {
		const { tenant, project, proof } = await waiting("owners-66");
		const other = await waiting("owners-other-66");
		const asha = await artistIn(tenant, "asha@owners-66.example");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			project.artistId = profile.id;
			await project.save();
		});
		const artist = { userId: asha.id, role: "artist" as const };

		for (const work of [
			() => payments.verify(tenant, artist, proof, null),
			() => payments.reject(tenant, artist, proof, null),
			() => payments.findFor(tenant, artist, proof.id),
			// Another studio's payment under this studio, and from its context.
			() => payments.findFor(tenant, ownerMember(other.owner), other.proof.id),
		]) {
			await assert.rejects(() => inTenant(tenant, work), /Row not found/);
		}
		await assert.rejects(
			() =>
				inTenant(other.tenant, () =>
					payments.findFor(tenant, ownerMember(other.owner), proof.id),
				),
			/Row not found/,
		);
		assert.equal((await fresh(tenant, proof)).status, "submitted");
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=payment_decisions.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 with "Cannot find module" for `#modules/payments/services/payment_service`.

- [ ] **Step 4: The error, the kinds and the service**

Append to `apps/platform/app/modules/payments/errors.ts`:

```ts
export const PAYMENT_RULE_REASONS = [
	"already_decided",
	"not_reversible",
	"already_reversed",
	"deposit_not_pending",
	"project_declined",
	"refund_too_large",
	"outcome_first",
	"no_outcome_needed",
] as const;
export type PaymentRuleReason = (typeof PAYMENT_RULE_REASONS)[number];

const PAYMENT_MESSAGES: Record<PaymentRuleReason, string> = {
	already_decided: "The payment is no longer submitted: it was verified or rejected",
	not_reversible: "Only a verified payment that is not a correction can be reversed",
	already_reversed: "The payment already has a correction",
	deposit_not_pending:
		"A deposit can be recorded only while the project is deposit_pending",
	project_declined: "A declined project takes no payments",
	refund_too_large: "The refund is more than the project holds",
	outcome_first: "The closed project's deposit outcome must be recorded first",
	no_outcome_needed:
		"The project is not closed, holds no deposit money, or already has its outcome",
};

/**
 * A payment rule was broken (TAT-66); `reason` says which. For
 * `refund_too_large`, `limit` is the most that may be refunded, in paisa.
 * Thrown after the failed savepoint has rolled back. The message is for
 * developers; show your own to the user.
 */
export class PaymentRuleError extends Error {
	constructor(
		readonly reason: PaymentRuleReason,
		readonly limit: number | null = null,
	) {
		super(PAYMENT_MESSAGES[reason]);
		this.name = "PaymentRuleError";
	}
}
```

In `apps/platform/app/modules/payments/models/payment.ts`, after `PAYMENT_STATUSES`'s type, add:

```ts
/** What staff record at the desk (TAT-66); refunds and reversals have their own forms. */
export const DESK_KINDS = ["deposit", "session", "balance"] as const;
export type DeskKind = (typeof DESK_KINDS)[number];
```

Create `apps/platform/app/modules/payments/services/payment_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import {
	type Balance,
	balanceOf,
	depositMoney,
} from "#modules/payments/ledger";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment from "#modules/payments/models/payment";
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
	/** What is left to pay of the current quote's deposit, in paisa: 0 when covered or none. */
	depositDue: number;
	/** The outcome recorded when the project closed, or null. */
	outcome: DepositOutcome | null;
	/** Closed (CLOSED_FOR_OUTCOME), holding deposit money, and no outcome yet. */
	outcomeNeeded: boolean;
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
			depositDue: quote ? Math.max(0, quote.depositAmount - depositHeld) : 0,
			outcome,
			outcomeNeeded:
				CLOSED_FOR_OUTCOME.includes(project.status) &&
				depositHeld > 0 &&
				outcome === null,
		};
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=payment_decisions.spec.ts --files=deposit_reads.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments apps/platform/tests/helpers/payments.ts apps/platform/tests/functional/payments/payment_decisions.spec.ts
git -C <repo> commit -m "feat(platform): let owners verify or reject a payment screenshot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `PaymentService`: desk payments, refunds and reversals

**Files:**
- Modify: `apps/platform/app/modules/payments/services/payment_service.ts`
- Test: `apps/platform/tests/functional/payments/payment_entries.spec.ts` (create)

**Interfaces:**
- Consumes: Task 9's `PaymentService`, `Recorded`, `PaymentRuleError`, `DESK_KINDS`; `PaymentMethodKind`.
- Produces: `type DeskPayment = { kind: DeskKind; method: PaymentMethodKind; amount: number; note: string | null }` (paisa > 0), `type RefundInput = { method: PaymentMethodKind; amount: number; note: string | null }` (paisa > 0), `type Reversal = { correction: Payment; reversed: Payment; depositDue: number }`; `record(tenant, member, project: TattooProject, input: DeskPayment): Promise<Recorded>`, `refund(tenant, member, project: TattooProject, input: RefundInput): Promise<Payment>`, `reverse(tenant, member, payment: Payment, note: string | null): Promise<Reversal>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/payment_entries.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import Payment from "#modules/payments/models/payment";
import TattooProject, {
	PROJECT_STATUSES,
} from "#modules/projects/models/tattoo_project";
import { ownerMember, paymentServices } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments } = paymentServices();

async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof PaymentRuleError) return error.reason;
		throw error;
	}
}

/** A studio, its owner as a member, and a project in `status` with the default quote. */
async function setUp(slug: string, status: TattooProject["status"]) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const project = await inTenant(tenant, async () => {
		const made = await makeProject(tenant, await makeClient(tenant), { status });
		await makeQuote(tenant, made);
		return made;
	});
	return { owner, tenant, member: ownerMember(owner), project };
}

/** A verified NPR 3,000 deposit on `project`. */
const paid = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () =>
		makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
		}),
	);

const cash = (kind: "deposit" | "session" | "balance", amount = 300_000) => ({
	kind,
	method: "cash" as const,
	amount,
	note: null,
});

test.group("PaymentService.record", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a desk payment is verified at once by the owner, in the quote's currency, with its note", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await setUp("desk-66", "booked");

		const { payment } = await inTenant(tenant, () =>
			payments.record(tenant, member, project, {
				kind: "balance",
				method: "fonepay",
				amount: 1_200_050,
				note: " Rest of the price ",
			}),
		);

		assert.deepEqual(
			[
				payment.kind,
				payment.amount,
				payment.currency,
				payment.method,
				payment.status,
				payment.verifiedByUserId,
				payment.note,
				payment.proofImageKey,
			],
			["balance", 1_200_050, "NPR", "fonepay", "verified", owner.id, "Rest of the price", null],
		);
		assert.isNotNull(payment.verifiedAt);
	});

	test("a desk deposit books a deposit_pending project with a scheduled tattoo session", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("desk-book-66", "deposit_pending");
		await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const result = await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("deposit")),
		);

		assert.isTrue(result.booked);
		assert.equal(result.status, "booked");
	});

	test("a deposit only while the project waits for it; session and balance in any status but declined", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("desk-status-66", "Black Needle");
		const member = ownerMember(owner);

		for (const status of PROJECT_STATUSES) {
			const project = await inTenant(tenant, async () => {
				const made = await makeProject(tenant, await makeClient(tenant), { status });
				await makeQuote(tenant, made);
				return made;
			});
			const record = (kind: "deposit" | "session" | "balance") =>
				reasonOf(() =>
					inTenant(tenant, () => payments.record(tenant, member, project, cash(kind))),
				);

			assert.equal(
				await record("deposit"),
				status === "deposit_pending" ? null : "deposit_not_pending",
				`deposit in ${status}`,
			);
			for (const kind of ["session", "balance"] as const) {
				assert.equal(
					await record(kind),
					status === "declined" ? "project_declined" : null,
					`${kind} in ${status}`,
				);
			}
		}
	});

	test("without a quote a desk payment is in NPR, and overpaying is allowed", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("desk-over-66", "booked");
		const direct = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "booked" }),
		);

		const { payment } = await inTenant(tenant, () =>
			payments.record(tenant, member, direct, cash("balance", 800_000)),
		);
		assert.equal(payment.currency, "NPR");

		// The quote's total is NPR 15,000: NPR 20,000 at the desk is taken.
		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("balance", 2_000_000)),
		);
		const money = await inTenant(tenant, () => payments.forProject(tenant, project));
		assert.equal(money.balance.due, -500_000n);
	});
});
```

Append, in the same file:

```ts
test.group("PaymentService.refund", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a refund is a negative verified payment, up to what the project holds", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await setUp("refund-66", "booked");
		await paid(tenant, project);

		const refund = await inTenant(tenant, () =>
			payments.refund(tenant, member, project, {
				method: "cash",
				amount: 100_000,
				note: "Goodwill",
			}),
		);
		assert.deepEqual(
			[refund.kind, refund.amount, refund.status, refund.verifiedByUserId, refund.note],
			["refund", -100_000, "verified", owner.id, "Goodwill"],
		);

		try {
			await inTenant(tenant, () =>
				payments.refund(tenant, member, project, {
					method: "cash",
					amount: 250_000,
					note: null,
				}),
			);
			assert.fail("a refund above what is held must be refused");
		} catch (error) {
			assert.instanceOf(error, PaymentRuleError);
			assert.equal((error as PaymentRuleError).reason, "refund_too_large");
			assert.equal((error as PaymentRuleError).limit, 200_000);
		}
	});

	test("a closed project waiting for its deposit outcome refuses a plain refund", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("refund-closed-66", "cancelled");
		await paid(tenant, project);

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () =>
					payments.refund(tenant, member, project, {
						method: "cash",
						amount: 100_000,
						note: null,
					}),
				),
			),
			"outcome_first",
		);
	});
});

test.group("PaymentService.reverse", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a reversal is a verified correction of minus the amount, naming the payment, in its currency and method", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await setUp("reverse-66", "booked");
		const { payment: entry } = await inTenant(tenant, () =>
			payments.record(tenant, member, project, {
				kind: "balance",
				method: "esewa",
				amount: 450_000,
				note: null,
			}),
		);

		const { correction, reversed } = await inTenant(tenant, () =>
			payments.reverse(tenant, member, entry, "Typed the wrong amount"),
		);

		assert.equal(reversed.id, entry.id);
		assert.deepEqual(
			[
				correction.kind,
				correction.amount,
				correction.currency,
				correction.method,
				correction.correctsPaymentId,
				correction.status,
				correction.verifiedByUserId,
				correction.note,
			],
			["correction", -450_000, "NPR", "esewa", entry.id, "verified", owner.id, "Typed the wrong amount"],
		);
	});

	test("reversing a deposit un-covers it but never moves the project", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("reverse-dep-66", "booked");
		const deposit = await paid(tenant, project);

		const { depositDue } = await inTenant(tenant, () =>
			payments.reverse(tenant, member, deposit, null),
		);

		assert.equal(depositDue, 300_000);
		await inTenant(tenant, () => project.refresh());
		assert.equal(project.status, "booked");
	});

	test("reversing a refund gives its money back to what the project holds", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("reverse-ref-66", "booked");
		await paid(tenant, project);
		const refund = await inTenant(tenant, () =>
			payments.refund(tenant, member, project, { method: "cash", amount: 300_000, note: null }),
		);
		await inTenant(tenant, () => payments.reverse(tenant, member, refund, null));

		const money = await inTenant(tenant, () => payments.forProject(tenant, project));
		assert.equal(money.balance.paid, 300_000n);
		assert.equal(money.depositHeld, 300_000);
	});

	test("only a verified payment that isn't a reversal, and only once", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("reverse-rules-66", "booked");
		const deposit = await paid(tenant, project);
		const [waiting, rejected] = await inTenant(tenant, async () => [
			await makePayment(tenant, project),
			await makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			}),
		]);
		const reverse = (payment: Payment) =>
			reasonOf(() => inTenant(tenant, () => payments.reverse(tenant, member, payment, null)));

		assert.equal(await reverse(waiting), "not_reversible");
		assert.equal(await reverse(rejected), "not_reversible");
		assert.isNull(await reverse(deposit));
		assert.equal(await reverse(deposit), "already_reversed");
		const correction = await inTenant(tenant, () =>
			Payment.query().where("corrects_payment_id", deposit.id).firstOrFail(),
		);
		assert.equal(await reverse(correction), "not_reversible");
	});

	test("an artist can't record, refund or reverse", async ({ assert }) => {
		const { tenant, project } = await setUp("entries-artist-66", "booked");
		const deposit = await paid(tenant, project);
		const asha = await artistIn(tenant, "asha@entries-66.example");
		const artist = { userId: asha.id, role: "artist" as const };

		for (const work of [
			() => payments.record(tenant, artist, project, cash("balance")),
			() => payments.refund(tenant, artist, project, { method: "cash", amount: 1, note: null }),
			() => payments.reverse(tenant, artist, deposit, null),
		]) {
			await assert.rejects(() => inTenant(tenant, work), /Row not found/);
		}
	});
});
```

The unique index on `corrects_payment_id` (Task 1's test) is the backstop when two reversals pass the existence check together; one connection can't reproduce that race, so the service maps the violation without a test of its own.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=payment_entries.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL at the type check or with `payments.record is not a function`.

- [ ] **Step 3: The writes**

In `apps/platform/app/modules/payments/services/payment_service.ts`:
- Add the imports `import type { DeskKind } from "#modules/payments/models/payment";` (merge with the existing `Payment` import: `import Payment, { type DeskKind } from "#modules/payments/models/payment";`), `import type { PaymentMethodKind } from "#modules/payments/models/payment_method";` and `import { isUniqueViolation } from "#services/db_errors";`.
- After the `Rejected` type, add:

```ts
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
```

- After `reject`, add:

```ts
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
			return Payment.create(
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
				correction = await withTransaction((inner) =>
					Payment.create(
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
					),
				);
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
```

- At the end of the file, add:

```ts
/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=payment_entries.spec.ts --files=payment_decisions.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/services/payment_service.ts apps/platform/tests/functional/payments/payment_entries.spec.ts
git -C <repo> commit -m "feat(platform): record desk payments, refunds and reversals

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `PaymentService.recordOutcome`: what happened to a closed project's deposit

**Files:**
- Modify: `apps/platform/app/modules/payments/services/payment_service.ts`
- Test: `apps/platform/tests/functional/payments/deposit_outcome_service.spec.ts` (create)

**Interfaces:**
- Consumes: Task 9's `forProject` (`outcomeNeeded`, `depositHeld`), Task 2's `DepositOutcome`.
- Produces: `type OutcomeInput = { outcome: "kept"; note: string | null } | { outcome: "refunded"; amount: number; method: PaymentMethodKind; note: string | null }`; `recordOutcome(tenant, member, project: TattooProject, input: OutcomeInput): Promise<DepositOutcome>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/deposit_outcome_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { ownerMember, paymentServices } from "#tests/helpers/payments";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments } = paymentServices();

async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof PaymentRuleError) return error.reason;
		throw error;
	}
}

/** A project in `status` with the default quote and, unless `held` is 0, a verified deposit of `held` paisa. */
async function closed(slug: string, status: TattooProject["status"] = "cancelled", held = 300_000) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const project = await inTenant(tenant, async () => {
		const made = await makeProject(tenant, await makeClient(tenant), { status });
		await makeQuote(tenant, made);
		if (held > 0) {
			await makePayment(tenant, made, {
				amount: held,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
		}
		return made;
	});
	return { owner, tenant, member: ownerMember(owner), project };
}

test.group("PaymentService.recordOutcome", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("kept records the deposit money held, and nothing more is needed", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await closed("kept-66");

		const outcome = await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "kept",
				note: "No-show policy",
			}),
		);

		assert.deepEqual(
			[
				outcome.outcome,
				outcome.amount,
				outcome.currency,
				outcome.refundPaymentId,
				outcome.sessionId,
				outcome.recordedByUserId,
				outcome.note,
			],
			["kept", 300_000, "NPR", null, null, owner.id, "No-show policy"],
		);
		const money = await inTenant(tenant, () => payments.forProject(tenant, project));
		assert.isFalse(money.outcomeNeeded);
		assert.equal(money.outcome?.id, outcome.id);
	});

	test("refunded records a refund up to the deposit held and names it; the rest is kept", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("refunded-66");

		const outcome = await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "refunded",
				amount: 200_000,
				method: "esewa",
				note: "Half back, as agreed",
			}),
		);

		const refund = await inTenant(tenant, () =>
			Payment.findOrFail(outcome.refundPaymentId ?? ""),
		);
		assert.deepEqual(
			[refund.kind, refund.amount, refund.method, refund.status, refund.projectId],
			["refund", -200_000, "esewa", "verified", project.id],
		);
		assert.deepEqual([outcome.outcome, outcome.amount], ["refunded", 300_000]);
	});

	test("more than the deposit held is refused, and nothing is recorded", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("too-much-66");

		try {
			await inTenant(tenant, () =>
				payments.recordOutcome(tenant, member, project, {
					outcome: "refunded",
					amount: 300_001,
					method: "cash",
					note: null,
				}),
			);
			assert.fail("refunding more than the deposit held must be refused");
		} catch (error) {
			assert.instanceOf(error, PaymentRuleError);
			assert.equal((error as PaymentRuleError).reason, "refund_too_large");
			assert.equal((error as PaymentRuleError).limit, 300_000);
		}
		await inTenant(tenant, async () => {
			assert.lengthOf(await DepositOutcome.query().where("project_id", project.id), 0);
			assert.lengthOf(
				await Payment.query().where("project_id", project.id).where("kind", "refund"),
				0,
			);
		});
	});

	test("no outcome for an open project, one without deposit money, or a second time", async ({
		assert,
	}) => {
		const open = await closed("open-66", "booked");
		const empty = await closed("empty-66", "cancelled", 0);
		const twice = await closed("twice-out-66");
		const record = (setup: Awaited<ReturnType<typeof closed>>) =>
			reasonOf(() =>
				inTenant(setup.tenant, () =>
					payments.recordOutcome(setup.tenant, setup.member, setup.project, {
						outcome: "kept",
						note: null,
					}),
				),
			);

		assert.equal(await record(open), "no_outcome_needed");
		assert.equal(await record(empty), "no_outcome_needed");
		assert.isNull(await record(twice));
		assert.equal(await record(twice), "no_outcome_needed");
	});

	test("after the outcome a plain refund works again", async ({ assert }) => {
		const { tenant, member, project } = await closed("after-66");
		await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, { outcome: "kept", note: null }),
		);

		const refund = await inTenant(tenant, () =>
			payments.refund(tenant, member, project, { method: "cash", amount: 50_000, note: null }),
		);
		assert.equal(refund.amount, -50_000);
	});

	test("an artist can't record an outcome", async ({ assert }) => {
		const { tenant, project } = await closed("outcome-artist-66");
		const asha = await artistIn(tenant, "asha@outcome-66.example");

		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					payments.recordOutcome(
						tenant,
						{ userId: asha.id, role: "artist" },
						project,
						{ outcome: "kept", note: null },
					),
				),
			/Row not found/,
		);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposit_outcome_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL (`payments.recordOutcome is not a function`).

- [ ] **Step 3: The write**

In `apps/platform/app/modules/payments/services/payment_service.ts`, after the `Reversal` type, add:

```ts
/** What the studio decided about a closed project's deposit (TAT-85 adds sessions and `moved`). */
export type OutcomeInput =
	| { outcome: "kept"; note: string | null }
	| {
			outcome: "refunded";
			amount: number;
			method: PaymentMethodKind;
			note: string | null;
	  };
```

and after `reverse`, add:

```ts
	/**
	 * Records what happened to the deposit of a closed project (cancelled or
	 * declined) that holds deposit money and has no outcome yet, else
	 * PaymentRuleError "no_outcome_needed". `kept`: the studio keeps it.
	 * `refunded`: a refund payment of `amount` (up to the deposit held,
	 * "refund_too_large" with that limit; the rest is kept), named by the
	 * outcome, in the same transaction. The outcome's amount is the deposit
	 * money held. The app only records the studio's decision; its deposit
	 * policy is its own.
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
				if (input.amount > money.depositHeld) {
					throw new PaymentRuleError("refund_too_large", money.depositHeld);
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
							amount: money.depositHeld,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=deposit_outcome_service.spec.ts --files=payment_entries.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/services/payment_service.ts apps/platform/tests/functional/payments/deposit_outcome_service.spec.ts
git -C <repo> commit -m "feat(platform): record whether the studio kept or refunded a closed project's deposit

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `PaymentService` reads for the lists and the client profile

**Files:**
- Modify: `apps/platform/app/modules/payments/services/payment_service.ts`
- Test: `apps/platform/tests/functional/payments/payment_reads.spec.ts` (create)

**Interfaces:**
- Consumes: Task 9's `forProject`, `CLOSED_FOR_OUTCOME`; Task 3's `balanceOf`, `depositMoney`.
- Produces: `forProjects(tenant, projectIds: string[]): Promise<Payment[]>` (newest first); `balancesFor(tenant, projects: Pick<TattooProject, "id">[]): Promise<Map<string, Balance>>`; `listFlags(tenant, projects: Pick<TattooProject, "id" | "status">[]): Promise<Map<string, { proofWaiting: boolean; depositToSettle: boolean }>>`; `memberNames(userIds: (string | null)[]): Promise<Map<string, string>>` (full name, else email).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/payment_reads.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import { ownerMember, paymentServices, proofFor } from "#tests/helpers/payments";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments } = paymentServices();

const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

test.group("PaymentService reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("forProjects lists the payments of these projects, newest first; balancesFor gives each its balance", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-many-66", "Black Needle");
		const { one, two, direct, rows } = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const one = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, one);
			const two = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, two, { fixedPrice: 1_000_000, depositAmount: 0 });
			const direct = await makeProject(tenant, client, { status: "booked" });
			const first = await makePayment(tenant, one, verified());
			const second = await makePayment(tenant, two, {
				kind: "balance",
				amount: 400_000,
				...verified(),
			});
			return { one, two, direct, rows: [first, second] };
		});

		const listed = await inTenant(tenant, () =>
			payments.forProjects(tenant, [one.id, two.id, direct.id]),
		);
		assert.deepEqual(
			listed.map(({ id }) => id),
			[rows[1].id, rows[0].id],
		);
		const balances = await inTenant(tenant, () =>
			payments.balancesFor(tenant, [one, two, direct]),
		);
		assert.equal(balances.get(one.id)?.due, 1_200_000n);
		assert.equal(balances.get(two.id)?.due, 600_000n);
		assert.isNull(balances.get(direct.id)?.due);
		assert.deepEqual(
			await inTenant(tenant, () => payments.forProjects(tenant, [])),
			[],
		);
	});

	test("listFlags: a screenshot to check, and a closed project's deposit to settle", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("reads-flags-66", "Black Needle");
		const projects = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const waiting = await makeProject(tenant, client, { status: "deposit_pending" });
			await makeQuote(tenant, waiting);
			await proofFor(tenant, waiting);
			const closed = await makeProject(tenant, client, { status: "cancelled" });
			await makeQuote(tenant, closed);
			await makePayment(tenant, closed, verified());
			const settled = await makeProject(tenant, client, { status: "cancelled" });
			await makeQuote(tenant, settled);
			await makePayment(tenant, settled, verified());
			const open = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, open);
			await makePayment(tenant, open, verified());
			return { waiting, closed, settled, open };
		});
		await inTenant(tenant, () =>
			payments.recordOutcome(tenant, ownerMember(owner), projects.settled, {
				outcome: "kept",
				note: null,
			}),
		);

		const flags = await inTenant(tenant, () =>
			payments.listFlags(tenant, Object.values(projects)),
		);

		assert.deepEqual(flags.get(projects.waiting.id), {
			proofWaiting: true,
			depositToSettle: false,
		});
		assert.deepEqual(flags.get(projects.closed.id), {
			proofWaiting: false,
			depositToSettle: true,
		});
		assert.deepEqual(flags.get(projects.settled.id), {
			proofWaiting: false,
			depositToSettle: false,
		});
		assert.deepEqual(flags.get(projects.open.id), {
			proofWaiting: false,
			depositToSettle: false,
		});
	});

	test("memberNames: the full name, else the email", async ({ assert }) => {
		const named = await User.create({
			fullName: "Asha Rai",
			email: "asha-66@example.com",
			password: "secret-password",
		});
		const bare = await User.create({
			email: "bare-66@example.com",
			password: "secret-password",
		});

		const names = await payments.memberNames([named.id, bare.id, null, named.id]);

		assert.deepEqual(Object.fromEntries(names), {
			[named.id]: "Asha Rai",
			[bare.id]: "bare-66@example.com",
		});
	});

	test("another studio's context sees none of a project's money", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("reads-a-66", "A");
		const { tenant: b } = await studioWithOwner("reads-b-66", "B");
		const project = await inTenant(a, async () => {
			const made = await makeProject(a, await makeClient(a), { status: "booked" });
			await makeQuote(a, made);
			await makePayment(a, made, verified());
			return made;
		});

		const seen = await inTenant(b, () => payments.forProject(a, project));
		assert.isNull(seen.quote);
		assert.lengthOf(seen.payments, 0);
		assert.lengthOf(
			await inTenant(b, () => payments.forProjects(a, [project.id])),
			0,
		);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=payment_reads.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL (`payments.forProjects is not a function`).

- [ ] **Step 3: The reads**

In `apps/platform/app/modules/payments/services/payment_service.ts`, add `import User from "#models/user";` to the imports, and after `forProject` add:

```ts
	/** The payments of these projects (the client profile), newest first. */
	async forProjects(tenant: TenantRef, projectIds: string[]): Promise<Payment[]> {
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
	 * (`proofWaiting`), or a closed project holds deposit money with no
	 * outcome recorded (`depositToSettle`).
	 */
	async listFlags(
		tenant: TenantRef,
		projects: Pick<TattooProject, "id" | "status">[],
	): Promise<Map<string, { proofWaiting: boolean; depositToSettle: boolean }>> {
		const ids = projects.map(({ id }) => id);
		const rows =
			ids.length === 0
				? []
				: await Payment.query()
						.where("tenant_id", tenant.id)
						.whereIn("project_id", ids)
						.whereIn("kind", ["deposit", "correction"]);
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
		const flags = new Map<
			string,
			{ proofWaiting: boolean; depositToSettle: boolean }
		>();
		for (const project of projects) {
			const own = rows.filter(({ projectId }) => projectId === project.id);
			let depositToSettle = false;
			if (CLOSED_FOR_OUTCOME.includes(project.status) && !settled.has(project.id)) {
				const quote = await this.quotes.current(tenant, project);
				depositToSettle = depositMoney(own, quote?.currency ?? "NPR") > 0;
			}
			flags.set(project.id, {
				proofWaiting: own.some(
					({ kind, status }) => kind === "deposit" && status === "submitted",
				),
				depositToSettle,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=payment_reads.spec.ts --files=payment_decisions.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/services/payment_service.ts apps/platform/tests/functional/payments/payment_reads.spec.ts
git -C <repo> commit -m "feat(platform): read payments, balances and list flags for the pages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 13: The payment routes: validators, controller, isolation cases

**Files:**
- Create: `apps/platform/app/modules/payments/validators/payment.ts`, `apps/platform/app/controllers/payments_controller.ts`
- Modify: `apps/platform/start/routes.ts`, `apps/platform/tests/helpers/tenants.ts`, `apps/platform/tests/isolation/cases.ts`, `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Regenerate: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/payments/payments_http.spec.ts` (create)

**Interfaces:**
- Consumes: Tasks 9 to 11's `PaymentService` (`findFor`, `verify`, `reject`, `record`, `refund`, `reverse`, `recordOutcome`), `Recorded`, `OutcomeInput`, `PaymentRuleError`; `DESK_KINDS`; `PAYMENT_METHOD_KINDS`; `formatMoney`.
- Produces: `AMOUNT_MESSAGE`, `toPaisa(rupees: number): number`, `decisionValidator`, `deskPaymentValidator`, `refundValidator`, `outcomeValidator`, `type OutcomeForm`, `toOutcomeInput(form: OutcomeForm): OutcomeInput` in `#modules/payments/validators/payment`; `PaymentsController` (`verify`, `reject`, `reverse`, `store`, `refund`, `outcome`); routes `tenant.payments.verify`, `tenant.payments.reject`, `tenant.payments.reverse` (`POST /t/:tenant/payments/:id/{verify,reject,reverse}`, owner-only group), `tenant.projects.payments.store` (`POST /t/:tenant/projects/:id/payments`), `tenant.projects.refunds.store` (`…/refunds`), `tenant.projects.deposit_outcome.store` (`…/deposit-outcome`). Fixtures on `Studio`: `payment` (the pipeline's submitted payment), `paidProject` and `verifiedPayment` (a booked project and its verified NPR 3,000 deposit), `closedPaidProject` (a cancelled project holding a verified NPR 3,000 deposit). `IsolationCase.resource` gains `"payment" | "verifiedPayment" | "paidProject" | "closedPaidProject"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/payments_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { depositReady } from "#tests/helpers/deposits";
import { proofFor } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const SLUG = "pay-needle-66";
const page = (id: string) => `/t/${SLUG}/projects/${id}`;
const AMOUNT =
	"Enter an amount from 0.01 to 1,00,00,000 rupees, with at most 2 decimals.";

function post(
	client: ApiClient,
	user: User,
	url: string,
	form: Record<string, string> = {},
) {
	return client
		.post(url)
		.form(form)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

/** A studio with a deposit_pending project whose screenshot waits. */
async function waiting() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
	const { project } = await inTenant(tenant, () => depositReady(tenant));
	const proof = await inTenant(tenant, () => proofFor(tenant, project));
	return { owner, tenant, project, proof };
}

/** A project in `status` with the default quote and a verified NPR 3,000 deposit. */
async function holding(tenant: { id: string }, status: TattooProject["status"]) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), { status });
		await makeQuote(tenant, project);
		const deposit = await makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
		});
		return { project, deposit };
	});
}

const reload = <T extends Payment | TattooProject>(tenant: { id: string }, model: T) =>
	inTenant(tenant, async () => {
		await model.refresh();
		return model;
	});

test.group("Payment decisions over HTTP", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("verifying books the project when a session is scheduled", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, proof } = await waiting();
		await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const response = await post(client, owner, `/t/${SLUG}/payments/${proof.id}/verify`, {
			note: "On the eSewa statement",
		});

		response.assertStatus(302);
		response.assertHeader("location", page(project.id));
		response.assertFlashMessage("success", "Payment verified. The project is booked.");
		assert.equal((await reload(tenant, proof)).note, "On the eSewa statement");
	});

	test("without a session the flash says what to do; a partial deposit says what is left", async ({
		client,
	}) => {
		const covered = await waiting();
		(await post(client, covered.owner, `/t/${SLUG}/payments/${covered.proof.id}/verify`))
			.assertFlashMessage(
				"success",
				"Payment verified. Schedule a tattoo session to book the project.",
			);

		const { owner, tenant } = await studioWithOwner("pay-part-66", "Part");
		const { project } = await inTenant(tenant, () =>
			depositReady(tenant, { depositAmount: 400_000 }),
		);
		const partial = await inTenant(tenant, () =>
			proofFor(tenant, project, { amount: 100_000 }),
		);
		(await post(client, owner, `/t/pay-part-66/payments/${partial.id}/verify`))
			.assertFlashMessage("success", "Payment verified. NPR 3,000 of the deposit is still due.");
	});

	test("a second Verify is a flash, not an error", async ({ client, assert }) => {
		const { owner, tenant, proof } = await waiting();
		await post(client, owner, `/t/${SLUG}/payments/${proof.id}/verify`);

		const again = await post(client, owner, `/t/${SLUG}/payments/${proof.id}/reject`);

		again.assertStatus(302);
		again.assertFlashMessage(
			"error",
			"This payment was already verified or rejected. Check the list.",
		);
		assert.equal((await reload(tenant, proof)).status, "verified");
	});

	test("rejecting tells the owner the deposit page asks again", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, proof } = await waiting();

		const response = await post(client, owner, `/t/${SLUG}/payments/${proof.id}/reject`, {
			note: "Not on the statement",
		});

		response.assertFlashMessage(
			"success",
			"Screenshot rejected. The deposit page now asks the client for a new one.",
		);
		assert.equal((await reload(tenant, proof)).status, "rejected");
	});

	test("the Projects badge drops after a decision", async ({ client, assert }) => {
		const { owner, proof } = await waiting();
		const badge = async () =>
			(await client.get(`/t/${SLUG}/projects`).withInertia().loginAs(owner))
				.inertiaProps.proofCount;

		assert.equal(await badge(), 1);
		await post(client, owner, `/t/${SLUG}/payments/${proof.id}/verify`);
		assert.equal(await badge(), 0);
	});
});

test.group("Desk payments, refunds, reversals and outcomes over HTTP", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner records a desk payment in rupees with paisa", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await holding(tenant, "booked");

		const response = await post(client, owner, `${page(project.id)}/payments`, {
			kind: "balance",
			method: "khalti",
			amount: "12345.67",
			note: "Rest after the session",
		});

		response.assertFlashMessage("success", "Payment recorded.");
		const payment = await inTenant(tenant, () =>
			Payment.query().where("project_id", project.id).where("kind", "balance").firstOrFail(),
		);
		assert.deepEqual(
			[payment.amount, payment.method, payment.status, payment.note],
			[1_234_567, "khalti", "verified", "Rest after the session"],
		);
	});

	test("a bad amount, kind, method or note is a field error", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await holding(tenant, "booked");
		const form = (over: Record<string, string>) => ({
			kind: "balance",
			method: "cash",
			amount: "1000",
			...over,
		});

		for (const amount of ["0", "12.345", "10000000.01", "", "abc"]) {
			assertValidationError(
				await post(client, owner, `${page(project.id)}/payments`, form({ amount })),
				"amount",
				AMOUNT,
			);
		}
		assertValidationError(
			await post(client, owner, `${page(project.id)}/payments`, form({ kind: "refund" })),
			"kind",
			"Choose what was paid.",
		);
		assertValidationError(
			await post(client, owner, `${page(project.id)}/payments`, form({ method: "card" })),
			"method",
			"Choose how it was paid.",
		);
		assertValidationError(
			await post(client, owner, `${page(project.id)}/payments`, form({ note: "x".repeat(501) })),
			"note",
			"Keep it under 500 characters.",
		);
	});

	test("a desk deposit outside deposit_pending is a flash error", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await holding(tenant, "booked");

		const response = await post(client, owner, `${page(project.id)}/payments`, {
			kind: "deposit",
			method: "cash",
			amount: "3000",
		});

		response.assertFlashMessage(
			"error",
			"A deposit can be recorded only while the project waits for it. Mark the quote accepted first.",
		);
	});

	test("a refund over what the project holds is a field error on amount", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await holding(tenant, "booked");

		const ok = await post(client, owner, `${page(project.id)}/refunds`, {
			method: "cash",
			amount: "1000",
		});
		ok.assertFlashMessage("success", "Refund recorded.");
		assertValidationError(
			await post(client, owner, `${page(project.id)}/refunds`, {
				method: "cash",
				amount: "2500",
			}),
			"amount",
			"You can refund at most NPR 2,000.",
		);
	});

	test("an owner reverses a deposit; the flash says it is due again; a second reversal is refused", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { deposit } = await holding(tenant, "booked");

		const first = await post(client, owner, `/t/${SLUG}/payments/${deposit.id}/reverse`, {
			note: "Never reached the account",
		});
		first.assertFlashMessage(
			"success",
			"Payment reversed. NPR 3,000 of the deposit is due again.",
		);
		const second = await post(client, owner, `/t/${SLUG}/payments/${deposit.id}/reverse`);
		second.assertFlashMessage("error", "This payment was already reversed.");
	});

	test("an owner records a closed project's deposit outcome; a refund needs its amount and method", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const kept = await holding(tenant, "cancelled");
		const refunded = await holding(tenant, "cancelled");

		(await post(client, owner, `${page(kept.project.id)}/deposit-outcome`, {
			outcome: "kept",
		})).assertFlashMessage("success", "Recorded: the studio keeps the deposit.");

		const missing = await post(client, owner, `${page(refunded.project.id)}/deposit-outcome`, {
			outcome: "refunded",
		});
		assertValidationError(missing, "amount", AMOUNT);
		assertValidationError(missing, "method", "Choose how it was paid.");

		(await post(client, owner, `${page(refunded.project.id)}/deposit-outcome`, {
			outcome: "refunded",
			amount: "2000",
			method: "esewa",
		})).assertFlashMessage("success", "Recorded: NPR 2,000 of the deposit refunded.");

		const outcomes = await inTenant(tenant, () =>
			DepositOutcome.query().whereIn("project_id", [kept.project.id, refunded.project.id]),
		);
		assert.sameMembers(
			outcomes.map(({ outcome }) => outcome),
			["kept", "refunded"],
		);
		(await post(client, owner, `${page(kept.project.id)}/deposit-outcome`, {
			outcome: "kept",
		})).assertFlashMessage(
			"error",
			"There's no deposit outcome to record for this project.",
		);
	});

	test("the assigned artist gets a 404 on every payment write", async ({
		client,
		assert,
	}) => {
		const { tenant, project, proof } = await waiting();
		const asha = await artistIn(tenant, `asha@${SLUG}.example`);
		const { deposit } = await holding(tenant, "booked");
		const closed = await holding(tenant, "cancelled");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			for (const mine of [project, closed.project]) {
				mine.artistId = profile.id;
				await mine.save();
			}
		});

		for (const [url, form] of [
			[`/t/${SLUG}/payments/${proof.id}/verify`, {}],
			[`/t/${SLUG}/payments/${proof.id}/reject`, {}],
			[`/t/${SLUG}/payments/${deposit.id}/reverse`, {}],
			[`${page(project.id)}/payments`, { kind: "session", method: "cash", amount: "1000" }],
			[`${page(project.id)}/refunds`, { method: "cash", amount: "1" }],
			[`${page(closed.project.id)}/deposit-outcome`, { outcome: "kept" }],
		] as const) {
			(await post(client, asha, url, form)).assertStatus(404);
		}
		assert.equal((await reload(tenant, proof)).status, "submitted");
	});
});
```

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, add `{ area: "payments", allow: ["owner"] },` to the areas table after `{ area: "clients", allow: ["owner"] },`.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=payments_http.spec.ts --files=tenant_routes.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: every payment route is a 404 (no route), and the payments-area guard finds no routes.

- [ ] **Step 3: The validators**

Create `apps/platform/app/modules/payments/validators/payment.ts`:

```ts
import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DESK_KINDS } from "#modules/payments/models/payment";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";
import type { OutcomeInput } from "#modules/payments/services/payment_service";

export const AMOUNT_MESSAGE =
	"Enter an amount from 0.01 to 1,00,00,000 rupees, with at most 2 decimals.";
const METHOD_MESSAGE = "Choose how it was paid.";
const NOTE_MESSAGE = "Keep it under 500 characters.";

/** Rupees with paisa, as a form sends them: 0.01 to 1,00,00,000. */
const amount = () => vine.number().min(0.01).max(10_000_000).decimal([0, 2]);
/** An optional staff note; an empty box arrives as null. */
const note = () => vine.string().trim().maxLength(500).nullable().optional();
const method = () => vine.enum(PAYMENT_METHOD_KINDS);

/**
 * Rupees from a form in stored paisa. Rounded, because 0.29 × 100 is
 * 28.999… in floating point; the validator allows at most 2 decimals.
 */
export const toPaisa = (rupees: number) => Math.round(rupees * 100);

const AMOUNT_MESSAGES = {
	"amount.required": AMOUNT_MESSAGE,
	"amount.number": AMOUNT_MESSAGE,
	"amount.min": AMOUNT_MESSAGE,
	"amount.max": AMOUNT_MESSAGE,
	"amount.decimal": AMOUNT_MESSAGE,
};
const SHARED_MESSAGES = {
	"method.required": METHOD_MESSAGE,
	"method.enum": METHOD_MESSAGE,
	"note.maxLength": NOTE_MESSAGE,
};

/** Verify, reject and reverse: an optional note. */
export const decisionValidator = vine.create({ note: note() });
decisionValidator.messagesProvider = new SimpleMessagesProvider({
	"note.maxLength": NOTE_MESSAGE,
});

/** Money taken at the desk. */
export const deskPaymentValidator = vine.create({
	kind: vine.enum(DESK_KINDS),
	method: method(),
	amount: amount(),
	note: note(),
});
deskPaymentValidator.messagesProvider = new SimpleMessagesProvider({
	"kind.required": "Choose what was paid.",
	"kind.enum": "Choose what was paid.",
	...AMOUNT_MESSAGES,
	...SHARED_MESSAGES,
});

/** Money given back. */
export const refundValidator = vine.create({
	method: method(),
	amount: amount(),
	note: note(),
});
refundValidator.messagesProvider = new SimpleMessagesProvider({
	...AMOUNT_MESSAGES,
	...SHARED_MESSAGES,
});

/** A closed project's deposit: kept, or refunded with an amount and a method (toOutcomeInput). */
export const outcomeValidator = vine.create({
	outcome: vine.enum(["kept", "refunded"] as const),
	method: method().optional(),
	amount: amount().optional(),
	note: note(),
});
outcomeValidator.messagesProvider = new SimpleMessagesProvider({
	"outcome.required": "Choose what happened to the deposit.",
	"outcome.enum": "Choose what happened to the deposit.",
	...AMOUNT_MESSAGES,
	...SHARED_MESSAGES,
});

export type OutcomeForm = Infer<typeof outcomeValidator>;

/**
 * The service's input from the outcome form, in paisa. A refund needs its
 * amount and its method: E_VALIDATION_ERROR on each missing field, shown
 * next to it.
 */
export function toOutcomeInput(form: OutcomeForm): OutcomeInput {
	const text = form.note ?? null;
	if (form.outcome === "kept") return { outcome: "kept", note: text };
	const problems: { field: string; message: string; rule: string }[] = [];
	if (form.amount == null) {
		problems.push({ field: "amount", message: AMOUNT_MESSAGE, rule: "required" });
	}
	if (form.method == null) {
		problems.push({ field: "method", message: METHOD_MESSAGE, rule: "required" });
	}
	if (problems.length > 0 || form.amount == null || form.method == null) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		outcome: "refunded",
		amount: toPaisa(form.amount),
		method: form.method,
		note: text,
	};
}
```

(VineJS 4.4's number schema has `.decimal(range)`; if `rg -n 'decimal' <repo>/apps/platform/node_modules/@vinejs/vine/build/src/schema/number/main.d.ts` finds nothing, stop and report.)

- [ ] **Step 4: The controller and the routes**

Create `apps/platform/app/controllers/payments_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	PaymentRuleError,
	type PaymentRuleReason,
} from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentService, {
	type Recorded,
} from "#modules/payments/services/payment_service";
import {
	decisionValidator,
	deskPaymentValidator,
	outcomeValidator,
	refundValidator,
	toOutcomeInput,
	toPaisa,
} from "#modules/payments/validators/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { formatMoney } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

/** What a refused payment action tells the owner; `refund_too_large` is a field error instead. */
const PAYMENT_RULE_MESSAGES: Record<
	Exclude<PaymentRuleReason, "refund_too_large">,
	string
> = {
	already_decided:
		"This payment was already verified or rejected. Check the list.",
	not_reversible:
		"Only a verified payment that isn't a reversal can be reversed.",
	already_reversed: "This payment was already reversed.",
	deposit_not_pending:
		"A deposit can be recorded only while the project waits for it. Mark the quote accepted first.",
	project_declined: "This project was declined: it takes no payments.",
	outcome_first: "Record what happened to the deposit first.",
	no_outcome_needed: "There's no deposit outcome to record for this project.",
};

/**
 * The owners' payment actions on the project page (TAT-66). A payment's :id
 * loads through PaymentService.findFor (owners only, scoped to the tenant)
 * and its project through ProjectService.findFor; a project's :id loads
 * through ProjectService.findFor and PaymentService refuses anyone but an
 * owner. Another tenant's payment or project, a deleted project and an
 * artist all get a 404. Every action goes back to the project page.
 */
@inject()
export default class PaymentsController {
	constructor(
		private payments: PaymentService,
		private projects: ProjectService,
	) {}

	async verify(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { payment, project } = await this.paymentAndProject(ctx);
		const { note } = await ctx.request.validateUsing(decisionValidator);
		await refusalsAsFlash(ctx, async () => {
			const recorded = await this.payments.verify(
				tenant,
				membership,
				payment,
				note ?? null,
			);
			ctx.session.flash("success", `Payment verified.${bookingNote(recorded)}`);
		});
		return backTo(ctx, tenant, project);
	}

	async reject(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { payment, project } = await this.paymentAndProject(ctx);
		const { note } = await ctx.request.validateUsing(decisionValidator);
		await refusalsAsFlash(ctx, async () => {
			const { asksAgain } = await this.payments.reject(
				tenant,
				membership,
				payment,
				note ?? null,
			);
			ctx.session.flash(
				"success",
				asksAgain
					? "Screenshot rejected. The deposit page now asks the client for a new one."
					: "Screenshot rejected.",
			);
		});
		return backTo(ctx, tenant, project);
	}

	async reverse(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { payment, project } = await this.paymentAndProject(ctx);
		const { note } = await ctx.request.validateUsing(decisionValidator);
		await refusalsAsFlash(ctx, async () => {
			const { reversed, depositDue } = await this.payments.reverse(
				tenant,
				membership,
				payment,
				note ?? null,
			);
			const due =
				reversed.kind === "deposit" && depositDue > 0
					? ` ${formatMoney(depositDue)} of the deposit is due again.`
					: "";
			ctx.session.flash("success", `Payment reversed.${due}`);
		});
		return backTo(ctx, tenant, project);
	}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(deskPaymentValidator);
		await refusalsAsFlash(ctx, async () => {
			const recorded = await this.payments.record(tenant, membership, project, {
				kind: form.kind,
				method: form.method,
				amount: toPaisa(form.amount),
				note: form.note ?? null,
			});
			ctx.session.flash("success", `Payment recorded.${bookingNote(recorded)}`);
		});
		return backTo(ctx, tenant, project);
	}

	async refund(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(refundValidator);
		await refusalsAsFlash(ctx, async () => {
			await this.payments.refund(tenant, membership, project, {
				method: form.method,
				amount: toPaisa(form.amount),
				note: form.note ?? null,
			});
			ctx.session.flash("success", "Refund recorded.");
		});
		return backTo(ctx, tenant, project);
	}

	async outcome(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const input = toOutcomeInput(
			await ctx.request.validateUsing(outcomeValidator),
		);
		await refusalsAsFlash(ctx, async () => {
			await this.payments.recordOutcome(tenant, membership, project, input);
			ctx.session.flash(
				"success",
				input.outcome === "kept"
					? "Recorded: the studio keeps the deposit."
					: `Recorded: ${formatMoney(input.amount)} of the deposit refunded.`,
			);
		});
		return backTo(ctx, tenant, project);
	}

	/** The payment (owners only, the tenant's) and its live project, else a 404. */
	private async paymentAndProject(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const payment = await this.payments.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const project = await this.projects.findFor(
			tenant,
			membership,
			payment.projectId,
		);
		return { payment, project };
	}
}

/** What a verified or recorded deposit did next, for the flash. */
function bookingNote({ payment, booked, status, depositDue }: Recorded): string {
	if (payment.kind !== "deposit") return "";
	if (booked) return " The project is booked.";
	if (status !== "deposit_pending") return "";
	return depositDue > 0
		? ` ${formatMoney(depositDue)} of the deposit is still due.`
		: " Schedule a tattoo session to book the project.";
}

/**
 * Runs `work`, turning a refused payment action into the flash error, or
 * for `refund_too_large` into a field error on `amount`. The service
 * already rolled its savepoint back, so the request goes on.
 */
async function refusalsAsFlash(ctx: HttpContext, work: () => Promise<void>) {
	try {
		await work();
	} catch (error) {
		if (!(error instanceof PaymentRuleError)) throw error;
		if (error.reason === "refund_too_large") {
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "amount",
					message: `You can refund at most ${formatMoney(error.limit ?? 0)}.`,
					rule: "max",
				},
			]);
		}
		ctx.session.flash("error", PAYMENT_RULE_MESSAGES[error.reason]);
	}
}

function backTo(
	ctx: HttpContext,
	tenant: { slug: string },
	project: TattooProject,
) {
	return ctx.response
		.redirect()
		.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
}
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains `Payments` in the controllers index.

In `apps/platform/start/routes.ts`:
- Inside the `/projects` group, after the `tenant.projects.price.store` route (Task 7), add:

```ts
				// Owners only: PaymentService gives anyone else a 404 (TAT-66).
				router
					.post(":id/payments", [controllers.Payments, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.payments.store");
				router
					.post(":id/refunds", [controllers.Payments, "refund"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.refunds.store");
				router
					.post(":id/deposit-outcome", [controllers.Payments, "outcome"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.deposit_outcome.store");
```

- After the `/projects` group (before the `/calendar` group), add:

```ts
		/**
		 * Decisions on one payment (TAT-66): owners only, and
		 * PaymentService.findFor checks again. Every payments route goes in
		 * this group (a test checks).
		 */
		router
			.group(() => {
				router
					.post(":id/verify", [controllers.Payments, "verify"])
					.where("id", router.matchers.uuid())
					.as("tenant.payments.verify");
				router
					.post(":id/reject", [controllers.Payments, "reject"])
					.where("id", router.matchers.uuid())
					.as("tenant.payments.reject");
				router
					.post(":id/reverse", [controllers.Payments, "reverse"])
					.where("id", router.matchers.uuid())
					.as("tenant.payments.reverse");
			})
			.prefix("/payments")
			.use(middleware.role({ allow: ["owner"] }));
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains the six routes.

- [ ] **Step 5: The isolation fixtures and cases**

In `apps/platform/tests/helpers/tenants.ts`:
- Add `import { DateTime } from "luxon";` and `makePayment` to the `#tests/helpers/pipeline` import.
- In `studio()`, after the `pricelessProject` block (Task 7), add:

```ts
	// The payment routes (TAT-66): a booked project holding a verified
	// deposit (refund, reverse), and a cancelled one whose deposit still
	// needs its outcome.
	const paid = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "booked",
		});
		await makeQuote(tenant, project);
		const payment = await makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
			verifiedByUserId: owner.id,
		});
		return { project, payment };
	});
	const closedPaidProject = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "cancelled",
		});
		await makeQuote(tenant, project);
		await makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
			verifiedByUserId: owner.id,
		});
		return project;
	});
```

- In the returned object, after `pricelessProject,`, add:

```ts
		// The payment routes' :id resources (TAT-66).
		payment: pipeline.payment,
		paidProject: paid.project,
		verifiedPayment: paid.payment,
		closedPaidProject,
```

- In the comment above `twoStudios`, add before "Later tickets add seed data": "a project booked without a price (`pricelessProject`), a booked project holding a verified deposit (`paidProject`, `verifiedPayment`) and a cancelled one holding a deposit without an outcome (`closedPaidProject`); `payment` is the pipeline's submitted payment;".

In `apps/platform/tests/isolation/cases.ts`:
- Add `import DepositOutcome from "#modules/payments/models/deposit_outcome";` and `import Payment from "#modules/payments/models/payment";` to the imports.
- In `IsolationCase.resource`, add `| "payment" | "verifiedPayment" | "paidProject" | "closedPaidProject"`.
- After `projectRows`, add:

```ts
// Payments, deposit outcomes and the projects' statuses: what the payment
// routes could change.
const paymentRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		payments: (
			await Payment.query().where("tenant_id", target.tenant.id).orderBy("id")
		).map((payment) => payment.serialize()),
		outcomes: (
			await DepositOutcome.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((outcome) => outcome.serialize()),
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map(({ id, status }) => ({ id, status })),
	}));
```

- After the `/t/:tenant/projects/:id/price` case (Task 7), add:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/payments",
		resource: "project",
		actor: "owner",
		body: () => ({ kind: "session", method: "cash", amount: "2000" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/refunds",
		resource: "paidProject",
		actor: "owner",
		body: () => ({ method: "cash", amount: "1000" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/deposit-outcome",
		resource: "closedPaidProject",
		actor: "owner",
		body: () => ({ outcome: "kept" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/payments/:id/verify",
		resource: "payment",
		actor: "owner",
		body: () => ({ note: "On the statement" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/payments/:id/reject",
		resource: "payment",
		actor: "owner",
		body: () => ({ note: "Not on the statement" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/payments/:id/reverse",
		resource: "verifiedPayment",
		actor: "owner",
		body: () => ({ note: "Never arrived" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 timeout 500 pnpm -C <repo>/apps/platform test functional --files=payments_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=public_api.spec.ts`
Expected: PASS: each new route's positive control changes studio A's payments, and B's slug or B's id is a 404 with B unchanged (the public harness still passes with the bigger fixture).

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/tests
git -C <repo> commit -m "feat(platform): add the owners' payment routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The Payments card's props, and the projects list flags (edits TAT-65 code)

**Files:**
- Create: `apps/platform/app/modules/payments/payments_card.ts`, `apps/platform/inertia/components/payments.ts`
- Modify: `apps/platform/app/controllers/projects_controller.ts` (TAT-65 injected `depositLinks` and `deposits` there), `apps/platform/inertia/components/projects.ts`
- Test: `apps/platform/tests/unit/modules/payments/payments_card.spec.ts` (create), `apps/platform/tests/functional/payments/project_payments_card.spec.ts` (create)

**Interfaces:**
- Consumes: Task 9's `ProjectMoney`, `CLOSED_FOR_OUTCOME`; Task 12's `listFlags`, `memberNames`; Task 8's `ImageService.url(…, tenant)`; Task 3's `formatSignedMoney`; TAT-65's `DepositLinkService.forProject` (its `referenceCode`).
- Produces: `paymentsCard(input: PaymentsCardInput): PaymentsCardProps` in `#modules/payments/payments_card`, with the exported types `PaymentRowProps`, `PendingProofProps`, `BalanceState`, `PaymentsCardProps`, `PaymentsCardInput = { money: ProjectMoney; status: ProjectStatus; isOwner: boolean; timezone: string; names: Map<string, string>; proofUrls: Map<string, string>; referenceCode: string | null }`; the same types (structurally) plus `KIND_LABELS`, `METHOD_LABELS`, `METHODS`, `PAYMENT_STATUS_LABELS`, `DESK_KIND_TEXT`, `type MethodKind`, `type DeskKindName` in `~/components/payments`; project page prop `payments: PaymentsCardProps`; `ProjectRow` gains `proofWaiting: boolean` and `depositToSettle: boolean`.

The props, exactly:

```ts
type PaymentRowProps = {
	id: string;
	kind: "deposit" | "session" | "balance" | "refund" | "correction";
	/** "NPR 3,000", or "−NPR 3,000" for money going back. */
	amountText: string;
	method: "fonepay" | "esewa" | "khalti" | "bank" | "cash";
	status: "submitted" | "verified" | "rejected";
	/** When it was recorded or sent: "18 Oct 2026". */
	dateText: string;
	/** "Waiting for an owner", "Verified by Asha Rai, 18 Oct 2026", "Recorded by …", "Rejected by …". */
	decisionText: string;
	note: string | null;
	/** "Reverses the NPR 3,000 deposit of 18 Oct 2026", or "Reversed 19 Oct 2026". */
	reversalText: string | null;
	/** Owners only, decided payments with a screenshot: a 5-minute signed URL. */
	proofUrl: string | null;
	/** Owners only: verified, not a reversal, not reversed yet. */
	canReverse: boolean;
};
type PendingProofProps = {
	paymentId: string;
	imageUrl: string | null;
	width: number | null;
	height: number | null;
	/** What the deposit page asked for when it was sent. */
	expectedText: string;
	referenceCode: string | null;
	method: PaymentRowProps["method"];
	/** "18 Oct 2026, 14:05" in the studio's timezone. */
	sentText: string;
	/** The deposit due now, when it differs from what was asked. */
	dueNowText: string | null;
};
type BalanceState = "due" | "paid" | "overpaid" | "no_price" | "closed";
type PaymentsCardProps = {
	balance: {
		totalText: string | null;
		/** Hourly: "estimated: 5 h at NPR 3,000/hour". */
		totalNote: string | null;
		paidText: string;
		state: BalanceState;
		/** due: what is due; overpaid: by how much; closed: what it holds; else null. */
		amountText: string | null;
	};
	/** When the current quote asks for a deposit. */
	deposit: {
		amountText: string;
		receivedText: string;
		dueText: string;
		covered: boolean;
		/** Booked or later, and the deposit is no longer covered (a reversal). */
		lapsed: boolean;
	} | null;
	rows: PaymentRowProps[];
	/** Owners only (else empty): the screenshots to check, newest first. */
	pending: PendingProofProps[];
	/** Owners only. */
	actions: {
		/** What Record payment offers now; empty: the form is hidden. */
		recordKinds: ("deposit" | "session" | "balance")[];
		/** Rupees to prefill: the deposit still due (deposit_pending only), the balance due. */
		depositDue: number | null;
		balanceDue: number | null;
		/** Rupees: the most a refund may be; null: no refund form. */
		refundMax: number | null;
		refundMaxText: string | null;
	} | null;
	outcome: {
		/** Owners only: the project closed holding deposit money and nothing is recorded. */
		needed: { held: number; heldText: string } | null;
		recorded: { text: string; recordedText: string; note: string | null } | null;
	};
};
```

- [ ] **Step 1: Write the failing unit test**

Create `apps/platform/tests/unit/modules/payments/payments_card.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { balanceOf, depositMoney } from "#modules/payments/ledger";
import type DepositOutcome from "#modules/payments/models/deposit_outcome";
import type Payment from "#modules/payments/models/payment";
import { paymentsCard } from "#modules/payments/payments_card";
import type { ProjectMoney } from "#modules/payments/services/payment_service";
import type Quote from "#modules/projects/models/quote";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

const KTM = "Asia/Kathmandu";
// 08:20 UTC is 14:05 in Kathmandu (UTC+5:45).
const AT = DateTime.fromISO("2026-10-18T08:20:00Z");
const ASHA = "user-asha";

let next = 0;
function payment(over: Partial<Payment> = {}): Payment {
	next += 1;
	return {
		id: `p${next}`,
		kind: "deposit",
		amount: 300_000,
		currency: "NPR",
		method: "cash",
		status: "verified",
		correctsPaymentId: null,
		verifiedAt: AT,
		verifiedByUserId: ASHA,
		createdAt: AT,
		note: null,
		proofImageKey: null,
		proofImageWidth: null,
		proofImageHeight: null,
		...over,
	} as unknown as Payment;
}

const quote = (over: Partial<Quote> = {}) =>
	({
		kind: "fixed",
		fixedPrice: 1_500_000,
		hourlyRate: null,
		estimatedMinutes: null,
		depositAmount: 300_000,
		currency: "NPR",
		...over,
	}) as unknown as Quote;

/** ProjectMoney the way forProject computes it. */
function money(
	payments: Payment[],
	current: Quote | null = quote(),
	status: ProjectStatus = "booked",
	outcome: DepositOutcome | null = null,
): ProjectMoney {
	const balance = balanceOf(current, payments);
	const depositHeld = depositMoney(payments, balance.currency);
	return {
		quote: current,
		payments,
		balance,
		depositHeld,
		depositDue: current ? Math.max(0, current.depositAmount - depositHeld) : 0,
		outcome,
		outcomeNeeded:
			["cancelled", "declined"].includes(status) && depositHeld > 0 && !outcome,
	};
}

const card = (
	data: ProjectMoney,
	status: ProjectStatus,
	isOwner = true,
	proofUrls = new Map<string, string>(),
) =>
	paymentsCard({
		money: data,
		status,
		isOwner,
		timezone: KTM,
		names: new Map([[ASHA, "Asha Rai"]]),
		proofUrls,
		referenceCode: "7KQ2MX",
	});

test.group("paymentsCard", () => {
	test("an owner gets a waiting screenshot next to what was asked and the reference code", ({
		assert,
	}) => {
		const proof = payment({
			status: "submitted",
			verifiedAt: null,
			verifiedByUserId: null,
			method: "esewa",
			proofImageKey: "k",
			proofImageWidth: 600,
			proofImageHeight: 800,
		});
		const props = card(
			money([proof], quote(), "deposit_pending"),
			"deposit_pending",
			true,
			new Map([[proof.id, "https://files/signed"]]),
		);

		assert.deepEqual(props.pending, [
			{
				paymentId: proof.id,
				imageUrl: "https://files/signed",
				width: 600,
				height: 800,
				expectedText: "NPR 3,000",
				referenceCode: "7KQ2MX",
				method: "esewa",
				sentText: "18 Oct 2026, 14:05",
				dueNowText: null,
			},
		]);
		assert.deepInclude(props.rows[0], {
			decisionText: "Waiting for an owner",
			proofUrl: null,
			canReverse: false,
		});
	});

	test("a screenshot sent before a revision says what is due now", ({
		assert,
	}) => {
		const proof = payment({ status: "submitted", verifiedAt: null, verifiedByUserId: null });
		const props = card(
			money([proof], quote({ depositAmount: 400_000 }), "deposit_pending"),
			"deposit_pending",
		);
		assert.equal(props.pending[0].dueNowText, "NPR 4,000");
	});

	test("rows say who decided and how; reversals point both ways", ({
		assert,
	}) => {
		const desk = payment();
		const shot = payment({ proofImageKey: "k", proofImageWidth: 1, proofImageHeight: 1 });
		const turnedDown = payment({ status: "rejected", verifiedByUserId: null });
		const reversal = payment({
			kind: "correction",
			amount: -300_000,
			correctsPaymentId: desk.id,
			createdAt: AT.plus({ days: 1 }),
		});
		const props = card(
			money([reversal, turnedDown, shot, desk]),
			"booked",
			true,
			new Map([[shot.id, "https://files/shot"]]),
		);
		const row = (id: string) => props.rows.find((r) => r.id === id);

		assert.deepInclude(row(desk.id), {
			decisionText: "Recorded by Asha Rai, 18 Oct 2026",
			reversalText: "Reversed 19 Oct 2026",
			canReverse: false,
		});
		assert.deepInclude(row(shot.id), {
			decisionText: "Verified by Asha Rai, 18 Oct 2026",
			proofUrl: "https://files/shot",
			canReverse: true,
		});
		assert.deepInclude(row(turnedDown.id), {
			decisionText: "Rejected by a deleted account, 18 Oct 2026",
			canReverse: false,
		});
		assert.deepInclude(row(reversal.id), {
			amountText: "−NPR 3,000",
			reversalText: "Reverses the NPR 3,000 deposit of 18 Oct 2026",
			canReverse: false,
		});
	});

	test("the balance: due, paid in full, overpaid, no price, and a closed project's holding", ({
		assert,
	}) => {
		const state = (data: ProjectMoney, status: ProjectStatus = "booked") => {
			const { balance } = card(data, status);
			return [balance.state, balance.amountText];
		};

		assert.deepEqual(state(money([payment()])), ["due", "NPR 12,000"]);
		assert.deepEqual(state(money([payment({ amount: 1_500_000 })])), ["paid", null]);
		assert.deepEqual(state(money([payment({ amount: 1_550_000 })])), ["overpaid", "NPR 500"]);
		assert.deepEqual(state(money([], null)), ["no_price", null]);
		assert.deepEqual(state(money([payment()], quote(), "cancelled"), "cancelled"), [
			"closed",
			"NPR 3,000",
		]);
		const hourly = card(
			money([], quote({ kind: "hourly", fixedPrice: null, hourlyRate: 300_000, estimatedMinutes: 300 })),
			"booked",
		);
		assert.deepEqual(
			[hourly.balance.totalText, hourly.balance.totalNote],
			["NPR 15,000", "estimated: 5 h at NPR 3,000/hour"],
		);
	});

	test("the deposit line: received, covered, and lapsed after a reversal on a booked project", ({
		assert,
	}) => {
		const deposit = payment({ amount: 100_000 });
		assert.deepEqual(card(money([deposit]), "deposit_pending").deposit, {
			amountText: "NPR 3,000",
			receivedText: "NPR 1,000",
			dueText: "NPR 2,000",
			covered: false,
			lapsed: false,
		});
		assert.isTrue(card(money([payment()]), "booked").deposit?.covered);
		const full = payment();
		const reversed = money([
			payment({ kind: "correction", amount: -300_000, correctsPaymentId: full.id }),
			full,
		]);
		assert.isTrue(card(reversed, "booked").deposit?.lapsed);
		assert.isNull(card(money([], quote({ depositAmount: 0 })), "booked").deposit);
	});

	test("an owner's actions follow the status; an artist gets none, no screenshots and no outcome form", ({
		assert,
	}) => {
		const waitingDeposit = card(money([], quote(), "deposit_pending"), "deposit_pending");
		assert.deepEqual(waitingDeposit.actions, {
			recordKinds: ["deposit", "session", "balance"],
			depositDue: 3000,
			balanceDue: 15000,
			refundMax: null,
			refundMaxText: null,
		});
		assert.deepEqual(card(money([payment()]), "booked").actions?.recordKinds, [
			"session",
			"balance",
		]);
		assert.deepEqual(card(money([payment()]), "booked").actions?.refundMax, 3000);
		assert.deepEqual(card(money([], quote(), "declined"), "declined").actions?.recordKinds, []);

		const closed = money([payment()], quote(), "cancelled");
		const owner = card(closed, "cancelled");
		assert.deepEqual(owner.outcome.needed, { held: 3000, heldText: "NPR 3,000" });
		assert.isNull(owner.actions?.refundMax ?? null, "the outcome comes first");

		const shot = payment({ proofImageKey: "k", proofImageWidth: 1, proofImageHeight: 1 });
		const artist = card(money([shot], quote(), "cancelled"), "cancelled", false, new Map([[shot.id, "u"]]));
		assert.isNull(artist.actions);
		assert.deepEqual(artist.pending, []);
		assert.isNull(artist.outcome.needed);
		assert.deepInclude(artist.rows[0], { proofUrl: null, canReverse: false });
	});

	test("a recorded outcome reads as what the studio decided", ({ assert }) => {
		const refund = payment({ kind: "refund", amount: -200_000 });
		const outcome = {
			outcome: "refunded",
			amount: 300_000,
			refundPaymentId: refund.id,
			recordedByUserId: ASHA,
			createdAt: AT,
			note: "Half back",
		} as unknown as DepositOutcome;
		const props = card(money([refund, payment()], quote(), "cancelled", outcome), "cancelled");

		assert.deepEqual(props.outcome.recorded, {
			text: "Deposit refunded: NPR 2,000 of NPR 3,000 back to the client.",
			recordedText: "Recorded 18 Oct 2026 by Asha Rai",
			note: "Half back",
		});
		const kept = { ...outcome, outcome: "kept", refundPaymentId: null } as unknown as DepositOutcome;
		assert.equal(
			card(money([payment()], quote(), "cancelled", kept), "cancelled").outcome.recorded?.text,
			"Deposit kept by the studio: NPR 3,000.",
		);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=payments_card.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 with "Cannot find module" for `#modules/payments/payments_card`.

- [ ] **Step 3: The builder**

Create `apps/platform/app/modules/payments/payments_card.ts`:

```ts
import type { DateTime } from "luxon";
import { formatSignedMoney } from "#modules/payments/ledger";
import type DepositOutcome from "#modules/payments/models/deposit_outcome";
import type Payment from "#modules/payments/models/payment";
import type {
	DeskKind,
	PaymentKind,
	PaymentStatus,
} from "#modules/payments/models/payment";
import type { PaymentMethodKind } from "#modules/payments/models/payment_method";
import {
	CLOSED_FOR_OUTCOME,
	type ProjectMoney,
} from "#modules/payments/services/payment_service";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import {
	BOOKED_STATUSES,
	formatDay,
	formatHours,
	formatMoney,
} from "#modules/projects/quotes";

export type PaymentRowProps = {
	id: string;
	kind: PaymentKind;
	amountText: string;
	method: PaymentMethodKind;
	status: PaymentStatus;
	dateText: string;
	decisionText: string;
	note: string | null;
	reversalText: string | null;
	proofUrl: string | null;
	canReverse: boolean;
};

export type PendingProofProps = {
	paymentId: string;
	imageUrl: string | null;
	width: number | null;
	height: number | null;
	expectedText: string;
	referenceCode: string | null;
	method: PaymentMethodKind;
	sentText: string;
	dueNowText: string | null;
};

export type BalanceState = "due" | "paid" | "overpaid" | "no_price" | "closed";

export type PaymentsCardProps = {
	balance: {
		totalText: string | null;
		totalNote: string | null;
		paidText: string;
		state: BalanceState;
		amountText: string | null;
	};
	deposit: {
		amountText: string;
		receivedText: string;
		dueText: string;
		covered: boolean;
		lapsed: boolean;
	} | null;
	rows: PaymentRowProps[];
	pending: PendingProofProps[];
	actions: {
		recordKinds: DeskKind[];
		depositDue: number | null;
		balanceDue: number | null;
		refundMax: number | null;
		refundMaxText: string | null;
	} | null;
	outcome: {
		needed: { held: number; heldText: string } | null;
		recorded: { text: string; recordedText: string; note: string | null } | null;
	};
};

export type PaymentsCardInput = {
	money: ProjectMoney;
	status: ProjectStatus;
	isOwner: boolean;
	timezone: string;
	/** Who decided or recorded, by user id (PaymentService.memberNames). */
	names: Map<string, string>;
	/** Owners only: signed screenshot URLs by payment id. */
	proofUrls: Map<string, string>;
	/** The project's deposit-link reference code, if it has a link. */
	referenceCode: string | null;
};

/** How a kind reads inside a sentence. */
const KIND_WORDS: Record<PaymentKind, string> = {
	deposit: "deposit",
	session: "session payment",
	balance: "balance payment",
	refund: "refund",
	correction: "reversal",
};

/** The desk form's cap, in paisa: a balance due above it isn't prefilled. */
const MAX_PREFILL = 1_000_000_000n;

/**
 * The project page's Payments card (TAT-66), from the project's money.
 * Owners get the screenshots to check, the signed screenshot links, the
 * Reverse buttons, the forms' limits and the outcome form; an artist on
 * the project gets the balance and the list only. Dates are the studio's.
 */
export function paymentsCard({
	money,
	status,
	isOwner,
	timezone,
	names,
	proofUrls,
	referenceCode,
}: PaymentsCardInput): PaymentsCardProps {
	const day = (at: DateTime) =>
		formatDay(at.setZone(timezone).toFormat("yyyy-MM-dd"));
	const who = (id: string | null) =>
		(id !== null && names.get(id)) || "a deleted account";
	const byId = new Map(money.payments.map((payment) => [payment.id, payment]));
	const reversals = new Map(
		money.payments
			.filter(({ correctsPaymentId }) => correctsPaymentId !== null)
			.map((payment) => [payment.correctsPaymentId as string, payment]),
	);
	const { quote, balance } = money;

	const rows = money.payments.map((payment): PaymentRowProps => {
		const reversal = reversals.get(payment.id);
		const original = payment.correctsPaymentId
			? byId.get(payment.correctsPaymentId)
			: undefined;
		return {
			id: payment.id,
			kind: payment.kind,
			amountText: formatSignedMoney(payment.amount),
			method: payment.method,
			status: payment.status,
			dateText: day(payment.createdAt),
			decisionText: decisionText(payment, who, day),
			note: payment.note,
			reversalText: original
				? `Reverses the ${formatMoney(Math.abs(original.amount))} ${KIND_WORDS[original.kind]} of ${day(original.createdAt)}`
				: reversal
					? `Reversed ${day(reversal.createdAt)}`
					: null,
			proofUrl:
				isOwner && payment.status !== "submitted"
					? (proofUrls.get(payment.id) ?? null)
					: null,
			canReverse:
				isOwner &&
				payment.status === "verified" &&
				payment.kind !== "correction" &&
				reversal === undefined,
		};
	});

	const pending = isOwner
		? money.payments
				.filter(({ status: state }) => state === "submitted")
				.map(
					(payment): PendingProofProps => ({
						paymentId: payment.id,
						imageUrl: proofUrls.get(payment.id) ?? null,
						width: payment.proofImageWidth,
						height: payment.proofImageHeight,
						expectedText: formatMoney(payment.amount),
						referenceCode,
						method: payment.method,
						sentText: `${day(payment.createdAt)}, ${payment.createdAt.setZone(timezone).toFormat("HH:mm")}`,
						dueNowText:
							payment.kind === "deposit" && money.depositDue !== payment.amount
								? formatMoney(money.depositDue)
								: null,
					}),
				)
		: [];

	const closed = CLOSED_FOR_OUTCOME.includes(status);
	const due = balance.due;
	const state: BalanceState = closed
		? "closed"
		: due === null
			? "no_price"
			: due > 0n
				? "due"
				: due < 0n
					? "overpaid"
					: "paid";
	const amountText =
		state === "closed"
			? formatSignedMoney(balance.paid)
			: state === "due" && due !== null
				? formatMoney(due)
				: state === "overpaid" && due !== null
					? formatMoney(-due)
					: null;

	const refundable = !money.outcomeNeeded && balance.paid > 0n;
	return {
		balance: {
			totalText: balance.total === null ? null : formatMoney(balance.total),
			totalNote:
				quote?.kind === "hourly"
					? `estimated: ${formatHours(quote.estimatedMinutes ?? 0)} h at ${formatMoney(quote.hourlyRate ?? 0)}/hour`
					: null,
			paidText: formatSignedMoney(balance.paid),
			state,
			amountText,
		},
		deposit:
			quote && quote.depositAmount > 0
				? {
						amountText: formatMoney(quote.depositAmount),
						receivedText: formatSignedMoney(money.depositHeld),
						dueText: formatMoney(money.depositDue),
						covered: money.depositDue === 0,
						lapsed: money.depositDue > 0 && BOOKED_STATUSES.includes(status),
					}
				: null,
		rows,
		pending,
		actions: isOwner
			? {
					recordKinds:
						status === "declined"
							? []
							: status === "deposit_pending"
								? ["deposit", "session", "balance"]
								: ["session", "balance"],
					depositDue:
						status === "deposit_pending" && money.depositDue > 0
							? money.depositDue / 100
							: null,
					balanceDue:
						due !== null && due > 0n && due <= MAX_PREFILL
							? Number(due) / 100
							: null,
					refundMax: refundable ? Number(balance.paid) / 100 : null,
					refundMaxText: refundable ? formatMoney(balance.paid) : null,
				}
			: null,
		outcome: {
			needed:
				isOwner && money.outcomeNeeded
					? {
							held: money.depositHeld / 100,
							heldText: formatMoney(money.depositHeld),
						}
					: null,
			recorded: money.outcome
				? {
						text: outcomeText(money.outcome, byId),
						recordedText: `Recorded ${day(money.outcome.createdAt)} by ${who(money.outcome.recordedByUserId)}`,
						note: money.outcome.note,
					}
				: null,
		},
	};
}

/**
 * Who decided a payment, and when. A verified payment without a screenshot
 * was entered at the desk: "Recorded by".
 */
function decisionText(
	payment: Payment,
	who: (id: string | null) => string,
	day: (at: DateTime) => string,
): string {
	if (payment.status === "submitted") return "Waiting for an owner";
	const at = day(payment.verifiedAt ?? payment.createdAt);
	const by = who(payment.verifiedByUserId);
	if (payment.status === "rejected") return `Rejected by ${by}, ${at}`;
	return payment.proofImageKey
		? `Verified by ${by}, ${at}`
		: `Recorded by ${by}, ${at}`;
}

/** What the studio decided about the deposit, in a sentence. */
function outcomeText(
	outcome: DepositOutcome,
	byId: Map<string, Payment>,
): string {
	const held = formatMoney(outcome.amount);
	if (outcome.outcome === "kept") return `Deposit kept by the studio: ${held}.`;
	if (outcome.outcome === "moved") return `Deposit moved to a new date: ${held}.`;
	const refund = outcome.refundPaymentId
		? byId.get(outcome.refundPaymentId)
		: undefined;
	return `Deposit refunded: ${formatMoney(Math.abs(refund?.amount ?? 0))} of ${held} back to the client.`;
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=payments_card.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing page tests**

Create `apps/platform/tests/functional/payments/project_payments_card.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { depositReady } from "#tests/helpers/deposits";
import { ownerMember, paymentServices, proofFor } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "pay-card-66";
const page = (id: string) => `/t/${SLUG}/projects/${id}`;
const { links } = paymentServices();

test.group("The Payments card on the project page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the screenshot with its signed URL, the amount asked and the reference code", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, ownerMember(owner), project),
		);
		const proof = await inTenant(tenant, () => proofFor(tenant, project));

		const props = (await client.get(page(project.id)).withInertia().loginAs(owner))
			.inertiaProps;

		const [pending] = props.payments.pending;
		assert.equal(pending.paymentId, proof.id);
		assert.equal(pending.expectedText, "NPR 3,000");
		assert.equal(pending.referenceCode, link.referenceCode);
		assert.include(pending.imageUrl, `/files/${proof.proofImageKey}?`);
		assert.include(pending.imageUrl, "signature=");
		assert.deepEqual(props.payments.actions.recordKinds, ["deposit", "session", "balance"]);
	});

	test("the assigned artist's card has the list and balance, no screenshots and no actions", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG, "Black Needle");
		const asha = await artistIn(tenant, `asha@${SLUG}.example`);
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const { project: made } = await depositReady(tenant);
			made.artistId = profile.id;
			await made.save();
			await proofFor(tenant, made);
			await proofFor(tenant, made, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return made;
		});

		const response = await client.get(page(project.id)).withInertia().loginAs(asha);

		response.assertStatus(200);
		const card = response.inertiaProps.payments;
		assert.lengthOf(card.rows, 2);
		assert.deepEqual(card.pending, []);
		assert.isNull(card.actions);
		assert.isNull(card.outcome.needed);
		assert.notInclude(JSON.stringify(card), "signature=");
		assert.equal(card.balance.state, "due");
	});

	test("the projects list flags, for owners, a screenshot to check and a deposit to settle", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const artist = await artistIn(tenant, `artist@${SLUG}.example`);
		const { waiting, closed } = await inTenant(tenant, async () => {
			const { project: pending } = await depositReady(tenant);
			await proofFor(tenant, pending);
			// The artist is assigned to it, so their list has the row too.
			const profile = await makeArtist(tenant, "asha");
			profile.userId = artist.id;
			await profile.save();
			pending.artistId = profile.id;
			await pending.save();
			const cancelled = await makeProject(tenant, await makeClient(tenant), {
				status: "cancelled",
			});
			await makeQuote(tenant, cancelled);
			await makePayment(tenant, cancelled, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return { waiting: pending, closed: cancelled };
		});
		const rows = async (status: string, user = owner) =>
			(
				await client
					.get(`/t/${SLUG}/projects?status=${status}`)
					.withInertia()
					.loginAs(user)
			).inertiaProps.projects;

		const active = await rows("active");
		assert.deepInclude(
			active.find(({ id }: { id: string }) => id === waiting.id),
			{ proofWaiting: true, depositToSettle: false },
		);
		const closedRows = await rows("closed");
		assert.deepInclude(
			closedRows.find(({ id }: { id: string }) => id === closed.id),
			{ proofWaiting: false, depositToSettle: true },
		);
		const artistRows = await rows("active", artist);
		assert.deepInclude(
			artistRows.find(({ id }: { id: string }) => id === waiting.id),
			{ proofWaiting: false, depositToSettle: false },
		);
	});
});
```

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=project_payments_card.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL (`payments` and the row flags are undefined).

- [ ] **Step 6: The controller and the client types**

In `apps/platform/app/controllers/projects_controller.ts`:
- Add the imports `import { paymentsCard } from "#modules/payments/payments_card";` and, with the biome-ignore comment, `import PaymentService from "#modules/payments/services/payment_service";`.
- Add `private payments: PaymentService,` to the constructor (after TAT-65's `private deposits: DepositService,`).
- In `index`, after `const withSession = …;`, add:

```ts
		// Owners' flags: a screenshot to check, a closed project's deposit to
		// settle (TAT-66). The Projects badge counts the first.
		const flags =
			membership.role === "owner"
				? await this.payments.listFlags(tenant, projects)
				: new Map<string, { proofWaiting: boolean; depositToSettle: boolean }>();
```

and in the row object, after `noSession: …,`:

```ts
					proofWaiting: flags.get(project.id)?.proofWaiting ?? false,
					depositToSettle: flags.get(project.id)?.depositToSettle ?? false,
```

- In `show`, before `return ctx.inertia.render(…)`, add:

```ts
		// The Payments card (TAT-66). Screenshot URLs are signed for owners
		// only, after the tenant-scoped project and payment reads.
		const money = await this.payments.forProject(tenant, project);
		const isOwner = membership.role === "owner";
		const proofUrls = new Map<string, string>();
		if (isOwner) {
			for (const payment of money.payments) {
				if (payment.proofImageKey) {
					proofUrls.set(
						payment.id,
						await this.images.url("payment_proof", payment.proofImageKey, tenant),
					);
				}
			}
		}
		const names = await this.payments.memberNames([
			...money.payments.map(({ verifiedByUserId }) => verifiedByUserId),
			money.outcome?.recordedByUserId ?? null,
		]);
		const depositLink = isOwner
			? await this.depositLinks.forProject(tenant, project)
			: null;
```

and in the props object, after TAT-65's `deposit:` entry:

```ts
			payments: paymentsCard({
				money,
				status: project.status,
				isOwner,
				timezone,
				names,
				proofUrls,
				referenceCode: depositLink?.referenceCode ?? null,
			}),
```

Create `apps/platform/inertia/components/payments.ts` with the props block above (copy `PaymentRowProps`, `PendingProofProps`, `BalanceState` and `PaymentsCardProps` verbatim, each `export`ed) and:

```ts
export type MethodKind = PaymentRowProps["method"];
export type DeskKindName = "deposit" | "session" | "balance";

/** The order methods are offered in. */
export const METHODS: MethodKind[] = ["cash", "bank", "fonepay", "esewa", "khalti"];

export const METHOD_LABELS: Record<MethodKind, string> = {
	cash: "Cash",
	bank: "Bank transfer",
	fonepay: "Fonepay",
	esewa: "eSewa",
	khalti: "Khalti",
};

export const KIND_LABELS: Record<PaymentRowProps["kind"], string> = {
	deposit: "Deposit",
	session: "Session payment",
	balance: "Balance",
	refund: "Refund",
	correction: "Reversal",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentRowProps["status"], string> = {
	submitted: "Waiting",
	verified: "Verified",
	rejected: "Rejected",
};

/** What Record payment says about each kind. */
export const DESK_KIND_TEXT: Record<DeskKindName, { title: string; description: string | null }> = {
	deposit: { title: "Deposit", description: null },
	session: {
		title: "Session payment",
		description: "Paid at a session, before the work is finished.",
	},
	balance: { title: "Balance", description: "The rest of the price." },
};
```

In `apps/platform/inertia/components/projects.ts`:
- Add `import type { PaymentsCardProps } from "~/components/payments";`.
- In `ProjectPageProps`, after TAT-65's `deposit` entry, add:

```ts
	/** The Payments card (TAT-66): owners get the screenshots and the forms, the assigned artist the list. */
	payments: PaymentsCardProps;
```

- In `ProjectRow`, after `noSession: boolean;`, add:

```ts
	/** Owners: a deposit screenshot waits for a decision. */
	proofWaiting: boolean;
	/** Owners: a closed project holds deposit money with no outcome recorded. */
	depositToSettle: boolean;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=project_payments_card.spec.ts --files=project_page.spec.ts --files=projects_list.spec.ts --files=deposit_links_http.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors (`ctx.inertia.render` checks the props against the page types).

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/inertia/components apps/platform/tests
git -C <repo> commit -m "feat(platform): build the Payments card's props and the list's payment flags

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 15: The Payments card on screen (edits TAT-65 code)

**Files:**
- Create: `apps/platform/inertia/components/payments_card.tsx`
- Modify: `apps/platform/inertia/pages/projects/show.tsx` (TAT-65's `DepositCard` line), `apps/platform/inertia/pages/projects/index.tsx`

**Interfaces:**
- Consumes: Task 14's props (`payments`, `ProjectRow.proofWaiting`, `depositToSettle`) and labels in `~/components/payments`; routes `tenant.payments.verify`, `tenant.payments.reject`, `tenant.payments.reverse`, `tenant.projects.payments.store`, `tenant.projects.refunds.store`, `tenant.projects.deposit_outcome.store`; `formatRupees`; shadcn `Card`, `Field*`, `RadioGroup`, `Textarea`, `Input`, `Button`, `Badge`.
- Produces: `PaymentsCard({ projectId, payments, canSetPrice })` (default export of `~/components/payments_card`).

There is no component test suite (TAT-11); the deliverable is checked by `pnpm typecheck`, `pnpm build` and the browser pass in the PR text. Read `apps/platform/docs/ui.md` first: 44 px targets (`h-11`), "Saving…" while in flight, no optimistic UI for money.

- [ ] **Step 1: The card**

Create `apps/platform/inertia/components/payments_card.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	DESK_KIND_TEXT,
	type DeskKindName,
	KIND_LABELS,
	METHOD_LABELS,
	METHODS,
	type MethodKind,
	PAYMENT_STATUS_LABELS,
	type PaymentRowProps,
	type PaymentsCardProps,
	type PendingProofProps,
} from "~/components/payments";
import { formatRupees } from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";

type Actions = NonNullable<PaymentsCardProps["actions"]>;

/**
 * The project's money (TAT-66): what happened to a closed project's
 * deposit, the balance, the screenshots to check, every payment, and the
 * owners' forms. After every successful submit focus moves to the card's
 * heading, so a screen reader lands on the updated card.
 */
export default function PaymentsCard({
	projectId,
	payments,
	canSetPrice,
}: {
	projectId: string;
	payments: PaymentsCardProps;
	canSetPrice: boolean;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const done = () => heading.current?.focus();
	const { balance, deposit, rows, pending, actions, outcome } = payments;

	return (
		<Card id="payments">
			<CardHeader>
				<CardTitle>
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Payments
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				{outcome.needed && (
					<OutcomeForm
						projectId={projectId}
						needed={outcome.needed}
						onDone={done}
					/>
				)}
				{outcome.recorded && (
					<div className="flex flex-col gap-1 text-sm">
						<p>{outcome.recorded.text}</p>
						<p className="text-muted-foreground">
							{outcome.recorded.recordedText}.
						</p>
						{outcome.recorded.note && (
							<p className="whitespace-pre-line text-muted-foreground">
								{outcome.recorded.note}
							</p>
						)}
					</div>
				)}
				<BalanceBlock
					balance={balance}
					deposit={deposit}
					canSetPrice={canSetPrice}
				/>
				{pending.length > 0 && (
					<section
						aria-labelledby="proofs-heading"
						className="flex flex-col gap-4"
					>
						<h3 id="proofs-heading" className="text-sm font-semibold">
							Screenshots to check
						</h3>
						{pending.map((proof) => (
							<PendingProof key={proof.paymentId} proof={proof} onDone={done} />
						))}
					</section>
				)}
				<PaymentList rows={rows} onDone={done} />
				{actions && actions.recordKinds.length > 0 && (
					<RecordPaymentForm
						projectId={projectId}
						actions={actions}
						onDone={done}
					/>
				)}
				{actions?.refundMax != null && actions.refundMaxText && (
					<RefundForm
						projectId={projectId}
						maxText={actions.refundMaxText}
						onDone={done}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function BalanceBlock({
	balance,
	deposit,
	canSetPrice,
}: Pick<PaymentsCardProps, "balance" | "deposit"> & { canSetPrice: boolean }) {
	const line = {
		due: `Balance due ${balance.amountText}`,
		paid: "Paid in full",
		overpaid: `Overpaid by ${balance.amountText}: record a refund if you give it back.`,
		no_price: canSetPrice ? "No price yet. Set it in the Quote card." : "No price yet.",
		closed: `Holds ${balance.amountText}`,
	}[balance.state];
	const total = balance.totalText
		? balance.totalNote
			? `${balance.totalText}, ${balance.totalNote}`
			: balance.totalText
		: "Not set";

	return (
		<div className="flex flex-col gap-2 text-sm">
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
				<dt className="text-muted-foreground">Total</dt>
				<dd className="min-w-0 break-words">{total}</dd>
				<dt className="text-muted-foreground">Paid</dt>
				<dd>{balance.paidText}</dd>
			</dl>
			<p className="text-base font-semibold">{line}</p>
			{deposit &&
				(deposit.lapsed ? (
					<p className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
						The deposit is no longer covered: {deposit.dueText} still due.
					</p>
				) : (
					<p className="text-muted-foreground">
						{deposit.covered
							? `Deposit covered (${deposit.amountText})`
							: `Deposit: ${deposit.receivedText} of ${deposit.amountText} received`}
					</p>
				))}
		</div>
	);
}

/**
 * One screenshot to check: the image next to what the deposit page asked
 * for and the reference code (side by side from 640 px, stacked below),
 * then Verify and Reject, each confirmed in an inline panel.
 */
function PendingProof({
	proof,
	onDone,
}: {
	proof: PendingProofProps;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const [open, setOpen] = useState<"verify" | "reject" | null>(null);
	const verifyButton = useRef<HTMLButtonElement>(null);
	const rejectButton = useRef<HTMLButtonElement>(null);
	const params = { tenant: tenant.slug, id: proof.paymentId };
	const close = () => {
		const back = open === "reject" ? rejectButton : verifyButton;
		setOpen(null);
		back.current?.focus();
	};

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3">
			<div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,20rem)_1fr] sm:gap-4">
				{proof.imageUrl ? (
					<a
						href={proof.imageUrl}
						target="_blank"
						rel="noreferrer"
						className="flex flex-col gap-1 text-sm underline-offset-4 hover:underline"
					>
						<img
							src={proof.imageUrl}
							alt={`Payment screenshot sent ${proof.sentText}`}
							width={proof.width ?? undefined}
							height={proof.height ?? undefined}
							className="max-h-96 w-full rounded-md border object-contain"
						/>
						<span>Open full size</span>
					</a>
				) : (
					<p className="text-sm text-muted-foreground">No screenshot.</p>
				)}
				<dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-2 text-sm">
					<dt className="text-muted-foreground">Asked to pay</dt>
					<dd className="text-lg font-semibold">{proof.expectedText}</dd>
					<dt className="text-muted-foreground">Reference code</dt>
					<dd className="font-mono text-lg tracking-widest">
						{proof.referenceCode ?? "No deposit link"}
					</dd>
					<dt className="text-muted-foreground">Paid with</dt>
					<dd>{METHOD_LABELS[proof.method]}</dd>
					<dt className="text-muted-foreground">Sent</dt>
					<dd>{proof.sentText}</dd>
				</dl>
			</div>
			{proof.dueNowText && (
				<p className="text-sm">
					The deposit due is now {proof.dueNowText}: the quote changed after
					this was sent.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					ref={verifyButton}
					type="button"
					className="h-11"
					aria-expanded={open === "verify"}
					onClick={() => setOpen("verify")}
				>
					Verify
				</Button>
				<Button
					ref={rejectButton}
					type="button"
					variant="outline"
					className="h-11"
					aria-expanded={open === "reject"}
					onClick={() => setOpen("reject")}
				>
					Reject
				</Button>
			</div>
			{open === "verify" && (
				<ConfirmPanel
					action={urlFor("tenant.payments.verify", params)}
					question={`Verify ${proof.expectedText}? Do it only if it reached your account${proof.referenceCode ? ` with code ${proof.referenceCode}` : ""}.`}
					noteLabel="Note (optional, only your team sees it)"
					submitLabel="Verify payment"
					onCancel={close}
					onDone={() => {
						setOpen(null);
						onDone();
					}}
				/>
			)}
			{open === "reject" && (
				<ConfirmPanel
					action={urlFor("tenant.payments.reject", params)}
					question="Reject this screenshot? The client is asked for a new one on the deposit page."
					noteLabel="Reason (optional, only your team sees it)"
					submitLabel="Reject screenshot"
					onCancel={close}
					onDone={() => {
						setOpen(null);
						onDone();
					}}
				/>
			)}
		</div>
	);
}

/**
 * An inline confirmation: the question, an optional note (focused when the
 * panel opens), the confirm button and Cancel. Escape cancels.
 */
function ConfirmPanel({
	action,
	question,
	noteLabel,
	submitLabel,
	onCancel,
	onDone,
}: {
	action: string;
	question: string;
	noteLabel: string;
	submitLabel: string;
	onCancel: () => void;
	onDone: () => void;
}) {
	const id = useId();
	const note = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		note.current?.focus();
	}, []);

	return (
		<Form
			action={action}
			method="post"
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<div
					role="group"
					aria-labelledby={`${id}-question`}
					className="flex flex-col gap-3 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
				>
					<p id={`${id}-question`} className="text-sm">
						{question}
					</p>
					<Field data-invalid={!!errors.note}>
						<FieldLabel htmlFor={`${id}-note`}>{noteLabel}</FieldLabel>
						<Textarea
							ref={note}
							id={`${id}-note`}
							name="note"
							rows={2}
							maxLength={500}
							aria-invalid={!!errors.note}
							aria-describedby={errors.note ? `${id}-note-error` : undefined}
						/>
						{errors.note && (
							<FieldError id={`${id}-note-error`}>{errors.note}</FieldError>
						)}
					</Field>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : submitLabel}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={onCancel}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}
		</Form>
	);
}

function PaymentList({
	rows,
	onDone,
}: {
	rows: PaymentRowProps[];
	onDone: () => void;
}) {
	if (rows.length === 0) {
		return <p className="text-sm text-muted-foreground">No payments yet.</p>;
	}
	return (
		<ul className="flex flex-col divide-y text-sm">
			{rows.map((row) => (
				<PaymentItem key={row.id} row={row} onDone={onDone} />
			))}
		</ul>
	);
}

function PaymentItem({
	row,
	onDone,
}: {
	row: PaymentRowProps;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const [reversing, setReversing] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const unsigned = row.amountText.replace(/^−/, "");

	return (
		<li className="flex flex-col gap-1 py-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium">
					{KIND_LABELS[row.kind]} {row.amountText}
				</span>
				<Badge variant={row.status === "verified" ? "secondary" : "outline"}>
					{PAYMENT_STATUS_LABELS[row.status]}
				</Badge>
			</div>
			<span className="text-muted-foreground">
				{METHOD_LABELS[row.method]} · {row.dateText}
			</span>
			<span className="text-muted-foreground">{row.decisionText}</span>
			{row.reversalText && <span>{row.reversalText}</span>}
			{row.note && <span className="whitespace-pre-line">{row.note}</span>}
			{(row.proofUrl || row.canReverse) && (
				<div className="flex flex-wrap gap-2 pt-1">
					{row.proofUrl && (
						<a
							href={row.proofUrl}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({ variant: "outline", className: "h-11" })}
						>
							View screenshot
						</a>
					)}
					{row.canReverse && (
						<Button
							ref={trigger}
							type="button"
							variant="ghost"
							className="h-11"
							aria-expanded={reversing}
							onClick={() => setReversing(true)}
						>
							Reverse
						</Button>
					)}
				</div>
			)}
			{reversing && (
				<ConfirmPanel
					action={urlFor("tenant.payments.reverse", {
						tenant: tenant.slug,
						id: row.id,
					})}
					question={`Reverse this ${unsigned} ${KIND_LABELS[row.kind].toLowerCase()}? Use it when the money never arrived or the entry was a mistake. The reversal is recorded; nothing is deleted.`}
					noteLabel="Reason (optional)"
					submitLabel="Reverse payment"
					onCancel={() => {
						setReversing(false);
						trigger.current?.focus();
					}}
					onDone={() => {
						setReversing(false);
						onDone();
					}}
				/>
			)}
		</li>
	);
}

/** The amount to prefill for a kind, in rupees, or empty. */
function prefill(actions: Actions, kind: DeskKindName): string {
	const value =
		kind === "deposit"
			? actions.depositDue
			: kind === "balance"
				? actions.balanceDue
				: null;
	return value === null ? "" : String(value);
}

function RecordPaymentForm({
	projectId,
	actions,
	onDone,
}: {
	projectId: string;
	actions: Actions;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const first = actions.recordKinds[0];
	const [kind, setKind] = useState<DeskKindName>(first);
	const [method, setMethod] = useState<MethodKind>("cash");
	const [amount, setAmount] = useState(prefill(actions, first));
	const [typed, setTyped] = useState(false);
	const choose = (value: string) => {
		const next = actions.recordKinds.find((known) => known === value) ?? first;
		setKind(next);
		if (!typed) setAmount(prefill(actions, next));
	};

	return (
		<Form
			route="tenant.projects.payments.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onSuccess={() => {
				setTyped(false);
				onDone();
			}}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<h3 className="text-sm font-semibold">Record payment</h3>
					<FieldSet data-invalid={!!errors.kind}>
						<FieldLegend variant="label">What was paid</FieldLegend>
						<RadioGroup name="kind" value={kind} onValueChange={choose}>
							{actions.recordKinds.map((value) => (
								<FieldLabel key={value} htmlFor={`record-kind-${value}`}>
									<Field orientation="horizontal" className="min-h-11">
										<FieldContent>
											<FieldTitle>{DESK_KIND_TEXT[value].title}</FieldTitle>
											{DESK_KIND_TEXT[value].description && (
												<FieldDescription>
													{DESK_KIND_TEXT[value].description}
												</FieldDescription>
											)}
										</FieldContent>
										<RadioGroupItem value={value} id={`record-kind-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.kind && <FieldError>{errors.kind}</FieldError>}
					</FieldSet>
					<MethodField
						idPrefix="record"
						value={method}
						onChange={setMethod}
						error={errors.method}
					/>
					<AmountField
						id="record-amount"
						value={amount}
						onChange={(value) => {
							setTyped(true);
							setAmount(value);
						}}
						error={errors.amount}
						hint={null}
					/>
					<NoteField id="record-note" error={errors.note} />
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Record payment"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

/** "Record a refund": a button that shows the form; the submit asks first. */
function RefundForm({
	projectId,
	maxText,
	onDone,
}: {
	projectId: string;
	maxText: string;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const [open, setOpen] = useState(false);
	const [method, setMethod] = useState<MethodKind>("cash");
	const [amount, setAmount] = useState("");

	if (!open) {
		return (
			<div>
				<Button
					type="button"
					variant="outline"
					className="h-11"
					aria-expanded={false}
					onClick={() => setOpen(true)}
				>
					Record a refund
				</Button>
			</div>
		);
	}
	return (
		<Form
			route="tenant.projects.refunds.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onBefore={() =>
				window.confirm(
					`Record a refund of ${formatRupees(Number(amount))}? It can't be edited or deleted; a mistake is reversed.`,
				)
			}
			onSuccess={() => {
				setOpen(false);
				setAmount("");
				onDone();
			}}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<h3 className="text-sm font-semibold">Record a refund</h3>
					<AmountField
						id="refund-amount"
						value={amount}
						onChange={setAmount}
						error={errors.amount}
						hint={`At most ${maxText}.`}
					/>
					<MethodField
						idPrefix="refund"
						value={method}
						onChange={setMethod}
						error={errors.method}
					/>
					<NoteField id="refund-note" error={errors.note} />
					<div className="flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Record refund"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

/** What happened to a closed project's deposit: kept, or refunded (amount, method). */
function OutcomeForm({
	projectId,
	needed,
	onDone,
}: {
	projectId: string;
	needed: NonNullable<PaymentsCardProps["outcome"]["needed"]>;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const [outcome, setOutcome] = useState<"kept" | "refunded">("kept");
	const [amount, setAmount] = useState(String(needed.held));
	const [method, setMethod] = useState<MethodKind>("cash");

	return (
		<Form
			route="tenant.projects.deposit_outcome.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<FieldGroup className="rounded-md border p-3">
					<h3 className="text-sm font-semibold">What happened to the deposit?</h3>
					<p className="text-sm">
						This project closed holding a deposit of {needed.heldText}. Record
						what the studio decided; your deposit policy is yours.
					</p>
					<FieldSet data-invalid={!!errors.outcome}>
						<FieldLegend variant="label">Outcome</FieldLegend>
						<RadioGroup
							name="outcome"
							value={outcome}
							onValueChange={(value) =>
								setOutcome(value === "refunded" ? "refunded" : "kept")
							}
						>
							{(
								[
									["kept", "The studio keeps it"],
									["refunded", "Refund it"],
								] as const
							).map(([value, title]) => (
								<FieldLabel key={value} htmlFor={`outcome-${value}`}>
									<Field orientation="horizontal" className="min-h-11">
										<FieldContent>
											<FieldTitle>{title}</FieldTitle>
										</FieldContent>
										<RadioGroupItem value={value} id={`outcome-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.outcome && <FieldError>{errors.outcome}</FieldError>}
					</FieldSet>
					{outcome === "refunded" && (
						<>
							<AmountField
								id="outcome-amount"
								value={amount}
								onChange={setAmount}
								error={errors.amount}
								hint={`At most ${needed.heldText}; the rest is kept.`}
							/>
							<MethodField
								idPrefix="outcome"
								value={method}
								onChange={setMethod}
								error={errors.method}
							/>
						</>
					)}
					<NoteField id="outcome-note" error={errors.note} />
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Record outcome"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

function MethodField({
	idPrefix,
	value,
	onChange,
	error,
}: {
	idPrefix: string;
	value: MethodKind;
	onChange: (method: MethodKind) => void;
	error: string | undefined;
}) {
	return (
		<FieldSet data-invalid={!!error}>
			<FieldLegend variant="label">Method</FieldLegend>
			<RadioGroup
				name="method"
				value={value}
				onValueChange={(next) =>
					onChange(METHODS.find((known) => known === next) ?? "cash")
				}
				className="grid grid-cols-2 gap-2 sm:grid-cols-3"
			>
				{METHODS.map((method) => (
					<FieldLabel key={method} htmlFor={`${idPrefix}-method-${method}`}>
						<Field orientation="horizontal" className="min-h-11">
							<FieldContent>
								<FieldTitle>{METHOD_LABELS[method]}</FieldTitle>
							</FieldContent>
							<RadioGroupItem value={method} id={`${idPrefix}-method-${method}`} />
						</Field>
					</FieldLabel>
				))}
			</RadioGroup>
			{error && <FieldError>{error}</FieldError>}
		</FieldSet>
	);
}

function AmountField({
	id,
	value,
	onChange,
	error,
	hint,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	error: string | undefined;
	hint: string | null;
}) {
	const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
		.filter(Boolean)
		.join(" ");
	return (
		<Field data-invalid={!!error}>
			<FieldLabel htmlFor={id}>Amount (NPR)</FieldLabel>
			<Input
				id={id}
				name="amount"
				type="number"
				inputMode="decimal"
				min={0.01}
				step={0.01}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={!!error}
				aria-describedby={described || undefined}
				className="h-11"
			/>
			{hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
			{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
		</Field>
	);
}

function NoteField({ id, error }: { id: string; error: string | undefined }) {
	return (
		<Field data-invalid={!!error}>
			<FieldLabel htmlFor={id}>Note (optional)</FieldLabel>
			<Textarea
				id={id}
				name="note"
				rows={2}
				maxLength={500}
				aria-invalid={!!error}
				aria-describedby={error ? `${id}-error` : undefined}
			/>
			{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
		</Field>
	);
}
```

If `FieldGroup` doesn't take a `className`, wrap `OutcomeForm`'s content in a `<div className="flex flex-col gap-4 rounded-md border p-3">` instead. If the Adonis `Form`'s `errors` type has no key for a field (the action-mode forms have an untyped body), `errors.note` is still `string | undefined` at runtime: keep the code and, only if `pnpm typecheck` complains, give `ConfirmPanel`'s `Form` the generic `<Form<{ note?: string }> …>`.

- [ ] **Step 2: The project page**

In `apps/platform/inertia/pages/projects/show.tsx`:
- Add `import PaymentsCard from "~/components/payments_card";`.
- Add `payments,` to `ProjectShow`'s destructured props.
- After TAT-65's `{deposit && (<DepositCard … />)}` block (after the Quote card), add:

```tsx
				<PaymentsCard
					projectId={project.id}
					payments={payments}
					canSetPrice={canSetPrice}
				/>
```

- In the status card, after the `MoveButtons` block, add:

```tsx
						{payments.outcome.needed && (
							<p className="text-sm">
								<a href="#payments" className="underline underline-offset-4">
									Record what happened to the deposit under Payments.
								</a>
							</p>
						)}
```

- In TAT-65's `DepositCard`, replace the line `Payment screenshot received {proofReceivedText}.` with:

```tsx
							Payment screenshot received {proofReceivedText}:{" "}
							<a href="#payments" className="underline underline-offset-4">
								check it under Payments
							</a>
							.
```

In `apps/platform/inertia/pages/projects/index.tsx`, in the row's badge group, before `{project.noSession && (`, add:

```tsx
										{project.proofWaiting && (
											<Badge>screenshot to check</Badge>
										)}
										{project.depositToSettle && (
											<Badge variant="outline">deposit to settle</Badge>
										)}
```

- [ ] **Step 3: Check it**

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

Run: `pnpm -C <repo> check`
Expected: no errors (Biome may reorder imports: re-read before editing again).

Run: `pnpm -C <repo>/apps/platform build`
Expected: the build succeeds.

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts --files=project_payments_card.spec.ts --files=projects_list.spec.ts`
Expected: PASS (nothing server-side changed).

- [ ] **Step 4: Commit**

```bash
git -C <repo> add apps/platform/inertia
git -C <repo> commit -m "feat(platform): show the Payments card on the project page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Payments on the client profile

**Files:**
- Modify: `apps/platform/app/controllers/clients_controller.ts`, `apps/platform/inertia/components/clients.ts`, `apps/platform/inertia/pages/clients/show.tsx`
- Test: `apps/platform/tests/functional/clients/client_payments.spec.ts` (create)

**Interfaces:**
- Consumes: Task 12's `forProjects`, `balancesFor`; Task 9's `CLOSED_FOR_OUTCOME`; Task 3's `formatSignedMoney`; `KIND_LABELS`, `PAYMENT_STATUS_LABELS` from `~/components/payments`.
- Produces: client page prop `payments: { balanceDueText: string | null; rows: { id: string; projectId: string; projectBrief: string; kind: PaymentRowProps["kind"]; amountText: string; status: PaymentRowProps["status"]; dateText: string }[] }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/clients/client_payments.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "client-pay-66";
const verified = () => ({ status: "verified" as const, verifiedAt: DateTime.utc() });

test.group("Payments on the client profile", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the client's payments newest first and the balance due of their open projects", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { sita, booked, deposit, refund } = await inTenant(tenant, async () => {
			const sita = await makeClient(tenant, { name: "Sita Rai" });
			const booked = await makeProject(tenant, sita, { status: "booked" });
			await makeQuote(tenant, booked);
			const deposit = await makePayment(tenant, booked, verified());
			// A cancelled project's balance is not owed; its refund is listed.
			const cancelled = await makeProject(tenant, sita, { status: "cancelled" });
			await makeQuote(tenant, cancelled);
			const refund = await makePayment(tenant, cancelled, {
				kind: "refund",
				amount: -100_000,
				...verified(),
			});
			// Another client's payment never shows here.
			const ram = await makeClient(tenant, { name: "Ram" });
			const theirs = await makeProject(tenant, ram, { status: "booked" });
			await makePayment(tenant, theirs, verified());
			return { sita, booked, deposit, refund };
		});

		const props = (
			await client.get(`/t/${SLUG}/clients/${sita.id}`).withInertia().loginAs(owner)
		).inertiaProps;

		assert.equal(props.payments.balanceDueText, "NPR 12,000");
		assert.deepEqual(
			props.payments.rows.map(({ id }: { id: string }) => id),
			[refund.id, deposit.id],
		);
		assert.deepInclude(props.payments.rows[1], {
			projectId: booked.id,
			projectBrief: "A small fine-line moth on the forearm",
			kind: "deposit",
			amountText: "NPR 3,000",
			status: "verified",
		});
		assert.equal(props.payments.rows[0].amountText, "−NPR 1,000");
	});

	test("nothing due and no payments read as such", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const quiet = await inTenant(tenant, () => makeClient(tenant));

		const props = (
			await client.get(`/t/${SLUG}/clients/${quiet.id}`).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(props.payments, { balanceDueText: null, rows: [] });
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=client_payments.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL (`props.payments` is undefined).

- [ ] **Step 3: The controller, the types and the page**

In `apps/platform/app/controllers/clients_controller.ts`:
- Add the imports `import { formatSignedMoney } from "#modules/payments/ledger";`, `import { formatMoney } from "#modules/projects/quotes";` (merge with the existing `formatDay` import), and with the biome-ignore comment `import PaymentService, { CLOSED_FOR_OUTCOME } from "#modules/payments/services/payment_service";`.
- Add `private payments: PaymentService,` to the constructor.
- Update the class comment's last sentence to: "The history comes from the projects, inquiries and payments services; this controller reads no table itself."
- In `show`, after the `artistName` map, add:

```ts
		// Payments (TAT-66), through PaymentService: the clients module reads
		// no payments itself. The balance due counts open projects only.
		const paid = await this.payments.forProjects(
			tenant,
			projects.map(({ id }) => id),
		);
		const balances = await this.payments.balancesFor(tenant, projects);
		const owed = projects
			.filter(({ status }) => !CLOSED_FOR_OUTCOME.includes(status))
			.reduce((sum, { id }) => {
				const balance = balances.get(id);
				return balance?.due && balance.due > 0n && balance.currency === "NPR"
					? sum + balance.due
					: sum;
			}, 0n);
		const briefs = new Map(projects.map(({ id, brief }) => [id, brief]));
```

and in the props, after `references: …,`:

```ts
			payments: {
				balanceDueText: owed > 0n ? formatMoney(owed) : null,
				rows: paid.map((payment) => ({
					id: payment.id,
					projectId: payment.projectId,
					projectBrief: briefs.get(payment.projectId) ?? "",
					kind: payment.kind,
					amountText: formatSignedMoney(payment.amount),
					status: payment.status,
					dateText: day(payment.createdAt),
				})),
			},
```

In `apps/platform/inertia/components/clients.ts`, add `import type { PaymentRowProps } from "~/components/payments";` and, in `ClientPageProps` after `references`:

```ts
	/** Payments on the client's projects, newest first, and what their open projects still owe (TAT-66). */
	payments: {
		balanceDueText: string | null;
		rows: {
			id: string;
			projectId: string;
			projectBrief: string;
			kind: PaymentRowProps["kind"];
			amountText: string;
			status: PaymentRowProps["status"];
			dateText: string;
		}[];
	};
```

In `apps/platform/inertia/pages/clients/show.tsx`:
- Add `import { KIND_LABELS, PAYMENT_STATUS_LABELS } from "~/components/payments";` and `payments,` to the destructured props.
- After the Projects card, add:

```tsx
				<Card>
					<CardHeader>
						<CardTitle>Payments</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p className="text-base font-semibold">
							{payments.balanceDueText
								? `Balance due ${payments.balanceDueText}`
								: "Nothing due"}
						</p>
						{payments.rows.length === 0 ? (
							<p className="text-sm text-muted-foreground">No payments yet.</p>
						) : (
							<ul className="flex flex-col divide-y text-sm">
								{payments.rows.map((row) => (
									<li key={row.id} className="flex flex-col gap-1 py-2">
										<span className="flex flex-wrap items-center justify-between gap-2">
											<span className="font-medium">
												{KIND_LABELS[row.kind]} {row.amountText}
											</span>
											<Badge
												variant={row.status === "verified" ? "secondary" : "outline"}
											>
												{PAYMENT_STATUS_LABELS[row.status]}
											</Badge>
										</span>
										<span className="text-muted-foreground">
											{row.dateText} ·{" "}
											<Link
												href={urlFor("tenant.projects.show", {
													tenant: tenant.slug,
													id: row.projectId,
												})}
												className="underline underline-offset-4"
											>
												<span className="line-clamp-1 break-words">
													{row.projectBrief}
												</span>
											</Link>
										</span>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=client_payments.spec.ts --files=clients_pages.spec.ts --files=client_history.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/controllers/clients_controller.ts apps/platform/inertia apps/platform/tests/functional/clients/client_payments.spec.ts
git -C <repo> commit -m "feat(platform): show payments and the balance due on the client profile

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/database/README.md`, `docs/data-model.md`, `docs/requirements.md`, `docs/architecture.md`, `README.md`

- [ ] **Step 1: Platform docs**

In `apps/platform/docs/backend.md`:
- In **Payments**, append a bullet:

```markdown
- Payment decisions, desk payments and balance due (TAT-66): `PaymentService` (`#modules/payments/services/payment_service`) does every owner write under the project's row lock (`ProjectService.lockLive`) and then the payment's, and refuses anyone but an owner with a 404: `verify` / `reject` (a `submitted` payment only, else `PaymentRuleError` `already_decided`; a verified deposit goes through `SessionService.settleBooking`), `record` (desk money, verified at once: a deposit only in `deposit_pending`, session and balance payments in any status but `declined`), `refund` (a negative `refund` up to what the project holds; `outcome_first` on a closed project that still needs its deposit outcome), `reverse` (a full `correction` of a verified payment that isn't one, once: `corrects_payment_id` names it) and `recordOutcome` (a closed project holding deposit money: kept, or refunded with a refund payment up to the deposit held). Reads: `forProject` (quote, payments, balance, deposit money and what is due of it, outcome), `forProjects`, `balancesFor`, `listFlags` (the projects list's "screenshot to check" and "deposit to settle"), `memberNames`. The money maths is pure, in `#modules/payments/ledger`: `depositMoney` (verified deposits plus only the corrections of deposits), `netPaid`, `balanceOf` (the current quote's `quoteTotal` minus every verified payment in its currency, bigint, never stored), `decidedLate` and `formatSignedMoney`. A decision or entry may carry a staff `note` (500 characters, written once, then only cleared). The project page's Payments card props come from the pure `paymentsCard` (`#modules/payments/payments_card`): owners get the screenshots (signed in `ProjectsController` after the tenant-scoped read), the Reverse buttons and the forms; the assigned artist gets the balance and the list only. The client profile reads payments through `forProjects` and `balancesFor`.
```

- In **Images**, replace "`url(purpose, key)` gives the public URL, or a 5-minute signed URL for a private purpose: load the owning record scoped to the tenant first, which is the access check." with "`url(purpose, key, tenant)` gives the public URL, or a 5-minute signed URL for a private purpose that answers with `Cache-Control: private, no-store` (signed in, so it can't be stripped): load the owning record scoped to the tenant first, which is the access check; `url` also refuses a key outside `tenants/<id>/<purpose>/` (TAT-66)."
- In **Clients, inquiries and projects**, replace "and payments have no service yet (TAT-65)," with "and payments go through `DepositService` (TAT-65) and `PaymentService` (TAT-66),", and replace "Balance due (the current quote's total minus verified payments) is computed, never stored." with "Balance due (the current quote's total minus verified payments) is computed, never stored (`balanceOf`, TAT-66). A `correction` names the payment it reverses (`corrects_payment_id`, same project, once)."
- In **Projects and quotes (TAT-64)**, replace "(`ProjectRuleError` `move_not_allowed`, or `deposit_paid` when a withdrawal would close a project that holds verified deposit money: `depositHeld`, from `DepositService.verifiedPaid`; declining and withdrawing cancel scheduled sessions)" with "(`ProjectRuleError` `move_not_allowed`; a client may withdraw up to `in_progress`, and when the project holds deposit money the owner then records its outcome, TAT-66; declining and withdrawing cancel scheduled sessions)"; after the `expireQuote` description add "It also spares a project while a deposit screenshot waits and once the studio rejected a screenshot or reversed a deposit after the expiry (`DepositService.expirySpared`, TAT-66), so a late decision is never undone by a sweep."; and add the sentence "`setPrice` gives a project booked without a price its quote version 1 (fixed, no deposit), once (`QuoteRuleError` `price_locked` otherwise; TAT-66)."
- In **Direct bookings (TAT-43)**, replace "(quotes are locked from `booked`; recording a final price is TAT-66's)" with "(quotes are locked from `booked`; a booking made without a price gets one once through `ProjectService.setPrice`, TAT-66)".
- In **Scheduling**, replace "(the current quote's deposit is 0, or verified `deposit` and `correction` payments reach it)" with "(the current quote's deposit is 0, or verified deposits and the corrections of deposits reach it)", and "Whatever verifies a deposit (TAT-65) must call `settleBooking` afterwards" with "Whatever verifies or records a deposit (`PaymentService`, TAT-66) calls `settleBooking` afterwards".

In `apps/platform/docs/testing.md`, in the `twoStudios()` bullet, after TAT-65's deposit fixtures, add: ", a project booked without a price (`pricelessProject`), a booked project holding a verified deposit (`paidProject`, `verifiedPayment`) and a cancelled one whose deposit needs its outcome (`closedPaidProject`); `payment` is the pipeline's submitted payment". Add a bullet: "Payment tests build their services with `paymentServices()` and a waiting screenshot with `proofFor()` (`#tests/helpers/payments`); a member's writes record `verified_by_user_id`, a key to `users`, so pass a real user's id (`ownerMember(owner)`)."

In `apps/platform/database/README.md`:
- In the **Guard triggers** bullet, after "the same ticket may only clear a payment's proof columns.", add: "`payments_guard` (as replaced by TAT-66) also lets `note` be written in the one update that decides a submitted payment, or cleared; any other change to it reads `payments_guard: note cannot change`. `corrects_payment_id` is frozen like the money facts."
- In the soft-delete bullet's "Not soft-deleted:" list, after "payments (never deleted at all),", add "deposit outcomes (history; append-only by convention, `PaymentService` only inserts),".

- [ ] **Step 2: Product docs**

In `docs/data-model.md`:
- In the diagram, add `TattooProject ||--o{ DepositOutcome : records` after `TattooProject ||--o{ Session : has`.
- In the **Payment** row, after "who verified it and when", add ", the payment it corrects (a `correction` only, same project, at most one correction per payment), a staff note". 
- Add a row after **Payment**:

```markdown
| **DepositOutcome** | What happened to a deposit: kept, moved to a new date (with the missed or cancelled session) or refunded (with its refund payment), the deposit money held then, who recorded it, a note. One per project close and one per session; recorded once, never changed. The studio's policy decides; the app only records |
```

- Replace the balance line with: "- **Balance due** = the current quote's total (or hours × rate) − verified payments in the quote's currency (refunds and reversals are signed). It is computed, never stored; a project booked without a price has none until its price is set."

In `docs/requirements.md`, **Quotes and payments**:
- Tick `- [x] Staff verify or reject the proof; cash and bank payments can be recorded at the desk` and `- [x] Payments are deposits, session payments, balance payments or refunds; the balance due is computed`.
- Add under them:

```markdown
- Owners verify or reject a screenshot next to the amount the deposit page asked for and the reference code; a different amount is rejected and recorded at the desk. A mistaken verification or entry is reversed, never edited. When a project closes holding a deposit, the owner records whether the studio kept or refunded it. The assigned artist sees the balance and the payments, never a screenshot.
```

- In **Clients**, tick `- [x] One client per phone number per tenant, with the history of their projects, references and payments`.
- In **Project rules**, replace "A client can't be recorded as withdrawn while the project holds verified deposit money, or once it is booked: closing it comes with recording what happens to the deposit (kept, moved or refunded)." with "A client can be recorded as withdrawn until the work is done (up to `in_progress`); when the project holds deposit money, the owner records whether the studio keeps it or refunds it (moving it to a new date comes with session outcomes)."; in the expiry rule, after "and cancels its scheduled sessions.", add " It spares a project while a deposit screenshot waits for the studio, and once the studio rejects a screenshot or reverses a deposit after the quote expired: the studio decides what happens next."; replace "Payment proofs and reference images are private. Only owners, and the artist assigned to the project, can see them." with "Payment proofs and reference images are private. Only owners see payment proofs; owners and the artist assigned to the project see reference images."
- In the role table, change the `artist` row to "Their own profile, plus the projects and sessions assigned to them (with those projects' payments and balance, read-only)".

In `docs/architecture.md`, **Request flows → Deposit (customer → studio)**, step 3: replace "An owner verifies the proof in the dashboard, and the project moves to `booked` when a session is scheduled." with "An owner verifies the proof in the dashboard, next to the amount asked and the reference code, and the project moves to `booked` when a session is scheduled; money taken at the desk, refunds and reversals are recorded the same way, and the balance due is computed from them."

In `README.md`, **Deployment**, add:

```markdown
- **Payment proofs:** private images are served only through 5-minute signed URLs that answer with `Cache-Control: private, no-store` (TAT-66). When the private disk moves to R2 (TAT-27), check that its signed URLs still send that header, and keep `/files` request URLs, which carry the signature, out of access logs.
```

`docs/README.md` needs no change (no heading this ticket touches is linked).

- [ ] **Step 3: Check and commit**

Run: `pnpm -C <repo> check`
Expected: no errors.

```bash
git -C <repo> add apps/platform/docs apps/platform/database/README.md docs/data-model.md docs/requirements.md docs/architecture.md README.md
git -C <repo> commit -m "docs(platform): document payment decisions, desk payments, outcomes and balance due

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Final verification

- [ ] **Step 1: Generated files are in step**

Run: `pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> status --short`
Expected: no changes.

- [ ] **Step 2: The migrations roll back and re-apply**

Run: `pnpm -C <repo>/apps/platform exec node ace migration:rollback --connection=owner --step=2`, then `pnpm -C <repo>/apps/platform migrate`, then `git -C <repo> diff --exit-code apps/platform/database/schema.ts`.
Expected: `deposit_outcomes` dropped, the payment columns and TAT-37's guard body restored, then both migrations again; no diff. (The dev database is shared with the other checkouts: say in your report that it now has the TAT-66 columns and table.)

- [ ] **Step 3: The whole suite and the gates**

Run in the background: `PORT=3402 timeout 600 pnpm -C <repo>/apps/platform test > <scratchpad>/suite.log 2>&1`
Expected: the log's `Tests` line shows every test passing (TAT-65's count plus this branch's).

Run: `pnpm -C <repo> check && pnpm -C <repo> typecheck && pnpm -C <repo> build`
Expected: all three pass.

- [ ] **Step 4: Nothing signed leaks**

Run: `rg -n 'images\.url\(' <repo>/apps/platform/app <repo>/apps/platform/database`
Expected: every call passes a tenant; the only `payment_proof` caller is `ProjectsController.show`, inside its owner-only branch.

Run: `rg -n 'logger\.(info|warn|error)' <repo>/apps/platform/app/modules/payments`
Expected: only TAT-65's `DepositProofAlertJob` calls (ids only); `PaymentService` logs nothing.

Run: `rg -n "from \"#modules/payments/models/payment\"" <repo>/apps/platform/app/modules/clients <repo>/apps/platform/app/controllers/clients_controller.ts`
Expected: no match (the clients side reads payments through `PaymentService` only).

- [ ] **Step 5: Report**

Write the PR text to `<scratchpad>/pr2-tat-66.md` (not committed): what and why in a few bullets per area, the rulings a reviewer should challenge (5: expiry spares a late decision; 13: withdrawing with a deposit held; 14: artists see payments read-only, proofs owners only; 3: Reverse ships now), the carry-forwards to post (spec, "Carry-forwards"), the browser pass the user owes (at 375 px and at 1024 px: a waiting screenshot side by side and stacked, Verify and Reject with and without a note, keyboard only through the inline panels and Escape, Record payment with each kind and method and a paisa amount, a refund over the limit, Reverse, a cancelled project's outcome kept and refunded, the price form on a direct booking without a price, the list's two flags, the client profile's Payments card, and that the Projects badge drops after a decision), and the "before any public deploy" list from the spec. Then the whole-branch review and the Codex code and security reviews.
