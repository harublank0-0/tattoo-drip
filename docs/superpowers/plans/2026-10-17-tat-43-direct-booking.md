# Direct booking: walk-in, phone or DM (TAT-43) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff book a walk-in, phone or DM client in one step (look the phone up or add the client, pick the artist, describe the tattoo, optionally note a price, pick the time), creating a `booked` project with its tattoo session, atomically, with an overlap shown as a field error.

**Architecture:** A new `BookingService` (projects module) runs one `withTransaction`: the client (`ClientService.findFor`, or the new `ClientService.create`), a `booked` project, an optional zero-deposit quote through `QuoteService.create`, and the session through `SessionService.schedule`. A thin `BookingsController` serves `GET /t/:tenant/projects/new` (with a `?phone=` lookup) and `POST /t/:tenant/projects`; `toBookingInput` turns the form into stored units in the studio's timezone. The project page gains a Sessions card and stops showing the quote's expiry once booked; the projects list and the client profile link to the new page.

**Tech Stack:** AdonisJS 7, Lucid (PostgreSQL, RLS), VineJS, Luxon, Inertia + React, shadcn/ui, Tuyau `urlFor`, Japa.

**Spec:** `docs/superpowers/specs/2026-10-17-tat-43-direct-booking-design.md` (read its Rulings before starting: they decide every open question).

## Global Constraints

- No migration; no API, SDK or OpenAPI change. `database/schema.ts` must not change.
- Routes: `GET /t/:tenant/projects/new` named `tenant.projects.create` and `POST /t/:tenant/projects` named `tenant.projects.store`, inside the existing `/projects` group (owners and artists). Both get an isolation case.
- Who books whom: owners any live artist of the tenant; an artist member only the live artist profile linked to their user. Anything else is the `artistId` field error "Choose an artist from the list." and saves nothing.
- A booking writes client (new only), project, quote (optional) and session in one transaction; a refusal leaves no row behind. A returning client's row is never changed.
- Project: `status` `booked`, `inquiry_id` null, `artist_id` the session's artist, `last_contacted_at` now. Session: kind `tattoo`, through `SessionService.schedule`. Quote: version 1, `deposit_amount` 0, `expires_at` = `expiresAtFor(<session's local day>, tenant.timezone)`, inserted with `QuoteService.create`; never `issueQuote`, never an `ExpireQuoteJob`.
- Dates and times are the tenant's timezone (`tenant.timezone`); the date is from today to a year ahead; a time the clocks skip is refused; length 0.25 to 12 hours in quarter hours.
- Copy, verbatim: page title "Book a session"; description "For a walk-in, a call or a message. The project starts as Booked."; "Client's phone", "Find client", hint "A returning client is found by their number, so their history stays together."; badges "Returning client" / "New client"; "Their saved name, email and notes stay as they are."; "Change number"; "View client"; "Name"; "Email (optional)"; "Artist"; "Choose an artist"; "{name} (you)"; "Date"; "Start time"; "Length (hours)"; hint "In quarter hours: 2.5 for two and a half."; "What's the tattoo?"; hint "A few words for the project page, like small rose on the left wrist."; "Price (optional)"; radios "No price" ("Book without one."), "Fixed price" ("One price for the whole tattoo."), "Hourly" ("A rate per hour and the hours you expect."); "No deposit is asked: the client is booked now. The price can't be changed after booking."; buttons "Book session" / "Saving…" / "Cancel"; empty states "Add an artist before booking a session: every session belongs to one." + "Add an artist", and "Only artists with their own profile can book sessions, and your account isn't linked to one yet."; flash "Session booked: {client} with {artist}, {time}."; error flash "This client's details were deleted. Look the number up again."; field errors exactly as in the spec's Errors table.
- Every query is scoped by `tenant_id`; no module reads another module's tables. `@inject()` dependencies are value imports with the comment `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus` (Biome `a11y/noAutofocus`), no non-null assertions (`!`), no custom CSS classes.
- Commands run from `apps/platform` unless stated; tests use `PORT=3402`. A spec that imports a missing module hangs Japa after the error: run RED steps as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1` (exit 124 plus "Cannot find module" is the expected RED). Never `sh -c`. Never read `apps/platform/.env`. `pnpm typecheck` is the authority over editor diagnostics. After route, page or controller changes run `node ace codegen` and commit `.adonisjs/`. The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again.
- Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder. Never push, never open a PR.

## Review Focus

1. A phone typed the way people type it ("+977 981-234-5678", "981-234-5678") must find the same returning client as "9812345678". Test: Task 6, "a number is looked up in this studio only".
2. A session that runs past midnight (22:30 for 3 hours) must end at 01:30 the next day, and its text must show both days. Tests: Task 1 `sessionTimeText` "across midnight"; Task 4 "a time the clocks skip is refused; a session can run past midnight".
3. The same form sent twice (a double tap, or two staff booking the same slot) must give one booking and the overlap error for the second. Test: Task 7, "a busy artist".
4. A name or brief of only spaces must be a field error, never a blank client or project. Tests: Task 4 validator shape test (brief) and "a new client needs the looked-up phone and a name" (name).
5. A studio in a daylight-saving timezone: a skipped time is refused, a repeated time is its first occurrence. Tests: Task 1 `localDateTime`; Task 4 gap test.

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-43-create-a-project-and-session-directly-walk-in-phone-dm` (stacked on the TAT-83 branch at c1ade0e, with the spec and this plan committed), clean tree: `git status -sb`.
- [ ] Baseline: `PORT=3402 pnpm test functional --files=project_page.spec.ts --files=client_service.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts`. Expected: PASS. Full suite on c1ade0e: 767 tests.

---

### Task 1: Session time helpers

**Files:**
- Create: `apps/platform/app/modules/scheduling/times.ts`
- Test: `apps/platform/tests/unit/modules/scheduling/times.spec.ts`

**Interfaces:**
- Produces: `localDateTime(date: string, time: string, timezone: string): DateTime | null` and `sessionTimeText(startsAt: DateTime, endsAt: DateTime, timezone: string): string` from `#modules/scheduling/times`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/scheduling/times.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { localDateTime, sessionTimeText } from "#modules/scheduling/times";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";

test.group("localDateTime", () => {
	test("reads a local date and time in the studio's timezone", ({
		assert,
	}) => {
		assert.equal(
			localDateTime("2026-10-18", "14:00", KTM)?.toUTC().toISO(),
			"2026-10-18T08:15:00.000Z",
		);
	});

	test("refuses a time the clocks skip and a date that doesn't exist", ({
		assert,
	}) => {
		// 14 March 2027: New York's clocks jump from 02:00 to 03:00.
		assert.isNull(localDateTime("2027-03-14", "02:30", NY));
		assert.isNull(localDateTime("2026-02-30", "10:00", KTM));
	});

	test("a time the clocks pass twice is the first one", ({ assert }) => {
		// 1 November 2026: New York's clocks go back from 02:00 to 01:00.
		assert.equal(
			localDateTime("2026-11-01", "01:30", NY)?.toISO(),
			"2026-11-01T01:30:00.000-04:00",
		);
	});
});

