# Finish a project and the healing check (TAT-111, covers TAT-87) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner marks an in-progress tattoo finished (`in_progress` → `healing_check`) and later closes its healing check (`healing_check` → `completed`), from a Finish card on the project page with an inline confirmation. A balance still due is named and must be confirmed at its exact amount; a scheduled session must get its outcome first; a stale tab or a second tap is refused under the project's row lock. The healing check is due 28 days after the last tattoo session (computed), takes touch-up sessions only, and the aftercare message asks for a healed photo. Closed projects hide the artist picker and "Mark contacted"; the board flags a finished fixed-price project that still owes. About 4 points.

**Architecture:** A pure module `app/modules/projects/finish.ts` (steps, refusal rule, due day, flash). `DepositService.balance` gives `ProjectService` the balance without a cycle (PaymentService depends on ProjectService). `ProjectService.requireOwner`, `finish`, `completeHealingCheck` (one private `finishStep` under `lockFor`). Two routes on `ProjectChangesController`. `schedule_rules.ts` gains `schedulableKinds` and a kind-aware `scheduleRefusal` (`touch_ups_only`). `PaymentService.listFlags` gains `balanceOwed`. The page gets `finish`, `closed` and `scheduling.kinds`; a new `inertia/components/finish_card.tsx` with its words in `inertia/components/finish.ts`. No migration, no setting, no API.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, VineJS, Luxon, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4; Tuyau `urlFor`.

**Spec:** `docs/superpowers/specs/2026-10-20-tat-111-finish-a-project-and-the-healing-check-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides; say which in your report). `<scratchpad>` is your session's scratchpad directory. `<test-db>` is the isolated database the coordinator gave you (for example `tattoo_drip_ux`). The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **Never touch the user's database `tattoo_drip`, port 3333 or 3000, or a process you did not start.** Every `node ace` and test command carries `DB_DATABASE=<test-db>` (the tests otherwise use `.env`'s database). Never read or edit `apps/platform/.env`.
- **No migration, no `database/schema.ts` change, no new setting, no dependency.** If you think you need one, stop and report.
- **Routes (exact):** `POST /t/:tenant/projects/:id/finish` `tenant.projects.finish.store` and `POST /t/:tenant/projects/:id/complete` `tenant.projects.complete.store`, in the existing `/projects` group, `ProjectChangesController.finish` / `complete`, `.where("id", router.matchers.uuid())`. Body: `confirmedDue` (optional, 1 to 20 digits).
- **Copy (verbatim).** Card: `Finish the tattoo`, `Healing check`, `Once the work is done, mark the tattoo finished. Its healing check will be due {day}, four weeks after the last tattoo session.`, `Once the work is done, mark the tattoo finished. Its healing check comes next.`, `Due {day}. ` / `Was due {day}. ` + `Ask the client for a photo of the healed tattoo. If it needs a touch-up, schedule a touch-up session under Sessions.`, `Balance due: {amount}.` / `Balance due: {amount} (estimated).`, `Record or cancel the scheduled session under Sessions first.`, `Mark the tattoo finished`, `Healing check done`, `Mark finished`, `Close the project`, `Not yet`, `Saving…`. Questions and flashes: see Task 1 and Task 6 code. Refusals: `This project can't make that change in its current status.`, `Record or cancel the scheduled session first.`, `The balance changed since this page loaded. Check it and try again.`, `The healing check takes touch-up sessions only.`. Field error: `Reload the page and try again.`. Badge: `balance due`.
- Fixture slugs in new tests end in `-111` (`finish-needle-111`, `finish-desk-111`). Tests added to an existing file keep that file's studio.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.` (no new injected class in this plan).
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities and tokens only), touch targets 44 px (`h-11`), nothing wider than 375 px, no `window.confirm`.
- Tests: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`; the full suite takes about 2 minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`). Empty `queue_jobs` in `<test-db>` before the full suite (a known pitfall of the isolated database).
- Never hand-edit `.adonisjs/`. After the route change (Task 4) run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- The pre-commit hook runs Biome on staged files and may rewrite them (import order): re-read a file before editing it again.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 8), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **The step rule is decided under the project's lock, from live rows.** Status, scheduled sessions and the balance are read after `lockFor`; a second tap or a stale tab is refused. Tests: Task 2 "two tabs: the second tap on either step is refused and changes nothing", "two tabs: a payment or a new session since the page loaded is caught under the lock"; Task 1 `finishRefusal` group.
2. **A balance due is confirmed at its exact amount, never blocked, never silently skipped.** Tests: Task 2 "money still owed must be confirmed at exactly its amount", "nothing owed needs no confirmation…"; Task 4 "money owed: the confirmation must name it…".
3. **Owners only, 404 not 403, before the body is read.** Tests: Task 2 "owners only: the assigned artist gets a 404…"; Task 4 "only owners: the assigned artist gets a 404 on both routes, whatever the body"; the two `cases.ts` entries.
4. **Money and deposits are untouched by finishing.** No outcome asked (`completed` is not in `CLOSED_FOR_OUTCOME`), payments still recordable. Tests: Task 2 "money after finishing…".
5. **Touch-ups only during the check; nothing reopens a finished project.** Tests: Task 3's unit and functional tests; Task 5 "the healing check's Sessions card offers touch-ups only, and a tattoo session is refused".

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> branch --show-current` → `harublank00/tat-111-finish-a-project-and-the-healing-check`; `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -1 -- docs/superpowers/plans/2026-10-20-tat-111-finish-a-project-and-the-healing-check.md` → the plan commit "docs: plan TAT-111 …".

- [ ] **Step 2: The base holds TAT-98**

Run: `git -C <repo> merge-base --is-ancestor 65eab5f HEAD && echo base-ok` → `base-ok`. **If it prints nothing, STOP** and ask the coordinator.

- [ ] **Step 3: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -n 'export const PROJECT_RULE_REASONS = \["move_not_allowed"\] as const;' -- apps/platform/app/modules/projects/errors.ts
git -C <repo> grep -n '"project_finished",' -- apps/platform/app/modules/scheduling/errors.ts
git -C <repo> grep -n 'const refusal = scheduleRefusal(live.status);' -- apps/platform/app/modules/scheduling/services/session_service.ts
git -C <repo> grep -n 'scheduleRefusal(project.status) === null && bookable.length > 0' -- apps/platform/app/controllers/projects_controller.ts
git -C <repo> grep -n 'quoteLapsed: flags.get(project.id)?.quoteLapsed ?? false,' -- apps/platform/app/controllers/projects_controller.ts
git -C <repo> grep -n 'flags.set(project.id, { proofWaiting, depositToSettle, quoteLapsed });' -- apps/platform/app/modules/payments/services/payment_service.ts
git -C <repo> grep -n 'async verifiedPaid(' -- apps/platform/app/modules/payments/services/deposit_service.ts
git -C <repo> grep -n 'move_not_allowed:' -- apps/platform/app/controllers/project_changes_controller.ts
git -C <repo> grep -n '.as("tenant.projects.artist.update");' -- apps/platform/start/routes.ts
git -C <repo> grep -n '<ContactLine text={contactedText} onMark={() => markContacted()} />' -- apps/platform/inertia/pages/projects/show.tsx
git -C <repo> grep -n 'defaultValue="tattoo"' -- apps/platform/inertia/components/sessions_card.tsx
git -C <repo> grep -n 'session: scheduled.session,' -- apps/platform/tests/helpers/tenants.ts
git -C <repo> grep -n '| "sessionProject"' -- apps/platform/tests/isolation/cases.ts
git -C <repo> grep -n 'healing_check: "project_finished",' -- apps/platform/tests/functional/scheduling/session_scheduling.spec.ts apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts
git -C <repo> grep -n 'Message us here if anything worries you.",' -- apps/platform/app/modules/notifications/messages.ts
```

Each of these must print nothing:

```
git -C <repo> grep -n 'touch_ups_only\|healingCheckDueOn\|completeHealingCheck\|balanceOwed\|tenant.projects.finish' -- apps/platform
git -C <repo> ls-files apps/platform/app/modules/projects/finish.ts apps/platform/inertia/components/finish_card.tsx apps/platform/inertia/components/finish.ts
```

And `ls <repo>/apps/platform/database/migrations | tail -1` → `1791680000002_create_account_tokens_table.ts` (it must still be the last one when you finish).

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 4: Install and environment**

If `<repo>/node_modules` is missing: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Check the env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok`. Check `<test-db>` is migrated: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` lists every migration up to `1791680000002` as completed.

- [ ] **Step 5: Baseline**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_changes.spec.ts --files=project_page.spec.ts --files=projects_list.spec.ts --files=session_scheduling.spec.ts --files=project_scheduling_http.spec.ts --files=payment_reads.spec.ts --files=project_payments_card.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> PORT=3402 pnpm -C <repo>/apps/platform test unit --files=schedule_rules.spec.ts --files=messages.spec.ts --files=moves.spec.ts --files=project_messages.spec.ts --files=status_groups.spec.ts`. Expected: PASS. Then the full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline-111.log 2>&1`; record its `Tests` line (the final count must be 37 higher; Task 9 has the breakdown).

---

### Task 1: The finishing rules (pure)

