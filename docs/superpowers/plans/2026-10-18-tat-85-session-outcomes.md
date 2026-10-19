# Session outcomes and moving a session (TAT-85) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff mark a scheduled session done, no-show or cancelled and move it to another time from the project page's Sessions card; the first finished tattoo session moves a booked project to In progress; owners change any session, artists their own on their own projects; the studio's sessions can be counted by status for the pilot metrics. Part 2 (Tasks 8 to 10): staff schedule a session on an existing project from the same card, and a tattoo session books a `deposit_pending` project whose deposit is settled in the same transaction. About 5 points in all.

**Architecture:** Pure rules in `#modules/scheduling/outcomes` (`outcomeRefusal`, `outcomesFor`, `mayChangeSession`) and a shared time reader in `#modules/scheduling/validators/session` (`readSessionTimes`, which TAT-43's booking validator moves onto). `SessionService` gains `findChangeable`, `recordOutcome`, `move` and `countByStatus`, and its `finish` applies one order-independent work rule. A thin `ProjectSessionsController` behind two `/t/:tenant/sessions/:id/…` routes; the project page gets per-session actions as props and a new `SessionsCard` component. Part 2 adds pure `#modules/scheduling/schedule_rules` (`scheduleRefusal`, `scheduledNote`, `schedulingHint`), `scheduleValidator` / `toNewSession`, `SessionService.scheduleFor` (which shares `schedule`'s body, so the existing booking rule runs under the project's lock), `ProjectSessionsController.store` behind `POST /t/:tenant/projects/:id/sessions`, a `scheduling` page prop and a schedule form on the card. No migration.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, VineJS, Luxon, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4 for the dashboard; Tuyau `urlFor`.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-85-session-outcomes-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator rebases this branch onto the newest built tip, then builds in the main folder or a worktree; say which in your report). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **No migration.** `apps/platform/database/schema.ts` must not change. No API, OpenAPI, SDK or storefront change.
- **Routes (exact):** `POST /t/:tenant/sessions/:id/outcome` named `tenant.sessions.outcome` and `POST /t/:tenant/sessions/:id/move` named `tenant.sessions.move`, in a new `/sessions` group with `middleware.role({ allow: ["owner", "artist"] })`, controller `ProjectSessionsController` (`app/controllers/project_sessions_controller.ts`, `controllers.ProjectSessions`). The outcome's body field is `status` (TAT-66's deposit form on the same page owns `outcome`). Part 2: `POST /t/:tenant/projects/:id/sessions` named `tenant.projects.sessions.store` in the existing `/projects` group, action `ProjectSessionsController.store`; body `sessionKind`, `sessionArtistId`, `date`, `startTime`, `hours` (the page's quote, payment and assignment forms own `kind` and `artistId`).
- **Copy (verbatim).** Flash success: `Session marked done.`, `Marked as a no-show. The time is free again.`, `Session cancelled. The time is free again.`, each + ` The project is now in progress.` when the project moved; `Session moved: {sessionTimeText}.`. Flash errors: `not_scheduled` `This session already has an outcome, and outcomes can't be changed.` (outcome) / `This session already has an outcome, so it can't be moved.` (move); `not_started` `This session hasn't started yet: mark it done or a no-show once it has.`; `not_booked` `This project isn't booked yet, so its tattoo session can't be marked done.`; `project_closed` / `invalid_range` `This session can't be changed.`. Field errors: `status` `Choose done, no-show or cancelled.`; `startTime` overlap `{Artist} already has a session at that time. Pick another time.`; date, time and length: TAT-43's messages (unchanged). Card: buttons `Done`, `No-show`, `Move`, `Cancel session`; confirm buttons `Mark done`, `Mark no-show`, `Cancel session`; dismiss `Keep it scheduled`; move form `Date`, `Start time`, `Length (hours)`, hint `In quarter hours: 2.5 for two and a half.`, buttons `Move session` / `Keep this time`; hint `It can be marked done once the project is booked.`; questions as in Task 7's `outcomeQuestion`. Part 2: flash `Session scheduled: {sessionTimeText}.` + `scheduledNote` (Task 8); refusals `project_closed` `This project is closed: it takes no new sessions.`, `project_finished` `This project is finished: it takes no new sessions.`; field errors `sessionKind` `Choose tattoo, consultation or touch-up.`, `sessionArtistId` `Choose an artist from the list.`; form `Schedule a session` (button), `Kind` (`Tattoo`, `Consultation`, `Touch-up`), `Artist`, `Choose an artist`, `{name} (you)`, `Date`, `Start time`, `Length (hours)`, `Schedule session` / `Close`, hint from `schedulingHint` (Task 8); TAT-66's payments flash becomes ` Schedule a tattoo session under Sessions to book the project.`
- Fixture slugs in new tests end in `-85` (`outcome-needle-85`, …): the tests share the dev database, where a slug someone once used stays taken. Tests next to existing ones in a file keep that file's studio.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities only), touch targets 44 px (`h-11`).
- Tests: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After controller or route changes run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope, each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **An artist changing a session that isn't theirs.** Another artist's session on their project, their own session on a project reassigned to someone else (also while their request waited for the lock), and an artist without a linked profile must all be 404s with nothing changed. Tests: Task 3 "owners change any session; an artist only their own…", "a project reassigned while the artist's request waited…"; Task 5 "an artist changes their own session on their project; anything else is a 404…".
2. **A final outcome stays final.** A double tap or a stale page must be the `not_scheduled` refusal with the first outcome intact, for outcomes and moves. Tests: Task 3 "an outcome is final…"; Task 5 "a refused outcome is a flash and changes nothing".
3. **A refused move saves nothing.** An overlap must leave the session's time as it was and the request usable. Tests: Task 3 "an overlap with the artist's other session saves nothing…"; Task 5 "an overlap is a field error on the start time and nothing is saved".
4. **The project's status doesn't depend on the order of events.** A second scheduled tattoo session keeps the project booked; cancelling or missing the next session after the work started puts it back in progress; a withdrawal still ends cancelled. Tests: Task 3's three "tattoo work" tests and "a booked project with a finished tattoo session ends cancelled…".
5. **TAT-43's booking keeps its exact rules and messages** after its time checks move to `readSessionTimes`. Tests: `booking_validator.spec.ts` and `bookings_http.spec.ts`, unchanged, in Task 2.
6. **Part 2: an inquiry project must be able to book.** A `deposit_pending` project whose deposit is zero or covered must become `booked` in the same call that schedules its tattoo session; an uncovered one stays `deposit_pending` and the later deposit books it; before acceptance, accepting a zero-deposit quote books it. Tests: Task 8 "a tattoo session books a deposit_pending project whose deposit is zero or covered…", "an uncovered deposit keeps the project deposit_pending…", "before acceptance a tattoo session holds the date…"; Task 9 "a covered deposit books the project as the tattoo session is scheduled".
7. **Part 2: who may schedule.** An artist member only with their own profile on their own project (also after a reassignment while waiting for the lock); another studio's artist id must be a field error with both studios unchanged; an overlap must leave no session and no project artist behind. Tests: Task 8 "artists schedule only with their own profile…", "an overlap saves nothing, not even the project's artist"; Task 9 "another studio's artist is a field error…", "artists schedule with their own profile on their own project only".

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> branch --show-current` → `harublank00/tat-85-session-outcomes-mark-completed-no-show-or-cancelled-and`; `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -1 -- docs/superpowers/plans/2026-10-18-tat-85-session-outcomes.md` → the design commit "docs(platform): spec and plan for TAT-85 session outcomes and moving a session".

- [ ] **Step 2: The base holds the built chain**

Run: `git -C <repo> merge-base --is-ancestor 1b535f1 HEAD && echo chain-ok` → `chain-ok` (TAT-66's built tip, holding TAT-24, 32, 51, 65 and 66). **If it prints nothing, STOP:** the branch still sits on 37a612d; ask the coordinator to rebase it (`git rebase --onto <newest built tip> 37a612d`) and do not build on the old base. Note in your report which tip you built on (`git -C <repo> log --oneline -1 HEAD~1`).

- [ ] **Step 3: The names this plan edits exist**

Each command must print at least one line (run from anywhere):

```
git -C <repo> grep -n "async function lockScheduled" -- apps/platform/app/modules/scheduling/services/session_service.ts
git -C <repo> grep -n "private async finish" -- apps/platform/app/modules/scheduling/services/session_service.ts
git -C <repo> grep -n '"invalid_range",' -- apps/platform/app/modules/scheduling/errors.ts
git -C <repo> grep -n "export const BOOKED_STATUSES" -- apps/platform/app/modules/projects/quotes.ts
git -C <repo> grep -n "export function lastBookableDay" -- apps/platform/app/modules/projects/quotes.ts
git -C <repo> grep -n "^function startOf" -- apps/platform/app/modules/projects/validators/booking.ts
git -C <repo> grep -n "export type Member" -- apps/platform/app/modules/projects/services/project_service.ts
git -C <repo> grep -n '"in_progress",' -- apps/platform/app/modules/projects/moves.ts
git -C <repo> grep -n "<CardTitle>Sessions</CardTitle>" -- apps/platform/inertia/pages/projects/show.tsx
git -C <repo> grep -n "PaymentsCard" -- apps/platform/inertia/pages/projects/show.tsx
git -C <repo> grep -n "sessions: sessions.map((session) => ({" -- apps/platform/app/controllers/projects_controller.ts
git -C <repo> grep -n 'area: "calendar", allow: \["owner", "artist"\]' -- apps/platform/tests/functional/tenancy/tenant_routes.spec.ts
git -C <repo> grep -n '| "depositProject"' -- apps/platform/tests/isolation/cases.ts
git -C <repo> grep -n "depositReferenceCode: deposit.link.referenceCode," -- apps/platform/tests/helpers/tenants.ts
git -C <repo> grep -n "The calendar: owners (the whole studio or one artist)" -- apps/platform/start/routes.ts
```

Each of these must print nothing:

```
git -C <repo> grep -n '"/sessions"' -- apps/platform/start/routes.ts
git -C <repo> ls-files apps/platform/app/controllers/project_sessions_controller.ts
git -C <repo> grep -n 'name="status"\|name="date"\|name="startTime"\|name="hours"' -- apps/platform/inertia/pages/projects/show.tsx apps/platform/inertia/components/payments_card.tsx
```

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 4: Install and environment**

If `<repo>/node_modules` is missing: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Check the platform env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok` (if not, ask the coordinator; never create or read it yourself).

- [ ] **Step 5: Baseline**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_service.spec.ts --files=project_service.spec.ts --files=project_page.spec.ts --files=bookings_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=booking_validator.spec.ts --files=times.spec.ts`. Expected: PASS. Then the full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line (the final count must be about 69 higher; Task 12 has the breakdown).

---

### Task 1: The outcome rules

**Files:**
- Create: `apps/platform/app/modules/scheduling/outcomes.ts`
- Modify: `apps/platform/app/modules/scheduling/errors.ts`
- Modify: `apps/platform/app/modules/scheduling/times.ts`
- Test: `apps/platform/tests/unit/modules/scheduling/outcome_rules.spec.ts` (create), `apps/platform/tests/unit/modules/scheduling/times.spec.ts` (add a group)

**Interfaces:**
- Produces, from `#modules/scheduling/outcomes`: `SESSION_OUTCOMES = ["completed", "no_show", "cancelled"] as const`; `type SessionOutcome`; `outcomeRefusal(session: { status, kind, startsAt }, projectStatus: ProjectStatus, outcome: SessionOutcome, now: DateTime): SessionRuleReason | null`; `outcomesFor(session, projectStatus, now): SessionOutcome[]`; `mayChangeSession(member: { role: string }, ownArtistId: string | null, session: { artistId: string }, project: { artistId: string | null }): boolean`.
- `SessionRuleReason` gains `not_started` and `not_booked`.
- From `#modules/scheduling/times`: `sessionFormValues(startsAt: DateTime, endsAt: DateTime, timezone: string, today: string, last: string): { date: string; startTime: string; hours: number }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/scheduling/outcome_rules.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	mayChangeSession,
	outcomeRefusal,
	outcomesFor,
	SESSION_OUTCOMES,
} from "#modules/scheduling/outcomes";

const NOW = DateTime.fromISO("2026-11-02T10:00:00Z");

type Subject = Parameters<typeof outcomeRefusal>[0];

/** A scheduled tattoo session that started an hour ago. */
const session = (over: Partial<Subject> = {}): Subject => ({
	status: "scheduled",
	kind: "tattoo",
	startsAt: NOW.minus({ hours: 1 }),
	...over,
});

test.group("outcomeRefusal and outcomesFor", () => {
	test("a started tattoo session of a booked project takes every outcome", ({
		assert,
	}) => {
		assert.deepEqual(
			[...SESSION_OUTCOMES],
			["completed", "no_show", "cancelled"],
		);
		for (const status of [
			"booked",
			"in_progress",
			"completed",
			"healing_check",
		] as const) {
			assert.deepEqual(
				outcomesFor(session(), status, NOW),
				["completed", "no_show", "cancelled"],
				status,
			);
		}
	});

	test("before its start a session can only be cancelled; at its start it has started", ({
		assert,
	}) => {
		const later = session({ startsAt: NOW.plus({ minutes: 1 }) });
		assert.equal(
			outcomeRefusal(later, "booked", "completed", NOW),
			"not_started",
		);
		assert.equal(outcomeRefusal(later, "booked", "no_show", NOW), "not_started");
		assert.isNull(outcomeRefusal(later, "booked", "cancelled", NOW));
		assert.deepEqual(outcomesFor(later, "booked", NOW), ["cancelled"]);
		assert.deepEqual(outcomesFor(session({ startsAt: NOW }), "booked", NOW), [
			"completed",
			"no_show",
			"cancelled",
		]);
	});

	test("tattoo work is marked done only once the project is booked; other kinds any time", ({
		assert,
	}) => {
		for (const status of [
			"reviewing",
			"quoted",
			"on_hold",
			"deposit_pending",
		] as const) {
			assert.equal(
				outcomeRefusal(session(), status, "completed", NOW),
				"not_booked",
				status,
			);
			assert.deepEqual(
				outcomesFor(session(), status, NOW),
				["no_show", "cancelled"],
				status,
			);
			for (const kind of ["consultation", "touch_up"] as const) {
				assert.isNull(
					outcomeRefusal(session({ kind }), status, "completed", NOW),
					`${kind} in ${status}`,
				);
			}
		}
	});

	test("a recorded outcome is final", ({ assert }) => {
		for (const status of ["completed", "no_show", "cancelled"] as const) {
			for (const outcome of SESSION_OUTCOMES) {
				assert.equal(
					outcomeRefusal(session({ status }), "booked", outcome, NOW),
					"not_scheduled",
					`${status} to ${outcome}`,
				);
			}
			assert.deepEqual(outcomesFor(session({ status }), "booked", NOW), []);
		}
	});
});

test.group("mayChangeSession", () => {
	const OWNER = { role: "owner" };
	const ARTIST = { role: "artist" };
	const mine = { artistId: "profile-sita" };
	const theirs = { artistId: "profile-anu" };

	test("owners change any session", ({ assert }) => {
		for (const subject of [mine, theirs]) {
			for (const project of [
				{ artistId: "profile-sita" },
				{ artistId: "profile-anu" },
				{ artistId: null },
			]) {
				assert.isTrue(mayChangeSession(OWNER, null, subject, project));
			}
		}
	});

	test("an artist changes only their own session, on a project assigned to them", ({
		assert,
	}) => {
		assert.isTrue(
			mayChangeSession(ARTIST, "profile-sita", mine, {
				artistId: "profile-sita",
			}),
		);
		assert.isFalse(
			mayChangeSession(ARTIST, "profile-sita", theirs, {
				artistId: "profile-sita",
			}),
			"another artist's session on my project",
		);
		assert.isFalse(
			mayChangeSession(ARTIST, "profile-sita", mine, {
				artistId: "profile-anu",
			}),
			"my session on someone else's project",
		);
		assert.isFalse(
			mayChangeSession(ARTIST, "profile-sita", mine, { artistId: null }),
			"a project without an artist",
		);
		assert.isFalse(
			mayChangeSession(ARTIST, null, mine, { artistId: "profile-sita" }),
			"no linked profile",
		);
	});
});
```

In `apps/platform/tests/unit/modules/scheduling/times.spec.ts`, change the import to:

```ts
import {
	localDateTime,
	sessionFormValues,
	sessionTimeText,
} from "#modules/scheduling/times";
```

and add at the end of the file:

```ts
test.group("sessionFormValues", () => {
	test("the move form starts from the session's local day, start and length", ({
		assert,
	}) => {
		// 10:00 UTC is 15:45 in Kathmandu.
		const startsAt = DateTime.utc(2026, 11, 2, 10);
		assert.deepEqual(
			sessionFormValues(
				startsAt,
				startsAt.plus({ minutes: 150 }),
				KTM,
				"2026-10-18",
				"2027-10-18",
			),
			{ date: "2026-11-02", startTime: "15:45", hours: 2.5 },
		);
	});

	test("the day is the studio's, and a day that can't be chosen starts on today", ({
		assert,
	}) => {
		// 19:00 UTC on 1 Nov is 00:45 on 2 Nov in Kathmandu.
		const late = DateTime.utc(2026, 11, 1, 19);
		assert.equal(
			sessionFormValues(late, late.plus({ hours: 1 }), KTM, "2026-10-18", "2027-10-18")
				.date,
			"2026-11-02",
		);
		const past = DateTime.utc(2026, 10, 1, 4);
		assert.deepEqual(
			sessionFormValues(past, past.plus({ hours: 2 }), KTM, "2026-10-18", "2027-10-18"),
			{ date: "2026-10-18", startTime: "09:45", hours: 2 },
		);
		const far = DateTime.utc(2027, 11, 1, 4);
		assert.equal(
			sessionFormValues(far, far.plus({ hours: 2 }), KTM, "2026-10-18", "2027-10-18")
				.date,
			"2026-10-18",
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=outcome_rules.spec.ts --files=times.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log says `Cannot find module` for `#modules/scheduling/outcomes` (or that `times` does not provide `sessionFormValues`).

- [ ] **Step 3: Add the two rule reasons**

In `apps/platform/app/modules/scheduling/errors.ts`, replace the reasons and their messages:

```ts
export const SESSION_RULE_REASONS = [
	"project_closed",
	"not_scheduled",
	"invalid_range",
	"not_started",
	"not_booked",
] as const;
export type SessionRuleReason = (typeof SESSION_RULE_REASONS)[number];

const MESSAGES: Record<SessionRuleReason, string> = {
	project_closed: "A declined or cancelled project takes no new sessions",
	not_scheduled: "Only a scheduled session can be changed",
	invalid_range: "A session must end after it starts",
	not_started:
		"Only a session that has started can be marked completed or no-show",
	not_booked:
		"A tattoo session can be marked completed only once its project is booked",
};
```

- [ ] **Step 4: Write the rules**

Create `apps/platform/app/modules/scheduling/outcomes.ts`:

```ts
import type { DateTime } from "luxon";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { BOOKED_STATUSES } from "#modules/projects/quotes";
import type { SessionRuleReason } from "#modules/scheduling/errors";
import type {
	SessionKind,
	SessionStatus,
} from "#modules/scheduling/models/project_session";

/** What staff record on a scheduled session (TAT-85), as its new status. */
export const SESSION_OUTCOMES = ["completed", "no_show", "cancelled"] as const;
export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

/** What the rules read of a session. */
type Subject = { status: SessionStatus; kind: SessionKind; startsAt: DateTime };

/**
 * Why `outcome` can't be recorded on `session` now, or null when it can.
 * An outcome is final ("not_scheduled"); done and no-show wait for the
 * session's start ("not_started"; there is no later limit, so yesterday's
 * session is recorded today); and tattoo work is done only on a project
 * that is booked or later ("not_booked": custom work is never booked
 * before its deposit, and the expiry would cancel a deposit_pending project
 * with finished work). SessionService enforces it under its row locks; the
 * project page offers only what it allows.
 */
export function outcomeRefusal(
	session: Subject,
	projectStatus: ProjectStatus,
	outcome: SessionOutcome,
	now: DateTime,
): SessionRuleReason | null {
	if (session.status !== "scheduled") return "not_scheduled";
	if (outcome === "cancelled") return null;
	if (session.startsAt.toMillis() > now.toMillis()) return "not_started";
	if (
		outcome === "completed" &&
		session.kind === "tattoo" &&
		!BOOKED_STATUSES.includes(projectStatus)
	) {
		return "not_booked";
	}
	return null;
}

/** The outcomes that can be recorded on `session` now, in button order. */
export function outcomesFor(
	session: Subject,
	projectStatus: ProjectStatus,
	now: DateTime,
): SessionOutcome[] {
	return SESSION_OUTCOMES.filter(
		(outcome) => outcomeRefusal(session, projectStatus, outcome, now) === null,
	);
}

/**
 * Who may record an outcome on a session or move it: owners any session;
 * an artist member only a session with their own linked live profile
 * (`ownArtistId`, null without one), on a project assigned to that profile
 * (the project page they can open). TAT-30 folds this into the roles.
 */
export function mayChangeSession(
	member: { role: string },
	ownArtistId: string | null,
	session: { artistId: string },
	project: { artistId: string | null },
): boolean {
	if (member.role === "owner") return true;
	return (
		ownArtistId !== null &&
		session.artistId === ownArtistId &&
		project.artistId === ownArtistId
	);
}
```

- [ ] **Step 5: Add the move form's starting values**

At the end of `apps/platform/app/modules/scheduling/times.ts` add:

```ts
/**
 * The move form's starting values for a session (TAT-85), in the studio's
 * timezone: its local day (today when that day can't be chosen: it has
 * passed, or is more than a year ahead), its local start time and its
 * length in hours. `today` and `last` are the form's first and last day
 * (yyyy-MM-dd).
 */
export function sessionFormValues(
	startsAt: DateTime,
	endsAt: DateTime,
	timezone: string,
	today: string,
	last: string,
): { date: string; startTime: string; hours: number } {
	const start = startsAt.setZone(timezone);
	const date = start.toFormat("yyyy-MM-dd");
	return {
		date: date >= today && date <= last ? date : today,
		startTime: start.toFormat("HH:mm"),
		hours: endsAt.diff(startsAt, "minutes").minutes / 60,
	};
}
```

- [ ] **Step 6: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=outcome_rules.spec.ts --files=times.spec.ts`
Expected: PASS (6 new rule tests, 2 new times tests, the old times tests). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 7: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/scheduling/outcomes.ts apps/platform/app/modules/scheduling/errors.ts apps/platform/app/modules/scheduling/times.ts apps/platform/tests/unit/modules/scheduling/outcome_rules.spec.ts apps/platform/tests/unit/modules/scheduling/times.spec.ts
git -C <repo> add apps/platform/app/modules/scheduling/outcomes.ts apps/platform/app/modules/scheduling/errors.ts apps/platform/app/modules/scheduling/times.ts apps/platform/tests/unit/modules/scheduling/outcome_rules.spec.ts apps/platform/tests/unit/modules/scheduling/times.spec.ts
git -C <repo> commit -m "feat(platform): add the rules for recording a session's outcome" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One set of session time rules for booking and moving

**Files:**
- Create: `apps/platform/app/modules/scheduling/validators/session.ts`
- Modify: `apps/platform/app/modules/projects/validators/booking.ts` (replace the whole file)
- Test: `apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts` (create); regression: `tests/unit/modules/projects/booking_validator.spec.ts`, `tests/functional/projects/bookings_http.spec.ts` (unchanged)

**Interfaces:**
- Produces, from `#modules/scheduling/validators/session`: `sessionTimeFields()` (`date`, `startTime`, `hours` vine schemas), `SESSION_TIME_MESSAGES`, `QUARTERS` (the quarter-hours message), `type Fail`, `type SessionTimeForm = { date: string; startTime: string; hours: number }`, `readSessionTimes(form, timezone, now, fail): SessionTimes | null`, `sessionTimeValidator`, `toSessionTimes(form, timezone, now = DateTime.now()): SessionTimes` (throws E_VALIDATION_ERROR), `outcomeValidator` (`{ status: SessionOutcome }`).
- Consumes: `SESSION_OUTCOMES` (Task 1), `localDateTime`, `todayIn`, `lastBookableDay`, `SessionTimes` (type, from `session_service`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts`:

```ts
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import {
	outcomeValidator,
	type SessionTimeForm,
	sessionTimeValidator,
	toSessionTimes,
} from "#modules/scheduling/validators/session";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";
// 20:00 UTC is already 01:45 on 15 Oct in Kathmandu (UTC+5:45).
const NOW = DateTime.fromISO("2026-10-14T20:00:00Z");

const DAY = "Pick a date from today to a year from now.";
const TIME = "Enter the start time, like 14:00.";
const LENGTH = "Enter a length from 0.25 to 12 hours.";
const QUARTERS = "Use quarter hours: 0.25, 0.5, 0.75 and so on.";

/** The field → message map a validation error carries, or {} if it passes. */
async function problems(work: () => unknown) {
	try {
		await work();
		return {};
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			return Object.fromEntries(
				(error.messages as { field: string; message: string }[]).map(
					({ field, message }) => [field, message],
				),
			);
		}
		throw error;
	}
}

const form = (over: Partial<SessionTimeForm> = {}): SessionTimeForm => ({
	date: "2026-10-20",
	startTime: "14:00",
	hours: 3,
	...over,
});

test.group("sessionTimeValidator and outcomeValidator", () => {
	test("the move form's shape, in the booking form's words", async ({
		assert,
	}) => {
		assert.deepEqual(
			await sessionTimeValidator.validate({
				date: "2026-10-20",
				startTime: "14:00",
				hours: "2.5",
			}),
			{ date: "2026-10-20", startTime: "14:00", hours: 2.5 },
		);
		const wrong = { date: DAY, startTime: TIME, hours: LENGTH };
		assert.deepEqual(
			await problems(() =>
				sessionTimeValidator.validate({
					date: "20/10/2026",
					startTime: "2pm",
					hours: "13",
				}),
			),
			wrong,
		);
		assert.deepEqual(
			await problems(() => sessionTimeValidator.validate({})),
			wrong,
		);
	});

	test("an outcome is done, no-show or cancelled", async ({ assert }) => {
		for (const status of ["completed", "no_show", "cancelled"]) {
			assert.deepEqual(await outcomeValidator.validate({ status }), {
				status,
			});
		}
		for (const body of [{ status: "done" }, { status: "scheduled" }, {}]) {
			assert.deepEqual(
				await problems(() => outcomeValidator.validate(body)),
				{ status: "Choose done, no-show or cancelled." },
				JSON.stringify(body),
			);
		}
	});
});

test.group("toSessionTimes", () => {
	test("a local date and time in the studio's timezone, the length as elapsed time", ({
		assert,
	}) => {
		const times = toSessionTimes(form(), KTM, NOW);
		assert.equal(times.startsAt.toUTC().toISO(), "2026-10-20T08:15:00.000Z");
		assert.equal(times.endsAt.toUTC().toISO(), "2026-10-20T11:15:00.000Z");
	});

	test("from today to a year ahead; earlier today is fine", async ({
		assert,
	}) => {
		// Today in Kathmandu is 15 Oct 2026.
		for (const date of ["2026-10-14", "2027-10-16", "2026-11-31"]) {
			assert.deepEqual(
				await problems(() => toSessionTimes(form({ date }), KTM, NOW)),
				{ date: DAY },
				date,
			);
		}
		assert.deepEqual(
			await problems(() =>
				toSessionTimes(form({ date: "2027-10-15" }), KTM, NOW),
			),
			{},
		);
		const early = toSessionTimes(
			form({ date: "2026-10-15", startTime: "00:15" }),
			KTM,
			NOW,
		);
		assert.isBelow(early.startsAt.toMillis(), NOW.toMillis());
	});

	test("clock changes: a skipped time is refused, a repeated one is its first, the length is elapsed", async ({
		assert,
	}) => {
		// 14 March 2027: New York's clocks jump from 02:00 to 03:00.
		assert.deepEqual(
			await problems(() =>
				toSessionTimes(
					form({ date: "2027-03-14", startTime: "02:30" }),
					NY,
					NOW,
				),
			),
			{
				startTime:
					"That time doesn't exist on this day because the clocks change. Pick another.",
			},
		);
		// 1 November 2026: New York passes 01:00–02:00 twice; 01:30 is the
		// first one (EDT, UTC−4), and an hour later is 01:30 EST.
		const repeated = toSessionTimes(
			form({ date: "2026-11-01", startTime: "01:30", hours: 1 }),
			NY,
			NOW,
		);
		assert.equal(repeated.startsAt.toUTC().toISO(), "2026-11-01T05:30:00.000Z");
		assert.equal(repeated.endsAt.toUTC().toISO(), "2026-11-01T06:30:00.000Z");
	});

	test("quarter hours, and every problem at once", async ({ assert }) => {
		assert.deepEqual(
			await problems(() => toSessionTimes(form({ hours: 2.1 }), KTM, NOW)),
			{ hours: QUARTERS },
		);
		assert.deepEqual(
			await problems(() =>
				toSessionTimes(form({ date: "2026-10-01", hours: 0.3 }), KTM, NOW),
			),
			{ date: DAY, hours: QUARTERS },
		);
		const short = toSessionTimes(form({ hours: 0.25 }), KTM, NOW);
		assert.equal(short.endsAt.diff(short.startsAt, "minutes").minutes, 15);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=session_validator.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and `Cannot find module` for `#modules/scheduling/validators/session`.

- [ ] **Step 3: Write the shared validators**

Create `apps/platform/app/modules/scheduling/validators/session.ts`:

```ts
import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import { DateTime } from "luxon";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import { SESSION_OUTCOMES } from "#modules/scheduling/outcomes";
import type { SessionTimes } from "#modules/scheduling/services/session_service";
import { localDateTime } from "#modules/scheduling/times";

const DAY = "Pick a date from today to a year from now.";
const TIME = "Enter the start time, like 14:00.";
const LENGTH = "Enter a length from 0.25 to 12 hours.";
const SKIPPED =
	"That time doesn't exist on this day because the clocks change. Pick another.";
const OUTCOME = "Choose done, no-show or cancelled.";

/** Quarter hours: a session's length, and the booking form's estimated hours. */
export const QUARTERS = "Use quarter hours: 0.25, 0.5, 0.75 and so on.";

/**
 * A session's time as a form gives it (TAT-43's booking form, TAT-85's
 * move form): the studio's local date (yyyy-MM-dd) and start time (HH:mm),
 * and the length in hours, 0.25 to 12. What depends on the studio's
 * timezone is readSessionTimes'.
 */
export function sessionTimeFields() {
	return {
		date: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
		hours: vine.number().range([0.25, 12]),
	};
}

/** sessionTimeFields' messages, in the forms' words. */
export const SESSION_TIME_MESSAGES = {
	"date.required": DAY,
	"date.regex": DAY,
	"startTime.required": TIME,
	"startTime.regex": TIME,
	"hours.required": LENGTH,
	"hours.number": LENGTH,
	"hours.range": LENGTH,
};

export type SessionTimeForm = {
	date: string;
	startTime: string;
	hours: number;
};

/** Collects a field error shown next to `field`, like the validator's own. */
export type Fail = (field: string, message: string, rule: string) => void;

/**
 * A session's start and end from the form, or null after reporting what's
 * wrong through `fail`: a real day from the studio's today to a year ahead
 * (yyyy-MM-dd strings compare as text; a time earlier today is fine: the
 * client is in the chair), a start time that exists that day (localDateTime:
 * a time the clocks skip is an error, one they pass twice is its first
 * occurrence), and a length in quarter hours, as elapsed time.
 */
export function readSessionTimes(
	form: SessionTimeForm,
	timezone: string,
	now: DateTime,
	fail: Fail,
): SessionTimes | null {
	const today = todayIn(timezone, now);
	const real = DateTime.fromISO(form.date, { zone: "utc" }).isValid;
	let startsAt: DateTime | null = null;
	if (!real || form.date < today || form.date > lastBookableDay(today)) {
		fail("date", DAY, "range");
	} else {
		startsAt = localDateTime(form.date, form.startTime, timezone);
		if (!startsAt) fail("startTime", SKIPPED, "time");
	}
	const quarters = Number.isInteger(form.hours * 4);
	if (!quarters) fail("hours", QUARTERS, "quarterHours");
	if (!startsAt || !quarters) return null;
	return { startsAt, endsAt: startsAt.plus({ minutes: form.hours * 60 }) };
}

/** The move form (TAT-85): only the new time. */
export const sessionTimeValidator = vine.create(sessionTimeFields());
sessionTimeValidator.messagesProvider = new SimpleMessagesProvider(
	SESSION_TIME_MESSAGES,
);

/**
 * SessionService.move's input from the validated move form. Throws
 * E_VALIDATION_ERROR, shown next to the field, for what the shape can't
 * check (readSessionTimes).
 */
export function toSessionTimes(
	form: SessionTimeForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): SessionTimes {
	const problems: { field: string; message: string; rule: string }[] = [];
	const times = readSessionTimes(form, timezone, now, (field, message, rule) => {
		problems.push({ field, message, rule });
	});
	if (!times) throw new errors.E_VALIDATION_ERROR(problems);
	return times;
}

/** The outcome buttons (TAT-85): `status` is the session's new status. */
export const outcomeValidator = vine.create({
	status: vine.enum(SESSION_OUTCOMES),
});
outcomeValidator.messagesProvider = new SimpleMessagesProvider({
	"status.required": OUTCOME,
	"status.enum": OUTCOME,
});
```

- [ ] **Step 4: Move the booking validator onto it**

Replace `apps/platform/app/modules/projects/validators/booking.ts` with (only the time fields, their messages and their checks move; everything else is as it was):

```ts
import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DateTime } from "luxon";
import type {
	BookingClient,
	DirectBooking,
	QuickQuote,
} from "#modules/projects/services/booking_service";
import {
	PRICE_MESSAGES,
	priceFields,
} from "#modules/projects/validators/quote";
import {
	type Fail,
	QUARTERS,
	readSessionTimes,
	SESSION_TIME_MESSAGES,
	sessionTimeFields,
} from "#modules/scheduling/validators/session";
import { phoneNumber } from "#validators/phone";

/** What the booking form can say about the price. */
export const PRICE_KINDS = ["none", "fixed", "hourly"] as const;

/**
 * The booking form's shape (TAT-43), in the form's units: whole rupees,
 * hours, and the studio's local date (yyyy-MM-dd) and time (HH:mm), whose
 * fields the move form shares (sessionTimeFields, TAT-85). A returning
 * client comes as `clientId`; a new one as the looked-up `phone` (stored in
 * E.164) with `name` and `email`. Empty fields arrive as null. What depends
 * on another field or on the studio's timezone is checked by
 * toBookingInput.
 */
export const bookingValidator = vine.create({
	clientId: vine.string().uuid().nullable().optional(),
	phone: vine.string().trim().use(phoneNumber()).nullable().optional(),
	name: vine.string().trim().maxLength(120).nullable().optional(),
	email: vine.string().trim().maxLength(254).email().nullable().optional(),
	artistId: vine.string().uuid(),
	...sessionTimeFields(),
	brief: vine.string().trim().minLength(1).maxLength(4000),
	priceKind: vine.enum(PRICE_KINDS),
	...priceFields(),
});

export type BookingForm = Infer<typeof bookingValidator>;

const LOOKUP = "Look the client's phone up first.";
const EMAIL = "Enter a valid email address.";
const ARTIST = "Choose an artist from the list.";
const BRIEF = "Describe the tattoo.";
const PRICE_KIND = "Choose no price, fixed or hourly.";

bookingValidator.messagesProvider = new SimpleMessagesProvider({
	"clientId.uuid": LOOKUP,
	"name.maxLength": "Keep the name under 120 characters.",
	"email.email": EMAIL,
	"email.maxLength": EMAIL,
	"artistId.required": ARTIST,
	"artistId.uuid": ARTIST,
	...SESSION_TIME_MESSAGES,
	"brief.required": BRIEF,
	"brief.minLength": BRIEF,
	"brief.maxLength": "Keep it under 4,000 characters.",
	"priceKind.required": PRICE_KIND,
	"priceKind.enum": PRICE_KIND,
	...PRICE_MESSAGES,
});

/**
 * BookingService's input from the validated form, in stored units: paisa,
 * minutes and instants. Throws E_VALIDATION_ERROR, shown next to the field,
 * for what the shape can't check: who the client is (a found client's id,
 * else the looked-up phone and a name), the session's time
 * (readSessionTimes: a day from today to a year ahead in the studio's
 * timezone, where a time earlier today is fine because the walk-in is in
 * the chair, a start time that exists on that day, quarter hours), and the
 * price fields of the chosen kind.
 */
export function toBookingInput(
	form: BookingForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): DirectBooking {
	const problems: { field: string; message: string; rule: string }[] = [];
	const fail: Fail = (field, message, rule) => {
		problems.push({ field, message, rule });
	};

	const client = clientOf(form, fail);
	const times = readSessionTimes(form, timezone, now, fail);
	const quote = quoteOf(form, fail);

	if (problems.length || !client || !times) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		client,
		artistId: form.artistId,
		brief: form.brief,
		startsAt: times.startsAt,
		endsAt: times.endsAt,
		quote,
	};
}

/** The returning client's id, or a new client from the lookup's phone. */
function clientOf(form: BookingForm, fail: Fail): BookingClient | null {
	if (form.clientId) return { kind: "existing", id: form.clientId };
	if (!form.phone) {
		fail("phone", LOOKUP, "required");
		return null;
	}
	if (!form.name) {
		fail("name", "Enter the client's name.", "required");
		return null;
	}
	return {
		kind: "new",
		name: form.name,
		phone: form.phone,
		email: form.email ?? null,
	};
}

/** The quick quote of the chosen kind, or null for "No price". */
function quoteOf(form: BookingForm, fail: Fail): QuickQuote | null {
	if (form.priceKind === "none") return null;
	if (form.priceKind === "fixed") {
		if (form.fixedPrice == null) {
			fail("fixedPrice", "Enter the price.", "required");
			return null;
		}
		return { kind: "fixed", fixedPrice: form.fixedPrice * 100 };
	}
	const rate = form.hourlyRate;
	const hours = form.estimatedHours;
	if (rate == null) fail("hourlyRate", "Enter the hourly rate.", "required");
	if (hours == null) {
		fail("estimatedHours", "Enter the estimated hours.", "required");
	} else if (!Number.isInteger(hours * 4)) {
		fail("estimatedHours", QUARTERS, "quarterHours");
	}
	if (rate == null || hours == null || !Number.isInteger(hours * 4)) {
		return null;
	}
	return {
		kind: "hourly",
		hourlyRate: rate * 100,
		estimatedMinutes: hours * 60,
	};
}
```

Before replacing, diff the current file against this one: if anything outside the time fields, their messages, `startOf`, the `DAY`/`TIME`/`LENGTH`/`QUARTERS`/`SKIPPED` constants and the `localDateTime`/`todayIn`/`lastBookableDay` imports differs (a later ticket changed it), keep that change.

- [ ] **Step 5: Run the new and the regression tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=session_validator.spec.ts --files=booking_validator.spec.ts`
Expected: PASS (6 new, every booking validator test unchanged).
Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=bookings_http.spec.ts`
Expected: PASS. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/scheduling/validators/session.ts apps/platform/app/modules/projects/validators/booking.ts apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts
git -C <repo> add apps/platform/app/modules/scheduling/validators/session.ts apps/platform/app/modules/projects/validators/booking.ts apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts
git -C <repo> commit -m "feat(platform): validate moving a session with the booking form's time rules" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `SessionService`: outcomes, moves and the work rule

**Files:**
- Modify: `apps/platform/app/modules/scheduling/services/session_service.ts` (replace the whole file)
- Test: `apps/platform/tests/functional/scheduling/session_service.spec.ts` (add a group), `apps/platform/tests/functional/projects/project_service.spec.ts` (add a group), `apps/platform/tests/functional/scheduling/session_outcomes.spec.ts` (create)

**Interfaces:**
- Produces on `SessionService`: `findChangeable(tenant, member: Member, id): Promise<ProjectSession>`; `recordOutcome(tenant, member, session, outcome: SessionOutcome, now?: DateTime): Promise<Recorded>` with `type Recorded = { session: ProjectSession; projectStatus: ProjectStatus; projectMoved: boolean }`; `move(tenant, member, session, times: SessionTimes): Promise<ProjectSession>`. `complete`, `markNoShow`, `cancel` and `reschedule` keep their signatures and now apply the work rule.
- Consumes: `mayChangeSession`, `outcomeRefusal`, `SessionOutcome` (Task 1); `type Member` from `#modules/projects/services/project_service` (type-only: `ProjectService` imports this service as a value).

- [ ] **Step 1: Write the failing work-rule tests**

At the end of `apps/platform/tests/functional/scheduling/session_service.spec.ts` add (it uses that file's `sessions`, `setup`, `slot`, `statusOf`, `makeProject` and `inTenant`):

```ts
test.group("SessionService tattoo work (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a booked project stays booked while another tattoo session is scheduled", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup("booked");

		await inTenant(tenant, async () => {
			const first = await sessions.schedule(tenant, project, slot(sita, 8, 10));
			const second = await sessions.schedule(
				tenant,
				project,
				slot(sita, 12, 14),
			);
			await sessions.complete(tenant, first);
			assert.equal(await statusOf(project), "booked");
			await sessions.complete(tenant, second);
			assert.equal(await statusOf(project), "in_progress");
		});
	});

	test("once the work started, cancelling or missing the next tattoo session puts the project back in progress", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			for (const [index, action] of (["cancel", "markNoShow"] as const).entries()) {
				const base = index * 6;
				const project = await makeProject(tenant, client, { status: "booked" });
				await sessions.complete(
					tenant,
					await sessions.schedule(tenant, project, slot(sita, base, base + 1)),
				);
				assert.equal(await statusOf(project), "in_progress", action);
				const next = await sessions.schedule(
					tenant,
					project,
					slot(sita, base + 2, base + 3),
				);
				assert.equal(await statusOf(project), "booked", action);
				await sessions[action](tenant, next);
				assert.equal(await statusOf(project), "in_progress", action);
			}
		});
	});

	test("a missed or cancelled first tattoo session, a consultation and a touch-up leave a booked project booked", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, { status: "booked" });
			await sessions.complete(
				tenant,
				await sessions.schedule(tenant, project, slot(sita, 8, 9, "consultation")),
			);
			await sessions.complete(
				tenant,
				await sessions.schedule(tenant, project, slot(sita, 9, 10, "touch_up")),
			);
			await sessions.markNoShow(
				tenant,
				await sessions.schedule(tenant, project, slot(sita, 10, 11)),
			);
			await sessions.cancel(
				tenant,
				await sessions.schedule(tenant, project, slot(sita, 11, 12)),
			);
			assert.equal(await statusOf(project), "booked");
		});
	});
});
```

At the end of `apps/platform/tests/functional/projects/project_service.spec.ts` add (it uses that file's `projects`, `OWNER`, `statusOf` and helpers):

```ts
test.group("ProjectService withdrawal after the work started (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a booked project with a finished tattoo session ends cancelled, its history kept", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
			});
			const artist = await makeArtist(tenant);
			const done = await makeSession(tenant, project, artist, {
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 12),
			});
			const next = await makeSession(tenant, project, artist);

			// Cancelling `next` passes the project through in_progress inside the
			// withdrawal's transaction; the withdrawal still decides the end.
			assert.equal(
				await projects.move(tenant, OWNER, project, "withdraw"),
				"cancelled",
			);
			assert.equal(await statusOf(project), "cancelled");
			await done.refresh();
			await next.refresh();
			assert.equal(done.status, "completed");
			assert.equal(next.status, "cancelled");
		});
	});
});
```

- [ ] **Step 2: Write the failing member-path tests**

Create `apps/platform/tests/functional/scheduling/session_outcomes.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import QuoteService from "#modules/projects/services/quote_service";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import SessionService from "#modules/scheduling/services/session_service";
import { dbClient } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(
	new ArtistService(new ImageService()),
	new DepositService(new QuoteService()),
);

/** An owner: the service never reads the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

/** Whole minutes from now: these sessions sit around the real clock. */
const fromNow = (minutes: number) =>
	DateTime.now().startOf("minute").plus({ minutes });

/** The reason of the SessionRuleError `fn` throws, or null if it succeeds. */
async function ruleOf(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		if (error instanceof SessionRuleError) return error.reason;
		throw error;
	}
	return null;
}

/**
 * A studio with a project in `status` assigned to Sita, whose profile is
 * linked to the artist member Asha; a second profile, Anu; and Ram, an
 * artist member with no linked profile.
 */
async function setup(status: ProjectStatus = "booked") {
	const { tenant } = await studioWithOwner(
		"outcome-needle-85",
		"Outcome Needle",
	);
	const ashaUser = await artistIn(tenant, "asha@outcome-needle-85.example");
	const ramUser = await artistIn(tenant, "ram@outcome-needle-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = ashaUser.id;
		await sita.save();
		const anu = await makeArtist(tenant, "anu");
		const client = await makeClient(tenant);
		const project = await makeProject(tenant, client, {
			status,
			artistId: sita.id,
		});
		return { sita, anu, client, project };
	});
	return {
		tenant,
		...parts,
		asha: { userId: ashaUser.id, role: "artist" as const },
		ram: { userId: ramUser.id, role: "artist" as const },
	};
}

/** A scheduled session of `artist`, from `from` to `to` minutes from now. */
function sessionAt(
	tenant: { id: string },
	project: TattooProject,
	artist: Artist,
	from: number,
	to: number,
	kind: SessionKind = "tattoo",
) {
	return makeSession(tenant, project, artist, {
		kind,
		startsAt: fromNow(from),
		endsAt: fromNow(to),
	});
}

test.group("SessionService.recordOutcome (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner records each outcome; only a completed session keeps blocking its time", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const toComplete = await sessionAt(tenant, project, sita, -300, -240, "consultation");
			const toMiss = await sessionAt(tenant, project, sita, -180, -120, "consultation");
			const toCancel = await sessionAt(tenant, project, sita, 60, 120, "consultation");

			const done = await sessions.recordOutcome(tenant, OWNER, toComplete, "completed");
			const missed = await sessions.recordOutcome(tenant, OWNER, toMiss, "no_show");
			const cancelled = await sessions.recordOutcome(tenant, OWNER, toCancel, "cancelled");

			assert.deepEqual(
				[done, missed, cancelled].map(({ session }) => [
					session.status,
					session.active,
				]),
				[
					["completed", true],
					["no_show", false],
					["cancelled", false],
				],
			);
			// Consultations never move the project.
			assert.deepEqual([done.projectStatus, done.projectMoved], ["booked", false]);
		});
	});

	test("done and no-show wait for the start; cancelling doesn't", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const later = await sessionAt(tenant, project, sita, 120, 180, "consultation");
			assert.equal(
				await ruleOf(() => sessions.recordOutcome(tenant, OWNER, later, "completed")),
				"not_started",
			);
			assert.equal(
				await ruleOf(() => sessions.recordOutcome(tenant, OWNER, later, "no_show")),
				"not_started",
			);
			assert.equal((await ProjectSession.findOrFail(later.id)).status, "scheduled");

			// At its start time it has started.
			const atStart = await sessions.recordOutcome(
				tenant,
				OWNER,
				later,
				"no_show",
				later.startsAt,
			);
			assert.equal(atStart.session.status, "no_show");

			const another = await sessionAt(tenant, project, sita, 240, 300, "consultation");
			assert.equal(
				(await sessions.recordOutcome(tenant, OWNER, another, "cancelled")).session
					.status,
				"cancelled",
			);
		});
	});

	test("tattoo work is marked done only once the project is booked; other kinds any time", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const early = ["reviewing", "quoted", "on_hold", "deposit_pending"] as const;
			for (const [index, status] of early.entries()) {
				const project = await makeProject(tenant, client, {
					status,
					artistId: sita.id,
				});
				const start = -60 * (index + 2);
				const tattoo = await sessionAt(tenant, project, sita, start, start + 30);
				assert.equal(
					await ruleOf(() => sessions.recordOutcome(tenant, OWNER, tattoo, "completed")),
					"not_booked",
					status,
				);
				assert.equal(
					(await ProjectSession.findOrFail(tattoo.id)).status,
					"scheduled",
					status,
				);
				// A no-show is still recorded, and the project stays where it was.
				const missed = await sessions.recordOutcome(tenant, OWNER, tattoo, "no_show");
				assert.deepEqual([missed.session.status, missed.projectStatus], ["no_show", status]);
				const consultation = await sessionAt(
					tenant,
					project,
					sita,
					start + 30,
					start + 45,
					"consultation",
				);
				assert.equal(
					(await sessions.recordOutcome(tenant, OWNER, consultation, "completed"))
						.session.status,
					"completed",
					status,
				);
			}

			const later = ["in_progress", "completed", "healing_check"] as const;
			for (const [index, status] of later.entries()) {
				const project = await makeProject(tenant, client, {
					status,
					artistId: sita.id,
				});
				const start = -600 - 60 * index;
				const tattoo = await sessionAt(tenant, project, sita, start, start + 30);
				const done = await sessions.recordOutcome(tenant, OWNER, tattoo, "completed");
				assert.deepEqual(
					[done.session.status, done.projectStatus, done.projectMoved],
					["completed", status, false],
					status,
				);
			}
		});
	});

	test("a booked project's first finished tattoo session starts the work, and the result says so", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup("booked");

		await inTenant(tenant, async () => {
			const tattoo = await sessionAt(tenant, project, sita, -120, -60);
			const done = await sessions.recordOutcome(tenant, OWNER, tattoo, "completed");
			assert.deepEqual([done.projectStatus, done.projectMoved], ["in_progress", true]);
			assert.equal((await TattooProject.findOrFail(project.id)).status, "in_progress");
		});
	});

	test("an outcome is final: a second tap or a stale copy is refused and changes nothing", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessionAt(tenant, project, sita, -60, -30, "consultation");
			await sessions.recordOutcome(tenant, OWNER, session, "completed");

			// `session` still says "scheduled" in memory: the locked row decides.
			for (const outcome of ["completed", "no_show", "cancelled"] as const) {
				assert.equal(
					await ruleOf(() => sessions.recordOutcome(tenant, OWNER, session, outcome)),
					"not_scheduled",
					outcome,
				);
			}
			assert.equal(
				await ruleOf(() =>
					sessions.move(tenant, OWNER, session, {
						startsAt: fromNow(600),
						endsAt: fromNow(660),
					}),
				),
				"not_scheduled",
			);
			const stored = await ProjectSession.findOrFail(session.id);
			assert.equal(stored.status, "completed");
			assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
		});
	});
});

test.group("SessionService: who may change a session (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners change any session; an artist only their own, on a project assigned to them", async ({
		assert,
	}) => {
		const { tenant, client, project, sita, anu, asha, ram } = await setup();

		await inTenant(tenant, async () => {
			const mine = await sessionAt(tenant, project, sita, -60, -30, "consultation");
			const anusHere = await sessionAt(tenant, project, anu, -60, -30, "consultation");
			const elsewhere = await makeProject(tenant, client, {
				status: "booked",
				artistId: anu.id,
			});
			const mineElsewhere = await sessionAt(tenant, elsewhere, sita, 60, 90, "consultation");
			const later = { startsAt: fromNow(600), endsAt: fromNow(660) };

			assert.equal((await sessions.findChangeable(tenant, asha, mine.id)).id, mine.id);
			for (const session of [anusHere, mineElsewhere]) {
				await assert.rejects(
					() => sessions.findChangeable(tenant, asha, session.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.recordOutcome(tenant, asha, session, "cancelled"),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.move(tenant, asha, session, later),
					/Row not found/,
				);
			}
			for (const session of [mine, anusHere, mineElsewhere]) {
				await assert.rejects(
					() => sessions.findChangeable(tenant, ram, session.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.recordOutcome(tenant, ram, session, "cancelled"),
					/Row not found/,
				);
				assert.equal(
					(await sessions.findChangeable(tenant, OWNER, session.id)).id,
					session.id,
				);
			}
			for (const session of [mine, anusHere, mineElsewhere]) {
				const stored = await ProjectSession.findOrFail(session.id);
				assert.equal(stored.status, "scheduled");
				assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
			}

			assert.equal(
				(await sessions.recordOutcome(tenant, asha, mine, "completed")).session.status,
				"completed",
			);
			assert.equal(
				(await sessions.recordOutcome(tenant, OWNER, anusHere, "no_show")).session
					.status,
				"no_show",
			);
			const moved = await sessions.move(tenant, OWNER, mineElsewhere, later);
			assert.equal(moved.startsAt.toMillis(), later.startsAt.toMillis());
		});
	});

	test("a project reassigned while the artist's request waited is a 404 under the lock", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu, asha } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessionAt(tenant, project, sita, -60, -30, "consultation");
			const found = await sessions.findChangeable(tenant, asha, session.id);

			// An owner reassigns the project between the read and the write.
			const live = await TattooProject.findOrFail(project.id);
			live.artistId = anu.id;
			await live.save();

			await assert.rejects(
				() => sessions.recordOutcome(tenant, asha, found, "completed"),
				/Row not found/,
			);
			await assert.rejects(
				() =>
					sessions.move(tenant, asha, found, {
						startsAt: fromNow(600),
						endsAt: fromNow(660),
					}),
				/Row not found/,
			);
			assert.equal((await ProjectSession.findOrFail(session.id)).status, "scheduled");
		});
	});

	test("unknown, deleted and other tenants' sessions, and those of a deleted project, are a 404", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();
		const { tenant: other } = await studioWithOwner(
			"outcome-other-85",
			"Outcome Other",
		);

		await inTenant(tenant, async () => {
			const session = await sessionAt(tenant, project, sita, -60, -30, "consultation");
			const gone = await sessionAt(tenant, project, sita, 60, 90, "consultation");
			await (await ProjectSession.findOrFail(gone.id)).softDelete();
			for (const id of [randomUUID(), gone.id]) {
				await assert.rejects(
					() => sessions.findChangeable(tenant, OWNER, id),
					/Row not found/,
				);
			}

			await inTenant(other, async () => {
				await assert.rejects(
					() => sessions.findChangeable(other, OWNER, session.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.recordOutcome(other, OWNER, session, "cancelled"),
					/belongs to another tenant/,
				);
				await assert.rejects(
					() =>
						sessions.move(other, OWNER, session, {
							startsAt: fromNow(600),
							endsAt: fromNow(660),
						}),
					/belongs to another tenant/,
				);
			});

			await (await TattooProject.findOrFail(project.id)).softDelete();
			await assert.rejects(
				() => sessions.findChangeable(tenant, OWNER, session.id),
				/Row not found/,
			);
			await assert.rejects(
				() => sessions.recordOutcome(tenant, OWNER, session, "cancelled"),
				/Row not found/,
			);
		});
	});
});

test.group("SessionService.move (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a member moves a scheduled session, even one whose time has passed; the project's status stays", async ({
		assert,
	}) => {
		const { tenant, project, sita, asha } = await setup();

		await inTenant(tenant, async () => {
			const past = await sessionAt(tenant, project, sita, -120, -60);
			const to = {
				startsAt: past.startsAt.plus({ days: 2 }),
				endsAt: past.endsAt.plus({ days: 2, minutes: 30 }),
			};
			const moved = await sessions.move(tenant, asha, past, to);
			assert.equal(moved.startsAt.toMillis(), to.startsAt.toMillis());
			assert.equal(moved.endsAt.toMillis(), to.endsAt.toMillis());
			assert.deepEqual([moved.status, moved.active], ["scheduled", true]);
			assert.equal((await TattooProject.findOrFail(project.id)).status, "booked");
		});
	});

	test("an overlap with the artist's other session saves nothing and leaves the request usable", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu } = await setup();

		await inTenant(tenant, async () => {
			const first = await sessionAt(tenant, project, sita, 600, 660);
			const second = await sessionAt(tenant, project, sita, 720, 780);
			await assert.rejects(
				() =>
					sessions.move(tenant, OWNER, first, {
						startsAt: second.startsAt.minus({ minutes: 30 }),
						endsAt: second.endsAt,
					}),
				SessionOverlapError,
			);
			const stored = await ProjectSession.findOrFail(first.id);
			assert.equal(stored.startsAt.toMillis(), first.startsAt.toMillis());
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);

			// Its own old time, and another artist's time, are free to it.
			await sessions.move(tenant, OWNER, first, {
				startsAt: first.startsAt.plus({ minutes: 30 }),
				endsAt: first.endsAt.plus({ minutes: 30 }),
			});
			const anus = await sessionAt(tenant, project, anu, 900, 960);
			const onAnus = await sessions.move(tenant, OWNER, first, {
				startsAt: anus.startsAt,
				endsAt: anus.endsAt,
			});
			assert.equal(onAnus.startsAt.toMillis(), anus.startsAt.toMillis());
		});
	});
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_service.spec.ts --files=project_service.spec.ts --files=session_outcomes.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: failures. In `session_service.spec.ts` the first two new tests fail (`in_progress` where `booked` is expected after the first of two sessions; `booked` where `in_progress` is expected after the next session is cancelled); the third passes (it pins what must not change). The withdrawal test passes (a guard for Step 4). Every `session_outcomes.spec.ts` test fails with "sessions.recordOutcome is not a function" or "sessions.findChangeable is not a function" or "sessions.move is not a function".

- [ ] **Step 4: Write the service**

Replace `apps/platform/app/modules/scheduling/services/session_service.ts` with (diff it against the current file first: if a later ticket changed anything the plan doesn't mention, keep that change):

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import type { Member } from "#modules/projects/services/project_service";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import {
	mayChangeSession,
	outcomeRefusal,
	type SessionOutcome,
} from "#modules/scheduling/outcomes";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isExclusionViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;

export type SessionTimes = { startsAt: DateTime; endsAt: DateTime };
export type NewSession = SessionTimes & {
	artistId: string;
	kind: SessionKind;
};

/** A calendar window: half-open [from, to), one artist or (null) all. */
export type SessionWindow = {
	from: DateTime;
	to: DateTime;
	artistId: string | null;
};

/**
 * What recording an outcome did (TAT-85): the session as stored, the
 * project's status afterwards, and whether the outcome moved the project.
 */
export type Recorded = {
	session: ProjectSession;
	projectStatus: ProjectStatus;
	projectMoved: boolean;
};

/** A member recording an outcome, and the clock to judge its start by (tests pass one). */
type Actor = { member: Member; now?: DateTime };

const OVERLAP = "project_sessions_artist_no_overlap";

/** Projects that take no new sessions. */
const CLOSED: ProjectStatus[] = ["declined", "cancelled"];

/**
 * The way to read and change a tenant's sessions. Every call is scoped to
 * the tenant, and every write runs in a transaction that first locks the
 * project row and then the session row, always in that order. Overlaps are
 * settled by the database: the exclusion constraint raises, and the error
 * becomes SessionOverlapError after the failed savepoint has rolled back.
 * Members record outcomes and move sessions through findChangeable,
 * recordOutcome and move (TAT-85), which check mayChangeSession; complete,
 * markNoShow, cancel and reschedule are the system's calls.
 */
@inject()
export default class SessionService {
	constructor(
		private artists: ArtistService,
		private deposits: DepositService,
	) {}

	/**
	 * The tenant's live session with this id. An unknown id, a deleted
	 * session and another tenant's session all throw E_ROW_NOT_FOUND (a 404).
	 */
	async findFor(tenant: TenantRef, id: string): Promise<ProjectSession> {
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * The live session with this id if `member` may change it (TAT-85):
	 * owners any session of a live project; an artist only a session with
	 * their own linked live profile, on a project assigned to that profile
	 * (mayChangeSession). Anything else, another tenant's id, a deleted
	 * session and a session of a deleted project included, throws
	 * E_ROW_NOT_FOUND (a 404). Controllers call it before reading the form;
	 * recordOutcome and move check again under the row locks.
	 */
	async findChangeable(
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<ProjectSession> {
		const session = await this.findFor(tenant, id);
		const project = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", session.projectId)
			.firstOrFail();
		await this.assertMayChange(tenant, member, project, session);
		return session;
	}

	/**
	 * The project's live sessions, earliest first.
	 */
	async listForProject(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<ProjectSession[]> {
		assertProjectOf(tenant, project);
		return ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("starts_at", "asc")
			.orderBy("id", "asc");
	}

	/**
	 * The tenant's active sessions (scheduled or completed, not deleted) that
	 * take time in the half-open window, earliest first: the calendar
	 * (TAT-50). The overlap is the no-overlap constraint's own expression, so
	 * its gist index (artist, time range, where active) serves one artist's
	 * window; no other index was added.
	 */
	async listInRange(
		tenant: TenantRef,
		{ from, to, artistId }: SessionWindow,
	): Promise<ProjectSession[]> {
		const query = ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("active", true)
			.whereRaw(
				"tstzrange(starts_at, ends_at) && tstzrange(?::timestamptz, ?::timestamptz)",
				[from.toJSDate(), to.toJSDate()],
			);
		if (artistId !== null) query.where("artist_id", artistId);
		return query.orderBy("starts_at", "asc").orderBy("id", "asc");
	}

	/**
	 * The ids among `projectIds` that have a `scheduled` tattoo session: the
	 * projects board flags a booked project that has none.
	 */
	async projectsWithScheduledTattoo(
		tenant: TenantRef,
		projectIds: string[],
	): Promise<Set<string>> {
		if (projectIds.length === 0) return new Set();
		const rows = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.whereIn("project_id", projectIds)
			.where("kind", "tattoo")
			.where("status", "scheduled")
			.select("project_id");
		return new Set(rows.map(({ projectId }) => projectId));
	}

	/**
	 * Adds a `scheduled` session. A declined or cancelled project refuses
	 * (SessionRuleError "project_closed"); a project without an artist gets
	 * this session's artist. Throws SessionOverlapError when the artist is
	 * busy, and E_ROW_NOT_FOUND for an unknown or deleted artist or project.
	 */
	async schedule(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
	): Promise<ProjectSession> {
		assertRange(input);
		assertProjectOf(tenant, project);
		const artist = await this.artists.findFor(tenant, input.artistId);
		try {
			return await withTransaction(async (trx) => {
				const live = await lockProject(trx, tenant, project.id);
				if (CLOSED.includes(live.status)) {
					throw new SessionRuleError("project_closed");
				}
				if (!live.artistId) {
					live.artistId = artist.id;
					await live.save();
				}
				const session = await ProjectSession.create(
					{
						tenantId: tenant.id,
						projectId: live.id,
						artistId: artist.id,
						kind: input.kind,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
					},
					{ client: trx },
				);
				// Lucid reads nothing back after an insert: load the column default
				// and the generated `active`, so the session we return is true.
				await session.refresh();
				if (input.kind === "tattoo") {
					if (live.status === "in_progress") await setStatus(live, "booked");
					else await this.moveToBooked(tenant, live);
				}
				return session;
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/**
	 * Moves a scheduled session to another time (the same artist; another
	 * artist is cancel plus schedule). The system's call: no member check.
	 */
	reschedule(
		tenant: TenantRef,
		session: ProjectSession,
		times: SessionTimes,
	): Promise<ProjectSession> {
		return this.changeTime(tenant, session, times, null);
	}

	/**
	 * reschedule for a member (TAT-85): under the row locks `member` must
	 * still be allowed to change the session (mayChangeSession, a 404
	 * otherwise); then the time changes. SessionOverlapError when the artist
	 * is busy, after the savepoint rolled back; SessionRuleError
	 * "not_scheduled" once the session has an outcome. The project's status
	 * never changes.
	 */
	move(
		tenant: TenantRef,
		member: Member,
		session: ProjectSession,
		times: SessionTimes,
	): Promise<ProjectSession> {
		return this.changeTime(tenant, session, times, member);
	}

	/** `scheduled` to `completed`. The time it occupied stays blocked. */
	async complete(
		tenant: TenantRef,
		session: ProjectSession,
	): Promise<ProjectSession> {
		return (await this.finish(tenant, session, "completed", null)).session;
	}

	/** `scheduled` to `no_show`. The time is free again. */
	async markNoShow(
		tenant: TenantRef,
		session: ProjectSession,
	): Promise<ProjectSession> {
		return (await this.finish(tenant, session, "no_show", null)).session;
	}

	/** `scheduled` to `cancelled`. The time is free again. */
	async cancel(
		tenant: TenantRef,
		session: ProjectSession,
	): Promise<ProjectSession> {
		return (await this.finish(tenant, session, "cancelled", null)).session;
	}

	/**
	 * Records what happened to a scheduled session, for a member (TAT-85).
	 * Under the row locks `member` must still be allowed to change it (a 404
	 * otherwise); then outcomeRefusal decides: SessionRuleError
	 * "not_scheduled" once it has an outcome, "not_started" before its start
	 * (the server's clock, read after the locks), "not_booked" for tattoo
	 * work on a project that isn't booked yet. A tattoo session's outcome
	 * then applies the work rule (followTattooWork).
	 */
	recordOutcome(
		tenant: TenantRef,
		member: Member,
		session: ProjectSession,
		outcome: SessionOutcome,
		now?: DateTime,
	): Promise<Recorded> {
		return this.finish(tenant, session, outcome, { member, now });
	}

	/**
	 * Moves a `deposit_pending` project to `booked` when it has a scheduled
	 * tattoo session and its deposit is settled. Returns whether it moved.
	 * `schedule` calls it; so does whatever verifies a deposit (TAT-65), so
	 * the move happens at the later of the two events. Calling it again, or
	 * for a project in another status, changes nothing.
	 */
	async settleBooking(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			return this.moveToBooked(tenant, live);
		});
	}

	/**
	 * A new time for a scheduled session, under the project's lock and then
	 * the session's; with a member, mayChangeSession is checked first.
	 */
	private async changeTime(
		tenant: TenantRef,
		session: ProjectSession,
		times: SessionTimes,
		member: Member | null,
	): Promise<ProjectSession> {
		assertRange(times);
		assertSessionOf(tenant, session);
		try {
			return await withTransaction(async (trx) => {
				const project = await lockProject(trx, tenant, session.projectId);
				const live = await lockSession(trx, tenant, session.id);
				if (member) await this.assertMayChange(tenant, member, project, live);
				assertScheduled(live);
				live.merge({ startsAt: times.startsAt, endsAt: times.endsAt });
				await live.save();
				// Lucid reads nothing back after an update either; `active` is the
				// database's to compute.
				await live.refresh();
				return live;
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}

	/**
	 * Sets a scheduled session's outcome, under the project's lock and then
	 * the session's. With an actor (recordOutcome) the member check and the
	 * outcome rules come first; without one it is the system's call. An
	 * outcome on a tattoo session then applies the work rule.
	 */
	private async finish(
		tenant: TenantRef,
		session: ProjectSession,
		to: SessionOutcome,
		actor: Actor | null,
	): Promise<Recorded> {
		assertSessionOf(tenant, session);
		return withTransaction(async (trx) => {
			const project = await lockProject(trx, tenant, session.projectId);
			const live = await lockSession(trx, tenant, session.id);
			if (actor) {
				await this.assertMayChange(tenant, actor.member, project, live);
				// The clock is read once the locks are held: waiting for them can
				// outlast a start time.
				const refusal = outcomeRefusal(
					live,
					project.status,
					to,
					actor.now ?? DateTime.now(),
				);
				if (refusal) throw new SessionRuleError(refusal);
			}
			assertScheduled(live);
			live.status = to;
			await live.save();
			// The status change flips the generated `active`: read it back.
			await live.refresh();
			const before = project.status;
			if (live.kind === "tattoo") await this.followTattooWork(tenant, project);
			return {
				session: live,
				projectStatus: project.status,
				projectMoved: project.status !== before,
			};
		});
	}

	/**
	 * The work rule (TAT-85): a booked project whose tattoo work has started
	 * (a completed tattoo session) and has no tattoo session still scheduled
	 * is in progress. With another tattoo session scheduled it stays booked,
	 * the status scheduling that session gives it anyway (the in_progress to
	 * booked shortcut), so the status doesn't depend on the order things
	 * happened in. A booked project with no completed tattoo session (its
	 * only one was missed or cancelled) stays booked, and the projects list
	 * flags it. The caller holds the project's lock and passes the live row.
	 */
	private async followTattooWork(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<void> {
		if (project.status !== "booked") return;
		const tattoo = () =>
			ProjectSession.query()
				.where("tenant_id", tenant.id)
				.where("project_id", project.id)
				.where("kind", "tattoo");
		if (await tattoo().where("status", "scheduled").first()) return;
		if (await tattoo().where("status", "completed").first()) {
			await setStatus(project, "in_progress");
		}
	}

	/**
	 * mayChangeSession for `member`; an artist's own profile is the live one
	 * linked to their account. E_ROW_NOT_FOUND (a 404) when they may not.
	 */
	private async assertMayChange(
		tenant: TenantRef,
		member: Member,
		project: Pick<TattooProject, "artistId">,
		session: Pick<ProjectSession, "artistId">,
	): Promise<void> {
		const own =
			member.role === "owner"
				? null
				: ((await this.artists.list(tenant)).find(
						({ userId }) => userId === member.userId,
					)?.id ?? null);
		if (!mayChangeSession(member, own, session, project)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(ProjectSession);
		}
	}

	/**
	 * The `deposit_pending` to `booked` rule. The caller holds the project's
	 * row lock and passes the live row.
	 */
	private async moveToBooked(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		if (project.status !== "deposit_pending") return false;
		const tattoo = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "tattoo")
			.where("status", "scheduled")
			.first();
		if (!tattoo) return false;
		if (!(await this.deposits.isSettled(tenant, project))) return false;
		await setStatus(project, "booked");
		return true;
	}
}

/**
 * Changes a locked project's status. The row came from `lockProject`, so it
 * saves in the same transaction.
 */
async function setStatus(project: TattooProject, status: ProjectStatus) {
	project.status = status;
	await project.save();
}

/**
 * Written so that an invalid DateTime (NaN milliseconds) fails too.
 */
function assertRange({ startsAt, endsAt }: SessionTimes) {
	if (!(endsAt.toMillis() > startsAt.toMillis())) {
		throw new SessionRuleError("invalid_range");
	}
}

/**
 * Locks the live project row. A deleted or other tenant's project is a 404.
 */
function lockProject(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return TattooProject.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/**
 * Locks the live session row. The copy a caller holds can be stale: the
 * locked row decides.
 */
function lockSession(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return ProjectSession.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/** Only a scheduled session changes; the other statuses are final. */
function assertScheduled(session: ProjectSession) {
	if (session.status !== "scheduled") {
		throw new SessionRuleError("not_scheduled");
	}
}

/**
 * Turns the exclusion violation into the error callers handle. Runs after
 * withTransaction rolled its savepoint back.
 */
function rethrowOverlap(error: unknown): never {
	if (isExclusionViolation(error, OVERLAP)) throw new SessionOverlapError();
	throw error;
}

/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}

function assertSessionOf(tenant: TenantRef, session: ProjectSession) {
	if (session.tenantId !== tenant.id) {
		throw new Error(`Session ${session.id} belongs to another tenant`);
	}
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_service.spec.ts --files=project_service.spec.ts --files=session_outcomes.spec.ts --files=calendar_service.spec.ts --files=booking_service.spec.ts`
Expected: PASS (3 new work-rule tests and every old `session_service` test; the withdrawal test; 10 `session_outcomes` tests; the calendar and booking services unchanged). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/scheduling/services/session_service.ts apps/platform/tests/functional/scheduling/session_service.spec.ts apps/platform/tests/functional/projects/project_service.spec.ts apps/platform/tests/functional/scheduling/session_outcomes.spec.ts
git -C <repo> add apps/platform/app/modules/scheduling/services/session_service.ts apps/platform/tests/functional/scheduling/session_service.spec.ts apps/platform/tests/functional/projects/project_service.spec.ts apps/platform/tests/functional/scheduling/session_outcomes.spec.ts
git -C <repo> commit -m "feat(platform): record session outcomes and move sessions for owners and their own artists" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Counts by status for the pilot metrics

**Files:**
- Modify: `apps/platform/app/modules/scheduling/services/session_service.ts`
- Test: `apps/platform/tests/functional/scheduling/session_counts.spec.ts` (create)

**Interfaces:**
- Produces: `SessionService.countByStatus(tenant, { from, to }: { from: DateTime; to: DateTime }): Promise<SessionCounts>`; `type StatusCounts = Record<SessionStatus, number>`; `type SessionCounts = { studio: StatusCounts; byArtist: Map<string, StatusCounts> }`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/scheduling/session_counts.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
import ProjectSession, {
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(
	new ArtistService(new ImageService()),
	new DepositService(new QuoteService()),
);

const counts = (over: Partial<Record<SessionStatus, number>> = {}) => ({
	scheduled: 0,
	completed: 0,
	no_show: 0,
	cancelled: 0,
	...over,
});

test.group("SessionService.countByStatus (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a window's sessions by status, for the studio and each artist, by start time", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("count-needle-85", "Count Needle");
		const { tenant: other } = await studioWithOwner(
			"count-other-85",
			"Count Other",
		);
		const from = DateTime.utc(2026, 11, 1);
		const to = DateTime.utc(2026, 12, 1);

		const { sita, anu } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			const anu = await makeArtist(tenant, "anu");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
			});
			const on = (day: number, status: SessionStatus, artist: Artist) =>
				makeSession(tenant, project, artist, {
					status,
					startsAt: DateTime.utc(2026, 11, day, 10),
					endsAt: DateTime.utc(2026, 11, day, 11),
				});
			await on(2, "completed", sita);
			await on(3, "no_show", sita);
			await on(4, "no_show", sita);
			await on(5, "cancelled", anu);
			await on(6, "scheduled", anu);
			// Out of the window: it starts before (though it ends inside), one
			// starts at its end (half-open), and a deleted one.
			await makeSession(tenant, project, sita, {
				status: "no_show",
				startsAt: DateTime.utc(2026, 10, 31, 23),
				endsAt: DateTime.utc(2026, 11, 1, 1),
			});
			await makeSession(tenant, project, sita, {
				status: "no_show",
				startsAt: to,
				endsAt: to.plus({ hours: 1 }),
			});
			const gone = await on(7, "no_show", anu);
			await (await ProjectSession.findOrFail(gone.id)).softDelete();
			return { sita, anu };
		});

		const mine = await inTenant(tenant, () =>
			sessions.countByStatus(tenant, { from, to }),
		);
		assert.deepEqual(
			mine.studio,
			counts({ scheduled: 1, completed: 1, no_show: 2, cancelled: 1 }),
		);
		assert.deepEqual(mine.byArtist.get(sita.id), counts({ completed: 1, no_show: 2 }));
		assert.deepEqual(mine.byArtist.get(anu.id), counts({ scheduled: 1, cancelled: 1 }));
		assert.equal(mine.byArtist.size, 2);

		// Another studio counts none of these, even when it names this tenant:
		// its context can't see the rows.
		for (const asked of [other, tenant]) {
			const theirs = await inTenant(other, () =>
				sessions.countByStatus(asked, { from, to }),
			);
			assert.deepEqual(theirs.studio, counts());
			assert.equal(theirs.byArtist.size, 0);
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_counts.spec.ts`
Expected: FAIL with "sessions.countByStatus is not a function".

- [ ] **Step 3: Add the read**

In `apps/platform/app/modules/scheduling/services/session_service.ts`:

1. Change the model import to:

```ts
import ProjectSession, {
	type SessionKind,
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
```

2. After the `Recorded` type add:

```ts
/** Sessions per status, every status present (0 when none). */
export type StatusCounts = Record<SessionStatus, number>;

/** countByStatus's answer: the studio's counts, and each artist's who has a session in the window. */
export type SessionCounts = {
	studio: StatusCounts;
	byArtist: Map<string, StatusCounts>;
};

const noCounts = (): StatusCounts => ({
	scheduled: 0,
	completed: 0,
	no_show: 0,
	cancelled: 0,
});
```

3. After `projectsWithScheduledTattoo` add:

```ts
	/**
	 * How many of the tenant's live sessions start in the half-open window
	 * [from, to), per status, for the studio and per artist: the pilot's
	 * no-show rate (TAT-70) and the no-show report (TAT-76). Counted by
	 * `starts_at`, so a session recorded late counts in the period it was
	 * booked for; one grouped query, served by the (tenant_id, starts_at)
	 * index. The rate is no_show / (completed + no_show), the caller's.
	 */
	async countByStatus(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<SessionCounts> {
		const rows = await ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("starts_at", ">=", from.toJSDate())
			.where("starts_at", "<", to.toJSDate())
			.select("artist_id", "status")
			.count("* as total")
			.groupBy("artist_id", "status");
		const studio = noCounts();
		const byArtist = new Map<string, StatusCounts>();
		for (const row of rows) {
			// count(*) is int8, which node-pg returns as a string.
			const total = Number(row.$extras.total);
			studio[row.status] += total;
			const artist = byArtist.get(row.artistId) ?? noCounts();
			artist[row.status] += total;
			byArtist.set(row.artistId, artist);
		}
		return { studio, byArtist };
	}
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_counts.spec.ts --files=session_service.spec.ts`
Expected: PASS. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/scheduling/services/session_service.ts apps/platform/tests/functional/scheduling/session_counts.spec.ts
git -C <repo> add apps/platform/app/modules/scheduling/services/session_service.ts apps/platform/tests/functional/scheduling/session_counts.spec.ts
git -C <repo> commit -m "feat(platform): count a studio's sessions by status for the pilot metrics" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The outcome and move routes

**Files:**
- Create: `apps/platform/app/controllers/project_sessions_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`, `apps/platform/tests/helpers/tenants.ts`, `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Regenerate: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/scheduling/project_sessions_http.spec.ts` (create)

**Interfaces:**
- Produces: routes `tenant.sessions.outcome` (`POST /t/:tenant/sessions/:id/outcome`, body `status`) and `tenant.sessions.move` (`POST /t/:tenant/sessions/:id/move`, body `date`, `startTime`, `hours`); `twoStudios()` studios gain `sessionProject` and `session`; `IsolationCase.resource` gains `"session"`.
- Consumes: Tasks 1 to 3.

- [ ] **Step 1: Write the failing HTTP test**

Create `apps/platform/tests/functional/scheduling/project_sessions_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import { localDateTime, sessionTimeText } from "#modules/scheduling/times";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const SLUG = "outcome-http-85";
const KTM = "Asia/Kathmandu";
const NY = "America/New_York";

const sessionUrl = (slug: string, id: string, action: "outcome" | "move") =>
	`/t/${slug}/sessions/${id}/${action}`;
const projectUrl = (slug: string, id: string) => `/t/${slug}/projects/${id}`;

/** Whole minutes from now. */
const fromNow = (minutes: number) =>
	DateTime.now().startOf("minute").plus({ minutes });

/** yyyy-MM-dd, `days` from today in `zone` (the test studio's, by default). */
const dayFromNow = (days: number, zone = KTM) =>
	DateTime.now().setZone(zone).plus({ days }).toFormat("yyyy-MM-dd");

/** `time` on the day `days` from today in Kathmandu. */
function localAt(days: number, time: string) {
	const instant = localDateTime(dayFromNow(days), time, KTM);
	if (!instant) throw new Error(`${time} doesn't exist in ${days} days`);
	return instant;
}

/**
 * The next day New York's clocks jump from 02:00 to 03:00 (the second
 * Sunday of March): always less than a year away, so the move form takes it.
 */
function nextSpringForward(): string {
	const today = DateTime.now().setZone(NY).startOf("day");
	for (const year of [today.year, today.year + 1]) {
		const march = DateTime.fromObject({ year, month: 3, day: 1 }, { zone: NY });
		const secondSunday = march.plus({ days: ((7 - march.weekday) % 7) + 7 });
		if (secondSunday > today) return secondSunday.toFormat("yyyy-MM-dd");
	}
	throw new Error("no spring-forward day within two years");
}

function post(
	client: ApiClient,
	url: string,
	body: Record<string, unknown>,
	user: User,
) {
	return client.post(url).form(body).withCsrfToken().loginAs(user).redirects(0);
}

/**
 * The studio: Sita (linked to the artist member Asha) and Anu, a project in
 * `status` assigned to Sita, and Ram, an artist member with no profile.
 */
async function setup(status: ProjectStatus = "booked") {
	const { owner, tenant } = await studioWithOwner(SLUG, "Outcome HTTP");
	const asha = await artistIn(tenant, "asha@outcome-http-85.example");
	const ram = await artistIn(tenant, "ram@outcome-http-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = asha.id;
		await sita.save();
		const anu = await makeArtist(tenant, "anu");
		const customer = await makeClient(tenant);
		const project = await makeProject(tenant, customer, {
			status,
			artistId: sita.id,
		});
		return { sita, anu, customer, project };
	});
	return { owner, asha, ram, tenant, ...parts };
}

function sessionAt(
	tenant: { id: string },
	project: TattooProject,
	artist: Artist,
	startsAt: DateTime,
	endsAt: DateTime,
	kind: SessionKind = "tattoo",
) {
	return inTenant(tenant, () =>
		makeSession(tenant, project, artist, { kind, startsAt, endsAt }),
	);
}

const reload = (tenant: { id: string }, id: string) =>
	inTenant(tenant, () => ProjectSession.findOrFail(id));

const statusOf = (tenant: { id: string }, id: string) =>
	inTenant(tenant, async () => (await TattooProject.findOrFail(id)).status);

test.group("Session outcomes over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner marks a started tattoo session done: back to the project, a flash, and the project is in progress", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(tenant, project, sita, fromNow(-120), fromNow(-60));

		const response = await post(
			client,
			sessionUrl(SLUG, session.id, "outcome"),
			{ status: "completed" },
			owner,
		);

		response.assertHeader("location", projectUrl(SLUG, project.id));
		response.assertFlashMessage(
			"success",
			"Session marked done. The project is now in progress.",
		);
		assert.equal((await reload(tenant, session.id)).status, "completed");
		assert.equal(await statusOf(tenant, project.id), "in_progress");
	});

	test("a no-show and a cancellation free the time, each with its own flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const missed = await sessionAt(tenant, project, sita, fromNow(-240), fromNow(-180));
		const called = await sessionAt(tenant, project, sita, fromNow(1440), fromNow(1500));

		(
			await post(client, sessionUrl(SLUG, missed.id, "outcome"), { status: "no_show" }, owner)
		).assertFlashMessage("success", "Marked as a no-show. The time is free again.");
		(
			await post(client, sessionUrl(SLUG, called.id, "outcome"), { status: "cancelled" }, owner)
		).assertFlashMessage("success", "Session cancelled. The time is free again.");

		assert.equal((await reload(tenant, missed.id)).status, "no_show");
		assert.equal((await reload(tenant, called.id)).status, "cancelled");
		// No tattoo session was done: the project stays booked (the board flags it).
		assert.equal(await statusOf(tenant, project.id), "booked");
	});

	test("a refused outcome is a flash and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, project, sita } = await setup();
		const later = await sessionAt(tenant, project, sita, fromNow(1440), fromNow(1500));

		const notYet = await post(
			client,
			sessionUrl(SLUG, later.id, "outcome"),
			{ status: "completed" },
			owner,
		);
		notYet.assertHeader("location", projectUrl(SLUG, project.id));
		notYet.assertFlashMessage(
			"error",
			"This session hasn't started yet: mark it done or a no-show once it has.",
		);
		assert.equal((await reload(tenant, later.id)).status, "scheduled");

		await post(client, sessionUrl(SLUG, later.id, "outcome"), { status: "cancelled" }, owner);
		const twice = await post(
			client,
			sessionUrl(SLUG, later.id, "outcome"),
			{ status: "no_show" },
			owner,
		);
		twice.assertFlashMessage(
			"error",
			"This session already has an outcome, and outcomes can't be changed.",
		);
		assert.equal((await reload(tenant, later.id)).status, "cancelled");

		const pending = await inTenant(tenant, () =>
			makeProject(tenant, customer, { status: "deposit_pending", artistId: sita.id }),
		);
		const held = await sessionAt(tenant, pending, sita, fromNow(-120), fromNow(-60));
		const early = await post(
			client,
			sessionUrl(SLUG, held.id, "outcome"),
			{ status: "completed" },
			owner,
		);
		early.assertFlashMessage(
			"error",
			"This project isn't booked yet, so its tattoo session can't be marked done.",
		);
		assert.equal((await reload(tenant, held.id)).status, "scheduled");
	});

	test("an unknown outcome is a field error", async ({ client, assert }) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(tenant, project, sita, fromNow(-120), fromNow(-60));

		const response = await post(
			client,
			sessionUrl(SLUG, session.id, "outcome"),
			{ status: "scheduled" },
			owner,
		);

		assertValidationError(response, "status", "Choose done, no-show or cancelled.");
		assert.equal((await reload(tenant, session.id)).status, "scheduled");
	});
});

test.group("Moving a session over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner moves a session to a new local time, and the flash names it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(
			tenant,
			project,
			sita,
			localAt(2, "10:00"),
			localAt(2, "12:00"),
		);
		const date = dayFromNow(3);

		const response = await post(
			client,
			sessionUrl(SLUG, session.id, "move"),
			{ date, startTime: "15:45", hours: "2.5" },
			owner,
		);

		response.assertHeader("location", projectUrl(SLUG, project.id));
		const moved = await reload(tenant, session.id);
		assert.equal(
			moved.startsAt.setZone(KTM).toFormat("yyyy-MM-dd HH:mm"),
			`${date} 15:45`,
		);
		assert.equal(moved.endsAt.diff(moved.startsAt, "minutes").minutes, 150);
		response.assertFlashMessage(
			"success",
			`Session moved: ${sessionTimeText(moved.startsAt, moved.endsAt, KTM)}.`,
		);
		assert.equal(await statusOf(tenant, project.id), "booked");
	});

	test("an overlap is a field error on the start time and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		await sessionAt(tenant, project, sita, localAt(4, "10:00"), localAt(4, "12:00"));
		const moving = await sessionAt(
			tenant,
			project,
			sita,
			localAt(5, "10:00"),
			localAt(5, "12:00"),
		);

		const response = await post(
			client,
			sessionUrl(SLUG, moving.id, "move"),
			{ date: dayFromNow(4), startTime: "11:00", hours: "2" },
			owner,
		);

		assertValidationError(
			response,
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		const stored = await reload(tenant, moving.id);
		assert.equal(stored.startsAt.toMillis(), moving.startsAt.toMillis());
		assert.equal(stored.endsAt.toMillis(), moving.endsAt.toMillis());
	});

	test("a past day, a missing start and a length out of quarter hours are field errors", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(
			tenant,
			project,
			sita,
			localAt(2, "10:00"),
			localAt(2, "12:00"),
		);
		const send = (body: Record<string, unknown>) =>
			post(client, sessionUrl(SLUG, session.id, "move"), body, owner);

		assertValidationError(
			await send({ date: dayFromNow(-1), startTime: "10:00", hours: "2" }),
			"date",
			"Pick a date from today to a year from now.",
		);
		assertValidationError(
			await send({ date: dayFromNow(3), startTime: "", hours: "2" }),
			"startTime",
			"Enter the start time, like 14:00.",
		);
		assertValidationError(
			await send({ date: dayFromNow(3), startTime: "10:00", hours: "2.1" }),
			"hours",
			"Use quarter hours: 0.25, 0.5, 0.75 and so on.",
		);
		const stored = await reload(tenant, session.id);
		assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
	});

	test("in a studio where the clocks change, a skipped time is a field error", async ({
		client,
		assert,
	}) => {
		const owner = await User.create({
			email: "owner@ny-needle-85.example",
			password: "secret-password",
		});
		const tenant = await new TenancyService().createTenant(owner, {
			type: "studio",
			name: "NY Needle",
			slug: "ny-needle-85",
			timezone: NY,
		});
		const { project, session } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			const startsAt = fromNow(2880);
			const session = await makeSession(tenant, project, sita, {
				startsAt,
				endsAt: startsAt.plus({ hours: 2 }),
			});
			return { project, session };
		});
		const day = nextSpringForward();

		const skipped = await post(
			client,
			sessionUrl("ny-needle-85", session.id, "move"),
			{ date: day, startTime: "02:30", hours: "1" },
			owner,
		);
		assertValidationError(
			skipped,
			"startTime",
			"That time doesn't exist on this day because the clocks change. Pick another.",
		);

		// 03:30 that day exists.
		const fine = await post(
			client,
			sessionUrl("ny-needle-85", session.id, "move"),
			{ date: day, startTime: "03:30", hours: "1" },
			owner,
		);
		fine.assertHeader("location", projectUrl("ny-needle-85", project.id));
		const moved = await reload(tenant, session.id);
		assert.equal(
			moved.startsAt.setZone(NY).toFormat("yyyy-MM-dd HH:mm"),
			`${day} 03:30`,
		);
	});
});

