# Staff alert when a client uploads deposit proof (TAT-88) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deposit screenshot sent from the deposit page alerts the studio's owners, and the member who is the project's artist, once each per payment: an alert under the bell and an email from the worker, both opening the project at its Payments card. About 1.5 points (the ticket guesses 1).

**Architecture:** `DepositProofAlertJob` (already queued in the payment's transaction by `DepositPageService.submitProof`) now reads the live project and its client and calls the new `AlertService.depositProof`, which reuses TAT-52's recipients rule (`inquiryRecipients`) and its once-only insert, generalized to a subject (an inquiry, or a payment and its project), and queues a new `DepositProofMail` per new alert with `sendMailInTransaction`. `staff_alerts` gains `project_id` and `payment_id` (one composite key to `payments`, a unique `(user_id, payment_id)`, the kind and subject checks replaced). `alertTarget` sends a deposit-proof alert to `tenant.projects.show` with the `#payments` fragment, which `AlertsController.open` keeps with an Inertia location visit.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, `@adonisjs/queue` (database driver), `@adonisjs/mail` with Edge templates, `@adonisjs/inertia` 5 (`inertia.location`, `requestInfo`), Japa; Inertia + React 19.

**Spec:** `docs/superpowers/specs/2026-10-20-tat-88-deposit-proof-alert-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides; say which in your report). `<scratchpad>` is your session's scratchpad directory. `<db-env>` is the isolated-database prefix the coordinator gives you (for example `DB_DATABASE=td_build_88`): put it in front of every `migrate`, `migration:*` and test command below. **Never run them without it**: the user's dev database is not for builds. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **Migration (exact name):** `apps/platform/database/migrations/1791694000000_add_deposit_proof_to_staff_alerts.ts`. The build found TAT-33's `1791693300000` and `1791693300001` already there, so the number is `1791694000000` (a migration must sort after the newest one; if a later one exists when you build, use the next free number and say so in your report). Apply with `<db-env> pnpm -C <repo>/apps/platform migrate` (owner role); it regenerates `database/schema.ts`, which you commit.
- **No new route, no new setting, no dependency, no `package.json` change.** Never read or edit `apps/platform/.env`.
- **Copy (verbatim).** Alerts: `Deposit screenshot to check` / `Open the project's Payments card.`, `A deposit screenshot for your project` / `An owner checks it on the Payments card.`, `No alerts yet. New inquiries and deposit screenshots show up here.`. Email: subject `Deposit screenshot for {studio}`, title `Deposit screenshot`, preheader `A deposit screenshot is waiting to be checked.`, intro `{First} sent {studio} a deposit screenshot.` / `… for your project.` / `A client sent …`, `Check that the money reached your account, then verify or reject it on the Payments card.`, `Check the screenshot`, `An owner of {studio} will check it.`, `Open the project`, `You get these emails as a member of {studio} on Tattoo Drip.`. Boot warning `Staff alert emails are off (ALERT_EMAILS=false): new inquiries and deposit screenshots alert the dashboard only.`. Job failure log `Alerting staff to a deposit proof failed.`.
- Fixture slugs and addresses in new tests end in `-88` (`proof-alerts-88`, `asha@proof-alerts-88.example`). Tests added to an existing file that uses `studioWithOwner()` with no slug keep it (`black-needle`, "Black Needle").
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No non-null assertions (`!`), no custom CSS classes.
- Tests: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`).
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After the controller change run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/` if it changed.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 7), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **One alert and one email per member per payment, however often the job runs; none without its payment.** Tests: Task 4 "a repeated run adds nothing; a new screenshot (a new payment) alerts again", "a rollback leaves neither the alert nor its email"; Task 5 "alerts the owner through AlertService, once however often it runs"; TAT-65's existing "a failure later in the request deletes the image and drops the alert" (unchanged).
2. **The right recipients, and nobody else.** Live owners, plus the project's artist only through a live linked profile and a live membership. Tests: Task 4 "a deposit proof alerts every live owner and the project's artist's member, once each", "an unassigned project, or an unlinked, deleted or outside profile, alerts the owners only".
3. **What leaves the platform.** First name only (Devanagari intact), no amount, method, phone, deposit link or last name; no client data in the subject. Tests: Task 4 "the email names the client by first name only…"; Task 3 `DepositProofMail` tests.
4. **The schema refuses a cross-studio or mismatched payment, and keeps each kind's subject.** Tests: Task 2 "a deposit-proof alert names a payment of its own studio and project, once per member"; the existing new-inquiry table tests unchanged.
5. **Opening goes only where the row says.** Own alerts only (TAT-52's 404 test unchanged); the target is the row's project and a constant fragment. Tests: Task 6 the three HTTP tests; Task 1 `alertTarget`.

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -1 -- docs/superpowers/plans/2026-10-20-tat-88-deposit-proof-alert.md` → the commit "docs: plan TAT-88 deposit proof alert".

- [ ] **Step 2: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -nF 'export const ALERT_KINDS = ["new_inquiry"] as const;' -- apps/platform/app/modules/notifications/alerts.ts
git -C <repo> grep -nF "export function alertTarget(" -- apps/platform/app/modules/notifications/alerts.ts
git -C <repo> grep -nF "async function insertAlerts(" -- apps/platform/app/modules/notifications/services/alert_service.ts
git -C <repo> grep -nF "values \${userIds.map(() => \"(?, ?, 'new_inquiry', ?, now())\").join(\", \")}" -- apps/platform/app/modules/notifications/services/alert_service.ts
git -C <repo> grep -nF '"Deposit proof received.",' -- apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts
git -C <repo> grep -nF "DepositProofAlertJob.dispatch({" -- apps/platform/app/modules/payments/services/deposit_page_service.ts
git -C <repo> grep -nF ".toRoute(target.route, { tenant: tenant.slug, id: target.id });" -- apps/platform/app/controllers/alerts_controller.ts
git -C <repo> grep -nF '<Card id="payments">' -- apps/platform/inertia/components/payments_card.tsx
git -C <repo> grep -nF '"No alerts yet. New inquiries show up here."' -- apps/platform/inertia/components/alerts.ts apps/platform/tests/unit/inertia/alerts_copy.spec.ts
git -C <repo> grep -nF "new inquiries alert the dashboard only." -- apps/platform/start/mail.ts
git -C <repo> grep -nF "staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null))" -- apps/platform/database/migrations/1791670000002_create_staff_alerts_table.ts
git -C <repo> grep -nF "payments_tenant_project_id_unique unique (tenant_id, project_id, id)" -- apps/platform/database/migrations/1791660000000_add_corrections_and_notes_to_payments.ts
git -C <repo> grep -nF 'edge.mount("notifications"' -- apps/platform/start/view.ts
git -C <repo> grep -nF 'test("a failure later in the request deletes the image and drops the alert"' -- apps/platform/tests/functional/payments/deposit_page_service.spec.ts
git -C <repo> grep -nF "async findLive(tenant: TenantRef, id: string)" -- apps/platform/app/modules/projects/services/project_service.ts
git -C <repo> grep -nF "async find(tenant: TenantRef, id: string): Promise<Client | null>" -- apps/platform/app/modules/clients/services/client_service.ts
```

Each of these must print nothing:

```
git -C <repo> grep -n "\"deposit_proof\"\|'deposit_proof'" -- apps/platform/app apps/platform/database apps/platform/tests
git -C <repo> ls-files apps/platform/app/modules/notifications/emails/deposit_proof_mail.ts
```

And `ls <repo>/apps/platform/database/migrations | tail -1` → `1791693300001_create_invitation_tenant_function.ts` at the build (TAT-33 landed after TAT-18's `1791680000002`; anything newer: read the Global Constraints' migration rule).

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 3: Install and environment**

If `<repo>/apps/platform/node_modules` is missing: when `<repo>/node_modules` is a symlink (`test -L <repo>/node_modules && echo link`), STOP and ask the coordinator (an install would write through it into another checkout); otherwise `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Then `grep -rln "requestInfo(reCompute)" <repo>/apps/platform/node_modules/@adonisjs/inertia/build/` must print a file (`ctx.inertia.requestInfo()` exists; Task 6 uses it). Check the platform env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok`. Check the isolated database is migrated: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` lists every migration up to `1791680000002` as completed (if not, `<db-env> … migrate` first).

- [ ] **Step 4: Baseline**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alert_service.spec.ts --files=alerts_http.spec.ts --files=staff_alerts_table.spec.ts --files=deposit_proof_alert_job.spec.ts --files=deposit_page_service.spec.ts --files=deposits.spec.ts --files=new_inquiry_alert_job.spec.ts --files=catalog_guard.spec.ts` and `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=alerts.spec.ts --files=new_inquiry_mail.spec.ts --files=alerts_copy.spec.ts`. Expected: PASS. Then the full suite in the background: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line (the final count must be 19 higher; Task 8 has the breakdown).

---

### Task 1: The deposit-proof kind, its words and its target

**Files:**
- Modify: `apps/platform/app/modules/notifications/alerts.ts`
- Test: `apps/platform/tests/unit/modules/notifications/alerts.spec.ts` (add a group; the existing tests stay unchanged)

**Interfaces:**
- From `#modules/notifications/alerts`: `ALERT_KINDS = ["new_inquiry", "deposit_proof"]`; `proofIntro({ clientName, studioName, yourProject }): string`; `depositProofSubject(studioName): string`; `PAYMENTS_CARD = "payments"`; `paymentsCardPath(slug, projectId): string`; `type AlertTarget`; `alertTarget(alert: { kind; inquiryId; projectId? }, role): AlertTarget | null`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/unit/modules/notifications/alerts.spec.ts`, replace the import block at the top with:

```ts
import {
	alertCopy,
	alertTarget,
	alertTimeText,
	dashboardUrl,
	depositProofSubject,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
	newInquirySubject,
	paymentsCardPath,
	proofIntro,
} from "#modules/notifications/alerts";
```

and add at the end of the file:

```ts
test.group("deposit-proof alerts (TAT-88)", () => {
	test("the email's intro, subject and link to the Payments card", ({
		assert,
	}) => {
		const intro = (over: Partial<Parameters<typeof proofIntro>[0]>) =>
			proofIntro({
				clientName: "Sita Rai",
				studioName: "Black Needle",
				yourProject: false,
				...over,
			});

		assert.equal(intro({}), "Sita sent Black Needle a deposit screenshot.");
		assert.equal(
			intro({ yourProject: true }),
			"Sita sent Black Needle a deposit screenshot for your project.",
		);
		assert.equal(
			intro({ clientName: "  " }),
			"A client sent Black Needle a deposit screenshot.",
		);
		assert.equal(
			intro({ clientName: "सीता राई" }),
			"सीता sent Black Needle a deposit screenshot.",
		);
		assert.equal(
			depositProofSubject("Black Needle"),
			"Deposit screenshot for Black Needle",
		);
		assert.equal(
			paymentsCardPath("black-needle", "p-1"),
			"/t/black-needle/projects/p-1#payments",
		);
		assert.equal(
			dashboardUrl("https://app.example.com", paymentsCardPath("x", "p-1")),
			"https://app.example.com/t/x/projects/p-1#payments",
		);
	});

	test("the in-app line and where opening it goes", ({ assert }) => {
		assert.deepEqual(alertCopy("deposit_proof", true), {
			title: "Deposit screenshot to check",
			detail: "Open the project's Payments card.",
		});
		assert.deepEqual(alertCopy("deposit_proof", false), {
			title: "A deposit screenshot for your project",
			detail: "An owner checks it on the Payments card.",
		});
		const proof = {
			kind: "deposit_proof" as const,
			inquiryId: null,
			projectId: "p-1",
		};
		for (const role of ["owner", "artist"]) {
			assert.deepEqual(
				alertTarget(proof, role),
				{ route: "tenant.projects.show", id: "p-1", hash: "payments" },
				role,
			);
		}
		assert.isNull(alertTarget({ ...proof, projectId: null }, "owner"));
		// A new-inquiry alert never opens a project, whatever the row holds.
		assert.isNull(
			alertTarget(
				{ kind: "new_inquiry", inquiryId: null, projectId: "p-1" },
				"owner",
			),
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=alerts.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log says `does not provide an export named` (`depositProofSubject`, `paymentsCardPath` or `proofIntro`).

- [ ] **Step 3: Write the code**

In `apps/platform/app/modules/notifications/alerts.ts`:

(a) Replace

```ts
/** What a staff alert is about (TAT-52). The deposit-proof alert is a follow-up (spec ruling 12). */
export const ALERT_KINDS = ["new_inquiry"] as const;
```

with

```ts
/** What a staff alert is about: a new inquiry (TAT-52) or a client's deposit screenshot (TAT-88). */
export const ALERT_KINDS = ["new_inquiry", "deposit_proof"] as const;
```

(b) After the `dashboardUrl` function, add:

```ts
/**
 * The deposit-proof email's first line (TAT-88): "Sita sent Black Needle a
 * deposit screenshot." and, for the project's artist, "… for your project.".
 */
export function proofIntro({
	clientName,
	studioName,
	yourProject,
}: {
	clientName: string;
	studioName: string;
	yourProject: boolean;
}): string {
	const who = firstName(clientName) || "A client";
	const whose = yourProject ? " for your project" : "";
	return `${who} sent ${studioName} a deposit screenshot${whose}.`;
}

/** The deposit-proof subject: no client data, because SendMailJob.failed() logs it. */
export function depositProofSubject(studioName: string): string {
	return `Deposit screenshot for ${studioName}`;
}

/** The anchor of the project page's Payments card (inertia/components/payments_card.tsx). */
export const PAYMENTS_CARD = "payments";

/** A project's Payments card on the dashboard: where a deposit-proof alert opens. */
export function paymentsCardPath(slug: string, projectId: string): string {
	return `/t/${slug}/projects/${projectId}#${PAYMENTS_CARD}`;
}
```

(c) In `LINES`, after the `new_inquiry` entry's closing `},`, add:

```ts
	deposit_proof: {
		owner: {
			title: "Deposit screenshot to check",
			detail: "Open the project's Payments card.",
		},
		other: {
			title: "A deposit screenshot for your project",
			detail: "An owner checks it on the Payments card.",
		},
	},
```

(d) Replace the doc comment and body of `alertTarget` (from `/**\n * Where opening an alert goes (spec ruling 10)` to the end of the file) with:

```ts
/** Where opening an alert goes: a named route, its id and, for a card, the fragment. */
export type AlertTarget =
	| { route: "tenant.inbox.show"; id: string }
	| { route: "tenant.projects.show"; id: string; hash: typeof PAYMENTS_CARD };

/**
 * Where opening an alert goes (TAT-52 ruling 10, TAT-88 ruling 9): an
 * owner's new-inquiry alert opens its inquiry; a deposit-proof alert opens
 * its project at the Payments card, for any role (the project page applies
 * the member's access). Anything else stays on the list. Computed from the
 * row and the member's current role, never from the request.
 */
export function alertTarget(
	alert: {
		kind: AlertKind;
		inquiryId: string | null;
		projectId?: string | null;
	},
	role: string,
): AlertTarget | null {
	if (alert.kind === "new_inquiry" && alert.inquiryId && role === "owner") {
		return { route: "tenant.inbox.show", id: alert.inquiryId };
	}
	if (alert.kind === "deposit_proof" && alert.projectId) {
		return {
			route: "tenant.projects.show",
			id: alert.projectId,
			hash: PAYMENTS_CARD,
		};
	}
	return null;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=alerts.spec.ts`
Expected: PASS, the old tests unchanged plus 2 new. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean (`AlertsController` still compiles: both routes are tenant routes taking `tenant` and `id`).

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/alerts.ts apps/platform/tests/unit/modules/notifications/alerts.spec.ts
git -C <repo> add apps/platform/app/modules/notifications/alerts.ts apps/platform/tests/unit/modules/notifications/alerts.spec.ts
git -C <repo> commit -m "feat(platform): add the deposit-proof alert kind, its words and its target" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The schema: a payment and its project on an alert

**Files:**
- Create: `apps/platform/database/migrations/1791694000000_add_deposit_proof_to_staff_alerts.ts`
- Regenerated: `apps/platform/database/schema.ts` (by `pnpm migrate`)
- Test: `apps/platform/tests/functional/notifications/staff_alerts_table.spec.ts` (add a test)

**Interfaces:**
- `StaffAlert` gains `projectId: string | null` and `paymentId: string | null` (the generated schema; `app/modules/notifications/models/staff_alert.ts` is unchanged).

- [ ] **Step 1: Write the failing test**

In `apps/platform/tests/functional/notifications/staff_alerts_table.spec.ts`, replace

```ts
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
```

with

```ts
import {
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
```

and, after the test "an alert names an inquiry of its own studio, once per member", add:

```ts
	test("a deposit-proof alert names a payment of its own studio and project, once per member", async ({
		assert,
	}) => {
		const { tenant: a, owner } = await studioWithOwner("proof-table-a-88");
		const { tenant: b } = await studioWithOwner("proof-table-b-88");
		const paymentIn = (tenant: { id: string }) =>
			inTenant(tenant, async () =>
				makePayment(
					tenant,
					await makeProject(tenant, await makeClient(tenant)),
				),
			);
		const mine = await paymentIn(a);
		// A payment of another project in the same studio.
		const another = await paymentIn(a);
		const theirs = await paymentIn(b);
		const inquiry = await inquiryIn(a);
		const proof = (
			payment: { id: string; projectId: string },
			over: Record<string, unknown> = {},
		) =>
			alert(a.id, owner.id, null, {
				kind: "deposit_proof",
				project_id: payment.projectId,
				payment_id: payment.id,
				...over,
			});
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) => insertRow(inner, "staff_alerts", values)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(proof(theirs), /staff_alerts_payment_foreign/);
			await rejects(
				proof(mine, { project_id: another.projectId }),
				/staff_alerts_payment_foreign/,
			);
			await rejects(
				proof(mine, { payment_id: null }),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				proof(mine, { project_id: null }),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				proof(mine, { inquiry_id: inquiry.id }),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				alert(a.id, owner.id, inquiry.id, {
					project_id: mine.projectId,
					payment_id: mine.id,
				}),
				/staff_alerts_subject_matches_kind/,
			);
			await insertRow(trx, "staff_alerts", proof(mine));
			await rejects(proof(mine), /staff_alerts_user_id_payment_id_unique/);
			// Another payment (the next screenshot) is another alert.
			await insertRow(trx, "staff_alerts", proof(another));
		});
	});
```

- [ ] **Step 2: Run it to see it fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=staff_alerts_table.spec.ts`
Expected: FAIL in the new test (the first `rejects` gets `column "project_id" of relation "staff_alerts" does not exist` instead of the key's name); the other tests pass.

- [ ] **Step 3: Write the migration**

Create `apps/platform/database/migrations/1791694000000_add_deposit_proof_to_staff_alerts.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The deposit-proof alert (TAT-88): a member's alert that a client sent a
 * deposit screenshot, naming the payment and its project. One composite key
 * makes the payment this studio's and that project's (the target is TAT-66's
 * payments_tenant_project_id_unique). One alert per member per payment, so
 * the alert job's `on conflict do nothing` makes a rerun add nothing; a new
 * screenshot is always a new payment (the deposit page takes one at a time
 * and payments_guard never replaces a proof). Payments are never deleted,
 * so the cascade only matters for a tenant purge. The kinds are ALERT_KINDS
 * in #modules/notifications/alerts, copied here, not imported. down()
 * deletes the deposit-proof alerts first: TAT-52's checks can't hold them.
 */
export default class extends BaseSchema {
	protected tableName = "staff_alerts";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.uuid("project_id").nullable();
			table.uuid("payment_id").nullable();
		});
		for (const statement of [
			"alter table staff_alerts add constraint staff_alerts_payment_foreign foreign key (tenant_id, project_id, payment_id) references payments (tenant_id, project_id, id) on delete cascade",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry', 'deposit_proof'))",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null) and (kind = 'deposit_proof') = (payment_id is not null) and (project_id is null) = (payment_id is null))",
			// One alert per member per payment.
			"alter table staff_alerts add constraint staff_alerts_user_id_payment_id_unique unique (user_id, payment_id)",
			// The composite key's index.
			"create index staff_alerts_tenant_id_project_id_payment_id_index on staff_alerts (tenant_id, project_id, payment_id)",
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const statement of [
			"delete from staff_alerts where kind = 'deposit_proof'",
			"drop index staff_alerts_tenant_id_project_id_payment_id_index",
			"alter table staff_alerts drop constraint staff_alerts_user_id_payment_id_unique",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null))",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry'))",
			"alter table staff_alerts drop constraint staff_alerts_payment_foreign",
		]) {
			this.schema.raw(statement);
		}
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("payment_id");
			table.dropColumn("project_id");
		});
	}
}
```

- [ ] **Step 4: Apply it, then check down() and up() once**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate` → the migration runs; `git -C <repo> diff --stat apps/platform/database/schema.ts` shows `StaffAlertSchema` gaining `paymentId` and `projectId`.
Then: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate:rollback` (rolls back only this batch) and `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate` again: both succeed, and `schema.ts` ends as after the first apply.

- [ ] **Step 5: Run the table tests to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=staff_alerts_table.spec.ts --files=catalog_guard.spec.ts --files=alert_service.spec.ts --files=alerts_http.spec.ts`
Expected: PASS (4 table tests; the new-inquiry ones and the catalog guard unchanged). Then `typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/database/migrations/1791694000000_add_deposit_proof_to_staff_alerts.ts apps/platform/tests/functional/notifications/staff_alerts_table.spec.ts
git -C <repo> add apps/platform/database/migrations/1791694000000_add_deposit_proof_to_staff_alerts.ts apps/platform/database/schema.ts apps/platform/tests/functional/notifications/staff_alerts_table.spec.ts
git -C <repo> commit -m "feat(platform): let a staff alert name a deposit payment and its project" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The deposit-proof email

**Files:**
- Create: `apps/platform/app/modules/notifications/emails/deposit_proof_mail.ts`, `apps/platform/app/modules/notifications/emails/deposit_proof.edge`, `apps/platform/app/modules/notifications/emails/deposit_proof_text.edge`
- Test: `apps/platform/tests/unit/modules/notifications/deposit_proof_mail.spec.ts` (create)

**Interfaces:**
- `DepositProofMail` (default export) and `type DepositProofMailData = { to: string; recipientName: string | null; studioName: string; intro: string; forOwner: boolean; url: string }` from `#modules/notifications/emails/deposit_proof_mail`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/notifications/deposit_proof_mail.spec.ts`:

```ts
import { test } from "@japa/runner";
import DepositProofMail, {
	type DepositProofMailData,
} from "#modules/notifications/emails/deposit_proof_mail";

const CARD = "https://app.tattoo-drip.test/t/black-needle/projects/0190#payments";

const owner: DepositProofMailData = {
	to: "owner@black-needle.example",
	recipientName: "Ram Thapa",
	studioName: "Black Needle",
	intro: "Sita sent Black Needle a deposit screenshot.",
	forOwner: true,
	url: CARD,
};

async function render(data: DepositProofMailData) {
	const mail = new DepositProofMail(data);
	await mail.buildWithContents();
	return mail.message;
}

test.group("DepositProofMail (TAT-88)", () => {
	test("goes to the member, with no client data in the subject and no from", async ({
		assert,
	}) => {
		const message = await render(owner);

		message.assertTo("owner@black-needle.example");
		message.assertSubject("Deposit screenshot for Black Needle");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("an owner's email asks them to check the screenshot on the Payments card", async () => {
		const message = await render(owner);

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Hi Ram Thapa,");
		message.assertHtmlIncludes("Sita sent Black Needle a deposit screenshot.");
		message.assertHtmlIncludes(
			"Check that the money reached your account, then verify or reject it on the Payments card.",
		);
		message.assertHtmlIncludes(`href="${CARD}"`);
		message.assertHtmlIncludes("Check the screenshot");
		message.assertHtmlIncludes(
			"You get these emails as a member of Black Needle on Tattoo Drip.",
		);
		message.assertTextIncludes(`Check the screenshot: ${CARD}`);
	});

	test("the project's artist is told an owner checks it, and can open the project", async ({
		assert,
	}) => {
		const message = await render({
			...owner,
			recipientName: null,
			intro: "Sita sent Black Needle a deposit screenshot for your project.",
			forOwner: false,
		});

		message.assertHtmlIncludes("Hi there,");
		message.assertHtmlIncludes("An owner of Black Needle will check it.");
		message.assertHtmlIncludes("Open the project");
		message.assertTextIncludes("An owner of Black Needle will check it.");
		message.assertTextIncludes(`Open the project: ${CARD}`);
		const html = String(message.nodeMailerMessage.html);
		assert.notInclude(html, "Check the screenshot");
		assert.notInclude(html, "null");
	});

	test("escapes the words in the HTML and keeps them as typed in the text", async ({
		assert,
	}) => {
		const message = await render({
			...owner,
			intro: '<b>सीता</b> & "Sita" sent Black Needle a deposit screenshot.',
		});

		message.assertHtmlIncludes("&lt;b&gt;सीता&lt;/b&gt; &amp;");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>सीता</b>");
		message.assertTextIncludes('<b>सीता</b> & "Sita" sent Black Needle');
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=deposit_proof_mail.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and `Cannot find module` for `#modules/notifications/emails/deposit_proof_mail`.

- [ ] **Step 3: Write the mail class and its templates**

Create `apps/platform/app/modules/notifications/emails/deposit_proof_mail.ts`:

```ts
import { BaseMail } from "@adonisjs/mail";
import { depositProofSubject } from "#modules/notifications/alerts";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type DepositProofMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** proofIntro's sentence. */
	intro: string;
	/** An owner checks the screenshot; anyone else (the project's artist) is told an owner will. */
	forOwner: boolean;
	/** The project's Payments card on the dashboard (APP_URL + paymentsCardPath). */
	url: string;
};

/**
 * Tells a member that a client sent a deposit screenshot (TAT-88): the
 * client's first name and the link to the project's Payments card. Never
 * the amount, the method, the reference code, the deposit link, the phone
 * or the screenshot (spec ruling 7); the subject has no client data,
 * because SendMailJob.failed() logs it.
 */
export default class DepositProofMail extends BaseMail {
	constructor(private data: DepositProofMailData) {
		super();
		this.subject = depositProofSubject(data.studioName);
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/deposit_proof", view)
			.textView("notifications::emails/deposit_proof_text", view);
	}
}
```

Create `apps/platform/app/modules/notifications/emails/deposit_proof.edge`:

```edge
@email.layout({ title: 'Deposit screenshot', preheader: 'A deposit screenshot is waiting to be checked.' })
  <p style="margin: 0 0 16px;">Hi {{ recipientName || 'there' }},</p>
  <p style="margin: 0 0 16px;">{{ intro }}</p>
  @if(forOwner)
    <p style="margin: 0 0 16px;">Check that the money reached your account, then verify or reject it on the Payments card.</p>
    @!email.button({ href: url, text: 'Check the screenshot' })
  @else
    <p style="margin: 0 0 16px;">An owner of {{ studioName }} will check it.</p>
    @!email.button({ href: url, text: 'Open the project' })
  @end
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
    You get these emails as a member of {{ studioName }} on Tattoo Drip.
  </p>
@end
```

Create `apps/platform/app/modules/notifications/emails/deposit_proof_text.edge`:

```edge
Hi {{{ recipientName || 'there' }}},

{{{ intro }}}

@if(forOwner)
Check that the money reached your account, then verify or reject it on the Payments card.
Check the screenshot: {{{ url }}}
@else
An owner of {{{ studioName }}} will check it.
Open the project: {{{ url }}}
@end

You get these emails as a member of {{{ studioName }}} on Tattoo Drip.
```

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=deposit_proof_mail.spec.ts --files=new_inquiry_mail.spec.ts`
Expected: PASS, 4 new tests and the new-inquiry mail's unchanged. Then `typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/emails/deposit_proof_mail.ts apps/platform/tests/unit/modules/notifications/deposit_proof_mail.spec.ts
git -C <repo> add apps/platform/app/modules/notifications/emails apps/platform/tests/unit/modules/notifications/deposit_proof_mail.spec.ts
git -C <repo> commit -m "feat(platform): add the deposit screenshot email for staff" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `AlertService.depositProof`

**Files:**
- Modify: `apps/platform/app/modules/notifications/services/alert_service.ts`
- Test: `apps/platform/tests/functional/notifications/alert_service.spec.ts` (add a group; the existing tests stay unchanged)

**Interfaces:**
- `type DepositProof = { paymentId: string; projectId: string; artistId: string | null; clientName: string }` and `AlertService.depositProof(tenant: TenantRef, proof: DepositProof, options?: AlertOptions): Promise<string[]>` (the users alerted by this call), from `#modules/notifications/services/alert_service`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/notifications/alert_service.spec.ts`:

(a) Replace

```ts
import { makeArtist, makeClient, makeInquiry } from "#tests/helpers/pipeline";
```

with

```ts
import type Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
```

(Biome moves the two type imports into order when you run it.)

(b) After the `removeMembership` helper, add:

```ts
/** A deposit_pending project of `tenant` (assigned to `artistId` when given) and a submitted deposit payment: a screenshot that waits. */
const proofIn = (
	tenant: Tenant,
	over: { artistId?: string | null; clientName?: string } = {},
) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant, {
			name: over.clientName ?? "Sita Rai",
		});
		const project = await makeProject(tenant, client, {
			status: "deposit_pending",
			artistId: over.artistId ?? null,
		});
		const payment = await makePayment(tenant, project, { method: "esewa" });
		return { client, project, payment };
	});

/** What DepositProofAlertJob hands AlertService.depositProof. */
const factsOf = (
	{
		project,
		payment,
		client,
	}: { project: TattooProject; payment: Payment; client: { name: string } },
) => ({
	paymentId: payment.id,
	projectId: project.id,
	artistId: project.artistId,
	clientName: client.name,
});

/** The users alerted about `paymentId`, sorted. */
const proofAlertedUsers = (tenant: { id: string }, paymentId: string) =>
	inTenant(tenant, async () =>
		(await StaffAlert.query().where("payment_id", paymentId))
			.map(({ userId }) => userId)
			.sort(),
	);
```

(c) At the end of the file, add:

```ts
test.group("AlertService.depositProof (TAT-88)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a deposit proof alerts every live owner and the project's artist's member, once each", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-alerts-88");
		const second = await memberIn(
			tenant,
			"second@proof-alerts-88.example",
			"owner",
		);
		const removed = await memberIn(
			tenant,
			"removed@proof-alerts-88.example",
			"owner",
		);
		await removeMembership(tenant, removed);
		const asha = await artistIn(tenant, "asha@proof-alerts-88.example");
		await artistIn(tenant, "ram@proof-alerts-88.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const proof = await proofIn(tenant, { artistId: profile.id });
		const fake = queue.fake();

		const alerted = await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);

		const expected = [owner.id, second.id, asha.id].sort();
		assert.deepEqual([...alerted].sort(), expected);
		assert.deepEqual(
			await proofAlertedUsers(tenant, proof.payment.id),
			expected,
		);
		assert.deepEqual(
			recipients(fake),
			[owner.email, second.email, asha.email].sort(),
		);
		const rows = await inTenant(tenant, () =>
			StaffAlert.query().where("payment_id", proof.payment.id),
		);
		for (const row of rows) {
			assert.equal(row.kind, "deposit_proof");
			assert.equal(row.projectId, proof.project.id);
			assert.isNull(row.inquiryId);
			assert.isNull(row.readAt);
		}
	});

	test("the owner's email checks the screenshot, the artist's opens the project, both at the Payments card", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"proof-link-88",
			"Ink Link",
		);
		const asha = await artistIn(tenant, "asha@proof-link-88.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const proof = await proofIn(tenant, { artistId: profile.id });
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);

		const url = new URL(
			`/t/proof-link-88/projects/${proof.project.id}#payments`,
			env.get("APP_URL"),
		).toString();
		assert.deepInclude(mailTo(fake, owner.email), {
			studioName: "Ink Link",
			intro: "Sita sent Ink Link a deposit screenshot.",
			forOwner: true,
			url,
		});
		assert.deepInclude(mailTo(fake, asha.email), {
			intro: "Sita sent Ink Link a deposit screenshot for your project.",
			forOwner: false,
			url,
		});
	});

	test("a repeated run adds nothing; a new screenshot (a new payment) alerts again", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-again-88");
		const first = await proofIn(tenant);
		const fake = queue.fake();
		const run = (proof: Parameters<typeof factsOf>[0]) =>
			inTenant(tenant, () =>
				alerts.depositProof(tenant, factsOf(proof), { emails: true }),
			);

		assert.deepEqual(await run(first), [owner.id]);
		assert.deepEqual(await run(first), []);
		// After a rejection the deposit page takes the client's next
		// screenshot as a new payment of the same project.
		const next = {
			...first,
			payment: await inTenant(tenant, () =>
				makePayment(tenant, first.project, { method: "esewa" }),
			),
		};
		assert.deepEqual(await run(next), [owner.id]);

		assert.deepEqual(await proofAlertedUsers(tenant, first.payment.id), [
			owner.id,
		]);
		assert.deepEqual(await proofAlertedUsers(tenant, next.payment.id), [
			owner.id,
		]);
		assert.deepEqual(recipients(fake), [owner.email, owner.email]);
	});

	test("a rollback leaves neither the alert nor its email", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-rollback-88");
		const proof = await proofIn(tenant);
		// The real queue: a SendMailJob row's data carries the address.
		const queued = async () =>
			Number(
				(
					await db
						.from("queue_jobs")
						.where("data", "like", `%${owner.email}%`)
						.count("* as total")
				)[0].total,
			);

		await inTenant(tenant, () =>
			assert.rejects(
				() =>
					withTransaction(async () => {
						await alerts.depositProof(tenant, factsOf(proof), {
							emails: true,
						});
						throw new Error("rolled back");
					}),
				/rolled back/,
			),
		);
		assert.deepEqual(await proofAlertedUsers(tenant, proof.payment.id), []);
		assert.equal(await queued(), 0);

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);
		assert.deepEqual(await proofAlertedUsers(tenant, proof.payment.id), [
			owner.id,
		]);
		assert.equal(await queued(), 1);
	});

	test("with emails off, the alerts are made and no email is queued", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-off-88");
		const proof = await proofIn(tenant);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: false }),
		);

		assert.deepEqual(await proofAlertedUsers(tenant, proof.payment.id), [
			owner.id,
		]);
		assert.deepEqual(mails(fake), []);
	});

	test("an unassigned project, or an unlinked, deleted or outside profile, alerts the owners only", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-only-88");
		const { owner: stranger, tenant: theirs } =
			await studioWithOwner("proof-other-88");
		const asha = await artistIn(tenant, "asha@proof-only-88.example");
		const deleted = await profileIn(tenant, "gone", "Gone", asha);
		await inTenant(tenant, () => deleted.softDelete());
		const unlinked = await profileIn(tenant, "loose", "Loose", null);
		// Linked to a user who belongs to another studio only.
		const foreign = await profileIn(tenant, "foreign", "Foreign", stranger);

		for (const artistId of [null, deleted.id, unlinked.id, foreign.id]) {
			const proof = await proofIn(tenant, { artistId });
			assert.deepEqual(
				await inTenant(tenant, () =>
					alerts.depositProof(tenant, factsOf(proof), { emails: false }),
				),
				[owner.id],
				String(artistId),
			);
		}
		assert.lengthOf(await inTenant(theirs, () => StaffAlert.query()), 0);
	});

	test("the email names the client by first name only, Devanagari intact, and never the amount, method, phone or a deposit link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("proof-content-88");
		const proof = await proofIn(tenant, { clientName: "सीता राई" });
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);

		const [payload] = mails(fake);
		assert.equal(
			payload?.mailMessage.message.subject,
			"Deposit screenshot for Black Needle",
		);
		assert.equal(
			payload?.mailMessage.views.html?.data.intro,
			"सीता sent Black Needle a deposit screenshot.",
		);
		const everything = JSON.stringify(payload);
		for (const secret of [
			"राई",
			proof.client.phone.slice(4),
			"300000",
			"3,000",
			"esewa",
			"/deposit",
			proof.payment.id,
		]) {
			assert.notInclude(everything, secret, secret);
		}
	});
});
```

(`studioWithOwner("proof-content-88")` keeps the default name "Black Needle".)

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alert_service.spec.ts`
Expected: FAIL in the 7 new tests (`alerts.depositProof is not a function`); the TAT-52 tests pass. (If Japa hangs instead, rerun with the `timeout 120` form and read the log.)

