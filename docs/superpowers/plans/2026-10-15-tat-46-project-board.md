# Project board and lifecycle (TAT-46 part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A projects list with status filters, the manual status moves (hold, resume, decline, client withdrew), notes, "last contacted", owner-only artist assignment and a Projects nav item, on top of TAT-64's project page.

**Architecture:** A pure moves table (`app/modules/projects/moves.ts`) drives one locked `ProjectService.move` and the page's buttons. `ProjectService` also gains `assignArtist`, `updateNotes`, `markContacted`, `list` and `countByStatus`, sharing one "what may this member see" scope with `findFor`. The list reads only `tattoo_projects`; client names, artist names and the "booked, no session" check come through `ClientService.findMany`, `ArtistService.list` and a new `SessionService.projectsWithScheduledTattoo`. A read controller (`ProjectsController`: index, show) and a write controller (`ProjectChangesController`: move, notes, contacted, artist).

**Tech Stack:** AdonisJS 7, Lucid (PostgreSQL, RLS), VineJS, Luxon, Inertia + React, shadcn/ui, Tuyau `urlFor`, Japa.

**Spec:** `docs/superpowers/specs/2026-10-15-tat-46-project-board-design.md`

## Global Constraints

- No migration (the `artist_id`, `notes` (string 4000) and `last_contacted_at` columns exist). No API, SDK or OpenAPI changes.
- Manual moves, exactly: `hold` quoted → on_hold; `resume` on_hold → quoted; `decline` reviewing → declined; `withdraw` reviewing, quoted, on_hold, deposit_pending → cancelled, cancelling the project's `scheduled` sessions first. Anything else: `ProjectRuleError("move_not_allowed")`.
- Active = every status except `declined`, `cancelled`, `completed` (so `healing_check` is active). Closed = those three.
- Visibility everywhere (`findFor`, `list`, `countByStatus`): owners see every live project; an artist only projects whose `artist_id` is their own live profile; an artist without a profile sees none.
- `assignArtist` is owners only; anyone else gets E_ROW_NOT_FOUND (404). Sessions keep their own artist.
- 25 projects per page. Active and single-status filters sort `last_contacted_at` nulls first, then oldest, then `created_at`, then `id`; `closed` sorts `coalesce(updated_at, created_at)` newest first, then `id`.
- Flash texts, verbatim: "Put on hold.", "Back to quoted.", "Project declined.", "Client withdrew: project cancelled.", "Notes saved.", "Marked as contacted.", "Artist assigned.", "Artist removed."; refusal: "This project can't make that change in its current status.".
- Contact text, verbatim: "never contacted", "contacted today", "contacted yesterday", "contacted N days ago", calendar days in the tenant's timezone.
- `@inject()` dependencies are value imports with the `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.` comment. Every query is scoped by `tenant_id`.
- Commands run from `apps/platform` unless stated; tests use `PORT=3402`. A RED step for a missing module hangs the Japa runner after the error: run it as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts` (exit 124 plus "Cannot find module" is the expected RED). Several specs together: repeated `--files=` flags. Don't wrap test commands in `sh -c` (the harness blocks it).
- Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder.

## Review Focus

1. A move posted from a stale page (the project was cancelled by expiry or another tab meanwhile): a flash refusal and an unchanged project, never a 500. (Task 7.)
2. Notes that are whitespace only or longer than 4,000 characters: whitespace clears to null; too long is a field error, nothing saved. (Tasks 4 and 7.)
3. An artist whose own profile was deleted while projects were assigned to it: they see no projects and get 404s, rather than seeing everything or erroring. (Task 5.)
4. A list URL with a page past the end or a junk page/status (`?page=99`, `?page=abc`, `?status=bogus`): an empty page or the Active view, never an error. (Task 6.)
5. An owner sending another tenant's artist id to the assign route: a 404 and an unchanged project. (Task 4.)

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-46-inquiry-inbox-project-board-lifecycle-part-1` (from main daab8fb, with the spec and this plan committed): `git status -sb` shows it and a clean tree.
- [ ] Baseline: `cd apps/platform && PORT=3402 pnpm test functional --files=project_service.spec.ts --files=project_page.spec.ts --files=quotes_http.spec.ts`. Expected: PASS.
- [ ] Linear: set TAT-46 to In Progress.

---

### Task 1: Moves table, filters and contact text

Pure helpers. No database.

**Files:**
- Create: `apps/platform/app/modules/projects/moves.ts`
- Create: `apps/platform/app/modules/projects/contact.ts`
- Test: `apps/platform/tests/unit/modules/projects/moves.spec.ts`

**Interfaces:**
- Consumes: `PROJECT_STATUSES`, `ProjectStatus` (`#modules/projects/models/tattoo_project`).
- Produces:
  - `MANUAL_MOVE_NAMES` (`["hold", "resume", "decline", "withdraw"]`), `type ManualMove`, `type MoveRule = { from: readonly ProjectStatus[]; to: ProjectStatus; cancelsSessions: boolean }`, `MANUAL_MOVES: Record<ManualMove, MoveRule>`
  - `allowedMoves(status: ProjectStatus): ManualMove[]`
  - `CLOSED_STATUSES`, `ACTIVE_STATUSES: readonly ProjectStatus[]`
  - `type ProjectFilter = "active" | "closed" | ProjectStatus`, `toProjectFilter(value: unknown): ProjectFilter`
  - `contactedText(at: DateTime | null, timezone: string, now?: DateTime): string` (in `contact.ts`)

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/projects/moves.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { contactedText } from "#modules/projects/contact";
import {
	type ProjectStatus,
	PROJECT_STATUSES,
} from "#modules/projects/models/tattoo_project";
import {
	ACTIVE_STATUSES,
	allowedMoves,
	CLOSED_STATUSES,
	MANUAL_MOVES,
	toProjectFilter,
} from "#modules/projects/moves";

const KTM = "Asia/Kathmandu";

test.group("Manual moves", () => {
	test("follow the project rules", ({ assert }) => {
		assert.deepEqual(MANUAL_MOVES, {
			hold: { from: ["quoted"], to: "on_hold", cancelsSessions: false },
			resume: { from: ["on_hold"], to: "quoted", cancelsSessions: false },
			decline: { from: ["reviewing"], to: "declined", cancelsSessions: false },
			withdraw: {
				from: ["reviewing", "quoted", "on_hold", "deposit_pending"],
				to: "cancelled",
				cancelsSessions: true,
			},
		});
	});

	test("allowedMoves lists the moves each status can make", ({ assert }) => {
		const expected: Record<ProjectStatus, string[]> = {
			reviewing: ["decline", "withdraw"],
			quoted: ["hold", "withdraw"],
			on_hold: ["resume", "withdraw"],
			deposit_pending: ["withdraw"],
			booked: [],
			in_progress: [],
			completed: [],
			healing_check: [],
			declined: [],
			cancelled: [],
		};
		for (const status of PROJECT_STATUSES) {
			assert.deepEqual(allowedMoves(status), expected[status], status);
		}
	});

	test("active and closed split the statuses with no overlap", ({ assert }) => {
		assert.deepEqual([...CLOSED_STATUSES], ["declined", "cancelled", "completed"]);
		assert.deepEqual(
			[...ACTIVE_STATUSES],
			[
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
				"booked",
				"in_progress",
				"healing_check",
			],
		);
		assert.sameMembers(
			[...ACTIVE_STATUSES, ...CLOSED_STATUSES],
			[...PROJECT_STATUSES],
		);
	});

	test("toProjectFilter keeps known filters and falls back to active", ({
		assert,
	}) => {
		assert.equal(toProjectFilter("active"), "active");
		assert.equal(toProjectFilter("closed"), "closed");
		assert.equal(toProjectFilter("quoted"), "quoted");
		assert.equal(toProjectFilter("declined"), "declined");
		for (const junk of ["bogus", "", undefined, null, 3, ["quoted"]]) {
			assert.equal(toProjectFilter(junk), "active", String(junk));
		}
	});
});