test.group("sessionTimeText", () => {
	test("a session within one day", ({ assert }) => {
		const start = DateTime.fromISO("2026-10-18T08:15:00Z");
		assert.equal(
			sessionTimeText(start, start.plus({ hours: 3 }), KTM),
			"Sun 18 Oct 2026, 14:00–17:00",
		);
	});

	test("a session across midnight names both days", ({ assert }) => {
		// 22:30 in Kathmandu.
		const start = DateTime.fromISO("2026-10-18T16:45:00Z");
		assert.equal(
			sessionTimeText(start, start.plus({ hours: 3 }), KTM),
			"Sun 18 Oct 2026, 22:30 – Mon 19 Oct 2026, 01:30",
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=times.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log shows "Cannot find module" for `times`.

- [ ] **Step 3: Write the helpers**

Create `apps/platform/app/modules/scheduling/times.ts`:

```ts
import { DateTime } from "luxon";

/**
 * The instant a studio means by a local date (yyyy-MM-dd) and time (HH:mm)
 * in `timezone`, or null when there is none: a date that doesn't exist, or
 * a time the clocks skip that day (Luxon would quietly move it an hour
 * on). A time the clocks pass twice is its first occurrence.
 */
export function localDateTime(
	date: string,
	time: string,
	timezone: string,
): DateTime | null {
	const local = `${date}T${time}`;
	const instant = DateTime.fromISO(local, { zone: timezone });
	if (!instant.isValid) return null;
	return instant.toFormat("yyyy-MM-dd'T'HH:mm") === local ? instant : null;
}

/**
 * A session's time for people, in the studio's timezone: "Sun 18 Oct 2026,
 * 14:00–17:00", or "Sun 18 Oct 2026, 22:30 – Mon 19 Oct 2026, 01:30" when
 * it ends on another day.
 */
export function sessionTimeText(
	startsAt: DateTime,
	endsAt: DateTime,
	timezone: string,
): string {
	const start = startsAt.setZone(timezone).setLocale("en-GB");
	const end = endsAt.setZone(timezone).setLocale("en-GB");
	const day = (at: DateTime) => at.toFormat("ccc d LLL yyyy");
	const time = (at: DateTime) => at.toFormat("HH:mm");
	if (start.hasSame(end, "day")) {
		return `${day(start)}, ${time(start)}–${time(end)}`;
	}
	return `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=times.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/modules/scheduling/times.ts tests/unit/modules/scheduling/times.spec.ts
git commit -m "feat(platform): read and show session times in the studio's timezone"
```

---

### Task 2: `ClientService.create`

**Files:**
- Modify: `apps/platform/app/modules/clients/services/client_service.ts`
- Test: `apps/platform/tests/functional/clients/client_service.spec.ts` (new group at the end)

**Interfaces:**
- Produces: `type NewClient = { name: string; phone: string; email: string | null }` and `ClientService.create(tenant: Pick<Tenant, "id">, input: NewClient): Promise<Client>` (throws `ClientRuleError("phone_taken")`).

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/functional/clients/client_service.spec.ts` (the file already has `clients`, `reasonOf`, `Client`, `makeClient`, `inTenant` and `studioWithOwner`):

```ts
test.group("ClientService.create", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("adds a client; an empty email becomes null and there are no notes", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const maya = await clients.create(tenant, {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "",
			});
			assert.include((await Client.findOrFail(maya.id)).serialize(), {
				tenantId: tenant.id,
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: null,
				notes: null,
				anonymizedAt: null,
			});
		});
	});

	test("a number another live client has is refused and the transaction goes on; another studio may have it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");

		await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Ram Thapa", phone: "+9779812345678" });
			assert.equal(
				await reasonOf(() =>
					clients.create(tenant, {
						name: "Maya Gurung",
						phone: "+9779812345678",
						email: null,
					}),
				),
				"phone_taken",
			);
			// The refusal rolled back only its savepoint: this query still runs.
			assert.lengthOf(
				await Client.query().where("phone", "+9779812345678"),
				1,
			);
		});
		await inTenant(other, async () => {
			const there = await clients.create(other, {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: null,
			});
			assert.equal(there.tenantId, other.id);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=client_service.spec.ts`
Expected: FAIL, the two new tests ("clients.create is not a function"); `pnpm typecheck` would also flag it.

- [ ] **Step 3: Add `create`**

In `apps/platform/app/modules/clients/services/client_service.ts`, after the `ClientInput` type add:

```ts
/** A new client (a booking at the desk, TAT-43): the phone already in E.164. */
export type NewClient = {
	name: string;
	phone: string;
	email: string | null;
};
```

and, in the class, after `findByPhone`:

```ts
	/**
	 * Adds a client (a booking at the desk, TAT-43), in its own savepoint. A
	 * phone another live client of the tenant has is refused ("phone_taken")
	 * by the unique index, caught after the savepoint rolled back, so the
	 * request stays usable. An empty email becomes null; there are no notes.
	 */
	async create(tenant: TenantRef, input: NewClient): Promise<Client> {
		try {
			return await withTransaction((trx) =>
				Client.create(
					{
						tenantId: tenant.id,
						name: input.name,
						phone: input.phone,
						email: input.email || null,
						notes: null,
					},
					{ client: trx },
				),
			);
		} catch (error) {
			if (isUniqueViolation(error, PHONE_INDEX)) {
				throw new ClientRuleError("phone_taken");
			}
			throw error;
		}
	}
```

Also update the class's doc comment: "The way to find, list, add and edit a tenant's clients (TAT-37, TAT-41, TAT-43)."

- [ ] **Step 4: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=client_service.spec.ts`
Expected: PASS (all, the two new ones included). Then `pnpm typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
git add app/modules/clients/services/client_service.ts tests/functional/clients/client_service.spec.ts
git commit -m "feat(platform): add clients through ClientService.create"
```

---

### Task 3: `BookingService`

**Files:**
- Modify: `apps/platform/app/modules/projects/errors.ts` (add `BookingRuleError`)
- Create: `apps/platform/app/modules/projects/services/booking_service.ts`
- Modify: `apps/platform/tests/helpers/pipeline.ts` (add `pipelineCounts`)
- Test: `apps/platform/tests/functional/projects/booking_service.spec.ts`

**Interfaces:**
- Consumes: `ClientService.create` and `NewClient` (Task 2); `ArtistService.list`, `ClientService.findFor`, `QuoteService.create(trx, tenant, project, NewQuote)`, `SessionService.schedule(tenant, project, NewSession)`, `expiresAtFor(date, timezone)`, `Member` from `#modules/projects/services/project_service`.
- Produces, from `#modules/projects/services/booking_service`:
  - `type QuickQuote = { kind: "fixed"; fixedPrice: number } | { kind: "hourly"; hourlyRate: number; estimatedMinutes: number }` (paisa, minutes)
  - `type BookingClient = { kind: "existing"; id: string } | { kind: "new"; name: string; phone: string; email: string | null }`
  - `type DirectBooking = { client: BookingClient; artistId: string; brief: string; startsAt: DateTime; endsAt: DateTime; quote: QuickQuote | null }`
  - `type Booking = { project: TattooProject; session: ProjectSession; client: Client; artist: Artist }`
  - `BookingService.bookableArtists(tenant: Pick<Tenant, "id">, member: Member): Promise<Artist[]>`
  - `BookingService.book(tenant: Pick<Tenant, "id" | "timezone">, member: Member, booking: DirectBooking): Promise<Booking>`
- Produces, from `#modules/projects/errors`: `BookingRuleError` with `reason: "artist_unavailable" | "client_unavailable"`.
- Produces, from `#tests/helpers/pipeline`: `pipelineCounts(tenant): Promise<{ clients: number; projects: number; quotes: number; sessions: number }>` (call inside `inTenant`).

- [ ] **Step 1: Add the test helper**

Append to `apps/platform/tests/helpers/pipeline.ts` (it already imports `Client`, `TattooProject`, `Quote` and `ProjectSession`):

```ts
/**
 * How many live clients, projects, quotes and sessions `tenant` has: a
 * refused booking must leave every count as it was. Call it inside
 * `inTenant(tenant, …)`, or the counts are 0 whatever happened.
 */
export async function pipelineCounts(tenant: TenantRef) {
	return {
		clients: (await Client.query().where("tenant_id", tenant.id)).length,
		projects: (await TattooProject.query().where("tenant_id", tenant.id))
			.length,
		quotes: (await Quote.query().where("tenant_id", tenant.id)).length,
		sessions: (await ProjectSession.query().where("tenant_id", tenant.id))
			.length,
	};
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/platform/tests/functional/projects/booking_service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import { ClientRuleError } from "#modules/clients/errors";
import Client from "#modules/clients/models/client";
import ClientService from "#modules/clients/services/client_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import { BookingRuleError } from "#modules/projects/errors";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import BookingService, {
	type DirectBooking,
} from "#modules/projects/services/booking_service";
import QuoteService from "#modules/projects/services/quote_service";
import { SessionOverlapError } from "#modules/scheduling/errors";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
	nextPhone,
	pipelineCounts,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const sessions = new SessionService(artists, new DepositService(quotes));
const bookings = new BookingService(
	artists,
	new ClientService(),
	quotes,
	sessions,
);

const KTM = "Asia/Kathmandu";

/** An owner: the service never reads the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

/** 14:00 in Kathmandu, three days from now. */
const threeDaysOut = () =>
	DateTime.now()
		.setZone(KTM)
		.plus({ days: 3 })
		.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });

/** A three-hour booking of a new client, Maya, with no price. */
function booking(
	artistId: string,
	over: Partial<DirectBooking> = {},
): DirectBooking {
	const startsAt = threeDaysOut();
	return {
		client: {
			kind: "new",
			name: "Maya Gurung",
			phone: "+9779812345678",
			email: null,
		},
		artistId,
		brief: "A small rose on the left wrist",
		startsAt,
		endsAt: startsAt.plus({ hours: 3 }),
		quote: null,
		...over,
	};
}

/** The error `work` throws; fails the test if it succeeds. */
async function refusal(work: () => Promise<unknown>): Promise<unknown> {
	try {
		await work();
	} catch (error) {
		return error;
	}
	throw new Error("expected the booking to be refused");
}

test.group("BookingService.book", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("books a new client: client, booked project, fixed quote and tattoo session, and no expiry job", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const input = booking(sita.id, {
				client: {
					kind: "new",
					name: "Maya Gurung",
					phone: "+9779812345678",
					email: "maya@example.com",
				},
				quote: { kind: "fixed", fixedPrice: 1_500_000 },
			});

			const { project, session, client, artist } = await bookings.book(
				tenant,
				OWNER,
				input,
			);

			assert.equal(artist.id, sita.id);
			assert.include((await Client.findOrFail(client.id)).serialize(), {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
				notes: null,
			});
			const saved = await TattooProject.findOrFail(project.id);
			assert.include(saved.serialize(), {
				clientId: client.id,
				artistId: sita.id,
				inquiryId: null,
				status: "booked",
				brief: "A small rose on the left wrist",
			});
			assert.isNotNull(saved.lastContactedAt);
			assert.include(session.serialize(), {
				projectId: project.id,
				artistId: sita.id,
				kind: "tattoo",
				status: "scheduled",
			});
			assert.equal(session.startsAt.toMillis(), input.startsAt.toMillis());
			assert.equal(session.endsAt.toMillis(), input.endsAt.toMillis());

			const all = await Quote.query().where("project_id", project.id);
			assert.lengthOf(all, 1);
			assert.include(all[0].serialize(), {
				version: 1,
				kind: "fixed",
				fixedPrice: 1_500_000,
				hourlyRate: null,
				estimatedMinutes: null,
				depositAmount: 0,
				currency: "NPR",
			});
			// Valid through the session's day in the studio's timezone.
			assert.equal(
				all[0].expiresAt.toMillis(),
				expiresAtFor(input.startsAt.toFormat("yyyy-MM-dd"), KTM).toMillis(),
			);
		});
		fake.assertNotPushed(ExpireQuoteJob);
	});

	test("a returning client is used as they are; an hourly quote, then no quote", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const maya = await makeClient(tenant, {
				name: "Maya Gurung",
				email: "old@example.com",
				notes: "Allergic to latex",
			});
			const before = (await Client.findOrFail(maya.id)).serialize();

			const first = await bookings.book(
				tenant,
				OWNER,
				booking(sita.id, {
					client: { kind: "existing", id: maya.id },
					quote: {
						kind: "hourly",
						hourlyRate: 300_000,
						estimatedMinutes: 270,
					},
				}),
			);
			assert.equal(first.project.clientId, maya.id);
			assert.equal(first.client.id, maya.id);
			assert.deepEqual((await Client.findOrFail(maya.id)).serialize(), before);
			const [hourly] = await Quote.query().where(
				"project_id",
				first.project.id,
			);
			assert.include(hourly.serialize(), {
				kind: "hourly",
				hourlyRate: 300_000,
				estimatedMinutes: 270,
				fixedPrice: null,
				depositAmount: 0,
			});

			const nextDay = threeDaysOut().plus({ days: 1 });
			const second = await bookings.book(
				tenant,
				OWNER,
				booking(sita.id, {
					client: { kind: "existing", id: maya.id },
					startsAt: nextDay,
					endsAt: nextDay.plus({ hours: 1 }),
				}),
			);
			assert.lengthOf(
				await Quote.query().where("project_id", second.project.id),
				0,
			);
		});
	});

	test("an overlap saves nothing at all, not even the new client, and the transaction goes on", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const busy = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			const input = booking(sita.id, {
				quote: { kind: "fixed", fixedPrice: 500_000 },
			});
			// Starts an hour into the new booking.
			await makeSession(tenant, busy, sita, {
				startsAt: input.startsAt.plus({ hours: 1 }),
				endsAt: input.endsAt.plus({ hours: 1 }),
			});
			const before = await pipelineCounts(tenant);

			assert.instanceOf(
				await refusal(() => bookings.book(tenant, OWNER, input)),
				SessionOverlapError,
			);
			// These queries run, so only the booking's savepoint was rolled back.
			assert.deepEqual(await pipelineCounts(tenant), before);
			assert.isNull(
				await Client.query().where("phone", "+9779812345678").first(),
			);
		});
	});

	test("owners book any live artist; an artist only their own profile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const elsewhere = await inTenant(other, () => makeArtist(other));

		await inTenant(tenant, async () => {
			const own = await Artist.create({
				tenantId: tenant.id,
				name: "Asha",
				slug: "asha",
				userId: asha.id,
			});
			const sita = await makeArtist(tenant);
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			const ashaMember = { userId: asha.id, role: "artist" as const };
			// An artist member with no profile linked to them.
			const ramMember = { userId: ram.id, role: "artist" as const };

			assert.deepEqual(
				(await bookings.bookableArtists(tenant, OWNER)).map(({ name }) => name),
				["Asha", "Sita"],
			);
			assert.deepEqual(
				(await bookings.bookableArtists(tenant, ashaMember)).map(({ id }) => id),
				[own.id],
			);
			assert.deepEqual(await bookings.bookableArtists(tenant, ramMember), []);

			const booked = await bookings.book(tenant, ashaMember, booking(own.id));
			assert.equal(booked.project.artistId, own.id);

			const before = await pipelineCounts(tenant);
			for (const [member, artistId] of [
				[ashaMember, sita.id],
				[ramMember, sita.id],
				[OWNER, gone.id],
				[OWNER, elsewhere.id],
			] as const) {
				const error = await refusal(() =>
					bookings.book(
						tenant,
						member,
						booking(artistId, {
							client: {
								kind: "new",
								name: "Someone",
								phone: nextPhone(),
								email: null,
							},
						}),
					),
				);
				assert.instanceOf(error, BookingRuleError);
				assert.equal((error as BookingRuleError).reason, "artist_unavailable");
			}
			assert.deepEqual(await pipelineCounts(tenant), before);
		});
	});

	test("another studio's client is not found; an anonymized client and a number taken meanwhile are refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeClient(other));

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const anonymous = await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.now(),
			});
			await makeClient(tenant, { name: "Ram Thapa", phone: "+9779812345678" });
			const before = await pipelineCounts(tenant);

			await assert.rejects(
				() =>
					bookings.book(
						tenant,
						OWNER,
						booking(sita.id, { client: { kind: "existing", id: theirs.id } }),
					),
				/Row not found/,
			);
			const anonymized = await refusal(() =>
				bookings.book(
					tenant,
					OWNER,
					booking(sita.id, { client: { kind: "existing", id: anonymous.id } }),
				),
			);
			assert.instanceOf(anonymized, BookingRuleError);
			assert.equal(
				(anonymized as BookingRuleError).reason,
				"client_unavailable",
			);
			// booking() adds Maya with Ram's number.
			const taken = await refusal(() =>
				bookings.book(tenant, OWNER, booking(sita.id)),
			);
			assert.instanceOf(taken, ClientRuleError);
			assert.equal((taken as ClientRuleError).reason, "phone_taken");

			assert.deepEqual(await pipelineCounts(tenant), before);
		});
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=booking_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log shows "Cannot find module" for `booking_service`.

- [ ] **Step 4: Add `BookingRuleError`**

Append to `apps/platform/app/modules/projects/errors.ts`:

```ts
export const BOOKING_RULE_REASONS = [
	"artist_unavailable",
	"client_unavailable",
] as const;
export type BookingRuleReason = (typeof BOOKING_RULE_REASONS)[number];

const BOOKING_MESSAGES: Record<BookingRuleReason, string> = {
	artist_unavailable:
		"The member may not book this artist: owners book the tenant's live artists, an artist only their own live profile",
	client_unavailable: "The client's details were deleted; they can't be booked",
};

/**
 * A direct booking (TAT-43) was refused; `reason` says which rule. Nothing
 * was saved. The message is for developers; show your own to the user.
 */
export class BookingRuleError extends Error {
	constructor(readonly reason: BookingRuleReason) {
		super(BOOKING_MESSAGES[reason]);
		this.name = "BookingRuleError";
	}
}
```

- [ ] **Step 5: Write the service**

Create `apps/platform/app/modules/projects/services/booking_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Client from "#modules/clients/models/client";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { BookingRuleError } from "#modules/projects/errors";
import TattooProject from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import type { Member } from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type ProjectSession from "#modules/scheduling/models/project_session";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

/** A price noted at booking, in stored units: paisa and whole minutes. */
export type QuickQuote =
	| { kind: "fixed"; fixedPrice: number }
	| { kind: "hourly"; hourlyRate: number; estimatedMinutes: number };

/** Who is booked: the client the lookup found, or a new one (phone in E.164). */
export type BookingClient =
	| { kind: "existing"; id: string }
	| { kind: "new"; name: string; phone: string; email: string | null };

/** A walk-in, phone or DM booking, in stored units. */
export type DirectBooking = {
	client: BookingClient;
	artistId: string;
	brief: string;
	startsAt: DateTime;
	endsAt: DateTime;
	quote: QuickQuote | null;
};

/** What a booking made. */
export type Booking = {
	project: TattooProject;
	session: ProjectSession;
	client: Client;
	artist: Artist;
};

/**
 * Books a walk-in, phone or DM client in one step (TAT-43): the client, a
 * `booked` project, an optional quick quote and its tattoo session, all in
 * one transaction, so a refusal leaves nothing behind.
 */
@inject()
export default class BookingService {
	constructor(
		private artists: ArtistService,
		private clients: ClientService,
		private quotes: QuoteService,
		private sessions: SessionService,
	) {}

	/**
	 * The live artists `member` may book: every one for an owner (by name),
	 * only the profile linked to them for an artist (none without one).
	 */
	async bookableArtists(
		tenant: Pick<Tenant, "id">,
		member: Member,
	): Promise<Artist[]> {
		const all = await this.artists.list(tenant);
		if (member.role === "owner") return all;
		return all.filter(({ userId }) => userId === member.userId);
	}

	/**
	 * Books it. An artist outside bookableArtists is refused
	 * (BookingRuleError "artist_unavailable") before anything is written.
	 * Then, in one transaction: the client (a found one is used as it is,
	 * never changed; another tenant's or a deleted one is E_ROW_NOT_FOUND;
	 * an anonymized one is "client_unavailable"; a new one goes through
	 * ClientService.create, ClientRuleError "phone_taken" if the number was
	 * taken meanwhile), a `booked` project with no inquiry, the artist set
	 * and `last_contacted_at` now (staff just spoke with the client), the
	 * quick quote if any, and the tattoo session through
	 * SessionService.schedule (SessionOverlapError when the artist is busy).
	 * Any of these errors rolls the whole booking back.
	 *
	 * The quote is version 1 with no deposit (the client is booked now, so
	 * nothing would ask for one) and is valid through the session's day. It
	 * does not go through ProjectService.issueQuote and queues no
	 * ExpireQuoteJob: expiry only acts on quoted, on_hold and
	 * deposit_pending projects, which a booked project never returns to.
	 */
	async book(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
		booking: DirectBooking,
	): Promise<Booking> {
		const artist = (await this.bookableArtists(tenant, member)).find(
			({ id }) => id === booking.artistId,
		);
		if (!artist) throw new BookingRuleError("artist_unavailable");

		return withTransaction(async (trx) => {
			const client = await this.clientFor(tenant, booking.client);
			const project = await TattooProject.create(
				{
					tenantId: tenant.id,
					clientId: client.id,
					artistId: artist.id,
					inquiryId: null,
					brief: booking.brief,
					status: "booked",
					lastContactedAt: DateTime.now(),
				},
				{ client: trx },
			);
			if (booking.quote) {
				const sessionDay = booking.startsAt
					.setZone(tenant.timezone)
					.toFormat("yyyy-MM-dd");
				await this.quotes.create(trx, tenant, project, {
					...booking.quote,
					depositAmount: 0,
					expiresAt: expiresAtFor(sessionDay, tenant.timezone),
				});
			}
			const session = await this.sessions.schedule(tenant, project, {
				artistId: artist.id,
				kind: "tattoo",
				startsAt: booking.startsAt,
				endsAt: booking.endsAt,
			});
			return { project, session, client, artist };
		});
	}

	/** The booking's client: the found one as it is, or a new one. */
	private async clientFor(
		tenant: Pick<Tenant, "id">,
		choice: BookingClient,
	): Promise<Client> {
		if (choice.kind === "new") {
			return this.clients.create(tenant, {
				name: choice.name,
				phone: choice.phone,
				email: choice.email,
			});
		}
		const client = await this.clients.findFor(tenant, choice.id);
		if (client.anonymizedAt) throw new BookingRuleError("client_unavailable");
		return client;
	}
}
```

(TypeScript spreads a union per member, so `{ ...booking.quote, depositAmount, expiresAt }` is a `NewQuote`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=booking_service.spec.ts`
Expected: PASS (5 tests). Then `pnpm typecheck`: clean. Then from the repo root `pnpm exec biome check apps/platform/app/modules/projects apps/platform/tests/helpers/pipeline.ts apps/platform/tests/functional/projects/booking_service.spec.ts`: clean (fix what it reports with `--write`).

- [ ] **Step 7: Commit**

```bash
git add app/modules/projects/errors.ts app/modules/projects/services/booking_service.ts tests/helpers/pipeline.ts tests/functional/projects/booking_service.spec.ts
git commit -m "feat(platform): book a client, project, quote and session in one transaction"
```

---

### Task 4: The booking form's validator

**Files:**
- Modify: `apps/platform/app/modules/projects/validators/quote.ts` (share the price fields)
- Modify: `apps/platform/app/validators/phone.ts` (export the message)
- Create: `apps/platform/app/modules/projects/validators/booking.ts`
- Test: `apps/platform/tests/unit/modules/projects/booking_validator.spec.ts`

**Interfaces:**
- Consumes: `DirectBooking`, `BookingClient`, `QuickQuote` (Task 3); `localDateTime` (Task 1); `todayIn` from `#modules/projects/quotes`.
- Produces: `priceFields()` and `PRICE_MESSAGES` from `#modules/projects/validators/quote`; `PHONE_MESSAGE` from `#validators/phone`; `bookingValidator`, `type BookingForm`, `PRICE_KINDS` and `toBookingInput(form: BookingForm, timezone: string, now?: DateTime): DirectBooking` from `#modules/projects/validators/booking`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/projects/booking_validator.spec.ts`:

```ts
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import {
	type BookingForm,
	bookingValidator,
	toBookingInput,
} from "#modules/projects/validators/booking";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";
// 20:00 UTC is already 01:45 on 15 Oct in Kathmandu (UTC+5:45).
const NOW = DateTime.fromISO("2026-10-14T20:00:00Z");
const CLIENT_ID = "0195f3a0-0000-7000-8000-000000000001";
const ARTIST_ID = "0195f3a0-0000-7000-8000-000000000002";

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

/** What the body parser hands over for a new client: strings, null for empty fields. */
const body = (over: Record<string, unknown> = {}) => ({
	clientId: null,
	phone: "9812345678",
	name: "Maya Gurung",
	email: null,
	artistId: ARTIST_ID,
	date: "2026-10-20",
	startTime: "14:00",
	hours: "3",
	brief: "A small rose on the wrist",
	priceKind: "none",
	fixedPrice: null,
	hourlyRate: null,
	estimatedHours: null,
	...over,
});

/** A validated form for a new client. */
const form = (over: Partial<BookingForm> = {}): BookingForm => ({
	clientId: null,
	phone: "+9779812345678",
	name: "Maya Gurung",
	email: null,
	artistId: ARTIST_ID,
	date: "2026-10-20",
	startTime: "14:00",
	hours: 3,
	brief: "A small rose on the wrist",
	priceKind: "none",
	fixedPrice: null,
	hourlyRate: null,
	estimatedHours: null,
	...over,
});

test.group("bookingValidator", () => {
	test("accepts a new client's booking and stores the phone in E.164", async ({
		assert,
	}) => {
		const out = await bookingValidator.validate(body());
		assert.equal(out.phone, "+9779812345678");
		assert.equal(out.hours, 3);
		assert.equal(out.priceKind, "none");
	});

	test("reports what the shape can check, in the form's words", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(() =>
				bookingValidator.validate(
					body({
						phone: "12ab",
						email: "maya@",
						artistId: "sita",
						date: "20/10/2026",
						startTime: "2pm",
						hours: "13",
						// Only spaces: trimmed to nothing.
						brief: "   ",
						priceKind: "cheap",
					}),
				),
			),
			{
				phone: "Enter a phone number, like 9812345678 or +977 1 4123456.",
				email: "Enter a valid email address.",
				artistId: "Choose an artist from the list.",
				date: "Pick a date from today to a year from now.",
				startTime: "Enter the start time, like 14:00.",
				hours: "Enter a length from 0.25 to 12 hours.",
				brief: "Describe the tattoo.",
				priceKind: "Choose no price, fixed or hourly.",
			},
		);
	});
});

test.group("toBookingInput", () => {
	test("a returning client is booked by id, at the studio's local time", ({
		assert,
	}) => {
		const input = toBookingInput(
			form({ clientId: CLIENT_ID, phone: null, name: null }),
			KTM,
			NOW,
		);
		assert.deepEqual(input.client, { kind: "existing", id: CLIENT_ID });
		assert.equal(input.artistId, ARTIST_ID);
		assert.equal(input.brief, "A small rose on the wrist");
		assert.equal(input.startsAt.toUTC().toISO(), "2026-10-20T08:15:00.000Z");
		assert.equal(input.endsAt.toUTC().toISO(), "2026-10-20T11:15:00.000Z");
		assert.isNull(input.quote);
	});

	test("a new client needs the looked-up phone and a name", async ({
		assert,
	}) => {
		assert.deepEqual(
			toBookingInput(form({ email: "maya@example.com" }), KTM, NOW).client,
			{
				kind: "new",
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
			},
		);
		assert.deepEqual(
			await problems(() => toBookingInput(form({ name: null }), KTM, NOW)),
			{ name: "Enter the client's name." },
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ phone: null, name: null }), KTM, NOW),
			),
			{ phone: "Look the client's phone up first." },
		);
		// A name of spaces is trimmed to nothing by the validator: missing too.
		const spaces = await bookingValidator.validate(body({ name: "   " }));
		assert.deepEqual(
			await problems(() => toBookingInput(spaces, KTM, NOW)),
			{ name: "Enter the client's name." },
		);
	});

	test("the day is from today to a year ahead in the studio's timezone; earlier today is fine", async ({
		assert,
	}) => {
		const DAY = { date: "Pick a date from today to a year from now." };
		// Today in Kathmandu is 15 Oct 2026.
		for (const date of ["2026-10-14", "2027-10-16", "2026-11-31"]) {
			assert.deepEqual(
				await problems(() => toBookingInput(form({ date }), KTM, NOW)),
				DAY,
				date,
			);
		}
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ date: "2027-10-15" }), KTM, NOW),
			),
			{},
		);
		// A walk-in already in the chair: 00:15 today is before NOW (01:45).
		const early = toBookingInput(
			form({ date: "2026-10-15", startTime: "00:15" }),
			KTM,
			NOW,
		);
		assert.isBelow(early.startsAt.toMillis(), NOW.toMillis());
	});

	test("a time the clocks skip is refused; a session can run past midnight", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(() =>
				toBookingInput(
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
		const late = toBookingInput(
			form({ startTime: "22:30", hours: 3 }),
			KTM,
			NOW,
		);
		assert.equal(
			late.endsAt.setZone(KTM).toFormat("yyyy-MM-dd HH:mm"),
			"2026-10-21 01:30",
		);
	});

	test("the length comes in quarter hours", async ({ assert }) => {
		assert.deepEqual(
			await problems(() => toBookingInput(form({ hours: 2.1 }), KTM, NOW)),
			{ hours: "Use quarter hours: 0.25, 0.5, 0.75 and so on." },
		);
		const input = toBookingInput(form({ hours: 2.75 }), KTM, NOW);
		assert.equal(input.endsAt.diff(input.startsAt, "minutes").minutes, 165);
	});

	test("a quick quote is a fixed price or an hourly rate, in paisa and minutes", async ({
		assert,
	}) => {
		assert.deepEqual(
			toBookingInput(form({ priceKind: "fixed", fixedPrice: 15_000 }), KTM, NOW)
				.quote,
			{ kind: "fixed", fixedPrice: 1_500_000 },
		);
		assert.deepEqual(
			toBookingInput(
				form({ priceKind: "hourly", hourlyRate: 3_000, estimatedHours: 4.5 }),
				KTM,
				NOW,
			).quote,
			{ kind: "hourly", hourlyRate: 300_000, estimatedMinutes: 270 },
		);
		// "No price" ignores stray price fields.
		assert.isNull(
			toBookingInput(form({ priceKind: "none", fixedPrice: 15_000 }), KTM, NOW)
				.quote,
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ priceKind: "fixed" }), KTM, NOW),
			),
			{ fixedPrice: "Enter the price." },
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ priceKind: "hourly" }), KTM, NOW),
			),
			{
				hourlyRate: "Enter the hourly rate.",
				estimatedHours: "Enter the estimated hours.",
			},
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(
					form({ priceKind: "hourly", hourlyRate: 3_000, estimatedHours: 2.1 }),
					KTM,
					NOW,
				),
			),
			{ estimatedHours: "Use quarter hours: 0.25, 0.5, 0.75 and so on." },
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=booking_validator.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log shows "Cannot find module" for `validators/booking`.