- [ ] **Step 3: Write the service method**

In `apps/platform/app/modules/notifications/services/alert_service.ts`:

(a) Replace the alerts import

```ts
import {
	dashboardUrl,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
} from "#modules/notifications/alerts";
import NewInquiryMail from "#modules/notifications/emails/new_inquiry_mail";
```

with

```ts
import {
	dashboardUrl,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
	paymentsCardPath,
	proofIntro,
} from "#modules/notifications/alerts";
import DepositProofMail from "#modules/notifications/emails/deposit_proof_mail";
import NewInquiryMail from "#modules/notifications/emails/new_inquiry_mail";
```

(b) After the `AlertPage` type, add:

```ts
/**
 * What a deposit-proof alert needs (DepositProofAlertJob gathers it): the
 * payment, its project, the project's artist profile and the client's name
 * as the studio stores it.
 */
export type DepositProof = {
	paymentId: string;
	projectId: string;
	artistId: string | null;
	clientName: string;
};
```

(c) In `newInquiry`, replace

```ts
			const inserted = await insertAlerts(
				trx,
				tenant,
				inquiry.id,
				recipients.map(({ userId }) => userId),
			);
```

with

```ts
			const inserted = await insertAlerts(
				trx,
				tenant,
				{ kind: "new_inquiry", inquiryId: inquiry.id },
				recipients.map(({ userId }) => userId),
			);
```

