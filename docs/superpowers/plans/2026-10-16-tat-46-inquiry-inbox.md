# Inquiry inbox (TAT-46 part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owners-only inbox of new inquiries: read everything the client submitted (references included), accept (a `reviewing` project with the chosen artist, references moved onto it) or decline, a read-only Decided tab, a nav badge, the original request on the project page, and seeded demo inquiries.

**Architecture:** The inquiries module gets its first service, `InquiryService` (reads, `accept`, `decline`), which orchestrates acceptance and calls a new `ProjectService.createFromInquiry`; dependencies point inquiries → projects. `ProjectService.projectIdsForInquiries` lets the Decided tab link to projects without reading the projects table from the inquiries module. A new `InquiriesController` (owners-only `/inbox` routes), an `inboxCount` shared prop, `ImageService.storeBytes` for the dev seeder.

**Tech Stack:** AdonisJS 7, Lucid (PostgreSQL, RLS), VineJS, Luxon, sharp, Inertia + React, shadcn/ui, Tuyau `urlFor`, Japa.

**Spec:** `docs/superpowers/specs/2026-10-16-tat-46-inquiry-inbox-design.md`

## Global Constraints

- No migration; no API, SDK or OpenAPI changes. The inquiry is a frozen record: only `status`, `decided_at`, `updated_at`, `deleted_at`, `anonymized_at` may change, and `status` and `decided_at` change together (`inquiries_decided_matches_status`).
- The inbox is owners only: the `/inbox` route group uses `role({ allow: ["owner"] })`; artists get a 404 and no Inbox nav item; `inboxCount` is null for them.
- `listNew`: live `new` inquiries, oldest first (`created_at`, then `id`); `listDecided`: `accepted` and `declined`, `decided_at` newest first, then `id`; 25 per page.
- `accept`: one transaction; lock the inquiry row; must still be `new` (`InquiryRuleError("already_decided")`); a non-null artist must be live in the tenant (`"artist_unavailable"`); `ProjectService.createFromInquiry` makes a `reviewing` project with `client_id`, `inquiry_id`, brief = the idea, the artist; the inquiry's live images get `project_id` (they keep `inquiry_id`; the update filters `deleted_at` itself, since the soft-delete scope is a fetch hook that update queries skip); the inquiry becomes `accepted` with `decided_at` now. `decline`: lock, must be `new`, `declined` with `decided_at`.
- Flash and field texts, verbatim: "Inquiry accepted: project created.", "Inquiry declined.", "This inquiry was already decided."; field error on `artistId`: "Choose an artist from the list.".
- Received text, verbatim: "received today", "received yesterday", "received N days ago" (calendar days in the tenant's timezone, a future time counting as today).
- `@inject()` dependencies are value imports with the `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.` comment. Every query is scoped by `tenant_id`.
- Commands run from `apps/platform` unless stated; tests use `PORT=3402`. A RED step for a missing module or export hangs the Japa runner after the error: run it as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts` (exit 124 plus the error is the expected RED). Several specs together: repeated `--files=` flags. Don't wrap commands in `sh -c`. Editor diagnostics go stale after codegen; `pnpm typecheck` is the authority.
- Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder.

## Review Focus

1. Two owners deciding the same inquiry, or a stale inquiry page accepting one that was declined meanwhile: the second gets "This inquiry was already decided.", and no second project appears. (Tasks 4 and 7.)
2. An inquiry whose preferred artist was deleted: the Accept form pre-selects "No artist" (not the deleted id), and posting that deleted id is a field error with nothing changed. (Tasks 6 and 7.)
3. An inquiry with no references, no email and no budget: the page props carry nulls and an empty reference list, never broken values. (Task 6.)
4. Accepting moves only that inquiry's live images: a soft-deleted image stays put, and another inquiry's images are untouched. (Task 4.)
5. An artist member: 404 on every inbox route, no `inboxCount` (null), and the projects page still works for them. (Tasks 5 and 6.)

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-46-inquiry-inbox-project-board-lifecycle-part-2` (from main da4a52c, with the spec and this plan committed), clean tree: `git status -sb`.
- [ ] Baseline: `PORT=3402 pnpm test functional --files=project_service.spec.ts --files=project_page.spec.ts --files=image_service.spec.ts`. Expected: PASS.
- [ ] Linear: TAT-46 is already In Progress (it stays so until this PR).

---

### Task 1: "N days ago" text

**Files:**
- Modify: `apps/platform/app/modules/projects/contact.ts`
- Modify: `apps/platform/tests/unit/modules/projects/moves.spec.ts`

**Interfaces:**
- Produces: `daysAgoText(at: DateTime, timezone: string, now?: DateTime): string` ("today", "yesterday", "N days ago"); `contactedText` keeps its output, now built on it.

- [ ] **Step 1: Write the failing test**

In `apps/platform/tests/unit/modules/projects/moves.spec.ts`, change the contact import to `import { contactedText, daysAgoText } from "#modules/projects/contact";` and append:

```ts
test.group("daysAgoText", () => {
	const now = DateTime.fromISO("2026-10-15T10:00:00", { zone: KTM });

	test("counts calendar days, a future time counting as today", ({
		assert,
	}) => {
		assert.equal(daysAgoText(now.set({ hour: 1 }), KTM, now), "today");
		assert.equal(daysAgoText(now.plus({ hours: 2 }), KTM, now), "today");
		assert.equal(
			daysAgoText(now.minus({ days: 1 }).set({ hour: 23 }), KTM, now),
			"yesterday",
		);
		assert.equal(daysAgoText(now.minus({ days: 6 }), KTM, now), "6 days ago");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=moves.spec.ts`
Expected: exit 124 after "does not provide an export named 'daysAgoText'".

- [ ] **Step 3: Write the helper and reuse it**

Replace the body of `apps/platform/app/modules/projects/contact.ts` below the import with:

```ts
/**
 * How long ago `at` was, for people: "today", "yesterday" or "N days ago",
 * counting calendar days in the studio's timezone (a slightly fast clock
 * still says today).
 */
export function daysAgoText(
	at: DateTime,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	const days = Math.round(
		now
			.setZone(timezone)
			.startOf("day")
			.diff(at.setZone(timezone).startOf("day"), "days").days,
	);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	return `${days} days ago`;
}

/**
 * When the client was last contacted, for people: "contacted today",
 * "contacted yesterday", "contacted 3 days ago" or "never contacted".
 */
export function contactedText(
	at: DateTime | null,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	return at ? `contacted ${daysAgoText(at, timezone, now)}` : "never contacted";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=moves.spec.ts`
Expected: PASS (the earlier `contactedText` tests unchanged, plus 1).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/contact.ts tests/unit/modules/projects/moves.spec.ts
git commit -m "feat(platform): add a days-ago text for the inbox"
```

---

### Task 2: `ImageService.storeBytes`

**Files:**
- Modify: `apps/platform/app/modules/media/services/image_service.ts`
- Modify: `apps/platform/tests/functional/media/image_service.spec.ts`

**Interfaces:**
- Produces: `ImageService.storeBytes(bytes: Buffer, { tenant, purpose }): Promise<StoredImage>` (the same processing, key layout `tenants/{id}/{purpose}/{uuid}.{jpg|png}` and disk as `store`). `store` now reads the upload and calls it.

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/functional/media/image_service.spec.ts` (it already has `images`, `tenant`, `drive`, `testImages`):

```ts
test.group("ImageService.storeBytes", () => {
	test("stores bytes like an upload: processed, private, under tenant and purpose", async ({
		assert,
	}) => {
		const stored = await images.storeBytes(await testImages.jpeg(), {
			tenant,
			purpose: "reference_image",
		});

		assert.match(
			stored.key,
			new RegExp(`^tenants/${tenant.id}/reference_image/${V4}\\.jpg$`),
		);
		assert.deepEqual([stored.width, stored.height], [300, 200]);
		assert.isTrue(await drive.use("private").exists(stored.key));
		assert.isFalse(await drive.use("public").exists(stored.key));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=image_service.spec.ts`
Expected: FAIL with `images.storeBytes is not a function` (the other tests pass).

- [ ] **Step 3: Write `storeBytes` and route `store` through it**

In `apps/platform/app/modules/media/services/image_service.ts`, replace the part of `store` after reading the file:

```ts
		const input = await readFile(file.tmpPath);
		// The raw upload still has its EXIF and GPS; don't leave it in tmp.
		await rm(file.tmpPath, { force: true });
		const image = await processImage(input);
		const extension = image.format === "png" ? "png" : "jpg";
		const key = `tenants/${tenant.id}/${purpose}/${randomUUID()}.${extension}`;
		await diskFor(purpose).put(key, image.data, {
			contentType: `image/${image.format}`,
		});
		return { key, width: image.width, height: image.height };
	}
```

with:

```ts
		const input = await readFile(file.tmpPath);
		// The raw upload still has its EXIF and GPS; don't leave it in tmp.
		await rm(file.tmpPath, { force: true });
		return this.storeBytes(input, { tenant, purpose });
	}

	/**
	 * Like `store`, for bytes already in memory (the development seeder's
	 * generated images): the same checks, re-encoding, key layout and disk.
	 */
	async storeBytes(
		bytes: Buffer,
		{ tenant, purpose }: { tenant: Pick<Tenant, "id">; purpose: ImagePurpose },
	): Promise<StoredImage> {
		const image = await processImage(bytes);
		const extension = image.format === "png" ? "png" : "jpg";
		const key = `tenants/${tenant.id}/${purpose}/${randomUUID()}.${extension}`;
		await diskFor(purpose).put(key, image.data, {
			contentType: `image/${image.format}`,
		});
		return { key, width: image.width, height: image.height };
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=image_service.spec.ts --files=artist_photo.spec.ts`
Expected: PASS (the `store` tests unchanged, plus 1).

- [ ] **Step 5: Commit**

```bash
git add app/modules/media/services/image_service.ts tests/functional/media/image_service.spec.ts
git commit -m "feat(platform): store in-memory image bytes like an upload"
```

---

### Task 3: `InquiryService` reads

**Files:**
- Create: `apps/platform/app/modules/inquiries/errors.ts`
- Create: `apps/platform/app/modules/inquiries/services/inquiry_service.ts`
- Test: `apps/platform/tests/functional/inquiries/inquiry_service.spec.ts`

**Interfaces:**
- Consumes: `Inquiry`, `ReferenceImage` models.
- Produces:
  - `INQUIRY_RULE_REASONS` (`["already_decided", "artist_unavailable"]`), `type InquiryRuleReason`, `class InquiryRuleError { reason }`
  - `INQUIRIES_PER_PAGE = 25`; `type InquiryPage = { inquiries: Inquiry[]; total: number; lastPage: number }`
  - `InquiryService.listNew(tenant, page)`, `listDecided(tenant, page)`: `Promise<InquiryPage>`
  - `countNew(tenant): Promise<number>`; `findFor(tenant, id): Promise<Inquiry>` (404); `find(tenant, id): Promise<Inquiry | null>`
  - `images(tenant, of: { inquiryId: string } | { projectId: string }): Promise<ReferenceImage[]>`
  - `imageCounts(tenant, inquiryIds: string[]): Promise<Map<string, number>>`
  - (Task 4 adds the constructor with `ArtistService` and `ProjectService`; until then it has none.)

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/inquiries/inquiry_service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import InquiryService, {
	INQUIRIES_PER_PAGE,
} from "#modules/inquiries/services/inquiry_service";
import {
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const inquiries = new InquiryService();

type TenantRef = { id: string };

const ideasOf = (list: { idea: string }[]) => list.map(({ idea }) => idea);

async function inquiryIn(
	tenant: TenantRef,
	over: Parameters<typeof makeInquiry>[2] = {},
) {
	return makeInquiry(tenant, await makeClient(tenant), over);
}

test.group("InquiryService reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("listNew lists live new inquiries, oldest first, and countNew counts them", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await inquiryIn(tenant, { idea: "first" });
			await inquiryIn(tenant, { idea: "second" });
			await inquiryIn(tenant, {
				idea: "accepted",
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const gone = await inquiryIn(tenant, { idea: "deleted" });
			await gone.softDelete();

			const page = await inquiries.listNew(tenant, 1);
			assert.deepEqual(ideasOf(page.inquiries), ["first", "second"]);
			assert.equal(page.total, 2);
			assert.equal(await inquiries.countNew(tenant), 2);
		});
	});

	test("listNew pages by 25", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (let i = 0; i < INQUIRIES_PER_PAGE + 1; i++) {
				await makeInquiry(tenant, client);
			}
			const first = await inquiries.listNew(tenant, 1);
			assert.lengthOf(first.inquiries, INQUIRIES_PER_PAGE);
			assert.equal(first.lastPage, 2);
			assert.lengthOf((await inquiries.listNew(tenant, 2)).inquiries, 1);
		});
	});

	test("listDecided lists accepted and declined, newest decision first", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await inquiryIn(tenant, { idea: "still new" });
			await inquiryIn(tenant, {
				idea: "accepted earlier",
				status: "accepted",
				decidedAt: DateTime.utc().minus({ days: 2 }),
			});
			await inquiryIn(tenant, {
				idea: "declined later",
				status: "declined",
				decidedAt: DateTime.utc().minus({ days: 1 }),
			});

			const page = await inquiries.listDecided(tenant, 1);
			assert.deepEqual(ideasOf(page.inquiries), [
				"declined later",
				"accepted earlier",
			]);
		});
	});

	test("findFor finds the tenant's live inquiry; find returns null otherwise", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			const gone = await inquiryIn(tenant);
			await gone.softDelete();

			assert.equal((await inquiries.findFor(tenant, inquiry.id)).id, inquiry.id);
			for (const id of [gone.id, randomUUID()]) {
				await assert.rejects(() => inquiries.findFor(tenant, id), /Row not found/);
				assert.isNull(await inquiries.find(tenant, id));
			}
		});
	});

	test("images by inquiry or by project, in order; imageCounts per inquiry", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const other = await makeInquiry(tenant, client);
			const project = await makeProject(tenant, client);
			const second = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 1,
			});
			const first = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 0,
			});
			const gone = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 2,
			});
			await gone.softDelete();
			const onProject = await makeReferenceImage(tenant, {
				projectId: project.id,
			});

			assert.deepEqual(
				(await inquiries.images(tenant, { inquiryId: inquiry.id })).map(
					({ id }) => id,
				),
				[first.id, second.id],
			);
			assert.deepEqual(
				(await inquiries.images(tenant, { projectId: project.id })).map(
					({ id }) => id,
				),
				[onProject.id],
			);
			const counts = await inquiries.imageCounts(tenant, [inquiry.id, other.id]);
			assert.equal(counts.get(inquiry.id), 2);
			assert.isUndefined(counts.get(other.id));
			assert.equal((await inquiries.imageCounts(tenant, [])).size, 0);
		});
	});

	test("another tenant sees none of it", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const inquiry = await inTenant(a, () => inquiryIn(a));

		await inTenant(b, async () => {
			assert.lengthOf((await inquiries.listNew(b, 1)).inquiries, 0);
			assert.equal(await inquiries.countNew(b), 0);
			assert.isNull(await inquiries.find(b, inquiry.id));
		});
	});
});
```

`makeInquiry`'s `InquiryOver` must accept `idea`, `status` and `decidedAt` (it does: see `tests/helpers/pipeline.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=inquiry_service.spec.ts`
Expected: exit 124 after "Cannot find module ... inquiry_service.js".

- [ ] **Step 3: Write the errors**

Create `apps/platform/app/modules/inquiries/errors.ts`:

```ts
export const INQUIRY_RULE_REASONS = [
	"already_decided",
	"artist_unavailable",
] as const;
export type InquiryRuleReason = (typeof INQUIRY_RULE_REASONS)[number];