test.group("Who may change a session over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist changes their own session on their project; anything else is a 404 and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, customer, project, sita, anu, asha, ram } = await setup();
		const mine = await sessionAt(tenant, project, sita, fromNow(-120), fromNow(-60));
		const anus = await sessionAt(
			tenant,
			project,
			anu,
			fromNow(-120),
			fromNow(-60),
			"consultation",
		);
		const elsewhere = await inTenant(tenant, () =>
			makeProject(tenant, customer, { status: "booked", artistId: anu.id }),
		);
		const mineElsewhere = await sessionAt(
			tenant,
			elsewhere,
			sita,
			localAt(2, "10:00"),
			localAt(2, "11:00"),
			"consultation",
		);
		const move = { date: dayFromNow(6), startTime: "10:00", hours: "1" };

		for (const [user, session] of [
			[asha, anus],
			[asha, mineElsewhere],
			[ram, mine],
		] as const) {
			(
				await post(client, sessionUrl(SLUG, session.id, "outcome"), { status: "cancelled" }, user)
			).assertStatus(404);
			(await post(client, sessionUrl(SLUG, session.id, "move"), move, user)).assertStatus(404);
		}
		for (const session of [mine, anus, mineElsewhere]) {
			const stored = await reload(tenant, session.id);
			assert.equal(stored.status, "scheduled");
			assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
		}

		const own = await post(
			client,
			sessionUrl(SLUG, mine.id, "outcome"),
			{ status: "completed" },
			asha,
		);
		own.assertHeader("location", projectUrl(SLUG, project.id));
		assert.equal((await reload(tenant, mine.id)).status, "completed");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_sessions_http.spec.ts`
Expected: FAIL: every request is a 404 (no such route), so the location and flash assertions fail.

- [ ] **Step 3: Write the controller**

Create `apps/platform/app/controllers/project_sessions_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	SessionOverlapError,
	SessionRuleError,
	type SessionRuleReason,
} from "#modules/scheduling/errors";
import type ProjectSession from "#modules/scheduling/models/project_session";
import type { SessionOutcome } from "#modules/scheduling/outcomes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import { sessionTimeText } from "#modules/scheduling/times";
import {
	outcomeValidator,
	sessionTimeValidator,
	toSessionTimes,
} from "#modules/scheduling/validators/session";