test.group("contactedText", () => {
	// 10:00 on 15 Oct in Kathmandu (UTC+5:45).
	const now = DateTime.fromISO("2026-10-15T10:00:00", { zone: KTM });

	test("counts calendar days in the studio's timezone", ({ assert }) => {
		assert.equal(contactedText(null, KTM, now), "never contacted");
		assert.equal(
			contactedText(now.set({ hour: 1 }), KTM, now),
			"contacted today",
		);
		// Late yesterday is "yesterday", although it was under 24 hours ago.
		assert.equal(
			contactedText(now.minus({ days: 1 }).set({ hour: 23 }), KTM, now),
			"contacted yesterday",
		);
		assert.equal(
			contactedText(now.minus({ days: 3 }), KTM, now),
			"contacted 3 days ago",
		);
		assert.equal(
			contactedText(now.plus({ hours: 1 }), KTM, now),
			"contacted today",
			"a slightly fast clock is still today",
		);
	});

	test("depends on the timezone", ({ assert }) => {
		// 20:00 UTC on 14 Oct is 01:45 on 15 Oct in Kathmandu.
		const at = DateTime.fromISO("2026-10-14T20:00:00Z");
		assert.equal(contactedText(at, KTM, now), "contacted today");
		assert.equal(contactedText(at, "UTC", now), "contacted yesterday");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=moves.spec.ts`
Expected: exit 124 after "Cannot find module ... contact.js" (or moves.js).

- [ ] **Step 3: Write the helpers**

Create `apps/platform/app/modules/projects/moves.ts`:

```ts
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";

/**
 * The status changes staff make by hand (TAT-46). Quotes, sessions and
 * expiry make the others, in their own services.
 */
export const MANUAL_MOVE_NAMES = [
	"hold",
	"resume",
	"decline",
	"withdraw",
] as const;
export type ManualMove = (typeof MANUAL_MOVE_NAMES)[number];

export type MoveRule = {
	/** The statuses the move is allowed from. */
	from: readonly ProjectStatus[];
	to: ProjectStatus;
	/** Whether the project's scheduled sessions are cancelled first. */
	cancelsSessions: boolean;
};

/**
 * The manual moves, from the project rules in docs/requirements.md:
 * quoted ⇄ on_hold, reviewing → declined, and a client withdrawing before
 * booking. Withdrawing after booking waits for TAT-66, which records what
 * happens to the deposit.
 */
export const MANUAL_MOVES: Record<ManualMove, MoveRule> = {
	hold: { from: ["quoted"], to: "on_hold", cancelsSessions: false },
	resume: { from: ["on_hold"], to: "quoted", cancelsSessions: false },
	decline: { from: ["reviewing"], to: "declined", cancelsSessions: false },
	withdraw: {
		from: ["reviewing", "quoted", "on_hold", "deposit_pending"],
		to: "cancelled",
		cancelsSessions: true,
	},
};

/** The manual moves a project in `status` can make, in the table's order. */
export function allowedMoves(status: ProjectStatus): ManualMove[] {
	return MANUAL_MOVE_NAMES.filter((move) =>
		MANUAL_MOVES[move].from.includes(status),
	);
}

/** Finished one way or another: out of the board's Active view. */
export const CLOSED_STATUSES: readonly ProjectStatus[] = [
	"declined",
	"cancelled",
	"completed",
];

/** Everything else, `healing_check` included: it still needs a follow-up. */
export const ACTIVE_STATUSES: readonly ProjectStatus[] =
	PROJECT_STATUSES.filter((status) => !CLOSED_STATUSES.includes(status));

/** What the projects list shows: the Active view, the Closed view or one status. */
export type ProjectFilter = "active" | "closed" | ProjectStatus;

/** A filter from the query string; anything unknown is the Active view. */
export function toProjectFilter(value: unknown): ProjectFilter {
	if (value === "active" || value === "closed") return value;
	const status = PROJECT_STATUSES.find((known) => known === value);
	return status ?? "active";
}
```

Create `apps/platform/app/modules/projects/contact.ts`:

```ts
import { DateTime } from "luxon";

/**
 * When the client was last contacted, for people: "contacted today",
 * "contacted yesterday", "contacted 3 days ago" or "never contacted",
 * counting calendar days in the studio's timezone.
 */
export function contactedText(
	at: DateTime | null,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	if (!at) return "never contacted";
	const days = Math.round(
		now
			.setZone(timezone)
			.startOf("day")
			.diff(at.setZone(timezone).startOf("day"), "days").days,
	);
	if (days <= 0) return "contacted today";
	if (days === 1) return "contacted yesterday";
	return `contacted ${days} days ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=moves.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/moves.ts app/modules/projects/contact.ts tests/unit/modules/projects/moves.spec.ts
git commit -m "feat(platform): add the manual project moves and the contact text"
```

---

### Task 2: Batched reads for the list

**Files:**
- Modify: `apps/platform/app/modules/clients/services/client_service.ts`
- Modify: `apps/platform/app/modules/scheduling/services/session_service.ts`
- Test: `apps/platform/tests/functional/clients/client_service.spec.ts`
- Test: `apps/platform/tests/functional/scheduling/scheduled_tattoo_projects.spec.ts`

**Interfaces:**
- Consumes: `Client`, `ProjectSession` models; `makeClient`, `makeProject`, `makeArtist`, `makeSession` (`#tests/helpers/pipeline`).
- Produces:
  - `ClientService.findMany(tenant: TenantRef, ids: string[]): Promise<Client[]>` (live clients among `ids`; `[]` without a query for no ids)
  - `SessionService.projectsWithScheduledTattoo(tenant: TenantRef, projectIds: string[]): Promise<Set<string>>`

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/clients/client_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ClientService from "#modules/clients/services/client_service";
import { makeClient } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const clients = new ClientService();

test.group("ClientService.findMany", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("returns the tenant's live clients among the ids", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant, { name: "Sita" });
			const ram = await makeClient(tenant, { name: "Ram" });
			const gone = await makeClient(tenant, { name: "Gone" });
			await makeClient(tenant, { name: "Not asked for" });
			await gone.softDelete();

			const found = await clients.findMany(tenant, [sita.id, ram.id, gone.id]);
			assert.sameMembers(
				found.map(({ name }) => name),
				["Sita", "Ram"],
			);
			assert.deepEqual(await clients.findMany(tenant, []), []);
		});
	});

	test("another tenant's ids find nothing", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(a, () => makeClient(a));

		assert.deepEqual(
			await inTenant(b, () => clients.findMany(b, [theirs.id])),
			[],
		);
	});
});
```

Create `apps/platform/tests/functional/scheduling/scheduled_tattoo_projects.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
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

test.group("SessionService.projectsWithScheduledTattoo", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("finds the projects with a scheduled tattoo session", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const artist = await makeArtist(tenant);
			const withTattoo = await makeProject(tenant, client, { status: "booked" });
			const consultOnly = await makeProject(tenant, client, {
				status: "booked",
			});
			const cancelled = await makeProject(tenant, client, { status: "booked" });
			const none = await makeProject(tenant, client, { status: "booked" });

			await makeSession(tenant, withTattoo, artist);
			await makeSession(tenant, consultOnly, artist, {
				kind: "consultation",
				startsAt: DateTime.utc(2026, 11, 3, 10),
				endsAt: DateTime.utc(2026, 11, 3, 11),
			});
			await makeSession(tenant, cancelled, artist, {
				status: "cancelled",
				startsAt: DateTime.utc(2026, 11, 4, 10),
				endsAt: DateTime.utc(2026, 11, 4, 12),
			});

			const found = await sessions.projectsWithScheduledTattoo(tenant, [
				withTattoo.id,
				consultOnly.id,
				cancelled.id,
				none.id,
			]);
			assert.deepEqual([...found], [withTattoo.id]);
			assert.equal(
				(await sessions.projectsWithScheduledTattoo(tenant, [])).size,
				0,
			);
		});
	});

	test("another tenant's projects are never found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const project = await inTenant(a, async () => {
			const project = await makeProject(a, await makeClient(a), {
				status: "booked",
			});
			await makeSession(a, project, await makeArtist(a));
			return project;
		});

		const found = await inTenant(b, () =>
			sessions.projectsWithScheduledTattoo(b, [project.id]),
		);
		assert.equal(found.size, 0);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=client_service.spec.ts --files=scheduled_tattoo_projects.spec.ts`
Expected: FAIL with `clients.findMany is not a function` and `sessions.projectsWithScheduledTattoo is not a function`.

- [ ] **Step 3: Add the two methods**

In `apps/platform/app/modules/clients/services/client_service.ts`, add inside the class, after `find`:

```ts
	/**
	 * The tenant's live clients among `ids`, in no particular order (a page
	 * of the projects list looks up its client names in one query).
	 */
	async findMany(tenant: TenantRef, ids: string[]): Promise<Client[]> {
		if (ids.length === 0) return [];
		return Client.query().where("tenant_id", tenant.id).whereIn("id", ids);
	}
```

In `apps/platform/app/modules/scheduling/services/session_service.ts`, add inside the class, after `listForProject`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=client_service.spec.ts --files=scheduled_tattoo_projects.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/modules/clients/services/client_service.ts app/modules/scheduling/services/session_service.ts tests/functional/clients/client_service.spec.ts tests/functional/scheduling/scheduled_tattoo_projects.spec.ts
git commit -m "feat(platform): look up clients and booked sessions for a page of projects"
```

---

### Task 3: `ProjectService.move`

**Files:**
- Modify: `apps/platform/app/modules/projects/errors.ts`
- Modify: `apps/platform/app/modules/projects/services/project_service.ts`
- Modify: `apps/platform/tests/functional/projects/project_service.spec.ts`

**Interfaces:**
- Consumes: `MANUAL_MOVES`, `MANUAL_MOVE_NAMES`, `ManualMove` (Task 1); `SessionService.listForProject`, `SessionService.cancel`.
- Produces:
  - `PROJECT_RULE_REASONS` (`["move_not_allowed"]`), `type ProjectRuleReason`, `class ProjectRuleError { reason }`
  - `ProjectService.move(tenant: TenantRef, project: TattooProject, move: ManualMove): Promise<ProjectStatus>`
  - private `cancelScheduledSessions(tenant, project)` (shared with `expireQuote`)

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/projects/project_service.spec.ts`, add these imports:

```ts
import { ProjectRuleError } from "#modules/projects/errors";
import { PROJECT_STATUSES } from "#modules/projects/models/tattoo_project";
import { MANUAL_MOVE_NAMES, type ManualMove } from "#modules/projects/moves";
```

(`PROJECT_STATUSES` joins the existing `tattoo_project` import: make it `import TattooProject, { PROJECT_STATUSES, type ProjectStatus } from "#modules/projects/models/tattoo_project";`.)

Add below `reasonOf`:

```ts
/** The ProjectRuleError reason `work` throws, or null if it succeeds. */
async function refusalOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof ProjectRuleError) return error.reason;
		throw error;
	}
}