(d) After the `newInquiry` method's closing brace, add:

```ts
	/**
	 * Alerts the studio's owners, and the member linked to the project's
	 * live artist profile, that a client sent a deposit screenshot
	 * (DepositProofAlertJob, TAT-88): the new-inquiry rule with the project's
	 * artist in place of the asked-for one. Each member gets one alert and
	 * one email per payment, once: the unique (user_id, payment_id) and `on
	 * conflict do nothing` make a repeated run add nothing, and each email is
	 * queued in the same transaction as its alert. Both point at the
	 * project's Payments card. Returns the users alerted by this call.
	 */
	async depositProof(
		tenant: TenantRef,
		proof: DepositProof,
		options: AlertOptions = {},
	): Promise<string[]> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return [];
		const members = await this.tenancy.members(tenant);
		const artist = proof.artistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === proof.artistId,
				)
			: undefined;
		// askedForYou marks the project's artist here: "for your project".
		const recipients = inquiryRecipients(members, artist?.userId ?? null);
		const emails = options.emails ?? env.get("ALERT_EMAILS") !== false;
		const url = dashboardUrl(
			env.get("APP_URL"),
			paymentsCardPath(studio.slug, proof.projectId),
		);

		return withTransaction(async (trx) => {
			const inserted = await insertAlerts(
				trx,
				tenant,
				{
					kind: "deposit_proof",
					projectId: proof.projectId,
					paymentId: proof.paymentId,
				},
				recipients.map(({ userId }) => userId),
			);
			const alerted = recipients.filter(({ userId }) => inserted.has(userId));
			if (emails) {
				for (const recipient of alerted) {
					await sendMailInTransaction(
						new DepositProofMail({
							to: recipient.email,
							recipientName: recipient.fullName,
							studioName: studio.name,
							intro: proofIntro({
								clientName: proof.clientName,
								studioName: studio.name,
								yourProject: recipient.askedForYou,
							}),
							forOwner: recipient.role === "owner",
							url,
						}),
						trx,
					);
				}
			}
			return alerted.map(({ userId }) => userId);
		});
	}
```