/** What each recorded outcome tells the user. */
const OUTCOME_DONE: Record<SessionOutcome, string> = {
	completed: "Session marked done.",
	no_show: "Marked as a no-show. The time is free again.",
	cancelled: "Session cancelled. The time is free again.",
};

/** What a refused outcome tells the user. */
const OUTCOME_REFUSED: Record<SessionRuleReason, string> = {
	not_scheduled:
		"This session already has an outcome, and outcomes can't be changed.",
	not_started:
		"This session hasn't started yet: mark it done or a no-show once it has.",
	not_booked:
		"This project isn't booked yet, so its tattoo session can't be marked done.",
	project_closed: "This session can't be changed.",
	invalid_range: "This session can't be changed.",
};

/**
 * A session's outcome and its time (TAT-85), from the project page's
 * Sessions card. Owners change any session; an artist only their own on a
 * project assigned to them. Every :id loads through
 * SessionService.findChangeable before the form is read, so anyone else,
 * another tenant's id included, gets a 404 even with a bad body.
 */
@inject()
export default class ProjectSessionsController {
	constructor(
		private sessions: SessionService,
		private artists: ArtistService,
	) {}

	async outcome(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const session = await this.sessions.findChangeable(
			tenant,
			membership,
			ctx.params.id,
		);
		const { status } = await ctx.request.validateUsing(outcomeValidator);
		try {
			const { projectMoved } = await this.sessions.recordOutcome(
				tenant,
				membership,
				session,
				status,
			);
			ctx.session.flash(
				"success",
				`${OUTCOME_DONE[status]}${projectMoved ? " The project is now in progress." : ""}`,
			);
		} catch (error) {
			if (!(error instanceof SessionRuleError)) throw error;
			ctx.session.flash("error", OUTCOME_REFUSED[error.reason]);
		}
		return backTo(ctx, tenant, session);
	}