const MESSAGES: Record<InquiryRuleReason, string> = {
	already_decided: "The inquiry was already accepted or declined",
	artist_unavailable: "The artist is not one of the tenant's live artists",
};

/**
 * An inbox rule was broken; `reason` says which. Thrown after the failed
 * savepoint has rolled back. The message is for developers; show your own
 * to the user.
 */
export class InquiryRuleError extends Error {
	constructor(readonly reason: InquiryRuleReason) {
		super(MESSAGES[reason]);
		this.name = "InquiryRuleError";
	}
}
```

- [ ] **Step 4: Write the reads**

Create `apps/platform/app/modules/inquiries/services/inquiry_service.ts`:

```ts
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/** Inquiries per page in the inbox. */
export const INQUIRIES_PER_PAGE = 25;

export type InquiryPage = {
	inquiries: Inquiry[];
	total: number;
	lastPage: number;
};

/**
 * The way to read a tenant's inquiries and decide them (TAT-46): the inbox.
 * Every call is scoped to the tenant; the inbox routes are owners only.
 * An inquiry is a frozen record: only its decision ever changes here.
 */
export default class InquiryService {
	/** Live `new` inquiries, oldest first: whoever has waited longest. */
	async listNew(tenant: TenantRef, page: number): Promise<InquiryPage> {
		const result = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("status", "new")
			.orderBy("created_at", "asc")
			.orderBy("id", "asc")
			.paginate(page, INQUIRIES_PER_PAGE);
		return {
			inquiries: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** Live accepted and declined inquiries, the latest decision first. */
	async listDecided(tenant: TenantRef, page: number): Promise<InquiryPage> {
		const result = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.whereIn("status", ["accepted", "declined"])
			.orderBy("decided_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, INQUIRIES_PER_PAGE);
		return {
			inquiries: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** How many live inquiries wait for a decision (the nav badge). */
	async countNew(tenant: TenantRef): Promise<number> {
		const [row] = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("status", "new")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** The tenant's live inquiry with this id, else E_ROW_NOT_FOUND (a 404). */
	async findFor(tenant: TenantRef, id: string): Promise<Inquiry> {
		return Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/** The tenant's live inquiry with this id, or null. */
	async find(tenant: TenantRef, id: string): Promise<Inquiry | null> {
		return Inquiry.query().where("tenant_id", tenant.id).where("id", id).first();
	}

	/**
	 * The live reference images of an inquiry, or of the project an accepted
	 * inquiry became, by position. Load the inquiry or project scoped to the
	 * tenant (and to the member, for a project) first: that is the access
	 * check for these private images.
	 */
	async images(
		tenant: TenantRef,
		of: { inquiryId: string } | { projectId: string },
	): Promise<ReferenceImage[]> {
		const query = ReferenceImage.query().where("tenant_id", tenant.id);
		if ("inquiryId" in of) query.where("inquiry_id", of.inquiryId);
		else query.where("project_id", of.projectId);
		return query.orderBy("position", "asc").orderBy("id", "asc");
	}

	/** How many live reference images each of these inquiries has. */
	async imageCounts(
		tenant: TenantRef,
		inquiryIds: string[],
	): Promise<Map<string, number>> {
		if (inquiryIds.length === 0) return new Map();
		const rows = await ReferenceImage.query()
			.where("tenant_id", tenant.id)
			.whereIn("inquiry_id", inquiryIds)
			.select("inquiry_id")
			.count("* as total")
			.groupBy("inquiry_id");
		return new Map(
			rows.map((row) => [row.inquiryId as string, Number(row.$extras.total)]),
		);
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=inquiry_service.spec.ts`
Expected: PASS (6 tests). Then `pnpm typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git add app/modules/inquiries/errors.ts app/modules/inquiries/services/inquiry_service.ts tests/functional/inquiries/inquiry_service.spec.ts
git commit -m "feat(platform): read a tenant's inquiries for the inbox"
```

---

### Task 4: Accepting and declining

**Files:**
- Modify: `apps/platform/app/modules/inquiries/services/inquiry_service.ts`
- Modify: `apps/platform/app/modules/projects/services/project_service.ts`
- Modify: `apps/platform/tests/functional/inquiries/inquiry_service.spec.ts` (the two `ProjectService` methods are tested here, where accepting exercises them)

**Interfaces:**
- Consumes: `ArtistService.findFor`, `InquiryRuleError` (Task 3).
- Produces:
  - `ProjectService.createFromInquiry(tenant, { clientId, inquiryId, brief, artistId: string | null }): Promise<TattooProject>`
  - `ProjectService.projectIdsForInquiries(tenant, inquiryIds: string[]): Promise<Map<string, string>>`
  - `new InquiryService(artists: ArtistService, projects: ProjectService)`; `accept(tenant, inquiry: Inquiry, artistId: string | null): Promise<TattooProject>`; `decline(tenant, inquiry: Inquiry): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/inquiries/inquiry_service.spec.ts`, replace `const inquiries = new InquiryService();` with:

```ts
const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const projects = new ProjectService(
	artists,
	quotes,
	deposits,
	new SessionService(artists, deposits),
);
const inquiries = new InquiryService(artists, projects);
```

with these imports added:

```ts
import ArtistService from "#modules/artists/services/artist_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
```

and `makeArtist` added to the pipeline import. Append:

```ts
/** The InquiryRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof InquiryRuleError) return error.reason;
		throw error;
	}
}

test.group("InquiryService accept and decline", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("accepting creates the project, moves the live images and decides", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const inquiry = await inquiryIn(tenant, { idea: "A koi on the calf" });
			const other = await inquiryIn(tenant);
			const kept = await makeReferenceImage(tenant, { inquiryId: inquiry.id });
			const gone = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 1,
			});
			await gone.softDelete();
			const theirs = await makeReferenceImage(tenant, { inquiryId: other.id });

			const project = await inquiries.accept(tenant, inquiry, artist.id);

			const created = await TattooProject.findOrFail(project.id);
			assert.deepEqual(
				[
					created.status,
					created.clientId,
					created.inquiryId,
					created.brief,
					created.artistId,
				],
				["reviewing", inquiry.clientId, inquiry.id, "A koi on the calf", artist.id],
			);
			const decided = await Inquiry.findOrFail(inquiry.id);
			assert.equal(decided.status, "accepted");
			assert.isNotNull(decided.decidedAt);
			const moved = await ReferenceImage.findOrFail(kept.id);
			assert.equal(moved.projectId, project.id);
			assert.equal(moved.inquiryId, inquiry.id);
			const stillGone = await ReferenceImage.withTrashed()
				.where("id", gone.id)
				.firstOrFail();
			assert.isNull(stillGone.projectId);
			assert.isNull((await ReferenceImage.findOrFail(theirs.id)).projectId);
		});
	});

	test("accepting with no artist leaves the project unassigned", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await inquiries.accept(
				tenant,
				await inquiryIn(tenant),
				null,
			);
			assert.isNull((await TattooProject.findOrFail(project.id)).artistId);
		});
	});

	test("a deleted or another tenant's artist is refused and nothing changes", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeArtist(other, "theirs"));

		await inTenant(tenant, async () => {
			const gone = await makeArtist(tenant, "gone");
			await gone.softDelete();
			const inquiry = await inquiryIn(tenant);

			for (const artistId of [gone.id, theirs.id, randomUUID()]) {
				assert.equal(
					await reasonOf(() => inquiries.accept(tenant, inquiry, artistId)),
					"artist_unavailable",
				);
			}
			assert.equal((await Inquiry.findOrFail(inquiry.id)).status, "new");
			assert.lengthOf(
				await TattooProject.query().where("inquiry_id", inquiry.id),
				0,
			);
		});
	});

	test("an inquiry is decided once: accepting or declining again is refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const accepted = await inquiryIn(tenant);
			await inquiries.accept(tenant, accepted, null);
			assert.equal(
				await reasonOf(() => inquiries.accept(tenant, accepted, null)),
				"already_decided",
			);
			assert.equal(
				await reasonOf(() => inquiries.decline(tenant, accepted)),
				"already_decided",
			);
			assert.lengthOf(
				await TattooProject.query().where("inquiry_id", accepted.id),
				1,
			);
		});
	});

	test("declining decides the inquiry and creates nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			await inquiries.decline(tenant, inquiry);

			const decided = await Inquiry.findOrFail(inquiry.id);
			assert.equal(decided.status, "declined");
			assert.isNotNull(decided.decidedAt);
			assert.equal(
				await reasonOf(() => inquiries.accept(tenant, inquiry, null)),
				"already_decided",
			);
			assert.lengthOf(
				await TattooProject.query().where("inquiry_id", inquiry.id),
				0,
			);
		});
	});

	test("projectIdsForInquiries maps accepted inquiries to their projects", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");

		const { inquiry, project } = await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			return { inquiry, project: await inquiries.accept(tenant, inquiry, null) };
		});

		await inTenant(tenant, async () => {
			const map = await projects.projectIdsForInquiries(tenant, [inquiry.id]);
			assert.equal(map.get(inquiry.id), project.id);
			assert.equal(
				(await projects.projectIdsForInquiries(tenant, [])).size,
				0,
			);
		});
		await inTenant(b, async () => {
			assert.equal(
				(await projects.projectIdsForInquiries(b, [inquiry.id])).size,
				0,
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=inquiry_service.spec.ts`
Expected: FAIL with `inquiries.accept is not a function`, `inquiries.decline is not a function` and `projects.projectIdsForInquiries is not a function` (the Task 3 reads still pass).

- [ ] **Step 3: Add the two ProjectService methods**

In `apps/platform/app/modules/projects/services/project_service.ts`, add after `countByStatus`:

```ts
	/**
	 * A `reviewing` project for an accepted inquiry. InquiryService.accept
	 * calls it inside its own transaction, holding the inquiry's lock; the
	 * artist was already checked there. The project is new, so there is
	 * nothing to lock.
	 */
	async createFromInquiry(
		tenant: TenantRef,
		input: {
			clientId: string;
			inquiryId: string;
			brief: string;
			artistId: string | null;
		},
	): Promise<TattooProject> {
		return TattooProject.create({
			tenantId: tenant.id,
			clientId: input.clientId,
			inquiryId: input.inquiryId,
			brief: input.brief,
			artistId: input.artistId,
			status: "reviewing",
		});
	}

	/** The live projects made from these inquiries, by inquiry id. */
	async projectIdsForInquiries(
		tenant: TenantRef,
		inquiryIds: string[],
	): Promise<Map<string, string>> {
		if (inquiryIds.length === 0) return new Map();
		const rows = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereIn("inquiry_id", inquiryIds)
			.select("id", "inquiry_id");
		return new Map(rows.map((row) => [row.inquiryId as string, row.id]));
	}
```

- [ ] **Step 4: Add the constructor, `accept` and `decline`**

In `apps/platform/app/modules/inquiries/services/inquiry_service.ts`:

Replace the imports with:

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import type TattooProject from "#modules/projects/models/tattoo_project";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
```

Replace `export default class InquiryService {` with:

```ts
@inject()
export default class InquiryService {
	constructor(
		private artists: ArtistService,
		private projects: ProjectService,
	) {}
```

Add these methods at the end of the class:

```ts
	/**
	 * Accepts a new inquiry: a `reviewing` project for its client, with the
	 * idea as the brief and `artistId` (or none) as the artist; the
	 * inquiry's live reference images move to the project (they keep their
	 * inquiry); the inquiry is decided. One transaction under the inquiry's
	 * row lock, so two owners deciding at once serialize and the second gets
	 * InquiryRuleError "already_decided". A non-null artist must be a live
	 * artist of the tenant ("artist_unavailable"). Returns the project.
	 */
	async accept(
		tenant: TenantRef,
		inquiry: Inquiry,
		artistId: string | null,
	): Promise<TattooProject> {
		assertInquiryOf(tenant, inquiry);
		return withTransaction(async (trx) => {
			const live = await lockInquiry(trx, tenant, inquiry.id);
			if (live.status !== "new") throw new InquiryRuleError("already_decided");
			if (artistId !== null) await this.checkArtist(tenant, artistId);

			const project = await this.projects.createFromInquiry(tenant, {
				clientId: live.clientId,
				inquiryId: live.id,
				brief: live.idea,
				artistId,
			});
			// The soft-delete scope is a fetch hook, which an update query
			// skips: leave deleted images out by hand.
			await ReferenceImage.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("inquiry_id", live.id)
				.whereNull("deleted_at")
				.update({ project_id: project.id });
			await decide(live, "accepted");
			return project;
		});
	}

	/** Declines a new inquiry; final. "already_decided" if it was decided. */
	async decline(tenant: TenantRef, inquiry: Inquiry): Promise<void> {
		assertInquiryOf(tenant, inquiry);
		await withTransaction(async (trx) => {
			const live = await lockInquiry(trx, tenant, inquiry.id);
			if (live.status !== "new") throw new InquiryRuleError("already_decided");
			await decide(live, "declined");
		});
	}

	/** A live artist of the tenant, else "artist_unavailable". */
	private async checkArtist(tenant: TenantRef, artistId: string) {
		try {
			await this.artists.findFor(tenant, artistId);
		} catch (error) {
			if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
				throw new InquiryRuleError("artist_unavailable");
			}
			throw error;
		}
	}
```

Add these helpers below the class:

```ts
/** Locks the live inquiry row. A deleted or other tenant's inquiry is a 404. */
function lockInquiry(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return Inquiry.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/**
 * Records the decision. The database wants `decided_at` exactly when the
 * status isn't `new`, so both change in one save.
 */
async function decide(inquiry: Inquiry, status: "accepted" | "declined") {
	inquiry.status = status;
	inquiry.decidedAt = DateTime.now();
	await inquiry.save();
}

/** A caller bug, not a user error: inquiries come from the tenant's reads. */
function assertInquiryOf(tenant: TenantRef, inquiry: Inquiry) {
	if (inquiry.tenantId !== tenant.id) {
		throw new Error(`Inquiry ${inquiry.id} belongs to another tenant`);
	}
}
```

- [ ] **Step 5: Run the tests**

Run: `PORT=3402 pnpm test functional --files=inquiry_service.spec.ts --files=project_service.spec.ts`
Expected: PASS (plus 6). Then `pnpm typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git add app/modules/inquiries/services/inquiry_service.ts app/modules/projects/services/project_service.ts tests/functional/inquiries/inquiry_service.spec.ts
git commit -m "feat(platform): accept an inquiry into a project, or decline it"
```

---

### Task 5: The inbox badge

**Files:**
- Modify: `apps/platform/app/middleware/inertia_middleware.ts`
- Modify: `apps/platform/inertia/components/nav_link.tsx`
- Modify: `apps/platform/inertia/layouts/app.tsx`
- Test: `apps/platform/tests/functional/inquiries/inbox.spec.ts`

**Interfaces:**
- Consumes: `InquiryService.countNew` (Task 3).
- Produces: shared prop `inboxCount: number | null` (owners on tenant pages: the count; artists and non-tenant pages: null); `NavItem.badge?: number`.

The Inbox nav item links to `tenant.inbox.index`, which Task 6 adds; the layout change therefore lands in Task 6 (Step 6), and this task only adds the prop and the `badge` field.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/inquiries/inbox.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

test.group("Inbox badge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the new-inquiry count on every tenant page; artists get null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeInquiry(tenant, customer);
			await makeInquiry(tenant, customer);
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
		});

		const ownerProps = (
			await client.get("/t/black-needle/projects").withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.inboxCount, 2);

		const artistResponse = await client
			.get("/t/black-needle/projects")
			.withInertia()
			.loginAs(artist);
		artistResponse.assertStatus(200);
		assert.isNull(artistResponse.inertiaProps.inboxCount);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts`
Expected: FAIL: `inboxCount` is undefined.

- [ ] **Step 3: Share the count**

In `apps/platform/app/middleware/inertia_middleware.ts`, add the import `import InquiryService from "#modules/inquiries/services/inquiry_service";` and, after the `tenants` computation:

```ts
		// The Inbox badge: owners only, the inbox is theirs.
		const inboxCount =
			tenant && membership?.role === "owner" && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(await ctx.containerResolver.make(InquiryService)).countNew(
								tenant,
							),
					)
				: null;
```

and add to the returned object, after `tenants`:

```ts
			/** New inquiries waiting in the inbox; null unless an owner is on a tenant page. */
			inboxCount: ctx.inertia.always(inboxCount),
```

- [ ] **Step 4: Let nav items carry a badge**

In `apps/platform/inertia/components/nav_link.tsx`, add to `NavItem`:

```ts
	/** A count shown next to the label, e.g. new inquiries. */
	badge?: number;
```

In `apps/platform/inertia/layouts/app.tsx`, render it: change the nav map's destructuring to `({ label, route, params, exact, icon: Icon, badge })` and, after `{label}`, add:

```tsx
							{badge ? (
								<span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
									{badge}
								</span>
							) : null}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts --files=projects_list.spec.ts`
Expected: PASS. Then `node ace codegen` (the shared props type) and `pnpm typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git add app/middleware/inertia_middleware.ts inertia/components/nav_link.tsx inertia/layouts/app.tsx tests/functional/inquiries/inbox.spec.ts .adonisjs
git commit -m "feat(platform): share the new-inquiry count for the inbox badge"
```

---

### Task 6: The inbox list and the inquiry page

**Files:**
- Create: `apps/platform/app/controllers/inquiries_controller.ts`
- Create: `apps/platform/inertia/components/inquiries.ts`
- Create: `apps/platform/inertia/components/references.tsx`
- Create: `apps/platform/inertia/pages/inquiries/index.tsx`
- Create: `apps/platform/inertia/pages/inquiries/show.tsx`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/inertia/layouts/app.tsx`
- Modify: `apps/platform/tests/helpers/tenants.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`
- Modify: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Modify: `apps/platform/tests/functional/inquiries/inbox.spec.ts`
- Regenerate: `apps/platform/.adonisjs/`

**Interfaces:**
- Consumes: `InquiryService` reads (Task 3), `ProjectService.projectIdsForInquiries` (Task 4), `ArtistService.list`, `ImageService.url`, `daysAgoText` (Task 1), `formatDay` (`#modules/projects/quotes`).
- Produces:
  - Routes `tenant.inbox.index` (`GET /t/:tenant/inbox`), `tenant.inbox.show` (`GET /t/:tenant/inbox/:id`), in an `/inbox` group with `role({ allow: ["owner"] })`.
  - Page `inquiries/index` props `InboxListProps = { view: "new" | "decided"; newCount: number; inquiries: InquiryRow[]; page: { current: number; last: number; total: number } }` with `InquiryRow = { id; contactName; idea; placement; approximateSize; preferredArtistName: string | null; receivedText; references: number; status; decidedOn: string | null; projectId: string | null }`.
  - Page `inquiries/show` props `InquiryPageProps = { inquiry: InquiryDetails; references: ReferenceProps[]; accept: { artistId: string | null; choices: { id: string; name: string }[] } | null; projectId: string | null }`; `ReferenceProps = { id: string; url: string; width: number; height: number }`.
  - `ReferenceGrid` component (`~/components/references`), reused by the project page in Task 8.
  - `Studio` (tests) gains `newInquiry`; `IsolationCase.resource` gains `"newInquiry"`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/inquiries/inbox.spec.ts` (add `makeArtist` and `makeReferenceImage` to the pipeline import):

```ts
const inbox = (query = "") => `/t/black-needle/inbox${query}`;

test.group("Inbox pages", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the New tab lists waiting inquiries, oldest first, with their details", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const sita = await makeClient(tenant, { name: "Sita Rai" });
			const first = await makeInquiry(tenant, sita, {
				idea: "A koi on the calf",
				preferredArtistId: artist.id,
			});
			await makeReferenceImage(tenant, { inquiryId: first.id });
			await makeReferenceImage(tenant, { inquiryId: first.id, position: 1 });
			await makeInquiry(tenant, await makeClient(tenant, { name: "Ram" }));
			await makeInquiry(tenant, sita, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
		});

		const response = await client.get(inbox()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("inquiries/index");
		const props = response.inertiaProps;
		assert.equal(props.view, "new");
		assert.equal(props.newCount, 2);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 2 });
		assert.deepInclude(props.inquiries[0], {
			contactName: "Sita Rai",
			idea: "A koi on the calf",
			placement: "Forearm",
			approximateSize: "8 cm",
			preferredArtistName: "Sita",
			receivedText: "received today",
			references: 2,
			status: "new",
		});
		assert.equal(props.inquiries[1].contactName, "Ram");
		assert.equal(props.inquiries[1].references, 0);
	});

	test("the Decided tab links accepted inquiries to their project", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { accepted, projectId } = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const accepted = await makeInquiry(tenant, customer, {
				status: "accepted",
				decidedAt: DateTime.utc().minus({ days: 1 }),
			});
			const project = await makeProject(tenant, customer, {
				inquiryId: accepted.id,
			});
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
			return { accepted, projectId: project.id };
		});

		const props = (
			await client.get(inbox("?view=decided")).withInertia().loginAs(owner)
		).inertiaProps;

		assert.equal(props.view, "decided");
		assert.deepEqual(
			props.inquiries.map(({ status }: { status: string }) => status),
			["declined", "accepted"],
		);
		const row = props.inquiries.find(
			({ id }: { id: string }) => id === accepted.id,
		);
		assert.equal(row.projectId, projectId);
		assert.isString(row.decidedOn);

		// A decided inquiry's page links its project and offers no actions.
		const shown = (
			await client
				.get(inbox(`/${accepted.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;
		assert.isNull(shown.accept);
		assert.equal(shown.projectId, projectId);
	});

	test("the inquiry page shows everything, signed references, and the accept choices", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, artist } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const customer = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
				email: "sita@example.com",
			});
			const inquiry = await makeInquiry(tenant, customer, {
				preferredArtistId: artist.id,
				budget: "NPR 20,000",
			});
			await makeReferenceImage(tenant, { inquiryId: inquiry.id });
			return { inquiry, artist };
		});

		const response = await client
			.get(inbox(`/${inquiry.id}`))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("inquiries/show");
		const props = response.inertiaProps;
		assert.deepInclude(props.inquiry, {
			id: inquiry.id,
			status: "new",
			contactName: "Sita Rai",
			contactPhone: "+9779812345678",
			contactEmail: "sita@example.com",
			idea: "A small fine-line moth",
			budget: "NPR 20,000",
			source: "instagram",
			preferredArtistName: "Sita",
		});
		assert.lengthOf(props.references, 1);
		assert.include(props.references[0].url, "reference_image/");
		assert.deepEqual(props.accept.artistId, artist.id);
		assert.deepInclude(props.accept.choices, { id: artist.id, name: "Sita" });
		assert.isNull(props.projectId);
	});

	test("missing details stay null, and a deleted preferred artist pre-selects none", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const inquiry = await makeInquiry(tenant, await makeClient(tenant), {
				preferredArtistId: artist.id,
				contactEmail: null,
				budget: null,
			});
			await artist.softDelete();
			return inquiry;
		});

		const props = (
			await client.get(inbox(`/${inquiry.id}`)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isNull(props.inquiry.contactEmail);
		assert.isNull(props.inquiry.budget);
		assert.isNull(props.inquiry.preferredArtistName);
		assert.deepEqual(props.references, []);
		assert.isNull(props.accept.artistId);
	});

	test("artists get a 404 on the inbox and on an inquiry", async ({ client }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		for (const url of [inbox(), inbox(`/${inquiry.id}`)]) {
			const response = await client.get(url).withInertia().loginAs(artist);
			response.assertStatus(404);
		}
	});
});
```

(also add `makeProject` to the pipeline import).

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts`
Expected: FAIL with 404s for the owner (no routes); the badge test still passes.

- [ ] **Step 3: Page prop types and the reference grid**

Create `apps/platform/inertia/components/inquiries.ts`:

```ts
/** One row of the inbox. */
export type InquiryRow = {
	id: string;
	contactName: string;
	idea: string;
	placement: string;
	approximateSize: string;
	preferredArtistName: string | null;
	receivedText: string;
	/** How many reference images came with it. */
	references: number;
	status: string;
	/** "28 Oct 2026" once decided. */
	decidedOn: string | null;
	/** The project an accepted inquiry became. */
	projectId: string | null;
};

export type InboxListProps = {
	view: "new" | "decided";
	newCount: number;
	inquiries: InquiryRow[];
	page: { current: number; last: number; total: number };
};

/** A reference image with a signed URL (valid for a few minutes). */
export type ReferenceProps = {
	id: string;
	url: string;
	width: number;
	height: number;
};

export type InquiryPageProps = {
	inquiry: {
		id: string;
		status: string;
		contactName: string;
		contactPhone: string | null;
		contactEmail: string | null;
		idea: string;
		placement: string;
		approximateSize: string;
		preferredDates: string;
		budget: string | null;
		source: string;
		preferredArtistName: string | null;
		receivedText: string;
		decidedOn: string | null;
	};
	references: ReferenceProps[];
	/** While the inquiry is new: the artist to pre-select and the choices. */
	accept: {
		artistId: string | null;
		choices: { id: string; name: string }[];
	} | null;
	projectId: string | null;
};

/** How the client found the studio, for people. */
export const SOURCE_LABELS: Record<string, string> = {
	instagram: "Instagram",
	facebook: "Facebook",
	tiktok: "TikTok",
	google: "Google",
	friend: "A friend",
	other: "Other",
};
```

Create `apps/platform/inertia/components/references.tsx`:

```tsx
import type { ReferenceProps } from "~/components/inquiries";

/**
 * The client's reference images as a thumbnail grid; each opens the full
 * image in a new tab. The URLs are signed for a few minutes, so reload the
 * page to view them later.
 */
export default function ReferenceGrid({
	references,
}: {
	references: ReferenceProps[];
}) {
	if (references.length === 0) {
		return <p className="text-sm text-muted-foreground">No references.</p>;
	}
	return (
		<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
			{references.map((reference, index) => (
				<li key={reference.id}>
					<a href={reference.url} target="_blank" rel="noreferrer">
						<img
							src={reference.url}
							alt={`Reference ${index + 1}`}
							loading="lazy"
							className="aspect-square w-full rounded-md border object-cover"
						/>
					</a>
				</li>
			))}
		</ul>
	);
}
```

- [ ] **Step 4: The two pages**

Create `apps/platform/inertia/pages/inquiries/index.tsx`:

```tsx
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import type { InboxListProps } from "~/components/inquiries";
import Page from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The inquiry inbox (TAT-46): new inquiries waiting for a decision, oldest
 * first, and the decided ones. Owners only.
 */
export default function InboxIndex({
	view,
	newCount,
	inquiries,
	page,
}: InboxListProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.inbox.index", { tenant: tenant.slug });
	const href = (tab: string, pageNumber = 1) =>
		`${base}?view=${tab}${pageNumber > 1 ? `&page=${pageNumber}` : ""}`;
	const tabs = [
		{ value: "new", label: `New (${newCount})` },
		{ value: "decided", label: "Decided" },
	];

	return (
		<Page title="Inbox">
			<nav aria-label="Inbox views" className="flex gap-2">
				{tabs.map((tab) => (
					<Link
						key={tab.value}
						href={href(tab.value)}
						aria-current={tab.value === view ? "page" : undefined}
						className={buttonVariants({
							variant: tab.value === view ? "default" : "outline",
							size: "sm",
						})}
					>
						{tab.label}
					</Link>
				))}
			</nav>

			{inquiries.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{view === "new"
						? "No new inquiries. They arrive here from the studio page."
						: "Nothing decided yet."}
				</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border">
					{inquiries.map((inquiry) => (
						<li key={inquiry.id}>
							<Link
								href={urlFor("tenant.inbox.show", {
									tenant: tenant.slug,
									id: inquiry.id,
								})}
								className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50"
							>
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">{inquiry.contactName}</span>
									{view === "new" ? (
										<span className="text-sm text-muted-foreground">
											{inquiry.receivedText}
										</span>
									) : (
										<span className="flex items-center gap-2 text-sm">
											<Badge
												variant={
													inquiry.status === "accepted"
														? "secondary"
														: "outline"
												}
											>
												{inquiry.status === "accepted" ? "Accepted" : "Declined"}
											</Badge>
											<span className="text-muted-foreground">
												{inquiry.decidedOn}
											</span>
										</span>
									)}
								</span>
								{view === "new" && (
									<>
										<span className="line-clamp-2 text-sm">{inquiry.idea}</span>
										<span className="text-sm text-muted-foreground">
											{inquiry.placement} · {inquiry.approximateSize} ·{" "}
											{inquiry.preferredArtistName ?? "any artist"}
											{inquiry.references > 0 &&
												` · ${inquiry.references} reference${inquiry.references === 1 ? "" : "s"}`}
										</span>
									</>
								)}
							</Link>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link href={href(view, page.current - 1)}>Previous</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link href={href(view, page.current + 1)}>Next</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

InboxIndex.layout = [AppLayout];
```

Create `apps/platform/inertia/pages/inquiries/show.tsx` (read-only for now; Task 7 adds the actions):

```tsx
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import { type InquiryPageProps, SOURCE_LABELS } from "~/components/inquiries";
import Page from "~/components/page";
import ReferenceGrid from "~/components/references";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** One inquiry, exactly as the client sent it (TAT-46). Owners only. */
export default function InquiryShow({
	inquiry,
	references,
	projectId,
}: InquiryPageProps) {
	const tenant = useTenant();
	const details: [string, string | null][] = [
		["Placement", inquiry.placement],
		["Approximate size", inquiry.approximateSize],
		["Preferred dates", inquiry.preferredDates],
		["Preferred artist", inquiry.preferredArtistName ?? "Any artist"],
		["Budget", inquiry.budget],
		["Found the studio through", SOURCE_LABELS[inquiry.source] ?? inquiry.source],
		["Phone", inquiry.contactPhone],
		["Email", inquiry.contactEmail],
	];

	return (
		<Page title={inquiry.contactName} description={inquiry.receivedText}>
			<div className="flex max-w-2xl flex-col gap-6">
				{inquiry.status !== "new" && (
					<Card>
						<CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
							<span className="flex items-center gap-2">
								<Badge variant="secondary">
									{inquiry.status === "accepted" ? "Accepted" : "Declined"}
								</Badge>
								{inquiry.decidedOn}
							</span>
							{projectId && (
								<Link
									href={urlFor("tenant.projects.show", {
										tenant: tenant.slug,
										id: projectId,
									})}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									View project
								</Link>
							)}
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Idea</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<p className="text-sm whitespace-pre-line">{inquiry.idea}</p>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							{details.map(([label, value]) => (
								<div key={label} className="contents">
									<dt className="text-muted-foreground">{label}</dt>
									<dd>{value ?? "—"}</dd>
								</div>
							))}
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>References</CardTitle>
					</CardHeader>
					<CardContent>
						<ReferenceGrid references={references} />
					</CardContent>
				</Card>
			</div>
		</Page>
	);
}

InquiryShow.layout = [AppLayout];
```

- [ ] **Step 5: The controller**

Create `apps/platform/app/controllers/inquiries_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Inquiry from "#modules/inquiries/models/inquiry";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { daysAgoText } from "#modules/projects/contact";
import { formatDay } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

/**
 * The inquiry inbox (TAT-46): owners only (the route group's role check).
 * Every :id loads through InquiryService.findFor, so another tenant's
 * inquiry is a 404.
 */
@inject()
export default class InquiriesController {
	constructor(
		private inquiries: InquiryService,
		private projects: ProjectService,
		private artists: ArtistService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const query = ctx.request.qs();
		const view = query.view === "decided" ? "decided" : "new";
		const page = Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1);

		const { inquiries, total, lastPage } =
			view === "new"
				? await this.inquiries.listNew(tenant, page)
				: await this.inquiries.listDecided(tenant, page);
		const ids = inquiries.map(({ id }) => id);
		const counts =
			view === "new"
				? await this.inquiries.imageCounts(tenant, ids)
				: new Map<string, number>();
		const projectIds =
			view === "decided"
				? await this.projects.projectIdsForInquiries(tenant, ids)
				: new Map<string, string>();
		const artistName = await this.artistNames(tenant);

		return ctx.inertia.render("inquiries/index", {
			view,
			newCount: await this.inquiries.countNew(tenant),
			inquiries: inquiries.map((inquiry) => ({
				id: inquiry.id,
				contactName: inquiry.contactName,
				idea: inquiry.idea,
				placement: inquiry.placement,
				approximateSize: inquiry.approximateSize,
				preferredArtistName: inquiry.preferredArtistId
					? (artistName.get(inquiry.preferredArtistId) ?? null)
					: null,
				receivedText: receivedText(inquiry, tenant.timezone),
				references: counts.get(inquiry.id) ?? 0,
				status: inquiry.status,
				decidedOn: decidedOn(inquiry, tenant.timezone),
				projectId: projectIds.get(inquiry.id) ?? null,
			})),
			page: { current: page, last: lastPage, total },
		});
	}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		const images = await this.inquiries.images(tenant, {
			inquiryId: inquiry.id,
		});
		const artists = await this.artists.list(tenant);
		const preferred = artists.find(
			({ id }) => id === inquiry.preferredArtistId,
		);
		const projectId =
			inquiry.status === "accepted"
				? ((
						await this.projects.projectIdsForInquiries(tenant, [inquiry.id])
					).get(inquiry.id) ?? null)
				: null;

		return ctx.inertia.render("inquiries/show", {
			inquiry: {
				id: inquiry.id,
				status: inquiry.status,
				contactName: inquiry.contactName,
				contactPhone: inquiry.contactPhone,
				contactEmail: inquiry.contactEmail,
				idea: inquiry.idea,
				placement: inquiry.placement,
				approximateSize: inquiry.approximateSize,
				preferredDates: inquiry.preferredDates,
				budget: inquiry.budget,
				source: inquiry.sourceChannel,
				preferredArtistName: preferred?.name ?? null,
				receivedText: receivedText(inquiry, tenant.timezone),
				decidedOn: decidedOn(inquiry, tenant.timezone),
			},
			references: await Promise.all(
				images.map(async (image) => ({
					id: image.id,
					url: await this.images.url("reference_image", image.imageKey),
					width: image.width,
					height: image.height,
				})),
			),
			accept:
				inquiry.status === "new"
					? {
							artistId: preferred?.id ?? null,
							choices: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			projectId,
		});
	}

	/** The tenant's live artists' names, by id. */
	private async artistNames(tenant: { id: string }) {
		const artists = await this.artists.list(tenant);
		return new Map(artists.map(({ id, name }) => [id, name]));
	}
}

function receivedText(inquiry: Inquiry, timezone: string) {
	return `received ${daysAgoText(inquiry.createdAt, timezone)}`;
}

function decidedOn(inquiry: Inquiry, timezone: string) {
	return inquiry.decidedAt
		? formatDay(inquiry.decidedAt.setZone(timezone).toFormat("yyyy-MM-dd"))
		: null;
}
```

- [ ] **Step 6: Routes, nav, codegen, isolation and the route guard**

In `apps/platform/start/routes.ts`, inside the `/t/:tenant` group, before the projects group, add:

```ts
		/**
		 * The inquiry inbox: owners only (reference images are private to
		 * owners until a project is assigned). Every inbox route goes in this
		 * group (a test checks).
		 */
		router
			.group(() => {
				router.get("/", [controllers.Inquiries, "index"]).as("tenant.inbox.index");
				router
					.get(":id", [controllers.Inquiries, "show"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.show");
			})
			.prefix("/inbox")
			.use(middleware.role({ allow: ["owner"] }));
```

In `apps/platform/inertia/layouts/app.tsx`: add `Inbox` to the `lucide-react` import, replace the whole `tenantNav` function with:

```tsx
function tenantNav(
	tenant: { slug: string; role: string },
	inboxCount: number | null,
): NavItem[] {
	const params = { tenant: tenant.slug };
	const owner = tenant.role === "owner";
	// Inbox, Artists and Settings are owners only; the server 404s anyone else.
	const items: (NavItem | false)[] = [
		{
			label: "Dashboard",
			route: "tenant.dashboard",
			params,
			exact: true,
			icon: House,
		},
		owner && {
			label: "Inbox",
			route: "tenant.inbox.index",
			params,
			icon: Inbox,
			badge: inboxCount ?? undefined,
		},
		{
			label: "Projects",
			route: "tenant.projects.index",
			params,
			icon: ClipboardList,
		},
		owner && {
			label: "Artists",
			route: "tenant.artists",
			params,
			icon: Users,
		},
		owner && {
			label: "Settings",
			route: "tenant.settings",
			params,
			icon: Settings,
		},
	];
	return items.filter((item): item is NavItem => item !== false);
}
```

and in `AppLayout` replace the first two lines with:

```tsx
	const { tenant, inboxCount } = usePage().props;
	const nav = tenant ? tenantNav(tenant, inboxCount) : [];
```

Run: `node ace codegen`.

In `apps/platform/tests/helpers/tenants.ts`, import `makeInquiry` and `makeReferenceImage` from the pipeline helpers, and in `studio()` add after the `quoted` block:

```ts
	// A new inquiry with one reference image, for the inbox routes.
	const newInquiry = await inTenant(tenant, async () => {
		const inquiry = await makeInquiry(tenant, pipeline.client);
		await makeReferenceImage(tenant, { inquiryId: inquiry.id });
		return inquiry;
	});
```

and add `newInquiry,` to the returned object (comment: "The :id resource of the inbox routes' isolation cases.").

In `apps/platform/tests/isolation/cases.ts`: add `"newInquiry"` to the `resource` union; import `Inquiry` and `ReferenceImage`; add below `projectRows`:

```ts
// Inquiries, projects and reference images, deleted ones included: what
// accepting or declining an inquiry could change.
const inboxRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		inquiries: (
			await Inquiry.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((inquiry) => inquiry.serialize()),
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((project) => project.serialize()),
		images: (
			await ReferenceImage.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((image) => image.serialize()),
	}));
```

and these cases at the end of `isolationCases`:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/inbox",
		actor: "owner",
		ownStatus: 200,
		snapshot: inboxRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/inbox/:id",
		resource: "newInquiry",
		actor: "owner",
		ownStatus: 200,
		snapshot: inboxRows,
	},
```

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, add `{ area: "inbox", allow: ["owner"] },` to the areas list.

- [ ] **Step 7: Run the tests**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts --files=harness.spec.ts`
Expected: PASS. Then `pnpm typecheck` (from `apps/platform`) and from the repo root `pnpm exec biome check apps/platform/inertia apps/platform/app apps/platform/tests`: clean.

- [ ] **Step 8: Commit**

```bash
git add app/controllers/inquiries_controller.ts inertia/components/inquiries.ts inertia/components/references.tsx inertia/pages/inquiries inertia/layouts/app.tsx start/routes.ts tests .adonisjs
git commit -m "feat(platform): add the inquiry inbox and the inquiry page"
```

---

### Task 7: Accept and decline from the inquiry page

**Files:**
- Create: `apps/platform/app/modules/inquiries/validators/inquiry.ts`
- Modify: `apps/platform/app/controllers/inquiries_controller.ts`
- Modify: `apps/platform/inertia/pages/inquiries/show.tsx`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`
- Modify: `apps/platform/tests/functional/inquiries/inbox.spec.ts`
- Regenerate: `apps/platform/.adonisjs/`

**Interfaces:**
- Consumes: `InquiryService.accept`, `decline`, `InquiryRuleError` (Tasks 3 and 4).
- Produces: `acceptInquiryValidator` (`{ artistId: uuid | null }`); routes `tenant.inbox.accept` (POST `:id/accept`) and `tenant.inbox.decline` (POST `:id/decline`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/inquiries/inbox.spec.ts` (add imports `Inquiry` from `#modules/inquiries/models/inquiry`, `TattooProject` from `#modules/projects/models/tattoo_project`, and `assertValidationError` from `#tests/helpers/validation`):

```ts
test.group("Deciding an inquiry", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const statusOf = (tenant: { id: string }, id: string) =>
		inTenant(tenant, async () => (await Inquiry.findOrFail(id)).status);

	test("accepting creates the project and lands on it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, artist } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const inquiry = await makeInquiry(tenant, await makeClient(tenant));
			return { inquiry, artist };
		});

		const response = await client
			.post(inbox(`/${inquiry.id}/accept`))
			.form({ artistId: artist.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const project = await inTenant(tenant, () =>
			TattooProject.query().where("inquiry_id", inquiry.id).firstOrFail(),
		);
		response.assertHeader("location", `/t/black-needle/projects/${project.id}`);
		response.assertFlashMessage("success", "Inquiry accepted: project created.");
		assert.equal(project.artistId, artist.id);
		assert.equal(await statusOf(tenant, inquiry.id), "accepted");
	});

	test("declining closes the inquiry and returns to the inbox", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		const response = await client
			.post(inbox(`/${inquiry.id}/decline`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle/inbox");
		response.assertFlashMessage("success", "Inquiry declined.");
		assert.equal(await statusOf(tenant, inquiry.id), "declined");
	});

	test("a stale page accepting a declined inquiry gets a flash, no project", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant), {
				status: "declined",
				decidedAt: DateTime.utc(),
			}),
		);

		const response = await client
			.post(inbox(`/${inquiry.id}/accept`))
			.form({ artistId: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", `/t/black-needle/inbox/${inquiry.id}`);
		response.assertFlashMessage("error", "This inquiry was already decided.");
		assert.lengthOf(
			await inTenant(tenant, () =>
				TattooProject.query().where("inquiry_id", inquiry.id),
			),
			0,
		);
	});

	test("a removed artist is a field error and nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, gone } = await inTenant(tenant, async () => {
			const gone = await makeArtist(tenant);
			await gone.softDelete();
			return {
				inquiry: await makeInquiry(tenant, await makeClient(tenant)),
				gone,
			};
		});

		const response = await client
			.post(inbox(`/${inquiry.id}/accept`))
			.form({ artistId: gone.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "artistId", "Choose an artist from the list.");
		assert.equal(await statusOf(tenant, inquiry.id), "new");
	});

	test("artists get a 404 on accept and decline", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		for (const action of ["accept", "decline"]) {
			const response = await client
				.post(inbox(`/${inquiry.id}/${action}`))
				.form({ artistId: "" })
				.withCsrfToken()
				.loginAs(artist)
				.redirects(0);
			response.assertStatus(404);
		}
		assert.equal(await statusOf(tenant, inquiry.id), "new");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts`
Expected: FAIL with 404s for the owner's POSTs (no routes).

- [ ] **Step 3: The validator**

Create `apps/platform/app/modules/inquiries/validators/inquiry.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";

/** The artist for the project an accepted inquiry becomes; empty for none. */
export const acceptInquiryValidator = vine.create({
	artistId: vine.string().uuid().nullable(),
});
acceptInquiryValidator.messagesProvider = new SimpleMessagesProvider({
	"artistId.uuid": "Choose an artist from the list.",
});
```

- [ ] **Step 4: The two actions**

In `apps/platform/app/controllers/inquiries_controller.ts`, add imports:

```ts
import { errors } from "@vinejs/vine";
import { InquiryRuleError } from "#modules/inquiries/errors";
import { acceptInquiryValidator } from "#modules/inquiries/validators/inquiry";
```

and these methods after `show`:

```ts
	async accept(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		const { artistId } = await ctx.request.validateUsing(acceptInquiryValidator);
		try {
			const project = await this.inquiries.accept(tenant, inquiry, artistId);
			ctx.session.flash("success", "Inquiry accepted: project created.");
			return ctx.response
				.redirect()
				.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
		} catch (error) {
			if (!(error instanceof InquiryRuleError)) throw error;
			if (error.reason === "artist_unavailable") {
				throw new errors.E_VALIDATION_ERROR([
					{
						field: "artistId",
						message: "Choose an artist from the list.",
						rule: "exists",
					},
				]);
			}
			ctx.session.flash("error", "This inquiry was already decided.");
			return ctx.response
				.redirect()
				.toRoute("tenant.inbox.show", { tenant: tenant.slug, id: inquiry.id });
		}
	}

	async decline(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		try {
			await this.inquiries.decline(tenant, inquiry);
			ctx.session.flash("success", "Inquiry declined.");
			return ctx.response
				.redirect()
				.toRoute("tenant.inbox.index", { tenant: tenant.slug });
		} catch (error) {
			if (!(error instanceof InquiryRuleError)) throw error;
			ctx.session.flash("error", "This inquiry was already decided.");
			return ctx.response
				.redirect()
				.toRoute("tenant.inbox.show", { tenant: tenant.slug, id: inquiry.id });
		}
	}
```

- [ ] **Step 5: Routes, codegen and isolation cases**

In `apps/platform/start/routes.ts`, inside the inbox group, after the show route, add:

```ts
				router
					.post(":id/accept", [controllers.Inquiries, "accept"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.accept");
				router
					.post(":id/decline", [controllers.Inquiries, "decline"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.decline");
```

Run: `node ace codegen`.

In `apps/platform/tests/isolation/cases.ts`, add at the end of `isolationCases`:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/inbox/:id/accept",
		resource: "newInquiry",
		actor: "owner",
		body: () => ({ artistId: "" }),
		ownStatus: 302,
		snapshot: inboxRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/inbox/:id/decline",
		resource: "newInquiry",
		actor: "owner",
		ownStatus: 302,
		snapshot: inboxRows,
	},
```

- [ ] **Step 6: The actions on the inquiry page**

In `apps/platform/inertia/pages/inquiries/show.tsx`: add imports

```tsx
import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
```

destructure `accept` in `InquiryShow`, and add as the first child of the column, when `accept` is set:

```tsx
				{accept && (
					<Card>
						<CardHeader>
							<CardTitle>Decide</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<AcceptForm inquiryId={inquiry.id} accept={accept} />
							<DeclineButton inquiryId={inquiry.id} />
						</CardContent>
					</Card>
				)}
```

and these components above `InquiryShow.layout`:

```tsx
function AcceptForm({
	inquiryId,
	accept,
}: {
	inquiryId: string;
	accept: NonNullable<InquiryPageProps["accept"]>;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.inbox.accept"
			routeParams={{ tenant: tenant.slug, id: inquiryId }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.artistId}>
					<FieldLabel htmlFor="artistId">Artist</FieldLabel>
					<div className="flex flex-wrap gap-2">
						<select
							id="artistId"
							name="artistId"
							defaultValue={accept.artistId ?? ""}
							aria-invalid={!!errors.artistId}
							className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm"
						>
							<option value="">No artist</option>
							{accept.choices.map(({ id, name }) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
						<Button type="submit" disabled={processing}>
							{processing ? "Saving…" : "Accept and create project"}
						</Button>
					</div>
					{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
				</Field>
			)}
		</Form>
	);
}

function DeclineButton({ inquiryId }: { inquiryId: string }) {
	const tenant = useTenant();
	const decline = () => {
		if (!window.confirm("Decline this inquiry? This can't be undone.")) return;
		router.post(
			urlFor("tenant.inbox.decline", { tenant: tenant.slug, id: inquiryId }),
		);
	};

	return (
		<div>
			<Button type="button" variant="outline" onClick={decline}>
				Decline
			</Button>
		</div>
	);
}
```

- [ ] **Step 7: Run the tests**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts`
Expected: PASS. Then `pnpm typecheck` and the root Biome check on the changed files: clean.

- [ ] **Step 8: Commit**

```bash
git add app/modules/inquiries/validators/inquiry.ts app/controllers/inquiries_controller.ts inertia/pages/inquiries/show.tsx start/routes.ts tests .adonisjs
git commit -m "feat(platform): accept or decline an inquiry from the inbox"
```

---

### Task 8: The original request on the project page

**Files:**
- Modify: `apps/platform/app/controllers/projects_controller.ts`
- Modify: `apps/platform/inertia/components/projects.ts`
- Modify: `apps/platform/inertia/pages/projects/show.tsx`
- Modify: `apps/platform/tests/functional/projects/project_page.spec.ts`

**Interfaces:**
- Consumes: `InquiryService.find`, `images` (Task 3), `ImageService.url`, `ReferenceGrid` (Task 6).
- Produces: `ProjectPageProps.request: { placement; approximateSize; preferredDates; budget: string | null; source: string; references: ReferenceProps[] } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/projects/project_page.spec.ts` (add `makeInquiry` and `makeReferenceImage` to the pipeline import):

```ts
test.group("Project page: the original request", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project from an inquiry shows the request and its references", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, customer, {
				status: "accepted",
				decidedAt: DateTime.utc(),
				budget: "NPR 20,000",
			});
			const project = await makeProject(tenant, customer, {
				inquiryId: inquiry.id,
			});
			await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				projectId: project.id,
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepInclude(props.request, {
			placement: "Forearm",
			approximateSize: "8 cm",
			preferredDates: "Any weekday in November",
			budget: "NPR 20,000",
			source: "instagram",
		});
		assert.lengthOf(props.request.references, 1);
		assert.include(props.request.references[0].url, "reference_image/");
	});

	test("a project made directly has no request", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant)),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isNull(props.request);
	});

	test("the assigned artist sees the request and references too", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const customer = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, customer, {
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const project = await makeProject(tenant, customer, {
				inquiryId: inquiry.id,
				artistId: profile.id,
			});
			await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				projectId: project.id,
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;
		assert.lengthOf(props.request.references, 1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts`
Expected: FAIL: `props.request` is undefined.

- [ ] **Step 3: The props type**

In `apps/platform/inertia/components/projects.ts`, add `import type { ReferenceProps } from "~/components/inquiries";` and to `ProjectPageProps` (after `assignment`):

```ts
	/** For a project made from an inquiry: what the client asked for. */
	request: {
		placement: string;
		approximateSize: string;
		preferredDates: string;
		budget: string | null;
		source: string;
		references: ReferenceProps[];
	} | null;
```

- [ ] **Step 4: The controller**

In `apps/platform/app/controllers/projects_controller.ts`: add imports (value imports with the biome-ignore comment) for `InquiryService` (`#modules/inquiries/services/inquiry_service`) and `ImageService` (`#modules/media/services/image_service`); add `private inquiries: InquiryService,` and `private images: ImageService,` as the last constructor parameters. In `show`, before `return ctx.inertia.render(...)`, add:

```ts
		const inquiry = project.inquiryId
			? await this.inquiries.find(tenant, project.inquiryId)
			: null;
		const request = inquiry
			? {
					placement: inquiry.placement,
					approximateSize: inquiry.approximateSize,
					preferredDates: inquiry.preferredDates,
					budget: inquiry.budget,
					source: inquiry.sourceChannel,
					references: await Promise.all(
						(
							await this.inquiries.images(tenant, { projectId: project.id })
						).map(async (image) => ({
							id: image.id,
							url: await this.images.url("reference_image", image.imageKey),
							width: image.width,
							height: image.height,
						})),
					),
				}
			: null;
```

and add `request,` to the props object after `assignment`.

- [ ] **Step 5: The Request section**

In `apps/platform/inertia/pages/projects/show.tsx`: import `ReferenceGrid` from `~/components/references` and `SOURCE_LABELS` from `~/components/inquiries`; destructure `request`; and add after the first card (status, brief and actions):

```tsx
				{request && (
					<Card>
						<CardHeader>
							<CardTitle>Request</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
								<dt className="text-muted-foreground">Placement</dt>
								<dd>{request.placement}</dd>
								<dt className="text-muted-foreground">Approximate size</dt>
								<dd>{request.approximateSize}</dd>
								<dt className="text-muted-foreground">Preferred dates</dt>
								<dd>{request.preferredDates}</dd>
								<dt className="text-muted-foreground">Budget</dt>
								<dd>{request.budget ?? "—"}</dd>
								<dt className="text-muted-foreground">Found the studio through</dt>
								<dd>{SOURCE_LABELS[request.source] ?? request.source}</dd>
							</dl>
							<ReferenceGrid references={request.references} />
						</CardContent>
					</Card>
				)}
```

- [ ] **Step 6: Run the tests**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts --files=projects_list.spec.ts --files=project_changes.spec.ts`
Expected: PASS. Then `pnpm typecheck` and Biome on the changed files: clean.

- [ ] **Step 7: Commit**

```bash
git add app/controllers/projects_controller.ts inertia/components/projects.ts inertia/pages/projects/show.tsx tests/functional/projects/project_page.spec.ts
git commit -m "feat(platform): show the original request and references on the project page"
```

---

### Task 9: Demo inquiries for the development seeder

**Files:**
- Create: `apps/platform/database/seeders/demo_inquiries_seeder.ts`

**Interfaces:**
- Consumes: `ImageService.storeBytes` (Task 2), the `owner` connection (`pnpm seed:dev`, from part 1's TAT-64 work), `sharp`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the seeder**

Create `apps/platform/database/seeders/demo_inquiries_seeder.ts`:

```ts
import logger from "@adonisjs/core/services/logger";
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import sharp from "sharp";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import ImageService from "#modules/media/services/image_service";
import Tenant from "#modules/tenancy/models/tenant";

/** Three demo inquiries; fixed phones, so a second run reuses the clients. */
const DEMOS = [
	{
		phone: "+9779800000011",
		name: "Demo Sita",
		idea: "A small koi swimming up the calf, black and grey with a little red.",
		placement: "Calf",
		size: "About 12 cm",
		dates: "Weekends in November",
		budget: null,
		namesArtist: true,
		colours: [
			[180, 120, 200],
			[90, 160, 200],
		],
	},
	{
		phone: "+9779800000012",
		name: "Demo Ram",
		idea: "Mountain outline across the shoulder blades, fine line.",
		placement: "Upper back",
		size: "Palm-sized",
		dates: "Any evening",
		budget: "NPR 20,000",
		namesArtist: false,
		colours: [[230, 170, 90]],
	},
	{
		phone: "+9779800000013",
		name: "Demo Gita",
		idea: "Tiny lotus on the ankle, matching my sister's.",
		placement: "Ankle",
		size: "5 cm",
		dates: "Early December",
		budget: null,
		namesArtist: false,
		colours: [
			[120, 190, 140],
			[200, 100, 100],
		],
	},
] as const;

/**
 * Development only: gives every tenant without inquiries three `new` ones
 * with generated placeholder references, stored like real uploads, so the
 * inbox can be tried before TAT-51's intake exists. Run as the owner role:
 * `pnpm seed:dev`.
 */
export default class DemoInquiriesSeeder extends BaseSeeder {
	static environment = ["development"];

	async run() {
		const client = this.client;
		const images = new ImageService();
		for (const tenant of await Tenant.query({ client })) {
			const existing = await Inquiry.query({ client })
				.where("tenant_id", tenant.id)
				.first();
			if (!existing) {
				const artist = await Artist.query({ client })
					.where("tenant_id", tenant.id)
					.orderBy("name")
					.first();
				for (const demo of DEMOS) {
					const person =
						(await Client.query({ client })
							.where("tenant_id", tenant.id)
							.where("phone", demo.phone)
							.first()) ??
						(await Client.create(
							{ tenantId: tenant.id, name: demo.name, phone: demo.phone },
							{ client },
						));
					const inquiry = await Inquiry.create(
						{
							tenantId: tenant.id,
							clientId: person.id,
							idea: demo.idea,
							placement: demo.placement,
							approximateSize: demo.size,
							preferredDates: demo.dates,
							preferredArtistId: demo.namesArtist ? (artist?.id ?? null) : null,
							budget: demo.budget,
							sourceChannel: "instagram",
							contactName: person.name,
							contactPhone: person.phone,
							contactEmail: null,
							status: "new",
						},
						{ client },
					);
					for (const [position, [r, g, b]] of demo.colours.entries()) {
						const bytes = await sharp({
							create: {
								width: 640,
								height: 480,
								channels: 3,
								background: { r, g, b },
							},
						})
							.jpeg()
							.toBuffer();
						const stored = await images.storeBytes(bytes, {
							tenant,
							purpose: "reference_image",
						});
						await ReferenceImage.create(
							{
								tenantId: tenant.id,
								inquiryId: inquiry.id,
								imageKey: stored.key,
								width: stored.width,
								height: stored.height,
								position,
							},
							{ client },
						);
					}
				}
			}
			logger.info(`/t/${tenant.slug}/inbox`);
		}
	}
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck` and from the root `pnpm exec biome check apps/platform/database/seeders`.
Expected: clean. (If `Client.phone` or `Inquiry.sourceChannel` types reject the literals, cast through the model's exported types, e.g. `"instagram" as const`.)

- [ ] **Step 3: Commit**

```bash
git add database/seeders/demo_inquiries_seeder.ts
git commit -m "feat(platform): seed demo inquiries with references for the inbox"
```

The seeder is not run against the dev database here: it writes into every tenant without inquiries and needs the owner-role connection; the user runs `pnpm seed:dev` for the browser check.

---

### Task 10: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`
- Modify: `docs/requirements.md`
- Modify: `apps/platform/app/modules/inquiries/models/inquiry.ts` (doc comment only)

- [ ] **Step 1: backend.md**

In the "Clients, inquiries and projects" bullet, replace `clients have only \`ClientService.find(tenant, id)\` (TAT-51 grows it) and inquiries and payments have no service yet (TAT-51, TAT-46, TAT-65)` with `clients have only \`ClientService.find\` / \`findMany\` (TAT-51 grows it), inquiries go through \`InquiryService\` (the Inquiries bullet below; intake is TAT-51), and payments have no service yet (TAT-65)`.

Add a bullet after the "Projects and quotes" bullet:

```
- Inquiries (TAT-46): `InquiryService` (`#modules/inquiries/services/inquiry_service`) reads the inbox (`listNew` oldest first, `listDecided` latest decision first, 25 per page; `countNew` for the Inbox badge, shared as `inboxCount` for owners; `findFor` / `find`; `images` by inquiry or project; `imageCounts`) and decides inquiries: `accept(tenant, inquiry, artistId)` locks the inquiry, refuses one that is no longer `new` (`InquiryRuleError` `already_decided`) or a non-live artist (`artist_unavailable`), creates a `reviewing` project through `ProjectService.createFromInquiry` (brief = the idea), sets `project_id` on the inquiry's live reference images (they keep `inquiry_id`) and records `accepted` with `decided_at`; `decline` records `declined`. Both are final. The `/inbox` routes are owners only (reference images are private to owners until a project is assigned; the project page then shows them to its assigned artist too, in its Request section). `ImageService.storeBytes` stores in-memory bytes like an upload (the dev seeder's generated references). `pnpm seed:dev` gives each tenant without inquiries three new demo ones with generated references.
```

- [ ] **Step 2: requirements.md**

In the "Project rules" section, after the "Staff move a project by hand" bullet, add (the feature checklist stays unticked, as for earlier shipped items):

```
- The inquiry inbox is for owners. Accepting an inquiry creates a project under review, with the artist the owner picks, and its reference images follow the project (its assigned artist can then see them). Declining is final.
```

- [ ] **Step 3: The model comment**

In `apps/platform/app/modules/inquiries/models/inquiry.ts`, replace `Services arrive with TAT-51 (intake) and TAT-46 (inbox).` with `InquiryService (TAT-46) reads and decides them; intake (TAT-51) will create them.`

- [ ] **Step 4: Commit**

```bash
git add apps/platform/docs/backend.md docs/requirements.md apps/platform/app/modules/inquiries/models/inquiry.ts
git commit -m "docs(platform): document the inquiry inbox"
```

---

### Task 11: Verification and handoff

- [ ] **Step 1: Full checks**

From `apps/platform`: `PORT=3402 node ace test` in the background (wait for the notification). From the root: `pnpm typecheck`, `pnpm check`. From `apps/platform`: `node ace codegen` then `git status --short` (no changes). Report the totals.

- [ ] **Step 2: Reviews before the PR**

The whole-branch review (fresh reviewer on the most capable model, with this plan's Review Focus), then the `codex-review` skill on `origin/main...HEAD`. Check each finding against the code, fix the confirmed ones test-first, commit.

- [ ] **Step 3: Browser check (the user, with `pnpm seed:dev`)**

The Inbox badge; both tabs; an inquiry with its references (open a full image); accept with and without an artist (lands on the project, Request section with references; log in as that artist and see them); decline; accept again from a stale tab; 375 px.

- [ ] **Step 4: Push, PR and Linear**

Push with the HTTPS command from memory and `gh pr create` (the hook asks the user). Set TAT-46 to **Done** when the PR merges (attach the PR now). Post the carry-forwards: TAT-51 (intake creates the `new` inquiries the inbox reads; `ImageService.storeBytes` sits next to `store`), TAT-52 (no "received" chat message or staff alert yet), TAT-42 (deleting a client must handle their inquiries and reference images).