- [ ] **Step 3: Share the price fields**

In `apps/platform/app/modules/projects/validators/quote.ts`, replace everything above `type Problem = {` (the imports, the `quoteValidator` doc comment and definition, `QuoteForm`, the message constants and the `messagesProvider` assignment) with:

```ts
import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DateTime } from "luxon";
import { QUOTE_KINDS } from "#modules/projects/models/quote";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import type { NewQuote } from "#modules/projects/services/quote_service";

const PRICE = "Enter whole rupees from 1 to 1,00,00,000.";
const RATE = "Enter whole rupees from 1 to 1,00,000 an hour.";
const HOURS = "Enter hours from 0.25 to 100.";
const DEPOSIT = "Enter the deposit in whole rupees (0 for none).";
const EXPIRY = "Pick the last day the quote is valid.";

/**
 * The price fields the quote form and the booking form (TAT-43) share, in
 * the form's units: whole rupees and hours; empty fields arrive as null.
 * The caps keep rate × hours far below 2^53 (see toQuoteInput). A function,
 * so each validator gets its own schema objects.
 */
export function priceFields() {
	return {
		fixedPrice: vine
			.number()
			.withoutDecimals()
			.range([1, 10_000_000])
			.nullable()
			.optional(),
		hourlyRate: vine
			.number()
			.withoutDecimals()
			.range([1, 100_000])
			.nullable()
			.optional(),
		estimatedHours: vine.number().range([0.25, 100]).nullable().optional(),
	};
}

/** The messages for priceFields(). */
export const PRICE_MESSAGES = {
	"fixedPrice.number": PRICE,
	"fixedPrice.withoutDecimals": PRICE,
	"fixedPrice.range": PRICE,
	"hourlyRate.number": RATE,
	"hourlyRate.withoutDecimals": RATE,
	"hourlyRate.range": RATE,
	"estimatedHours.number": HOURS,
	"estimatedHours.range": HOURS,
};

/**
 * The quote form's shape, in the form's units: whole rupees, hours and the
 * last valid day (yyyy-MM-dd, the studio's local date). Empty fields arrive
 * as null. What depends on the kind, the total or the studio's timezone is
 * checked by toQuoteInput. `baseQuoteId` is the quote the form was showing
 * (null for a first quote): ProjectService.issueQuote refuses the save when
 * it is no longer the current one.
 */
export const quoteValidator = vine.create({
	baseQuoteId: vine.string().uuid().nullable().optional(),
	kind: vine.enum(QUOTE_KINDS),
	...priceFields(),
	depositAmount: vine.number().withoutDecimals().min(0),
	expiresOn: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type QuoteForm = Infer<typeof quoteValidator>;

quoteValidator.messagesProvider = new SimpleMessagesProvider({
	"kind.required": "Choose fixed or hourly.",
	"kind.enum": "Choose fixed or hourly.",
	...PRICE_MESSAGES,
	"depositAmount.required": DEPOSIT,
	"depositAmount.number": DEPOSIT,
	"depositAmount.withoutDecimals": DEPOSIT,
	"depositAmount.min": DEPOSIT,
	"expiresOn.required": EXPIRY,
	"expiresOn.regex": EXPIRY,
});
```