	async move(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const session = await this.sessions.findChangeable(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(sessionTimeValidator);
		const times = toSessionTimes(form, tenant.timezone);
		let moved: ProjectSession;
		try {
			moved = await this.sessions.move(tenant, membership, session, times);
		} catch (error) {
			// The move's savepoint already rolled back, so this read is safe and
			// nothing was saved.
			if (error instanceof SessionOverlapError) {
				const artist = (await this.artists.list(tenant)).find(
					({ id }) => id === session.artistId,
				);
				throw fieldError(
					"startTime",
					`${artist?.name ?? "The artist"} already has a session at that time. Pick another time.`,
					"overlap",
				);
			}
			if (!(error instanceof SessionRuleError)) throw error;
			ctx.session.flash(
				"error",
				"This session already has an outcome, so it can't be moved.",
			);
			return backTo(ctx, tenant, session);
		}
		ctx.session.flash(
			"success",
			`Session moved: ${sessionTimeText(moved.startsAt, moved.endsAt, tenant.timezone)}.`,
		);
		return backTo(ctx, tenant, session);
	}
}

/** A field error shown next to `field`, like the validator's own. */
function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}

function backTo(
	ctx: HttpContext,
	tenant: { slug: string },
	session: ProjectSession,
) {
	return ctx.response.redirect().toRoute("tenant.projects.show", {
		tenant: tenant.slug,
		id: session.projectId,
	});
}
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains `ProjectSessions` in the controllers index (the routes come next).