**Files:**
- Create: `apps/platform/app/modules/projects/finish.ts`
- Modify: `apps/platform/app/modules/projects/errors.ts`, `apps/platform/app/controllers/project_changes_controller.ts` (its `RULE_MESSAGES` only, so the `Record` stays complete)
- Test: `apps/platform/tests/unit/modules/projects/finish.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/projects/finish`: `FINISH_STEPS`, `type FinishStep`, `FINISHED_STATUSES`, `HEALING_CHECK_DAYS`, `type FinishRefusal`, `type FinishFacts`, `type FinishResult`, `finishStepFor(status)`, `finishRefusal(step, facts)`, `owed(due)`, `healingCheckDueOn(sessions, timezone)`, `owedNote(due, estimated)`, `finishedFlash(step, result)`.
- `PROJECT_RULE_REASONS` becomes `["move_not_allowed", "session_scheduled", "balance_changed"]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/projects/finish.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	FINISH_STEPS,
	FINISHED_STATUSES,
	finishedFlash,
	finishRefusal,
	finishStepFor,
	HEALING_CHECK_DAYS,
	healingCheckDueOn,
	owed,
} from "#modules/projects/finish";
import { PROJECT_STATUSES } from "#modules/projects/models/tattoo_project";
import type {
	SessionKind,
	SessionStatus,
} from "#modules/scheduling/models/project_session";

const KTM = "Asia/Kathmandu";

/** Nothing scheduled, nothing owed, nothing confirmed. */
const clear = { sessionScheduled: false, due: 0n, confirmedDue: null };

const session = (kind: SessionKind, status: SessionStatus, endsAt: DateTime) => ({
	kind,
	status,
	endsAt,
});

test.group("Finish steps", () => {
	test("in progress finishes into the healing check, which completes", ({
		assert,
	}) => {
		assert.deepEqual(FINISH_STEPS, {
			finish: { from: "in_progress", to: "healing_check" },
			complete: { from: "healing_check", to: "completed" },
		});
		assert.deepEqual([...FINISHED_STATUSES], ["healing_check", "completed"]);
		assert.equal(HEALING_CHECK_DAYS, 28);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [status, finishStepFor(status)]),
			),
			{
				reviewing: null,
				quoted: null,
				on_hold: null,
				deposit_pending: null,
				booked: null,
				in_progress: "finish",
				completed: null,
				healing_check: "complete",
				declined: null,
				cancelled: null,
			},
		);
	});
});

test.group("finishRefusal", () => {
	test("each step only from its own status", ({ assert }) => {
		for (const step of ["finish", "complete"] as const) {
			for (const status of PROJECT_STATUSES) {
				assert.equal(
					finishRefusal(step, { ...clear, status }),
					status === FINISH_STEPS[step].from ? null : "move_not_allowed",
					`${step} from ${status}`,
				);
			}
		}
	});

	test("a scheduled session comes before the balance; the status before both", ({
		assert,
	}) => {
		assert.equal(
			finishRefusal("finish", {
				status: "in_progress",
				sessionScheduled: true,
				due: 500n,
				confirmedDue: null,
			}),
			"session_scheduled",
		);
		assert.equal(
			finishRefusal("complete", {
				...clear,
				status: "healing_check",
				sessionScheduled: true,
			}),
			"session_scheduled",
		);
		assert.equal(
			finishRefusal("finish", {
				status: "booked",
				sessionScheduled: true,
				due: 500n,
				confirmedDue: null,
			}),
			"move_not_allowed",
		);
	});

	test("money owed must be exactly what the owner confirmed; nothing owed needs no confirmation", ({
		assert,
	}) => {
		const owing = {
			status: "in_progress" as const,
			sessionScheduled: false,
			due: 1_200_000n,
		};
		for (const confirmedDue of [null, 0n, 1_000_000n, 1_500_000n]) {
			assert.equal(
				finishRefusal("finish", { ...owing, confirmedDue }),
				"balance_changed",
				String(confirmedDue),
			);
		}
		assert.isNull(
			finishRefusal("finish", { ...owing, confirmedDue: 1_200_000n }),
		);
		assert.isNull(finishRefusal("finish", { ...clear, status: "in_progress" }));
		assert.isNull(
			finishRefusal("finish", {
				...clear,
				status: "in_progress",
				confirmedDue: 1_200_000n,
			}),
		);
	});

	test("owed keeps only money still due", ({ assert }) => {
		assert.equal(owed(null), 0n);
		assert.equal(owed(0n), 0n);
		assert.equal(owed(-50_000n), 0n);
		assert.equal(owed(1_200_000n), 1_200_000n);
	});
});

test.group("healingCheckDueOn", () => {
	test("four weeks after the studio's day the latest tattoo session ended", ({
		assert,
	}) => {
		assert.equal(
			healingCheckDueOn(
				[
					session("tattoo", "completed", DateTime.utc(2026, 10, 1, 10)),
					session("tattoo", "completed", DateTime.utc(2026, 10, 20, 10)),
				],
				KTM,
			),
			"2026-11-17",
		);
		// 20:00 UTC on 1 Nov is 01:45 on 2 Nov in Kathmandu.
		const lateEvening = [
			session("tattoo", "completed", DateTime.utc(2026, 11, 1, 20)),
		];
		assert.equal(healingCheckDueOn(lateEvening, KTM), "2026-11-30");
		assert.equal(healingCheckDueOn(lateEvening, "UTC"), "2026-11-29");
	});

	test("only completed tattoo sessions count", ({ assert }) => {
		assert.equal(
			healingCheckDueOn(
				[
					session("tattoo", "completed", DateTime.utc(2026, 10, 20, 10)),
					session("touch_up", "completed", DateTime.utc(2026, 11, 5, 10)),
					session("consultation", "completed", DateTime.utc(2026, 11, 6, 10)),
					session("tattoo", "scheduled", DateTime.utc(2026, 11, 7, 10)),
					session("tattoo", "no_show", DateTime.utc(2026, 11, 8, 10)),
					session("tattoo", "cancelled", DateTime.utc(2026, 11, 9, 10)),
				],
				KTM,
			),
			"2026-11-17",
		);
		assert.isNull(healingCheckDueOn([], KTM));
		assert.isNull(
			healingCheckDueOn(
				[session("touch_up", "completed", DateTime.utc(2026, 10, 20, 10))],
				KTM,
			),
		);
	});
});

test.group("finishedFlash", () => {
	test("says when the healing check is due and points at the aftercare message", ({
		assert,
	}) => {
		const none = { due: 0n, estimated: false };
		assert.equal(
			finishedFlash("finish", { ...none, dueOn: "2026-11-17" }),
			"Tattoo finished: the healing check is due 17 Nov 2026. Send the aftercare message from Message the client.",
		);
		assert.equal(
			finishedFlash("finish", { ...none, dueOn: null }),
			"Tattoo finished: the healing check is next. Send the aftercare message from Message the client.",
		);
		assert.equal(
			finishedFlash("complete", { ...none, dueOn: "2026-11-17" }),
			"Healing check done: the project is completed.",
		);
	});

	test("names money still owed, and an hourly estimate as one", ({
		assert,
	}) => {
		assert.equal(
			finishedFlash("finish", {
				dueOn: "2026-11-17",
				due: 1_200_000n,
				estimated: false,
			}),
			"Tattoo finished: the healing check is due 17 Nov 2026. Send the aftercare message from Message the client. NPR 12,000 of the balance is still due: record it under Payments when it's paid.",
		);
		assert.equal(
			finishedFlash("complete", {
				dueOn: null,
				due: 150_050n,
				estimated: true,
			}),
			"Healing check done: the project is completed. NPR 1,500.50 of the estimated balance is still due: record it under Payments when it's paid.",
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run (RED form): `… timeout 120 pnpm -C <repo>/apps/platform test unit --files=finish.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → 124 with "Cannot find module" for `#modules/projects/finish`.

- [ ] **Step 3: Add the rule reasons**

In `apps/platform/app/modules/projects/errors.ts` replace:

```ts
export const PROJECT_RULE_REASONS = ["move_not_allowed"] as const;
export type ProjectRuleReason = (typeof PROJECT_RULE_REASONS)[number];

const PROJECT_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed: "The project's status does not allow that move",
};
```

with:

```ts
export const PROJECT_RULE_REASONS = [
	"move_not_allowed",
	"session_scheduled",
	"balance_changed",
] as const;
export type ProjectRuleReason = (typeof PROJECT_RULE_REASONS)[number];

const PROJECT_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed: "The project's status does not allow that move",
	session_scheduled:
		"A session is still scheduled: it needs its outcome before the project finishes",
	balance_changed: "The balance due is not the amount the owner confirmed",
};
```

In `apps/platform/app/controllers/project_changes_controller.ts` replace:

```ts
const RULE_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed:
		"This project can't make that change in its current status.",
};
```

with:

```ts
const RULE_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed:
		"This project can't make that change in its current status.",
	session_scheduled: "Record or cancel the scheduled session first.",
	balance_changed:
		"The balance changed since this page loaded. Check it and try again.",
};
```

- [ ] **Step 4: Write the module**

Create `apps/platform/app/modules/projects/finish.ts`:

```ts
import { DateTime } from "luxon";
import type { ProjectRuleReason } from "#modules/projects/errors";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { formatDay, formatMoney } from "#modules/projects/quotes";
import type {
	SessionKind,
	SessionStatus,
} from "#modules/scheduling/models/project_session";

/**
 * Finishing a project (TAT-111, which also covers TAT-87): the owner marks
 * the tattoo finished (`in_progress` to `healing_check`), then closes its
 * healing check (`healing_check` to `completed`). Pure, so the rules are
 * unit-tested; ProjectService applies them under the project's row lock and
 * the project page offers only what they allow.
 */
export const FINISH_STEPS = {
	finish: { from: "in_progress", to: "healing_check" },
	complete: { from: "healing_check", to: "completed" },
} as const;
export type FinishStep = keyof typeof FINISH_STEPS;

/** A finished project: in its healing check, or completed. */
export const FINISHED_STATUSES: readonly ProjectStatus[] = [
	"healing_check",
	"completed",
];

/** Days from the last tattoo session to its healing check. */
export const HEALING_CHECK_DAYS = 28;

/** Why a step is refused: the status moved on, a session waits, or the balance changed. */
export type FinishRefusal = Extract<
	ProjectRuleReason,
	"move_not_allowed" | "session_scheduled" | "balance_changed"
>;

/** What finishRefusal reads, from the locked project. */
export type FinishFacts = {
	status: ProjectStatus;
	/** A session of any kind is still scheduled. */
	sessionScheduled: boolean;
	/** What is still owed now, in paisa (owed): 0n when nothing is. */
	due: bigint;
	/** What the owner's confirmation named, in paisa; null when the page sent nothing. */
	confirmedDue: bigint | null;
};

/** What a step did, for its flash. */
export type FinishResult = {
	/** The healing check's day (yyyy-MM-dd), or null without a completed tattoo session. */
	dueOn: string | null;
	/** What is still owed, in paisa. */
	due: bigint;
	/** The balance is an hourly estimate. */
	estimated: boolean;
};

/** The step a project in `status` offers, or null. */
export function finishStepFor(status: ProjectStatus): FinishStep | null {
	if (status === FINISH_STEPS.finish.from) return "finish";
	if (status === FINISH_STEPS.complete.from) return "complete";
	return null;
}

/**
 * Why `step` can't be taken now, or null when it can; the first rule that
 * fails wins. The project must still be in the step's status (a second tap
 * or a stale tab finds it moved on), no session may be scheduled, and money
 * still owed must be exactly what the owner confirmed: a payment recorded or
 * reversed since the page loaded changes it. Nothing owed needs no
 * confirmation.
 */
export function finishRefusal(
	step: FinishStep,
	facts: FinishFacts,
): FinishRefusal | null {
	if (facts.status !== FINISH_STEPS[step].from) return "move_not_allowed";
	if (facts.sessionScheduled) return "session_scheduled";
	if (facts.due > 0n && facts.confirmedDue !== facts.due) {
		return "balance_changed";
	}
	return null;
}

/**
 * What is still owed of a balance due (Balance.due): the amount when above
 * zero, else 0n (paid in full, overpaid, or no price).
 */
export function owed(due: bigint | null): bigint {
	return due !== null && due > 0n ? due : 0n;
}

/** What healingCheckDueOn reads of a session. */
type SessionFacts = {
	kind: SessionKind;
	status: SessionStatus;
	endsAt: DateTime;
};

/**
 * The day the healing check is due (yyyy-MM-dd in the studio's timezone):
 * HEALING_CHECK_DAYS after the local day the latest completed tattoo session
 * ended, or null without one. Touch-ups and consultations don't move it.
 * Computed on every read, never stored.
 */
export function healingCheckDueOn(
	sessions: readonly SessionFacts[],
	timezone: string,
): string | null {
	let last: DateTime | null = null;
	for (const session of sessions) {
		if (session.kind !== "tattoo" || session.status !== "completed") continue;
		if (last === null || session.endsAt.toMillis() > last.toMillis()) {
			last = session.endsAt;
		}
	}
	if (last === null) return null;
	const day = last.setZone(timezone).toFormat("yyyy-MM-dd");
	return DateTime.fromISO(day, { zone: "utc" })
		.plus({ days: HEALING_CHECK_DAYS })
		.toFormat("yyyy-MM-dd");
}

/** The flash's sentence about money still owed; "" when nothing is. */
export function owedNote(due: bigint, estimated: boolean): string {
	if (due <= 0n) return "";
	return ` ${formatMoney(due)} of the ${estimated ? "estimated " : ""}balance is still due: record it under Payments when it's paid.`;
}

/** The flash after a step. */
export function finishedFlash(step: FinishStep, result: FinishResult): string {
	const owing = owedNote(result.due, result.estimated);
	if (step === "complete") {
		return `Healing check done: the project is completed.${owing}`;
	}
	const check = result.dueOn
		? `the healing check is due ${formatDay(result.dueOn)}`
		: "the healing check is next";
	return `Tattoo finished: ${check}. Send the aftercare message from Message the client.${owing}`;
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `… pnpm -C <repo>/apps/platform test unit --files=finish.spec.ts` → 9 tests PASS. Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean.

- [ ] **Step 6: Commit**

`git -C <repo> add apps/platform/app/modules/projects/finish.ts apps/platform/app/modules/projects/errors.ts apps/platform/app/controllers/project_changes_controller.ts apps/platform/tests/unit/modules/projects/finish.spec.ts && git -C <repo> commit -m "feat(platform): the rules for finishing a project and its healing check (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 2: The two steps in ProjectService

**Files:**
- Modify: `apps/platform/app/modules/payments/services/deposit_service.ts`, `apps/platform/app/modules/projects/services/project_service.ts`
- Test: `apps/platform/tests/functional/projects/project_finish.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `FINISH_STEPS`, `FinishStep`, `FinishResult`, `finishRefusal`, `healingCheckDueOn`, `owed`.
- Produces: `DepositService.balance(tenant, project): Promise<{ balance: Balance; estimated: boolean }>`; `ProjectService.requireOwner(member): void`, `ProjectService.finish(tenant, member, project, confirmedDue: bigint | null): Promise<Finished>`, `ProjectService.completeHealingCheck(…same…)`, `export type Finished = FinishResult & { status: ProjectStatus }`. `tenant` is `Pick<Tenant, "id" | "timezone">`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/projects/project_finish.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import { ProjectRuleError } from "#modules/projects/errors";
import { healingCheckDueOn } from "#modules/projects/finish";
import TattooProject, {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
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

const { projects, payments, sessions } = paymentServices();

const SLUG = "finish-needle-111";

const statusOf = async (project: TattooProject) =>
	(await TattooProject.findOrFail(project.id)).status;

/** The ProjectRuleError reason `fn` throws, or null when it succeeds. */
async function ruleOf(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		if (error instanceof ProjectRuleError) return error.reason;
		throw error;
	}
	return null;
}

/** A verified payment's decision columns (the database checks they agree). */
const verified = (owner: { id: string }) => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
	verifiedByUserId: owner.id,
});