The rest of the file (`Problem`, `toQuoteInput`, `checkExpiry`, `acceptQuoteValidator`) stays as it is.

- [ ] **Step 4: Export the phone message**

In `apps/platform/app/validators/phone.ts`, add after `NEPALI_WITH_CODE`:

```ts
/** What the phone rule says about a number it can't read. */
export const PHONE_MESSAGE =
	"Enter a phone number, like 9812345678 or +977 1 4123456.";
```

and in `phoneNumber`, replace the literal message in `field.report(…)` with `PHONE_MESSAGE`.

- [ ] **Step 5: Write the booking validator**

Create `apps/platform/app/modules/projects/validators/booking.ts`:

```ts
import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DateTime } from "luxon";
import { todayIn } from "#modules/projects/quotes";
import type {
	BookingClient,
	DirectBooking,
	QuickQuote,
} from "#modules/projects/services/booking_service";
import {
	PRICE_MESSAGES,
	priceFields,
} from "#modules/projects/validators/quote";
import { localDateTime } from "#modules/scheduling/times";
import { phoneNumber } from "#validators/phone";

/** What the booking form can say about the price. */
export const PRICE_KINDS = ["none", "fixed", "hourly"] as const;

/**
 * The booking form's shape (TAT-43), in the form's units: whole rupees,
 * hours, and the studio's local date (yyyy-MM-dd) and time (HH:mm). A
 * returning client comes as `clientId`; a new one as the looked-up `phone`
 * (stored in E.164) with `name` and `email`. Empty fields arrive as null.
 * What depends on another field or on the studio's timezone is checked by
 * toBookingInput.
 */
export const bookingValidator = vine.create({
	clientId: vine.string().uuid().nullable().optional(),
	phone: vine.string().trim().use(phoneNumber()).nullable().optional(),
	name: vine.string().trim().maxLength(120).nullable().optional(),
	email: vine.string().trim().maxLength(254).email().nullable().optional(),
	artistId: vine.string().uuid(),
	date: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
	hours: vine.number().range([0.25, 12]),
	brief: vine.string().trim().minLength(1).maxLength(4000),
	priceKind: vine.enum(PRICE_KINDS),
	...priceFields(),
});

export type BookingForm = Infer<typeof bookingValidator>;

const LOOKUP = "Look the client's phone up first.";
const EMAIL = "Enter a valid email address.";
const ARTIST = "Choose an artist from the list.";
const DAY = "Pick a date from today to a year from now.";
const TIME = "Enter the start time, like 14:00.";
const LENGTH = "Enter a length from 0.25 to 12 hours.";
const BRIEF = "Describe the tattoo.";
const PRICE_KIND = "Choose no price, fixed or hourly.";
const QUARTERS = "Use quarter hours: 0.25, 0.5, 0.75 and so on.";
const SKIPPED =
	"That time doesn't exist on this day because the clocks change. Pick another.";

bookingValidator.messagesProvider = new SimpleMessagesProvider({
	"clientId.uuid": LOOKUP,
	"name.maxLength": "Keep the name under 120 characters.",
	"email.email": EMAIL,
	"email.maxLength": EMAIL,
	"artistId.required": ARTIST,
	"artistId.uuid": ARTIST,
	"date.required": DAY,
	"date.regex": DAY,
	"startTime.required": TIME,
	"startTime.regex": TIME,
	"hours.required": LENGTH,
	"hours.number": LENGTH,
	"hours.range": LENGTH,
	"brief.required": BRIEF,
	"brief.minLength": BRIEF,
	"brief.maxLength": "Keep it under 4,000 characters.",
	"priceKind.required": PRICE_KIND,
	"priceKind.enum": PRICE_KIND,
	...PRICE_MESSAGES,
});

type Fail = (field: string, message: string, rule: string) => void;

/**
 * BookingService's input from the validated form, in stored units: paisa,
 * minutes and instants. Throws E_VALIDATION_ERROR, shown next to the field,
 * for what the shape can't check: who the client is (a found client's id,
 * else the looked-up phone and a name), a day from today to a year ahead
 * in the studio's timezone (a time earlier today is fine: the walk-in is
 * in the chair), a start time that exists on that day, quarter hours, and
 * the price fields of the chosen kind.
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
	const startsAt = startOf(form, timezone, now, fail);
	if (!Number.isInteger(form.hours * 4)) fail("hours", QUARTERS, "quarterHours");
	const quote = quoteOf(form, fail);

	if (problems.length || !client || !startsAt) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		client,
		artistId: form.artistId,
		brief: form.brief,
		startsAt,
		endsAt: startsAt.plus({ minutes: form.hours * 60 }),
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

/**
 * The session's start: a real day from the studio's today to a year ahead
 * (yyyy-MM-dd strings compare as text), at a time that exists that day.
 */
function startOf(
	form: BookingForm,
	timezone: string,
	now: DateTime,
	fail: Fail,
): DateTime | null {
	const today = todayIn(timezone, now);
	const last = DateTime.fromISO(today, { zone: "utc" })
		.plus({ years: 1 })
		.toFormat("yyyy-MM-dd");
	const real = DateTime.fromISO(form.date, { zone: "utc" }).isValid;
	if (!real || form.date < today || form.date > last) {
		fail("date", DAY, "range");
		return null;
	}
	const start = localDateTime(form.date, form.startTime, timezone);
	if (!start) fail("startTime", SKIPPED, "time");
	return start;
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

- [ ] **Step 6: Run tests to verify they pass**

Run: `PORT=3402 pnpm test unit --files=booking_validator.spec.ts --files=quote_validator.spec.ts --files=phone.spec.ts`
Expected: PASS (the 8 new tests, and the quote and phone specs unchanged). Then `PORT=3402 pnpm test functional --files=quotes_http.spec.ts`: PASS. Then `pnpm typecheck`: clean.

- [ ] **Step 7: Commit**

```bash
git add app/modules/projects/validators app/validators/phone.ts tests/unit/modules/projects/booking_validator.spec.ts
git commit -m "feat(platform): validate the booking form in the studio's timezone"
```

---

### Task 5: Sessions on the project page; no expiry once booked

**Files:**
- Modify: `apps/platform/app/modules/projects/quotes.ts` (add `BOOKED_STATUSES`)
- Modify: `apps/platform/app/controllers/projects_controller.ts` (`show`)
- Modify: `apps/platform/inertia/components/projects.ts` (prop types, labels)
- Modify: `apps/platform/inertia/pages/projects/show.tsx` (Sessions card, `QuoteSummary`)
- Test: `apps/platform/tests/functional/projects/project_page.spec.ts` (two new tests at the end of the "Project page" group)

**Interfaces:**
- Consumes: `sessionTimeText` (Task 1).
- Produces: `BOOKED_STATUSES: readonly ProjectStatus[]` from `#modules/projects/quotes`; project page props `sessions: { id: string; whenText: string; kind: string; status: string; artistName: string | null }[]` and `quoteExpiryShown: boolean`; `SessionRow`, `SESSION_KIND_LABELS`, `SESSION_STATUS_LABELS` from `~/components/projects`.

- [ ] **Step 1: Write the failing tests**

Add inside the `test.group("Project page", …)` block of `apps/platform/tests/functional/projects/project_page.spec.ts` (all helpers used are already imported there):

```ts
	test("the page lists the project's sessions with their time, kind and artist", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			// 10:00 UTC on 2 Nov is 15:45 in Kathmandu.
			await makeSession(tenant, project, sita);
			await makeSession(tenant, project, sita, {
				kind: "touch_up",
				status: "cancelled",
				startsAt: DateTime.utc(2026, 12, 1, 4, 15),
				endsAt: DateTime.utc(2026, 12, 1, 5, 15),
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(
			props.sessions.map(({ id: _id, ...rest }: { id: string }) => rest),
			[
				{
					whenText: "Mon 2 Nov 2026, 15:45–17:45",
					kind: "tattoo",
					status: "scheduled",
					artistName: "Sita",
				},
				{
					whenText: "Tue 1 Dec 2026, 10:00–11:00",
					kind: "touch_up",
					status: "cancelled",
					artistName: "Sita",
				},
			],
		);
	});

	test("the quote's expiry shows until the project is booked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const expected = {
			quoted: true,
			cancelled: true,
			booked: false,
			in_progress: false,
		} as const;
		const projects = await inTenant(tenant, async () => {
			const made: Record<string, string> = {};
			for (const status of Object.keys(expected) as (keyof typeof expected)[]) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				await makeQuote(tenant, project);
				made[status] = project.id;
			}
			return made;
		});

		for (const [status, shown] of Object.entries(expected)) {
			const props = (
				await client.get(page(projects[status])).withInertia().loginAs(owner)
			).inertiaProps;
			assert.equal(props.quoteExpiryShown, shown, status);
			assert.deepEqual(props.sessions, [], status);
		}
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts`
Expected: FAIL, the two new tests (`props.sessions` is undefined; `quoteExpiryShown` is undefined).

- [ ] **Step 3: Add `BOOKED_STATUSES`**

In `apps/platform/app/modules/projects/quotes.ts`, after `QUOTABLE_STATUSES`:

```ts
/**
 * Booked or later: the quote is settled, so its expiry no longer cancels
 * anything (expireQuote and the sweep act only on quoted, on_hold and
 * deposit_pending, and a project never goes back to them from here). The
 * project page stops showing it.
 */
export const BOOKED_STATUSES: readonly ProjectStatus[] = [
	"booked",
	"in_progress",
	"completed",
	"healing_check",
];
```

- [ ] **Step 4: Send the props**

In `apps/platform/app/controllers/projects_controller.ts`:

1. Add `BOOKED_STATUSES,` to the `#modules/projects/quotes` import list, and `import { sessionTimeText } from "#modules/scheduling/times";` below the `SessionService` import.
2. In `show`, replace

```ts
		const scheduled = (
			await this.sessions.listForProject(tenant, project)
		).filter(({ status }) => status === "scheduled");
```

with

```ts
		const sessions = await this.sessions.listForProject(tenant, project);
		const scheduled = sessions.filter(({ status }) => status === "scheduled");
```

3. In the `render("projects/show", { … })` object, after `history: …,` add:

```ts
			// From booked on, the quote's expiry no longer means anything.
			quoteExpiryShown: !BOOKED_STATUSES.includes(project.status),
```

and after `bookedWithoutSession: …,` add:

```ts
			sessions: sessions.map((session) => ({
				id: session.id,
				whenText: sessionTimeText(session.startsAt, session.endsAt, timezone),
				kind: session.kind,
				status: session.status,
				artistName:
					artists.find(({ id }) => id === session.artistId)?.name ?? null,
			})),
```

- [ ] **Step 5: Show them**

In `apps/platform/inertia/components/projects.ts`, add to `ProjectPageProps` (after `bookedWithoutSession`):

```ts
	/** Whether the quote summary shows "Valid until" and Expired: false from booked on. */
	quoteExpiryShown: boolean;
	/** The project's live sessions, earliest first. */
	sessions: SessionRow[];
```

and at the end of the file:

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
};

export const SESSION_KIND_LABELS: Record<string, string> = {
	consultation: "Consultation",
	tattoo: "Tattoo",
	touch_up: "Touch-up",
};

export const SESSION_STATUS_LABELS: Record<string, string> = {
	scheduled: "Scheduled",
	completed: "Completed",
	no_show: "No-show",
	cancelled: "Cancelled",
};
```

In `apps/platform/inertia/pages/projects/show.tsx`:

1. Add `SESSION_KIND_LABELS,` and `SESSION_STATUS_LABELS,` to the `~/components/projects` import list, and `quoteExpiryShown,` and `sessions,` to the destructured props of `ProjectShow`.
2. Right after the first `</Card>` (the status card, before `{request && (`), insert:

```tsx
				<Card>
					<CardHeader>
						<CardTitle>Sessions</CardTitle>
					</CardHeader>
					<CardContent>
						{sessions.length === 0 ? (
							<p className="text-sm text-muted-foreground">No sessions yet.</p>
						) : (
							<ul className="flex flex-col divide-y text-sm">
								{sessions.map((session) => (
									<li
										key={session.id}
										className="flex flex-wrap items-center justify-between gap-2 py-2"
									>
										<span className="flex flex-col gap-0.5">
											<span>{session.whenText}</span>
											<span className="text-muted-foreground">
												{SESSION_KIND_LABELS[session.kind] ?? session.kind} with{" "}
												{session.artistName ?? "Unknown artist"}
											</span>
										</span>
										<Badge
											variant={
												session.status === "scheduled" ? "secondary" : "outline"
											}
										>
											{SESSION_STATUS_LABELS[session.status] ?? session.status}
										</Badge>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
```

3. Replace `<QuoteSummary quote={quote} />` with `<QuoteSummary quote={quote} showExpiry={quoteExpiryShown} />`, and replace the `QuoteSummary` function with:

```tsx
function QuoteSummary({
	quote,
	showExpiry,
}: {
	quote: QuoteProps;
	showExpiry: boolean;
}) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt className="text-muted-foreground">Version</dt>
			<dd>{quote.version}</dd>
			<dt className="text-muted-foreground">Price</dt>
			<dd>
				{quote.priceText}
				{quote.kind === "hourly" && ` ≈ ${quote.totalText}`}
			</dd>
			<dt className="text-muted-foreground">Deposit</dt>
			<dd>{quote.depositText}</dd>
			{showExpiry && (
				<>
					<dt className="text-muted-foreground">Valid until</dt>
					<dd className="flex items-center gap-2">
						{quote.validUntilText}
						{quote.expired && <Badge variant="destructive">Expired</Badge>}
					</dd>
				</>
			)}
			<dt className="text-muted-foreground">Issued</dt>
			<dd>{quote.issuedText}</dd>
		</dl>
	);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts`
Expected: PASS (all, the two new ones included). Then `pnpm typecheck`: clean. Then from the repo root `pnpm exec biome check --write apps/platform/inertia/pages/projects/show.tsx apps/platform/inertia/components/projects.ts apps/platform/app/controllers/projects_controller.ts apps/platform/app/modules/projects/quotes.ts`: clean.

- [ ] **Step 7: Commit**

```bash
git add app/modules/projects/quotes.ts app/controllers/projects_controller.ts inertia/components/projects.ts inertia/pages/projects/show.tsx tests/functional/projects/project_page.spec.ts
git commit -m "feat(platform): show a project's sessions and drop the quote expiry once booked"
```

---

### Task 6: The booking page and route

**Files:**
- Create: `apps/platform/inertia/components/bookings.ts`
- Create: `apps/platform/inertia/pages/projects/new.tsx`
- Create: `apps/platform/app/controllers/bookings_controller.ts`
- Modify: `apps/platform/start/routes.ts` (the projects group)
- Modify: `apps/platform/tests/isolation/cases.ts` (two cases)
- Generated: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/projects/bookings_http.spec.ts`

**Interfaces:**
- Consumes: `BookingService.bookableArtists` / `book`, `type Booking` (Task 3); `bookingValidator`, `toBookingInput` (Task 4); `PHONE_MESSAGE`, `normalizePhone` from `#validators/phone`; `sessionTimeText` (Task 1); `ClientService.findByPhone`; `todayIn`.
- Produces: routes `tenant.projects.create` (`GET /t/:tenant/projects/new`) and `tenant.projects.store` (`POST /t/:tenant/projects`); Inertia page `projects/new` with props `BookingPageProps` from `~/components/bookings`; `BookingsController` (`controllers.Bookings`) with `create` and `store`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/projects/bookings_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import ProjectSession from "#modules/scheduling/models/project_session";
import { sessionTimeText } from "#modules/scheduling/times";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	makeArtist,
	makeClient,
	pipelineCounts,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const KTM = "Asia/Kathmandu";
const bookUrl = "/t/black-needle/projects";
const newUrl = (phone?: string) =>
	phone === undefined
		? "/t/black-needle/projects/new"
		: `/t/black-needle/projects/new?phone=${encodeURIComponent(phone)}`;
const projectUrl = (id: string) => `/t/black-needle/projects/${id}`;

/** yyyy-MM-dd `days` from today in Kathmandu (the test studios' zone). */
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

/** `time` on `day` in Kathmandu. */
const at = (day: string, time = "14:00") =>
	DateTime.fromISO(`${day}T${time}`, { zone: KTM });

/** A booking form for a new client, Maya, as the browser sends it. */
const newClientForm = (
	artistId: string,
	over: Record<string, string> = {},
) => ({
	phone: "+9779812345678",
	name: "Maya Gurung",
	email: "",
	artistId,
	date: dayFromNow(3),
	startTime: "14:00",
	hours: "3",
	brief: "A small rose on the left wrist",
	priceKind: "none",
	...over,
});

const countsIn = (tenant: { id: string }) =>
	inTenant(tenant, () => pipelineCounts(tenant));

/** An artist member with a live profile ("Asha") linked to their account. */
async function linkedArtist(tenant: Tenant, slug = "asha") {
	const user = await artistIn(tenant, `${slug}@example.com`);
	const profile = await inTenant(tenant, () =>
		Artist.create({ tenantId: tenant.id, name: "Asha", slug, userId: user.id }),
	);
	return { user, profile };
}

test.group("Booking page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner starts at the lookup with the studio's artists", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Ram", slug: "ram" });
			await makeArtist(tenant);
		});

		const response = await client.get(newUrl()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("projects/new");
		const props = response.inertiaProps;
		assert.isNull(props.lookup);
		assert.deepEqual(
			props.artists.map(({ name }: { name: string }) => name),
			["Ram", "Sita"],
		);
		assert.isTrue(props.isOwner);
		assert.deepEqual(props.dates, {
			today: dayFromNow(0),
			max: DateTime.fromISO(dayFromNow(0))
				.plus({ years: 1 })
				.toFormat("yyyy-MM-dd"),
		});
	});

	test("a number is looked up in this studio only, however it is typed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const maya = await inTenant(tenant, () =>
			makeClient(tenant, {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
			}),
		);
		await inTenant(other, () =>
			makeClient(other, { name: "Elsewhere", phone: "+9779841111111" }),
		);
		const lookup = async (typed: string) =>
			(await client.get(newUrl(typed)).withInertia().loginAs(owner))
				.inertiaProps.lookup;

		for (const typed of ["9812345678", "981-234-5678", "+977 981 234 5678"]) {
			assert.deepEqual(
				await lookup(typed),
				{
					state: "found",
					phone: "+9779812345678",
					client: { id: maya.id, name: "Maya Gurung" },
				},
				typed,
			);
		}
		// Another studio's client: nobody here has the number.
		assert.deepEqual(await lookup("9841111111"), {
			state: "new",
			phone: "+9779841111111",
		});
		assert.deepEqual(await lookup("12ab"), {
			state: "invalid",
			typed: "12ab",
			message: "Enter a phone number, like 9812345678 or +977 1 4123456.",
		});
		assert.isNull(await lookup("   "));
	});

	test("an artist gets only their own profile; without one, none", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () => makeArtist(tenant));
		const { user, profile } = await linkedArtist(tenant);
		const stranger = await artistIn(tenant, "ram@example.com");

		const own = (await client.get(newUrl()).withInertia().loginAs(user))
			.inertiaProps;
		assert.deepEqual(own.artists, [{ id: profile.id, name: "Asha" }]);
		assert.isFalse(own.isOwner);

		const none = (await client.get(newUrl()).withInertia().loginAs(stranger))
			.inertiaProps;
		assert.deepEqual(none.artists, []);
	});
});