(e) Replace the whole `insertAlerts` function at the end of the file (from `/** Inserts one new-inquiry alert per user` to the end) with:

```ts
/** What one alert row names: an inquiry, or a payment and its project (TAT-88). */
type AlertSubject =
	| { kind: "new_inquiry"; inquiryId: string }
	| { kind: "deposit_proof"; projectId: string; paymentId: string };

/** Inserts one alert per user about `subject`, skipping those that exist; returns the users inserted now. */
async function insertAlerts(
	trx: TransactionClientContract,
	tenant: TenantRef,
	subject: AlertSubject,
	userIds: string[],
): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();
	const inquiryId = subject.kind === "new_inquiry" ? subject.inquiryId : null;
	const projectId = subject.kind === "deposit_proof" ? subject.projectId : null;
	const paymentId = subject.kind === "deposit_proof" ? subject.paymentId : null;
	const { rows } = await trx.rawQuery(
		`insert into staff_alerts (tenant_id, user_id, kind, inquiry_id, project_id, payment_id, created_at)
		 values ${userIds.map(() => "(?, ?, ?, ?, ?, ?, now())").join(", ")}
		 on conflict do nothing
		 returning user_id`,
		userIds.flatMap((userId) => [
			tenant.id,
			userId,
			subject.kind,
			inquiryId,
			projectId,
			paymentId,
		]),
	);
	return new Set((rows as { user_id: string }[]).map((row) => row.user_id));
}
```