/** A studio with its owner (as a member) and the artist profile Sita. */
async function setup() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Finish Needle");
	const sita = await inTenant(tenant, () => makeArtist(tenant));
	return { owner, tenant, sita, OWNER: ownerMember(owner) };
}

/**
 * A project in `status` assigned to Sita whose two-hour tattoo session
 * ended `daysAgo` days ago. Give each project of a test its own day: Sita's
 * done sessions keep their time. Call it inside inTenant.
 */
async function workDone(
	tenant: Tenant,
	sita: Artist,
	status: ProjectStatus = "in_progress",
	daysAgo = 7,
) {
	const project = await makeProject(tenant, await makeClient(tenant), {
		status,
		artistId: sita.id,
	});
	const endsAt = DateTime.utc().minus({ days: daysAgo }).startOf("hour");
	await makeSession(tenant, project, sita, {
		startsAt: endsAt.minus({ hours: 2 }),
		endsAt,
		status: "completed",
	});
	return project;
}

test.group("ProjectService: finishing a project (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner finishes the tattoo into its healing check, then completes it", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			const dueOn = healingCheckDueOn(
				await sessions.listForProject(tenant, project),
				tenant.timezone,
			);
			assert.isNotNull(dueOn);

			assert.deepEqual(await projects.finish(tenant, OWNER, project, null), {
				status: "healing_check",
				due: 0n,
				estimated: false,
				dueOn,
			});
			assert.equal(await statusOf(project), "healing_check");

			const completed = await projects.completeHealingCheck(
				tenant,
				OWNER,
				project,
				null,
			);
			assert.equal(completed.status, "completed");
			assert.equal(await statusOf(project), "completed");
			// The sessions stay as they were.
			assert.deepEqual(
				(await sessions.listForProject(tenant, project)).map(
					({ status }) => status,
				),
				["completed"],
			);
		});
	});

	test("each step only from its own status; nothing changes otherwise", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			for (const [index, status] of PROJECT_STATUSES.entries()) {
				if (status === "in_progress") continue;
				const project = await workDone(tenant, sita, status, 3 + index);
				assert.equal(
					await ruleOf(() => projects.finish(tenant, OWNER, project, null)),
					"move_not_allowed",
					status,
				);
				assert.equal(await statusOf(project), status);
			}
			for (const [index, status] of PROJECT_STATUSES.entries()) {
				if (status === "healing_check") continue;
				const project = await workDone(tenant, sita, status, 20 + index);
				assert.equal(
					await ruleOf(() =>
						projects.completeHealingCheck(tenant, OWNER, project, null),
					),
					"move_not_allowed",
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("a scheduled session of any kind must get its outcome first", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			const startsAt = DateTime.utc().plus({ days: 5 }).startOf("hour");
			const consultation = await makeSession(tenant, project, sita, {
				kind: "consultation",
				startsAt,
				endsAt: startsAt.plus({ hours: 1 }),
			});
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, project, null)),
				"session_scheduled",
			);
			assert.equal(await statusOf(project), "in_progress");

			await sessions.cancel(tenant, consultation);
			await projects.finish(tenant, OWNER, project, null);
			assert.equal(await statusOf(project), "healing_check");

			const touchUpAt = startsAt.plus({ days: 1 });
			const touchUp = await makeSession(tenant, project, sita, {
				kind: "touch_up",
				startsAt: touchUpAt,
				endsAt: touchUpAt.plus({ hours: 1 }),
			});
			assert.equal(
				await ruleOf(() =>
					projects.completeHealingCheck(tenant, OWNER, project, null),
				),
				"session_scheduled",
			);
			assert.equal(await statusOf(project), "healing_check");

			await sessions.complete(tenant, touchUp);
			await projects.completeHealingCheck(tenant, OWNER, project, null);
			assert.equal(await statusOf(project), "completed");
		});
	});

	test("money still owed must be confirmed at exactly its amount", async ({
		assert,
	}) => {
		const { owner, tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			// NPR 15,000 with the NPR 3,000 deposit paid: NPR 12,000 owed.
			await makeQuote(tenant, project);
			await makePayment(tenant, project, verified(owner));

			for (const confirmed of [null, 0n, 1_000_000n, 1_500_000n]) {
				assert.equal(
					await ruleOf(() => projects.finish(tenant, OWNER, project, confirmed)),
					"balance_changed",
					String(confirmed),
				);
			}
			assert.equal(await statusOf(project), "in_progress");

			const finished = await projects.finish(tenant, OWNER, project, 1_200_000n);
			assert.deepInclude(finished, {
				status: "healing_check",
				due: 1_200_000n,
				estimated: false,
			});
			// Closing the check asks again, for what is owed then.
			assert.equal(
				await ruleOf(() =>
					projects.completeHealingCheck(tenant, OWNER, project, null),
				),
				"balance_changed",
			);
			assert.equal(
				(
					await projects.completeHealingCheck(
						tenant,
						OWNER,
						project,
						1_200_000n,
					)
				).status,
				"completed",
			);
		});
	});

	test("nothing owed needs no confirmation: paid in full, overpaid or never priced", async ({
		assert,
	}) => {
		const { owner, tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const paid = await workDone(tenant, sita, "in_progress", 7);
			await makeQuote(tenant, paid);
			await makePayment(tenant, paid, {
				kind: "balance",
				amount: 1_500_000,
				...verified(owner),
			});
			const overpaid = await workDone(tenant, sita, "in_progress", 9);
			await makeQuote(tenant, overpaid);
			await makePayment(tenant, overpaid, {
				kind: "balance",
				amount: 1_600_000,
				...verified(owner),
			});
			const unpriced = await workDone(tenant, sita, "in_progress", 11);

			for (const project of [paid, overpaid, unpriced]) {
				const finished = await projects.finish(tenant, OWNER, project, null);
				assert.equal(finished.due, 0n);
				assert.equal(await statusOf(project), "healing_check");
			}
		});
	});

	test("an hourly quote's balance is an estimate, and says so", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			// NPR 3,000 an hour for about 5 hours: NPR 15,000, nothing paid.
			await makeQuote(tenant, project, {
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 300_000,
				estimatedMinutes: 300,
				depositAmount: 0,
			});
			assert.deepInclude(
				await projects.finish(tenant, OWNER, project, 1_500_000n),
				{ due: 1_500_000n, estimated: true },
			);
		});
	});

	test("owners only: the assigned artist gets a 404 and nothing changes", async ({
		assert,
	}) => {
		const { tenant, sita } = await setup();
		const asha = await artistIn(tenant, `asha@${SLUG}.example`);
		const artist = { userId: asha.id, role: "artist" as const };
		await inTenant(tenant, async () => {
			sita.userId = asha.id;
			await sita.save();
			const working = await workDone(tenant, sita, "in_progress", 7);
			const healing = await workDone(tenant, sita, "healing_check", 9);

			assert.throws(() => projects.requireOwner(artist), /Row not found/);
			await assert.rejects(
				() => projects.finish(tenant, artist, working, null),
				/Row not found/,
			);
			await assert.rejects(
				() => projects.completeHealingCheck(tenant, artist, healing, null),
				/Row not found/,
			);
			assert.equal(await statusOf(working), "in_progress");
			assert.equal(await statusOf(healing), "healing_check");
		});
	});

	test("two tabs: the second tap on either step is refused and changes nothing", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			// Both tabs loaded the project while it was in progress.
			const stale = await TattooProject.findOrFail(project.id);

			await projects.finish(tenant, OWNER, project, null);
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, stale, null)),
				"move_not_allowed",
			);
			assert.equal(await statusOf(project), "healing_check");

			await projects.completeHealingCheck(tenant, OWNER, stale, null);
			assert.equal(
				await ruleOf(() =>
					projects.completeHealingCheck(tenant, OWNER, stale, null),
				),
				"move_not_allowed",
			);
			assert.equal(await statusOf(project), "completed");
		});
	});

	test("two tabs: a payment or a new session since the page loaded is caught under the lock", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita, "in_progress", 7);
			await makeQuote(tenant, project, { depositAmount: 0 });
			// The page showed NPR 15,000 owed; another tab took NPR 5,000 at the desk.
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 500_000,
				note: null,
			});
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, project, 1_500_000n)),
				"balance_changed",
			);
			assert.equal(await statusOf(project), "in_progress");
			// Another tab took the rest: nothing is owed, so the old amount no
			// longer matters.
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 1_000_000,
				note: null,
			});
			assert.equal(
				(await projects.finish(tenant, OWNER, project, 1_500_000n)).due,
				0n,
			);

			// Another tab scheduled the next tattoo session: booked again.
			const more = await workDone(tenant, sita, "in_progress", 9);
			const startsAt = DateTime.utc().plus({ days: 4 }).startOf("hour");
			await sessions.scheduleFor(tenant, OWNER, more, {
				artistId: sita.id,
				kind: "tattoo",
				startsAt,
				endsAt: startsAt.plus({ hours: 2 }),
			});
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, more, null)),
				"move_not_allowed",
			);
			assert.equal(await statusOf(more), "booked");
		});
	});

	test("money after finishing: balance payments and refunds still go in, and no deposit outcome is asked", async ({
		assert,
	}) => {
		const { owner, tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			await makeQuote(tenant, project);
			// The NPR 3,000 deposit: NPR 12,000 owed.
			await makePayment(tenant, project, verified(owner));
			await projects.finish(tenant, OWNER, project, 1_200_000n);
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 1_000_000,
				note: null,
			});
			await projects.completeHealingCheck(tenant, OWNER, project, 200_000n);
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 200_000,
				note: null,
			});
			await payments.refund(tenant, OWNER, project, {
				method: "cash",
				amount: 50_000,
				note: null,
			});

			const money = await payments.forProject(
				tenant,
				await TattooProject.findOrFail(project.id),
			);
			assert.isFalse(money.outcomeNeeded);
			assert.equal(money.balance.due, 50_000n);
			assert.equal(await statusOf(project), "completed");
		});
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `… pnpm -C <repo>/apps/platform test functional --files=project_finish.spec.ts` → fails (TypeScript-level: `projects.finish is not a function`; with Japa's transpiler the tests fail at the first call). Typecheck also fails until Step 4.

- [ ] **Step 3: `DepositService.balance`**

In `apps/platform/app/modules/payments/services/deposit_service.ts` replace the ledger import:

```ts
import { decidedLate, depositMoney } from "#modules/payments/ledger";
```

with:

```ts
import {
	type Balance,
	balanceOf,
	decidedLate,
	depositMoney,
} from "#modules/payments/ledger";
```

and add this method right after `verifiedPaid`:

```ts
	/**
	 * The project's balance (balanceOf over its current quote and every
	 * payment) and whether its total is an hourly estimate. ProjectService's
	 * finish steps read it under the project's lock (TAT-111): PaymentService
	 * shows the same balance but depends on ProjectService, so ProjectService
	 * can't ask it.
	 */
	async balance(
		tenant: TenantRef,
		project: ProjectRef,
	): Promise<{ balance: Balance; estimated: boolean }> {
		const quote = await this.quotes.current(tenant, project);
		const payments = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id);
		return {
			balance: balanceOf(quote, payments),
			estimated: quote?.kind === "hourly",
		};
	}
```

- [ ] **Step 4: The steps in `ProjectService`**

In `apps/platform/app/modules/projects/services/project_service.ts`:

Add the import (Biome sorts it):

```ts
import {
	FINISH_STEPS,
	type FinishResult,
	type FinishStep,
	finishRefusal,
	healingCheckDueOn,
	owed,
} from "#modules/projects/finish";
```

After `type TenantRef = Pick<Tenant, "id">;` add:

```ts
/** A tenant with its timezone: the healing check's day is the studio's. */
type TenantZone = Pick<Tenant, "id" | "timezone">;

/** What a finish step did (TAT-111): the new status and what its flash needs. */
export type Finished = FinishResult & { status: ProjectStatus };
```

After the `move` method (before `depositHeld`) add:

```ts
	/**
	 * Owners only (TAT-111's finish routes): anyone else gets E_ROW_NOT_FOUND
	 * (a 404). The controller calls it before it validates a body, so the
	 * assigned artist gets the same 404 whatever they post; finish and
	 * completeHealingCheck check again. TAT-30 turns it into a capability.
	 */
	requireOwner(member: Member): void {
		if (member.role !== "owner") {
			throw new lucidErrors.E_ROW_NOT_FOUND(TattooProject);
		}
	}

	/**
	 * The owner marks the tattoo finished (TAT-111): `in_progress` to
	 * `healing_check`. `confirmedDue` is the balance due the page's
	 * confirmation named, in paisa (null when it named none). See finishStep.
	 */
	finish(
		tenant: TenantZone,
		member: Member,
		project: TattooProject,
		confirmedDue: bigint | null,
	): Promise<Finished> {
		return this.finishStep(tenant, member, project, "finish", confirmedDue);
	}

	/**
	 * The owner closes the healing check (TAT-111): `healing_check` to
	 * `completed`, with the same rules as finish.
	 */
	completeHealingCheck(
		tenant: TenantZone,
		member: Member,
		project: TattooProject,
		confirmedDue: bigint | null,
	): Promise<Finished> {
		return this.finishStep(tenant, member, project, "complete", confirmedDue);
	}
```

Before the private `lockFor` method add:

```ts
	/**
	 * One finish step (TAT-111), owners only (E_ROW_NOT_FOUND for anyone else,
	 * before the lock). Under the project's row lock, which every project
	 * write takes first, so a session scheduled or a payment recorded in
	 * another tab either came first and is seen here or waits: finishRefusal
	 * decides from the live row, its live sessions and its balance
	 * (ProjectRuleError "move_not_allowed" when the status moved on, as after
	 * a second tap or from a stale tab; "session_scheduled"; "balance_changed"
	 * when money is owed and `confirmedDue` isn't exactly it). Only the status
	 * changes: sessions, payments, quotes and deposit outcomes stay as they
	 * are.
	 */
	private async finishStep(
		tenant: TenantZone,
		member: Member,
		project: TattooProject,
		step: FinishStep,
		confirmedDue: bigint | null,
	): Promise<Finished> {
		assertProjectOf(tenant, project);
		this.requireOwner(member);
		return withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			const sessions = await this.sessions.listForProject(tenant, live);
			const { balance, estimated } = await this.deposits.balance(tenant, live);
			const due = owed(balance.due);
			const refusal = finishRefusal(step, {
				status: live.status,
				sessionScheduled: sessions.some(
					({ status }) => status === "scheduled",
				),
				due,
				confirmedDue,
			});
			if (refusal) throw new ProjectRuleError(refusal);
			await setStatus(live, FINISH_STEPS[step].to);
			return {
				status: live.status,
				due,
				estimated,
				dueOn: healingCheckDueOn(sessions, tenant.timezone),
			};
		});
	}
```

Also extend the class comment's first sentence: "…the manual moves (TAT-46: hold, resume, decline, withdraw), finishing (TAT-111: finish and close the healing check), plus the artist, notes and contact time."

- [ ] **Step 5: Run the tests and typecheck**

Run: `… pnpm -C <repo>/apps/platform test functional --files=project_finish.spec.ts` → 10 tests PASS. Run: `… pnpm -C <repo>/apps/platform typecheck` → clean. Run: `… test functional --files=project_service.spec.ts --files=deposit_service.spec.ts` → PASS (nothing else moved).

- [ ] **Step 6: Commit**

`git -C <repo> add apps/platform/app/modules/payments/services/deposit_service.ts apps/platform/app/modules/projects/services/project_service.ts apps/platform/tests/functional/projects/project_finish.spec.ts && git -C <repo> commit -m "feat(platform): finish a project and close its healing check, under the project lock (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 3: Touch-ups during the healing check

**Files:**
- Modify: `apps/platform/app/modules/scheduling/schedule_rules.ts`, `apps/platform/app/modules/scheduling/errors.ts`, `apps/platform/app/modules/scheduling/services/session_service.ts`, `apps/platform/app/controllers/project_sessions_controller.ts`, `apps/platform/app/controllers/projects_controller.ts` (the `scheduling` prop only)
- Test: `apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts`, `apps/platform/tests/functional/scheduling/session_scheduling.spec.ts`, `apps/platform/tests/functional/projects/project_page.spec.ts` (one assertion)

**Interfaces:**
- Produces: `schedulableKinds(status): readonly SessionKind[]` (`["tattoo", "consultation", "touch_up"]` while open, `["touch_up"]` for `healing_check`, `[]` otherwise); `scheduleRefusal(status, kind)` (now two arguments); `SessionRuleReason` gains `touch_ups_only`; the page's `scheduling` prop gains `kinds: string[]`.

- [ ] **Step 1: Update and add the unit tests**

In `apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts`:

1. Import `schedulableKinds` too, and `SESSION_KINDS`:

```ts
import { SESSION_KINDS } from "#modules/scheduling/models/project_session";
import {
	SCHEDULABLE_STATUSES,
	schedulableKinds,
	scheduledNote,
	scheduleRefusal,
	schedulingHint,
} from "#modules/scheduling/schedule_rules";
```

2. In the first test, change `scheduleRefusal(status)` to `scheduleRefusal(status, "tattoo")` and the expected `healing_check: "project_finished",` to `healing_check: "touch_ups_only",`. Rename the test to `"open projects take new sessions; finished and closed ones refuse a tattoo session"`.

3. Add to the `scheduleRefusal` group:

```ts
	test("a healing check takes touch-ups only; a completed project takes nothing (TAT-111)", ({
		assert,
	}) => {
		const all = ["tattoo", "consultation", "touch_up"];
		assert.sameMembers(all, [...SESSION_KINDS]);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [status, [...schedulableKinds(status)]]),
			),
			{
				reviewing: all,
				quoted: all,
				on_hold: all,
				deposit_pending: all,
				booked: all,
				in_progress: all,
				completed: [],
				healing_check: ["touch_up"],
				declined: [],
				cancelled: [],
			},
		);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [
					status,
					scheduleRefusal(status, "touch_up"),
				]),
			),
			{
				reviewing: null,
				quoted: null,
				on_hold: null,
				deposit_pending: null,
				booked: null,
				in_progress: null,
				completed: "project_finished",
				healing_check: null,
				declined: "project_closed",
				cancelled: "project_closed",
			},
		);
		assert.equal(
			scheduleRefusal("healing_check", "consultation"),
			"touch_ups_only",
		);
	});