/** The project rules' manual moves, written out apart from moves.ts. */
const EXPECTED_FROM: Record<ManualMove, ProjectStatus[]> = {
	hold: ["quoted"],
	resume: ["on_hold"],
	decline: ["reviewing"],
	withdraw: ["reviewing", "quoted", "on_hold", "deposit_pending"],
};
const EXPECTED_TO: Record<ManualMove, ProjectStatus> = {
	hold: "on_hold",
	resume: "quoted",
	decline: "declined",
	withdraw: "cancelled",
};
```

Add this group at the end of the file:

```ts
test.group("ProjectService.move", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("every manual move works from exactly its allowed statuses", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const move of MANUAL_MOVE_NAMES) {
				for (const status of PROJECT_STATUSES) {
					const project = await makeProject(tenant, client, { status });
					const label = `${move} from ${status}`;
					if (EXPECTED_FROM[move].includes(status)) {
						assert.equal(
							await projects.move(tenant, project, move),
							EXPECTED_TO[move],
							label,
						);
						assert.equal(await statusOf(project), EXPECTED_TO[move], label);
					} else {
						assert.equal(
							await refusalOf(() => projects.move(tenant, project, move)),
							"move_not_allowed",
							label,
						);
						assert.equal(await statusOf(project), status, label);
					}
				}
			}
		});
	});

	test("a withdrawal cancels the scheduled sessions and keeps the others", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
			});
			const artist = await makeArtist(tenant);
			const held = await makeSession(tenant, project, artist);
			const done = await makeSession(tenant, project, artist, {
				kind: "consultation",
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 11),
			});

			assert.equal(
				await projects.move(tenant, project, "withdraw"),
				"cancelled",
			);
			await held.refresh();
			await done.refresh();
			assert.equal(held.status, "cancelled");
			assert.equal(done.status, "completed");
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 120 pnpm test functional --files=project_service.spec.ts`
Expected: FAIL: `ProjectRuleError` is not exported (the import resolves to undefined, so `instanceof` throws) or `projects.move is not a function`.

- [ ] **Step 3: Add the error**

Append to `apps/platform/app/modules/projects/errors.ts`:

```ts
export const PROJECT_RULE_REASONS = ["move_not_allowed"] as const;
export type ProjectRuleReason = (typeof PROJECT_RULE_REASONS)[number];

const PROJECT_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed: "The project's status does not allow that move",
};

/**
 * A project lifecycle rule was broken; `reason` says which. Thrown after the
 * failed savepoint has rolled back. The message is for developers; show
 * your own to the user.
 */
export class ProjectRuleError extends Error {
	constructor(readonly reason: ProjectRuleReason) {
		super(PROJECT_MESSAGES[reason]);
		this.name = "ProjectRuleError";
	}
}
```

- [ ] **Step 4: Add `move` and share the session cancelling**

In `apps/platform/app/modules/projects/services/project_service.ts`:

Change the errors import to `import { ProjectRuleError, QuoteRuleError } from "#modules/projects/errors";` and add `import { MANUAL_MOVES, type ManualMove } from "#modules/projects/moves";`.

Add this method after `acceptQuote`:

```ts
	/**
	 * A manual move (TAT-46): hold, resume, decline or the client withdrew.
	 * The project's live status must be one the moves table allows, else
	 * ProjectRuleError "move_not_allowed" (a stale page, or another tab got
	 * there first). A withdrawal cancels the project's scheduled sessions
	 * first, so the artist's time is free. Returns the new status.
	 */
	async move(
		tenant: TenantRef,
		project: TattooProject,
		move: ManualMove,
	): Promise<ProjectStatus> {
		assertProjectOf(tenant, project);
		const rule = MANUAL_MOVES[move];
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			if (!rule.from.includes(live.status)) {
				throw new ProjectRuleError("move_not_allowed");
			}
			if (rule.cancelsSessions) {
				await this.cancelScheduledSessions(tenant, live);
			}
			await setStatus(live, rule.to);
			return rule.to;
		});
	}
```

In `expireQuote`, replace the session loop:

```ts
			for (const session of await this.sessions.listForProject(
				tenant,
				project,
			)) {
				if (session.status === "scheduled") {
					await this.sessions.cancel(tenant, session);
				}
			}
```

with:

```ts
			await this.cancelScheduledSessions(tenant, project);