Also update the class doc comment's first line from `Staff alerts (TAT-52): made by the jobs that learn of an event,` to `Staff alerts (TAT-52, TAT-88): made by the jobs that learn of an event,` (the rest unchanged).

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alert_service.spec.ts --files=new_inquiry_alert_job.spec.ts --files=new_inquiry_alert_flow.spec.ts`
Expected: PASS, the TAT-52 tests unchanged plus 7 new. Then `typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/services/alert_service.ts apps/platform/tests/functional/notifications/alert_service.spec.ts
git -C <repo> add apps/platform/app/modules/notifications/services/alert_service.ts apps/platform/tests/functional/notifications/alert_service.spec.ts
git -C <repo> commit -m "feat(platform): alert owners and the project's artist to a deposit screenshot once" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The job sends the alert

**Files:**
- Modify: `apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts`
- Test: `apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts` (add 2 tests; the existing 2 stay unchanged)

**Interfaces:**
- `DepositProofAlertJob { tenantId, paymentId }`: unchanged payload; now calls `AlertService.depositProof` after its log line.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts`:

(a) Add these imports (Biome orders them):

```ts
import queue from "@adonisjs/queue/services/main";
import StaffAlert from "#modules/notifications/models/staff_alert";
import TattooProject from "#modules/projects/models/tattoo_project";
```

(b) In `test.group("DepositProofAlertJob", (group) => {`, after `group.each.setup(() => testUtils.db().wrapInGlobalTransaction());`, add:

```ts
	group.each.teardown(() => queue.restore());
```

(c) At the end of the group (before its closing `});`), add:

```ts
	test("alerts the studio's owner through AlertService, once however often it runs", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alert-proof-job-88");
		const payment = await paymentIn(tenant);
		const fake = queue.fake();

		await run({ tenantId: tenant.id, paymentId: payment.id });
		await run({ tenantId: tenant.id, paymentId: payment.id });

		const rows = await inTenant(tenant, () =>
			StaffAlert.query().where("payment_id", payment.id),
		);
		assert.deepEqual(
			rows.map(({ userId, kind, projectId }) => [userId, kind, projectId]),
			[[owner.id, "deposit_proof", payment.projectId]],
		);
		assert.lengthOf(
			fake.getPushedJobs().filter(({ job }) => job.name === "SendMailJob"),
			1,
		);
	});

	test("a deleted project's or a decided payment's proof alerts nobody", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-proof-gone-88");
		const orphan = await paymentIn(tenant);
		await inTenant(tenant, async () =>
			(await TattooProject.findOrFail(orphan.projectId)).softDelete(),
		);
		const decided = await paymentIn(tenant, {
			status: "verified",
			verifiedAt: DateTime.utc(),
		});

		for (const paymentId of [orphan.id, decided.id]) {
			await run({ tenantId: tenant.id, paymentId });
		}

		assert.lengthOf(await inTenant(tenant, () => StaffAlert.query()), 0);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=deposit_proof_alert_job.spec.ts`
Expected: FAIL in "alerts the studio's owner through AlertService…" (no rows); the other three pass (the deleted-project one passes for the wrong reason until Step 3, which is fine: Step 4 keeps it as a guard).

- [ ] **Step 3: Write the job**

Replace the whole of `apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts` with:

```ts
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import ClientService from "#modules/clients/services/client_service";
import AlertService from "#modules/notifications/services/alert_service";
import Payment from "#modules/payments/models/payment";
import ProjectService from "#modules/projects/services/project_service";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; paymentId: string };