```

4. Add to the `schedulingHint` group:

```ts
	test("a healing check says it takes touch-ups only (TAT-111)", ({
		assert,
	}) => {
		assert.equal(
			schedulingHint("healing_check", 0, true),
			"The healing check takes touch-up sessions only.",
		);
	});
```

- [ ] **Step 2: Update and add the functional test**

In `apps/platform/tests/functional/scheduling/session_scheduling.spec.ts`, in the test "a finished or closed project takes no new session, and nothing is saved", change `healing_check: "project_finished",` to `healing_check: "touch_ups_only",` (its slot is a tattoo session). Right after that test (inside the same group) add:

```ts
	test("a healing check takes a touch-up session and stays in its healing check (TAT-111)", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const healing = await makeProject(tenant, client, {
				status: "healing_check",
				artistId: sita.id,
			});
			const touchUp = await sessions.scheduleFor(
				tenant,
				OWNER,
				healing,
				slot(sita, 3, "touch_up"),
			);
			assert.deepEqual(
				[touchUp.session.kind, touchUp.projectStatus, touchUp.booked],
				["touch_up", "healing_check", false],
			);
			for (const kind of ["tattoo", "consultation"] as const) {
				assert.equal(
					await ruleOf(() =>
						sessions.scheduleFor(tenant, OWNER, healing, slot(sita, 5, kind)),
					),
					"touch_ups_only",
					kind,
				);
			}
			assert.lengthOf(await sessionsOf(healing), 1);

			const completed = await makeProject(tenant, client, {
				status: "completed",
				artistId: sita.id,
			});
			assert.equal(
				await ruleOf(() =>
					sessions.scheduleFor(
						tenant,
						OWNER,
						completed,
						slot(sita, 7, "touch_up"),
					),
				),
				"project_finished",
			);
			assert.lengthOf(await sessionsOf(completed), 0);
		});
	});
```

In `apps/platform/tests/functional/projects/project_page.spec.ts`, in the test "an artist schedules only themselves; a finished or closed project offers nothing", the `assert.deepEqual(mine.scheduling, { … })` gains `kinds: ["tattoo", "consultation", "touch_up"],` (after `artistFixed: true,`).

- [ ] **Step 3: Run them to see them fail**

Run: `… test unit --files=schedule_rules.spec.ts` (RED form) → fails (`schedulableKinds` is not exported). Run: `… test functional --files=session_scheduling.spec.ts` → the two TAT-111 assertions fail.

- [ ] **Step 4: The rules**

In `apps/platform/app/modules/scheduling/errors.ts` add `"touch_ups_only",` at the end of `SESSION_RULE_REASONS` and to `MESSAGES`:

```ts
	touch_ups_only: "A project in its healing check takes touch-up sessions only",
```

In `apps/platform/app/modules/scheduling/schedule_rules.ts` replace the comment above `SCHEDULABLE_STATUSES` with:

```ts
/**
 * The project statuses that take every kind of session from staff (TAT-85
 * part 2): before booking, booked, and in progress (a long tattoo's next
 * sitting). A healing check takes touch-ups only (TAT-111); completed,
 * declined and cancelled projects take none (schedulableKinds).
 */
```

and replace `scheduleRefusal` with:

```ts
/** Every session kind, in the schedule form's order. */
const ALL_KINDS: readonly SessionKind[] = ["tattoo", "consultation", "touch_up"];

/**
 * The session kinds staff may schedule on a project in `status`, in the
 * schedule form's order: every kind while it is open, touch-ups only during
 * its healing check (TAT-111), none once it is completed, declined or
 * cancelled. The Sessions card offers exactly these.
 */
export function schedulableKinds(
	status: ProjectStatus,
): readonly SessionKind[] {
	if (SCHEDULABLE_STATUSES.includes(status)) return ALL_KINDS;
	return status === "healing_check" ? ["touch_up"] : [];
}

/**
 * Why a project in `status` takes no new `kind` session, or null when it
 * does: "touch_ups_only" during a healing check, "project_finished" once
 * completed, "project_closed" when declined or cancelled.
 */
export function scheduleRefusal(
	status: ProjectStatus,
	kind: SessionKind,
): SessionRuleReason | null {
	if (schedulableKinds(status).includes(kind)) return null;
	if (status === "healing_check") return "touch_ups_only";
	return status === "completed" ? "project_finished" : "project_closed";
}
```

In `schedulingHint`, make the first line of the body:

```ts
	if (status === "healing_check") {
		return "The healing check takes touch-up sessions only.";
	}