test.group("Booking a session", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner books a new client: a booked project with its session, no quote", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () => makeArtist(tenant));
		const day = dayFromNow(3);

		const response = await client
			.post(bookUrl)
			.form(newClientForm(sita.id, { date: day, email: "maya@example.com" }))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const saved = await inTenant(tenant, async () => {
			const maya = await Client.query()
				.where("tenant_id", tenant.id)
				.where("phone", "+9779812345678")
				.firstOrFail();
			const project = await TattooProject.query()
				.where("client_id", maya.id)
				.firstOrFail();
			return {
				maya,
				project,
				sessions: await ProjectSession.query().where("project_id", project.id),
				quotes: await Quote.query().where("project_id", project.id),
			};
		});
		response.assertHeader("location", projectUrl(saved.project.id));
		response.assertFlashMessage(
			"success",
			`Session booked: Maya Gurung with Sita, ${sessionTimeText(at(day), at(day).plus({ hours: 3 }), KTM)}.`,
		);
		assert.include(saved.maya.serialize(), {
			name: "Maya Gurung",
			email: "maya@example.com",
			notes: null,
		});
		assert.include(saved.project.serialize(), {
			status: "booked",
			artistId: sita.id,
			inquiryId: null,
			brief: "A small rose on the left wrist",
		});
		assert.lengthOf(saved.sessions, 1);
		assert.include(saved.sessions[0].serialize(), {
			kind: "tattoo",
			status: "scheduled",
			artistId: sita.id,
		});
		assert.equal(saved.sessions[0].startsAt.toMillis(), at(day).toMillis());
		assert.equal(
			saved.sessions[0].endsAt.toMillis(),
			at(day).plus({ hours: 3 }).toMillis(),
		);
		assert.lengthOf(saved.quotes, 0);
	});

	test("a returning client is booked as they are, with a fixed price", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { sita, maya } = await inTenant(tenant, async () => ({
			sita: await makeArtist(tenant),
			maya: await makeClient(tenant, {
				name: "Maya Gurung",
				email: "old@example.com",
				notes: "Allergic to latex",
			}),
		}));
		const before = await inTenant(tenant, async () =>
			(await Client.findOrFail(maya.id)).serialize(),
		);
		const day = dayFromNow(5);

		const response = await client
			.post(bookUrl)
			.form({
				clientId: maya.id,
				artistId: sita.id,
				date: day,
				startTime: "10:30",
				hours: "2.5",
				brief: "Flash: a swallow",
				priceKind: "fixed",
				fixedPrice: "8000",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			`Session booked: Maya Gurung with Sita, ${sessionTimeText(at(day, "10:30"), at(day, "10:30").plus({ minutes: 150 }), KTM)}.`,
		);
		await inTenant(tenant, async () => {
			assert.deepEqual((await Client.findOrFail(maya.id)).serialize(), before);
			const project = await TattooProject.query()
				.where("client_id", maya.id)
				.firstOrFail();
			const quotes = await Quote.query().where("project_id", project.id);
			assert.lengthOf(quotes, 1);
			assert.include(quotes[0].serialize(), {
				version: 1,
				kind: "fixed",
				fixedPrice: 800_000,
				depositAmount: 0,
			});
			assert.equal(
				quotes[0].expiresAt.toMillis(),
				expiresAtFor(day, KTM).toMillis(),
			);
		});
	});

	test("an artist books themselves and can open the project", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { user, profile } = await linkedArtist(tenant);

		const response = await client
			.post(bookUrl)
			.form(newClientForm(profile.id))
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		const location = response.headers().location;
		assert.match(location, /^\/t\/black-needle\/projects\/[0-9a-f-]{36}$/);
		const page = await client.get(location).withInertia().loginAs(user);
		page.assertStatus(200);
		assert.equal(page.inertiaProps.project.artistName, "Asha");
	});

	test("the form's own mistakes come back as field errors and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () => makeArtist(tenant));
		const before = await countsIn(tenant);

		for (const [over, field, message] of [
			[{ name: "" }, "name", "Enter the client's name."],
			[{ phone: "", name: "" }, "phone", "Look the client's phone up first."],
			[
				{ date: dayFromNow(-1) },
				"date",
				"Pick a date from today to a year from now.",
			],
			[
				{ hours: "2.1" },
				"hours",
				"Use quarter hours: 0.25, 0.5, 0.75 and so on.",
			],
			[{ brief: "" }, "brief", "Describe the tattoo."],
			[{ priceKind: "fixed" }, "fixedPrice", "Enter the price."],
		] as const) {
			const response = await client
				.post(bookUrl)
				.form(newClientForm(sita.id, over))
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(response, field, message);
		}
		assert.deepEqual(await countsIn(tenant), before);
	});

	test("another studio's client id is a 404 and changes neither studio", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const { sita, mine } = await inTenant(tenant, async () => ({
			sita: await makeArtist(tenant),
			mine: await makeClient(tenant),
		}));
		const theirs = await inTenant(other, () => makeClient(other));
		const form = (clientId: string, day: string) => ({
			clientId,
			artistId: sita.id,
			date: day,
			startTime: "14:00",
			hours: "2",
			brief: "A rose",
			priceKind: "none",
		});

		// The control: the same form with this studio's client books.
		const own = await client
			.post(bookUrl)
			.form(form(mine.id, dayFromNow(3)))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		own.assertStatus(302);

		const before = await countsIn(tenant);
		const otherBefore = await countsIn(other);
		const response = await client
			.post(bookUrl)
			.form(form(theirs.id, dayFromNow(4)))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		response.assertStatus(404);
		assert.deepEqual(await countsIn(tenant), before);
		assert.deepEqual(await countsIn(other), otherBefore);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=bookings_http.spec.ts`
Expected: FAIL: the GET tests get 404 (no `/projects/new` route; `new` is not a uuid, so `:id` doesn't match) and the POST tests get 404 as well; "another studio's client id" fails on its control (404, not 302).

- [ ] **Step 3: The page's prop types**

Create `apps/platform/inertia/components/bookings.ts`:

```ts
/** What the booking page knows about the number typed in step 1 (TAT-43). */
export type BookingLookup =
	| null
	| { state: "invalid"; typed: string; message: string }
	| { state: "found"; phone: string; client: { id: string; name: string } }
	| { state: "new"; phone: string };

export type BookingPageProps = {
	lookup: BookingLookup;
	/** Who this member may book: every live artist for an owner, their own profile for an artist. */
	artists: { id: string; name: string }[];
	isOwner: boolean;
	/** yyyy-MM-dd in the studio's timezone: the first and last bookable day. */
	dates: { today: string; max: string };
};
```

- [ ] **Step 4: The page**

Create `apps/platform/inertia/pages/projects/new.tsx`:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { useState } from "react";
import { urlFor } from "~/client";
import type { BookingLookup, BookingPageProps } from "~/components/bookings";
import Page from "~/components/page";
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
import AppLayout from "~/layouts/app";

type Invalid = Extract<BookingLookup, { state: "invalid" }>;
type Looked = Extract<BookingLookup, { state: "found" | "new" }>;
type Errors = Partial<Record<string, string>>;
type PriceKind = "none" | "fixed" | "hourly";

const PRICE_KINDS: { value: PriceKind; title: string; description: string }[] =
	[
		{ value: "none", title: "No price", description: "Book without one." },
		{
			value: "fixed",
			title: "Fixed price",
			description: "One price for the whole tattoo.",
		},
		{
			value: "hourly",
			title: "Hourly",
			description: "A rate per hour and the hours you expect.",
		},
	];

/** The id of a field's error message, for aria-describedby. */
const errorId = (name: string, errors: Errors) =>
	errors[name] ? `${name}-error` : undefined;

/**
 * Books a walk-in, phone or DM client in one step (TAT-43): look the phone
 * up, then the client, the session and an optional price. The project
 * starts as Booked.
 */
export default function BookingNew({
	lookup,
	artists,
	isOwner,
	dates,
}: BookingPageProps) {
	return (
		<Page
			title="Book a session"
			description="For a walk-in, a call or a message. The project starts as Booked."
		>
			<div className="flex max-w-2xl flex-col gap-6">
				{artists.length === 0 ? (
					<NoArtist isOwner={isOwner} />
				) : lookup === null || lookup.state === "invalid" ? (
					<PhoneLookup invalid={lookup} />
				) : (
					<BookingForm
						lookup={lookup}
						artists={artists}
						isOwner={isOwner}
						dates={dates}
					/>
				)}
			</div>
		</Page>
	);
}

function NoArtist({ isOwner }: { isOwner: boolean }) {
	const tenant = useTenant();

	return (
		<Card>
			<CardContent className="flex flex-col items-start gap-3">
				<p className="text-sm">
					{isOwner
						? "Add an artist before booking a session: every session belongs to one."
						: "Only artists with their own profile can book sessions, and your account isn't linked to one yet."}
				</p>
				{isOwner && (
					<Link
						route="tenant.artists.create"
						routeParams={{ tenant: tenant.slug }}
						className={buttonVariants()}
					>
						Add an artist
					</Link>
				)}
			</CardContent>
		</Card>
	);
}

/** Step 1: a plain GET form, like the clients search; it reloads with ?phone=. */
function PhoneLookup({ invalid }: { invalid: Invalid | null }) {
	const tenant = useTenant();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Client</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					method="get"
					action={urlFor("tenant.projects.create", { tenant: tenant.slug })}
				>
					<Field data-invalid={!!invalid}>
						<FieldLabel htmlFor="phone">Client&apos;s phone</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="phone"
								name="phone"
								type="tel"
								inputMode="tel"
								autoComplete="off"
								required
								defaultValue={invalid?.typed ?? ""}
								aria-invalid={!!invalid}
								aria-describedby={invalid ? "phone-error" : "phone-hint"}
								className="flex-1"
							/>
							<Button type="submit">Find client</Button>
						</div>
						{invalid ? (
							<FieldError id="phone-error">{invalid.message}</FieldError>
						) : (
							<FieldDescription id="phone-hint">
								A returning client is found by their number, so their history
								stays together.
							</FieldDescription>
						)}
					</Field>
				</form>
			</CardContent>
		</Card>
	);
}

/** Step 2: the client the lookup found (or a new one), the session and the price. */
function BookingForm({
	lookup,
	artists,
	isOwner,
	dates,
}: {
	lookup: Looked;
	artists: BookingPageProps["artists"];
	isOwner: boolean;
	dates: BookingPageProps["dates"];
}) {
	const tenant = useTenant();
	const [priceKind, setPriceKind] = useState<PriceKind>("none");

	return (
		<Form route="tenant.projects.store" routeParams={{ tenant: tenant.slug }}>
			{({ errors, processing }) => (
				<div className="flex flex-col gap-6">
					<ClientCard lookup={lookup} isOwner={isOwner} errors={errors} />
					<SessionCard
						artists={artists}
						isOwner={isOwner}
						dates={dates}
						errors={errors}
					/>
					<PriceCard
						priceKind={priceKind}
						onChange={setPriceKind}
						errors={errors}
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" disabled={processing}>
							{processing ? "Saving…" : "Book session"}
						</Button>
						<Link
							route="tenant.projects.index"
							routeParams={{ tenant: tenant.slug }}
							className={buttonVariants({ variant: "ghost" })}
						>
							Cancel
						</Link>
					</div>
				</div>
			)}
		</Form>
	);
}

function ClientCard({
	lookup,
	isOwner,
	errors,
}: {
	lookup: Looked;
	isOwner: boolean;
	errors: Errors;
}) {
	const tenant = useTenant();
	const problem = errors.clientId ?? errors.phone;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Client</CardTitle>
			</CardHeader>
			<CardContent>
				<FieldGroup>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="flex min-w-0 flex-col gap-1">
							{lookup.state === "found" && (
								<span className="font-medium break-words">
									{lookup.client.name}
								</span>
							)}
							<span className="text-sm text-muted-foreground">
								{lookup.phone}
							</span>
						</div>
						{lookup.state === "found" ? (
							<Badge variant="secondary">Returning client</Badge>
						) : (
							<Badge variant="outline">New client</Badge>
						)}
					</div>
					{problem && <FieldError>{problem}</FieldError>}
					{lookup.state === "found" ? (
						<>
							<input type="hidden" name="clientId" value={lookup.client.id} />
							<p className="text-sm text-muted-foreground">
								Their saved name, email and notes stay as they are.
							</p>
						</>
					) : (
						<>
							<input type="hidden" name="phone" value={lookup.phone} />
							<Field data-invalid={!!errors.name}>
								<FieldLabel htmlFor="name">Name</FieldLabel>
								<Input
									id="name"
									name="name"
									maxLength={120}
									required
									aria-invalid={!!errors.name}
									aria-describedby={errorId("name", errors)}
								/>
								{errors.name && (
									<FieldError id="name-error">{errors.name}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!errors.email}>
								<FieldLabel htmlFor="email">Email (optional)</FieldLabel>
								<Input
									id="email"
									name="email"
									type="email"
									maxLength={254}
									aria-invalid={!!errors.email}
									aria-describedby={errorId("email", errors)}
								/>
								{errors.email && (
									<FieldError id="email-error">{errors.email}</FieldError>
								)}
							</Field>
						</>
					)}
					<div className="flex flex-wrap gap-2">
						<Link
							route="tenant.projects.create"
							routeParams={{ tenant: tenant.slug }}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							Change number
						</Link>
						{isOwner && lookup.state === "found" && (
							<Link
								route="tenant.clients.show"
								routeParams={{ tenant: tenant.slug, id: lookup.client.id }}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								View client
							</Link>
						)}
					</div>
				</FieldGroup>
			</CardContent>
		</Card>
	);
}

function SessionCard({
	artists,
	isOwner,
	dates,
	errors,
}: {
	artists: BookingPageProps["artists"];
	isOwner: boolean;
	dates: BookingPageProps["dates"];
	errors: Errors;
}) {
	// An artist member only ever gets their own profile.
	const own = isOwner ? null : artists[0];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Session</CardTitle>
			</CardHeader>
			<CardContent>
				<FieldGroup>
					{own ? (
						<Field data-invalid={!!errors.artistId}>
							<FieldTitle>Artist</FieldTitle>
							<p className="text-sm">{own.name} (you)</p>
							<input type="hidden" name="artistId" value={own.id} />
							{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
						</Field>
					) : (
						<Field data-invalid={!!errors.artistId}>
							<FieldLabel htmlFor="artistId">Artist</FieldLabel>
							<select
								id="artistId"
								name="artistId"
								required
								defaultValue={artists.length === 1 ? artists[0].id : ""}
								aria-invalid={!!errors.artistId}
								aria-describedby={errorId("artistId", errors)}
								className="h-9 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm"
							>
								{artists.length > 1 && (
									<option value="" disabled>
										Choose an artist
									</option>
								)}
								{artists.map(({ id, name }) => (
									<option key={id} value={id}>
										{name}
									</option>
								))}
							</select>
							{errors.artistId && (
								<FieldError id="artistId-error">{errors.artistId}</FieldError>
							)}
						</Field>
					)}
					<div className="grid gap-4 sm:grid-cols-3">
						<Field data-invalid={!!errors.date}>
							<FieldLabel htmlFor="date">Date</FieldLabel>
							<Input
								id="date"
								name="date"
								type="date"
								required
								min={dates.today}
								max={dates.max}
								defaultValue={dates.today}
								aria-invalid={!!errors.date}
								aria-describedby={errorId("date", errors)}
							/>
							{errors.date && (
								<FieldError id="date-error">{errors.date}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.startTime}>
							<FieldLabel htmlFor="startTime">Start time</FieldLabel>
							<Input
								id="startTime"
								name="startTime"
								type="time"
								required
								aria-invalid={!!errors.startTime}
								aria-describedby={errorId("startTime", errors)}
							/>
							{errors.startTime && (
								<FieldError id="startTime-error">{errors.startTime}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.hours}>
							<FieldLabel htmlFor="hours">Length (hours)</FieldLabel>
							<Input
								id="hours"
								name="hours"
								type="number"
								inputMode="decimal"
								required
								min={0.25}
								max={12}
								step={0.25}
								aria-invalid={!!errors.hours}
								aria-describedby={errors.hours ? "hours-error" : "hours-hint"}
							/>
							{errors.hours ? (
								<FieldError id="hours-error">{errors.hours}</FieldError>
							) : (
								<FieldDescription id="hours-hint">
									In quarter hours: 2.5 for two and a half.
								</FieldDescription>
							)}
						</Field>
					</div>
					<Field data-invalid={!!errors.brief}>
						<FieldLabel htmlFor="brief">What&apos;s the tattoo?</FieldLabel>
						<Textarea
							id="brief"
							name="brief"
							rows={3}
							maxLength={4000}
							required
							aria-invalid={!!errors.brief}
							aria-describedby={errors.brief ? "brief-error" : "brief-hint"}
						/>
						{errors.brief ? (
							<FieldError id="brief-error">{errors.brief}</FieldError>
						) : (
							<FieldDescription id="brief-hint">
								A few words for the project page, like small rose on the left
								wrist.
							</FieldDescription>
						)}
					</Field>
				</FieldGroup>
			</CardContent>
		</Card>
	);
}

function PriceCard({
	priceKind,
	onChange,
	errors,
}: {
	priceKind: PriceKind;
	onChange: (kind: PriceKind) => void;
	errors: Errors;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Price (optional)</CardTitle>
			</CardHeader>
			<CardContent>
				<FieldGroup>
					<FieldSet data-invalid={!!errors.priceKind}>
						<FieldLegend className="sr-only">Pricing</FieldLegend>
						<RadioGroup
							name="priceKind"
							value={priceKind}
							onValueChange={(value) =>
								onChange(
									value === "fixed" || value === "hourly" ? value : "none",
								)
							}
						>
							{PRICE_KINDS.map(({ value, title, description }) => (
								<FieldLabel key={value} htmlFor={`priceKind-${value}`}>
									<Field orientation="horizontal">
										<FieldContent>
											<FieldTitle>{title}</FieldTitle>
											<FieldDescription>{description}</FieldDescription>
										</FieldContent>
										<RadioGroupItem value={value} id={`priceKind-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.priceKind && <FieldError>{errors.priceKind}</FieldError>}
					</FieldSet>

					{priceKind === "fixed" && (
						<Field data-invalid={!!errors.fixedPrice}>
							<FieldLabel htmlFor="fixedPrice">Price (NPR)</FieldLabel>
							<Input
								id="fixedPrice"
								name="fixedPrice"
								type="number"
								inputMode="numeric"
								required
								min={1}
								step={1}
								aria-invalid={!!errors.fixedPrice}
								aria-describedby={errorId("fixedPrice", errors)}
							/>
							{errors.fixedPrice && (
								<FieldError id="fixedPrice-error">
									{errors.fixedPrice}
								</FieldError>
							)}
						</Field>
					)}
					{priceKind === "hourly" && (
						<>
							<Field data-invalid={!!errors.hourlyRate}>
								<FieldLabel htmlFor="hourlyRate">
									Rate per hour (NPR)
								</FieldLabel>
								<Input
									id="hourlyRate"
									name="hourlyRate"
									type="number"
									inputMode="numeric"
									required
									min={1}
									step={1}
									aria-invalid={!!errors.hourlyRate}
									aria-describedby={errorId("hourlyRate", errors)}
								/>
								{errors.hourlyRate && (
									<FieldError id="hourlyRate-error">
										{errors.hourlyRate}
									</FieldError>
								)}
							</Field>
							<Field data-invalid={!!errors.estimatedHours}>
								<FieldLabel htmlFor="estimatedHours">
									Estimated hours
								</FieldLabel>
								<Input
									id="estimatedHours"
									name="estimatedHours"
									type="number"
									inputMode="decimal"
									required
									min={0.25}
									step={0.25}
									aria-invalid={!!errors.estimatedHours}
									aria-describedby={errorId("estimatedHours", errors)}
								/>
								{errors.estimatedHours && (
									<FieldError id="estimatedHours-error">
										{errors.estimatedHours}
									</FieldError>
								)}
							</Field>
						</>
					)}

					<FieldDescription>
						No deposit is asked: the client is booked now. The price can&apos;t
						be changed after booking.
					</FieldDescription>
				</FieldGroup>
			</CardContent>
		</Card>
	);
}