- [ ] **Step 4: Add the routes**

In `apps/platform/start/routes.ts`, inside the `/t/:tenant` group, right before the `/**` that opens the comment whose first line is `* The calendar: owners (the whole studio or one artist) and artists`, add:

```ts
		/**
		 * One session's outcome and time (TAT-85): owners any session, an
		 * artist only their own on a project assigned to them
		 * (SessionService.findChangeable gives anyone else a 404). Every
		 * sessions route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.post(":id/outcome", [controllers.ProjectSessions, "outcome"])
					.where("id", router.matchers.uuid())
					.as("tenant.sessions.outcome");
				router
					.post(":id/move", [controllers.ProjectSessions, "move"])
					.where("id", router.matchers.uuid())
					.as("tenant.sessions.move");
			})
			.prefix("/sessions")
			.use(middleware.role({ allow: ["owner", "artist"] }));

```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains the routes `tenant.sessions.outcome` and `tenant.sessions.move`.

- [ ] **Step 5: Isolation cases, the fixture and the role guard**

In `apps/platform/tests/helpers/tenants.ts`:

1. Add `makeSession` to the import from `#tests/helpers/pipeline` (keep the list sorted).
2. Right after the `deposit` block (the one ending `return { method, project, link, token };` and `});`) add:

```ts
	// A scheduled tattoo session on a booked project, for the session routes
	// (TAT-85): 60 days out, clear of the booking case's day (30 days out).
	const scheduled = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "booked",
			artistId: artistProfile.id,
		});
		const startsAt = DateTime.now().plus({ days: 60 }).startOf("hour");
		const session = await makeSession(tenant, project, artistProfile, {
			startsAt,
			endsAt: startsAt.plus({ hours: 2 }),
		});
		return { project, session };
	});
```

3. In the returned object, after `depositReferenceCode: deposit.link.referenceCode,` add:

```ts
		// The session routes' :id resource (TAT-85) and its project.
		sessionProject: scheduled.project,
		session: scheduled.session,
```

4. In the doc comment of `twoStudios()`, before ` Later tickets add seed data`, add: ` A booked project assigned to \`artistProfile\` with a scheduled tattoo session 60 days out (\`sessionProject\`, \`session\`) is the session routes' resource (TAT-85).`

In `apps/platform/tests/isolation/cases.ts`:

1. In the `resource` union, after `| "depositProject"` add `| "session"`.
2. After the `paymentRows` helper add:

```ts
// Sessions, deleted ones included, and the projects' statuses: what the
// session routes could change (TAT-85).
const sessionRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		sessions: (
			await ProjectSession.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((session) => session.serialize()),
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map(({ id, status }) => ({ id, status })),
	}));
```

3. At the end of `isolationCases`, after the `GET /t/:tenant/calendar` case, add:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/sessions/:id/outcome",
		resource: "session",
		actor: "owner",
		// Cancelling needs no start time, so the session 60 days out takes it.
		body: () => ({ status: "cancelled" }),
		ownStatus: 302,
		snapshot: sessionRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/sessions/:id/move",
		resource: "session",
		actor: "owner",
		// The test studios' timezone; a day after the seeded session.
		body: () => ({
			date: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 61 })
				.toFormat("yyyy-MM-dd"),
			startTime: "13:00",
			hours: "2",
		}),
		ownStatus: 302,
		snapshot: sessionRows,
	},
```

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, after `{ area: "calendar", allow: ["owner", "artist"] },` add:

```ts
		{ area: "sessions", allow: ["owner", "artist"] },
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_sessions_http.spec.ts --files=cross_tenant.spec.ts --files=harness.spec.ts --files=tenant_routes.spec.ts`
Expected: PASS (9 HTTP tests; every isolation case including the 2 new ones; the role guard with the new area). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 7: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/project_sessions_controller.ts apps/platform/start/routes.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/helpers/tenants.ts apps/platform/tests/functional/tenancy/tenant_routes.spec.ts apps/platform/tests/functional/scheduling/project_sessions_http.spec.ts
git -C <repo> add apps/platform/app/controllers/project_sessions_controller.ts apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/tests/isolation/cases.ts apps/platform/tests/helpers/tenants.ts apps/platform/tests/functional/tenancy/tenant_routes.spec.ts apps/platform/tests/functional/scheduling/project_sessions_http.spec.ts
git -C <repo> commit -m "feat(platform): add the session outcome and move routes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Each session's actions on the project page's props

**Files:**
- Modify: `apps/platform/app/controllers/projects_controller.ts` (`show`)
- Modify: `apps/platform/inertia/components/projects.ts` (`SessionRow`, `ProjectPageProps`)
- Test: `apps/platform/tests/functional/projects/project_page.spec.ts` (edit one test, add a group)

**Interfaces:**
- Produces: each `sessions[]` row gains `outcomes: ("completed" | "no_show" | "cancelled")[]`, `awaitingBooking: boolean`, `move: { date: string; startTime: string; hours: number } | null`; the page gains `sessionDates: { today: string; max: string }`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/projects/project_page.spec.ts`, in the test "the page lists the project's sessions with their time, kind and artist", replace

```ts
			props.sessions.map(({ id: _id, ...rest }: { id: string }) => rest),
```

with

```ts
			props.sessions.map(
				({
					whenText,
					kind,
					status,
					artistName,
				}: {
					whenText: string;
					kind: string;
					status: string;
					artistName: string | null;
				}) => ({ whenText, kind, status, artistName }),
			),
```

and add at the end of the file:

```ts
test.group("Project page: session actions (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	type Row = {
		id: string;
		outcomes: string[];
		awaitingBooking: boolean;
		move: { date: string; startTime: string; hours: number } | null;
	};

	test("an owner gets each scheduled session's outcomes and move values, and the form's days", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const now = DateTime.now().startOf("minute");
		const { project, started, later, done } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			return {
				project,
				started: await makeSession(tenant, project, sita, {
					startsAt: now.minus({ minutes: 120 }),
					endsAt: now.minus({ minutes: 30 }),
				}),
				later: await makeSession(tenant, project, sita, {
					startsAt: now.plus({ days: 3 }),
					endsAt: now.plus({ days: 3, minutes: 150 }),
				}),
				done: await makeSession(tenant, project, sita, {
					kind: "consultation",
					status: "completed",
					startsAt: now.minus({ days: 3 }),
					endsAt: now.minus({ days: 3 }).plus({ hours: 1 }),
				}),
			};
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;
		const row = (id: string): Row =>
			props.sessions.find((session: Row) => session.id === id);

		const today = todayIn(KTM);
		assert.deepEqual(props.sessionDates, {
			today,
			max: DateTime.fromISO(today, { zone: "utc" })
				.plus({ years: 1 })
				.toFormat("yyyy-MM-dd"),
		});
		assert.deepEqual(row(started.id).outcomes, ["completed", "no_show", "cancelled"]);
		assert.isFalse(row(started.id).awaitingBooking);
		// Its date depends on whether two hours ago was still today in Kathmandu.
		const startedMove = row(started.id).move;
		assert.equal(
			startedMove?.startTime,
			started.startsAt.setZone(KTM).toFormat("HH:mm"),
		);
		assert.equal(startedMove?.hours, 1.5);
		assert.deepEqual(row(later.id).outcomes, ["cancelled"]);
		assert.deepEqual(row(later.id).move, {
			date: later.startsAt.setZone(KTM).toFormat("yyyy-MM-dd"),
			startTime: later.startsAt.setZone(KTM).toFormat("HH:mm"),
			hours: 2.5,
		});
		assert.deepEqual(row(done.id).outcomes, []);
		assert.isFalse(row(done.id).awaitingBooking);
		assert.isNull(row(done.id).move);
	});

	test("an artist gets actions only on their own sessions, and Done waits for a booked project", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const now = DateTime.now().startOf("minute");
		const { project, mine, theirs } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			sita.userId = asha.id;
			await sita.save();
			const anu = await makeArtist(tenant, "anu");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
				artistId: sita.id,
			});
			return {
				project,
				mine: await makeSession(tenant, project, sita, {
					startsAt: now.minus({ minutes: 120 }),
					endsAt: now.minus({ minutes: 60 }),
				}),
				theirs: await makeSession(tenant, project, anu, {
					kind: "consultation",
					startsAt: now.minus({ minutes: 120 }),
					endsAt: now.minus({ minutes: 60 }),
				}),
			};
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;
		const row = (id: string): Row =>
			props.sessions.find((session: Row) => session.id === id);

		assert.deepEqual(row(mine.id).outcomes, ["no_show", "cancelled"]);
		assert.isTrue(row(mine.id).awaitingBooking);
		assert.isNotNull(row(mine.id).move);
		assert.deepEqual(row(theirs.id).outcomes, []);
		assert.isFalse(row(theirs.id).awaitingBooking);
		assert.isNull(row(theirs.id).move);
	});
});
```

(`todayIn`, `KTM`, `page`, `artistIn`, `makeSession` and the other helpers are already imported or defined in that file; add any that a later ticket removed.)

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts`
Expected: the two new tests FAIL (`props.sessionDates` and the row fields are undefined); every other test passes.

- [ ] **Step 3: Send the props**

In `apps/platform/app/controllers/projects_controller.ts`:

1. Add `lastBookableDay` to the import from `#modules/projects/quotes`; add `import { mayChangeSession, outcomeRefusal, outcomesFor } from "#modules/scheduling/outcomes";`; change the times import to `import { sessionFormValues, sessionTimeText } from "#modules/scheduling/times";`.
2. In `show`, right after `const today = DateTime.fromISO(todayIn(timezone), { zone: "utc" });` add:

```ts
		// What this member may record on each session and the move form's
		// days (TAT-85). SessionService checks again under its locks.
		const now = DateTime.now();
		const todayText = todayIn(timezone);
		const lastBookable = lastBookableDay(todayText);
		const ownArtistId =
			membership.role === "owner"
				? null
				: (artists.find(({ userId }) => userId === membership.userId)?.id ??
					null);
```

3. Replace the `sessions: sessions.map((session) => ({ … })),` entry with:

```ts
			sessions: sessions.map((session) => {
				const changeable =
					session.status === "scheduled" &&
					mayChangeSession(membership, ownArtistId, session, project);
				return {
					id: session.id,
					whenText: sessionTimeText(session.startsAt, session.endsAt, timezone),
					kind: session.kind,
					status: session.status,
					artistName:
						artists.find(({ id }) => id === session.artistId)?.name ?? null,
					outcomes: changeable
						? outcomesFor(session, project.status, now)
						: [],
					// A started tattoo session whose project isn't booked yet: the
					// card explains why Done isn't offered.
					awaitingBooking:
						changeable &&
						outcomeRefusal(session, project.status, "completed", now) ===
							"not_booked",
					move: changeable
						? sessionFormValues(
								session.startsAt,
								session.endsAt,
								timezone,
								todayText,
								lastBookable,
							)
						: null,
				};
			}),
			sessionDates: { today: todayText, max: lastBookable },
```

In `apps/platform/inertia/components/projects.ts`:

1. Replace the `SessionRow` type with:

```ts
/** One session on the project page. */
export type SessionRow = {
	id: string;
	/** "Sun 18 Oct 2026, 14:00–17:00", in the studio's timezone. */
	whenText: string;
	kind: string;
	status: string;
	/** Null when the artist's profile was deleted. */
	artistName: string | null;
	/** The outcomes this member can record now, in button order; [] for none (TAT-85). */
	outcomes: ("completed" | "no_show" | "cancelled")[];
	/** A started tattoo session whose project isn't booked yet: Done waits for the booking. */
	awaitingBooking: boolean;
	/** The move form's starting values in the studio's timezone; null when this member can't move it. */
	move: { date: string; startTime: string; hours: number } | null;
};
```

2. In `ProjectPageProps`, right after `sessions: SessionRow[];`, add:

```ts
	/** The move form's first and last day, yyyy-MM-dd in the studio's timezone (TAT-85). */
	sessionDates: { today: string; max: string };
```

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts --files=bookings_http.spec.ts`
Expected: PASS. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean (the page doesn't read the new props yet; that is Task 7).

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/projects.ts apps/platform/tests/functional/projects/project_page.spec.ts
git -C <repo> add apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/projects.ts apps/platform/tests/functional/projects/project_page.spec.ts
git -C <repo> commit -m "feat(platform): send each session's outcomes and move values to the project page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Sessions card

**Files:**
- Create: `apps/platform/inertia/components/sessions.ts` (no imports: unit-testable)
- Create: `apps/platform/inertia/components/sessions_card.tsx`
- Modify: `apps/platform/inertia/pages/projects/show.tsx`
- Test: `apps/platform/tests/unit/inertia/session_actions.spec.ts` (create)

**Interfaces:**
- Produces: `sessionActions(outcomes, canMove): SessionAction[]`, `outcomeQuestion(outcome, whenText): string`, `ACTION_LABELS`, `OUTCOME_CONFIRMS`, types `SessionOutcomeName`, `SessionAction`; the default export `SessionsCard({ sessions, dates })`.
- Consumes: the props from Task 6; routes `tenant.sessions.outcome`, `tenant.sessions.move` (Task 5).

- [ ] **Step 1: Write the failing unit test**

Create `apps/platform/tests/unit/inertia/session_actions.spec.ts`:

```ts
import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `SessionsModule` below restates its shape and the inertia project type-checks the real one.
import * as sessionsModule from "../../../inertia/components/sessions.js";

type Outcome = "completed" | "no_show" | "cancelled";
type SessionsModule = {
	sessionActions(outcomes: Outcome[], canMove: boolean): string[];
	outcomeQuestion(outcome: Outcome, whenText: string): string;
};
const { sessionActions, outcomeQuestion } = sessionsModule as SessionsModule;

const WHEN = "Mon 2 Nov 2026, 15:45–17:45";

test.group("sessionActions", () => {
	test("Done and No-show first, then Move, then Cancel session", ({ assert }) => {
		assert.deepEqual(sessionActions(["completed", "no_show", "cancelled"], true), [
			"completed",
			"no_show",
			"move",
			"cancelled",
		]);
		assert.deepEqual(sessionActions(["no_show", "cancelled"], true), [
			"no_show",
			"move",
			"cancelled",
		]);
		assert.deepEqual(sessionActions(["cancelled"], true), ["move", "cancelled"]);
		assert.deepEqual(sessionActions([], false), []);
	});
});