```

In `apps/platform/app/modules/scheduling/services/session_service.ts` replace `const refusal = scheduleRefusal(live.status);` with `const refusal = scheduleRefusal(live.status, input.kind);`, and in `scheduleFor`'s comment replace `(scheduleRefusal: SessionRuleError "project_closed" or "project_finished")` with `(scheduleRefusal: SessionRuleError "project_closed", "project_finished", or "touch_ups_only" for anything but a touch-up during a healing check)`.

In `apps/platform/app/controllers/project_sessions_controller.ts` add to `OUTCOME_REFUSED`: `touch_ups_only: "This session can't be changed.",` and to `SCHEDULE_REFUSED`: `touch_ups_only: "The healing check takes touch-up sessions only.",`.

In `apps/platform/app/controllers/projects_controller.ts` replace the import

```ts
import {
	scheduleRefusal,
	schedulingHint,
} from "#modules/scheduling/schedule_rules";
```

with

```ts
import {
	schedulableKinds,
	schedulingHint,
} from "#modules/scheduling/schedule_rules";
```

and in `show` replace

```ts
			scheduling:
				scheduleRefusal(project.status) === null && bookable.length > 0
					? {
							artists: bookable.map(({ id, name }) => ({ id, name })),
							artistId: defaultArtistId,
							artistFixed: membership.role !== "owner",
```

with

```ts
			scheduling:
				schedulableKinds(project.status).length > 0 && bookable.length > 0
					? {
							artists: bookable.map(({ id, name }) => ({ id, name })),
							artistId: defaultArtistId,
							artistFixed: membership.role !== "owner",
							kinds: [...schedulableKinds(project.status)],
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `… test unit --files=schedule_rules.spec.ts` → PASS (2 new). Run: `… test functional --files=session_scheduling.spec.ts --files=project_scheduling_http.spec.ts --files=project_page.spec.ts --files=project_sessions_http.spec.ts` → PASS (1 new; the completed project's flash "This project is finished: it takes no new sessions." is unchanged). Run: `… typecheck` → clean.

- [ ] **Step 6: Commit**

`git -C <repo> add apps/platform/app/modules/scheduling apps/platform/app/controllers/project_sessions_controller.ts apps/platform/app/controllers/projects_controller.ts apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts apps/platform/tests/functional/scheduling/session_scheduling.spec.ts apps/platform/tests/functional/projects/project_page.spec.ts && git -C <repo> commit -m "feat(platform): a healing check takes touch-up sessions only (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 4: The routes, their isolation cases and the HTTP tests

**Files:**
- Modify: `apps/platform/app/modules/projects/validators/project.ts`, `apps/platform/app/controllers/project_changes_controller.ts`, `apps/platform/start/routes.ts`, `apps/platform/tests/helpers/tenants.ts`, `apps/platform/tests/isolation/cases.ts`, `.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/projects/project_finish_http.spec.ts` (create)

**Interfaces:**
- Consumes: Task 2's `requireOwner`, `finish`, `completeHealingCheck`; Task 1's `finishedFlash`, `FinishStep`.
- Produces: the two routes; `finishValidator`; `twoStudios()` studios gain `finishProject` (in progress, a tattoo session done a week ago, no quote) and `healingProject` (healing check, no quote), both assigned to `artistProfile`.

- [ ] **Step 1: Write the failing HTTP tests**

Create `apps/platform/tests/functional/projects/project_finish_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
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

const SLUG = "finish-desk-111";
const url = (id: string, action = "") => `/t/${SLUG}/projects/${id}${action}`;

/**
 * When the tattoo sessions of these tests end: 10:00 UTC on 10 Oct 2026,
 * 15:45 in Kathmandu, so a healing check is due 7 Nov 2026.
 */
const LAST_SESSION_END = DateTime.utc(2026, 10, 10, 10);

/** A studio, its owner, and Asha, an artist member linked to the profile Sita. */
async function setup() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Finish Desk");
	const asha = await artistIn(tenant, `asha@${SLUG}.example`);
	const sita = await inTenant(tenant, async () => {
		const profile = await makeArtist(tenant);
		profile.userId = asha.id;
		await profile.save();
		return profile;
	});
	return { owner, tenant, asha, sita };
}

/**
 * A project in `status` assigned to Sita, whose two-hour tattoo session
 * ended at `endsAt` (give each project of a test its own time).
 */
function workDone(
	tenant: Tenant,
	sita: Artist,
	status: ProjectStatus = "in_progress",
	endsAt: DateTime = LAST_SESSION_END,
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
			artistId: sita.id,
		});
		await makeSession(tenant, project, sita, {
			startsAt: endsAt.minus({ hours: 2 }),
			endsAt,
			status: "completed",
		});
		return project;
	});
}

const statusOf = (tenant: Tenant, project: TattooProject) =>
	inTenant(tenant, async () => (await TattooProject.findOrFail(project.id)).status);

function post(
	client: ApiClient,
	path: string,
	user: User,
	body: Record<string, unknown> = { confirmedDue: "0" },
) {
	return client.post(path).form(body).withCsrfToken().loginAs(user).redirects(0);
}