/**
 * Alerts a studio's staff that a client sent a deposit proof from the
 * deposit page. DepositPageService.submitProof (TAT-65) queues it in the
 * payment's transaction, so it exists exactly when the payment does. It logs
 * the ids (never the link, the token, a URL or the amount), then
 * AlertService.depositProof alerts the owners and the project's artist's
 * member in the dashboard and by email (TAT-88), once each however often
 * the job runs. A payment that is gone or already decided, or a deleted
 * project, needs no alert.
 */
export default class DepositProofAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, paymentId } = this.payload;
		const payment = await Payment.query()
			.where("tenant_id", tenantId)
			.where("id", paymentId)
			.first();
		if (!payment || payment.status !== "submitted") return;
		logger.info(
			{ tenantId, projectId: payment.projectId, paymentId },
			"Deposit proof received.",
		);

		const tenant = { id: tenantId };
		const projects = await app.container.make(ProjectService);
		const project = await projects.findLive(tenant, payment.projectId);
		if (!project) return;
		const clients = await app.container.make(ClientService);
		const client = await clients.find(tenant, project.clientId);
		const alerts = await app.container.make(AlertService);
		await alerts.depositProof(tenant, {
			paymentId: payment.id,
			projectId: project.id,
			artistId: project.artistId,
			clientName: client?.name ?? "",
		});
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, paymentId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, paymentId },
			"Alerting staff to a deposit proof failed.",
		);
	}
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=deposit_proof_alert_job.spec.ts --files=deposit_page_service.spec.ts --files=deposits.spec.ts`
Expected: PASS: 4 job tests (2 new), the deposit page's tests unchanged (its "a failure later in the request deletes the image and drops the alert" is the rollback with the payment). Then `typecheck`: clean. Check the worker still loads the job: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace list > /dev/null && echo boots` → `boots`.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts
git -C <repo> add apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts
git -C <repo> commit -m "feat(platform): send the deposit-proof alert from its job" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Opening at the Payments card, and the words