test.group("outcomeQuestion", () => {
	test("names the session, says what changes and that it's final", ({
		assert,
	}) => {
		assert.equal(
			outcomeQuestion("completed", WHEN),
			`Mark the session on ${WHEN} as done? An outcome can't be changed afterwards.`,
		);
		assert.equal(
			outcomeQuestion("no_show", WHEN),
			`Mark the session on ${WHEN} as a no-show? Its time is freed, and an outcome can't be changed afterwards.`,
		);
		assert.equal(
			outcomeQuestion("cancelled", WHEN),
			`Cancel the session on ${WHEN}? Its time is freed, and an outcome can't be changed afterwards.`,
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=session_actions.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and `Cannot find module` for `inertia/components/sessions.js`.

- [ ] **Step 3: Write the helpers**

Create `apps/platform/inertia/components/sessions.ts`:

```ts
/** What staff record on a scheduled session (TAT-85), as its new status. */
export type SessionOutcomeName = "completed" | "no_show" | "cancelled";

/** A button on a session's row: an outcome, or moving it. */
export type SessionAction = SessionOutcomeName | "move";

/** The row's buttons. */
export const ACTION_LABELS: Record<SessionAction, string> = {
	completed: "Done",
	no_show: "No-show",
	move: "Move",
	cancelled: "Cancel session",
};

/** The confirmation's button. */
export const OUTCOME_CONFIRMS: Record<SessionOutcomeName, string> = {
	completed: "Mark done",
	no_show: "Mark no-show",
	cancelled: "Cancel session",
};

/**
 * The row's buttons in order: Done and No-show (when the server offers
 * them), Move (when the member may move the session), Cancel session.
 */
export function sessionActions(
	outcomes: readonly SessionOutcomeName[],
	canMove: boolean,
): SessionAction[] {
	return [
		...outcomes.filter((outcome) => outcome !== "cancelled"),
		...(canMove ? (["move"] as const) : []),
		...outcomes.filter((outcome) => outcome === "cancelled"),
	];
}

/** The confirmation's question: which session, what changes, and that it's final. */
export function outcomeQuestion(
	outcome: SessionOutcomeName,
	whenText: string,
): string {
	if (outcome === "completed") {
		return `Mark the session on ${whenText} as done? An outcome can't be changed afterwards.`;
	}
	if (outcome === "no_show") {
		return `Mark the session on ${whenText} as a no-show? Its time is freed, and an outcome can't be changed afterwards.`;
	}
	return `Cancel the session on ${whenText}? Its time is freed, and an outcome can't be changed afterwards.`;
}
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=session_actions.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Write the card**

Create `apps/platform/inertia/components/sessions_card.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	SESSION_KIND_LABELS,
	SESSION_STATUS_LABELS,
	type SessionRow,
} from "~/components/projects";
import {
	ACTION_LABELS,
	OUTCOME_CONFIRMS,
	outcomeQuestion,
	type SessionAction,
	type SessionOutcomeName,
	sessionActions,
} from "~/components/sessions";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";

/** The panel open under one session: an outcome's confirmation or the move form. */
type Open = { sessionId: string; action: SessionAction } | null;

/** The move form's first and last day, yyyy-MM-dd in the studio's timezone. */
type Dates = { today: string; max: string };

/**
 * The project's sessions and what staff record on them (TAT-85): done,
 * no-show or cancelled behind an inline confirmation, and a form to move a
 * session. Which buttons a row shows is the server's (the member may change
 * it, and it has started). One panel is open at a time; after a successful
 * save focus moves to the card's heading, so a screen reader lands on the
 * updated list.
 */
export default function SessionsCard({
	sessions,
	dates,
}: {
	sessions: SessionRow[];
	dates: Dates;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const [open, setOpen] = useState<Open>(null);
	const done = () => {
		setOpen(null);
		heading.current?.focus();
	};

	return (
		<Card id="sessions">
			<CardHeader>
				<CardTitle>
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Sessions
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				{sessions.length === 0 ? (
					<p className="text-sm text-muted-foreground">No sessions yet.</p>
				) : (
					<ul className="flex flex-col divide-y text-sm">
						{sessions.map((session) => (
							<SessionItem
								key={session.id}
								session={session}
								dates={dates}
								open={open?.sessionId === session.id ? open.action : null}
								onOpen={(action) => setOpen({ sessionId: session.id, action })}
								onClose={() => setOpen(null)}
								onDone={done}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function SessionItem({
	session,
	dates,
	open,
	onOpen,
	onClose,
	onDone,
}: {
	session: SessionRow;
	dates: Dates;
	open: SessionAction | null;
	onOpen: (action: SessionAction) => void;
	onClose: () => void;
	onDone: () => void;
}) {
	const triggers = useRef(new Map<SessionAction, HTMLButtonElement>());
	const actions = sessionActions(session.outcomes, session.move !== null);
	// Closing returns focus to the button that opened the panel.
	const close = () => {
		const trigger = open ? triggers.current.get(open) : undefined;
		onClose();
		trigger?.focus();
	};

	return (
		<li className="flex flex-col gap-3 py-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<span className="flex min-w-0 flex-col gap-0.5">
					<span>{session.whenText}</span>
					<span className="text-muted-foreground">
						{SESSION_KIND_LABELS[session.kind] ?? session.kind} with{" "}
						{session.artistName ?? "Unknown artist"}
					</span>
				</span>
				<Badge
					variant={session.status === "scheduled" ? "secondary" : "outline"}
				>
					{SESSION_STATUS_LABELS[session.status] ?? session.status}
				</Badge>
			</div>
			{session.awaitingBooking && (
				<p className="text-muted-foreground">
					It can be marked done once the project is booked.
				</p>
			)}
			{actions.length > 0 && (
				<div
					role="group"
					aria-label={`Session ${session.whenText}`}
					className="flex flex-wrap gap-2"
				>
					{actions.map((action) => (
						<Button
							key={action}
							ref={(node) => {
								if (node) triggers.current.set(action, node);
								else triggers.current.delete(action);
							}}
							type="button"
							variant="outline"
							className="h-11"
							aria-expanded={open === action}
							onClick={() => onOpen(action)}
						>
							{ACTION_LABELS[action]}
						</Button>
					))}
				</div>
			)}
			{open === "move" && session.move && (
				<MoveForm
					sessionId={session.id}
					whenText={session.whenText}
					values={session.move}
					dates={dates}
					onCancel={close}
					onDone={onDone}
				/>
			)}
			{open && open !== "move" && (
				<OutcomePanel
					sessionId={session.id}
					outcome={open}
					whenText={session.whenText}
					onCancel={close}
					onDone={onDone}
				/>
			)}
		</li>
	);
}

/**
 * Confirms an outcome: the question names the session and says it's final.
 * Focus starts on "Keep it scheduled", so pressing Enter right away changes
 * nothing; Escape closes the panel.
 */
function OutcomePanel({
	sessionId,
	outcome,
	whenText,
	onCancel,
	onDone,
}: {
	sessionId: string;
	outcome: SessionOutcomeName;
	whenText: string;
	onCancel: () => void;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const keep = useRef<HTMLButtonElement>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		keep.current?.focus();
	}, []);
	const confirm = () =>
		router.post(
			urlFor("tenant.sessions.outcome", { tenant: tenant.slug, id: sessionId }),
			{ status: outcome },
			{
				preserveScroll: true,
				onStart: () => setSaving(true),
				onFinish: () => setSaving(false),
				onSuccess: onDone,
			},
		);

	return (
		<fieldset
			className="min-w-0 rounded-md bg-muted/50 p-3"
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
		>
			<legend className="float-left mb-3 w-full">
				{outcomeQuestion(outcome, whenText)}
			</legend>
			<div className="clear-left flex flex-wrap gap-2">
				<Button
					type="button"
					className="h-11"
					disabled={saving}
					onClick={confirm}
				>
					{saving ? "Saving…" : OUTCOME_CONFIRMS[outcome]}
				</Button>
				<Button
					ref={keep}
					type="button"
					variant="ghost"
					className="h-11"
					disabled={saving}
					onClick={onCancel}
				>
					Keep it scheduled
				</Button>
			</div>
		</fieldset>
	);
}

/**
 * The new time: the booking form's three fields, prefilled with the
 * session's own. Focus starts on Date; Escape closes the form. After a
 * refused save it stays open with what was typed and the errors under
 * their fields.
 */
function MoveForm({
	sessionId,
	whenText,
	values,
	dates,
	onCancel,
	onDone,
}: {
	sessionId: string;
	whenText: string;
	values: NonNullable<SessionRow["move"]>;
	dates: Dates;
	onCancel: () => void;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const id = useId();
	const date = useRef<HTMLInputElement>(null);
	useEffect(() => {
		date.current?.focus();
	}, []);
	const field = (name: string) => `${id}-${name}`;

	return (
		<Form
			route="tenant.sessions.move"
			routeParams={{ tenant: tenant.slug, id: sessionId }}
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<fieldset
					className="min-w-0 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
				>
					<legend className="sr-only">Move the session on {whenText}</legend>
					<div className="grid gap-4 sm:grid-cols-3">
						<Field data-invalid={!!errors.date}>
							<FieldLabel htmlFor={field("date")}>Date</FieldLabel>
							<Input
								ref={date}
								id={field("date")}
								name="date"
								type="date"
								required
								min={dates.today}
								max={dates.max}
								defaultValue={values.date}
								aria-invalid={!!errors.date}
								aria-describedby={errors.date ? field("date-error") : undefined}
								className="h-11"
							/>
							{errors.date && (
								<FieldError id={field("date-error")}>{errors.date}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.startTime}>
							<FieldLabel htmlFor={field("startTime")}>Start time</FieldLabel>
							<Input
								id={field("startTime")}
								name="startTime"
								type="time"
								required
								defaultValue={values.startTime}
								aria-invalid={!!errors.startTime}
								aria-describedby={
									errors.startTime ? field("startTime-error") : undefined
								}
								className="h-11"
							/>
							{errors.startTime && (
								<FieldError id={field("startTime-error")}>
									{errors.startTime}
								</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.hours}>
							<FieldLabel htmlFor={field("hours")}>Length (hours)</FieldLabel>
							<Input
								id={field("hours")}
								name="hours"
								type="number"
								inputMode="decimal"
								required
								min={0.25}
								max={12}
								step={0.25}
								defaultValue={values.hours}
								aria-invalid={!!errors.hours}
								aria-describedby={
									errors.hours ? field("hours-error") : field("hours-hint")
								}
								className="h-11"
							/>
							{errors.hours ? (
								<FieldError id={field("hours-error")}>{errors.hours}</FieldError>
							) : (
								<FieldDescription id={field("hours-hint")}>
									In quarter hours: 2.5 for two and a half.
								</FieldDescription>
							)}
						</Field>
					</div>
					<div className="mt-4 flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Move session"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={onCancel}
						>
							Keep this time
						</Button>
					</div>
				</fieldset>
			)}
		</Form>
	);
}
```

- [ ] **Step 5: Put it on the project page**

In `apps/platform/inertia/pages/projects/show.tsx`:

1. Add `import SessionsCard from "~/components/sessions_card";` with the other `~/components` imports, and remove `SESSION_KIND_LABELS,` and `SESSION_STATUS_LABELS,` from the import from `~/components/projects` (nothing else on the page uses them; if something does, keep them).
2. In the destructured props, after `sessions,` add `sessionDates,`.
3. Replace the whole Sessions card, from `<Card>` with `<CardTitle>Sessions</CardTitle>` to its closing `</Card>`, with:

```tsx
				<SessionsCard sessions={sessions} dates={sessionDates} />
```

- [ ] **Step 6: Check it builds**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean. Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform build` → succeeds. Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/inertia/components/sessions.ts apps/platform/inertia/components/sessions_card.tsx apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/unit/inertia/session_actions.spec.ts
git -C <repo> add apps/platform/inertia/components/sessions.ts apps/platform/inertia/components/sessions_card.tsx apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/unit/inertia/session_actions.spec.ts
git -C <repo> commit -m "feat(platform): record outcomes and move sessions from the project page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

If Biome flags something in the card (for example an a11y rule on the `fieldset`'s `onKeyDown` or the `role="group"` div), fix it the way TAT-66's `payments_card.tsx` solved the same pattern rather than suppressing it, and note it in your report.

---

## Part 2: scheduling a session on an existing project (spec rulings 20 to 31)

Tasks 8 to 10 build on Tasks 1 to 7: the shared `readSessionTimes`, `mayChangeSession`, the `ProjectSessionsController` and the Sessions card.

---

### Task 8: Scheduling rules, the schedule validator and `SessionService.scheduleFor`

**Files:**
- Create: `apps/platform/app/modules/scheduling/schedule_rules.ts`
- Modify: `apps/platform/app/modules/scheduling/errors.ts` (reason `project_finished`)
- Modify: `apps/platform/app/modules/scheduling/validators/session.ts` (`scheduleValidator`, `toNewSession`)
- Modify: `apps/platform/app/modules/scheduling/services/session_service.ts` (`schedule` shares its body with `scheduleFor`)
- Modify: `apps/platform/app/controllers/project_sessions_controller.ts` (`OUTCOME_REFUSED` gains `project_finished`, so it still compiles)
- Test: `apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts` (create), `apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts` (add a group), `apps/platform/tests/functional/scheduling/session_scheduling.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/scheduling/schedule_rules`: `SCHEDULABLE_STATUSES`; `scheduleRefusal(status: ProjectStatus): SessionRuleReason | null` (`project_closed`, `project_finished`); `scheduledNote({ kind, booked, projectStatus, depositDue }): string`; `schedulingHint(status: ProjectStatus, depositDue: number): string | null` (`depositDue` in paisa).
- From `#modules/scheduling/validators/session`: `scheduleValidator` (`sessionKind`, `sessionArtistId`, `date`, `startTime`, `hours`), `type ScheduleForm`, `toNewSession(form, timezone, now = DateTime.now()): NewSession`.
- On `SessionService`: `scheduleFor(tenant, member: Member, project, input: NewSession): Promise<Scheduled>` with `type Scheduled = { session: ProjectSession; projectStatus: ProjectStatus; booked: boolean }` (`booked`: this call moved the project to `booked`). `schedule(tenant, project, input)` keeps its signature and behaviour.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	SCHEDULABLE_STATUSES,
	scheduledNote,
	scheduleRefusal,
	schedulingHint,
} from "#modules/scheduling/schedule_rules";

const BEFORE_ACCEPTANCE = ["reviewing", "quoted", "on_hold"] as const;

test.group("scheduleRefusal", () => {
	test("open projects take new sessions; finished and closed ones refuse", ({
		assert,
	}) => {
		assert.deepEqual(
			[...SCHEDULABLE_STATUSES],
			["reviewing", "quoted", "on_hold", "deposit_pending", "booked", "in_progress"],
		);
		assert.deepEqual(
			Object.fromEntries(
				PROJECT_STATUSES.map((status) => [status, scheduleRefusal(status)]),
			),
			{
				reviewing: null,
				quoted: null,
				on_hold: null,
				deposit_pending: null,
				booked: null,
				in_progress: null,
				completed: "project_finished",
				healing_check: "project_finished",
				declined: "project_closed",
				cancelled: "project_closed",
			},
		);
	});
});

test.group("scheduledNote", () => {
	const note = (projectStatus: ProjectStatus, booked = false, depositDue = 0) =>
		scheduledNote({ kind: "tattoo", booked, projectStatus, depositDue });

	test("what a tattoo session did to the project, in the payments screen's words", ({
		assert,
	}) => {
		assert.equal(note("booked", true), " The project is booked.");
		assert.equal(
			note("deposit_pending", false, 100_000),
			" NPR 1,000 of the deposit is still due: the project is booked once it's paid.",
		);
		assert.equal(
			note("deposit_pending"),
			" The project is booked once its deposit is settled.",
		);
		for (const status of BEFORE_ACCEPTANCE) {
			assert.equal(
				note(status),
				" It holds the date: the project is booked once the client accepts the quote and the deposit is settled.",
				status,
			);
		}
		assert.equal(note("booked"), "");
	});

	test("a consultation or touch-up adds nothing", ({ assert }) => {
		for (const kind of ["consultation", "touch_up"] as const) {
			assert.equal(
				scheduledNote({
					kind,
					booked: false,
					projectStatus: "deposit_pending",
					depositDue: 100_000,
				}),
				"",
				kind,
			);
		}
	});
});

test.group("schedulingHint", () => {
	test("says what a tattoo session will do to the project", ({ assert }) => {
		for (const status of BEFORE_ACCEPTANCE) {
			assert.equal(
				schedulingHint(status, 0),
				"A tattoo session holds the date. The project is booked once the client accepts the quote and the deposit is settled.",
				status,
			);
		}
		assert.equal(
			schedulingHint("deposit_pending", 100_000),
			"A tattoo session holds the date. The project is booked once the deposit is paid: NPR 1,000 still due.",
		);
		assert.equal(
			schedulingHint("deposit_pending", 0),
			"Scheduling a tattoo session books the project.",
		);
		assert.equal(
			schedulingHint("in_progress", 0),
			"Scheduling the next tattoo session books the project again.",
		);
		assert.isNull(schedulingHint("booked", 0));
	});
});
```

In `apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts`, add `scheduleValidator` and `toNewSession` to the import from `#modules/scheduling/validators/session`, and add at the end:

```ts
test.group("scheduleValidator and toNewSession", () => {
	const ARTIST_ID = "0195f3a0-0000-7000-8000-000000000002";

	test("the schedule form's shape, with its own field names", async ({
		assert,
	}) => {
		assert.deepEqual(
			await scheduleValidator.validate({
				sessionKind: "consultation",
				sessionArtistId: ARTIST_ID,
				date: "2026-10-20",
				startTime: "14:00",
				hours: "1",
			}),
			{
				sessionKind: "consultation",
				sessionArtistId: ARTIST_ID,
				date: "2026-10-20",
				startTime: "14:00",
				hours: 1,
			},
		);
		assert.deepEqual(
			await problems(() =>
				scheduleValidator.validate({
					sessionKind: "flash",
					sessionArtistId: "sita",
					date: "2026-10-20",
					startTime: "14:00",
					hours: "1",
				}),
			),
			{
				sessionKind: "Choose tattoo, consultation or touch-up.",
				sessionArtistId: "Choose an artist from the list.",
			},
		);
	});

	test("a new session from the form, by the shared time rules", async ({
		assert,
	}) => {
		const session = toNewSession(
			{ sessionKind: "tattoo", sessionArtistId: ARTIST_ID, ...form() },
			KTM,
			NOW,
		);
		assert.deepEqual([session.kind, session.artistId], ["tattoo", ARTIST_ID]);
		assert.equal(session.startsAt.toUTC().toISO(), "2026-10-20T08:15:00.000Z");
		assert.equal(session.endsAt.toUTC().toISO(), "2026-10-20T11:15:00.000Z");
		assert.deepEqual(
			await problems(() =>
				toNewSession(
					{
						sessionKind: "tattoo",
						sessionArtistId: ARTIST_ID,
						...form({ date: "2026-10-14" }),
					},
					KTM,
					NOW,
				),
			),
			{ date: DAY },
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=schedule_rules.spec.ts --files=session_validator.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` with `Cannot find module` for `#modules/scheduling/schedule_rules` (or that `validators/session` does not provide `scheduleValidator`).

- [ ] **Step 3: The new refusal reason**

In `apps/platform/app/modules/scheduling/errors.ts`, add `"project_finished",` at the end of `SESSION_RULE_REASONS` and to `MESSAGES`:

```ts
	project_finished: "A completed project takes no new sessions",
```

In `apps/platform/app/controllers/project_sessions_controller.ts`, add to `OUTCOME_REFUSED`:

```ts
	project_finished: "This session can't be changed.",
```

- [ ] **Step 4: Write the rules**

Create `apps/platform/app/modules/scheduling/schedule_rules.ts`:

```ts
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { formatMoney } from "#modules/projects/quotes";
import type { SessionRuleReason } from "#modules/scheduling/errors";
import type { SessionKind } from "#modules/scheduling/models/project_session";

/**
 * The project statuses that take a new session from staff (TAT-85 part
 * 2): before booking, booked, and in progress (a long tattoo's next
 * sitting). Completed and healing-check projects wait for the
 * finish-project ticket; declined and cancelled ones are closed.
 */
export const SCHEDULABLE_STATUSES: readonly ProjectStatus[] = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
	"booked",
	"in_progress",
];

/** Not accepted yet: a tattoo session holds the date. */
const BEFORE_ACCEPTANCE: readonly ProjectStatus[] = [
	"reviewing",
	"quoted",
	"on_hold",
];

/** Why a project in `status` takes no new session, or null when it does. */
export function scheduleRefusal(
	status: ProjectStatus,
): SessionRuleReason | null {
	if (SCHEDULABLE_STATUSES.includes(status)) return null;
	return status === "completed" || status === "healing_check"
		? "project_finished"
		: "project_closed";
}

/**
 * The flash's second sentence after scheduling, in the payments screen's
 * words: what a tattoo session did to the project, or what it still waits
 * for. `depositDue` is in paisa (DepositService.remaining).
 */
export function scheduledNote({
	kind,
	booked,
	projectStatus,
	depositDue,
}: {
	kind: SessionKind;
	booked: boolean;
	projectStatus: ProjectStatus;
	depositDue: number;
}): string {
	if (kind !== "tattoo") return "";
	if (booked) return " The project is booked.";
	if (projectStatus === "deposit_pending") {
		return depositDue > 0
			? ` ${formatMoney(depositDue)} of the deposit is still due: the project is booked once it's paid.`
			: " The project is booked once its deposit is settled.";
	}
	if (BEFORE_ACCEPTANCE.includes(projectStatus)) {
		return " It holds the date: the project is booked once the client accepts the quote and the deposit is settled.";
	}
	return "";
}

/** The schedule form's hint: what a tattoo session will do to the project. */
export function schedulingHint(
	status: ProjectStatus,
	depositDue: number,
): string | null {
	if (BEFORE_ACCEPTANCE.includes(status)) {
		return "A tattoo session holds the date. The project is booked once the client accepts the quote and the deposit is settled.";
	}
	if (status === "deposit_pending") {
		return depositDue > 0
			? `A tattoo session holds the date. The project is booked once the deposit is paid: ${formatMoney(depositDue)} still due.`
			: "Scheduling a tattoo session books the project.";
	}
	if (status === "in_progress") {
		return "Scheduling the next tattoo session books the project again.";
	}
	return null;
}
```

- [ ] **Step 5: The schedule validator**

In `apps/platform/app/modules/scheduling/validators/session.ts`:

1. Add the imports `import type { Infer } from "@vinejs/vine/types";` and `import { SESSION_KINDS } from "#modules/scheduling/models/project_session";`, and change the type import from the session service to `import type { NewSession, SessionTimes } from "#modules/scheduling/services/session_service";`.
2. Add at the end:

```ts
const KIND = "Choose tattoo, consultation or touch-up.";
const ARTIST = "Choose an artist from the list.";

/**
 * The schedule form (TAT-85 part 2): the kind, the artist and the time.
 * The fields are `sessionKind` and `sessionArtistId` because the project
 * page's quote, payment and assignment forms own `kind` and `artistId`,
 * and a page shares one error bag.
 */
export const scheduleValidator = vine.create({
	sessionKind: vine.enum(SESSION_KINDS),
	sessionArtistId: vine.string().uuid(),
	...sessionTimeFields(),
});
scheduleValidator.messagesProvider = new SimpleMessagesProvider({
	"sessionKind.required": KIND,
	"sessionKind.enum": KIND,
	"sessionArtistId.required": ARTIST,
	"sessionArtistId.uuid": ARTIST,
	...SESSION_TIME_MESSAGES,
});

export type ScheduleForm = Infer<typeof scheduleValidator>;

/**
 * SessionService.scheduleFor's input from the validated schedule form.
 * Throws E_VALIDATION_ERROR, shown next to the field, for what
 * readSessionTimes refuses (a past day included, as for a new booking).
 */
export function toNewSession(
	form: ScheduleForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): NewSession {
	const problems: { field: string; message: string; rule: string }[] = [];
	const times = readSessionTimes(form, timezone, now, (field, message, rule) => {
		problems.push({ field, message, rule });
	});
	if (!times) throw new errors.E_VALIDATION_ERROR(problems);
	return { artistId: form.sessionArtistId, kind: form.sessionKind, ...times };
}
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=schedule_rules.spec.ts --files=session_validator.spec.ts`
Expected: PASS (4 + 2 new tests, the earlier validator tests).

- [ ] **Step 6: Write the failing service tests**

Create `apps/platform/tests/functional/scheduling/session_scheduling.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import SessionService, {
	type NewSession,
} from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);

/** An owner: the services never read the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

/** A session of `artist`, `days` from now at the top of an hour, two hours long. */
function slot(
	artist: { id: string },
	days: number,
	kind: SessionKind = "tattoo",
): NewSession {
	const startsAt = DateTime.now().startOf("hour").plus({ days });
	return {
		artistId: artist.id,
		kind,
		startsAt,
		endsAt: startsAt.plus({ hours: 2 }),
	};
}

const statusOf = async (project: { id: string }) =>
	(await TattooProject.findOrFail(project.id)).status;

const sessionsOf = (project: { id: string }) =>
	ProjectSession.query().where("project_id", project.id);

/** The reason of the SessionRuleError `fn` throws, or null if it succeeds. */
async function ruleOf(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		if (error instanceof SessionRuleError) return error.reason;
		throw error;
	}
	return null;
}

/**
 * A studio with Sita (linked to the artist member Asha), Anu, a client,
 * and Ram, an artist member with no linked profile.
 */
async function setup() {
	const { owner, tenant } = await studioWithOwner(
		"schedule-needle-85",
		"Schedule Needle",
	);
	const ashaUser = await artistIn(tenant, "asha@schedule-needle-85.example");
	const ramUser = await artistIn(tenant, "ram@schedule-needle-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = ashaUser.id;
		await sita.save();
		return {
			sita,
			anu: await makeArtist(tenant, "anu"),
			client: await makeClient(tenant),
		};
	});
	return {
		owner,
		tenant,
		...parts,
		asha: { userId: ashaUser.id, role: "artist" as const },
		ram: { userId: ramUser.id, role: "artist" as const },
	};
}

test.group("SessionService.scheduleFor and booking (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a tattoo session books a deposit_pending project whose deposit is zero or covered, in the same call", async ({
		assert,
	}) => {
		const { owner, tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const zero = await makeProject(tenant, client, {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, zero, { depositAmount: 0 });
			const paid = await makeProject(tenant, client, {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, paid);
			await makePayment(tenant, paid, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});

			for (const [index, project] of [zero, paid].entries()) {
				const result = await sessions.scheduleFor(
					tenant,
					OWNER,
					project,
					slot(sita, 3 + index),
				);
				assert.deepEqual(
					[result.projectStatus, result.booked, result.session.status],
					["booked", true, "scheduled"],
				);
				assert.equal(await statusOf(project), "booked");
			}
		});
	});

	test("an uncovered deposit keeps the project deposit_pending, and the deposit books it later", async ({
		assert,
	}) => {
		const { owner, tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, project);

			const result = await sessions.scheduleFor(tenant, OWNER, project, slot(sita, 3));
			assert.deepEqual([result.projectStatus, result.booked], ["deposit_pending", false]);

			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			assert.isTrue(await sessions.settleBooking(tenant, project));
			assert.equal(await statusOf(project), "booked");
		});
	});

	test("before acceptance a tattoo session holds the date, and accepting a zero-deposit quote books it", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "quoted",
				artistId: sita.id,
			});
			const quote = await makeQuote(tenant, project, { depositAmount: 0 });
			const held = await sessions.scheduleFor(tenant, OWNER, project, slot(sita, 3));
			assert.deepEqual([held.projectStatus, held.booked], ["quoted", false]);
			assert.equal(
				await projects.acceptQuote(tenant, OWNER, project, quote.id),
				"booked",
			);

			// A consultation in review moves nothing.
			const reviewing = await makeProject(tenant, client, {
				status: "reviewing",
				artistId: sita.id,
			});
			const consultation = await sessions.scheduleFor(
				tenant,
				OWNER,
				reviewing,
				slot(sita, 4, "consultation"),
			);
			assert.equal(consultation.projectStatus, "reviewing");
		});
	});

	test("the next tattoo session books an in_progress project; more sessions keep a booked one booked", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const working = await makeProject(tenant, client, {
				status: "in_progress",
				artistId: sita.id,
			});
			const next = await sessions.scheduleFor(tenant, OWNER, working, slot(sita, 3));
			assert.deepEqual([next.projectStatus, next.booked], ["booked", true]);

			const booked = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			for (const days of [5, 6]) {
				const more = await sessions.scheduleFor(tenant, OWNER, booked, slot(sita, days));
				assert.deepEqual([more.projectStatus, more.booked], ["booked", false]);
			}
			assert.lengthOf(await sessionsOf(booked), 2);
		});
	});

	test("a finished or closed project takes no new session, and nothing is saved", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const expected = {
				completed: "project_finished",
				healing_check: "project_finished",
				declined: "project_closed",
				cancelled: "project_closed",
			} as const;
			for (const [index, [status, reason]] of Object.entries(expected).entries()) {
				const project = await makeProject(tenant, client, {
					status: status as keyof typeof expected,
					artistId: sita.id,
				});
				assert.equal(
					await ruleOf(() =>
						sessions.scheduleFor(tenant, OWNER, project, slot(sita, 3 + index)),
					),
					reason,
					status,
				);
				assert.lengthOf(await sessionsOf(project), 0, status);
			}
		});
	});
});