test.group("Finishing a project over HTTP (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner marks the tattoo finished, then closes the healing check", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const project = await workDone(tenant, sita);

		const finished = await post(client, url(project.id, "/finish"), owner);
		finished.assertHeader("location", url(project.id));
		finished.assertFlashMessage(
			"success",
			"Tattoo finished: the healing check is due 7 Nov 2026. Send the aftercare message from Message the client.",
		);
		assert.equal(await statusOf(tenant, project), "healing_check");

		const completed = await post(client, url(project.id, "/complete"), owner);
		completed.assertHeader("location", url(project.id));
		completed.assertFlashMessage(
			"success",
			"Healing check done: the project is completed.",
		);
		assert.equal(await statusOf(tenant, project), "completed");
	});

	test("money owed: the confirmation must name it, and the flash says it is still due", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const project = await workDone(tenant, sita);
		await inTenant(tenant, async () => {
			// NPR 15,000 with the NPR 3,000 deposit paid: NPR 12,000 owed.
			await makeQuote(tenant, project);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
		});

		const unconfirmed = await post(client, url(project.id, "/finish"), owner);
		unconfirmed.assertHeader("location", url(project.id));
		unconfirmed.assertFlashMessage(
			"error",
			"The balance changed since this page loaded. Check it and try again.",
		);
		assert.equal(await statusOf(tenant, project), "in_progress");

		const confirmed = await post(client, url(project.id, "/finish"), owner, {
			confirmedDue: "1200000",
		});
		confirmed.assertFlashMessage(
			"success",
			"Tattoo finished: the healing check is due 7 Nov 2026. Send the aftercare message from Message the client. NPR 12,000 of the balance is still due: record it under Payments when it's paid.",
		);
		assert.equal(await statusOf(tenant, project), "healing_check");
	});

	test("a stale page is refused with a flash and nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const booked = await workDone(
			tenant,
			sita,
			"booked",
			LAST_SESSION_END.minus({ days: 1 }),
		);
		const waiting = await workDone(
			tenant,
			sita,
			"in_progress",
			LAST_SESSION_END.minus({ days: 2 }),
		);
		await inTenant(tenant, async () => {
			const startsAt = DateTime.utc().plus({ days: 3 }).startOf("hour");
			await makeSession(tenant, waiting, sita, {
				kind: "consultation",
				startsAt,
				endsAt: startsAt.plus({ hours: 1 }),
			});
		});

		for (const action of ["/finish", "/complete"]) {
			(await post(client, url(booked.id, action), owner)).assertFlashMessage(
				"error",
				"This project can't make that change in its current status.",
			);
		}
		(await post(client, url(waiting.id, "/finish"), owner)).assertFlashMessage(
			"error",
			"Record or cancel the scheduled session first.",
		);
		assert.equal(await statusOf(tenant, booked), "booked");
		assert.equal(await statusOf(tenant, waiting), "in_progress");
	});

	test("a confirmation that isn't a whole paisa amount is a field error", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const project = await workDone(tenant, sita);

		for (const confirmedDue of ["-5", "12.5", "abc", "1".repeat(21)]) {
			assertValidationError(
				await post(client, url(project.id, "/finish"), owner, { confirmedDue }),
				"confirmedDue",
				"Reload the page and try again.",
			);
		}
		assert.equal(await statusOf(tenant, project), "in_progress");
	});

	test("only owners: the assigned artist gets a 404 on both routes, whatever the body", async ({
		client,
		assert,
	}) => {
		const { tenant, asha, sita } = await setup();
		const working = await workDone(
			tenant,
			sita,
			"in_progress",
			LAST_SESSION_END.minus({ days: 1 }),
		);
		const healing = await workDone(
			tenant,
			sita,
			"healing_check",
			LAST_SESSION_END.minus({ days: 2 }),
		);

		for (const [project, action] of [
			[working, "/finish"],
			[healing, "/complete"],
		] as const) {
			for (const body of [{ confirmedDue: "0" }, { confirmedDue: "junk" }]) {
				(await post(client, url(project.id, action), asha, body)).assertStatus(
					404,
				);
			}
		}
		assert.equal(await statusOf(tenant, working), "in_progress");
		assert.equal(await statusOf(tenant, healing), "healing_check");
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `… test functional --files=project_finish_http.spec.ts` → 404s and missing flashes (no route yet).

- [ ] **Step 3: The validator**

In `apps/platform/app/modules/projects/validators/project.ts` add at the end:

```ts
/**
 * A finish step (TAT-111): the balance due the confirmation named, in paisa
 * as digits; left out, or "0", when the page named none. At most 20 digits,
 * so a hostile value never reaches BigInt.
 */
export const finishValidator = vine.create({
	confirmedDue: vine
		.string()
		.trim()
		.regex(/^\d{1,20}$/)
		.optional(),
});
finishValidator.messagesProvider = new SimpleMessagesProvider({
	"confirmedDue.regex": "Reload the page and try again.",
});
```

- [ ] **Step 4: The controller**

In `apps/platform/app/controllers/project_changes_controller.ts`:

Add the imports (Biome sorts them):

```ts
import { type FinishStep, finishedFlash } from "#modules/projects/finish";
```

and `finishValidator` to the `#modules/projects/validators/project` import.

After the `artist` method add:

```ts
	/**
	 * "Mark the tattoo finished" (TAT-111). Owners only: findFor gives anyone
	 * who can't open the project a 404, and requireOwner gives the assigned
	 * artist the same 404 before the body is read.
	 */
	async finish(ctx: HttpContext) {
		return this.finishStep(ctx, "finish");
	}

	/** "Healing check done" (TAT-111), with the same checks as finish. */
	async complete(ctx: HttpContext) {
		return this.finishStep(ctx, "complete");
	}

	/**
	 * One finish step: the service decides under the project's lock; a
	 * refusal (a stale page, a session left, a changed balance) is a flash.
	 */
	private async finishStep(ctx: HttpContext, step: FinishStep) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		this.projects.requireOwner(membership);
		const { confirmedDue } = await ctx.request.validateUsing(finishValidator);
		const confirmed =
			typeof confirmedDue === "string" ? BigInt(confirmedDue) : null;
		try {
			const done =
				step === "finish"
					? await this.projects.finish(tenant, membership, project, confirmed)
					: await this.projects.completeHealingCheck(
							tenant,
							membership,
							project,
							confirmed,
						);
			ctx.session.flash("success", finishedFlash(step, done));
		} catch (error) {
			if (!(error instanceof ProjectRuleError)) throw error;
			ctx.session.flash("error", RULE_MESSAGES[error.reason]);
		}
		return backTo(ctx, tenant, project);
	}
```

Update the class comment: "The project page's changes that aren't quotes: status moves, finishing (TAT-111), notes, the contact time and the artist (TAT-46)."

- [ ] **Step 5: The routes**

In `apps/platform/start/routes.ts`, right after `.as("tenant.projects.artist.update");` add:

```ts
				// Finishing (TAT-111): owners only (ProjectService.requireOwner gives
				// the assigned artist a 404 before the body is read).
				router
					.post(":id/finish", [controllers.ProjectChanges, "finish"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.finish.store");
				router
					.post(":id/complete", [controllers.ProjectChanges, "complete"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.complete.store");
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> pnpm -C <repo>/apps/platform exec node ace codegen` and keep the `.adonisjs/` changes.

- [ ] **Step 6: The isolation fixtures and cases**

In `apps/platform/tests/helpers/tenants.ts`, after the `scheduled` block (before `return {`) add:

```ts
	// The finish routes (TAT-111): an in-progress project assigned to
	// artistProfile whose tattoo session was done a week ago (clear of the
	// session cases' days, 30 to 62 days out), and a project in its healing
	// check. Neither has a quote, so nothing is owed and a finish needs no
	// confirmed amount.
	const finishing = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "in_progress",
			artistId: artistProfile.id,
		});
		const endsAt = DateTime.now().minus({ days: 7 }).startOf("hour");
		await makeSession(tenant, project, artistProfile, {
			startsAt: endsAt.minus({ hours: 2 }),
			endsAt,
			status: "completed",
		});
		const healing = await makeProject(tenant, pipeline.client, {
			status: "healing_check",
			artistId: artistProfile.id,
		});
		return { project, healing };
	});
```

and after `session: scheduled.session,` in the returned object:

```ts
		// The finish routes' :id resources (TAT-111).
		finishProject: finishing.project,
		healingProject: finishing.healing,
```

Append to the `twoStudios` comment, before "Later tickets add seed data": "An in-progress project with a done tattoo session and a project in its healing check, both assigned to `artistProfile` and without a quote (`finishProject`, `healingProject`), are the finish routes' resources (TAT-111)."

In `apps/platform/tests/isolation/cases.ts`, add `| "finishProject"` and `| "healingProject"` after `| "sessionProject"` in the `resource` union, and after the `POST /t/:tenant/projects/:id/sessions` case add:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/finish",
		resource: "finishProject",
		actor: "owner",
		body: () => ({ confirmedDue: "0" }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/complete",
		resource: "healingProject",
		actor: "owner",
		body: () => ({ confirmedDue: "0" }),
		ownStatus: 302,
		snapshot: projectRows,
	},
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `… test functional --files=project_finish_http.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts --files=harness.spec.ts --files=project_changes.spec.ts` → PASS (5 + 2 new). Run: `… typecheck` → clean.

- [ ] **Step 8: Commit**

`git -C <repo> add apps/platform/app/modules/projects/validators/project.ts apps/platform/app/controllers/project_changes_controller.ts apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/tests/helpers/tenants.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/projects/project_finish_http.spec.ts && git -C <repo> commit -m "feat(platform): routes to finish a project and close its healing check, owners only (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 5: What the page and the board show

**Files:**
- Modify: `apps/platform/app/controllers/projects_controller.ts`, `apps/platform/app/modules/payments/services/payment_service.ts`
- Test: `apps/platform/tests/functional/projects/project_finish_http.spec.ts` (a second group), `apps/platform/tests/functional/projects/project_finish.spec.ts` (one test), `apps/platform/tests/functional/payments/payment_reads.spec.ts` (six objects)

**Interfaces:**
- Produces, on the project page: `finish: { step: "finish" | "complete"; dueText: string | null; overdue: boolean; action: { confirmedDue: string; balanceDueText: string | null; estimated: boolean; sessionScheduled: boolean } | null } | null` (owners on `in_progress`; owners and the assigned artist on `healing_check`, the artist with `action: null`), `closed: boolean`; `assignment` null on a closed project. On the list: each row's `balanceOwed: boolean`. `ListFlags` gains `balanceOwed`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/projects/project_finish.spec.ts` (inside the existing group):

```ts
	test("the board flags money owed on a finished fixed-price project, never on an hourly one", async ({
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		await inTenant(tenant, async () => {
			const owing = await workDone(tenant, sita, "completed", 7);
			await makeQuote(tenant, owing);
			const healing = await workDone(tenant, sita, "healing_check", 9);
			await makeQuote(tenant, healing);
			const paid = await workDone(tenant, sita, "completed", 11);
			await makeQuote(tenant, paid);
			await makePayment(tenant, paid, {
				kind: "balance",
				amount: 1_500_000,
				...verified(owner),
			});
			const hourly = await workDone(tenant, sita, "completed", 13);
			await makeQuote(tenant, hourly, {
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 300_000,
				estimatedMinutes: 300,
				depositAmount: 0,
			});
			const working = await workDone(tenant, sita, "in_progress", 15);
			await makeQuote(tenant, working);

			const all = [owing, healing, paid, hourly, working];
			const flags = await payments.listFlags(tenant, all);
			assert.deepEqual(
				all.map(({ id }) => flags.get(id)?.balanceOwed),
				[true, true, false, false, false],
			);
		});
	});
```

Add to the imports of `apps/platform/tests/functional/projects/project_finish_http.spec.ts`:

```ts
import { healingCheckDueOn } from "#modules/projects/finish";
import { formatDay } from "#modules/projects/quotes";
import ProjectSession from "#modules/scheduling/models/project_session";
```

and append this group to that file:

```ts
const KTM = "Asia/Kathmandu";

/** What the page says the healing check's day is, for a tattoo session that ended at `endsAt`. */
const dueTextFor = (endsAt: DateTime) =>
	formatDay(
		healingCheckDueOn([{ kind: "tattoo", status: "completed", endsAt }], KTM) ??
			"",
	);

test.group("Finishing on the project page and the board (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the step and its action; the assigned artist sees only the healing check", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, asha, sita } = await setup();
		const now = DateTime.utc().startOf("hour");
		const working = await workDone(
			tenant,
			sita,
			"in_progress",
			now.minus({ days: 3 }),
		);
		// NPR 15,000, nothing paid.
		await inTenant(tenant, () => makeQuote(tenant, working));
		const recent = await workDone(
			tenant,
			sita,
			"healing_check",
			now.minus({ days: 1 }),
		);
		const old = await workDone(
			tenant,
			sita,
			"healing_check",
			now.minus({ days: 60 }),
		);
		await inTenant(tenant, async () => {
			const startsAt = now.plus({ days: 5 });
			await makeSession(tenant, old, sita, {
				kind: "touch_up",
				startsAt,
				endsAt: startsAt.plus({ hours: 1 }),
			});
		});
		const finishOf = async (project: TattooProject, user: User) =>
			(await client.get(url(project.id)).withInertia().loginAs(user))
				.inertiaProps.finish;

		assert.deepEqual(await finishOf(working, owner), {
			step: "finish",
			dueText: dueTextFor(now.minus({ days: 3 })),
			overdue: false,
			action: {
				confirmedDue: "1500000",
				balanceDueText: "NPR 15,000",
				estimated: false,
				sessionScheduled: false,
			},
		});
		assert.isNull(await finishOf(working, asha));
		assert.deepEqual(await finishOf(recent, asha), {
			step: "complete",
			dueText: dueTextFor(now.minus({ days: 1 })),
			overdue: false,
			action: null,
		});
		assert.deepEqual(await finishOf(old, owner), {
			step: "complete",
			dueText: dueTextFor(now.minus({ days: 60 })),
			overdue: true,
			action: {
				confirmedDue: "0",
				balanceDueText: null,
				estimated: false,
				sessionScheduled: true,
			},
		});
	});

	test("a closed project offers no step, no artist picker and no new session", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const completed = await workDone(tenant, sita, "completed");
		const cancelled = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), {
				status: "cancelled",
				artistId: sita.id,
			}),
		);
		const open = await workDone(
			tenant,
			sita,
			"in_progress",
			LAST_SESSION_END.minus({ days: 3 }),
		);
		const props = async (project: TattooProject) =>
			(await client.get(url(project.id)).withInertia().loginAs(owner))
				.inertiaProps;

		for (const project of [completed, cancelled]) {
			const page = await props(project);
			assert.isNull(page.finish, project.status);
			assert.isTrue(page.closed, project.status);
			assert.isNull(page.assignment, project.status);
			assert.isNull(page.scheduling, project.status);
		}
		const working = await props(open);
		assert.isFalse(working.closed);
		assert.isNotNull(working.assignment);
	});

	test("the healing check's Sessions card offers touch-ups only, and a tattoo session is refused", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const healing = await workDone(tenant, sita, "healing_check");

		const props = (
			await client.get(url(healing.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepInclude(props.scheduling, {
			kinds: ["touch_up"],
			hint: "The healing check takes touch-up sessions only.",
		});

		const date = DateTime.now().setZone(KTM).plus({ days: 5 }).toFormat("yyyy-MM-dd");
		const session = (sessionKind: string) => ({
			sessionKind,
			sessionArtistId: sita.id,
			date,
			startTime: "10:00",
			hours: "2",
		});
		(
			await post(client, url(healing.id, "/sessions"), owner, session("tattoo"))
		).assertFlashMessage(
			"error",
			"The healing check takes touch-up sessions only.",
		);
		(
			await post(client, url(healing.id, "/sessions"), owner, session("touch_up"))
		).assertHeader("location", url(healing.id));

		assert.equal(await statusOf(tenant, healing), "healing_check");
		assert.deepEqual(
			await inTenant(tenant, async () =>
				(
					await ProjectSession.query()
						.where("project_id", healing.id)
						.where("status", "scheduled")
				).map(({ kind }) => kind),
			),
			["touch_up"],
		);
	});

	test("the board: a finished project that still owes is flagged for owners; artists see no flags", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, asha, sita } = await setup();
		const owing = await workDone(tenant, sita, "completed");
		await inTenant(tenant, () => makeQuote(tenant, owing));
		const healing = await workDone(
			tenant,
			sita,
			"healing_check",
			LAST_SESSION_END.minus({ days: 2 }),
		);
		type Row = { id: string; status: string; balanceOwed: boolean };
		const rows = async (status: string, user: User) =>
			(
				await client
					.get(`/t/${SLUG}/projects?status=${status}`)
					.withInertia()
					.loginAs(user)
			).inertiaProps.projects as Row[];

		assert.deepInclude(
			(await rows("closed", owner)).find(({ id }) => id === owing.id),
			{ status: "completed", balanceOwed: true },
		);
		assert.deepInclude(
			(await rows("active", owner)).find(({ id }) => id === healing.id),
			{ status: "healing_check", balanceOwed: false },
		);
		assert.deepInclude(
			(await rows("closed", asha)).find(({ id }) => id === owing.id),
			{ balanceOwed: false },
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `… test functional --files=project_finish.spec.ts --files=project_finish_http.spec.ts` → the five new tests fail (`balanceOwed` undefined, `finish` and `closed` props missing).

- [ ] **Step 3: `listFlags` gains `balanceOwed`**

In `apps/platform/app/modules/payments/services/payment_service.ts`:

Add the import (Biome sorts it): `import { FINISHED_STATUSES, owed } from "#modules/projects/finish";`.

Replace the `ListFlags` type with:

```ts
/** What the owners' projects list flags on one project (PaymentService.listFlags). */
export type ListFlags = {
	proofWaiting: boolean;
	depositToSettle: boolean;
	quoteLapsed: boolean;
	/**
	 * A finished project (healing check or completed) whose fixed price is
	 * still owed (TAT-111). Hourly totals are estimates, so never flagged.
	 */
	balanceOwed: boolean;
};
```

In `listFlags`, add to its comment: "…withdraw. A finished project whose fixed price is still owed is `balanceOwed` (TAT-111): the owner confirmed finishing with it, and the board keeps it in sight." Then replace

```ts
			flags.set(project.id, { proofWaiting, depositToSettle, quoteLapsed });
```

with

```ts
			let balanceOwed = false;
			if (FINISHED_STATUSES.includes(project.status)) {
				const quote = await this.quotes.current(tenant, project);
				balanceOwed =
					quote !== null &&
					quote.kind === "fixed" &&
					owed(balanceOf(quote, own).due) > 0n;
			}
			flags.set(project.id, {
				proofWaiting,
				depositToSettle,
				quoteLapsed,
				balanceOwed,
			});
```

In `apps/platform/tests/functional/payments/payment_reads.spec.ts`, each of the six `assert.deepEqual(flags.get(…), { proofWaiting…, depositToSettle…, quoteLapsed… })` objects gains `balanceOwed: false,` (none of those projects is finished).

- [ ] **Step 4: The page and list props**

In `apps/platform/app/controllers/projects_controller.ts`:

Add the import (Biome sorts it):

```ts
import {
	finishStepFor,
	healingCheckDueOn,
	owed,
} from "#modules/projects/finish";
```

In `index`, after `quoteLapsed: flags.get(project.id)?.quoteLapsed ?? false,` add:

```ts
				balanceOwed: flags.get(project.id)?.balanceOwed ?? false,
```

In `show`, right before `return ctx.inertia.render("projects/show", {` add:

```ts
		// Finishing (TAT-111): the step this project offers, the healing check's
		// day and, for owners, what the confirmation names. A closed project
		// offers no artist change and no "Mark contacted".
		const step = finishStepFor(project.status);
		const dueOn = healingCheckDueOn(sessions, timezone);
		const owing = owed(money.balance.due);
		const closed = CLOSED_STATUSES.includes(project.status);
```

In the rendered props, after `bookedWithoutSession: …,` add:

```ts
			// The assigned artist sees the healing check, never the action.
			finish:
				step && (isOwner || step === "complete")
					? {
							step,
							dueText: dueOn ? formatDay(dueOn) : null,
							overdue:
								step === "complete" && dueOn !== null && todayText > dueOn,
							action: isOwner
								? {
										confirmedDue: String(owing),
										balanceDueText: owing > 0n ? formatMoney(owing) : null,
										estimated: money.quote?.kind === "hourly",
										sessionScheduled: scheduled.length > 0,
									}
								: null,
						}
					: null,
			closed,
```

and change the `assignment` condition from `membership.role === "owner"` to `membership.role === "owner" && !closed`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `… test functional --files=project_finish.spec.ts --files=project_finish_http.spec.ts --files=payment_reads.spec.ts --files=project_payments_card.spec.ts --files=project_page.spec.ts --files=projects_list.spec.ts` → PASS (5 new). Run: `… typecheck` → clean.

- [ ] **Step 6: Commit**

`git -C <repo> add apps/platform/app/controllers/projects_controller.ts apps/platform/app/modules/payments/services/payment_service.ts apps/platform/tests/functional/projects/project_finish.spec.ts apps/platform/tests/functional/projects/project_finish_http.spec.ts apps/platform/tests/functional/payments/payment_reads.spec.ts && git -C <repo> commit -m "feat(platform): the project page and the board show finishing and money still owed (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 6: The Finish card and the closed-project hides

**Files:**
- Create: `apps/platform/inertia/components/finish.ts`, `apps/platform/inertia/components/finish_card.tsx`
- Modify: `apps/platform/inertia/components/projects.ts`, `apps/platform/inertia/pages/projects/show.tsx`, `apps/platform/inertia/components/sessions_card.tsx`, `apps/platform/inertia/pages/projects/index.tsx`
- Test: `apps/platform/tests/unit/inertia/finish_copy.spec.ts` (create)

**Interfaces:**
- Consumes: Task 5's `finish`, `closed`, `balanceOwed`; Task 3's `scheduling.kinds`; Task 4's route names.
- Produces: `FinishProps` (in `~/components/projects`), `FinishCard`, the words in `~/components/finish`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/inertia/finish_copy.spec.ts`:

```ts
import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `FinishModule` below restates its shape and the inertia project type-checks the real one.
import * as finishModule from "../../../inertia/components/finish.js";

type Step = "finish" | "complete";
type FinishModule = {
	FINISH_TITLES: Record<Step, string>;
	FINISH_BUTTONS: Record<Step, string>;
	FINISH_CONFIRMS: Record<Step, string>;
	SESSION_FIRST: string;
	finishIntro(step: Step, dueText: string | null, overdue: boolean): string;
	balanceLine(amountText: string, estimated: boolean): string;
	finishQuestion(
		step: Step,
		dueText: string | null,
		balanceDueText: string | null,
		estimated: boolean,
	): string;
};
const {
	FINISH_TITLES,
	FINISH_BUTTONS,
	FINISH_CONFIRMS,
	SESSION_FIRST,
	finishIntro,
	balanceLine,
	finishQuestion,
} = finishModule as FinishModule;

const ASK =
	"Ask the client for a photo of the healed tattoo. If it needs a touch-up, schedule a touch-up session under Sessions.";

test.group("The finish card's words (TAT-111)", () => {
	test("titles, buttons and the text under each title", ({ assert }) => {
		assert.deepEqual(FINISH_TITLES, {
			finish: "Finish the tattoo",
			complete: "Healing check",
		});
		assert.deepEqual(FINISH_BUTTONS, {
			finish: "Mark the tattoo finished",
			complete: "Healing check done",
		});
		assert.deepEqual(FINISH_CONFIRMS, {
			finish: "Mark finished",
			complete: "Close the project",
		});
		assert.equal(
			SESSION_FIRST,
			"Record or cancel the scheduled session under Sessions first.",
		);
		assert.equal(
			finishIntro("finish", "6 Nov 2026", false),
			"Once the work is done, mark the tattoo finished. Its healing check will be due 6 Nov 2026, four weeks after the last tattoo session.",
		);
		assert.equal(
			finishIntro("finish", null, false),
			"Once the work is done, mark the tattoo finished. Its healing check comes next.",
		);
		assert.equal(
			finishIntro("complete", "7 Nov 2026", false),
			`Due 7 Nov 2026. ${ASK}`,
		);
		assert.equal(
			finishIntro("complete", "7 Nov 2026", true),
			`Was due 7 Nov 2026. ${ASK}`,
		);
		assert.equal(finishIntro("complete", null, false), ASK);
		assert.equal(balanceLine("NPR 15,000", false), "Balance due: NPR 15,000.");
		assert.equal(
			balanceLine("NPR 15,000", true),
			"Balance due: NPR 15,000 (estimated).",
		);
	});

	test("the question names the healing check's day and money still owed", ({
		assert,
	}) => {
		assert.equal(
			finishQuestion("finish", "6 Nov 2026", null, false),
			"Mark the tattoo finished? The project moves to Healing check, due 6 Nov 2026, and takes only touch-up sessions from now on.",
		);
		assert.equal(
			finishQuestion("finish", null, null, false),
			"Mark the tattoo finished? The project moves to Healing check and takes only touch-up sessions from now on.",
		);
		assert.equal(
			finishQuestion("complete", "7 Nov 2026", "NPR 12,000", false),
			"Close the project? It moves to Completed and takes no more sessions. NPR 12,000 of the balance is still due: it stays on the Payments card.",
		);
		assert.equal(
			finishQuestion("finish", "6 Nov 2026", "NPR 12,000", true),
			"Mark the tattoo finished? The project moves to Healing check, due 6 Nov 2026, and takes only touch-up sessions from now on. NPR 12,000 of the estimated balance is still due: it stays on the Payments card.",
		);
	});
});
```

Run (RED form): `… test unit --files=finish_copy.spec.ts` → "Cannot find module".

- [ ] **Step 2: The words**

Create `apps/platform/inertia/components/finish.ts`:

```ts
/**
 * The finish card's words (TAT-111): pure, so a unit test pins them
 * (tests/unit/inertia/finish_copy.spec.ts).
 */
export type FinishStepName = "finish" | "complete";

export const FINISH_TITLES: Record<FinishStepName, string> = {
	finish: "Finish the tattoo",
	complete: "Healing check",
};

/** The card's button, which opens the confirmation. */
export const FINISH_BUTTONS: Record<FinishStepName, string> = {
	finish: "Mark the tattoo finished",
	complete: "Healing check done",
};

/** The confirmation's button. */
export const FINISH_CONFIRMS: Record<FinishStepName, string> = {
	finish: "Mark finished",
	complete: "Close the project",
};

/** Shown instead of the button while a session is scheduled. */
export const SESSION_FIRST =
	"Record or cancel the scheduled session under Sessions first.";

const ASK =
	"Ask the client for a photo of the healed tattoo. If it needs a touch-up, schedule a touch-up session under Sessions.";

/** The card's text under its title. */
export function finishIntro(
	step: FinishStepName,
	dueText: string | null,
	overdue: boolean,
): string {
	if (step === "finish") {
		return dueText
			? `Once the work is done, mark the tattoo finished. Its healing check will be due ${dueText}, four weeks after the last tattoo session.`
			: "Once the work is done, mark the tattoo finished. Its healing check comes next.";
	}
	if (!dueText) return ASK;
	return `${overdue ? "Was due" : "Due"} ${dueText}. ${ASK}`;
}

/** The money still owed, shown above the button. */
export function balanceLine(amountText: string, estimated: boolean): string {
	return `Balance due: ${amountText}${estimated ? " (estimated)" : ""}.`;
}

/** The confirmation's question. */
export function finishQuestion(
	step: FinishStepName,
	dueText: string | null,
	balanceDueText: string | null,
	estimated: boolean,
): string {
	const question =
		step === "finish"
			? `Mark the tattoo finished? The project moves to Healing check${dueText ? `, due ${dueText},` : ""} and takes only touch-up sessions from now on.`
			: "Close the project? It moves to Completed and takes no more sessions.";
	return balanceDueText
		? `${question} ${balanceDueText} of the ${estimated ? "estimated " : ""}balance is still due: it stays on the Payments card.`
		: question;
}
```

Run: `… test unit --files=finish_copy.spec.ts` → 2 tests PASS.

- [ ] **Step 3: The types**

In `apps/platform/inertia/components/projects.ts`, before `export type ProjectPageProps` add:

```ts
/** The finish card (TAT-111): the step, the healing check's day, and the owner's action. */
export type FinishProps = {
	step: "finish" | "complete";
	/** "7 Nov 2026"; null without a completed tattoo session. */
	dueText: string | null;
	/** The healing check's day has passed (the studio's today). */
	overdue: boolean;
	/** Owners only; null for the assigned artist, who sees the card without a button. */
	action: {
		/** The balance due the confirmation names, paisa as digits; "0" when nothing is owed. */
		confirmedDue: string;
		/** "NPR 15,000" when money is owed, else null. */
		balanceDueText: string | null;
		/** The balance is an hourly estimate. */
		estimated: boolean;
		/** A session is still scheduled: no button until it has its outcome. */
		sessionScheduled: boolean;
	} | null;
};
```

In `ProjectPageProps`, after `bookedWithoutSession: boolean;` add:

```ts
	/** Finishing (TAT-111): in progress for owners, the healing check for owners and the assigned artist; null otherwise. */
	finish: FinishProps | null;
	/** Declined, cancelled or completed: no artist picker and no "Mark contacted". */
	closed: boolean;
```

In its `scheduling` object type, after `artistFixed: boolean;` add `/** The kinds this project takes now, in the form's order (touch-ups only during a healing check). */ kinds: string[];` (as a commented field on its own lines). In `ProjectRow`, after `quoteLapsed: boolean;` add:

```ts
	/** Owners: a finished fixed-price project with money still owed (TAT-111). */
	balanceOwed: boolean;
```

- [ ] **Step 4: The card**

Create `apps/platform/inertia/components/finish_card.tsx`:

```tsx
import { router } from "@inertiajs/react";
import { useEffect, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	balanceLine,
	FINISH_BUTTONS,
	FINISH_CONFIRMS,
	FINISH_TITLES,
	finishIntro,
	finishQuestion,
	SESSION_FIRST,
} from "~/components/finish";
import type { FinishProps } from "~/components/projects";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";

/**
 * Finishing a project (TAT-111): "Mark the tattoo finished" on an
 * in-progress project, then the healing check with its day and "Healing
 * check done". Each step is confirmed in an inline panel: focus starts on
 * "Not yet", Escape closes it and returns focus to the button. The assigned
 * artist gets the healing check without a button. TAT-108 moves this into
 * the project page's Next step card.
 */
export default function FinishCard({
	projectId,
	finish,
}: {
	projectId: string;
	finish: FinishProps;
}) {
	const tenant = useTenant();
	const trigger = useRef<HTMLButtonElement>(null);
	const keep = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		if (open) keep.current?.focus();
	}, [open]);
	const { step, action } = finish;
	const close = () => {
		setOpen(false);
		trigger.current?.focus();
	};
	const confirm = () => {
		if (!action) return;
		const params = { tenant: tenant.slug, id: projectId };
		router.post(
			step === "finish"
				? urlFor("tenant.projects.finish.store", params)
				: urlFor("tenant.projects.complete.store", params),
			{ confirmedDue: action.confirmedDue },
			{
				preserveScroll: true,
				onStart: () => setSaving(true),
				onFinish: () => setSaving(false),
				onSuccess: () => setOpen(false),
			},
		);
	};

	return (
		<Card id="finish">
			<CardHeader>
				<CardTitle>{FINISH_TITLES[step]}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3 text-sm">
				<p>{finishIntro(step, finish.dueText, finish.overdue)}</p>
				{action?.balanceDueText && (
					<p>{balanceLine(action.balanceDueText, action.estimated)}</p>
				)}
				{action &&
					(action.sessionScheduled ? (
						<p className="text-muted-foreground">{SESSION_FIRST}</p>
					) : (
						<div>
							<Button
								ref={trigger}
								type="button"
								className="h-11"
								aria-expanded={open}
								onClick={() => setOpen(true)}
							>
								{FINISH_BUTTONS[step]}
							</Button>
						</div>
					))}
				{open && action && (
					<fieldset
						className="min-w-0 rounded-md bg-muted/50 p-3"
						onKeyDown={(event) => {
							if (event.key === "Escape") close();
						}}
					>
						<legend className="float-left mb-3 w-full">
							{finishQuestion(
								step,
								finish.dueText,
								action.balanceDueText,
								action.estimated,
							)}
						</legend>
						<div className="clear-left flex flex-wrap gap-2">
							<Button
								type="button"
								className="h-11"
								disabled={saving}
								onClick={confirm}
							>
								{saving ? "Saving…" : FINISH_CONFIRMS[step]}
							</Button>
							<Button
								ref={keep}
								type="button"
								variant="ghost"
								className="h-11"
								disabled={saving}
								onClick={close}
							>
								Not yet
							</Button>
						</div>
					</fieldset>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 5: The page, the Sessions card and the list**

In `apps/platform/inertia/pages/projects/show.tsx`:
1. Import `FinishCard from "~/components/finish_card"` (Biome sorts it).
2. Add `finish,` and `closed,` to the destructured props.
3. Right after the status card's closing `</Card>` (the one holding `StatusBadge`, the brief, the contact line, the moves and the artist field) and before `<MessageCard`, add:

```tsx
				{finish && (
					<FinishCard key={finish.step} projectId={project.id} finish={finish} />
				)}
```

4. Replace `<ContactLine text={contactedText} onMark={() => markContacted()} />` with `<ContactLine text={contactedText} onMark={closed ? undefined : () => markContacted()} />`, and replace the `ContactLine` function with:

```tsx
function ContactLine({ text, onMark }: { text: string; onMark?: () => void }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
			<span className="text-muted-foreground">{text}</span>
			{onMark && (
				<Button type="button" variant="outline" size="sm" onClick={onMark}>
					Mark contacted
				</Button>
			)}
		</div>
	);
}
```

(The artist field already hides itself: the server sends `assignment: null` on a closed project.)

In `apps/platform/inertia/components/sessions_card.tsx`, in `ScheduleForm`'s Kind select, replace `defaultValue="tattoo"` with

```tsx
								defaultValue={
									scheduling.kinds.includes("tattoo")
										? "tattoo"
										: scheduling.kinds[0]
								}
```

and the three hard-coded `<option>`s (Tattoo, Consultation, Touch-up) with

```tsx
								{scheduling.kinds.map((value) => (
									<option key={value} value={value}>
										{SESSION_KIND_LABELS[value] ?? value}
									</option>
								))}
```

In `apps/platform/inertia/pages/projects/index.tsx`, after the `quoteLapsed` badge add:

```tsx
										{project.balanceOwed && (
											<Badge variant="outline">balance due</Badge>
										)}
```

- [ ] **Step 6: Gates**

Run: `… pnpm -C <repo>/apps/platform typecheck` → clean. Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check apps/platform/inertia/components/finish.ts apps/platform/inertia/components/finish_card.tsx apps/platform/inertia/components/projects.ts apps/platform/inertia/pages/projects/show.tsx apps/platform/inertia/components/sessions_card.tsx apps/platform/inertia/pages/projects/index.tsx apps/platform/tests/unit/inertia/finish_copy.spec.ts` → clean. Run: `… test unit --files=finish_copy.spec.ts --files=session_actions.spec.ts --files=status_groups.spec.ts` → PASS.

- [ ] **Step 7: Commit**

`git -C <repo> add apps/platform/inertia apps/platform/tests/unit/inertia/finish_copy.spec.ts && git -C <repo> commit -m "feat(platform): the Finish card, touch-ups only in the healing check form, and closed projects without the artist picker (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 7: The aftercare message asks for the healed photo

**Files:**
- Modify: `apps/platform/app/modules/notifications/messages.ts`
- Test: `apps/platform/tests/unit/modules/notifications/messages.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/unit/modules/notifications/messages.spec.ts`:

```ts
test.group("The aftercare default (TAT-111)", () => {
	test("asks for a photo of the healed tattoo, for the healing check", ({
		assert,
	}) => {
		const text = renderMessage("aftercare", DEFAULT_TEMPLATES.aftercare, SAMPLE);
		assert.isTrue(
			text.endsWith(
				"Message us here if anything worries you. In about four weeks, send us a photo of the healed tattoo here.",
			),
			text,
		);
		assert.isNull(templateProblem("aftercare", DEFAULT_TEMPLATES.aftercare));
	});
});
```

Run: `… test unit --files=messages.spec.ts` → the new test fails.

- [ ] **Step 2: The default text**

In `apps/platform/app/modules/notifications/messages.ts`, in `DEFAULT_TEMPLATES.aftercare`, replace the ending `Message us here if anything worries you.",` with `Message us here if anything worries you. In about four weeks, send us a photo of the healed tattoo here.",`.

- [ ] **Step 3: Run the tests**

Run: `… test unit --files=messages.spec.ts --files=project_messages.spec.ts` and `… test functional --files=project_page.spec.ts --files=message_templates_http.spec.ts --files=message_template_service.spec.ts` → PASS (1 new).

- [ ] **Step 4: Commit**

`git -C <repo> add apps/platform/app/modules/notifications/messages.ts apps/platform/tests/unit/modules/notifications/messages.spec.ts && git -C <repo> commit -m "feat(platform): the aftercare message asks for a photo of the healed tattoo (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 8: Docs

**Files:** `apps/platform/docs/backend.md`, `apps/platform/docs/ui.md`, `apps/platform/docs/testing.md`, `docs/requirements.md`

- [ ] **Step 1: `apps/platform/docs/backend.md`**

1. In the bullet "Payment decisions, desk payments and balance due (TAT-66)", replace

```
`listFlags` (the projects list's "screenshot to check", "deposit to settle" and "quote expired": a deposit_pending project the sweep spares because of a late decision on its deposit)
```

with

```
`listFlags` (the projects list's "screenshot to check", "deposit to settle", "quote expired": a deposit_pending project the sweep spares because of a late decision on its deposit, and "balance due": a healing-check or completed project with a fixed price still owed, TAT-111)
```

2. In the "Scheduling (TAT-36)" bullet, replace

```
(`project_closed`, `not_scheduled`, `invalid_range`, and TAT-85's `not_started`, `not_booked` and `project_finished`)
```

with

```
(`project_closed`, `not_scheduled`, `invalid_range`, TAT-85's `not_started`, `not_booked` and `project_finished`, and TAT-111's `touch_ups_only`)
```

3. In the "Scheduling on a project (TAT-85)" bullet, replace

```
then `scheduleRefusal` (`#modules/scheduling/schedule_rules`: `reviewing` to `in_progress` take sessions, `completed` and `healing_check` are `project_finished`, `declined` and `cancelled` `project_closed`)
```

with

```
then `scheduleRefusal(status, kind)` (`#modules/scheduling/schedule_rules`: `reviewing` to `in_progress` take every kind, `healing_check` touch-ups only (`touch_ups_only`, TAT-111), `completed` is `project_finished`, `declined` and `cancelled` `project_closed`; `schedulableKinds` is the Sessions card's kind list)
```

4. After the "Projects and quotes (TAT-64)" bullet add a new bullet:

```markdown
- Finishing a project (TAT-111, which also covers TAT-87): two owner steps, `ProjectService.finish` (`in_progress` to `healing_check`, "Mark the tattoo finished") and `completeHealingCheck` (`healing_check` to `completed`, "Healing check done"), through `POST /t/:tenant/projects/:id/finish` and `…/complete` (`ProjectChangesController`; `requireOwner` gives the assigned artist a 404 before the body is read; TAT-30 makes it a capability). Under the project's lock (`lockFor`), `finishRefusal` (`#modules/projects/finish`) decides: the status must still be the step's (`ProjectRuleError` `move_not_allowed`: a second tap or a stale tab), no session of any kind may be scheduled (`session_scheduled`), and money still owed (`owed` of `DepositService.balance`, which reads the balance for ProjectService because PaymentService depends on it) must equal the `confirmedDue` (paisa digits) the page's confirmation sent (`balance_changed`); nothing owed needs no amount. A balance due never blocks: hourly totals are estimates and the desk records money afterwards (session and balance payments, refunds and reversals stay allowed; `completed` is not in `CLOSED_FOR_OUTCOME`, so no deposit outcome is asked). The healing check is due `HEALING_CHECK_DAYS` (28) after the studio's day the latest completed tattoo session ended (`healingCheckDueOn`, computed, never stored), takes touch-up sessions only, and the owner closes it any time; nothing closes it automatically and there is no undo. Only the status changes. Closed projects (declined, cancelled, completed) get no artist picker and no "Mark contacted" on the page (`closed`); the server still accepts both.
```

- [ ] **Step 2: `apps/platform/docs/ui.md`**

After the "Chat links (TAT-52)" bullet add:

```markdown
- Finishing (TAT-111): the project page's Finish card (`inertia/components/finish_card.tsx`, its words in `components/finish.ts`) sits right under the status card on an in-progress project (owners) and a healing check (owners, and the assigned artist without a button). Its step is confirmed in an inline panel (focus starts on "Not yet", Escape closes it and returns focus), never `window.confirm`. Closed projects (the `closed` prop) show no artist picker and no "Mark contacted". TAT-108 moves the card into the Next step card.
```

- [ ] **Step 3: `apps/platform/docs/testing.md`**

In the `twoStudios()` bullet replace

```
is the session routes' resource (TAT-85); an unread alert
```

with

```
is the session routes' resource (TAT-85); an in-progress project with a done tattoo session and one in its healing check, both assigned to `artistProfile` and without a quote (`finishProject`, `healingProject`), are the finish routes' (TAT-111); an unread alert
```

- [ ] **Step 4: `docs/requirements.md`**

1. Replace `Staff schedule more sessions on an open project from its page (from review to in progress; not on a finished or closed one), from today to a year ahead.` with `Staff schedule more sessions on an open project from its page (from review to in progress, and touch-ups during the healing check; not on a completed or closed one), from today to a year ahead.`
2. In the lifecycle block replace `→ booked → in_progress → completed → healing_check` with `→ booked → in_progress → healing_check → completed`.
3. Replace the two table rows

```
| `completed` | The last session is done and the balance is paid |
| `healing_check` | Follow-up for a touch-up or healed photo |
```

with

```
| `healing_check` | The tattoo is finished; the studio waits for a photo of the healed tattoo or does a touch-up (due four weeks after the last tattoo session) |
| `completed` | The healing check is done: the project is closed (a balance still due stays on it) |
```

4. After the bullet that starts `- Sessions block the artist's time` add:

```markdown
- An owner marks the tattoo finished once no session is left (from `in_progress`), which starts the healing check, and closes the check when the healed photo came or the touch-up is done (any time; nothing closes it automatically). Each step names a balance still due and asks to confirm it rather than blocking; the money can be recorded afterwards, and the projects list flags a finished fixed-price project that still owes. A healing check takes touch-up sessions only; there is no way back from either step. The assigned artist sees the healing check but can't take either step.
```

Do not tick any box.

- [ ] **Step 5: Commit**

`git -C <repo> add apps/platform/docs docs/requirements.md && git -C <repo> commit -m "docs: finishing a project and the healing check (TAT-111)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 9: Final verification

- [ ] **Step 1: Generated files and schema**

Run: `… DB_DATABASE=<test-db> pnpm -C <repo>/apps/platform exec node ace codegen` → `git -C <repo> status --short` shows nothing new. `git -C <repo> diff 65eab5f --stat -- apps/platform/database` → empty (no migration, no schema change).

- [ ] **Step 2: Root gates**

Run from `<repo>`: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `… pnpm -C <repo> typecheck`, `… pnpm -C <repo> build` → all clean.

- [ ] **Step 3: Full suite**

Empty `queue_jobs` in `<test-db>`, then in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=<test-db> PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/final-111.log 2>&1`. Expected: all pass, and the `Tests` count is the baseline + 37: unit 14 (`finish.spec.ts` 9, `schedule_rules.spec.ts` 2, `finish_copy.spec.ts` 2, `messages.spec.ts` 1), functional 23 (`project_finish.spec.ts` 11, `project_finish_http.spec.ts` 9, `session_scheduling.spec.ts` 1, `cross_tenant.spec.ts` 2). If the difference is not 37, list which files differ and why in your report.

---

### Task 10: Browser pass (375 × 812 and 1280 × 800, light and dark)

Run the platform dev server on `PORT=3401` against `<test-db>` (the coordinator's environment; never 3333), sign in as the throwaway owner, and seed or create: an in-progress project with a fixed quote and money owed (book a session from "Book session", give it a price, mark the session done after its start, or use `seed:dev` data and record outcomes). Then check, and screenshot into `<scratchpad>/tat-111-shots/`:

1. The Finish card is the second card; "Balance due: NPR …" shows; the button is at least 44 px tall; tapping it opens the panel with focus on "Not yet"; Escape closes it and focus returns to the button; `document.documentElement.scrollWidth` is 375 at phone width.
2. "Mark finished": the flash names the due day and the money still owed; the card is "Healing check" with "Due …"; "Message the client" starts on Aftercare and its text ends with "In about four weeks, send us a photo of the healed tattoo here."; the Sessions card's Kind lists only Touch-up.
3. Schedule a touch-up: the card shows "Record or cancel the scheduled session under Sessions first."; mark it done after its start (or cancel it); "Healing check done" → "Close the project": the Completed badge, no artist picker, no "Mark contacted", no "Schedule a session".
4. Projects → Closed: the project with "balance due"; record the rest at the desk on the project; the flag is gone.
5. Dark mode: the panel's wash and text read well. If an artist account can be linked, its view shows no Finish card on in-progress and the healing check without a button.

Stop the server you started (by its exact PID) when done.

---

### Task 11: Report

Report to the coordinator: the commit list, the final `Tests` line and its difference from the baseline, the gates, the browser pass with the screenshot paths, any deviation from this plan (a renamed symbol, an adjusted assertion) with the reason, and confirmation that no migration, push or PR happened.