**Files:**
- Modify: `apps/platform/app/controllers/alerts_controller.ts` (`open`)
- Modify: `apps/platform/inertia/components/alerts.ts` (`emptyAlertsText`), `apps/platform/start/mail.ts` (the boot warning)
- Test: `apps/platform/tests/functional/notifications/alerts_http.spec.ts` (add 3 tests), `apps/platform/tests/unit/inertia/alerts_copy.spec.ts` (change one expected string)

**Interfaces:**
- `POST /t/:tenant/alerts/:id/open` (unchanged route): for a deposit-proof alert, an Inertia request gets 409 with `X-Inertia-Location: /t/<slug>/projects/<id>#payments`; any other request a 302 to the same URL. New-inquiry alerts answer as before.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/notifications/alerts_http.spec.ts`:

(a) Replace

```ts
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
```

with

```ts
import {
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
```

(b) After the `alertFor` function, add:

```ts
/** An alert of `userId` about a deposit screenshot on a fresh project. */
async function proofAlertFor(tenant: { id: string }, userId: string) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		});
		const payment = await makePayment(tenant, project);
		return StaffAlert.create({
			tenantId: tenant.id,
			userId,
			kind: "deposit_proof",
			projectId: project.id,
			paymentId: payment.id,
		});
	});
}
```

(c) At the end of the group, add:

```ts
	test("a deposit-proof alert reads its line and opens the project's Payments card", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await proofAlertFor(tenant, owner.id);

		const list = (await client.get(alertsPage()).withInertia().loginAs(owner))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "Deposit screenshot to check",
			detail: "Open the project's Payments card.",
		});

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/black-needle/projects/${alert.projectId}#payments`,
		);
		assert.isNotNull((await reload(tenant, alert)).readAt);
	});

	test("from the dashboard, opening it is a location visit that keeps #payments", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await proofAlertFor(tenant, owner.id);

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.withInertia()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(409);
		response.assertHeader(
			"x-inertia-location",
			`/t/black-needle/projects/${alert.projectId}#payments`,
		);
		assert.isNotNull((await reload(tenant, alert)).readAt);
	});

	test("the project's artist gets the artist's line and the same Payments card", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const alert = await proofAlertFor(tenant, artist.id);

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "A deposit screenshot for your project",
			detail: "An owner checks it on the Payments card.",
		});

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);
		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/black-needle/projects/${alert.projectId}#payments`,
		);
	});
```

(If `.withInertia()` on a POST is refused by the test client, use `.header("x-inertia", "true")` in its place, as `tests/functional/api/stateless.spec.ts` does, and say so in your report.)

In `apps/platform/tests/unit/inertia/alerts_copy.spec.ts`, replace

```ts
			"No alerts yet. New inquiries show up here.",
```

with

```ts
			"No alerts yet. New inquiries and deposit screenshots show up here.",
```

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alerts_http.spec.ts` and `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=alerts_copy.spec.ts`
Expected: FAIL: the two owner tests get `/t/black-needle/projects/<id>` without `#payments` (302, not 409, for the Inertia one); the artist's test passes its list check and fails on the location; the copy test fails on the old sentence. The TAT-52 tests pass.

- [ ] **Step 3: Write the code**

In `apps/platform/app/controllers/alerts_controller.ts`:

(a) Add the import (Biome orders it):

```ts
import router from "@adonisjs/core/services/router";
```

(b) Replace the `open` method (from `/** Marks the alert read and goes where it points: never a URL from the request. */` to its closing brace) with:

```ts
	/**
	 * Marks the alert read and goes where it points: never a URL from the
	 * request. A target with a fragment (a deposit proof's Payments card,
	 * TAT-88) is a location visit for the dashboard's Inertia requests: an
	 * Inertia visit follows a redirect without its fragment, so the page
	 * would open at the top; a full load of the URL keeps it.
	 */
	async open(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const alert = await this.alerts.open(
			tenant,
			membership.userId,
			ctx.params.id,
		);
		const target = alertTarget(alert, membership.role);
		if (!target) {
			return ctx.response
				.redirect()
				.toRoute("tenant.alerts.index", { tenant: tenant.slug });
		}
		const params = { tenant: tenant.slug, id: target.id };
		if ("hash" in target) {
			const path = `${router.makeUrl(target.route, params)}#${target.hash}`;
			if (ctx.inertia.requestInfo().isInertiaRequest) {
				return ctx.inertia.location(path);
			}
			return ctx.response.redirect().toPath(path);
		}
		return ctx.response.redirect().toRoute(target.route, params);
	}
```

In `apps/platform/inertia/components/alerts.ts`, replace

```ts
		: "No alerts yet. New inquiries show up here.";
```

with

```ts
		: "No alerts yet. New inquiries and deposit screenshots show up here.";