test.group("SessionService.scheduleFor: who and when (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("artists schedule only with their own profile, on a project assigned to them", async ({
		assert,
	}) => {
		const { tenant, client, sita, anu, asha, ram } = await setup();

		await inTenant(tenant, async () => {
			const mine = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			const anus = await makeProject(tenant, client, {
				status: "booked",
				artistId: anu.id,
			});

			const own = await sessions.scheduleFor(tenant, asha, mine, slot(sita, 3));
			assert.equal(own.session.artistId, sita.id);
			for (const [member, project, artist] of [
				[asha, mine, anu],
				[asha, anus, sita],
				[ram, mine, sita],
			] as const) {
				await assert.rejects(
					() => sessions.scheduleFor(tenant, member, project, slot(artist, 5)),
					/Row not found/,
				);
			}
			assert.lengthOf(await sessionsOf(mine), 1);
			assert.lengthOf(await sessionsOf(anus), 0);

			// An owner reassigns the project while Asha's request waits.
			const live = await TattooProject.findOrFail(mine.id);
			live.artistId = anu.id;
			await live.save();
			await assert.rejects(
				() => sessions.scheduleFor(tenant, asha, mine, slot(sita, 7)),
				/Row not found/,
			);
			assert.lengthOf(await sessionsOf(mine), 1);
		});
	});

	test("an overlap saves nothing, not even the project's artist", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const busy = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			await sessions.scheduleFor(tenant, OWNER, busy, slot(sita, 5));

			const fresh = await makeProject(tenant, client, { status: "reviewing" });
			await assert.rejects(
				() => sessions.scheduleFor(tenant, OWNER, fresh, slot(sita, 5)),
				SessionOverlapError,
			);
			assert.isNull((await TattooProject.findOrFail(fresh.id)).artistId);
			assert.lengthOf(await sessionsOf(fresh), 0);

			await sessions.scheduleFor(tenant, OWNER, fresh, slot(sita, 6, "consultation"));
			assert.equal((await TattooProject.findOrFail(fresh.id)).artistId, sita.id);
		});
	});

	test("another tenant's project refuses, and a deleted one is a 404", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();
		const { tenant: other } = await studioWithOwner(
			"schedule-other-85",
			"Schedule Other",
		);

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			await inTenant(other, async () => {
				await assert.rejects(
					() => sessions.scheduleFor(other, OWNER, project, slot(sita, 3)),
					/belongs to another tenant/,
				);
			});
			await (await TattooProject.findOrFail(project.id)).softDelete();
			await assert.rejects(
				() => sessions.scheduleFor(tenant, OWNER, project, slot(sita, 3)),
				/Row not found/,
			);
		});
	});
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_scheduling.spec.ts`
Expected: every test FAILS with "sessions.scheduleFor is not a function".

- [ ] **Step 8: Share `schedule`'s body with `scheduleFor`**

In `apps/platform/app/modules/scheduling/services/session_service.ts`:

1. Add `import { scheduleRefusal } from "#modules/scheduling/schedule_rules";` to the imports.
2. After the `Recorded` type add:

```ts
/**
 * What scheduling did (TAT-85 part 2): the session, the project's status
 * afterwards, and whether this call booked the project.
 */
export type Scheduled = {
	session: ProjectSession;
	projectStatus: ProjectStatus;
	booked: boolean;
};
```

3. Replace the whole `schedule` method (its doc comment included) with:

```ts
	/**
	 * Adds a `scheduled` session: the system's call (TAT-43's booking). A
	 * declined or cancelled project refuses (SessionRuleError
	 * "project_closed"); a project without an artist gets this session's
	 * artist. Throws SessionOverlapError when the artist is busy, and
	 * E_ROW_NOT_FOUND for an unknown or deleted artist or project.
	 */
	async schedule(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
	): Promise<ProjectSession> {
		return (await this.add(tenant, project, input, null)).session;
	}

	/**
	 * schedule for a member, from the project page (TAT-85 part 2). Under the
	 * project's lock `member` must be allowed the new session
	 * (mayChangeSession: owners any; an artist only with their own profile
	 * on a project assigned to it; E_ROW_NOT_FOUND otherwise), and the
	 * project must take new sessions (scheduleRefusal: SessionRuleError
	 * "project_closed" or "project_finished"). A tattoo session then books
	 * the project when it can, in the same transaction: in_progress to
	 * booked, or deposit_pending to booked once the deposit is settled
	 * (moveToBooked). SessionOverlapError after the savepoint rolled back.
	 */
	scheduleFor(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		input: NewSession,
	): Promise<Scheduled> {
		return this.add(tenant, project, input, member);
	}
```

4. Add this private method right before `changeTime`:

```ts
	/**
	 * Inserts a scheduled session under the project's lock: schedule's body
	 * (member null: only declined and cancelled projects refuse) and
	 * scheduleFor's (the member check, then scheduleRefusal).
	 */
	private async add(
		tenant: TenantRef,
		project: TattooProject,
		input: NewSession,
		member: Member | null,
	): Promise<Scheduled> {
		assertRange(input);
		assertProjectOf(tenant, project);
		const artist = await this.artists.findFor(tenant, input.artistId);
		try {
			return await withTransaction(async (trx) => {
				const live = await lockProject(trx, tenant, project.id);
				if (member) {
					await this.assertMayChange(tenant, member, live, {
						artistId: artist.id,
					});
					const refusal = scheduleRefusal(live.status);
					if (refusal) throw new SessionRuleError(refusal);
				} else if (CLOSED.includes(live.status)) {
					throw new SessionRuleError("project_closed");
				}
				if (!live.artistId) {
					live.artistId = artist.id;
					await live.save();
				}
				const session = await ProjectSession.create(
					{
						tenantId: tenant.id,
						projectId: live.id,
						artistId: artist.id,
						kind: input.kind,
						startsAt: input.startsAt,
						endsAt: input.endsAt,
					},
					{ client: trx },
				);
				// Lucid reads nothing back after an insert: load the column default
				// and the generated `active`, so the session we return is true.
				await session.refresh();
				const before = live.status;
				if (input.kind === "tattoo") {
					if (live.status === "in_progress") await setStatus(live, "booked");
					else await this.moveToBooked(tenant, live);
				}
				return {
					session,
					projectStatus: live.status,
					booked: before !== "booked" && live.status === "booked",
				};
			});
		} catch (error) {
			rethrowOverlap(error);
		}
	}
```

- [ ] **Step 9: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=session_scheduling.spec.ts --files=session_service.spec.ts --files=session_outcomes.spec.ts --files=booking_service.spec.ts --files=bookings_http.spec.ts`
Expected: PASS (8 new tests; the system `schedule` and TAT-43's booking unchanged). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 10: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/scheduling/schedule_rules.ts apps/platform/app/modules/scheduling/errors.ts apps/platform/app/modules/scheduling/validators/session.ts apps/platform/app/modules/scheduling/services/session_service.ts apps/platform/app/controllers/project_sessions_controller.ts apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts apps/platform/tests/functional/scheduling/session_scheduling.spec.ts
git -C <repo> add apps/platform/app/modules/scheduling/schedule_rules.ts apps/platform/app/modules/scheduling/errors.ts apps/platform/app/modules/scheduling/validators/session.ts apps/platform/app/modules/scheduling/services/session_service.ts apps/platform/app/controllers/project_sessions_controller.ts apps/platform/tests/unit/modules/scheduling/schedule_rules.spec.ts apps/platform/tests/unit/modules/scheduling/session_validator.spec.ts apps/platform/tests/functional/scheduling/session_scheduling.spec.ts
git -C <repo> commit -m "feat(platform): schedule a session on an existing project and book it when the deposit allows" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The schedule route, and the payments screen's hint

**Files:**
- Modify: `apps/platform/app/controllers/project_sessions_controller.ts` (`store`)
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/app/controllers/payments_controller.ts` (`bookingNote`)
- Modify: `apps/platform/tests/isolation/cases.ts`, `apps/platform/tests/functional/payments/payments_http.spec.ts` (the hint's words)
- Regenerate: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/scheduling/project_scheduling_http.spec.ts` (create)

**Interfaces:**
- Produces: route `tenant.projects.sessions.store` (`POST /t/:tenant/projects/:id/sessions`); `IsolationCase.resource` gains `"sessionProject"`.
- Consumes: Task 8; `ProjectService.findFor`, `BookingService.bookableArtists`, `QuoteService.current`, `DepositService.remaining`.

- [ ] **Step 1: Write the failing HTTP test**

Create `apps/platform/tests/functional/scheduling/project_scheduling_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectSession from "#modules/scheduling/models/project_session";
import { localDateTime, sessionTimeText } from "#modules/scheduling/times";
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

const SLUG = "schedule-http-85";
const KTM = "Asia/Kathmandu";

const scheduleUrl = (projectId: string) =>
	`/t/${SLUG}/projects/${projectId}/sessions`;
const projectUrl = (projectId: string) => `/t/${SLUG}/projects/${projectId}`;

/** yyyy-MM-dd, `days` from today in Kathmandu, the test studio's timezone. */
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

/** `time` on the day `days` from today in Kathmandu. */
function localAt(days: number, time: string) {
	const instant = localDateTime(dayFromNow(days), time, KTM);
	if (!instant) throw new Error(`${time} doesn't exist in ${days} days`);
	return instant;
}

function post(
	client: ApiClient,
	url: string,
	body: Record<string, unknown>,
	user: User,
) {
	return client.post(url).form(body).withCsrfToken().loginAs(user).redirects(0);
}

/**
 * The studio: Sita (linked to the artist member Asha) and Anu, a client,
 * and Ram, an artist member with no profile.
 */
async function setup() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Schedule HTTP");
	const asha = await artistIn(tenant, "asha@schedule-http-85.example");
	const ram = await artistIn(tenant, "ram@schedule-http-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = asha.id;
		await sita.save();
		return {
			sita,
			anu: await makeArtist(tenant, "anu"),
			customer: await makeClient(tenant),
		};
	});
	return { owner, asha, ram, tenant, ...parts };
}

/** A project of `customer` in `status`, assigned to `artistId`. */
const projectIn = (
	tenant: { id: string },
	customer: Parameters<typeof makeProject>[1],
	status: ProjectStatus,
	artistId: string,
) => inTenant(tenant, () => makeProject(tenant, customer, { status, artistId }));

const sessionsOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () =>
		ProjectSession.query().where("project_id", projectId).orderBy("starts_at"),
	);

const statusOf = (tenant: { id: string }, id: string) =>
	inTenant(tenant, async () => (await TattooProject.findOrFail(id)).status);

/** The form for a tattoo session with `artistId`, three days from now at 10:00, two hours. */
const tattoo = (artistId: string, over: Record<string, unknown> = {}) => ({
	sessionKind: "tattoo",
	sessionArtistId: artistId,
	date: dayFromNow(3),
	startTime: "10:00",
	hours: "2",
	...over,
});

test.group("Scheduling on a project over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a covered deposit books the project as the tattoo session is scheduled", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const project = await projectIn(tenant, customer, "deposit_pending", sita.id);
		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
		});

		const response = await post(client, scheduleUrl(project.id), tattoo(sita.id), owner);

		response.assertHeader("location", projectUrl(project.id));
		const [session] = await sessionsOf(tenant, project.id);
		assert.equal(
			session.startsAt.setZone(KTM).toFormat("yyyy-MM-dd HH:mm"),
			`${dayFromNow(3)} 10:00`,
		);
		assert.deepEqual([session.kind, session.status], ["tattoo", "scheduled"]);
		response.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, KTM)}. The project is booked.`,
		);
		assert.equal(await statusOf(tenant, project.id), "booked");
	});

	test("an uncovered deposit leaves the project waiting, and the flash says what is due", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const project = await projectIn(tenant, customer, "deposit_pending", sita.id);
		await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await post(client, scheduleUrl(project.id), tattoo(sita.id), owner);

		const [session] = await sessionsOf(tenant, project.id);
		response.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, KTM)}. NPR 3,000 of the deposit is still due: the project is booked once it's paid.`,
		);
		assert.equal(await statusOf(tenant, project.id), "deposit_pending");
	});

	test("before acceptance a tattoo session holds the date; a consultation adds nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const quoted = await projectIn(tenant, customer, "quoted", sita.id);
		await inTenant(tenant, () => makeQuote(tenant, quoted));
		const reviewing = await projectIn(tenant, customer, "reviewing", sita.id);

		const held = await post(client, scheduleUrl(quoted.id), tattoo(sita.id), owner);
		const [heldSession] = await sessionsOf(tenant, quoted.id);
		held.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(heldSession.startsAt, heldSession.endsAt, KTM)}. It holds the date: the project is booked once the client accepts the quote and the deposit is settled.`,
		);
		assert.equal(await statusOf(tenant, quoted.id), "quoted");

		const consult = await post(
			client,
			scheduleUrl(reviewing.id),
			tattoo(sita.id, { sessionKind: "consultation", date: dayFromNow(4), hours: "1" }),
			owner,
		);
		const [consultSession] = await sessionsOf(tenant, reviewing.id);
		consult.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(consultSession.startsAt, consultSession.endsAt, KTM)}.`,
		);
		assert.equal(consultSession.kind, "consultation");
	});

	test("an overlap, a past day and an unknown kind are field errors, and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const project = await projectIn(tenant, customer, "booked", sita.id);
		await inTenant(tenant, () =>
			makeSession(tenant, project, sita, {
				startsAt: localAt(4, "10:00"),
				endsAt: localAt(4, "12:00"),
			}),
		);
		const send = (over: Record<string, unknown>) =>
			post(client, scheduleUrl(project.id), tattoo(sita.id, over), owner);

		assertValidationError(
			await send({ date: dayFromNow(4), startTime: "11:00" }),
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		assertValidationError(
			await send({ date: dayFromNow(-1) }),
			"date",
			"Pick a date from today to a year from now.",
		);
		assertValidationError(
			await send({ sessionKind: "flash" }),
			"sessionKind",
			"Choose tattoo, consultation or touch-up.",
		);
		assert.lengthOf(await sessionsOf(tenant, project.id), 1);
	});

	test("another studio's artist and a deleted artist are field errors, and neither studio changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita, anu } = await setup();
		const { tenant: other } = await studioWithOwner(
			"schedule-other-http-85",
			"Schedule Other",
		);
		const theirs = await inTenant(other, () => makeArtist(other, "sita"));
		const project = await projectIn(tenant, customer, "booked", sita.id);
		await inTenant(tenant, async () => {
			await anu.softDelete();
		});

		for (const artistId of [theirs.id, anu.id]) {
			assertValidationError(
				await post(client, scheduleUrl(project.id), tattoo(artistId), owner),
				"sessionArtistId",
				"Choose an artist from the list.",
			);
		}
		assert.lengthOf(await sessionsOf(tenant, project.id), 0);
		assert.lengthOf(
			await inTenant(other, () =>
				ProjectSession.query().where("tenant_id", other.id),
			),
			0,
		);
	});

	test("a closed or finished project refuses with a flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		for (const [status, message] of [
			["cancelled", "This project is closed: it takes no new sessions."],
			["completed", "This project is finished: it takes no new sessions."],
		] as const) {
			const project = await projectIn(tenant, customer, status, sita.id);
			const response = await post(client, scheduleUrl(project.id), tattoo(sita.id), owner);
			response.assertHeader("location", projectUrl(project.id));
			response.assertFlashMessage("error", message);
			assert.lengthOf(await sessionsOf(tenant, project.id), 0, status);
		}
	});

	test("artists schedule with their own profile on their own project only", async ({
		client,
		assert,
	}) => {
		const { tenant, customer, sita, anu, asha, ram } = await setup();
		const mine = await projectIn(tenant, customer, "booked", sita.id);
		const anus = await projectIn(tenant, customer, "booked", anu.id);

		const own = await post(client, scheduleUrl(mine.id), tattoo(sita.id), asha);
		own.assertHeader("location", projectUrl(mine.id));
		assert.lengthOf(await sessionsOf(tenant, mine.id), 1);

		assertValidationError(
			await post(
				client,
				scheduleUrl(mine.id),
				tattoo(anu.id, { date: dayFromNow(5) }),
				asha,
			),
			"sessionArtistId",
			"Choose an artist from the list.",
		);
		(await post(client, scheduleUrl(anus.id), tattoo(sita.id), asha)).assertStatus(404);
		(await post(client, scheduleUrl(mine.id), tattoo(sita.id), ram)).assertStatus(404);
		assert.lengthOf(await sessionsOf(tenant, mine.id), 1);
		assert.lengthOf(await sessionsOf(tenant, anus.id), 0);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_scheduling_http.spec.ts`
Expected: FAIL: the route doesn't exist, so the requests are 404s and the assertions fail.

- [ ] **Step 3: The controller action**

In `apps/platform/app/controllers/project_sessions_controller.ts`:

1. Add the imports (value imports with the biome-ignore comment for the four services):

```ts
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BookingService from "#modules/projects/services/booking_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import { scheduledNote } from "#modules/scheduling/schedule_rules";
```

and add `type Scheduled` to the import from `#modules/scheduling/services/session_service`, and `scheduleValidator, toNewSession` to the import from `#modules/scheduling/validators/session`.

2. After `OUTCOME_REFUSED` add:

```ts
/** What a refused schedule tells the user. */
const SCHEDULE_REFUSED: Record<SessionRuleReason, string> = {
	project_closed: "This project is closed: it takes no new sessions.",
	project_finished: "This project is finished: it takes no new sessions.",
	not_scheduled: "This session can't be scheduled.",
	not_started: "This session can't be scheduled.",
	not_booked: "This session can't be scheduled.",
	invalid_range: "This session can't be scheduled.",
};
```

3. Replace the constructor with:

```ts
	constructor(
		private sessions: SessionService,
		private artists: ArtistService,
		private projects: ProjectService,
		private bookings: BookingService,
		private quotes: QuoteService,
		private deposits: DepositService,
	) {}
```

4. Add this action after `move`:

```ts
	/**
	 * Schedules a session on the project (TAT-85 part 2). The project loads
	 * through ProjectService.findFor before the form is read (a 404 for
	 * another studio's, a deleted one, or one an artist can't open). The
	 * artist must be one the member may book (BookingService.bookableArtists:
	 * owners any live artist, an artist only themselves), else a field error.
	 * A tattoo session books the project when it can; the flash says so, or
	 * what is still missing.
	 */
	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(scheduleValidator);
		const input = toNewSession(form, tenant.timezone);
		const artist = (await this.bookings.bookableArtists(tenant, membership)).find(
			({ id }) => id === input.artistId,
		);
		if (!artist) {
			throw fieldError(
				"sessionArtistId",
				"Choose an artist from the list.",
				"exists",
			);
		}
		let scheduled: Scheduled;
		try {
			scheduled = await this.sessions.scheduleFor(
				tenant,
				membership,
				project,
				input,
			);
		} catch (error) {
			// The savepoint already rolled back: nothing was saved.
			if (error instanceof SessionOverlapError) {
				throw fieldError(
					"startTime",
					`${artist.name} already has a session at that time. Pick another time.`,
					"overlap",
				);
			}
			if (!(error instanceof SessionRuleError)) throw error;
			ctx.session.flash("error", SCHEDULE_REFUSED[error.reason]);
			return backTo(ctx, tenant, project.id);
		}
		const { session, projectStatus, booked } = scheduled;
		const quote =
			projectStatus === "deposit_pending"
				? await this.quotes.current(tenant, project)
				: null;
		const depositDue = quote
			? await this.deposits.remaining(tenant, project, quote)
			: 0;
		ctx.session.flash(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, tenant.timezone)}.${scheduledNote({ kind: session.kind, booked, projectStatus, depositDue })}`,
		);
		return backTo(ctx, tenant, project.id);
	}
```

5. Change `backTo` to take the project's id, and its three callers in `outcome` and `move` from `backTo(ctx, tenant, session)` to `backTo(ctx, tenant, session.projectId)`:

```ts
function backTo(
	ctx: HttpContext,
	tenant: { slug: string },
	projectId: string,
) {
	return ctx.response
		.redirect()
		.toRoute("tenant.projects.show", { tenant: tenant.slug, id: projectId });
}
```

(If `ProjectSession` is then imported only as a type for `moved`, keep `import type`.)

- [ ] **Step 4: The route**

In `apps/platform/start/routes.ts`, inside the `/projects` group, right after the `tenant.projects.artist.update` route, add:

```ts
				// A session on this project (TAT-85): owners, and the assigned
				// artist with their own profile (SessionService.scheduleFor).
				router
					.post(":id/sessions", [controllers.ProjectSessions, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.sessions.store");
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains `tenant.projects.sessions.store`.

- [ ] **Step 5: The isolation case and the payments hint**

In `apps/platform/tests/isolation/cases.ts`, add `| "sessionProject"` to the `resource` union (after `| "session"`), and at the end of `isolationCases` add:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/sessions",
		resource: "sessionProject",
		actor: "owner",
		// The studio's own artist, two days after its seeded session.
		body: (own) => ({
			sessionKind: "tattoo",
			sessionArtistId: own.artistProfile.id,
			date: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 62 })
				.toFormat("yyyy-MM-dd"),
			startTime: "10:00",
			hours: "2",
		}),
		ownStatus: 302,
		snapshot: sessionRows,
	},