```

Add this private method at the end of the class (after `expiryCancels`):

```ts
	/**
	 * Cancels the project's scheduled sessions; completed, no-show and
	 * cancelled ones are history and stay. The caller holds the project lock.
	 */
	private async cancelScheduledSessions(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<void> {
		for (const session of await this.sessions.listForProject(
			tenant,
			project,
		)) {
			if (session.status === "scheduled") {
				await this.sessions.cancel(tenant, session);
			}
		}
	}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: PASS (the earlier groups unchanged, plus 2).

- [ ] **Step 6: Commit**

```bash
git add app/modules/projects/errors.ts app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts
git commit -m "feat(platform): make the manual project moves"
```

---

### Task 4: Artist assignment, notes and contact time

**Files:**
- Modify: `apps/platform/app/modules/projects/services/project_service.ts`
- Modify: `apps/platform/tests/functional/projects/project_service.spec.ts`

**Interfaces:**
- Consumes: `ArtistService.findFor(tenant, id)` (404 for unknown, deleted or another tenant's), `Member` (this file).
- Produces:
  - `ProjectService.assignArtist(tenant: TenantRef, member: Member, project: TattooProject, artistId: string | null): Promise<void>`
  - `ProjectService.updateNotes(tenant: TenantRef, project: TattooProject, notes: string | null): Promise<void>`
  - `ProjectService.markContacted(tenant: TenantRef, project: TattooProject): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Add this group at the end of `apps/platform/tests/functional/projects/project_service.spec.ts`:

```ts
test.group("ProjectService artist, notes and contact", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const reload = (project: TattooProject) =>
		TattooProject.findOrFail(project.id);

	test("an owner assigns and unassigns an artist; sessions keep theirs", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const asha = await makeArtist(tenant, "asha");
			const ram = await makeArtist(tenant, "ram");
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: asha.id,
			});
			const session = await makeSession(tenant, project, asha);

			await projects.assignArtist(tenant, member, project, ram.id);
			assert.equal((await reload(project)).artistId, ram.id);
			await session.refresh();
			assert.equal(session.artistId, asha.id);

			await projects.assignArtist(tenant, member, project, null);
			assert.isNull((await reload(project)).artistId);
		});
	});

	test("an artist member can't assign artists", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: mine.id,
			});

			await assert.rejects(
				() =>
					projects.assignArtist(
						tenant,
						{ userId: user.id, role: "artist" },
						project,
						null,
					),
				/Row not found/,
			);
			assert.equal((await reload(project)).artistId, mine.id);
		});
	});

	test("an unknown, deleted or other tenant's artist can't be assigned", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const member = { userId: owner.id, role: "owner" as const };
		const theirs = await inTenant(other, () => makeArtist(other, "theirs"));

		await inTenant(tenant, async () => {
			const gone = await makeArtist(tenant, "gone");
			await gone.softDelete();
			const project = await makeProject(tenant, await makeClient(tenant));

			for (const artistId of [randomUUID(), gone.id, theirs.id]) {
				await assert.rejects(
					() => projects.assignArtist(tenant, member, project, artistId),
					/Row not found/,
				);
			}
			assert.isNull((await reload(project)).artistId);
		});
	});

	test("notes are trimmed, and empty notes clear", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));

			await projects.updateNotes(tenant, project, "  Prefers mornings.  ");
			assert.equal((await reload(project)).notes, "Prefers mornings.");

			await projects.updateNotes(tenant, project, "   ");
			assert.isNull((await reload(project)).notes);

			await projects.updateNotes(tenant, project, "Again");
			await projects.updateNotes(tenant, project, null);
			assert.isNull((await reload(project)).notes);
		});
	});

	test("markContacted records the time", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const before = DateTime.now().minus({ seconds: 1 });

			await projects.markContacted(tenant, project);
			const at = (await reload(project)).lastContactedAt;
			assert.isNotNull(at);
			assert.isTrue((at as DateTime) >= before);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: FAIL with `projects.assignArtist is not a function` (and the notes/contact tests likewise).

- [ ] **Step 3: Write the three methods**

In `apps/platform/app/modules/projects/services/project_service.ts`, add the imports `import { errors as lucidErrors } from "@adonisjs/lucid";` and `import { DateTime } from "luxon";`.

Add these methods after `move`:

```ts
	/**
	 * Assigns the project's artist, or none (`artistId` null). Owners only:
	 * anyone else gets E_ROW_NOT_FOUND (a 404, like another artist's
	 * project). The artist must be one of the tenant's live profiles
	 * (ArtistService.findFor, a 404 otherwise). The project's sessions keep
	 * their own artist.
	 */
	async assignArtist(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		artistId: string | null,
	): Promise<void> {
		assertProjectOf(tenant, project);
		if (member.role !== "owner") {
			throw new lucidErrors.E_ROW_NOT_FOUND(TattooProject);
		}
		const artist =
			artistId === null ? null : await this.artists.findFor(tenant, artistId);
		await withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			live.artistId = artist?.id ?? null;
			await live.save();
		});
	}

	/** Replaces the project's notes; blank notes clear them. */
	async updateNotes(
		tenant: TenantRef,
		project: TattooProject,
		notes: string | null,
	): Promise<void> {
		assertProjectOf(tenant, project);
		const text = notes?.trim() || null;
		await withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			live.notes = text;
			await live.save();
		});
	}

	/**
	 * Records that the client was contacted now: the chat links call it as
	 * they open, and staff tap "Mark contacted" after a call or a visit.
	 */
	async markContacted(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<void> {
		assertProjectOf(tenant, project);
		await withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			live.lastContactedAt = DateTime.now();
			await live.save();
		});
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: PASS (plus 5).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts
git commit -m "feat(platform): assign a project's artist, keep notes and the contact time"
```

---

### Task 5: Listing and counting projects

**Files:**
- Modify: `apps/platform/app/modules/projects/services/project_service.ts`
- Modify: `apps/platform/tests/functional/projects/project_service.spec.ts`

**Interfaces:**
- Consumes: `ACTIVE_STATUSES`, `CLOSED_STATUSES`, `ProjectFilter` (Task 1).
- Produces:
  - `PROJECTS_PER_PAGE = 25` (exported from `project_service.ts`)
  - `ProjectService.list(tenant: TenantRef, member: Member, filter: ProjectFilter, page: number): Promise<{ projects: TattooProject[]; total: number; lastPage: number }>`
  - `ProjectService.countByStatus(tenant: TenantRef, member: Member): Promise<Partial<Record<ProjectStatus, number>>>`
  - private `scopeTo(query, tenant, member)`, now also used by `findFor`

- [ ] **Step 1: Write the failing tests**

Add the import `import { PROJECTS_PER_PAGE } from "#modules/projects/services/project_service";` (merge it into the existing default import: `import ProjectService, { PROJECTS_PER_PAGE } from "#modules/projects/services/project_service";`).

Add this group at the end of `apps/platform/tests/functional/projects/project_service.spec.ts`:

```ts
test.group("ProjectService.list and countByStatus", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const briefsOf = (list: TattooProject[]) => list.map(({ brief }) => brief);

	/** One project per status, each with its status as its brief. */
	async function oneOfEach(tenant: TenantRef) {
		const client = await makeClient(tenant);
		for (const status of PROJECT_STATUSES) {
			await makeProject(tenant, client, { status, brief: status });
		}
	}

	test("filters by active, closed or one status", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			await oneOfEach(tenant);

			const active = await projects.list(tenant, member, "active", 1);
			assert.sameMembers(briefsOf(active.projects), [
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
				"booked",
				"in_progress",
				"healing_check",
			]);
			const closed = await projects.list(tenant, member, "closed", 1);
			assert.sameMembers(briefsOf(closed.projects), [
				"declined",
				"cancelled",
				"completed",
			]);
			const quoted = await projects.list(tenant, member, "quoted", 1);
			assert.deepEqual(briefsOf(quoted.projects), ["quoted"]);
		});
	});

	test("active sorts for follow-up; closed sorts newest first", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await makeProject(tenant, client, {
				brief: "1 day ago",
				lastContactedAt: DateTime.utc().minus({ days: 1 }),
			});
			await makeProject(tenant, client, { brief: "never, first" });
			await makeProject(tenant, client, {
				brief: "5 days ago",
				lastContactedAt: DateTime.utc().minus({ days: 5 }),
			});
			await makeProject(tenant, client, { brief: "never, second" });

			const active = await projects.list(tenant, member, "active", 1);
			assert.deepEqual(briefsOf(active.projects), [
				"never, first",
				"never, second",
				"5 days ago",
				"1 day ago",
			]);

			const old = await makeProject(tenant, client, {
				status: "declined",
				brief: "closed long ago",
			});
			const recent = await makeProject(tenant, client, {
				status: "cancelled",
				brief: "closed recently",
			});
			await TattooProject.query()
				.where("id", old.id)
				.update({ updated_at: DateTime.utc().minus({ days: 10 }).toISO() });
			await TattooProject.query()
				.where("id", recent.id)
				.update({ updated_at: DateTime.utc().minus({ days: 1 }).toISO() });

			const closed = await projects.list(tenant, member, "closed", 1);
			assert.deepEqual(briefsOf(closed.projects), [
				"closed recently",
				"closed long ago",
			]);
		});
	});

	test("pages of 25", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (let i = 0; i < PROJECTS_PER_PAGE + 1; i++) {
				await makeProject(tenant, client);
			}

			const first = await projects.list(tenant, member, "active", 1);
			assert.lengthOf(first.projects, PROJECTS_PER_PAGE);
			assert.equal(first.total, PROJECTS_PER_PAGE + 1);
			assert.equal(first.lastPage, 2);
			assert.lengthOf(
				(await projects.list(tenant, member, "active", 2)).projects,
				1,
			);
			assert.lengthOf(
				(await projects.list(tenant, member, "active", 99)).projects,
				0,
			);
		});
	});

	test("an artist lists and counts only their own projects", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const client = await makeClient(tenant);
			await makeProject(tenant, client, { artistId: mine.id, brief: "mine" });
			await makeProject(tenant, client, {
				artistId: mine.id,
				status: "quoted",
				brief: "mine quoted",
			});
			await makeProject(tenant, client, { brief: "unassigned" });

			const asha = { userId: user.id, role: "artist" as const };
			assert.sameMembers(
				briefsOf((await projects.list(tenant, asha, "active", 1)).projects),
				["mine", "mine quoted"],
			);
			assert.deepEqual(await projects.countByStatus(tenant, asha), {
				reviewing: 1,
				quoted: 1,
			});

			// No profile of their own: nothing.
			const ram = { userId: stranger.id, role: "artist" as const };
			assert.lengthOf(
				(await projects.list(tenant, ram, "active", 1)).projects,
				0,
			);
			assert.deepEqual(await projects.countByStatus(tenant, ram), {});

			// Their profile deleted: nothing either.
			await mine.softDelete();
			assert.lengthOf(
				(await projects.list(tenant, asha, "active", 1)).projects,
				0,
			);
		});
	});

	test("an owner counts every live project by status", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			await oneOfEach(tenant);
			const extra = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const gone = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await gone.softDelete();

			const counts = await projects.countByStatus(tenant, member);
			assert.equal(counts.quoted, 2, `${extra.id} counted, the deleted one not`);
			assert.equal(counts.reviewing, 1);
			assert.equal(counts.completed, 1);
		});
	});

	test("another tenant lists and counts nothing", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		await inTenant(a, () => oneOfEach(a));
		const member = { userId: ownerB.id, role: "owner" as const };

		await inTenant(b, async () => {
			assert.lengthOf(
				(await projects.list(b, member, "active", 1)).projects,
				0,
			);
			assert.deepEqual(await projects.countByStatus(b, member), {});
		});
	});
});
```

`makeProject` must accept `brief` and `lastContactedAt` overrides: check `ProjectOver` in `tests/helpers/pipeline.ts`; if either is missing from its `Pick<TattooProject, …>`, add it there (test helper only).

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: FAIL with `projects.list is not a function` (and `countByStatus`), and `PROJECTS_PER_PAGE` undefined.

- [ ] **Step 3: Share the scope and add list and count**

In `apps/platform/app/modules/projects/services/project_service.ts`, add the import `import { ACTIVE_STATUSES, CLOSED_STATUSES, MANUAL_MOVES, type ManualMove, type ProjectFilter } from "#modules/projects/moves";` (replacing Task 3's narrower moves import).

Add below `export type Member = …`:

```ts
/** Projects per page on the projects list. */
export const PROJECTS_PER_PAGE = 25;

type ProjectQuery = ReturnType<typeof TattooProject.query>;
```

Replace the body of `findFor`:

```ts
		const query = TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", id);
		if (member.role !== "owner") {
			const profiles = await this.artists.list(tenant);
			const mine = profiles.find(({ userId }) => userId === member.userId);
			// No profile of their own: no project is theirs.
			if (mine) query.where("artist_id", mine.id);
			else query.whereRaw("false");
		}
		return query.firstOrFail();
```

with:

```ts
		const query = TattooProject.query().where("id", id);
		await this.scopeTo(query, tenant, member);
		return query.firstOrFail();
```

Add these methods after `findFor`:

```ts
	/**
	 * A page of the projects `member` may see (the `findFor` rule), for the
	 * Active view, the Closed view or one status. Active and single-status
	 * views sort for follow-up: never contacted first, then the longest
	 * since contact; the Closed view sorts the most recently changed first.
	 */
	async list(
		tenant: TenantRef,
		member: Member,
		filter: ProjectFilter,
		page: number,
	): Promise<{ projects: TattooProject[]; total: number; lastPage: number }> {
		const query = TattooProject.query();
		await this.scopeTo(query, tenant, member);
		if (filter === "active") query.whereIn("status", [...ACTIVE_STATUSES]);
		else if (filter === "closed") query.whereIn("status", [...CLOSED_STATUSES]);
		else query.where("status", filter);

		if (filter === "closed") {
			query
				.orderByRaw("coalesce(updated_at, created_at) desc")
				.orderBy("id", "desc");
		} else {
			query
				.orderByRaw("last_contacted_at asc nulls first")
				.orderBy("created_at", "asc")
				.orderBy("id", "asc");
		}
		const result = await query.paginate(page, PROJECTS_PER_PAGE);
		return {
			projects: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** How many live projects `member` may see, per status. */
	async countByStatus(
		tenant: TenantRef,
		member: Member,
	): Promise<Partial<Record<ProjectStatus, number>>> {
		const query = TattooProject.query();
		await this.scopeTo(query, tenant, member);
		const rows = await query
			.select("status")
			.count("* as total")
			.groupBy("status");
		return Object.fromEntries(
			rows.map((row) => [row.status, Number(row.$extras.total)]),
		);
	}
```

Add this private method at the end of the class:

```ts
	/**
	 * Narrows a projects query to the tenant and to what `member` may see:
	 * everything for an owner, else only the projects assigned to their own
	 * live artist profile (none without one).
	 */
	private async scopeTo(
		query: ProjectQuery,
		tenant: TenantRef,
		member: Member,
	): Promise<void> {
		query.where("tenant_id", tenant.id);
		if (member.role === "owner") return;
		const profiles = await this.artists.list(tenant);
		const mine = profiles.find(({ userId }) => userId === member.userId);
		if (mine) query.where("artist_id", mine.id);
		else query.whereRaw("false");
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts --files=project_page.spec.ts --files=quotes_http.spec.ts`
Expected: PASS (the `findFor` tests still pass through the shared scope; plus 6). Then `pnpm typecheck`: clean (if `ReturnType<typeof TattooProject.query>` doesn't accept the chained calls, type it as `ModelQueryBuilderContract<typeof TattooProject>` from `@adonisjs/lucid/types/model`).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts tests/helpers/pipeline.ts
git commit -m "feat(platform): list and count the projects a member may see"
```

---

### Task 6: The projects list page and navigation

**Files:**
- Modify: `apps/platform/app/controllers/projects_controller.ts`
- Create: `apps/platform/inertia/pages/projects/index.tsx`
- Modify: `apps/platform/inertia/components/projects.ts`
- Modify: `apps/platform/inertia/layouts/app.tsx`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`
- Regenerate: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/projects/projects_list.spec.ts`

**Interfaces:**
- Consumes: `ProjectService.list`, `countByStatus` (Task 5), `toProjectFilter`, `ACTIVE_STATUSES`, `CLOSED_STATUSES` (Task 1), `contactedText` (Task 1), `ClientService.findMany`, `SessionService.projectsWithScheduledTattoo` (Task 2), `ArtistService.list`.
- Produces:
  - Route `GET /t/:tenant/projects` named `tenant.projects.index`.
  - Page `projects/index` with props `ProjectListProps = { filter: string; counts: { active: number; closed: number; byStatus: Record<string, number> }; projects: ProjectRow[]; page: { current: number; last: number; total: number } }`, `ProjectRow = { id: string; clientName: string | null; artistName: string | null; status: string; contactedText: string; noSession: boolean }`.
  - `ProjectsController` now takes `SessionService` too (Task 8 uses it in `show`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/projects/projects_list.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const list = (query = "") => `/t/black-needle/projects${query}`;

type Row = { clientName: string; status: string; noSession: boolean };

test.group("Projects list", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the active projects with their details and counts", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant, "asha");
			const sita = await makeClient(tenant, { name: "Sita Rai" });
			const ram = await makeClient(tenant, { name: "Ram Thapa" });
			const maya = await makeClient(tenant, { name: "Maya Gurung" });
			await makeProject(tenant, sita, {
				status: "quoted",
				artistId: artist.id,
				lastContactedAt: DateTime.now().minus({ days: 2 }),
			});
			const booked = await makeProject(tenant, ram, { status: "booked" });
			await makeProject(tenant, maya, { status: "booked" });
			await makeSession(tenant, booked, artist);
			await makeProject(tenant, maya, { status: "declined" });
		});

		const response = await client.get(list()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("projects/index");
		const props = response.inertiaProps;
		assert.equal(props.filter, "active");
		assert.deepEqual(props.counts.active, 3);
		assert.deepEqual(props.counts.closed, 1);
		assert.equal(props.counts.byStatus.booked, 2);
		assert.equal(props.counts.byStatus.on_hold, 0);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 3 });

		const rows = props.projects as (Row & {
			artistName: string | null;
			contactedText: string;
		})[];
		const sitaRow = rows.find(({ clientName }) => clientName === "Sita Rai");
		assert.deepInclude(sitaRow, {
			status: "quoted",
			artistName: "Sita",
			contactedText: "contacted 2 days ago",
			noSession: false,
		});
		const bookedRows = rows.filter(({ status }) => status === "booked");
		assert.sameDeepMembers(
			bookedRows.map(({ clientName, noSession }) => ({ clientName, noSession })),
			[
				{ clientName: "Ram Thapa", noSession: false },
				{ clientName: "Maya Gurung", noSession: true },
			],
		);
		assert.equal(
			rows.find(({ clientName }) => clientName === "Maya Gurung")?.status,
			"booked",
		);
	});

	test("filters by closed or one status; junk falls back to active", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeProject(tenant, customer, { status: "quoted" });
			await makeProject(tenant, customer, { status: "cancelled" });
		});
		const statuses = async (query: string) => {
			const props = (
				await client.get(list(query)).withInertia().loginAs(owner)
			).inertiaProps;
			return {
				filter: props.filter,
				statuses: (props.projects as Row[]).map(({ status }) => status),
			};
		};

		assert.deepEqual(await statuses("?status=closed"), {
			filter: "closed",
			statuses: ["cancelled"],
		});
		assert.deepEqual(await statuses("?status=quoted"), {
			filter: "quoted",
			statuses: ["quoted"],
		});
		assert.deepEqual(await statuses("?status=bogus&page=abc"), {
			filter: "active",
			statuses: ["quoted"],
		});
		assert.deepEqual(await statuses("?page=99"), {
			filter: "active",
			statuses: [],
		});
	});

	test("an artist sees only their own projects", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const customer = await makeClient(tenant, { name: "Theirs" });
			const other = await makeClient(tenant, { name: "Not theirs" });
			await makeProject(tenant, customer, { artistId: profile.id });
			await makeProject(tenant, other);
		});

		const props = (await client.get(list()).withInertia().loginAs(asha))
			.inertiaProps;
		assert.deepEqual(
			(props.projects as Row[]).map(({ clientName }) => clientName),
			["Theirs"],
		);
		assert.equal(props.counts.active, 1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=projects_list.spec.ts`
Expected: FAIL with 404s (no route; `GET /t/:tenant/projects` doesn't exist).

- [ ] **Step 3: Add the list props types**

Append to `apps/platform/inertia/components/projects.ts`:

```ts
/** One row of the projects list. */
export type ProjectRow = {
	id: string;
	clientName: string | null;
	artistName: string | null;
	status: string;
	contactedText: string;
	/** Booked, but no tattoo session is scheduled. */
	noSession: boolean;
};

export type ProjectListProps = {
	/** "active", "closed" or one status. */
	filter: string;
	counts: { active: number; closed: number; byStatus: Record<string, number> };
	projects: ProjectRow[];
	page: { current: number; last: number; total: number };
};

/** The single-status filter chips, in lifecycle order. */
export const ACTIVE_FILTERS = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
	"booked",
	"in_progress",
	"healing_check",
] as const;
```

- [ ] **Step 4: Write the list page**

Create `apps/platform/inertia/pages/projects/index.tsx`:

```tsx
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import Page from "~/components/page";
import {
	ACTIVE_FILTERS,
	type ProjectListProps,
	STATUS_LABELS,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The studio's projects, filtered by status (TAT-46). Owners see every
 * project, artists the ones assigned to them; the server decides.
 */
export default function ProjectsIndex({
	filter,
	counts,
	projects,
	page,
}: ProjectListProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.projects.index", { tenant: tenant.slug });
	const href = (status: string, pageNumber = 1) =>
		`${base}?status=${status}${pageNumber > 1 ? `&page=${pageNumber}` : ""}`;
	const chips = [
		{ value: "active", label: "Active", count: counts.active },
		...ACTIVE_FILTERS.map((status) => ({
			value: status,
			label: STATUS_LABELS[status] ?? status,
			count: counts.byStatus[status] ?? 0,
		})),
		{ value: "closed", label: "Closed", count: counts.closed },
	];

	return (
		<Page title="Projects">
			<nav aria-label="Filter projects" className="flex flex-wrap gap-2">
				{chips.map((chip) => (
					<Link
						key={chip.value}
						href={href(chip.value)}
						preserveScroll
						aria-current={chip.value === filter ? "page" : undefined}
						className={buttonVariants({
							variant: chip.value === filter ? "default" : "outline",
							size: "sm",
						})}
					>
						{chip.label}
						<span className="tabular-nums opacity-70">{chip.count}</span>
					</Link>
				))}
			</nav>

			{projects.length === 0 ? (
				<p className="text-sm text-muted-foreground">No projects here.</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border">
					{projects.map((project) => (
						<li key={project.id}>
							<Link
								href={urlFor("tenant.projects.show", {
									tenant: tenant.slug,
									id: project.id,
								})}
								className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50"
							>
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">
										{project.clientName ?? "Unknown client"}
									</span>
									<span className="flex items-center gap-2">
										{project.noSession && (
											<Badge variant="destructive">no session</Badge>
										)}
										<Badge variant="secondary">
											{STATUS_LABELS[project.status] ?? project.status}
										</Badge>
									</span>
								</span>
								<span className="text-sm text-muted-foreground">
									{project.artistName
										? `with ${project.artistName}`
										: "no artist"}{" "}
									· {project.contactedText}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link href={href(filter, page.current - 1)} preserveScroll>
							Previous
						</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link href={href(filter, page.current + 1)} preserveScroll>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

ProjectsIndex.layout = [AppLayout];
```

- [ ] **Step 5: Add `index` to ProjectsController**

In `apps/platform/app/controllers/projects_controller.ts`:

Add imports:

```ts
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import { contactedText } from "#modules/projects/contact";
import {
	ACTIVE_STATUSES,
	CLOSED_STATUSES,
	toProjectFilter,
} from "#modules/projects/moves";
```

Add `private sessions: SessionService,` as the last constructor parameter.

Add this method before `show`:

```ts
	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const query = ctx.request.qs();
		const filter = toProjectFilter(query.status);
		const page = Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1);

		const { projects, total, lastPage } = await this.projects.list(
			tenant,
			membership,
			filter,
			page,
		);
		const counts = await this.projects.countByStatus(tenant, membership);
		const clients = await this.clients.findMany(
			tenant,
			projects.map(({ clientId }) => clientId),
		);
		const artists = await this.artists.list(tenant);
		const withSession = await this.sessions.projectsWithScheduledTattoo(
			tenant,
			projects.map(({ id }) => id),
		);
		const clientName = new Map(clients.map(({ id, name }) => [id, name]));
		const artistName = new Map(artists.map(({ id, name }) => [id, name]));
		const sum = (statuses: readonly string[]) =>
			statuses.reduce(
				(total, status) =>
					total + (counts[status as keyof typeof counts] ?? 0),
				0,
			);

		return ctx.inertia.render("projects/index", {
			filter,
			counts: {
				active: sum(ACTIVE_STATUSES),
				closed: sum(CLOSED_STATUSES),
				byStatus: Object.fromEntries(
					ACTIVE_STATUSES.map((status) => [status, counts[status] ?? 0]),
				),
			},
			projects: projects.map((project) => ({
				id: project.id,
				clientName: clientName.get(project.clientId) ?? null,
				artistName: project.artistId
					? (artistName.get(project.artistId) ?? null)
					: null,
				status: project.status,
				contactedText: contactedText(project.lastContactedAt, tenant.timezone),
				noSession: project.status === "booked" && !withSession.has(project.id),
			})),
			page: { current: page, last: lastPage, total },
		});
	}
```

- [ ] **Step 6: Route, navigation, codegen and isolation case**

In `apps/platform/start/routes.ts`, inside the projects group, before the `:id` show route, add:

```ts
				router
					.get("/", [controllers.Projects, "index"])
					.as("tenant.projects.index");
```

In `apps/platform/inertia/layouts/app.tsx`, add `ClipboardList` to the `lucide-react` import and add this entry to `items` right after the Dashboard entry (inside the initial array, so every role gets it):

```tsx
		{
			label: "Projects",
			route: "tenant.projects.index",
			params,
			icon: ClipboardList,
		},
```

Run: `node ace codegen` (adds `tenant.projects.index` and the `projects/index` page type).

In `apps/platform/tests/isolation/cases.ts`, add at the end of `isolationCases`:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/projects",
		actor: "owner",
		ownStatus: 200,
		snapshot: projectRows,
	},
```

- [ ] **Step 7: Run the tests**

Run: `PORT=3402 pnpm test functional --files=projects_list.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts --files=project_page.spec.ts`
Expected: PASS. Then `pnpm typecheck`: clean (the `projects/index` props are checked against `render`).

- [ ] **Step 8: Commit**

```bash
git add app/controllers/projects_controller.ts inertia/pages/projects/index.tsx inertia/components/projects.ts inertia/layouts/app.tsx start/routes.ts tests/isolation/cases.ts tests/functional/projects/projects_list.spec.ts .adonisjs
git commit -m "feat(platform): add the projects list with status filters"
```

---

### Task 7: The write routes

**Files:**
- Create: `apps/platform/app/modules/projects/validators/project.ts`
- Create: `apps/platform/app/controllers/project_changes_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`
- Regenerate: `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/projects/project_changes.spec.ts`

**Interfaces:**
- Consumes: `ProjectService.findFor`, `move`, `assignArtist`, `updateNotes`, `markContacted` (Tasks 3 and 4), `ProjectRuleError`, `MANUAL_MOVE_NAMES`, `ManualMove`.
- Produces:
  - `moveValidator` (`{ move }`), `notesValidator` (`{ notes: string | null }`, at most 4,000), `artistValidator` (`{ artistId: uuid | null }`)
  - Routes `tenant.projects.moves.store` (POST `:id/moves`), `tenant.projects.notes.update` (PUT `:id/notes`), `tenant.projects.contacted.store` (POST `:id/contacted`), `tenant.projects.artist.update` (PUT `:id/artist`), all redirecting to `tenant.projects.show`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/projects/project_changes.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ProjectSession from "#modules/scheduling/models/project_session";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const url = (id: string, action = "") =>
	`/t/black-needle/projects/${id}${action}`;

async function projectIn(
	tenant: { id: string },
	status: ProjectStatus = "quoted",
) {
	return inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), { status }),
	);
}

const reload = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () => TattooProject.findOrFail(project.id));

test.group("Project moves", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner puts a quoted project on hold", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "hold" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", url(project.id));
		response.assertFlashMessage("success", "Put on hold.");
		assert.equal((await reload(tenant, project)).status, "on_hold");
	});

	test("a move the status doesn't allow is refused, even from a stale page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "cancelled");

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "hold" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", url(project.id));
		response.assertFlashMessage(
			"error",
			"This project can't make that change in its current status.",
		);
		assert.equal((await reload(tenant, project)).status, "cancelled");
	});

	test("an unknown move is a field error", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "complete" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "move");
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("a client withdrawing cancels the project and its sessions", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "deposit_pending");
		const session = await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "withdraw" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"Client withdrew: project cancelled.",
		);
		assert.equal((await reload(tenant, project)).status, "cancelled");
		const live = await inTenant(tenant, () =>
			ProjectSession.findOrFail(session.id),
		);
		assert.equal(live.status, "cancelled");
	});
});

test.group("Project notes, contact and artist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("notes are saved, cleared, and capped at 4,000 characters", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const send = (notes: string) =>
			client
				.put(url(project.id, "/notes"))
				.form({ notes })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const saved = await send("Prefers mornings.");
		saved.assertFlashMessage("success", "Notes saved.");
		assert.equal((await reload(tenant, project)).notes, "Prefers mornings.");

		assertValidationError(
			await send("x".repeat(4001)),
			"notes",
			"Keep notes under 4,000 characters.",
		);
		assert.equal((await reload(tenant, project)).notes, "Prefers mornings.");

		await send("");
		assert.isNull((await reload(tenant, project)).notes);
	});

	test("Mark contacted records the time", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const before = DateTime.now().minus({ seconds: 1 });

		const response = await client
			.post(url(project.id, "/contacted"))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", "Marked as contacted.");
		const at = (await reload(tenant, project)).lastContactedAt;
		assert.isTrue(at !== null && at >= before);
	});

	test("an owner assigns and removes the artist", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const artist = await inTenant(tenant, () => makeArtist(tenant, "asha"));
		const send = (artistId: string) =>
			client
				.put(url(project.id, "/artist"))
				.form({ artistId })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		(await send(artist.id)).assertFlashMessage("success", "Artist assigned.");
		assert.equal((await reload(tenant, project)).artistId, artist.id);

		(await send("")).assertFlashMessage("success", "Artist removed.");
		assert.isNull((await reload(tenant, project)).artistId);
	});

	test("artists: the assigned one can move and note, but not assign; others get 404s", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
				status: "quoted",
			});
		});

		const hold = await client
			.post(url(project.id, "/moves"))
			.form({ move: "hold" })
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		hold.assertFlashMessage("success", "Put on hold.");

		const assign = await client
			.put(url(project.id, "/artist"))
			.form({ artistId: "" })
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		assign.assertStatus(404);

		for (const [method, action, body] of [
			["post", "/moves", { move: "resume" }],
			["put", "/notes", { notes: "Hi" }],
			["post", "/contacted", {}],
		] as const) {
			const response = await client
				.request(url(project.id, action), method === "post" ? "POST" : "PUT")
				.form(body)
				.withCsrfToken()
				.loginAs(ram)
				.redirects(0);
			response.assertStatus(404);
		}
		const live = await reload(tenant, project);
		assert.equal(live.status, "on_hold");
		assert.isNotNull(live.artistId);
		assert.isNull(live.notes);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_changes.spec.ts`
Expected: FAIL with 404s (no routes).

- [ ] **Step 3: Write the validators**

Create `apps/platform/app/modules/projects/validators/project.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { MANUAL_MOVE_NAMES } from "#modules/projects/moves";

/** A manual status move from the project page. */
export const moveValidator = vine.create({
	move: vine.enum(MANUAL_MOVE_NAMES),
});
moveValidator.messagesProvider = new SimpleMessagesProvider({
	"move.required": "Choose a change.",
	"move.enum": "Choose a change.",
});

/** The project's notes; an empty box arrives as null and clears them. */
export const notesValidator = vine.create({
	notes: vine.string().trim().maxLength(4000).nullable(),
});
notesValidator.messagesProvider = new SimpleMessagesProvider({
	"notes.maxLength": "Keep notes under 4,000 characters.",
});

/** The project's artist; "No artist" arrives as null. */
export const artistValidator = vine.create({
	artistId: vine.string().uuid().nullable(),
});
artistValidator.messagesProvider = new SimpleMessagesProvider({
	"artistId.uuid": "Choose an artist from the list.",
});
```

- [ ] **Step 4: Write ProjectChangesController**

Create `apps/platform/app/controllers/project_changes_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { ProjectRuleError } from "#modules/projects/errors";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type { ManualMove } from "#modules/projects/moves";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import {
	artistValidator,
	moveValidator,
	notesValidator,
} from "#modules/projects/validators/project";

/** What each manual move tells the user when it's done. */
const MOVE_DONE: Record<ManualMove, string> = {
	hold: "Put on hold.",
	resume: "Back to quoted.",
	decline: "Project declined.",
	withdraw: "Client withdrew: project cancelled.",
};

/**
 * The project page's changes that aren't quotes: status moves, notes, the
 * contact time and the artist (TAT-46). Every :id loads through
 * ProjectService.findFor first, so another tenant's or another artist's
 * project is a 404 even with a bad body.
 */
@inject()
export default class ProjectChangesController {
	constructor(private projects: ProjectService) {}

	async move(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { move } = await ctx.request.validateUsing(moveValidator);
		try {
			await this.projects.move(tenant, project, move);
			ctx.session.flash("success", MOVE_DONE[move]);
		} catch (error) {
			if (!(error instanceof ProjectRuleError)) throw error;
			ctx.session.flash(
				"error",
				"This project can't make that change in its current status.",
			);
		}
		return backTo(ctx, tenant, project);
	}

	async notes(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { notes } = await ctx.request.validateUsing(notesValidator);
		await this.projects.updateNotes(tenant, project, notes);
		ctx.session.flash("success", "Notes saved.");
		return backTo(ctx, tenant, project);
	}

	async contacted(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		await this.projects.markContacted(tenant, project);
		ctx.session.flash("success", "Marked as contacted.");
		return backTo(ctx, tenant, project);
	}

	async artist(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { artistId } = await ctx.request.validateUsing(artistValidator);
		await this.projects.assignArtist(tenant, membership, project, artistId);
		ctx.session.flash(
			"success",
			artistId ? "Artist assigned." : "Artist removed.",
		);
		return backTo(ctx, tenant, project);
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

- [ ] **Step 5: Routes, codegen and isolation cases**

In `apps/platform/start/routes.ts`, inside the projects group, after the quote routes, add:

```ts
				router
					.post(":id/moves", [controllers.ProjectChanges, "move"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.moves.store");
				router
					.put(":id/notes", [controllers.ProjectChanges, "notes"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.notes.update");
				router
					.post(":id/contacted", [controllers.ProjectChanges, "contacted"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.contacted.store");
				router
					.put(":id/artist", [controllers.ProjectChanges, "artist"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.artist.update");
```

Run: `node ace codegen` (adds `ProjectChanges` and the four route names).

In `apps/platform/tests/isolation/cases.ts`, add at the end of `isolationCases`:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/moves",
		resource: "quotedProject",
		actor: "owner",
		body: () => ({ move: "hold" }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/projects/:id/notes",
		resource: "project",
		actor: "owner",
		body: () => ({ notes: "Called back about sizing." }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/contacted",
		resource: "project",
		actor: "owner",
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/projects/:id/artist",
		resource: "project",
		actor: "owner",
		body: (own) => ({ artistId: own.artistProfile.id }),
		ownStatus: 302,
		snapshot: projectRows,
	},
```

- [ ] **Step 6: Run the tests**

Run: `PORT=3402 pnpm test functional --files=project_changes.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts`
Expected: PASS. Then `pnpm typecheck`: clean.

- [ ] **Step 7: Commit**

```bash
git add app/modules/projects/validators/project.ts app/controllers/project_changes_controller.ts start/routes.ts tests/isolation/cases.ts tests/functional/projects/project_changes.spec.ts .adonisjs
git commit -m "feat(platform): move projects, keep notes, mark contact and assign artists"
```

---

### Task 8: The project page's new props

**Files:**
- Modify: `apps/platform/app/controllers/projects_controller.ts`
- Modify: `apps/platform/inertia/components/projects.ts`
- Modify: `apps/platform/tests/functional/projects/project_page.spec.ts`

**Interfaces:**
- Consumes: `allowedMoves` (Task 1), `contactedText` (Task 1), `SessionService.listForProject`, `ArtistService.list`.
- Produces: `ProjectPageProps` gains top-level `moves: ManualMoveName[]`, `scheduledSessionCount: number`, `bookedWithoutSession: boolean`, `notes: string | null`, `contactedText: string`, `assignment: { artistId: string | null; choices: { id: string; name: string }[] } | null` (null for artists). The existing `project` prop is unchanged.

- [ ] **Step 1: Write the failing tests**

Add this group at the end of `apps/platform/tests/functional/projects/project_page.spec.ts` (it already imports `makeArtist`, `makeClient`, `makeProject`, `artistIn`, `inTenant`, `studioWithOwner`; add `makeSession` to the pipeline import):

```ts
test.group("Project page: lifecycle props", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner gets the moves, notes, contact text and artist choices", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { project, asha } = await inTenant(tenant, async () => {
			const asha = await makeArtist(tenant, "asha");
			await makeArtist(tenant, "bina");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
				artistId: asha.id,
				notes: "Prefers mornings.",
				lastContactedAt: DateTime.now().minus({ days: 1 }),
			});
			await makeSession(tenant, project, asha, { kind: "consultation" });
			return { project, asha };
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(props.moves, ["hold", "withdraw"]);
		assert.equal(props.scheduledSessionCount, 1);
		assert.isFalse(props.bookedWithoutSession);
		assert.equal(props.notes, "Prefers mornings.");
		assert.equal(props.contactedText, "contacted yesterday");
		assert.equal(props.assignment.artistId, asha.id);
		assert.lengthOf(props.assignment.choices, 2);
		assert.deepInclude(props.assignment.choices, { id: asha.id, name: "Sita" });
	});

	test("a booked project without a tattoo session carries the warning", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "booked" }),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isTrue(props.bookedWithoutSession);
		assert.deepEqual(props.moves, []);
		assert.equal(props.contactedText, "never contacted");
	});

	test("an artist sees the moves but gets no artist choices", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				status: "reviewing",
				artistId: profile.id,
			});
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;

		assert.deepEqual(props.moves, ["decline", "withdraw"]);
		assert.isNull(props.assignment);
	});
});
```

`makeProject` must accept a `notes` override: add it to `ProjectOver` in `tests/helpers/pipeline.ts` if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts`
Expected: FAIL: `props.moves` is undefined (the earlier groups still pass).

- [ ] **Step 3: Extend the page props type**

In `apps/platform/inertia/components/projects.ts`, add to `ProjectPageProps` (after `form`):

```ts
	/** The manual moves this project can make now, in table order. */
	moves: ManualMoveName[];
	/** How many sessions a withdrawal would cancel. */
	scheduledSessionCount: number;
	/** Booked, but no tattoo session is scheduled. */
	bookedWithoutSession: boolean;
	notes: string | null;
	contactedText: string;
	/** Owners only: the project's artist and the studio's artists. */
	assignment: {
		artistId: string | null;
		choices: { id: string; name: string }[];
	} | null;
```

and above `ProjectPageProps`:

```ts
export type ManualMoveName = "hold" | "resume" | "decline" | "withdraw";

/** What each move's button says. */
export const MOVE_LABELS: Record<ManualMoveName, string> = {
	hold: "Put on hold",
	resume: "Resume",
	decline: "Decline",
	withdraw: "Client withdrew",
};
```

- [ ] **Step 4: Add the props in `show`**

In `apps/platform/app/controllers/projects_controller.ts`, add `allowedMoves` to the moves import.

In `show`, replace:

```ts
		const artist = project.artistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === project.artistId,
				)
			: undefined;
```

with:

```ts
		const artists = await this.artists.list(tenant);
		const artist = project.artistId
			? artists.find(({ id }) => id === project.artistId)
			: undefined;
		const scheduled = (
			await this.sessions.listForProject(tenant, project)
		).filter(({ status }) => status === "scheduled");
```

and add these keys to the object passed to `ctx.inertia.render("projects/show", …)`, after `form`:

```ts
			moves: allowedMoves(project.status),
			scheduledSessionCount: scheduled.length,
			bookedWithoutSession:
				project.status === "booked" &&
				!scheduled.some(({ kind }) => kind === "tattoo"),
			notes: project.notes,
			contactedText: contactedText(project.lastContactedAt, timezone),
			assignment:
				membership.role === "owner"
					? {
							artistId: project.artistId,
							choices: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
```

- [ ] **Step 5: Run the tests**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts --files=projects_list.spec.ts`
Expected: PASS. Then `pnpm typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git add app/controllers/projects_controller.ts inertia/components/projects.ts tests/functional/projects/project_page.spec.ts tests/helpers/pipeline.ts
git commit -m "feat(platform): give the project page its moves, notes, contact and artist props"
```

---

### Task 9: The project page's lifecycle UI

UI only; checked by typecheck and Biome, and in the browser at the end.

**Files:**
- Modify: `apps/platform/inertia/pages/projects/show.tsx`

**Interfaces:**
- Consumes: the Task 8 props and `MOVE_LABELS`; routes `tenant.projects.moves.store`, `tenant.projects.notes.update`, `tenant.projects.contacted.store`, `tenant.projects.artist.update`; `router` from `@inertiajs/react`; `urlFor` from `~/client`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Add the lifecycle pieces to the page**

In `apps/platform/inertia/pages/projects/show.tsx`:

1. Imports: add `import { router } from "@inertiajs/react";`, `import { urlFor } from "~/client";`, `import { Textarea } from "~/components/ui/textarea";`, and `MOVE_LABELS, type ManualMoveName` to the `~/components/projects` import.

2. Destructure the new props in `ProjectShow`: `moves, scheduledSessionCount, bookedWithoutSession, notes, contactedText, assignment`.

3. Inside `ProjectShow`, before `return`, add:

```tsx
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: project.id };
	// The chat links and "Copy message" record the contact in the background.
	const markContacted = () =>
		router.post(
			urlFor("tenant.projects.contacted.store", params),
			{},
			{ preserveScroll: true, preserveState: true },
		);
```

4. At the top of the page's column (`<div className="flex max-w-2xl flex-col gap-6">`), before the first `Card`, add:

```tsx
				{bookedWithoutSession && (
					<p
						role="status"
						className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
					>
						This project is booked, but no tattoo session is scheduled.
					</p>
				)}
```

5. In the first card's `CardContent` (status badge and brief), after the brief paragraph, add:

```tsx
						<ContactLine text={contactedText} onMark={markContacted} />
						{moves.length > 0 && (
							<MoveButtons
								projectId={project.id}
								moves={moves}
								scheduledSessionCount={scheduledSessionCount}
							/>
						)}
						{assignment && (
							<ArtistField
								projectId={project.id}
								assignment={assignment}
							/>
						)}
```

6. Pass the callback to the chat message: change `{message && <ChatMessage message={message} />}` to `{message && <ChatMessage message={message} onSent={markContacted} />}`.

7. After the Quote card (before the quote form card), add:

```tsx
				<Card>
					<CardHeader>
						<CardTitle>Notes</CardTitle>
					</CardHeader>
					<CardContent>
						<NotesForm projectId={project.id} notes={notes} />
					</CardContent>
				</Card>
```

8. Change `ChatMessage` to take and call `onSent`:

```tsx
function ChatMessage({
	message,
	onSent,
}: {
	message: NonNullable<ProjectPageProps["message"]>;
	onSent: () => void;
}) {
	const copy = () => {
		navigator.clipboard.writeText(message.text).then(
			() => {
				toast.success("Message copied.");
				onSent();
			},
			() => toast.error("Couldn't copy: select the text instead."),
		);
	};
```

and add `onClick={onSent}` to both the WhatsApp and the Viber `<a>`.

9. Add these components above `ProjectShow.layout = [AppLayout];`:

```tsx
function ContactLine({ text, onMark }: { text: string; onMark: () => void }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
			<span className="text-muted-foreground">{text}</span>
			<Button type="button" variant="outline" size="sm" onClick={onMark}>
				Mark contacted
			</Button>
		</div>
	);
}

/** Moves that close a project ask first. */
const CONFIRM: Partial<Record<ManualMoveName, (sessions: number) => string>> =
	{
		decline: () => "Decline this project? It moves to Closed.",
		withdraw: (sessions) =>
			sessions > 0
				? `Mark that the client withdrew? This cancels the project and ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
				: "Mark that the client withdrew? This cancels the project.",
	};

function MoveButtons({
	projectId,
	moves,
	scheduledSessionCount,
}: {
	projectId: string;
	moves: ManualMoveName[];
	scheduledSessionCount: number;
}) {
	const tenant = useTenant();
	const send = (move: ManualMoveName) => {
		const question = CONFIRM[move]?.(scheduledSessionCount);
		if (question && !window.confirm(question)) return;
		router.post(
			urlFor("tenant.projects.moves.store", {
				tenant: tenant.slug,
				id: projectId,
			}),
			{ move },
			{ preserveScroll: true },
		);
	};

	return (
		<div className="flex flex-wrap gap-2">
			{moves.map((move) => (
				<Button
					key={move}
					type="button"
					size="sm"
					variant={CONFIRM[move] ? "outline" : "secondary"}
					onClick={() => send(move)}
				>
					{MOVE_LABELS[move]}
				</Button>
			))}
		</div>
	);
}

function ArtistField({
	projectId,
	assignment,
}: {
	projectId: string;
	assignment: NonNullable<ProjectPageProps["assignment"]>;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.artist.update"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.artistId}>
					<FieldLabel htmlFor="artistId">Artist</FieldLabel>
					<div className="flex gap-2">
						<select
							id="artistId"
							name="artistId"
							defaultValue={assignment.artistId ?? ""}
							aria-invalid={!!errors.artistId}
							className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm"
						>
							<option value="">No artist</option>
							{assignment.choices.map(({ id, name }) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
						<Button type="submit" size="sm" disabled={processing}>
							Save
						</Button>
					</div>
					{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
				</Field>
			)}
		</Form>
	);
}

function NotesForm({
	projectId,
	notes,
}: {
	projectId: string;
	notes: string | null;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.notes.update"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.notes}>
					<Textarea
						name="notes"
						rows={4}
						maxLength={4000}
						defaultValue={notes ?? ""}
						aria-label="Notes"
						aria-invalid={!!errors.notes}
					/>
					{errors.notes && <FieldError>{errors.notes}</FieldError>}
					<div>
						<Button type="submit" size="sm" disabled={processing}>
							{processing ? "Saving…" : "Save notes"}
						</Button>
					</div>
				</Field>
			)}
		</Form>
	);
}
```

If `Form` from `@adonisjs/inertia/react` doesn't take an `options` prop (check its props type in `node_modules/@adonisjs/inertia/build/src/client/react/*.d.ts`, or how other pages pass visit options), drop `options={{ preserveScroll: true }}`; the page then scrolls to the top after saving, which is acceptable.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck` (from `apps/platform`), then from the repo root `pnpm exec biome check apps/platform/inertia/pages/projects apps/platform/inertia/components/projects.ts apps/platform/inertia/layouts/app.tsx`
Expected: clean. A route name typo in `urlFor` or `Form route=` fails the typecheck.

- [ ] **Step 3: Run the page specs once more**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts --files=projects_list.spec.ts`
Expected: PASS (props are unchanged by the UI).

- [ ] **Step 4: Commit**

```bash
git add inertia/pages/projects/show.tsx
git commit -m "feat(platform): add status actions, artist, notes and contact to the project page"
```

---

### Task 10: Docs

**Files:**
- Modify: `docs/requirements.md`
- Modify: `apps/platform/docs/backend.md`
- Modify: `apps/platform/app/modules/projects/models/tattoo_project.ts` (doc comment only)

- [ ] **Step 1: requirements.md, the project rules**

After the bullet that starts `- Issuing a quote moves the project to \`quoted\`;`, add:

```
- Staff move a project by hand only along the side exits: put a quoted project on hold and resume it, decline a project under review, or record that the client withdrew (from `reviewing`, `quoted`, `on_hold` or `deposit_pending`; it cancels the project's scheduled sessions). Withdrawing a booked project comes with recording what happens to its deposit.
```

- [ ] **Step 2: backend.md**

In the "Projects and quotes (TAT-64)" bullet, after the sentence that lists `expireQuote`, insert:

```
TAT-46 adds the manual moves (`app/modules/projects/moves.ts`: `hold`, `resume`, `decline`, `withdraw`, the table the page's buttons come from) through `ProjectService.move` (`ProjectRuleError` `move_not_allowed`), `assignArtist` (owners only, a 404 for anyone else), `updateNotes`, `markContacted` (the chat links call it in the background), and `list` / `countByStatus` for the projects list: Active is every status but `declined`, `cancelled` and `completed`, 25 per page, the same visibility as `findFor`. The list reads only `tattoo_projects`; client names, artist names and the "booked, no session" flag come from `ClientService.findMany`, `ArtistService.list` and `SessionService.projectsWithScheduledTattoo`. Projects are never deleted from the dashboard: declined and withdrawn ones are Closed.
```

and change `The dashboard has the project page and three routes under \`/t/:tenant/projects/:id\`` to `The dashboard has the projects list (\`/t/:tenant/projects\`), the project page and its routes under \`/t/:tenant/projects/:id\``.

- [ ] **Step 3: The model comment**

In `apps/platform/app/modules/projects/models/tattoo_project.ts`, replace `the rest arrive with TAT-46.` with `the manual moves (hold, resume, decline, withdraw) are in moves.ts and ProjectService.move (TAT-46).`

- [ ] **Step 4: Commit**

```bash
git add docs/requirements.md apps/platform/docs/backend.md apps/platform/app/modules/projects/models/tattoo_project.ts
git commit -m "docs(platform): document the projects list and the manual moves"
```

---

### Task 11: Verification and handoff

- [ ] **Step 1: Full checks**

From `apps/platform`: `PORT=3402 node ace test` in the background (about 2 minutes; wait for the notification, don't sleep). From the repo root: `pnpm typecheck`, `pnpm check`. From `apps/platform`: `node ace codegen` then `git status --short` (expected: no changes).
Expected: all pass; report the totals.

- [ ] **Step 2: Reviews before the PR**

Run the whole-branch review (fresh reviewer on the most capable model), then the `codex-review` skill on `origin/main...HEAD`. Check each finding against the cited code, fix the confirmed ones test-first, commit.

- [ ] **Step 3: Browser check (the user, with `pnpm seed:dev`)**

The list's chips and counts; each move (confirmations on decline and withdraw); assigning an artist and opening the list as that artist; notes; Mark contacted and the chat links updating "contacted today"; the booked-without-session warning; 375 px width.

- [ ] **Step 4: Push, PR and Linear**

Push with the HTTPS command from memory and `gh pr create` (the hook asks the user). Set TAT-46 to In Review with the PR link, post the carry-forwards (TAT-42: the project soft-delete cascade; TAT-66: withdrawal after booking and the deposit outcome; TAT-43: walk-ins can use `assignArtist`; TAT-46: part 2 is the inbox), and file the expiry safety-net ticket (an early or retry-exhausted `ExpireQuoteJob` leaves an expired quote on a `quoted` project).