BookingNew.layout = [AppLayout];
```

- [ ] **Step 5: The controller**

Create `apps/platform/app/controllers/bookings_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { todayIn } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BookingService from "#modules/projects/services/booking_service";
import {
	bookingValidator,
	toBookingInput,
} from "#modules/projects/validators/booking";
import { sessionTimeText } from "#modules/scheduling/times";
import type Tenant from "#modules/tenancy/models/tenant";
import { normalizePhone, PHONE_MESSAGE } from "#validators/phone";

/** What the page knows about the number typed in step 1. */
type Lookup =
	| null
	| { state: "invalid"; typed: string; message: string }
	| { state: "found"; phone: string; client: { id: string; name: string } }
	| { state: "new"; phone: string };

/** The longest typed number the page echoes back. */
const MAX_TYPED = 40;

/**
 * Booking a walk-in, phone or DM client in one step (TAT-43): look the
 * phone up, then book. Owners and artists (the projects group); which
 * artists a member may book, and everything the booking writes, is
 * BookingService's.
 */
@inject()
export default class BookingsController {
	constructor(
		private bookings: BookingService,
		private clients: ClientService,
	) {}

	async create(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const artists = await this.bookings.bookableArtists(tenant, membership);
		const phone = ctx.request.qs().phone;
		const typed =
			typeof phone === "string" ? phone.trim().slice(0, MAX_TYPED) : "";
		const today = todayIn(tenant.timezone);

		return ctx.inertia.render("projects/new", {
			lookup: await this.lookup(tenant, typed),
			artists: artists.map(({ id, name }) => ({ id, name })),
			isOwner: membership.role === "owner",
			dates: {
				today,
				max: DateTime.fromISO(today, { zone: "utc" })
					.plus({ years: 1 })
					.toFormat("yyyy-MM-dd"),
			},
		});
	}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const form = await ctx.request.validateUsing(bookingValidator);
		const booking = toBookingInput(form, tenant.timezone);
		const { project, session, client, artist } = await this.bookings.book(
			tenant,
			membership,
			booking,
		);

		ctx.session.flash(
			"success",
			`Session booked: ${client.name} with ${artist.name}, ${sessionTimeText(session.startsAt, session.endsAt, tenant.timezone)}.`,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	/**
	 * The client with the typed number in this studio, if any. Only the name
	 * is shown (artists use the lookup too).
	 */
	private async lookup(tenant: Pick<Tenant, "id">, typed: string): Promise<Lookup> {
		if (!typed) return null;
		const phone = normalizePhone(typed);
		if (!phone) return { state: "invalid", typed, message: PHONE_MESSAGE };
		const client = await this.clients.findByPhone(tenant, phone);
		return client
			? { state: "found", phone, client: { id: client.id, name: client.name } }
			: { state: "new", phone };
	}
}
```

- [ ] **Step 6: The routes**

In `apps/platform/start/routes.ts`, inside the projects group, add these two routes first (above `router.get("/", [controllers.Projects, "index"])`):

```ts
				router
					.get("new", [controllers.Bookings, "create"])
					.as("tenant.projects.create");
				router
					.post("/", [controllers.Bookings, "store"])
					.as("tenant.projects.store");
```

and extend the group's comment to: "Projects: owners, and the artist assigned to the project (ProjectService.findFor gives anyone else a 404). Booking a session (new, store) is open to both; BookingService decides which artists a member may book. Every projects route goes in this group (a test checks)."

- [ ] **Step 7: The isolation cases**

In `apps/platform/tests/isolation/cases.ts`, add `import ProjectSession from "#modules/scheduling/models/project_session";` to the imports, add this snapshot after `clientRows`:

```ts
// What a booking can create: projects, quotes, sessions and clients,
// deleted ones included.
const bookingRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((project) => project.serialize()),
		quotes: (
			await Quote.query().where("tenant_id", target.tenant.id).orderBy("id")
		).map((quote) => quote.serialize()),
		sessions: (
			await ProjectSession.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((session) => session.serialize()),
		clients: (
			await Client.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((client) => client.serialize()),
	}));
```

and add these two cases right after the `GET /t/:tenant/projects` case:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/projects/new",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects",
		actor: "owner",
		body: (own) => ({
			clientId: own.client.id,
			artistId: own.artistProfile.id,
			// The test studios' timezone; a month out, so the artist is free.
			date: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 30 })
				.toFormat("yyyy-MM-dd"),
			startTime: "10:00",
			hours: "2",
			brief: "Walk-in: a small rose",
			priceKind: "fixed",
			fixedPrice: "5000",
		}),
		ownStatus: 302,
		snapshot: bookingRows,
	},
```

- [ ] **Step 8: Regenerate types**

Run: `node ace codegen`
Expected: `.adonisjs/server/controllers.ts` gains `Bookings`, `.adonisjs/server/pages.d.ts` gains `projects/new`, and the route registry gains `tenant.projects.create` / `tenant.projects.store`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=bookings_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=project_page.spec.ts`
Expected: PASS (the 8 new HTTP tests, the route guard with the new routes, both new isolation cases). Then `pnpm typecheck`: clean. Then from the repo root: `pnpm exec biome check --write apps/platform/app/controllers/bookings_controller.ts apps/platform/inertia/pages/projects/new.tsx apps/platform/inertia/components/bookings.ts apps/platform/start/routes.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/projects/bookings_http.spec.ts`: clean.

- [ ] **Step 10: Commit**

```bash
git add app/controllers/bookings_controller.ts inertia/components/bookings.ts inertia/pages/projects/new.tsx start/routes.ts tests/isolation/cases.ts tests/functional/projects/bookings_http.spec.ts .adonisjs
git commit -m "feat(platform): book a walk-in, phone or DM client from the dashboard"
```

---

### Task 7: Refused bookings as field errors

**Files:**
- Modify: `apps/platform/app/controllers/bookings_controller.ts` (`store`, new `refuse`)
- Test: `apps/platform/tests/functional/projects/bookings_http.spec.ts` (new group at the end)

**Interfaces:**
- Consumes: `SessionOverlapError` (`#modules/scheduling/errors`), `ClientRuleError` (`#modules/clients/errors`), `BookingRuleError` (Task 3), `type Booking`, `type DirectBooking` (Task 3).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing tests**

Add `makeProject` and `makeSession` to the `#tests/helpers/pipeline` import of `apps/platform/tests/functional/projects/bookings_http.spec.ts`, then append:

```ts
test.group("Refused bookings", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a busy artist: the start time gets the error and nothing is saved, the second of two identical forms included", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const day = dayFromNow(4);
		const sita = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const busy = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			await makeSession(tenant, busy, sita, {
				startsAt: at(day, "15:00"),
				endsAt: at(day, "18:00"),
			});
			return sita;
		});
		const send = (over: Record<string, string>) =>
			client
				.post(bookUrl)
				.form(newClientForm(sita.id, { date: day, ...over }))
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
		const before = await countsIn(tenant);

		// 14:00 to 16:00 runs into the 15:00 session.
		const busy = await send({ startTime: "14:00", hours: "2" });
		assertValidationError(
			busy,
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		assert.deepEqual(await countsIn(tenant), before);

		// The same free slot sent twice (a double tap): one booking only.
		const first = await send({ startTime: "10:00", hours: "2" });
		first.assertStatus(302);
		// Another new client, with a number nextPhone() never makes.
		const twice = await send({
			startTime: "10:00",
			hours: "2",
			phone: "+9779851234567",
			name: "Someone Else",
		});
		assertValidationError(
			twice,
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		const after = await countsIn(tenant);
		assert.equal(after.projects, before.projects + 1);
		assert.equal(after.clients, before.clients + 1);
	});

	test("a number added meanwhile: the phone error names its client", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Ram Thapa", phone: "+9779812345678" });
			return makeArtist(tenant);
		});
		const before = await countsIn(tenant);

		const response = await client
			.post(bookUrl)
			.form(newClientForm(sita.id))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"phone",
			"This number now belongs to Ram Thapa. Check the client and book again.",
		);
		assert.deepEqual(await countsIn(tenant), before);
	});

	test("an artist can't book someone else; an owner can't book a deleted or another studio's artist", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const { user } = await linkedArtist(tenant);
		const { sita, gone } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			return { sita, gone };
		});
		const elsewhere = await inTenant(other, () => makeArtist(other));
		const before = await countsIn(tenant);
		const otherBefore = await countsIn(other);

		for (const [actor, artistId] of [
			[user, sita.id],
			[owner, gone.id],
			[owner, elsewhere.id],
		] as const) {
			const response = await client
				.post(bookUrl)
				.form(newClientForm(artistId))
				.withCsrfToken()
				.loginAs(actor)
				.redirects(0);
			assertValidationError(
				response,
				"artistId",
				"Choose an artist from the list.",
			);
		}
		assert.deepEqual(await countsIn(tenant), before);
		assert.deepEqual(await countsIn(other), otherBefore);
	});

	test("a client whose details were deleted goes back to the lookup", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { sita, anonymous } = await inTenant(tenant, async () => ({
			sita: await makeArtist(tenant),
			anonymous: await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.now(),
			}),
		}));
		const before = await countsIn(tenant);

		const response = await client
			.post(bookUrl)
			.form({
				clientId: anonymous.id,
				artistId: sita.id,
				date: dayFromNow(3),
				startTime: "14:00",
				hours: "2",
				brief: "A rose",
				priceKind: "none",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", newUrl());
		response.assertFlashMessage(
			"error",
			"This client's details were deleted. Look the number up again.",
		);
		assert.deepEqual(await countsIn(tenant), before);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=bookings_http.spec.ts`
Expected: FAIL, the four new tests: the refusals are unhandled errors (status 500, no `inputErrorsBag`, no redirect to the lookup).

- [ ] **Step 3: Turn refusals into what the page shows**

In `apps/platform/app/controllers/bookings_controller.ts`:

1. Add the imports:

```ts
import { errors } from "@vinejs/vine";
import { ClientRuleError } from "#modules/clients/errors";
import { BookingRuleError } from "#modules/projects/errors";
import { SessionOverlapError } from "#modules/scheduling/errors";
```

and change the `BookingService` import to `import BookingService, { type Booking, type DirectBooking } from "#modules/projects/services/booking_service";` (keep its biome-ignore comment above it).

2. Replace `store` with:

```ts
	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const form = await ctx.request.validateUsing(bookingValidator);
		const booking = toBookingInput(form, tenant.timezone);
		let booked: Booking;
		try {
			booked = await this.bookings.book(tenant, membership, booking);
		} catch (error) {
			return this.refuse(ctx, error, booking);
		}
		const { project, session, client, artist } = booked;

		ctx.session.flash(
			"success",
			`Session booked: ${client.name} with ${artist.name}, ${sessionTimeText(session.startsAt, session.endsAt, tenant.timezone)}.`,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	/**
	 * What the page shows for a refused booking: a field error, or back to
	 * the lookup for a client whose details were deleted. The booking's
	 * savepoint was already rolled back, so these reads are safe and nothing
	 * was saved. Anything else (another studio's client: a 404) goes on up.
	 */
	private async refuse(
		ctx: HttpContext,
		error: unknown,
		booking: DirectBooking,
	) {
		const { tenant, membership } = tenantContext(ctx);
		if (error instanceof SessionOverlapError) {
			const artist = (
				await this.bookings.bookableArtists(tenant, membership)
			).find(({ id }) => id === booking.artistId);
			throw fieldError(
				"startTime",
				`${artist?.name ?? "The artist"} already has a session at that time. Pick another time.`,
				"overlap",
			);
		}
		if (
			error instanceof ClientRuleError &&
			error.reason === "phone_taken" &&
			booking.client.kind === "new"
		) {
			const holder = await this.clients.findByPhone(
				tenant,
				booking.client.phone,
			);
			throw fieldError(
				"phone",
				`This number now belongs to ${holder?.name ?? "another client"}. Check the client and book again.`,
				"unique",
			);
		}
		if (error instanceof BookingRuleError) {
			if (error.reason === "artist_unavailable") {
				throw fieldError("artistId", "Choose an artist from the list.", "exists");
			}
			ctx.session.flash(
				"error",
				"This client's details were deleted. Look the number up again.",
			);
			return ctx.response
				.redirect()
				.toRoute("tenant.projects.create", { tenant: tenant.slug });
		}
		throw error;
	}
```

3. Add at the end of the file:

```ts
/** A field error shown next to `field`, like the validator's own. */
function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=bookings_http.spec.ts --files=cross_tenant.spec.ts`
Expected: PASS (all; the four new ones included). Then `pnpm typecheck`: clean; `pnpm exec biome check --write apps/platform/app/controllers/bookings_controller.ts apps/platform/tests/functional/projects/bookings_http.spec.ts` from the root: clean.

- [ ] **Step 5: Commit**

```bash
git add app/controllers/bookings_controller.ts tests/functional/projects/bookings_http.spec.ts
git commit -m "feat(platform): show refused bookings as field errors"
```

---

### Task 8: Ways in: projects list and client profile

**Files:**
- Modify: `apps/platform/inertia/pages/projects/index.tsx` (header button)
- Modify: `apps/platform/inertia/pages/clients/show.tsx` (button)
- Modify: `apps/platform/inertia/pages/clients/index.tsx` (empty-state text)

**Interfaces:**
- Consumes: the `tenant.projects.create` route (Task 6).

These are links and copy only: no server behavior changes, so the check is typecheck, build and the browser pass (the page they open is covered by Task 6's tests, `?phone=` lookups included).

- [ ] **Step 1: Projects list**

In `apps/platform/inertia/pages/projects/index.tsx`, replace `<Page title="Projects">` with:

```tsx
		<Page
			title="Projects"
			actions={
				<Link
					href={urlFor("tenant.projects.create", { tenant: tenant.slug })}
					className={buttonVariants({ size: "sm" })}
				>
					Book session
				</Link>
			}
		>
```

(`Link`, `urlFor` and `buttonVariants` are already imported there.)

- [ ] **Step 2: Client profile**

In `apps/platform/inertia/pages/clients/show.tsx`, right after the `Edit details` `<Link>` block (inside the same `<div className="flex flex-wrap gap-2">`), add:

```tsx
							{client.phone && !client.anonymized && (
								<Link
									href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}?phone=${encodeURIComponent(client.phone)}`}
									className={buttonVariants({ variant: "outline" })}
								>
									Book session
								</Link>
							)}
```

In `apps/platform/inertia/pages/clients/index.tsx`, change `"No clients yet. They appear when an inquiry arrives."` to `"No clients yet. They appear when an inquiry arrives or you book a session."`.

- [ ] **Step 3: Check**

Run: `pnpm typecheck` (clean); from the root `pnpm exec biome check --write apps/platform/inertia/pages/projects/index.tsx apps/platform/inertia/pages/clients/show.tsx apps/platform/inertia/pages/clients/index.tsx` (clean); `PORT=3402 pnpm test functional --files=clients_pages.spec.ts --files=projects_list.spec.ts` (PASS, unchanged).

- [ ] **Step 4: Commit**

```bash
git add inertia/pages/projects/index.tsx inertia/pages/clients/show.tsx inertia/pages/clients/index.tsx
git commit -m "feat(platform): link to booking from the projects list and client profiles"
```

---

### Task 9: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md` (Scheduling and Clients bullets)
- Modify: `docs/requirements.md` (Sessions)

`docs/README.md` needs no change (no new document).

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`, section "Scheduling", add this bullet right after the first bullet (the TAT-36 one, starting "- Scheduling (TAT-36)"):

```markdown
- Direct bookings (TAT-43): `BookingService` (`#modules/projects/services/booking_service`) books a walk-in, phone or DM client in one step. `bookableArtists(tenant, member)`: every live artist for an owner, only the live profile linked to them for an artist. `book(tenant, member, booking)` refuses any other artist (`BookingRuleError` `artist_unavailable`) and then, in one `withTransaction`, takes the client (`ClientService.findFor` for a found one, which the booking never changes; `client_unavailable` for an anonymized one; `ClientService.create` for a new one), creates a `booked` project with no inquiry, its artist set and `last_contacted_at` now, inserts the optional quick quote with `QuoteService.create` (version 1, deposit 0, valid through the session's day) and schedules one `tattoo` session through `SessionService.schedule`. An overlap (`SessionOverlapError`), a number taken meanwhile (`ClientRuleError` `phone_taken`) or another tenant's client (E_ROW_NOT_FOUND) rolls the whole booking back; `BookingsController` turns them into field errors (a 404 for the foreign client). The quick quote does not go through `issueQuote` and queues no `ExpireQuoteJob`: expiry only acts on `quoted`, `on_hold` and `deposit_pending`, which a booked project never returns to. From `booked` on (`BOOKED_STATUSES` in `#modules/projects/quotes`) the project page hides the quote's expiry, and a booked project's price can't change (quotes are locked from `booked`; recording a final price is TAT-66's). The page is `/t/:tenant/projects/new` (`?phone=` looks the number up in the tenant; only the name is shown, since artists use it too) and posts to `/t/:tenant/projects`. Session times are the studio's: `localDateTime` (a time the clocks skip is null, one they pass twice is its first occurrence) and `sessionTimeText` in `#modules/scheduling/times`; the project page lists its sessions with them.
```

In the "Clients (TAT-41)" bullet, change "`findByPhone` (E.164; what intake, TAT-51, and walk-ins, TAT-43, match on)," to "`findByPhone` (E.164; what intake, TAT-51, and direct bookings, TAT-43, match on), `create` (a booking's new client, TAT-43; `ClientRuleError` `phone_taken` from the same index),".

- [ ] **Step 2: Requirements**

In `docs/requirements.md`, under **Sessions**, after "- [ ] Walk-ins and phone or DM bookings: create the project and the session directly", add:

```markdown
- A direct booking looks the client up by phone first and never changes a returning client's details. The project starts Booked with its tattoo session, an optional price and no deposit step; the price can't be changed after booking. Owners book for any artist, artists only for themselves.
```

- [ ] **Step 3: Commit (from the repo root)**

```bash
git add apps/platform/docs/backend.md docs/requirements.md
git commit -m "docs(platform): document direct bookings"
```

---

### Task 10: Final verification

- [ ] **Step 1: Generated files are current**

Run in `apps/platform`: `node ace codegen`, then `git status --short`.
Expected: no changes (Task 6 committed `.adonisjs/`). If `.adonisjs/` changed, commit it with `chore(platform): regenerate types`.

- [ ] **Step 2: Root gates**

From the repo root: `pnpm check`, `pnpm typecheck`, `pnpm build`.
Expected: all clean (`pnpm check` keeps its 2 pre-existing warnings in `inertia/ssr.tsx` and `inertia/types.ts`).

- [ ] **Step 3: Full suite**

In `apps/platform`: `PORT=3402 node ace test` with `run_in_background`, and wait for the notification (about 2 minutes).
Expected: all pass, about 36 more than the 767 on c1ade0e (Task 1: 5, Task 2: 2, Task 3: 5, Task 4: 8, Task 5: 2, Task 6: 8 + 2 isolation cases, Task 7: 4). Report the exact count.

- [ ] **Step 4: Schema untouched, tree clean**

Run: `git diff c1ade0e --stat -- apps/platform/database` (expected: empty) and `git status -sb` (expected: clean). `git log --oneline c1ade0e..HEAD` lists the spec/plan commit and the tasks' commits.

- [ ] **Step 5: PR text (not committed)**

Write the PR text to the scratchpad (`pr-tat-43.md`): a few "what and why" bullets per change (mentor mode), the rulings that change earlier behavior (no `issueQuote` / no expiry job; the project page hides the quote's expiry from `booked` on), and the spec's browser pass as a checklist for the user. Do not push and do not open a PR. Carry-forward comments (TAT-66, TAT-50, TAT-51, TAT-30, as in the spec) are posted when the PR is ready, not in this run.