```

In `apps/platform/app/controllers/payments_controller.ts`, in `bookingNote`, replace `" Schedule a tattoo session to book the project."` with `" Schedule a tattoo session under Sessions to book the project."`. In `apps/platform/tests/functional/payments/payments_http.spec.ts`, replace `"Payment verified. Schedule a tattoo session to book the project."` with `"Payment verified. Schedule a tattoo session under Sessions to book the project."` (if `git -C <repo> grep -n "Schedule a tattoo session to book" -- apps/platform` finds other places, change them too).

- [ ] **Step 6: Run the tests to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_scheduling_http.spec.ts --files=project_sessions_http.spec.ts --files=payments_http.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts`
Expected: PASS (7 new HTTP tests, the new isolation case, the outcome and move routes unchanged). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 7: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/project_sessions_controller.ts apps/platform/start/routes.ts apps/platform/app/controllers/payments_controller.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/payments/payments_http.spec.ts apps/platform/tests/functional/scheduling/project_scheduling_http.spec.ts
git -C <repo> add apps/platform/app/controllers/project_sessions_controller.ts apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/app/controllers/payments_controller.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/payments/payments_http.spec.ts apps/platform/tests/functional/scheduling/project_scheduling_http.spec.ts
git -C <repo> commit -m "feat(platform): add the route that schedules a session on a project" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "Schedule a session" on the project page

**Files:**
- Modify: `apps/platform/app/controllers/projects_controller.ts` (`show`: the `scheduling` prop)
- Modify: `apps/platform/inertia/components/projects.ts` (`ProjectPageProps.scheduling`)
- Modify: `apps/platform/inertia/components/sessions_card.tsx` (the card's default export, a new `ScheduleForm`)
- Modify: `apps/platform/inertia/pages/projects/show.tsx`
- Test: `apps/platform/tests/functional/projects/project_page.spec.ts` (add a group)

**Interfaces:**
- Produces: page prop `scheduling: { artists: { id: string; name: string }[]; artistId: string | null; artistFixed: boolean; hint: string | null } | null`; `SessionsCard({ projectId, sessions, dates, scheduling })`.
- Consumes: Task 8's `scheduleRefusal` and `schedulingHint`, Task 9's route.

- [ ] **Step 1: Write the failing test**

At the end of `apps/platform/tests/functional/projects/project_page.spec.ts` add:

```ts
test.group("Project page: scheduling (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner gets every artist, the project's as the default, and what the deposit still needs", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { project, sita, anu } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			const anu = await makeArtist(tenant, "anu");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, project);
			return { project, sita, anu };
		});

		const { scheduling } = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.sameMembers(
			scheduling.artists.map(({ id }: { id: string }) => id),
			[sita.id, anu.id],
		);
		assert.equal(scheduling.artistId, sita.id);
		assert.isFalse(scheduling.artistFixed);
		assert.equal(
			scheduling.hint,
			"A tattoo session holds the date. The project is booked once the deposit is paid: NPR 3,000 still due.",
		);
	});

	test("an artist schedules only themselves; a finished or closed project offers nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const { booked, finished, closed, sita } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			sita.userId = asha.id;
			await sita.save();
			await makeArtist(tenant, "anu");
			const customer = await makeClient(tenant);
			const project = (status: "booked" | "completed" | "cancelled") =>
				makeProject(tenant, customer, { status, artistId: sita.id });
			return {
				sita,
				booked: await project("booked"),
				finished: await project("completed"),
				closed: await project("cancelled"),
			};
		});

		const mine = (
			await client.get(page(booked.id)).withInertia().loginAs(asha)
		).inertiaProps;
		assert.deepEqual(mine.scheduling, {
			artists: [{ id: sita.id, name: "Sita" }],
			artistId: sita.id,
			artistFixed: true,
			hint: null,
		});

		for (const project of [finished, closed]) {
			const props = (
				await client.get(page(project.id)).withInertia().loginAs(owner)
			).inertiaProps;
			assert.isNull(props.scheduling, project.status);
		}
	});
});
```

(`makeQuote` and the other helpers are imported in that file; add any a later ticket removed.)

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts`
Expected: the two new tests FAIL (`scheduling` is undefined).

- [ ] **Step 3: The prop**

In `apps/platform/app/controllers/projects_controller.ts`:

1. Add the imports `import { scheduleRefusal, schedulingHint } from "#modules/scheduling/schedule_rules";` and, with the biome-ignore comment, `import BookingService from "#modules/projects/services/booking_service";`; add `private bookings: BookingService,` at the end of the constructor's parameters.
2. In `show`, right before `return ctx.inertia.render("projects/show", {`, add:

```ts
		// Scheduling a session here (TAT-85 part 2): whom this member may
		// schedule, the default, and what a tattoo session would do.
		const bookable = await this.bookings.bookableArtists(tenant, membership);
		const depositDue =
			project.status === "deposit_pending" && current
				? await this.deposits.remaining(tenant, project, current)
				: 0;
		const defaultArtistId = bookable.some(({ id }) => id === project.artistId)
			? project.artistId
			: bookable.length === 1
				? (bookable[0]?.id ?? null)
				: null;
```

3. In the rendered props, after `sessionDates: { today: todayText, max: lastBookable },` add:

```ts
			scheduling:
				scheduleRefusal(project.status) === null && bookable.length > 0
					? {
							artists: bookable.map(({ id, name }) => ({ id, name })),
							artistId: defaultArtistId,
							artistFixed: membership.role !== "owner",
							hint: schedulingHint(project.status, depositDue),
						}
					: null,
```

In `apps/platform/inertia/components/projects.ts`, in `ProjectPageProps` after `sessionDates`, add:

```ts
	/**
	 * Scheduling a session on this project (TAT-85): the artists this member
	 * may choose, the default, whether it is fixed (an artist schedules only
	 * themselves) and what a tattoo session would do; null when the project
	 * takes no new sessions or the member has no artist to schedule with.
	 */
	scheduling: {
		artists: { id: string; name: string }[];
		artistId: string | null;
		artistFixed: boolean;
		hint: string | null;
	} | null;
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts`
Expected: PASS.

- [ ] **Step 4: The form on the card**

In `apps/platform/inertia/components/sessions_card.tsx`:

1. Add `type ProjectPageProps,` to the import from `~/components/projects`.
2. Replace the default export `SessionsCard` (its doc comment included) with:

```tsx
/**
 * The project's sessions and what staff record on them (TAT-85): done,
 * no-show or cancelled behind an inline confirmation, a form to move a
 * session, and (part 2) a form to schedule a new one. Which buttons show is
 * the server's. One panel is open at a time; after a successful save focus
 * moves to the card's heading, so a screen reader lands on the updated list.
 */
export default function SessionsCard({
	projectId,
	sessions,
	dates,
	scheduling,
}: {
	projectId: string;
	sessions: SessionRow[];
	dates: Dates;
	scheduling: ProjectPageProps["scheduling"];
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const scheduleButton = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState<Open>(null);
	const [scheduleOpen, setScheduleOpen] = useState(false);
	const done = () => {
		setOpen(null);
		setScheduleOpen(false);
		heading.current?.focus();
	};
	const closeSchedule = () => {
		setScheduleOpen(false);
		scheduleButton.current?.focus();
	};

	return (
		<Card id="sessions">
			<CardHeader>
				<CardTitle>
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Sessions
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{sessions.length === 0 ? (
					<p className="text-sm text-muted-foreground">No sessions yet.</p>
				) : (
					<ul className="flex flex-col divide-y text-sm">
						{sessions.map((session) => (
							<SessionItem
								key={session.id}
								session={session}
								dates={dates}
								open={open?.sessionId === session.id ? open.action : null}
								onOpen={(action) => {
									setScheduleOpen(false);
									setOpen({ sessionId: session.id, action });
								}}
								onClose={() => setOpen(null)}
								onDone={done}
							/>
						))}
					</ul>
				)}
				{scheduling && (
					<div className="flex flex-col gap-3 text-sm">
						<div>
							<Button
								ref={scheduleButton}
								type="button"
								variant="outline"
								className="h-11"
								aria-expanded={scheduleOpen}
								onClick={() => {
									setOpen(null);
									setScheduleOpen(true);
								}}
							>
								Schedule a session
							</Button>
						</div>
						{scheduleOpen && (
							<ScheduleForm
								projectId={projectId}
								scheduling={scheduling}
								dates={dates}
								onCancel={closeSchedule}
								onDone={done}
							/>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
```

3. Add at the end of the file:

```tsx
/**
 * A new session on the project (TAT-85 part 2): kind, artist (fixed for an
 * artist member), date, start and length, with the server's hint about
 * what a tattoo session does to the project. Focus starts on Kind; Escape
 * closes the form. After a refused save it stays open with what was typed.
 */
function ScheduleForm({
	projectId,
	scheduling,
	dates,
	onCancel,
	onDone,
}: {
	projectId: string;
	scheduling: NonNullable<ProjectPageProps["scheduling"]>;
	dates: Dates;
	onCancel: () => void;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const id = useId();
	const kind = useRef<HTMLSelectElement>(null);
	useEffect(() => {
		kind.current?.focus();
	}, []);
	const field = (name: string) => `${id}-${name}`;
	const fixed = scheduling.artistFixed ? scheduling.artists[0] : undefined;
	const select = "h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm";

	return (
		<Form
			route="tenant.projects.sessions.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<fieldset
					className="min-w-0 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
				>
					<legend className="sr-only">Schedule a session</legend>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field data-invalid={!!errors.sessionKind}>
							<FieldLabel htmlFor={field("kind")}>Kind</FieldLabel>
							<select
								ref={kind}
								id={field("kind")}
								name="sessionKind"
								defaultValue="tattoo"
								aria-invalid={!!errors.sessionKind}
								aria-describedby={
									errors.sessionKind ? field("kind-error") : undefined
								}
								className={select}
							>
								<option value="tattoo">Tattoo</option>
								<option value="consultation">Consultation</option>
								<option value="touch_up">Touch-up</option>
							</select>
							{errors.sessionKind && (
								<FieldError id={field("kind-error")}>
									{errors.sessionKind}
								</FieldError>
							)}
						</Field>
						{fixed ? (
							<div className="flex flex-col gap-2">
								<span className="font-medium">Artist</span>
								<span>{fixed.name} (you)</span>
								<input type="hidden" name="sessionArtistId" value={fixed.id} />
							</div>
						) : (
							<Field data-invalid={!!errors.sessionArtistId}>
								<FieldLabel htmlFor={field("artist")}>Artist</FieldLabel>
								<select
									id={field("artist")}
									name="sessionArtistId"
									required
									defaultValue={scheduling.artistId ?? ""}
									aria-invalid={!!errors.sessionArtistId}
									aria-describedby={
										errors.sessionArtistId ? field("artist-error") : undefined
									}
									className={select}
								>
									{scheduling.artistId === null && (
										<option value="" disabled>
											Choose an artist
										</option>
									)}
									{scheduling.artists.map(({ id: artistId, name }) => (
										<option key={artistId} value={artistId}>
											{name}
										</option>
									))}
								</select>
								{errors.sessionArtistId && (
									<FieldError id={field("artist-error")}>
										{errors.sessionArtistId}
									</FieldError>
								)}
							</Field>
						)}
					</div>
					<div className="mt-4 grid gap-4 sm:grid-cols-3">
						<Field data-invalid={!!errors.date}>
							<FieldLabel htmlFor={field("date")}>Date</FieldLabel>
							<Input
								id={field("date")}
								name="date"
								type="date"
								required
								min={dates.today}
								max={dates.max}
								defaultValue={dates.today}
								aria-invalid={!!errors.date}
								aria-describedby={errors.date ? field("date-error") : undefined}
								className="h-11"
							/>
							{errors.date && (
								<FieldError id={field("date-error")}>{errors.date}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.startTime}>
							<FieldLabel htmlFor={field("startTime")}>Start time</FieldLabel>
							<Input
								id={field("startTime")}
								name="startTime"
								type="time"
								required
								aria-invalid={!!errors.startTime}
								aria-describedby={
									errors.startTime ? field("startTime-error") : undefined
								}
								className="h-11"
							/>
							{errors.startTime && (
								<FieldError id={field("startTime-error")}>
									{errors.startTime}
								</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.hours}>
							<FieldLabel htmlFor={field("hours")}>Length (hours)</FieldLabel>
							<Input
								id={field("hours")}
								name="hours"
								type="number"
								inputMode="decimal"
								required
								min={0.25}
								max={12}
								step={0.25}
								aria-invalid={!!errors.hours}
								aria-describedby={
									errors.hours ? field("hours-error") : field("hours-hint")
								}
								className="h-11"
							/>
							{errors.hours ? (
								<FieldError id={field("hours-error")}>{errors.hours}</FieldError>
							) : (
								<FieldDescription id={field("hours-hint")}>
									In quarter hours: 2.5 for two and a half.
								</FieldDescription>
							)}
						</Field>
					</div>
					{scheduling.hint && (
						<p className="mt-4 text-muted-foreground">{scheduling.hint}</p>
					)}
					<div className="mt-4 flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Schedule session"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={onCancel}
						>
							Close
						</Button>
					</div>
				</fieldset>
			)}
		</Form>
	);
}
```

In `apps/platform/inertia/pages/projects/show.tsx`, add `scheduling,` to the destructured props (after `sessionDates,`) and change the card to:

```tsx
				<SessionsCard
					projectId={project.id}
					sessions={sessions}
					dates={sessionDates}
					scheduling={scheduling}
				/>
```

- [ ] **Step 5: Check it builds**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean. Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform build` → succeeds. Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/projects.ts apps/platform/inertia/components/sessions_card.tsx apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/functional/projects/project_page.spec.ts
git -C <repo> add apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/projects.ts apps/platform/inertia/components/sessions_card.tsx apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/functional/projects/project_page.spec.ts
git -C <repo> commit -m "feat(platform): schedule a session from the project page's Sessions card" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md` (Scheduling)
- Modify: `apps/platform/docs/testing.md` (Tenant isolation tests)
- Modify: `docs/requirements.md` (Sessions; Project rules)

`docs/README.md` needs no change (no new document); `docs/architecture.md`'s request flow already names "Schedule session".

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`, in the "Scheduling (TAT-36)" bullet:

- Replace "`SessionRuleError` carries a `reason` (`project_closed`, `not_scheduled`, `invalid_range`)" with "`SessionRuleError` carries a `reason` (`project_closed`, `not_scheduled`, `invalid_range`, and TAT-85's `not_started`, `not_booked` and `project_finished`)".
- Replace "completing one moves `booked` to `in_progress`." with "an outcome on one moves a `booked` project to `in_progress` when the project has a completed tattoo session and no scheduled one (TAT-85: a second scheduled tattoo session keeps it `booked`, and cancelling or missing the next one once the work started puts it back), in `finish`, so every caller gets it."
- Replace "Cancelling or no-showing the last live session leaves a `booked` project `booked`: TAT-46 owns any rollback and can flag \"booked with no scheduled session\"." with "Cancelling or no-showing the only tattoo session of a project whose work hasn't started leaves it `booked`, and the projects list flags \"booked with no scheduled session\" (TAT-46)."

Add these two bullets right after the "Calendar (TAT-50)" bullet:

```markdown
- Session outcomes and moves (TAT-85): staff record a scheduled session's outcome and move it from the project page's Sessions card (`inertia/components/sessions_card.tsx`), through `POST /t/:tenant/sessions/:id/outcome` (`status`: `completed`, `no_show` or `cancelled`) and `POST /t/:tenant/sessions/:id/move` (`date`, `startTime`, `hours`) in the `/sessions` group (owners and artists; `ProjectSessionsController`). Who may change a session is `mayChangeSession` (`#modules/scheduling/outcomes`): owners any; an artist only a session with their own linked live profile on a project assigned to that profile; anyone else a 404. `SessionService.findChangeable(tenant, member, id)` applies it before the form is read (a deleted project's sessions are a 404 too), and `recordOutcome(tenant, member, session, outcome)` and `move(tenant, member, session, times)` apply it again under the row locks. `outcomeRefusal` decides the rest: an outcome is final (`not_scheduled`), done and no-show need the session to have started on the server's clock (`not_started`; there is no later limit, so yesterday's session is recorded today), and a tattoo session is done only on a project in `BOOKED_STATUSES` (`not_booked`). A move is `reschedule` with the member check: the booking form's time rules (`readSessionTimes` in `#modules/scheduling/validators/session`, which TAT-43's validator also uses: today to a year ahead in the studio's timezone, a time the clocks skip refused, one they pass twice its first occurrence, quarter hours), the same artist, any scheduled session even one whose time has passed, no status change; an overlap is `SessionOverlapError`, a field error on `startTime`. Nothing touches payments, deposit links or quotes; deposit outcomes per session are a follow-up (TAT-66's `deposit_outcomes.session_id`). `countByStatus(tenant, { from, to })` counts live sessions by `starts_at` in a half-open window, per status, for the studio and per artist (TAT-70, TAT-76). No column records who set an outcome or when.
- Scheduling on a project (TAT-85): `POST /t/:tenant/projects/:id/sessions` (`tenant.projects.sessions.store`, the projects group; `sessionKind`, `sessionArtistId`, `date`, `startTime`, `hours`) adds a session to an existing project through `SessionService.scheduleFor(tenant, member, project, input)`, which shares `schedule`'s body: under the project's lock `mayChangeSession` for the new session (an artist only with their own profile on their own project; the controller first offers only `BookingService.bookableArtists`, else the field error on `sessionArtistId`), then `scheduleRefusal` (`#modules/scheduling/schedule_rules`: `reviewing` to `in_progress` take sessions, `completed` and `healing_check` are `project_finished`, `declined` and `cancelled` `project_closed`), then the insert and, for a tattoo session, the booking rule in the same transaction (`in_progress` to `booked`; `deposit_pending` to `booked` through `moveToBooked` when the deposit is settled). It returns whether it booked the project, and the flash says so or what the deposit still needs (`scheduledNote`, with `DepositService.remaining`). Past days are refused as for a new booking. TAT-43's direct booking keeps calling `schedule`, which only refuses `declined` and `cancelled`. The payments screen's flash after a deposit without a tattoo session points at the Sessions card.
```

- [ ] **Step 2: Testing**

In `apps/platform/docs/testing.md`, in the `twoStudios()` bullet, replace "`payment` is the pipeline's submitted payment." with "`payment` is the pipeline's submitted payment; a booked project assigned to `artistProfile` with a scheduled tattoo session 60 days out (`sessionProject`, `session`) is the session routes' resource (TAT-85)."

- [ ] **Step 3: Requirements**

In `docs/requirements.md`:

- Replace `- [ ] Sessions of kind consultation, tattoo or touch-up, each for one artist and inside a project` with `- [x] Sessions of kind consultation, tattoo or touch-up, each for one artist and inside a project`.
- Replace `- [ ] Mark a session completed, no-show or cancelled, or move it to another time` with `- [x] Mark a session completed, no-show or cancelled, or move it to another time`.
- After the line that starts `- The calendar shows active sessions (scheduled or completed)`, add:

```markdown
- On the project page staff mark a scheduled session done or a no-show once it has started (also days later) and cancel it any time; an outcome is final. Moving a session changes its time, from today to a year ahead with the same artist, and an overlap is refused. Owners change any session, artists their own sessions on their own projects.
- Staff schedule more sessions on an open project from its page (from review to in progress; not on a finished or closed one), from today to a year ahead. A tattoo session books a project waiting for its deposit as soon as the deposit is settled, so the deposit and the session can come in either order; before the quote is accepted it holds the date. Owners schedule any artist, artists only themselves on their own projects.
```

- Replace `- Sessions block the artist's time, and the database rejects overlaps. Each session is \`scheduled\`, \`completed\`, \`no_show\` or \`cancelled\`; rescheduling changes its time.` with:

```markdown
- Sessions block the artist's time, and the database rejects overlaps. Each session is `scheduled`, `completed`, `no_show` or `cancelled`; rescheduling changes its time. A tattoo session is marked completed only once its project is booked. A booked project moves to `in_progress` once a tattoo session is completed and none is still scheduled, and back to `booked` when the next one is scheduled.
```

- [ ] **Step 4: Commit**

```bash
git -C <repo> add apps/platform/docs/backend.md apps/platform/docs/testing.md docs/requirements.md
git -C <repo> commit -m "docs(platform): document session outcomes, moving a session and scheduling on a project" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification

- [ ] **Step 1: Generated files are current**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> status --short`
Expected: no changes (Tasks 5 and 9 committed `.adonisjs/`). If `.adonisjs/` changed, commit it as `chore(platform): regenerate types` with the trailer.

- [ ] **Step 2: Root gates**

From the repo root: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> typecheck`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> build`.
Expected: all clean (`pnpm check` keeps its pre-existing warnings, if any). If `pnpm check` fails with "nested root configuration" because of another agent's `.claude/worktrees/*` checkout, run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check apps packages` instead and say so.

- [ ] **Step 3: Full suite**

Run in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/full.log 2>&1` and wait for the notification.
Expected: all pass, about 69 more than Task 0's baseline (Task 1: 8, Task 2: 6, Task 3: 14, Task 4: 1, Task 5: 9 + 2 isolation cases + 1 role guard, Task 6: 2, Task 7: 2, Task 8: 6 unit + 8 functional, Task 9: 7 + 1 isolation case, Task 10: 2). Report the exact count from the log's `Tests` line.

- [ ] **Step 4: Schema untouched, tree clean**

Run: `git -C <repo> log --format=%h -1 -- docs/superpowers/plans/2026-10-18-tat-85-session-outcomes.md` (the design commit), then `git -C <repo> diff <that hash> --stat -- apps/platform/database` (expected: empty) and `git -C <repo> status -sb` (expected: clean). `git -C <repo> log --oneline -12` lists the design commit and Tasks 1 to 11.

- [ ] **Step 5: PR text (not committed)**

Write `<scratchpad>/pr3-tat-85.md`. Say up front that the ticket grew from 3 to **about 5 points**: Part 2 (scheduling a session on an existing project) was folded in because without it an inquiry, quote and deposit project could never reach `booked`. Then a few "what and why" bullets per change (mentor mode); the rulings the user should see first (outcomes are final; done and no-show only after the start, with no later limit; tattoo work only on a booked project; the order-independent work rule; moving and scheduling with the booking form's rules, never in the past; scheduling a tattoo session books a deposit-settled project at once; which statuses take new sessions; artists only their own sessions on their own projects; no migration) and the spec's status table; the declined TAT-66 carry-forwards (finishing a project, per-session deposit outcomes) as tickets for the user to file; and the spec's browser pass as a checklist. Do not push and do not open a PR.

- [ ] **Step 6: Browser pass (for the user, after the reviews)**

The spec's "Browser pass" section is the checklist (steps 1 to 15): 375 px and 1280 px, light and dark; the dev seeder makes no sessions, so book them through "Book session" first (one today at an earlier hour, one tomorrow, two for the same artist on one day), and take one inquiry project to `deposit_pending` for the Part 2 steps. If you run a dev server for it, use `PORT=3401`, stop it by its exact PID afterwards, and never touch port 3333.