```

and change the file's first comment line from `The words of the alerts page and the bell (TAT-52).` to `The words of the alerts page and the bell (TAT-52, TAT-88).`.

In `apps/platform/start/mail.ts`, replace

```ts
// Said once per process, at boot: alerts still reach the dashboard (TAT-52).
if (env.get("ALERT_EMAILS") === false) {
	logger.warn(
		"Staff alert emails are off (ALERT_EMAILS=false): new inquiries alert the dashboard only.",
	);
}
```

with

```ts
// Said once per process, at boot: alerts still reach the dashboard (TAT-52, TAT-88).
if (env.get("ALERT_EMAILS") === false) {
	logger.warn(
		"Staff alert emails are off (ALERT_EMAILS=false): new inquiries and deposit screenshots alert the dashboard only.",
	);
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alerts_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts` and `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=alerts_copy.spec.ts`
Expected: PASS: 3 new HTTP tests, TAT-52's unchanged (an owner's new-inquiry alert still 302s to the inbox), the isolation cases unchanged. Then `typecheck` (server and inertia): clean. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and `git -C <repo> status --short apps/platform/.adonisjs`: commit whatever it changed (likely nothing).

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/alerts_controller.ts apps/platform/inertia/components/alerts.ts apps/platform/start/mail.ts apps/platform/tests/functional/notifications/alerts_http.spec.ts apps/platform/tests/unit/inertia/alerts_copy.spec.ts
git -C <repo> add apps/platform/app/controllers/alerts_controller.ts apps/platform/inertia/components/alerts.ts apps/platform/start/mail.ts apps/platform/tests/functional/notifications/alerts_http.spec.ts apps/platform/tests/unit/inertia/alerts_copy.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): open a deposit-proof alert at the project's Payments card" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs

**Files:**
- Modify: `apps/platform/docs/jobs-and-email.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/deploy.md`, `apps/platform/.env.example`
- Modify: `docs/requirements.md`, `docs/data-model.md`

- [ ] **Step 1: jobs-and-email.md**

Replace the bullet that starts `- Deposit proofs (TAT-65): \`DepositPageService.submitProof\` queues \`DepositProofAlertJob { tenantId, paymentId }\`` (one line) with:

```markdown
- Deposit proofs (TAT-65, TAT-88): `DepositPageService.submitProof` queues `DepositProofAlertJob { tenantId, paymentId }` in the payment's transaction, so it exists exactly when the payment does. For a payment still `submitted` it logs "Deposit proof received." with the tenant, project and payment ids (never the link, the token, a URL or the amount), reads the live project (none: no alert) and its client's name, and calls `AlertService.depositProof`: every live owner, and the member linked to the project's live artist profile, gets one `staff_alerts` row (`kind = 'deposit_proof'`, `project_id`, `payment_id`) and one `DepositProofMail`, once per payment (unique `(user_id, payment_id)`, the same `on conflict do nothing` and `sendMailInTransaction` as new inquiries). A client's next screenshot is a new payment (possible only after a rejection) and alerts again. The email holds the client's first name and the project's Payments card link (`APP_URL` + `/t/<slug>/projects/<id>#payments`); never the amount, the method, the reference code, the deposit link or the phone, and its subject has no client data. `ALERT_EMAILS=false` keeps the in-app alerts and queues no email. The Projects badge (`proofCount`) still counts the screenshots that wait.
```

- [ ] **Step 2: backend.md**

In the bullet that starts `- Staff alerts (TAT-52): the \`notifications\` module`, replace its last sentence `The deposit-proof alert is a follow-up.` with:

```markdown
`depositProof(tenant, { paymentId, projectId, artistId, clientName })` (from `DepositProofAlertJob`, TAT-88) applies the same rule with the project's artist in place of the asked-for one, once per member and payment; `insertAlerts` takes the row's subject (an inquiry, or a payment and its project, checked by `staff_alerts_subject_matches_kind` and a composite key to `payments`). A deposit-proof alert opens its project at the Payments card for any role (`alertTarget` gives the `#payments` fragment); `AlertsController.open` answers an Inertia request for such a target with `inertia.location`, because an Inertia visit follows a redirect without its fragment.
```

- [ ] **Step 3: deploy.md**

(a) In the bullet that starts `- Mail (TAT-52): new inquiries email the studio's owners and the asked-for artist from the worker.`, replace that first sentence with `- Mail (TAT-52, TAT-88): new inquiries email the studio's owners and the asked-for artist, and deposit screenshots the owners and the project's artist, from the worker.` (the rest of the bullet unchanged).

(b) In "Accepted denial costs", replace `and TAT-52's alerts cover new inquiries only, not a form at its limit)` with `and the staff alerts cover new inquiries and deposit screenshots only, not a form at its limit: TAT-88 ruling 12)`.

(c) After the smoke-check bullet `- With \`ALERT_EMAILS\` on, send one inquiry to your own studio…`, add:

```markdown
- With `ALERT_EMAILS` on, send one deposit screenshot to your own studio's deposit link and check the owner's mailbox for "Deposit screenshot for …"; its button opens the project at the Payments card.
```

- [ ] **Step 4: .env.example**

Replace

```
# Staff alert emails (TAT-52): unset or true sends them (Mailpit catches them
# in development); false keeps alerts in the dashboard only. Keep it false in
```

with

```
# Staff alert emails (TAT-52: new inquiries; TAT-88: deposit screenshots):
# unset or true sends them (Mailpit catches them in development); false keeps
# alerts in the dashboard only. Keep it false in
```

- [ ] **Step 5: requirements.md and data-model.md**

In `docs/requirements.md`:
(a) in the deposit page's rule (the line that starts `- An owner makes a project's deposit link while its deposit is due;`), replace `and takes one screenshot at a time, which owners are alerted to.` with `and takes one screenshot at a time, which the owners and the project's artist are alerted to, once per screenshot, by email and under the bell.`;
(b) in the Notifications rule (the line that starts `- A new inquiry alerts each owner, and the artist the client asked for`), add at its end: ` A deposit screenshot alerts the owners and the project's artist the same way (the client's first name, never the amount; the link opens the project's Payments card).`

In `docs/data-model.md`, replace the StaffAlert row's text `One member's alert about one event (a new inquiry so far): the member, the kind, the event's id and when it was read. Ids only, no client data` with `One member's alert about one event, a new inquiry or a deposit screenshot (the payment and its project): the member, the kind, the event's ids and when it was read. Ids only, no client data`.

- [ ] **Step 6: Check and commit**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check` → clean.

```bash
git -C <repo> add apps/platform/docs/jobs-and-email.md apps/platform/docs/backend.md apps/platform/docs/deploy.md apps/platform/.env.example docs/requirements.md docs/data-model.md
git -C <repo> commit -m "docs: describe the deposit-proof alert" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full suite** (background): `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/final.log 2>&1`. Expected: PASS, the `Tests` line 19 higher than the baseline: unit `alerts.spec.ts` +2, `deposit_proof_mail.spec.ts` +4; functional `staff_alerts_table.spec.ts` +1, `alert_service.spec.ts` +7, `deposit_proof_alert_job.spec.ts` +2, `alerts_http.spec.ts` +3 (`alerts_copy.spec.ts` changed, not added).
- [ ] **Step 2: Gates**: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `… pnpm -C <repo> typecheck`, `… pnpm -C <repo> build`: clean. `… pnpm -C <repo>/apps/platform exec node ace codegen` then `git -C <repo> status --short` → nothing uncommitted.
- [ ] **Step 3: Report**: the commits, the database the migration ran on, any deviation from the plan.

### Task 9: Browser pass

Follow the spec's "Browser pass" (dev server on `PORT=3401` with `<db-env>`, the worker with `APP_URL=http://localhost:3401 SMTP_HOST=127.0.0.1 SMTP_PORT=1025`, Mailpit). Record what each step showed, at 375 px and 1280 px, light and dark; in particular that tapping the alert lands on the Payments card (not the top of the page) and that the bell's count drops.
