# Member invites: invite, revoke, accept, claim an artist profile (TAT-33) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners invite someone by email as an owner or an artist (optionally offering an unlinked artist profile), copy the link once and send it on WhatsApp or Viber; the invitee opens it, signs in with that confirmed address and joins (claiming the profile). Owners list members and pending invitations, renew or cancel an invitation, make a member an owner or an artist, and remove a member (access ends at once, the profile stays, unlinked); the last owner can never go. About 5 points.

**Architecture:** In the tenancy module: the pure `invitations.ts`, the `TenantInvitation` model (table `tenant_invitations`, RLS), `InvitationService` (invite, renew, revoke, pending, preview, accept) and `MemberService` (findFor, remove, changeRole, calling `TenancyService.assertKeepsAnOwner`). A SECURITY DEFINER function `invitation_tenant(requested_hash)` finds an invitation's studio before any context exists. `ArtistService` gains `claim` and `unlinkUser`. Token helpers are TAT-18's (`#modules/identity/account_tokens`), which also gains `INVITATION_TOKEN_KEY` (forgotten at sign-in and sign-out). `MembersController` serves Settings, Members; `InvitationsController` the link, the page and the accept.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, VineJS, Luxon, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4; Tuyau `urlFor`.

**Spec:** `docs/superpowers/specs/2026-10-20-tat-33-member-invites-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides; say which in your report). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **Built on TAT-30.** This plan edits names TAT-30's build adds (`TENANT_ROUTE_ROLES`, `ArtistService.profileOf`, `seededStudio`, `caseRequest`, `role_access.spec.ts`). Task 0 checks them.
- **Migrations (exact names):** `apps/platform/database/migrations/1791693300000_create_tenant_invitations_table.ts` and `1791693300001_create_invitation_tenant_function.ts`. Apply with `pnpm -C <repo>/apps/platform migrate` (owner role); it regenerates `database/schema.ts`, which you commit. They change the dev database other checkouts share: say so in your report (to undo: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate:rollback` from this branch rolls back Task 2's batch). If another branch already used these timestamps, take the next free `17916933000NN` pair and say so.
- **Routes (exact):** under the settings group: `GET members` `tenant.settings.members` (`MembersController.index`), `POST members/invitations` `tenant.settings.members.invitations.store` (`invite`), `POST members/invitations/:id/renew` `tenant.settings.members.invitations.renew` (`renew`), `DELETE members/invitations/:id` `tenant.settings.members.invitations.destroy` (`revoke`), `PUT members/:id/role` `tenant.settings.members.role.update` (`role`), `DELETE members/:id` `tenant.settings.members.destroy` (`remove`); outside any group: `GET /invitations/:token` `invitations.link` (`ACCOUNT_TOKEN`, `throttleAccountLinks`) and `GET /invitations` `invitations.show`; in the signed-in group: `POST /invitations` `invitations.accept` (`verifiedEmail`, `throttleAccountLinks`) (`InvitationsController.link` / `show` / `accept`).
- **No new setting, no email.** Never read or edit `apps/platform/.env`.
- **Copy (verbatim):** see the spec's Words and Screens; every string the code needs is written out in the tasks below.
- Fixture slugs in new tests end in `-33` (`members-33`, …): tests share the dev database, where a slug someone once used stays taken. Tests added to an existing file keep that file's studio.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities only), touch targets 44 px (`h-11`), nothing wider than 375 px.
- Tests: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes a few minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`).
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After controller, route or page changes run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`. A new controller must exist (and codegen run) before `start/routes.ts` can name it as `controllers.<Name>`.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 8), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **Only the invited, confirmed account joins, once.** Wrong account, unconfirmed account, expired, renewed, cancelled or replayed link, a second tab, another invitation's flow: nothing changes. Tests: Task 4 "accept refuses …", "a second accept with the same link finds nothing"; Task 7 "joining is refused …", "an unconfirmed account goes to /confirm-email".
2. **The token never leaves the owner's one page.** Only its SHA-256 is stored; it is in no URL after the link's GET, no page prop of the invitation page, no log. Tests: Task 4 "invite stores only the token's hash …"; Task 7 "the link only stages its token …", "a guest sees … never the token".
3. **The last owner, and yourself.** Removal and demotion of an owner call `assertKeepsAnOwner` in the transaction; nobody acts on their own membership. Tests: Task 5 "the last owner can't be removed or demoted", "after one owner demotes the other, the last one can't be", "nobody removes or changes their own membership here".
4. **Removal ends access and keeps the profile.** Tests: Task 5 "remove soft-deletes the membership and unlinks the member's profiles"; Task 6 "removing a member: their next request is a 404 …".
5. **The claim links only a live, unlinked profile; a taken one doesn't block joining.** Tests: Task 3 `claim` group; Task 4 "a profile taken meanwhile: the person still joins, without it".
6. **Isolation and roles.** Six `cases.ts` entries; TAT-30's table entries (owners) and walk; the definer function returns one tenant id for an exact hash. Tests: `cross_tenant.spec.ts`, `role_access.spec.ts`, `tenant_routes.spec.ts`, `invitation_tenant.spec.ts`, `catalog_guard.spec.ts`.
7. **No account enumeration.** Creating an invitation answers the same whether or not the address has an account; the page offers a guest both ways in. Tests: Task 4 "invite answers the same for an address with or without an account"; Task 7 "a guest sees …".

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> branch --show-current` → `harublank00/tat-33-member-invites-invite-revoke-accept-claim-artist-profile`; `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -- docs/superpowers/plans/2026-10-20-tat-33-member-invites.md | tail -1` → "docs: plan TAT-33 member invites".

- [ ] **Step 2: TAT-30 is built here**

Each command must print at least one line (if any prints nothing, TAT-30's build isn't in this branch: STOP and ask the coordinator to merge it first):

```
git -C <repo> grep -n "export const TENANT_ROUTE_ROLES = {" -- apps/platform/app/modules/tenancy/access.ts
git -C <repo> grep -n '"tenant.settings.messages.update": OWNERS,' -- apps/platform/app/modules/tenancy/access.ts
git -C <repo> grep -n "async profileOf(" -- apps/platform/app/modules/artists/services/artist_service.ts
git -C <repo> grep -n "export async function seededStudio(" -- apps/platform/tests/helpers/tenants.ts
git -C <repo> grep -n "export function caseRequest(" -- apps/platform/tests/helpers/isolation.ts
git -C <repo> ls-files apps/platform/tests/functional/tenancy/role_access.spec.ts
```

- [ ] **Step 3: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -n "async assertKeepsAnOwner(" -- apps/platform/app/modules/tenancy/services/tenancy_service.ts
git -C <repo> grep -n "export type TenantMember = {" -- apps/platform/app/modules/tenancy/services/tenancy_service.ts
git -C <repo> grep -n "export function forgetStagedTokens(" -- apps/platform/app/modules/identity/account_tokens.ts
git -C <repo> grep -n 'const NEEDS_CONFIRMED_EMAIL = \["GET /onboarding", "POST /onboarding"\];' -- apps/platform/tests/functional/identity/account_routes.spec.ts
git -C <repo> grep -n '"public.tenant_for_slug": {' -- apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> grep -n 'tattoo_projects: \["tenant_isolation:ALL"\],' -- apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> grep -n '{ userId: owner.id, role: "owner", email: owner.email, fullName: null },' -- apps/platform/tests/functional/notifications/alert_service.spec.ts
git -C <repo> grep -n '| "alert";' -- apps/platform/tests/isolation/cases.ts
git -C <repo> grep -n 'label: "Artists",' -- apps/platform/inertia/layouts/settings.tsx
git -C <repo> grep -n "Clients will find you at your own address." -- apps/platform/inertia/pages/onboarding/create_tenant.tsx
git -C <repo> grep -n 'router.post("logout", \[controllers.Session, "destroy"\]);' -- apps/platform/start/routes.ts
```

Each of these must print nothing:

```
git -C <repo> ls-files apps/platform/app/modules/tenancy/invitations.ts apps/platform/app/modules/tenancy/services/invitation_service.ts apps/platform/app/modules/tenancy/services/member_service.ts
git -C <repo> grep -n "tenant_invitations\|invitation_tenant\|INVITATION_TOKEN_KEY" -- apps/platform
```

And `ls <repo>/apps/platform/database/migrations | tail -1` → `1791680000002_create_account_tokens_table.ts` (or a later one from TAT-30's base: then this plan's two timestamps must still sort after it; if not, STOP).

If a name moved, use the real one, keep the plan's behaviour and note the deviation in your report.

- [ ] **Step 4: Install and environment**

If `<repo>/node_modules` is missing: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok` (never read it). `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` lists every migration as completed.

- [ ] **Step 5: Baseline**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=tenant_routes.spec.ts --files=role_access.spec.ts --files=cross_tenant.spec.ts --files=tenancy_service.spec.ts --files=alert_service.spec.ts --files=account_routes.spec.ts --files=sessions.spec.ts --files=catalog_guard.spec.ts --files=artist_service.spec.ts` → PASS. Then the full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line.

---

### Task 1: Pure helpers and the staged-token key

**Files:**
- Create: `apps/platform/app/modules/tenancy/invitations.ts`
- Modify: `apps/platform/app/modules/identity/account_tokens.ts`
- Test: `apps/platform/tests/unit/modules/tenancy/invitations.spec.ts` (create); `apps/platform/tests/unit/modules/identity/account_tokens.spec.ts` (one test)

**Interfaces:**
- Produces, from `#modules/tenancy/invitations`: `INVITATION_DAYS`, `INVITATION_LINK_FLASH`, `type NewInvitationLink`, `ROLE_WORDS`, `invitationPath(token)`, `invitationUrl(appUrl, token)`, `inviteMessage(studioName, url)`, `whatsappShareUrl(text)`, `expiryText(expiresAt, timezone)`, `isNewInvitationLink(value)`.
- Produces, from `#modules/identity/account_tokens`: `INVITATION_TOKEN_KEY`; `forgetStagedTokens` also forgets it.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/tenancy/invitations.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	expiryText,
	INVITATION_DAYS,
	invitationPath,
	invitationUrl,
	inviteMessage,
	isNewInvitationLink,
	ROLE_WORDS,
	whatsappShareUrl,
} from "#modules/tenancy/invitations";

const TOKEN = "a".repeat(43);

test.group("Invitations (TAT-33)", () => {
	test("an invitation link is the platform's origin plus /invitations/<token>", ({
		assert,
	}) => {
		assert.equal(INVITATION_DAYS, 7);
		assert.equal(invitationPath(TOKEN), `/invitations/${TOKEN}`);
		assert.equal(
			invitationUrl("https://app.example.com", TOKEN),
			`https://app.example.com/invitations/${TOKEN}`,
		);
		assert.equal(
			invitationUrl("http://localhost:3401/", TOKEN),
			`http://localhost:3401/invitations/${TOKEN}`,
		);
	});

	test("the chat message and its WhatsApp share link keep every character", ({
		assert,
	}) => {
		const url = `https://app.example.com/invitations/${TOKEN}`;
		const text = inviteMessage("कालो सुई & Co #1+", url);
		assert.equal(
			text,
			`You're invited to join कालो सुई & Co #1+ on Tattoo Drip. Open this link to accept: ${url}`,
		);

		const share = whatsappShareUrl(text);
		assert.isTrue(share.startsWith("https://wa.me/?text="));
		assert.equal(new URL(share).searchParams.get("text"), text);
		assert.notInclude(share, "& Co");
		assert.notInclude(share, "#1");
	});

	test("the expiry reads in the studio's timezone", ({ assert }) => {
		const at = DateTime.fromISO("2026-10-27T08:20:00Z");
		assert.equal(expiryText(at, "Asia/Kathmandu"), "27 Oct 2026, 14:05");
		assert.equal(expiryText(at, "UTC"), "27 Oct 2026, 08:20");
	});

	test("roles in a sentence, and what a flashed link must hold", ({
		assert,
	}) => {
		assert.deepEqual(ROLE_WORDS, { owner: "an owner", artist: "an artist" });
		const link = {
			email: "ink@example.com",
			url: "u",
			message: "m",
			whatsappUrl: "w",
			expiresText: "e",
		};
		assert.isTrue(isNewInvitationLink(link));
		assert.isFalse(isNewInvitationLink({ ...link, url: 1 }));
		assert.isFalse(isNewInvitationLink("u"));
		assert.isFalse(isNewInvitationLink(null));
	});
});
```

In `apps/platform/tests/unit/modules/identity/account_tokens.spec.ts`, add `forgetStagedTokens` and `INVITATION_TOKEN_KEY` to the import list (keep it sorted) and add inside `test.group("Account tokens", …)`:

```ts
	test("forgetStagedTokens forgets the account links and a staged invitation (TAT-33)", ({
		assert,
	}) => {
		const forgotten: string[] = [];
		forgetStagedTokens({ forget: (key) => forgotten.push(key) });

		assert.sameMembers(forgotten, [
			SESSION_TOKEN_KEYS.verify_email,
			SESSION_TOKEN_KEYS.reset_password,
			INVITATION_TOKEN_KEY,
		]);
		assert.equal(INVITATION_TOKEN_KEY, "invitation_token");
	});
```

- [ ] **Step 2: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=invitations.spec.ts --files=account_tokens.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → 124 with "Cannot find module" (`#modules/tenancy/invitations`) or "does not provide an export named 'INVITATION_TOKEN_KEY'".

- [ ] **Step 3: Write the helpers**

Create `apps/platform/app/modules/tenancy/invitations.ts`:

```ts
import type { DateTime } from "luxon";
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/**
 * Invitations to join a studio (TAT-33). The token is TAT-18's
 * (newAccountToken, hashAccountToken, ACCOUNT_TOKEN in
 * #modules/identity/account_tokens); these are the invitation's own pieces.
 */

/** How long an invitation link works, by the database's clock. */
export const INVITATION_DAYS = 7;

/** The one-time flash that carries a new link to the Members page. */
export const INVITATION_LINK_FLASH = "invitationLink";

/** A new link as the Members page shows it, once. */
export type NewInvitationLink = {
	email: string;
	url: string;
	message: string;
	whatsappUrl: string;
	expiresText: string;
};

/** A role in a sentence: "join as an artist". */
export const ROLE_WORDS: Record<MembershipRole, string> = {
	owner: "an owner",
	artist: "an artist",
};

export function invitationPath(token: string): string {
	return `/invitations/${token}`;
}

/** The absolute link the owner sends: the platform's origin plus the path. */
export function invitationUrl(appUrl: string, token: string): string {
	return new URL(invitationPath(token), appUrl).toString();
}

/** The chat message that carries the link. Plain text. */
export function inviteMessage(studioName: string, url: string): string {
	return `You're invited to join ${studioName} on Tattoo Drip. Open this link to accept: ${url}`;
}

/**
 * WhatsApp's share link: it opens WhatsApp with the text and lets the owner
 * pick the chat (no number: the invitee's isn't stored).
 */
export function whatsappShareUrl(text: string): string {
	return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** When a link stops working, for people, in the studio's timezone: "27 Oct 2026, 14:05". */
export function expiryText(expiresAt: DateTime, timezone: string): string {
	return expiresAt
		.setZone(timezone)
		.setLocale("en-GB")
		.toFormat("d LLL yyyy, HH:mm");
}

/** Whether a value read back from the session is a NewInvitationLink. */
export function isNewInvitationLink(
	value: unknown,
): value is NewInvitationLink {
	if (typeof value !== "object" || value === null) return false;
	const fields = value as Record<string, unknown>;
	return ["email", "url", "message", "whatsappUrl", "expiresText"].every(
		(key) => typeof fields[key] === "string",
	);
}
```

In `apps/platform/app/modules/identity/account_tokens.ts`, replace

```ts
/**
 * Drops every staged link token from a session. Sign-in and sign-out call it:
 * regenerating the session id keeps its data, so without this a link opened
 * before a sign-out would still open its form for the next visitor of a
 * shared browser.
 */
export function forgetStagedTokens(session: { forget(key: string): void }) {
	for (const key of Object.values(SESSION_TOKEN_KEYS)) session.forget(key);
}
```

with

```ts
/**
 * Where an invitation link's GET puts its token (TAT-33), like the account
 * links' keys above: the invitation page's URL then holds no token.
 */
export const INVITATION_TOKEN_KEY = "invitation_token";

/**
 * Drops every staged link token from a session: the account links and an
 * invitation (TAT-33). Sign-in and sign-out call it: regenerating the
 * session id keeps its data, so without this a link opened before a
 * sign-out would still open its page for the next visitor of a shared
 * browser.
 */
export function forgetStagedTokens(session: { forget(key: string): void }) {
	for (const key of Object.values(SESSION_TOKEN_KEYS)) session.forget(key);
	session.forget(INVITATION_TOKEN_KEY);
}
```

- [ ] **Step 4: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=invitations.spec.ts --files=account_tokens.spec.ts` → pass; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean.

- [ ] **Step 5: Commit**

```
git -C <repo> add apps/platform/app/modules/tenancy/invitations.ts apps/platform/app/modules/identity/account_tokens.ts apps/platform/tests/unit/modules/tenancy/invitations.spec.ts apps/platform/tests/unit/modules/identity/account_tokens.spec.ts
git -C <repo> commit -m "feat(platform): add invitation links, their chat message and the staged-token key (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The schema

**Files:**
- Create: `apps/platform/database/migrations/1791693300000_create_tenant_invitations_table.ts`
- Create: `apps/platform/database/migrations/1791693300001_create_invitation_tenant_function.ts`
- Create: `apps/platform/app/modules/tenancy/models/tenant_invitation.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Test: `apps/platform/tests/functional/tenancy/tenant_invitations_table.spec.ts` (create); `apps/platform/tests/functional/tenancy/invitation_tenant.spec.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/tenancy/tenant_invitations_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { addArtist } from "#tests/helpers/artists";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

const WEEK = 7 * 24 * 60 * 60 * 1000;
let next = 0;

/** A valid row for `tenantId`; every call gets its own address and hash. */
function row(tenantId: string, over: Record<string, unknown> = {}) {
	next += 1;
	return {
		tenant_id: tenantId,
		email: `invitee-${next}@table-33.example`,
		role: "artist",
		token_hash: String(next).padStart(64, "0"),
		expires_at: new Date(Date.now() + WEEK),
		...over,
	};
}

const insert = (values: Record<string, unknown>) =>
	withTransaction((inner) => insertRow(inner, "tenant_invitations", values));

test.group("tenant_invitations table (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "tenant_invitations", async (tenant) =>
			row(tenant.id),
		);
	});

	test("one invitation per studio and address, and no token hash twice anywhere", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("table-a-33");
		const { tenant: other } = await studioWithOwner("table-b-33");
		const first = row(tenant.id);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await insert(first);
			await assert.rejects(
				() => insert(row(tenant.id, { email: first.email })),
				/tenant_invitations_tenant_id_email_unique/,
			);
		});
		await withDbContext({ tenantId: other.id }, async () => {
			// Another studio may invite the same address…
			await insert(row(other.id, { email: first.email }));
			// …but no two invitations share a token.
			await assert.rejects(
				() => insert(row(other.id, { token_hash: first.token_hash })),
				/tenant_invitations_token_hash_unique/,
			);
		});
	});

	test("the address is canonical, the role known and the expiry after creation", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("table-checks-33");

		await withDbContext({ tenantId: tenant.id }, async () => {
			for (const email of ["Ink@Example.com", " ink@example.com"]) {
				await assert.rejects(
					() => insert(row(tenant.id, { email })),
					/tenant_invitations_email_canonical/,
					email,
				);
			}
			await assert.rejects(
				() => insert(row(tenant.id, { role: "staff" })),
				/tenant_invitations_role_check/,
			);
			await assert.rejects(
				() => insert(row(tenant.id, { expires_at: new Date(Date.now() - 60_000) })),
				/tenant_invitations_expires_after_creation/,
			);
		});
	});

	test("the profile to claim must be one of the studio's own", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("table-claim-33");
		const { owner: otherOwner, tenant: other } =
			await studioWithOwner("table-foreign-33");
		const own = await addArtist(tenant, owner);
		const foreign = await addArtist(other, otherOwner);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await insert(row(tenant.id, { artist_id: own.id }));
			await assert.rejects(
				() => insert(row(tenant.id, { artist_id: foreign.id })),
				/tenant_invitations_tenant_id_artist_id_foreign/,
			);
		});
	});
});
```

Create `apps/platform/tests/functional/tenancy/invitation_tenant.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { hashAccountToken } from "#modules/identity/account_tokens";
import { idOf, insertRow, sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { dbClient, withDbContext } from "#services/db_context";

/**
 * What the function answers for `hash`, as the app role with no context. It
 * sees every studio's committed rows (the dev database's too), so the
 * "unknown" hash below is one no row can have.
 */
async function lookup(hash: string | null) {
	// A bound null isn't a typed binding value, so null is written inline.
	const { rows } =
		hash === null
			? await sql({}, "select public.invitation_tenant(null) as id")
			: await sql({}, "select public.invitation_tenant(?) as id", [hash]);
	return rows[0].id as string | null;
}

/** An invitation row in `tenant` with this token's hash; gives its id. */
async function invitationFor(tenant: { id: string }, token: string) {
	const result = await withDbContext({ tenantId: tenant.id }, (trx) =>
		insertRow(trx, "tenant_invitations", {
			tenant_id: tenant.id,
			email: `ink-${token.length}@fn-33.example`,
			role: "artist",
			token_hash: hashAccountToken(token),
			expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		}),
	);
	return idOf(result);
}

test.group("invitation_tenant() (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives the studio of an invitation's token hash, though the app role alone sees no invitation", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("fn-live-33");
		await invitationFor(tenant, "fn-live-33-token");

		const { rows } = await sql(
			{},
			"select count(*)::int as n from tenant_invitations",
		);
		assert.equal(rows[0].n, 0);
		assert.equal(
			await lookup(hashAccountToken("fn-live-33-token")),
			tenant.id,
		);
	});

	test("answers for an expired invitation too: the page says it expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("fn-expired-33");
		const id = await invitationFor(tenant, "fn-expired-33-token");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenant_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 minute' where id = ?",
				[id],
			),
		);

		assert.equal(
			await lookup(hashAccountToken("fn-expired-33-token")),
			tenant.id,
		);
	});

	test("null for an unknown hash, a deleted studio and null", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("fn-gone-33");
		await invitationFor(tenant, "fn-gone-33-token");
		await inTenant(tenant, () => tenant.softDelete());

		assert.isNull(await lookup(hashAccountToken("nobody-has-this-token-33")));
		assert.isNull(await lookup(hashAccountToken("fn-gone-33-token")));
		assert.isNull(await lookup(null));
	});
});
```

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`: add `tenant_invitations: ["tenant_isolation:ALL"],` to `EXPECTED_POLICIES` right after `tattoo_projects: ["tenant_isolation:ALL"],`, and add to `DEFINER_FUNCTIONS` after the `"public.tenant_for_slug"` entry:

```ts
	"public.invitation_tenant": {
		args: "requested_hash text",
		reason:
			"the id of the live tenant holding the invitation whose token hash is exactly the argument, for the invitation page (TAT-33)",
	},
```

- [ ] **Step 2: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=tenant_invitations_table.spec.ts --files=invitation_tenant.spec.ts --files=catalog_guard.spec.ts` → failures: `relation "tenant_invitations" does not exist`, `function public.invitation_tenant… does not exist`, and the guard's missing table and function.

- [ ] **Step 3: The migrations**

Create `apps/platform/database/migrations/1791693300000_create_tenant_invitations_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/**
 * Invitations to join a studio (TAT-33). Bound to one email address in its
 * canonical form (the same check as users_email_canonical, copied: a
 * migration never imports app code), with the role the member gets and an
 * optional artist profile to claim. Only the token's SHA-256 is stored,
 * under a unique index; the invitation page finds the row's studio through
 * invitation_tenant() (the next migration). One per studio and address: a
 * new invitation replaces the old one. Not soft-deleted: a credential,
 * deleted when accepted or cancelled; an expired one stays until it is
 * renewed or cancelled. The roles are MEMBERSHIP_ROLES (copied).
 */
export default class extends BaseSchema {
	protected tableName = "tenant_invitations";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("email", 254).notNullable();
			table.enum("role", ["owner", "artist"]).notNullable();
			table.uuid("artist_id").nullable();
			table.string("token_hash", 64).notNullable().unique();
			table
				.uuid("invited_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("expires_at", { useTz: true }).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "artist_id", "artists");

			// One per studio and address; also the tenant_id index.
			table.unique(["tenant_id", "email"]);
			// The composite key's index.
			table.index(["tenant_id", "artist_id"]);
			// Deleting an account sets its invitations' inviter to null.
			table.index(["invited_by_user_id"]);
		});
		for (const statement of [
			`alter table tenant_invitations add constraint tenant_invitations_email_canonical check (email = translate(btrim(email), '${UPPER}', '${LOWER}'))`,
			"alter table tenant_invitations add constraint tenant_invitations_expires_after_creation check (expires_at > created_at)",
			...enableTenantRls(this.tableName),
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Create `apps/platform/database/migrations/1791693300001_create_invitation_tenant_function.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The invitation page's lookup (TAT-33). Someone opening an invitation link
 * belongs to no studio yet, and the app role sees no studio's rows without
 * one, so InvitationService resolves the token's hash through this
 * SECURITY DEFINER function. It runs as the owner (bypassing RLS) and
 * answers one question: the id of the live tenant holding the invitation
 * whose token_hash is exactly the argument, or null. It never lists
 * invitations; the row itself is read in that tenant's context.
 *
 * Hardened as database/README.md asks, like tenant_for_slug: one text
 * argument compared with = on a unique column, an SQL-standard body (bound
 * when created, no dynamic SQL), STRICT (null in, null out), a pinned
 * search_path, schema-qualified tables, and EXECUTE for the app role only.
 * The argument isn't named `token_hash`: in an SQL function a column of
 * that name would win.
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			`create function public.invitation_tenant(requested_hash text)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select i.tenant_id
  from public.tenant_invitations i
  join public.tenants t on t.id = i.tenant_id
  where i.token_hash = requested_hash
    and t.deleted_at is null;
end`,
			"revoke all on function public.invitation_tenant(text) from public",
			`grant execute on function public.invitation_tenant(text) to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.invitation_tenant(text)");
	}
}
```

- [ ] **Step 4: Migrate, then the model**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate`. It regenerates `database/schema.ts` with `TenantInvitationSchema`.

Create `apps/platform/app/modules/tenancy/models/tenant_invitation.ts`:

```ts
import { TenantInvitationSchema } from "#database/schema";
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/**
 * An invitation to join a studio (TAT-33): bound to one canonical email
 * address, with the role the member gets and an optional artist profile to
 * claim. Only the token's SHA-256 is stored. Not soft-deleted: a
 * credential, deleted when accepted or cancelled. Made and used through
 * InvitationService.
 */
export default class TenantInvitation extends TenantInvitationSchema {
	declare role: MembershipRole;
}
```

- [ ] **Step 5: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=tenant_invitations_table.spec.ts --files=invitation_tenant.spec.ts --files=catalog_guard.spec.ts` → pass; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean.

- [ ] **Step 6: Commit**

```
git -C <repo> add apps/platform/database apps/platform/app/modules/tenancy/models/tenant_invitation.ts apps/platform/tests/functional/tenancy/tenant_invitations_table.spec.ts apps/platform/tests/functional/tenancy/invitation_tenant.spec.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> commit -m "feat(platform): add the tenant_invitations table and its token lookup (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Claiming and unlinking profiles

**Files:**
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts`
- Test: `apps/platform/tests/functional/artists/artist_service.spec.ts`

**Interfaces:**
- Produces: `ArtistService.claim(tenant, artistId: string, userId: string): Promise<boolean>`, `ArtistService.unlinkUser(tenant, userId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/artists/artist_service.spec.ts` (it already imports `Artist`, `artists`, `input`, `inTenant`, `studioWithOwner`; TAT-30 added `artistIn`):

```ts
test.group("ArtistService claims and unlinks (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("claim links a live, unlinked profile to the account", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("claim-33", "Claim 33");
		const member = await artistIn(tenant, "asha@claim-33.example");
		const asha = await inTenant(tenant, () =>
			artists.create(tenant, input({ name: "Asha", slug: "asha" }), owner),
		);

		const claimed = await inTenant(tenant, () =>
			artists.claim(tenant, asha.id, member.id),
		);

		assert.isTrue(claimed);
		const saved = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.equal(saved.userId, member.id);
	});

	test("claim links nothing to a profile linked meanwhile or deleted, nor for an account that has one", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("claim-no-33", "Claim No");
		const member = await artistIn(tenant, "asha@claim-no-33.example");
		const { linked, deleted, own, free } = await inTenant(tenant, async () => ({
			linked: await artists.create(
				tenant,
				input({ name: "Oona", slug: "oona", linkToMe: true }),
				owner,
			),
			deleted: await artists.create(
				tenant,
				input({ name: "Gone", slug: "gone" }),
				owner,
			),
			own: await artists.create(
				tenant,
				input({ name: "Mine", slug: "mine" }),
				owner,
			),
			free: await artists.create(
				tenant,
				input({ name: "Free", slug: "free" }),
				owner,
			),
		}));

		await inTenant(tenant, async () => {
			await artists.delete(tenant, deleted);
			assert.isFalse(await artists.claim(tenant, linked.id, member.id));
			assert.isFalse(await artists.claim(tenant, deleted.id, member.id));
			assert.isTrue(await artists.claim(tenant, own.id, member.id));
			// One live profile per account and studio: a second claim links nothing.
			assert.isFalse(await artists.claim(tenant, free.id, member.id));
			assert.equal((await Artist.findOrFail(linked.id)).userId, owner.id);
			assert.isNull((await Artist.findOrFail(free.id)).userId);
		});
	});

	test("unlinkUser unlinks every profile linked to the account, deleted ones too, and nothing else", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("unlink-33", "Unlink 33");
		const member = await artistIn(tenant, "asha@unlink-33.example");
		const { live, gone, owners } = await inTenant(tenant, async () => ({
			live: await artists.create(
				tenant,
				input({ name: "Asha", slug: "asha" }),
				owner,
			),
			gone: await artists.create(
				tenant,
				input({ name: "Old", slug: "old" }),
				owner,
			),
			owners: await artists.create(
				tenant,
				input({ name: "Oona", slug: "oona", linkToMe: true }),
				owner,
			),
		}));
		await inTenant(tenant, async () => {
			await Artist.query()
				.whereIn("id", [live.id, gone.id])
				.update({ user_id: member.id });
			await artists.delete(tenant, await artists.findFor(tenant, gone.id));
		});

		await inTenant(tenant, () => artists.unlinkUser(tenant, member.id));

		await inTenant(tenant, async () => {
			assert.isNull((await Artist.findOrFail(live.id)).userId);
			assert.isNull(
				(await Artist.withTrashed().where("id", gone.id).firstOrFail()).userId,
			);
			assert.equal((await Artist.findOrFail(owners.id)).userId, owner.id);
			assert.isNull(await artists.profileOf(tenant, member.id));
		});
	});
});
```

If `artistIn` is not yet imported in this file, add it to the `#tests/helpers/tenants` import.

- [ ] **Step 2: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=artist_service.spec.ts` → the three new tests fail (`artists.claim is not a function`, `artists.unlinkUser is not a function`).

- [ ] **Step 3: The service methods**

In `apps/platform/app/modules/artists/services/artist_service.ts`, add after `updateOwn` (TAT-30):

```ts
	/**
	 * Links the live, unlinked profile `artistId` to `userId`: the claim an
	 * owner offered in an invitation (TAT-33). The only path that links a
	 * profile to anyone but the acting member, so it checks under the row
	 * lock: false, with nothing changed, when the profile is gone, was linked
	 * to someone meanwhile, or the account already has a live profile here.
	 */
	async claim(
		tenant: TenantRef,
		artistId: string,
		userId: string,
	): Promise<boolean> {
		return withTransaction(async (trx) => {
			if (await this.profileOf(tenant, userId)) return false;
			const live = await Artist.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", artistId)
				.forUpdate()
				.first();
			if (!live || live.userId !== null) return false;
			live.userId = userId;
			await live.save();
			return true;
		});
	}

	/**
	 * Unlinks every profile of the tenant linked to `userId`, deleted ones
	 * included (TAT-33: a removed member's profile stays with the studio,
	 * unlinked, with its projects and sessions). Update queries skip the
	 * soft-delete hooks, so deleted rows are reached too.
	 */
	async unlinkUser(tenant: TenantRef, userId: string): Promise<void> {
		await Artist.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.update({ user_id: null, updated_at: new Date() });
	}
```

- [ ] **Step 4: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=artist_service.spec.ts` → pass; typecheck clean.

- [ ] **Step 5: Commit**

```
git -C <repo> add apps/platform/app/modules/artists/services/artist_service.ts apps/platform/tests/functional/artists/artist_service.spec.ts
git -C <repo> commit -m "feat(platform): claim an offered artist profile and unlink a removed member's (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: InvitationService

**Files:**
- Modify: `apps/platform/app/modules/tenancy/errors.ts`
- Create: `apps/platform/app/modules/tenancy/services/invitation_service.ts`
- Create: `apps/platform/tests/helpers/invitations.ts`
- Test: `apps/platform/tests/functional/tenancy/invitation_service.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/tenancy/errors`: `INVITATION_RULES`, `type InvitationRule`, `InvitationRuleError` (`reason`), `MemberRuleError` (`reason: "self"`).
- Produces, from `#modules/tenancy/services/invitation_service`: `type InvitationInput`, `type PendingInvitation`, `type InvitationStep`, `type InvitationPreview`, `type Joined`; `InvitationService` with `pending`, `invite`, `renew`, `revoke`, `preview`, `accept` (signatures below).
- Produces, from `#tests/helpers/invitations`: `invitationService()`, `confirmedUser(email)`, `invite(tenant, owner, over?)`, `invitationFlow(tenant, token)`, `expireInvitation(tenant, id)`.

- [ ] **Step 1: The errors**

Append to `apps/platform/app/modules/tenancy/errors.ts`:

```ts
/** Why an invitation can't be made or accepted (TAT-33). */
export const INVITATION_RULES = [
	/** No live invitation for this token and flow: used, cancelled, replaced or never made. */
	"invalid",
	"expired",
	/** The account's address isn't confirmed (TAT-18). */
	"unverified",
	/** The signed-in account's address isn't the invited one. */
	"wrong_account",
	"already_member",
	/** The profile offered is gone or linked to someone. */
	"profile_unavailable",
] as const;
export type InvitationRule = (typeof INVITATION_RULES)[number];

/** An invitation refused for `reason`. Controllers write their own messages. */
export class InvitationRuleError extends Error {
	constructor(readonly reason: InvitationRule) {
		super(`Invitation refused: ${reason}`);
		this.name = "InvitationRuleError";
	}
}

/**
 * An owner acting on their own membership (TAT-33): removing yourself or
 * changing your own role isn't done here.
 */
export class MemberRuleError extends Error {
	constructor(readonly reason: "self") {
		super(`Member change refused: ${reason}`);
		this.name = "MemberRuleError";
	}
}
```

- [ ] **Step 2: The test helpers**

Create `apps/platform/tests/helpers/invitations.ts`:

```ts
import { DateTime } from "luxon";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import { hashAccountToken } from "#modules/identity/account_tokens";
import ImageService from "#modules/media/services/image_service";
import InvitationService, {
	type InvitationInput,
} from "#modules/tenancy/services/invitation_service";
import { dbClient } from "#services/db_context";
import { NO_FLOW } from "#tests/helpers/accounts";
import { inTenant } from "#tests/helpers/tenants";

/** InvitationService with its real dependencies. */
export const invitationService = () =>
	new InvitationService(new ArtistService(new ImageService()));

/** An account whose address is confirmed: what accepting needs (TAT-18's gate). */
export function confirmedUser(email: string) {
	return User.create({
		email,
		password: "secret-password",
		emailVerifiedAt: DateTime.now(),
	});
}

/** An invitation made by `owner`, as Settings, Members makes it: its id, raw token and expiry. */
export function invite(
	tenant: { id: string },
	owner: { id: string },
	over: Partial<InvitationInput> = {},
) {
	return inTenant(tenant, () =>
		invitationService().invite(tenant, owner, {
			email: "ink@invite-33.example",
			role: "artist",
			artistId: null,
			...over,
		}),
	);
}

/** The flow id the invitation page renders for `token` (a zero id when no row has it). */
export async function invitationFlow(tenant: { id: string }, token: string) {
	const { rows } = await inTenant(tenant, () =>
		dbClient().rawQuery(
			"select id from tenant_invitations where token_hash = ?",
			[hashAccountToken(token)],
		),
	);
	return (rows[0]?.id as string | undefined) ?? NO_FLOW;
}

/** Moves an invitation's expiry into the past, as time would. */
export function expireInvitation(tenant: { id: string }, id: string) {
	return inTenant(tenant, () =>
		dbClient().rawQuery(
			"update tenant_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 minute' where id = ?",
			[id],
		),
	);
}
```

- [ ] **Step 3: Write the failing service tests**

Create `apps/platform/tests/functional/tenancy/invitation_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import { hashAccountToken } from "#modules/identity/account_tokens";
import { InvitationRuleError } from "#modules/tenancy/errors";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { dbClient } from "#services/db_context";
import { addArtist } from "#tests/helpers/artists";
import {
	confirmedUser,
	expireInvitation,
	invitationFlow,
	invitationService,
	invite,
} from "#tests/helpers/invitations";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const invitations = invitationService();

/** The reason of the InvitationRuleError `work` throws, or "accepted". */
async function refusal(work: () => Promise<unknown>) {
	try {
		await work();
		return "accepted";
	} catch (error) {
		if (error instanceof InvitationRuleError) return error.reason;
		throw error;
	}
}

const memberships = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		TenantMembership.query().where("tenant_id", tenant.id).orderBy("created_at"),
	);

test.group("InvitationService: making invitations (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("invite stores only the token's hash, bound to the canonical address, for 7 days", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("make-33", "Make 33");

		const made = await invite(tenant, owner, {
			email: " Ink@Make-33.Example ",
			role: "owner",
		});

		assert.isFalse(made.replaced);
		assert.match(made.token, /^[A-Za-z0-9_-]{43}$/);
		const row = await inTenant(tenant, () =>
			TenantInvitation.findOrFail(made.id),
		);
		assert.equal(row.email, "ink@make-33.example");
		assert.equal(row.role, "owner");
		assert.equal(row.tokenHash, hashAccountToken(made.token));
		assert.equal(row.invitedByUserId, owner.id);
		assert.notInclude(JSON.stringify(row.serialize()), made.token);
		assert.equal(made.expiresAt.toMillis(), row.expiresAt.toMillis());
		const { rows } = await inTenant(tenant, () =>
			dbClient().rawQuery(
				"select expires_at - created_at = interval '7 days' as week, expires_at > now() as live from tenant_invitations where id = ?",
				[made.id],
			),
		);
		assert.isTrue(rows[0].week);
		assert.isTrue(rows[0].live);
	});

	test("inviting the same address again replaces the invitation and kills its link", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("replace-33", "Replace 33");
		const first = await invite(tenant, owner);

		const second = await invite(tenant, owner, { role: "owner" });

		assert.isTrue(second.replaced);
		assert.equal(second.id, first.id);
		assert.equal((await invitations.preview(first.token, null)).state, "invalid");
		const rows = await inTenant(tenant, () =>
			TenantInvitation.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].role, "owner");
	});

	test("a live member's address is refused; a removed member's and an unknown one aren't", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("member-33", "Member 33");
		const member = await artistIn(tenant, "asha@member-33.example");
		const gone = await artistIn(tenant, "gone@member-33.example");
		await inTenant(tenant, async () => {
			const row = await TenantMembership.query()
				.where("user_id", gone.id)
				.firstOrFail();
			await row.softDelete();
		});

		assert.equal(
			await refusal(() => invite(tenant, owner, { email: member.email })),
			"already_member",
		);
		assert.equal(await refusal(() => invite(tenant, owner, { email: gone.email })), "accepted");
		assert.equal(
			await refusal(() =>
				invite(tenant, owner, { email: "nobody@member-33.example" }),
			),
			"accepted",
		);
	});

	test("invite answers the same for an address with or without an account", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("enum-33", "Enum 33");
		await User.create({ email: "has@enum-33.example", password: "secret-password" });

		const known = await invite(tenant, owner, { email: "has@enum-33.example" });
		const unknown = await invite(tenant, owner, { email: "none@enum-33.example" });

		assert.deepEqual(Object.keys(known).sort(), Object.keys(unknown).sort());
		assert.isFalse(known.replaced);
		assert.isFalse(unknown.replaced);
	});

	test("only a live profile nobody is linked to can be offered", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("offer-33", "Offer 33");
		const { owner: otherOwner, tenant: other } =
			await studioWithOwner("offer-other-33");
		const free = await addArtist(tenant, owner, { name: "Free", slug: "free" });
		const taken = await addArtist(tenant, owner, {
			name: "Oona",
			slug: "oona",
			linkToMe: true,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		await inTenant(tenant, () => gone.softDelete());
		const foreign = await addArtist(other, otherOwner);

		for (const artistId of [taken.id, gone.id, foreign.id]) {
			assert.equal(
				await refusal(() => invite(tenant, owner, { artistId })),
				"profile_unavailable",
				artistId,
			);
		}
		const made = await invite(tenant, owner, { artistId: free.id });
		const row = await inTenant(tenant, () =>
			TenantInvitation.findOrFail(made.id),
		);
		assert.equal(row.artistId, free.id);
	});

	test("renew gives a new link and 7 more days; the old link no longer works", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("renew-33", "Renew 33");
		const made = await invite(tenant, owner);
		await expireInvitation(tenant, made.id);

		const renewed = await inTenant(tenant, () =>
			invitations.renew(tenant, owner, made.id),
		);

		assert.equal(renewed.email, "ink@invite-33.example");
		assert.notEqual(renewed.token, made.token);
		assert.equal((await invitations.preview(made.token, null)).state, "invalid");
		assert.equal((await invitations.preview(renewed.token, null)).state, "live");
	});

	test("revoke deletes it; another studio's id is a 404 for renew and revoke", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("revoke-33", "Revoke 33");
		const { owner: otherOwner, tenant: other } =
			await studioWithOwner("revoke-other-33");
		const mine = await invite(tenant, owner);
		const theirs = await invite(other, otherOwner);

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => invitations.renew(tenant, owner, theirs.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			await assert.rejects(
				() => invitations.revoke(tenant, theirs.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			assert.deepEqual(await invitations.revoke(tenant, mine.id), {
				email: "ink@invite-33.example",
			});
		});
		assert.equal((await invitations.preview(mine.token, null)).state, "invalid");
		assert.equal((await invitations.preview(theirs.token, null)).state, "live");
	});

	test("pending lists the studio's invitations, newest first, with the profile and whether each expired; another studio sees none", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("pending-33", "Pending 33");
		const { tenant: other } = await studioWithOwner("pending-other-33");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const old = await invite(tenant, owner, { email: "old@pending-33.example" });
		await expireInvitation(tenant, old.id);
		await invite(tenant, owner, {
			email: "new@pending-33.example",
			artistId: asha.id,
		});

		const list = await inTenant(tenant, () => invitations.pending(tenant));

		assert.deepEqual(
			list.map(({ email, profileName, expired }) => ({
				email,
				profileName,
				expired,
			})),
			[
				{ email: "new@pending-33.example", profileName: "Asha", expired: false },
				{ email: "old@pending-33.example", profileName: null, expired: true },
			],
		);
		assert.isEmpty(await inTenant(other, () => invitations.pending(tenant)));
	});
});

test.group("InvitationService: opening and accepting (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("preview: invalid, expired and live, with the step for each visitor", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("preview-33", "Preview 33");
		const made = await invite(tenant, owner, { email: "ink@preview-33.example" });
		const other = await confirmedUser("other@preview-33.example");
		const invitee = await User.create({
			email: "ink@preview-33.example",
			password: "secret-password",
		});

		assert.deepEqual(await invitations.preview("x".repeat(43), null), {
			state: "invalid",
		});
		const live = await invitations.preview(made.token, null);
		assert.equal(live.state, "live");
		if (live.state !== "live") return;
		assert.equal(live.step, "sign_in");
		assert.equal(live.email, "ink@preview-33.example");
		assert.equal(live.studio.name, "Preview 33");
		assert.equal(live.flow, await invitationFlow(tenant, made.token));
		assert.isNull(live.profileName);

		const step = async (viewer: User) => {
			const preview = await invitations.preview(made.token, viewer);
			return preview.state === "live" ? preview.step : preview.state;
		};
		assert.equal(await step(other), "switch_account");
		assert.equal(await step(invitee), "confirm_email");
		await User.query()
			.where("id", invitee.id)
			.update({ email_verified_at: new Date() });
		const confirmed = await User.findOrFail(invitee.id);
		assert.equal(await step(confirmed), "accept");
		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: invitee.id,
				role: "artist",
			}),
		);
		assert.equal(await step(confirmed), "already_member");

		await expireInvitation(tenant, made.id);
		assert.deepEqual(await invitations.preview(made.token, null), {
			state: "expired",
			studioName: "Preview 33",
		});
	});

	test("accept makes the member with the invitation's role, claims the profile and uses the invitation up", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("accept-33", "Accept 33");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const made = await invite(tenant, owner, {
			email: "asha@accept-33.example",
			artistId: asha.id,
		});
		const user = await confirmedUser("asha@accept-33.example");

		const joined = await invitations.accept(
			user,
			made.token,
			await invitationFlow(tenant, made.token),
		);

		assert.deepEqual(joined, {
			studio: { name: "Accept 33", slug: "accept-33" },
			role: "artist",
			claimed: true,
		});
		const rows = await memberships(tenant);
		assert.deepEqual(
			rows.map(({ userId, role }) => ({ userId, role })),
			[
				{ userId: owner.id, role: "owner" },
				{ userId: user.id, role: "artist" },
			],
		);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			user.id,
		);
		assert.equal((await invitations.preview(made.token, null)).state, "invalid");
	});

	test("an invitation without a profile gives claimed null; an owner's gives the owner role", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("accept-owner-33", "AO 33");
		const made = await invite(tenant, owner, {
			email: "co@accept-owner-33.example",
			role: "owner",
		});
		const user = await confirmedUser("co@accept-owner-33.example");

		const joined = await invitations.accept(
			user,
			made.token,
			await invitationFlow(tenant, made.token),
		);

		assert.equal(joined.role, "owner");
		assert.isNull(joined.claimed);
	});

	test("accept refuses a wrong account, an unconfirmed one, a member, a dead link and a wrong flow; nothing changes", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("refuse-33", "Refuse 33");
		const made = await invite(tenant, owner, { email: "ink@refuse-33.example" });
		const flow = await invitationFlow(tenant, made.token);
		const other = await confirmedUser("other@refuse-33.example");
		const unconfirmed = await User.create({
			email: "ink@refuse-33.example",
			password: "secret-password",
		});
		const memberUser = await artistIn(tenant, "member@refuse-33.example");
		const forMember = await invite(tenant, owner, {
			email: "fresh@refuse-33.example",
		});
		// The member's address was invited before they joined some other way.
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenant_invitations set email = ? where id = ?",
				[memberUser.email, forMember.id],
			),
		);
		await User.query()
			.where("id", memberUser.id)
			.update({ email_verified_at: new Date() });
		const confirmedMember = await User.findOrFail(memberUser.id);

		assert.equal(
			await refusal(() => invitations.accept(other, made.token, flow)),
			"wrong_account",
		);
		assert.equal(
			await refusal(() => invitations.accept(unconfirmed, made.token, flow)),
			"unverified",
		);
		assert.equal(
			await refusal(() =>
				invitations.accept(
					confirmedMember,
					forMember.token,
					forMember.id,
				),
			),
			"already_member",
		);
		assert.equal(
			await refusal(() =>
				invitations.accept(other, "x".repeat(43), flow),
			),
			"invalid",
		);
		// Another invitation's flow, and something that isn't an id.
		assert.equal(
			await refusal(() =>
				invitations.accept(unconfirmed, made.token, forMember.id),
			),
			"invalid",
		);
		assert.equal(
			await refusal(() => invitations.accept(other, made.token, "nope")),
			"invalid",
		);
		await expireInvitation(tenant, made.id);
		await User.query()
			.where("id", unconfirmed.id)
			.update({ email_verified_at: new Date() });
		assert.equal(
			await refusal(async () =>
				invitations.accept(
					await User.findOrFail(unconfirmed.id),
					made.token,
					flow,
				),
			),
			"expired",
		);

		assert.lengthOf(await memberships(tenant), 2);
		assert.equal((await invitations.preview(made.token, null)).state, "expired");
	});

	test("a second accept with the same link finds nothing", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("replay-33", "Replay 33");
		const made = await invite(tenant, owner, { email: "ink@replay-33.example" });
		const flow = await invitationFlow(tenant, made.token);
		const user = await confirmedUser("ink@replay-33.example");

		await invitations.accept(user, made.token, flow);

		assert.equal(
			await refusal(() => invitations.accept(user, made.token, flow)),
			"invalid",
		);
		assert.lengthOf(await memberships(tenant), 2);
	});

	test("a profile taken meanwhile: the person still joins, without it", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("taken-33", "Taken 33");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const made = await invite(tenant, owner, {
			email: "ink@taken-33.example",
			artistId: asha.id,
		});
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: owner.id }),
		);
		const user = await confirmedUser("ink@taken-33.example");

		const joined = await invitations.accept(
			user,
			made.token,
			await invitationFlow(tenant, made.token),
		);

		assert.isFalse(joined.claimed);
		assert.lengthOf(await memberships(tenant), 2);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			owner.id,
		);
	});
});
```

- [ ] **Step 4: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=invitation_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → 124 with "Cannot find module" for `#modules/tenancy/services/invitation_service`.

- [ ] **Step 5: Write the service**

Create `apps/platform/app/modules/tenancy/services/invitation_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { DateTime } from "luxon";
import User from "#models/user";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	hashAccountToken,
	isFlowId,
	newAccountToken,
} from "#modules/identity/account_tokens";
import { canonicalEmail } from "#modules/identity/email_address";
import { InvitationRuleError } from "#modules/tenancy/errors";
import { INVITATION_DAYS } from "#modules/tenancy/invitations";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";

type TenantRef = { id: string };

/** What an owner fills in. The address is canonicalized here too. */
export type InvitationInput = {
	email: string;
	role: MembershipRole;
	artistId: string | null;
};

/** A pending invitation as Settings, Members lists it. */
export type PendingInvitation = {
	id: string;
	email: string;
	role: MembershipRole;
	/** The offered profile's name, null without one (or when it was deleted). */
	profileName: string | null;
	expiresAt: DateTime;
	expired: boolean;
};

/** What the invitation page offers its visitor (spec, Screens). */
export type InvitationStep =
	| "sign_in"
	| "switch_account"
	| "confirm_email"
	| "already_member"
	| "accept";

export type InvitationPreview =
	| { state: "invalid" }
	| { state: "expired"; studioName: string }
	| {
			state: "live";
			/** The row's id, for the page's hidden `flow` field (TAT-18). */
			flow: string;
			studio: { name: string; slug: string; timezone: string };
			email: string;
			role: MembershipRole;
			/** The offered profile while it can still be claimed, else null. */
			profileName: string | null;
			expiresAt: DateTime;
			step: InvitationStep;
	  };

/** A finished join. `claimed` is null when no profile was offered. */
export type Joined = {
	studio: { name: string; slug: string };
	role: MembershipRole;
	claimed: boolean | null;
};

type IssuedRow = {
	id: string;
	email: string;
	expires_at: Date;
	inserted?: boolean;
};

type PreviewRow = {
	id: string;
	email: string;
	role: MembershipRole;
	artist_id: string | null;
	expires_at: Date;
	live: boolean;
	name: string;
	slug: string;
	timezone: string;
};

type LockedRow = {
	id: string;
	email: string;
	role: MembershipRole;
	artist_id: string | null;
	live: boolean;
};

/**
 * One statement, so two owners inviting the same address at once end with
 * one invitation. `xmax = 0` is true for a row this statement inserted and
 * false for one it updated (a replaced invitation). Expiry by the
 * database's clock.
 */
const UPSERT = `insert into tenant_invitations (tenant_id, email, role, artist_id, token_hash, invited_by_user_id, expires_at, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, now() + make_interval(days => ?), now(), now())
on conflict (tenant_id, email) do update
set role = excluded.role, artist_id = excluded.artist_id, token_hash = excluded.token_hash,
    invited_by_user_id = excluded.invited_by_user_id, expires_at = excluded.expires_at,
    created_at = excluded.created_at, updated_at = excluded.updated_at
returning id, email, expires_at, (xmax = 0) as inserted`;

/**
 * Invitations to join a studio (TAT-33). A token is TAT-18's: 256 random
 * bits, only its SHA-256 stored, single use. The owner's methods run in the
 * studio's context (a request on /t/:tenant); preview and accept start from
 * a token alone, find its studio through invitation_tenant() and then work
 * in that studio's context.
 */
@inject()
export default class InvitationService {
	constructor(private artists: ArtistService) {}

	/** The studio's invitations, newest first. */
	async pending(tenant: TenantRef): Promise<PendingInvitation[]> {
		const rows = await TenantInvitation.query()
			.where("tenant_id", tenant.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
		const names = new Map(
			(await this.artists.list(tenant)).map(({ id, name }) => [id, name]),
		);
		const now = DateTime.now().toMillis();
		return rows.map((row) => ({
			id: row.id,
			email: row.email,
			role: row.role,
			profileName: row.artistId ? (names.get(row.artistId) ?? null) : null,
			expiresAt: row.expiresAt,
			expired: row.expiresAt.toMillis() <= now,
		}));
	}

	/**
	 * Invites `input.email` (canonical) with a new link. Refuses a live
	 * member's address ("already_member") and a profile that isn't one of
	 * the studio's live, unlinked ones ("profile_unavailable"). An address
	 * with a pending invitation gets it replaced (`replaced`), whose old link
	 * dies at once. The answer is the same whether or not the address has an
	 * account. Returns the raw token: show it once, never store it.
	 */
	async invite(
		tenant: TenantRef,
		inviter: { id: string },
		input: InvitationInput,
	): Promise<{
		id: string;
		token: string;
		replaced: boolean;
		expiresAt: DateTime;
	}> {
		const email = canonicalEmail(input.email);
		return withTransaction(async () => {
			if (await this.isMember(tenant, email)) {
				throw new InvitationRuleError("already_member");
			}
			if (
				input.artistId !== null &&
				!(await this.claimable(tenant, input.artistId))
			) {
				throw new InvitationRuleError("profile_unavailable");
			}
			const token = newAccountToken();
			const { rows } = await dbClient().rawQuery(UPSERT, [
				tenant.id,
				email,
				input.role,
				input.artistId,
				hashAccountToken(token),
				inviter.id,
				INVITATION_DAYS,
				// A null artist_id binds as SQL NULL; Lucid's binding type leaves null out.
			] as RawQueryBindings);
			const row = rows[0] as IssuedRow;
			return {
				id: row.id,
				token,
				replaced: row.inserted === false,
				expiresAt: DateTime.fromJSDate(row.expires_at),
			};
		});
	}

	/**
	 * A new link for the invitation `id` and 7 more days; the old link dies
	 * at once. E_ROW_NOT_FOUND for another studio's or an unknown id.
	 */
	async renew(
		tenant: TenantRef,
		inviter: { id: string },
		id: string,
	): Promise<{ email: string; token: string; expiresAt: DateTime }> {
		const token = newAccountToken();
		const { rows } = await dbClient().rawQuery(
			`update tenant_invitations
			 set token_hash = ?, invited_by_user_id = ?, expires_at = now() + make_interval(days => ?), created_at = now(), updated_at = now()
			 where tenant_id = ? and id = ?
			 returning id, email, expires_at`,
			[hashAccountToken(token), inviter.id, INVITATION_DAYS, tenant.id, id],
		);
		const row = rows[0] as IssuedRow | undefined;
		if (!row) throw new lucidErrors.E_ROW_NOT_FOUND(TenantInvitation);
		return {
			email: row.email,
			token,
			expiresAt: DateTime.fromJSDate(row.expires_at),
		};
	}

	/** Cancels the invitation `id`: its link dies. E_ROW_NOT_FOUND otherwise. */
	async revoke(tenant: TenantRef, id: string): Promise<{ email: string }> {
		const { rows } = await dbClient().rawQuery(
			"delete from tenant_invitations where tenant_id = ? and id = ? returning email",
			[tenant.id, id],
		);
		const row = rows[0] as { email: string } | undefined;
		if (!row) throw new lucidErrors.E_ROW_NOT_FOUND(TenantInvitation);
		return { email: row.email };
	}

	/**
	 * What the invitation page shows for `token` to `viewer` (null: a guest):
	 * invalid (used, cancelled, replaced or never made), expired (with the
	 * studio's name), or live with the step the visitor is at.
	 */
	async preview(
		token: string,
		viewer: User | null,
	): Promise<InvitationPreview> {
		const hash = hashAccountToken(token);
		const tenantId = await this.tenantOf(hash);
		if (!tenantId) return { state: "invalid" };
		const tenant = { id: tenantId };
		return withDbContext(
			{ tenantId },
			async (trx): Promise<InvitationPreview> => {
				const { rows } = await trx.rawQuery(
					`select i.id, i.email, i.role, i.artist_id, i.expires_at, i.expires_at > now() as live, t.name, t.slug, t.timezone
					 from tenant_invitations i join tenants t on t.id = i.tenant_id
					 where i.tenant_id = ? and i.token_hash = ?`,
					[tenantId, hash],
				);
				const row = rows[0] as PreviewRow | undefined;
				if (!row) return { state: "invalid" };
				if (!row.live) return { state: "expired", studioName: row.name };
				return {
					state: "live",
					flow: row.id,
					studio: { name: row.name, slug: row.slug, timezone: row.timezone },
					email: row.email,
					role: row.role,
					profileName: row.artist_id
						? await this.claimableName(tenant, row.artist_id)
						: null,
					expiresAt: DateTime.fromJSDate(row.expires_at),
					step: await this.stepFor(tenant, row.email, viewer),
				};
			},
		);
	}

	/**
	 * Joins `user` to the invitation's studio (spec ruling 7), under the
	 * invitation's row lock: the row must be live and match `flow`, the
	 * account confirmed, its address the invited one, and not yet a member.
	 * Then the membership, the claim (ruling 10) and the invitation's
	 * deletion, in one transaction. Throws InvitationRuleError otherwise,
	 * with nothing changed.
	 */
	async accept(user: User, token: string, flow: string): Promise<Joined> {
		if (!isFlowId(flow)) throw new InvitationRuleError("invalid");
		const hash = hashAccountToken(token);
		const tenantId = await this.tenantOf(hash);
		if (!tenantId) throw new InvitationRuleError("invalid");
		const tenant = { id: tenantId };
		return withDbContext({ tenantId }, async (trx): Promise<Joined> => {
			// A second tab or a double tap waits on this lock, then finds the
			// row gone.
			const { rows } = await trx.rawQuery(
				"select id, email, role, artist_id, expires_at > now() as live from tenant_invitations where tenant_id = ? and id = ? and token_hash = ? for update",
				[tenantId, flow, hash],
			);
			const row = rows[0] as LockedRow | undefined;
			if (!row) throw new InvitationRuleError("invalid");
			if (!row.live) throw new InvitationRuleError("expired");
			if (!user.emailVerified) throw new InvitationRuleError("unverified");
			// Both are stored canonical (two database checks), so equal means
			// the same address.
			if (user.email !== row.email) {
				throw new InvitationRuleError("wrong_account");
			}
			if (await this.membershipOf(tenant, user.id)) {
				throw new InvitationRuleError("already_member");
			}

			await TenantMembership.create(
				{ tenantId, userId: user.id, role: row.role },
				{ client: trx },
			);
			const claimed =
				row.artist_id === null
					? null
					: await this.artists.claim(tenant, row.artist_id, user.id);
			await trx.rawQuery("delete from tenant_invitations where id = ?", [
				row.id,
			]);
			const { rows: studios } = await trx.rawQuery(
				"select name, slug from tenants where id = ?",
				[tenantId],
			);
			const studio = studios[0] as { name: string; slug: string };
			return {
				studio: { name: studio.name, slug: studio.slug },
				role: row.role,
				claimed,
			};
		});
	}

	/**
	 * The id of the live studio holding the invitation with this token hash,
	 * or null: invitation_tenant(), a SECURITY DEFINER lookup, the only thing
	 * here that looks across studios.
	 */
	private async tenantOf(hash: string): Promise<string | null> {
		const { rows } = await dbClient().rawQuery(
			"select public.invitation_tenant(?) as id",
			[hash],
		);
		return (rows[0]?.id as string | null | undefined) ?? null;
	}

	private membershipOf(tenant: TenantRef, userId: string) {
		return TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.first();
	}

	/** Whether the account with this canonical address is a live member here. */
	private async isMember(tenant: TenantRef, email: string): Promise<boolean> {
		const user = await User.query().where("email", email).first();
		return user ? (await this.membershipOf(tenant, user.id)) !== null : false;
	}

	/** Whether the profile is one of the studio's live profiles nobody is linked to. */
	private async claimable(tenant: TenantRef, artistId: string) {
		return (await this.claimableName(tenant, artistId)) !== null;
	}

	private async claimableName(
		tenant: TenantRef,
		artistId: string,
	): Promise<string | null> {
		const profile = (await this.artists.list(tenant)).find(
			({ id }) => id === artistId,
		);
		return profile && profile.userId === null ? profile.name : null;
	}

	private async stepFor(
		tenant: TenantRef,
		email: string,
		viewer: User | null,
	): Promise<InvitationStep> {
		if (!viewer) return "sign_in";
		if (viewer.email !== email) return "switch_account";
		if (!viewer.emailVerified) return "confirm_email";
		return (await this.membershipOf(tenant, viewer.id))
			? "already_member"
			: "accept";
	}
}
```

- [ ] **Step 6: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=invitation_service.spec.ts` → 14 passed. `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean. If the `(xmax = 0)` column comes back under another key, log `rows[0]` once in the RED run of "inviting the same address again …" and use the real key; don't change the SQL's meaning.

- [ ] **Step 7: Commit**

```
git -C <repo> add apps/platform/app/modules/tenancy/errors.ts apps/platform/app/modules/tenancy/services/invitation_service.ts apps/platform/tests/helpers/invitations.ts apps/platform/tests/functional/tenancy/invitation_service.spec.ts
git -C <repo> commit -m "feat(platform): make, renew, cancel and accept studio invitations (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: MemberService and the members list

**Files:**
- Create: `apps/platform/app/modules/tenancy/services/member_service.ts`
- Modify: `apps/platform/app/modules/tenancy/services/tenancy_service.ts` (`TenantMember.membershipId`)
- Modify: `apps/platform/tests/functional/notifications/alert_service.spec.ts` (the `members` assertion)
- Test: `apps/platform/tests/functional/tenancy/member_service.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/tenancy/services/member_service`: `MemberService` with `findFor(tenant, id): Promise<TenantMembership>`, `remove(tenant, actor: { userId: string }, membershipId): Promise<{ name: string }>`, `changeRole(tenant, actor, membershipId, role: MembershipRole): Promise<{ name: string }>`.
- `TenantMember` gains `membershipId: string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/tenancy/member_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import { LastOwnerError, MemberRuleError } from "#modules/tenancy/errors";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import MemberService from "#modules/tenancy/services/member_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { makeClient, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const members = new MemberService(
	new TenancyService(),
	new ArtistService(new ImageService()),
);

const membershipOf = (tenant: Tenant, userId: string) =>
	inTenant(tenant, () =>
		TenantMembership.withTrashed()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.firstOrFail(),
	);

test.group("MemberService (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("remove soft-deletes the membership and unlinks the member's profile; its projects stay", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("remove-33", "Remove 33");
		const member = await artistIn(tenant, "asha@remove-33.example");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const project = await inTenant(tenant, async () => {
			await Artist.query().where("id", asha.id).update({ user_id: member.id });
			return makeProject(tenant, await makeClient(tenant), {
				artistId: asha.id,
			});
		});
		const target = await membershipOf(tenant, member.id);

		const removed = await inTenant(tenant, () =>
			members.remove(tenant, { userId: owner.id }, target.id),
		);

		assert.deepEqual(removed, { name: "asha@remove-33.example" });
		assert.isNotNull((await membershipOf(tenant, member.id)).deletedAt);
		await inTenant(tenant, async () => {
			assert.isNull((await Artist.findOrFail(asha.id)).userId);
			assert.equal(
				(await TattooProject.findOrFail(project.id)).artistId,
				asha.id,
			);
		});
	});

	test("the last owner can't be removed or demoted", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("last-33", "Last 33");
		const member = await artistIn(tenant, "asha@last-33.example");
		const ownerRow = await membershipOf(tenant, owner.id);
		// The service doesn't check who acts (the route does): here an
		// artist's id stands for an actor who isn't the target.
		const actor = { userId: member.id };

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => members.remove(tenant, actor, ownerRow.id),
				LastOwnerError,
			);
			await assert.rejects(
				() => members.changeRole(tenant, actor, ownerRow.id, "artist"),
				LastOwnerError,
			);
		});
		const after = await membershipOf(tenant, owner.id);
		assert.equal(after.role, "owner");
		assert.isNull(after.deletedAt);
	});

	test("after one owner demotes the other, the last one can't be", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("two-owners-33", "Two 33");
		const second = await artistIn(tenant, "co@two-owners-33.example");
		const secondRow = await membershipOf(tenant, second.id);
		await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, secondRow.id, "owner"),
		);
		const ownerRow = await membershipOf(tenant, owner.id);

		await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, secondRow.id, "artist"),
		);
		await inTenant(tenant, async () => {
			await assert.rejects(
				() =>
					members.changeRole(
						tenant,
						{ userId: second.id },
						ownerRow.id,
						"artist",
					),
				LastOwnerError,
			);
		});
		assert.equal((await membershipOf(tenant, owner.id)).role, "owner");
	});

	test("changeRole makes an artist an owner and back, and the profile stays linked", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("role-33", "Role 33");
		const member = await artistIn(tenant, "asha@role-33.example");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: member.id }),
		);
		const row = await membershipOf(tenant, member.id);

		const promoted = await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, row.id, "owner"),
		);
		assert.deepEqual(promoted, { name: "asha@role-33.example" });
		assert.equal((await membershipOf(tenant, member.id)).role, "owner");

		await inTenant(tenant, () =>
			members.changeRole(tenant, { userId: owner.id }, row.id, "artist"),
		);
		assert.equal((await membershipOf(tenant, member.id)).role, "artist");
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			member.id,
		);
	});

	test("nobody removes or changes their own membership here", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("self-33", "Self 33");
		await artistIn(tenant, "co@self-33.example");
		const ownerRow = await membershipOf(tenant, owner.id);
		const self = { userId: owner.id };

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => members.remove(tenant, self, ownerRow.id),
				MemberRuleError,
			);
			await assert.rejects(
				() => members.changeRole(tenant, self, ownerRow.id, "artist"),
				MemberRuleError,
			);
		});
		assert.isNull((await membershipOf(tenant, owner.id)).deletedAt);
	});

	test("another studio's membership, or a removed one, is a 404", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("own-row-33", "Own Row");
		const { tenant: other } = await studioWithOwner("other-row-33");
		const theirs = await artistIn(other, "asha@other-row-33.example");
		const theirRow = await membershipOf(other, theirs.id);
		const gone = await artistIn(tenant, "gone@own-row-33.example");
		const goneRow = await membershipOf(tenant, gone.id);
		await inTenant(tenant, () =>
			members.remove(tenant, { userId: owner.id }, goneRow.id),
		);
		const actor = { userId: owner.id };

		await inTenant(tenant, async () => {
			for (const id of [theirRow.id, goneRow.id]) {
				await assert.rejects(
					() => members.findFor(tenant, id),
					lucidErrors.E_ROW_NOT_FOUND,
				);
				await assert.rejects(
					() => members.remove(tenant, actor, id),
					lucidErrors.E_ROW_NOT_FOUND,
				);
				await assert.rejects(
					() => members.changeRole(tenant, actor, id, "owner"),
					lucidErrors.E_ROW_NOT_FOUND,
				);
			}
		});
		assert.isNull((await membershipOf(other, theirs.id)).deletedAt);
	});
});
```

In `apps/platform/tests/functional/notifications/alert_service.spec.ts`, in "TenancyService.members: live members with their account's email, oldest first", replace

```ts
		assert.deepEqual(
			await inTenant(tenant, () => new TenancyService().members(tenant)),
			[
```

with

```ts
		const listed = await inTenant(tenant, () =>
			new TenancyService().members(tenant),
		);
		assert.isTrue(listed.every(({ membershipId }) => membershipId.length > 0));
		assert.deepEqual(
			listed.map(({ userId, role, email, fullName }) => ({
				userId,
				role,
				email,
				fullName,
			})),
			[
```

(the expected array and the closing `);` stay as they are).

- [ ] **Step 2: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=member_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → 124 with "Cannot find module" for `member_service`.

- [ ] **Step 3: `membershipId` on members**

In `apps/platform/app/modules/tenancy/services/tenancy_service.ts`: add `membershipId: string;` as the first field of `TenantMember` (with the comment `/** The membership row's id (Settings, Members routes by it, TAT-33). */`), and in `members()` add `membershipId: membership.id,` as the first property of the object it builds.

- [ ] **Step 4: Write the service**

Create `apps/platform/app/modules/tenancy/services/member_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import User from "#models/user";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { MemberRuleError } from "#modules/tenancy/errors";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";

type TenantRef = { id: string };

/**
 * Removing members and changing their roles (TAT-33), owners only (the
 * routes are OWNERS in TENANT_ROUTE_ROLES; this service doesn't check who
 * acts, only that it isn't the target). Every removal and every demotion of
 * an owner calls TenancyService.assertKeepsAnOwner in its transaction,
 * which locks the owner rows, so a studio is never left without an owner.
 */
@inject()
export default class MemberService {
	constructor(
		private tenancy: TenancyService,
		private artists: ArtistService,
	) {}

	/** The studio's live membership `id`, or E_ROW_NOT_FOUND (a 404, like another studio's). */
	async findFor(tenant: TenantRef, id: string): Promise<TenantMembership> {
		return TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * Removes the member: their access ends on their next request (the
	 * tenant middleware reads the membership every time), every profile of
	 * the studio linked to them is unlinked (it stays with the studio, with
	 * its projects and sessions) and the membership is soft-deleted, in one
	 * transaction. LastOwnerError when they are the last owner;
	 * MemberRuleError("self") for the actor's own membership.
	 */
	async remove(
		tenant: TenantRef,
		actor: { userId: string },
		membershipId: string,
	): Promise<{ name: string }> {
		return withTransaction(async (trx) => {
			const target = await this.target(trx, tenant, actor, membershipId);
			await this.tenancy.assertKeepsAnOwner(trx, tenant.id, target.id);
			const live = await this.lock(trx, tenant, target.id);
			await this.artists.unlinkUser(tenant, live.userId);
			await live.softDelete(trx);
			return { name: await nameOf(live.userId) };
		});
	}

	/**
	 * Makes the member an owner or an artist. Demoting an owner needs
	 * another owner (LastOwnerError); the profile link stays.
	 * MemberRuleError("self") for the actor's own membership.
	 */
	async changeRole(
		tenant: TenantRef,
		actor: { userId: string },
		membershipId: string,
		role: MembershipRole,
	): Promise<{ name: string }> {
		const demotes = (current: MembershipRole) =>
			current === "owner" && role !== "owner";
		return withTransaction(async (trx) => {
			const target = await this.target(trx, tenant, actor, membershipId);
			if (demotes(target.role)) {
				await this.tenancy.assertKeepsAnOwner(trx, tenant.id, target.id);
			}
			const live = await this.lock(trx, tenant, target.id);
			// Made an owner by someone else while this request waited.
			if (demotes(live.role) && !demotes(target.role)) {
				await this.tenancy.assertKeepsAnOwner(trx, tenant.id, live.id);
			}
			if (live.role !== role) {
				live.role = role;
				await live.save();
			}
			return { name: await nameOf(live.userId) };
		});
	}

	/** The live membership to act on, not the actor's own. */
	private async target(
		trx: TransactionClientContract,
		tenant: TenantRef,
		actor: { userId: string },
		id: string,
	): Promise<TenantMembership> {
		const target = await TenantMembership.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", id)
			.first();
		if (!target) throw new lucidErrors.E_ROW_NOT_FOUND(TenantMembership);
		if (target.userId === actor.userId) throw new MemberRuleError("self");
		return target;
	}

	/**
	 * The membership locked until the transaction ends. Taken after
	 * assertKeepsAnOwner's owner locks, so two owners acting on each other
	 * lock in the same order. Gone meanwhile: a 404.
	 */
	private async lock(
		trx: TransactionClientContract,
		tenant: TenantRef,
		id: string,
	): Promise<TenantMembership> {
		const live = await TenantMembership.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", id)
			.forUpdate()
			.first();
		if (!live) throw new lucidErrors.E_ROW_NOT_FOUND(TenantMembership);
		return live;
	}
}

/** How the flashes name a member: their name, else their address. */
async function nameOf(userId: string): Promise<string> {
	const user = await User.find(userId);
	return user?.fullName ?? user?.email ?? "The member";
}
```

- [ ] **Step 5: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=member_service.spec.ts --files=alert_service.spec.ts --files=tenancy_service.spec.ts` → pass; typecheck clean.

- [ ] **Step 6: Commit**

```
git -C <repo> add apps/platform/app/modules/tenancy/services apps/platform/tests/functional/tenancy/member_service.spec.ts apps/platform/tests/functional/notifications/alert_service.spec.ts
git -C <repo> commit -m "feat(platform): remove members and change their roles, never leaving a studio without an owner (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings, Members

**Files:**
- Create: `apps/platform/app/modules/tenancy/validators/members.ts`
- Create: `apps/platform/app/controllers/members_controller.ts`
- Create: `apps/platform/inertia/pages/settings/members.tsx`
- Modify: `apps/platform/start/routes.ts`, `apps/platform/app/modules/tenancy/access.ts`, `apps/platform/inertia/layouts/settings.tsx`
- Modify: `apps/platform/tests/helpers/tenants.ts` (fixtures), `apps/platform/tests/isolation/cases.ts` (six cases)
- Test: `apps/platform/tests/functional/tenancy/members_page.spec.ts` (create)

- [ ] **Step 1: Write the failing HTTP tests**

Create `apps/platform/tests/functional/tenancy/members_page.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { hashAccountToken } from "#modules/identity/account_tokens";
import {
	INVITATION_LINK_FLASH,
	type NewInvitationLink,
} from "#modules/tenancy/invitations";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { addArtist } from "#tests/helpers/artists";
import { invite } from "#tests/helpers/invitations";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const base = "/t/members-33/settings/members";

async function studio() {
	const { owner, tenant } = await studioWithOwner("members-33", "Members 33");
	const member = await artistIn(tenant, "asha@members-33.example");
	const memberRow = await inTenant(tenant, () =>
		TenantMembership.query().where("user_id", member.id).firstOrFail(),
	);
	return { owner, tenant, member, memberRow };
}

const invitationsOf = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		TenantInvitation.query().where("tenant_id", tenant.id).orderBy("email"),
	);

test.group("Settings, Members (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the members, themselves marked, the invitations and the profiles they can offer", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, member, memberRow } = await studio();
		await addArtist(tenant, owner, { name: "Free", slug: "free" });
		await addArtist(tenant, owner, {
			name: "Oona",
			slug: "oona",
			linkToMe: true,
		});
		await invite(tenant, owner, { email: "mira@members-33.example" });

		const response = await client.get(base).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/members");
		const props = response.inertiaProps;
		const ownerRow = await inTenant(tenant, () =>
			TenantMembership.query().where("user_id", owner.id).firstOrFail(),
		);
		assert.deepEqual(props.members, [
			{
				id: ownerRow.id,
				name: null,
				email: owner.email,
				role: "owner",
				isYou: true,
			},
			{
				id: memberRow.id,
				name: null,
				email: member.email,
				role: "artist",
				isYou: false,
			},
		]);
		assert.deepEqual(
			props.invitations.map(
				({ email, role, expired }: { email: string; role: string; expired: boolean }) => ({
					email,
					role,
					expired,
				}),
			),
			[{ email: "mira@members-33.example", role: "artist", expired: false }],
		);
		assert.match(props.invitations[0].expiresText, /^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/);
		assert.deepEqual(
			props.profiles.map(({ name }: { name: string }) => name),
			["Free"],
		);
		assert.isNull(props.newLink);
	});

	test("inviting flashes the link once; the page shows it from the flash and never again", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();

		const response = await client
			.post(`${base}/invitations`)
			.form({ email: "Mira@Members-33.example", role: "artist", artistId: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", base);
		response.assertFlashMessage(
			"success",
			"Invitation link ready: send it to mira@members-33.example.",
		);
		const link = response.flashMessages()[INVITATION_LINK_FLASH] as NewInvitationLink;
		assert.equal(link.email, "mira@members-33.example");
		const token = link.url.split("/invitations/")[1] ?? "";
		assert.match(token, /^[A-Za-z0-9_-]{43}$/);
		const [stored] = await invitationsOf(tenant);
		assert.equal(stored.tokenHash, hashAccountToken(token));
		assert.include(link.message, "Members 33");
		assert.include(link.message, link.url);
		assert.isTrue(link.whatsappUrl.startsWith("https://wa.me/?text="));

		const shown = await client
			.get(base)
			.withFlashMessages({ [INVITATION_LINK_FLASH]: link })
			.withInertia()
			.loginAs(owner);
		assert.deepEqual(shown.inertiaProps.newLink, link);

		const later = await client.get(base).withInertia().loginAs(owner);
		assert.isNull(later.inertiaProps.newLink);
	});

	test("inviting an address again replaces its invitation", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		await invite(tenant, owner, { email: "mira@members-33.example" });

		const response = await client
			.post(`${base}/invitations`)
			.form({ email: "mira@members-33.example", role: "owner" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"New invitation link ready for mira@members-33.example. The earlier link no longer works.",
		);
		const rows = await invitationsOf(tenant);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].role, "owner");
	});

	test("a member's address, a taken profile, a bad address and no role are field errors, and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, member } = await studio();
		const taken = await addArtist(tenant, owner, {
			name: "Oona",
			slug: "oona",
			linkToMe: true,
		});
		const post = (form: Record<string, string>) =>
			client
				.post(`${base}/invitations`)
				.form(form)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const asMember = await post({ email: member.email, role: "artist" });
		assertValidationError(asMember, "email");
		const takenProfile = await post({
			email: "new@members-33.example",
			role: "artist",
			artistId: taken.id,
		});
		assertValidationError(takenProfile, "artistId");
		assertValidationError(
			await post({ email: "not-an-address", role: "artist" }),
			"email",
		);
		assertValidationError(
			await post({ email: "new@members-33.example", role: "staff" }),
			"role",
		);
		assert.isEmpty(await invitationsOf(tenant));
	});

	test("a new link replaces the old one; cancelling kills it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		const made = await invite(tenant, owner, { email: "mira@members-33.example" });

		const renewed = await client
			.post(`${base}/invitations/${made.id}/renew`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		renewed.assertFlashMessage(
			"success",
			"New link ready for mira@members-33.example. The old one no longer works.",
		);
		const link = renewed.flashMessages()[INVITATION_LINK_FLASH] as NewInvitationLink;
		const [row] = await invitationsOf(tenant);
		assert.notEqual(row.tokenHash, hashAccountToken(made.token));
		assert.equal(
			row.tokenHash,
			hashAccountToken(link.url.split("/invitations/")[1] ?? ""),
		);

		const cancelled = await client
			.delete(`${base}/invitations/${made.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		cancelled.assertFlashMessage(
			"success",
			"Invitation for mira@members-33.example cancelled. Its link no longer works.",
		);
		assert.isEmpty(await invitationsOf(tenant));
	});

	test("make owner and make artist", async ({ client, assert }) => {
		const { owner, tenant, memberRow } = await studio();
		const put = (role: string) =>
			client
				.put(`${base}/${memberRow.id}/role`)
				.form({ role })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		(await put("owner")).assertFlashMessage(
			"success",
			"asha@members-33.example is now an owner.",
		);
		const promoted = await inTenant(tenant, () =>
			TenantMembership.findOrFail(memberRow.id),
		);
		assert.equal(promoted.role, "owner");

		(await put("artist")).assertFlashMessage(
			"success",
			"asha@members-33.example is now an artist.",
		);
	});

	test("removing a member: their next request is a 404, and their profile stays with the studio, unlinked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, member, memberRow } = await studio();
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: member.id }),
		);
		(await client.get("/t/members-33/projects").loginAs(member)).assertStatus(
			200,
		);

		const response = await client
			.delete(`${base}/${memberRow.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"asha@members-33.example removed. Their access to Members 33 ended.",
		);
		(await client.get("/t/members-33/projects").loginAs(member)).assertStatus(
			404,
		);
		const profile = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.isNull(profile.userId);
		assert.isNull(profile.deletedAt);
	});

	test("an owner can't remove themselves or change their own role", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		const ownerRow = await inTenant(tenant, () =>
			TenantMembership.query().where("user_id", owner.id).firstOrFail(),
		);

		for (const request of [
			client.delete(`${base}/${ownerRow.id}`),
			client.put(`${base}/${ownerRow.id}/role`).form({ role: "artist" }),
		]) {
			const response = await request
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			response.assertHeader("location", base);
			response.assertFlashMessage(
				"error",
				"You can't remove yourself or change your own role here.",
			);
		}
		const after = await inTenant(tenant, () =>
			TenantMembership.findOrFail(ownerRow.id),
		);
		assert.equal(after.role, "owner");
		assert.isNull(after.deletedAt);
	});

	test("another studio's member is a 404, even with a bad body", async ({
		client,
	}) => {
		const { owner } = await studio();
		const { tenant: other } = await studioWithOwner("members-other-33");
		const theirs = await artistIn(other, "asha@members-other-33.example");
		const theirRow = await inTenant(other, () =>
			TenantMembership.query().where("user_id", theirs.id).firstOrFail(),
		);

		for (const request of [
			client.put(`${base}/${theirRow.id}/role`).form({ role: "nope" }),
			client.delete(`${base}/${theirRow.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});
});
```

- [ ] **Step 2: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=members_page.spec.ts` → every test fails with 404 (no routes).

- [ ] **Step 3: The validators**

Create `apps/platform/app/modules/tenancy/validators/members.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { canonicalEmail } from "#modules/identity/email_address";
import { MEMBERSHIP_ROLES } from "#modules/tenancy/models/tenant_membership";

/**
 * An invitation (TAT-33): the address it is bound to, canonical as accounts
 * store it (TAT-18), the role, and an optional profile to claim ("None"
 * arrives as null).
 */
export const inviteValidator = vine.create({
	email: vine
		.string()
		.trim()
		.email()
		.maxLength(254)
		.transform(canonicalEmail),
	role: vine.enum(MEMBERSHIP_ROLES),
	artistId: vine.string().uuid().nullable().optional(),
});
inviteValidator.messagesProvider = new SimpleMessagesProvider({
	"email.required": "Enter their email address.",
	"email.email": "Enter an email address, like ink@example.com.",
	"email.maxLength": "Use at most 254 characters.",
	"role.required": "Choose a role.",
	"role.enum": "Choose a role.",
	"artistId.uuid": "Choose a profile from the list.",
});

/** A member's new role (TAT-33). */
export const memberRoleValidator = vine.create({
	role: vine.enum(MEMBERSHIP_ROLES),
});
memberRoleValidator.messagesProvider = new SimpleMessagesProvider({
	"role.required": "Choose a role.",
	"role.enum": "Choose a role.",
});
```

- [ ] **Step 4: The controller**

Create `apps/platform/app/controllers/members_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import type { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	InvitationRuleError,
	LastOwnerError,
	MemberRuleError,
} from "#modules/tenancy/errors";
import {
	expiryText,
	INVITATION_LINK_FLASH,
	invitationUrl,
	inviteMessage,
	isNewInvitationLink,
	type NewInvitationLink,
	ROLE_WORDS,
	whatsappShareUrl,
} from "#modules/tenancy/invitations";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InvitationService from "#modules/tenancy/services/invitation_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MemberService from "#modules/tenancy/services/member_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	inviteValidator,
	memberRoleValidator,
} from "#modules/tenancy/validators/members";
import env from "#start/env";

/**
 * Settings, Members (TAT-33): the studio's members and pending invitations,
 * for owners (TENANT_ROUTE_ROLES). A new invitation's link is shown once,
 * on the page after the request that made it, from a session flash; it is
 * never stored or shown again. Every :id loads through the services, scoped
 * to the studio, so another studio's id is a 404.
 */
@inject()
export default class MembersController {
	constructor(
		private tenancy: TenancyService,
		private members: MemberService,
		private invitations: InvitationService,
		private artists: ArtistService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const members = await this.tenancy.members(tenant);
		const pending = await this.invitations.pending(tenant);
		const profiles = (await this.artists.list(tenant)).filter(
			({ userId }) => userId === null,
		);
		const link = ctx.session.flashMessages.get(INVITATION_LINK_FLASH);

		return ctx.inertia.render("settings/members", {
			members: members.map((member) => ({
				id: member.membershipId,
				name: member.fullName,
				email: member.email,
				role: member.role,
				isYou: member.userId === membership.userId,
			})),
			invitations: pending.map((invitation) => ({
				id: invitation.id,
				email: invitation.email,
				role: invitation.role,
				profileName: invitation.profileName,
				expired: invitation.expired,
				expiresText: expiryText(invitation.expiresAt, tenant.timezone),
			})),
			profiles: profiles.map(({ id, name }) => ({ id, name })),
			newLink: isNewInvitationLink(link) ? link : null,
		});
	}

	async invite(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(inviteValidator);
		let made: { token: string; replaced: boolean; expiresAt: DateTime };
		try {
			made = await this.invitations.invite(tenant, ctx.auth.getUserOrFail(), {
				email: data.email,
				role: data.role,
				artistId: data.artistId ?? null,
			});
		} catch (error) {
			if (error instanceof InvitationRuleError) {
				if (error.reason === "already_member") {
					throw fieldError(
						"email",
						`${data.email} is already a member of this studio.`,
						"member",
					);
				}
				if (error.reason === "profile_unavailable") {
					throw fieldError(
						"artistId",
						"That profile already belongs to someone, or was removed. Choose another, or none.",
						"available",
					);
				}
			}
			throw error;
		}

		flashLink(ctx, tenant, data.email, made.token, made.expiresAt);
		ctx.session.flash(
			"success",
			made.replaced
				? `New invitation link ready for ${data.email}. The earlier link no longer works.`
				: `Invitation link ready: send it to ${data.email}.`,
		);
		return toMembers(ctx, tenant);
	}

	async renew(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { email, token, expiresAt } = await this.invitations.renew(
			tenant,
			ctx.auth.getUserOrFail(),
			ctx.params.id,
		);
		flashLink(ctx, tenant, email, token, expiresAt);
		ctx.session.flash(
			"success",
			`New link ready for ${email}. The old one no longer works.`,
		);
		return toMembers(ctx, tenant);
	}

	async revoke(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { email } = await this.invitations.revoke(tenant, ctx.params.id);
		ctx.session.flash(
			"success",
			`Invitation for ${email} cancelled. Its link no longer works.`,
		);
		return toMembers(ctx, tenant);
	}

	async role(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		// Load first: another studio's id is a 404 even with a bad body.
		await this.members.findFor(tenant, ctx.params.id);
		const { role } = await ctx.request.validateUsing(memberRoleValidator);
		const done = await refusalsAsFlash(ctx, () =>
			this.members.changeRole(tenant, membership, ctx.params.id, role),
		);
		if (done) {
			ctx.session.flash("success", `${done.name} is now ${ROLE_WORDS[role]}.`);
		}
		return toMembers(ctx, tenant);
	}

	async remove(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const done = await refusalsAsFlash(ctx, () =>
			this.members.remove(tenant, membership, ctx.params.id),
		);
		if (done) {
			ctx.session.flash(
				"success",
				`${done.name} removed. Their access to ${tenant.name} ended.`,
			);
		}
		return toMembers(ctx, tenant);
	}
}

function toMembers(ctx: HttpContext, tenant: Tenant) {
	return ctx.response
		.redirect()
		.toRoute("tenant.settings.members", { tenant: tenant.slug });
}

/** Puts a new link in the one-time flash the Members page shows. */
function flashLink(
	ctx: HttpContext,
	tenant: Tenant,
	email: string,
	token: string,
	expiresAt: DateTime,
) {
	const url = invitationUrl(env.get("APP_URL"), token);
	const message = inviteMessage(tenant.name, url);
	const link: NewInvitationLink = {
		email,
		url,
		message,
		whatsappUrl: whatsappShareUrl(message),
		expiresText: expiryText(expiresAt, tenant.timezone),
	};
	ctx.session.flash(INVITATION_LINK_FLASH, link);
}

/**
 * Runs a member change; the last-owner and self refusals become an error
 * toast (null is returned), anything else goes on up. The last-owner one is
 * only reachable through a race: an owner acting on someone else always
 * remains an owner themselves.
 */
async function refusalsAsFlash<T>(
	ctx: HttpContext,
	work: () => Promise<T>,
): Promise<T | null> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof LastOwnerError) {
			ctx.session.flash(
				"error",
				"A studio needs at least one owner: make someone else an owner first.",
			);
			return null;
		}
		if (error instanceof MemberRuleError) {
			ctx.session.flash(
				"error",
				"You can't remove yourself or change your own role here.",
			);
			return null;
		}
		throw error;
	}
}

function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}
```

Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` (so `controllers.Members` exists).

- [ ] **Step 5: Routes and the role table**

In `start/routes.ts`, inside the settings group, after the `tenant.settings.messages.update` route, add:

```ts
				// Members and invitations (TAT-33). A new invitation's link is
				// shown once, on the members page.
				router
					.get("members", [controllers.Members, "index"])
					.as("tenant.settings.members");
				router
					.post("members/invitations", [controllers.Members, "invite"])
					.as("tenant.settings.members.invitations.store");
				router
					.post("members/invitations/:id/renew", [
						controllers.Members,
						"renew",
					])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.members.invitations.renew");
				router
					.delete("members/invitations/:id", [controllers.Members, "revoke"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.members.invitations.destroy");
				router
					.put("members/:id/role", [controllers.Members, "role"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.members.role.update");
				router
					.delete("members/:id", [controllers.Members, "remove"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.members.destroy");
```

In `app/modules/tenancy/access.ts`, after `"tenant.settings.messages.update": OWNERS,` add:

```ts
	"tenant.settings.members": OWNERS,
	"tenant.settings.members.invitations.store": OWNERS,
	"tenant.settings.members.invitations.renew": OWNERS,
	"tenant.settings.members.invitations.destroy": OWNERS,
	"tenant.settings.members.role.update": OWNERS,
	"tenant.settings.members.destroy": OWNERS,
```

- [ ] **Step 6: Fixtures and isolation cases**

In `apps/platform/tests/helpers/tenants.ts`:

1. Imports: `import TenantInvitation from "#modules/tenancy/models/tenant_invitation";` and `import InvitationService from "#modules/tenancy/services/invitation_service";` (Biome orders them).
2. Next to `const artists = new ArtistService(new ImageService());` add `const invitations = new InvitationService(artists);`.
3. In `seededStudio`, before `return {`, add:

```ts
	// A pending invitation and the artist's membership row, for the members
	// routes (TAT-33).
	const invitation = await inTenant(tenant, async () => {
		const made = await invitations.invite(tenant, owner, {
			email: `invitee@${slug}.example`,
			role: "artist",
			artistId: null,
		});
		return TenantInvitation.findOrFail(made.id);
	});
	const artistMembership = await inTenant(tenant, () =>
		TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("user_id", artist.id)
			.firstOrFail(),
	);
```

and add to the returned object:

```ts
		// The members routes' :id resources (TAT-33).
		invitation,
		artistMembership,
```

4. Add to `twoStudios`' doc comment: `a pending invitation (invitation) and the artist's membership row (artistMembership) are the members routes' (TAT-33).`

In `apps/platform/tests/isolation/cases.ts`:

1. Imports: `TenantInvitation` (`#modules/tenancy/models/tenant_invitation`) and `TenantMembership` (`#modules/tenancy/models/tenant_membership`).
2. In the `resource` union, change `| "alert";` to `| "alert"\n\t\t| "invitation"\n\t\t| "artistMembership";`.
3. Add after `alertRows`:

```ts
// Memberships (removed ones included), invitations and who each profile is
// linked to (TAT-33): what the members routes could change.
const memberRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		memberships: (
			await TenantMembership.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((membership) => membership.serialize()),
		invitations: (
			await TenantInvitation.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((invitation) => invitation.serialize()),
		profiles: (
			await Artist.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map(({ id, userId }) => ({ id, userId })),
	}));
```

4. Append to `isolationCases`:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/settings/members",
		actor: "owner",
		ownStatus: 200,
		snapshot: memberRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/members/invitations",
		actor: "owner",
		body: () => ({ email: "new-member@example.com", role: "artist" }),
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/members/invitations/:id/renew",
		resource: "invitation",
		actor: "owner",
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/settings/members/invitations/:id",
		resource: "invitation",
		actor: "owner",
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/members/:id/role",
		resource: "artistMembership",
		actor: "owner",
		body: () => ({ role: "owner" }),
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/settings/members/:id",
		resource: "artistMembership",
		actor: "owner",
		ownStatus: 302,
		snapshot: memberRows,
	},
```

- [ ] **Step 7: The page and the settings entry**

In `apps/platform/inertia/layouts/settings.tsx`: import `UserPlus` from `lucide-react`, add after the Artists entry

```tsx
		{
			label: "Members",
			route: "tenant.settings.members",
			params,
			icon: UserPlus,
		},
```

and change the `Page` description to `Your studio's public details, its artists and members, how clients pay you and the messages you send them.`

Create `apps/platform/inertia/pages/settings/members.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { cn } from "cn";
import { toast } from "sonner";
import { urlFor } from "~/client";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
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
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Role = "owner" | "artist";

type MemberRow = {
	id: string;
	name: string | null;
	email: string;
	role: Role;
	isYou: boolean;
};

type InvitationRow = {
	id: string;
	email: string;
	role: Role;
	profileName: string | null;
	expired: boolean;
	expiresText: string;
};

type NewLink = {
	email: string;
	url: string;
	message: string;
	whatsappUrl: string;
	expiresText: string;
};

const ROLE_LABELS: Record<Role, string> = { owner: "Owner", artist: "Artist" };

const ROLE_COPY: Record<Role, string> = {
	artist: "Their own profile, and the projects and sessions assigned to them.",
	owner: "Everything in the studio, including payments and settings.",
};

/**
 * Settings, Members (TAT-33): who is in the studio, the invitations waiting,
 * and a way to invite someone. A new link shows once, at the top.
 */
export default function Members({
	members,
	invitations,
	profiles,
	newLink,
}: {
	members: MemberRow[];
	invitations: InvitationRow[];
	profiles: { id: string; name: string }[];
	newLink: NewLink | null;
}) {
	const tenant = useTenant();

	return (
		<>
			{newLink && <NewLinkBox link={newLink} />}

			<Section
				title="Invite someone"
				description="They join with an account that uses this address. You send them the link yourself."
			>
				<Form
					route="tenant.settings.members.invitations.store"
					routeParams={{ tenant: tenant.slug }}
				>
					{({ errors, processing }) => (
						<FieldGroup>
							<Field data-invalid={!!errors.email}>
								<FieldLabel htmlFor="invite-email">Email</FieldLabel>
								<Input
									id="invite-email"
									name="email"
									type="email"
									autoComplete="off"
									className="h-11"
									aria-invalid={!!errors.email}
								/>
								{errors.email && <FieldError>{errors.email}</FieldError>}
							</Field>

							<FieldSet data-invalid={!!errors.role}>
								<FieldLegend variant="label">Role</FieldLegend>
								<RadioGroup name="role" defaultValue="artist">
									{(["artist", "owner"] as const).map((role) => (
										<FieldLabel key={role} htmlFor={`role-${role}`}>
											<Field orientation="horizontal">
												<FieldContent>
													<FieldTitle>{ROLE_LABELS[role]}</FieldTitle>
													<FieldDescription>{ROLE_COPY[role]}</FieldDescription>
												</FieldContent>
												<RadioGroupItem
													value={role}
													id={`role-${role}`}
													aria-invalid={!!errors.role}
												/>
											</Field>
										</FieldLabel>
									))}
								</RadioGroup>
								{errors.role && <FieldError>{errors.role}</FieldError>}
							</FieldSet>

							{profiles.length > 0 && (
								<Field data-invalid={!!errors.artistId}>
									<FieldLabel htmlFor="invite-profile">Artist profile</FieldLabel>
									<select
										id="invite-profile"
										name="artistId"
										defaultValue=""
										className="h-11 min-w-0 rounded-md border bg-transparent px-3 text-sm"
										aria-invalid={!!errors.artistId}
									>
										<option value="">None</option>
										{profiles.map(({ id, name }) => (
											<option key={id} value={id}>
												{name}
											</option>
										))}
									</select>
									<FieldDescription>
										Gives them this profile, with its projects and sessions.
									</FieldDescription>
									{errors.artistId && (
										<FieldError>{errors.artistId}</FieldError>
									)}
								</Field>
							)}

							<div>
								<Button type="submit" className="h-11" disabled={processing}>
									{processing ? "Creating…" : "Create invitation link"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			</Section>

			<Section title="Members">
				<ul className="flex flex-col gap-2">
					{members.map((member) => (
						<MemberItem
							key={member.id}
							member={member}
							studio={tenant.name}
							tenantSlug={tenant.slug}
						/>
					))}
				</ul>
			</Section>

			<Section title="Invitations">
				{invitations.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No invitations waiting.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{invitations.map((invitation) => (
							<InvitationItem
								key={invitation.id}
								invitation={invitation}
								tenantSlug={tenant.slug}
							/>
						))}
					</ul>
				)}
			</Section>
		</>
	);
}

function NewLinkBox({ link }: { link: NewLink }) {
	const copy = () => {
		// No clipboard outside a secure context (a phone on the LAN opening
		// the dev server): the field can still be selected.
		if (!navigator.clipboard) {
			toast.error("Couldn't copy: select the link instead.");
			return;
		}
		navigator.clipboard.writeText(link.url).then(
			() => toast.success("Link copied."),
			() => toast.error("Couldn't copy: select the link instead."),
		);
	};

	return (
		<Section title={`Invitation link for ${link.email}`}>
			<div className="flex flex-col gap-3 rounded-lg border p-3">
				<div className="flex flex-wrap gap-2">
					<Input
						aria-label="Invitation link"
						readOnly
						value={link.url}
						onFocus={(event) => event.currentTarget.select()}
						className="h-11 min-w-0 flex-1"
					/>
					<Button
						type="button"
						variant="outline"
						className="h-11"
						onClick={copy}
					>
						Copy link
					</Button>
				</div>
				<a
					href={link.whatsappUrl}
					target="_blank"
					rel="noopener noreferrer"
					className={cn(buttonVariants(), "h-11 self-start")}
				>
					Share on WhatsApp
				</a>
				<p className="text-sm text-muted-foreground">
					Send it to them yourself, on WhatsApp, Viber or any chat. It works
					once, until {link.expiresText}, and only for an account with{" "}
					<span className="break-words">{link.email}</span>. You won't see this
					link again: if you lose it, make a new one below.
				</p>
			</div>
		</Section>
	);
}

function MemberItem({
	member,
	studio,
	tenantSlug,
}: {
	member: MemberRow;
	studio: string;
	tenantSlug: string;
}) {
	const params = { tenant: tenantSlug, id: member.id };
	const label = member.name ?? member.email;
	const next: Role = member.role === "owner" ? "artist" : "owner";

	const change = () => {
		const question =
			next === "owner"
				? `Make ${label} an owner? Owners can do everything in the studio, including payments and settings.`
				: `Make ${label} an artist? They keep their own profile and assigned projects, and lose everything else.`;
		if (window.confirm(question)) {
			router.put(
				urlFor("tenant.settings.members.role.update", params),
				{ role: next },
				{ preserveScroll: true },
			);
		}
	};
	const remove = () => {
		if (
			window.confirm(
				`Remove ${label}? They lose access to ${studio} at once. Their artist profile stays with the studio, unlinked.`,
			)
		) {
			router.delete(urlFor("tenant.settings.members.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<li className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
			{/* min-w-40: on narrow screens the buttons wrap below instead. */}
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium break-words">{label}</span>
					<Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
					{member.isYou && <Badge variant="outline">You</Badge>}
				</div>
				{member.name && (
					<p className="text-sm break-words text-muted-foreground">
						{member.email}
					</p>
				)}
			</div>
			{!member.isYou && (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						className="h-11"
						onClick={change}
					>
						{next === "owner" ? "Make owner" : "Make artist"}
					</Button>
					<Button
						type="button"
						variant="ghost"
						className="h-11"
						onClick={remove}
					>
						Remove
					</Button>
				</div>
			)}
		</li>
	);
}

function InvitationItem({
	invitation,
	tenantSlug,
}: {
	invitation: InvitationRow;
	tenantSlug: string;
}) {
	const params = { tenant: tenantSlug, id: invitation.id };

	// No preserveScroll on a new link: the page opens at the top, where it shows.
	const renew = () => {
		if (
			window.confirm(
				`Make a new link for ${invitation.email}? The link you sent before stops working.`,
			)
		) {
			router.post(
				urlFor("tenant.settings.members.invitations.renew", params),
				{},
			);
		}
	};
	const cancel = () => {
		if (
			window.confirm(
				`Cancel the invitation for ${invitation.email}? Its link stops working.`,
			)
		) {
			router.delete(
				urlFor("tenant.settings.members.invitations.destroy", params),
				{ preserveScroll: true },
			);
		}
	};
	const details = [
		ROLE_LABELS[invitation.role],
		invitation.profileName ? `profile "${invitation.profileName}"` : null,
		invitation.expired
			? `Expired ${invitation.expiresText}`
			: `Works until ${invitation.expiresText}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<li className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
			<div className="flex min-w-40 flex-1 flex-col gap-1">
				<span className="font-medium break-words">{invitation.email}</span>
				<p className="text-sm text-muted-foreground">{details}</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					className="h-11"
					onClick={renew}
				>
					New link
				</Button>
				<Button
					type="button"
					variant="ghost"
					className="h-11"
					onClick={cancel}
				>
					Cancel invitation
				</Button>
			</div>
		</li>
	);
}

Members.layout = [AppLayout, SettingsLayout];
```

- [ ] **Step 8: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=members_page.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=role_access.spec.ts --files=harness.spec.ts` → all pass (the walk sends the six new routes as an artist: 404, unchanged). `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check` → clean.

- [ ] **Step 9: Commit**

```
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/inertia apps/platform/tests apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): add Settings, Members: invite, renew, cancel, change roles, remove (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The invitation link and page

**Files:**
- Create: `apps/platform/app/controllers/invitations_controller.ts`
- Create: `apps/platform/inertia/pages/invitations/show.tsx`
- Modify: `apps/platform/start/routes.ts`, `apps/platform/inertia/pages/onboarding/create_tenant.tsx`
- Modify: `apps/platform/tests/functional/identity/account_routes.spec.ts`, `apps/platform/tests/functional/identity/sessions.spec.ts`
- Test: `apps/platform/tests/functional/tenancy/invitations_http.spec.ts` (create)

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/identity/account_routes.spec.ts`:

- `const NEEDS_CONFIRMED_EMAIL = ["GET /onboarding", "POST /onboarding"];` → `const NEEDS_CONFIRMED_EMAIL = ["GET /onboarding", "POST /onboarding", "POST /invitations"];` and its comment's last sentence becomes `Accepting an invitation is TAT-33's.`
- add to `THROTTLES`: `"GET /invitations/:token": ["account_linksThrottle"],` and `"POST /invitations": ["account_linksThrottle"],`.
- add to `OPEN`: `"GET /invitations/:token",` and `"GET /invitations",`, and change its comment to `/** Open to guests and signed-in visitors alike (TAT-18 spec ruling 16; the invitation page, TAT-33). */`.

In `apps/platform/tests/functional/identity/sessions.spec.ts`, add `INVITATION_TOKEN_KEY` to the `#modules/identity/account_tokens` import and, inside the group:

```ts
	test("signing in and out forget a staged invitation (TAT-33)", async ({
		client,
	}) => {
		const user = await makeUser();
		const staged = { [INVITATION_TOKEN_KEY]: "i".repeat(43) };

		const login = await client
			.post("/login")
			.withSession(staged)
			.form({ email: user.email, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);
		login.assertSessionMissing(INVITATION_TOKEN_KEY);

		const logout = await client
			.post("/logout")
			.withSession(staged)
			.loginAs(await User.findOrFail(user.id))
			.withCsrfToken()
			.redirects(0);
		logout.assertSessionMissing(INVITATION_TOKEN_KEY);
	});
```

Create `apps/platform/tests/functional/tenancy/invitations_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import { INVITATION_TOKEN_KEY } from "#modules/identity/account_tokens";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { addArtist } from "#tests/helpers/artists";
import {
	confirmedUser,
	expireInvitation,
	invitationFlow,
	invite,
} from "#tests/helpers/invitations";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const REFUSED = "Invalid or expired CSRF token";

async function studio() {
	const { owner, tenant } = await studioWithOwner("join-33", "Join 33");
	const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
	const made = await invite(tenant, owner, {
		email: "asha@join-33.example",
		artistId: asha.id,
	});
	return { owner, tenant, asha, made };
}

const membersOf = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		TenantMembership.query().where("tenant_id", tenant.id),
	);

test.group("The invitation link and page (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the link only stages its token and opens the page without it", async ({
		client,
	}) => {
		const { made } = await studio();

		const response = await client
			.get(`/invitations/${made.token}`)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/invitations");
		response.assertHeader("referrer-policy", "no-referrer");
		response.assertHeader("cache-control", "no-store");
		response.assertSession(INVITATION_TOKEN_KEY, made.token);
	});

	test("a malformed link is the router's 404", async ({ client }) => {
		(await client.get("/invitations/short").redirects(0)).assertStatus(404);
		(
			await client.get(`/invitations/${"a".repeat(42)}=`).redirects(0)
		).assertStatus(404);
	});

	test("a guest sees the studio, the address, the role, the profile and both ways in, never the token", async ({
		client,
		assert,
	}) => {
		const { made } = await studio();

		const page = await client
			.get("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.withInertia();

		page.assertStatus(200);
		page.assertInertiaComponent("invitations/show");
		page.assertHeader("cache-control", "no-store");
		page.assertHeader("referrer-policy", "same-origin");
		const props = page.inertiaProps;
		assert.equal(props.state, "ready");
		assert.equal(props.step, "sign_in");
		assert.equal(props.studioName, "Join 33");
		assert.equal(props.email, "asha@join-33.example");
		assert.equal(props.role, "artist");
		assert.equal(props.profileName, "Asha");
		assert.isNull(props.flow);
		assert.isNull(props.studioSlug);
		assert.notInclude(JSON.stringify(props), made.token);
	});

	test("a guest sees the same page whether or not the address has an account", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, made } = await studio();
		const other = await invite(tenant, owner, { email: "none@join-33.example" });
		await User.create({
			email: "asha@join-33.example",
			password: "secret-password",
		});
		const props = async (token: string) =>
			(
				await client
					.get("/invitations")
					.withSession({ [INVITATION_TOKEN_KEY]: token })
					.withInertia()
			).inertiaProps;

		const withAccount = await props(made.token);
		const without = await props(other.token);
		assert.equal(withAccount.step, without.step);
		assert.deepEqual(Object.keys(withAccount).sort(), Object.keys(without).sort());
	});

	test("the steps for a signed-in visitor: another account, unconfirmed, ready, a member", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const other = await confirmedUser("other@join-33.example");
		const invitee = await User.create({
			email: "asha@join-33.example",
			password: "secret-password",
		});
		const stepOf = async (user: User) =>
			(
				await client
					.get("/invitations")
					.withSession({ [INVITATION_TOKEN_KEY]: made.token })
					.withInertia()
					.loginAs(user)
			).inertiaProps;

		const switching = await stepOf(other);
		assert.equal(switching.step, "switch_account");
		assert.equal(switching.viewerEmail, "other@join-33.example");
		assert.equal((await stepOf(invitee)).step, "confirm_email");

		await User.query()
			.where("id", invitee.id)
			.update({ email_verified_at: new Date() });
		const ready = await stepOf(await User.findOrFail(invitee.id));
		assert.equal(ready.step, "accept");
		assert.equal(ready.flow, await invitationFlow(tenant, made.token));

		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: invitee.id,
				role: "artist",
			}),
		);
		const member = await stepOf(await User.findOrFail(invitee.id));
		assert.equal(member.step, "already_member");
		assert.equal(member.studioSlug, "join-33");
		assert.isNull(member.flow);
	});

	test("an expired, an unknown and a missing link", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		await expireInvitation(tenant, made.id);
		const pageFor = async (session: Record<string, string>) =>
			(await client.get("/invitations").withSession(session).withInertia())
				.inertiaProps;

		const expired = await pageFor({ [INVITATION_TOKEN_KEY]: made.token });
		assert.equal(expired.state, "expired");
		assert.equal(expired.studioName, "Join 33");
		assert.equal(
			(await pageFor({ [INVITATION_TOKEN_KEY]: "z".repeat(43) })).state,
			"invalid",
		);
		assert.equal((await pageFor({})).state, "invalid");
	});

	test("joining: the member exists with the profile, the link is used up, and an artist lands on Projects", async ({
		client,
		assert,
	}) => {
		const { tenant, asha, made } = await studio();
		const user = await confirmedUser("asha@join-33.example");

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: await invitationFlow(tenant, made.token) })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/join-33/projects");
		response.assertFlashMessage(
			"success",
			"You joined Join 33. Your artist profile is linked to you.",
		);
		response.assertSessionMissing(INVITATION_TOKEN_KEY);
		assert.lengthOf(await membersOf(tenant), 2);
		assert.equal(
			(await inTenant(tenant, () => Artist.findOrFail(asha.id))).userId,
			user.id,
		);
		(await client.get("/t/join-33/projects").loginAs(user)).assertStatus(200);
		assert.equal(
			(
				await client
					.get("/invitations")
					.withSession({ [INVITATION_TOKEN_KEY]: made.token })
					.withInertia()
			).inertiaProps.state,
			"invalid",
		);
	});

	test("an owner's invitation lands on the Inbox; a taken profile still joins, with the note", async ({
		client,
	}) => {
		const { owner, tenant, asha } = await studio();
		const forOwner = await invite(tenant, owner, {
			email: "co@join-33.example",
			role: "owner",
		});
		const forArtist = await invite(tenant, owner, {
			email: "mira@join-33.example",
			artistId: asha.id,
		});
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: owner.id }),
		);
		const join = async (email: string, token: string) =>
			client
				.post("/invitations")
				.withSession({ [INVITATION_TOKEN_KEY]: token })
				.form({ flow: await invitationFlow(tenant, token) })
				.withCsrfToken()
				.loginAs(await confirmedUser(email))
				.redirects(0);

		const asOwner = await join("co@join-33.example", forOwner.token);
		asOwner.assertHeader("location", "/t/join-33/inbox");
		asOwner.assertFlashMessage("success", "You joined Join 33.");

		const taken = await join("mira@join-33.example", forArtist.token);
		taken.assertFlashMessage(
			"success",
			"You joined Join 33. The artist profile in the invitation was taken or removed: ask an owner to link one.",
		);
	});

	test("joining is refused for another account, without the flow, with another invitation's flow and without CSRF; nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, made } = await studio();
		const other = await invite(tenant, owner, { email: "mira@join-33.example" });
		const wrong = await confirmedUser("other@join-33.example");
		const invitee = await confirmedUser("asha@join-33.example");
		const staged = { [INVITATION_TOKEN_KEY]: made.token };

		const wrongAccount = await client
			.post("/invitations")
			.withSession(staged)
			.form({ flow: await invitationFlow(tenant, made.token) })
			.withCsrfToken()
			.loginAs(wrong)
			.redirects(0);
		wrongAccount.assertHeader("location", "/invitations");

		for (const form of [{}, { flow: other.id }]) {
			const response = await client
				.post("/invitations")
				.withSession(staged)
				.form(form)
				.withCsrfToken()
				.loginAs(invitee)
				.redirects(0);
			response.assertHeader("location", "/invitations");
		}

		const noCsrf = await client
			.post("/invitations")
			.withSession(staged)
			.form({ flow: await invitationFlow(tenant, made.token) })
			.loginAs(invitee)
			.redirects(0);
		noCsrf.assertFlashMessage("error", REFUSED);

		assert.lengthOf(await membersOf(tenant), 1);
	});

	test("an unconfirmed account goes to /confirm-email, and nothing changes", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const unconfirmed = await User.create({
			email: "asha@join-33.example",
			password: "secret-password",
		});

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: await invitationFlow(tenant, made.token) })
			.withCsrfToken()
			.loginAs(unconfirmed)
			.redirects(0);

		response.assertHeader("location", "/confirm-email");
		assert.lengthOf(await membersOf(tenant), 1);
	});

	test("a member of another studio joins this one with their own address, and nothing else changes for them", async ({
		client,
		assert,
	}) => {
		const { tenant, made } = await studio();
		const { owner: elsewhere, tenant: theirs } = await studioWithOwner(
			"elsewhere-33",
			"Elsewhere",
		);
		await User.query()
			.where("id", elsewhere.id)
			.update({ email: "asha@join-33.example", email_verified_at: new Date() });
		const user = await User.findOrFail(elsewhere.id);

		const response = await client
			.post("/invitations")
			.withSession({ [INVITATION_TOKEN_KEY]: made.token })
			.form({ flow: await invitationFlow(tenant, made.token) })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertHeader("location", "/t/join-33/projects");
		assert.lengthOf(await membersOf(tenant), 2);
		const own = await inTenant(theirs, () =>
			TenantMembership.query().where("tenant_id", theirs.id),
		);
		assert.deepEqual(
			own.map(({ userId, role }) => ({ userId, role })),
			[{ userId: user.id, role: "owner" }],
		);
	});
});
```

- [ ] **Step 2: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=invitations_http.spec.ts --files=account_routes.spec.ts --files=sessions.spec.ts` → the invitation tests fail with 404 (no routes) and `account_routes.spec.ts` with "No route POST /invitations"; the sessions test passes already (Task 1).

- [ ] **Step 3: The controller**

Create `apps/platform/app/controllers/invitations_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type User from "#models/user";
import {
	FLOW_FIELD,
	INVITATION_TOKEN_KEY,
} from "#modules/identity/account_tokens";
import { InvitationRuleError } from "#modules/tenancy/errors";
import { expiryText } from "#modules/tenancy/invitations";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InvitationService, {
	type InvitationPreview,
	type Joined,
} from "#modules/tenancy/services/invitation_service";

/**
 * Invitation links (TAT-33). The link's GET only moves its token into the
 * session and opens /invitations, whose URL holds no token; joining is that
 * page's POST, which needs a signed-in account with the invited, confirmed
 * address (verifiedEmail, then InvitationService.accept). Open to guests and
 * to whoever is signed in; it signs nobody in or out.
 */
@inject()
export default class InvitationsController {
	constructor(private invitations: InvitationService) {}

	async link({ params, session, response }: HttpContext) {
		session.put(INVITATION_TOKEN_KEY, params.token);
		response.header("Referrer-Policy", "no-referrer");
		response.header("Cache-Control", "no-store");
		return response.redirect().toRoute("invitations.show");
	}

	async show({ session, auth, inertia, response }: HttpContext) {
		response.header("Cache-Control", "no-store");
		response.header("Referrer-Policy", "same-origin");
		const viewer = auth.user ?? null;
		const token = session.get(INVITATION_TOKEN_KEY);
		const preview: InvitationPreview =
			typeof token === "string"
				? await this.invitations.preview(token, viewer)
				: { state: "invalid" };
		return inertia.render("invitations/show", pageProps(preview, viewer));
	}

	/**
	 * Joins and lands on the role's own page (straight there: a flash doesn't
	 * survive the studio home's second redirect). A refusal changes nothing
	 * and goes back to the page, which says why.
	 */
	async accept({ request, session, response, auth }: HttpContext) {
		const user = auth.getUserOrFail();
		const token = session.get(INVITATION_TOKEN_KEY);
		// The page's hidden field: the invitation it showed.
		const flow = request.input(FLOW_FIELD);
		if (typeof token !== "string" || typeof flow !== "string") {
			return response.redirect().toRoute("invitations.show");
		}
		let joined: Joined;
		try {
			joined = await this.invitations.accept(user, token, flow);
		} catch (error) {
			if (error instanceof InvitationRuleError) {
				return response.redirect().toRoute("invitations.show");
			}
			throw error;
		}
		session.forget(INVITATION_TOKEN_KEY);
		session.flash("success", joinedMessage(joined));
		return response
			.redirect()
			.toRoute(
				joined.role === "owner" ? "tenant.inbox.index" : "tenant.projects.index",
				{ tenant: joined.studio.slug },
			);
	}
}

function joinedMessage({ studio, claimed }: Joined): string {
	if (claimed === true) {
		return `You joined ${studio.name}. Your artist profile is linked to you.`;
	}
	if (claimed === false) {
		return `You joined ${studio.name}. The artist profile in the invitation was taken or removed: ask an owner to link one.`;
	}
	return `You joined ${studio.name}.`;
}

/**
 * What the page gets: never the token. The flow id only when the visitor
 * can join, the studio's slug only for one who is already a member.
 */
function pageProps(preview: InvitationPreview, viewer: User | null) {
	const none = {
		studioName: null,
		studioSlug: null,
		email: null,
		role: null,
		profileName: null,
		expiresText: null,
		flow: null,
		step: null,
		viewerEmail: viewer?.email ?? null,
	};
	if (preview.state === "invalid") return { ...none, state: "invalid" as const };
	if (preview.state === "expired") {
		return { ...none, state: "expired" as const, studioName: preview.studioName };
	}
	return {
		...none,
		state: "ready" as const,
		studioName: preview.studio.name,
		studioSlug: preview.step === "already_member" ? preview.studio.slug : null,
		email: preview.email,
		role: preview.role,
		profileName: preview.profileName,
		expiresText: expiryText(preview.expiresAt, preview.studio.timezone),
		flow: preview.step === "accept" ? preview.flow : null,
		step: preview.step,
	};
}
```

Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`.

- [ ] **Step 4: The routes**

In `start/routes.ts`:

1. After the three `verify-email` routes (before the signed-in group), add:

```ts
/**
 * Invitation links (TAT-33): the GET from the chat only stages the token
 * and opens /invitations, whose URL holds no token. Open to guests and to
 * whoever is signed in, so in no group; joining is the POST in the
 * signed-in group below. The link counts per client address.
 */
router
	.get("invitations/:token", [controllers.Invitations, "link"])
	.where("token", ACCOUNT_TOKEN)
	.use(throttleAccountLinks)
	.as("invitations.link");
router
	.get("invitations", [controllers.Invitations, "show"])
	.as("invitations.show");
```

2. Inside the signed-in group (`.use([middleware.auth(), middleware.dbContext()])`), after the onboarding routes, add:

```ts
		// Joining a studio through an invitation (TAT-33): a confirmed
		// address, and the account links' limit.
		router
			.post("invitations", [controllers.Invitations, "accept"])
			.use([middleware.verifiedEmail(), throttleAccountLinks])
			.as("invitations.accept");
```

- [ ] **Step 5: The page and the onboarding line**

Create `apps/platform/inertia/pages/invitations/show.tsx`:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/layouts/auth";

type Role = "owner" | "artist";
type Step =
	| "sign_in"
	| "switch_account"
	| "confirm_email"
	| "already_member"
	| "accept";

type Props = {
	state: "ready" | "expired" | "invalid";
	studioName: string | null;
	studioSlug: string | null;
	email: string | null;
	role: Role | null;
	profileName: string | null;
	expiresText: string | null;
	flow: string | null;
	step: Step | null;
	viewerEmail: string | null;
};

const ROLE_WORDS: Record<Role, string> = {
	owner: "an owner",
	artist: "an artist",
};

const ROLE_GETS: Record<Role, string> = {
	artist:
		"As an artist you get your own profile, and the projects and sessions assigned to you.",
	owner:
		"As an owner you get everything in the studio, including payments and settings.",
};

function Address({ value }: { value: string }) {
	return (
		<strong className="font-medium break-words text-foreground">{value}</strong>
	);
}

function titleOf({ state, studioName }: Props): string {
	if (state === "expired") return "This invitation has expired";
	if (state === "invalid") return "This invitation no longer works";
	return `Join ${studioName ?? "the studio"}`;
}

function lead(props: Props): ReactNode {
	if (props.state === "expired") {
		return `Invitations work for 7 days. Ask ${props.studioName ?? "the studio"} for a new link.`;
	}
	if (props.state === "invalid" || !props.email || !props.role) {
		return "It was already used or cancelled, or a newer link replaced it. Ask the studio for a new one.";
	}
	return (
		<>
			{props.studioName} invited <Address value={props.email} /> to join as{" "}
			{ROLE_WORDS[props.role]}.
			{props.profileName &&
				` It gives them the artist profile "${props.profileName}", with its projects and sessions.`}
		</>
	);
}

/**
 * The page an invitation link opens (TAT-33). The token stays in the
 * session; this page's URL and props never hold it. Joining is this form's
 * POST, for the invited, confirmed account; the page signs nobody in.
 */
export default function Invitation(props: Props) {
	const title = titleOf(props);
	return (
		<>
			<Head title={title} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight break-words">
					{title}
				</h1>
				<p className="text-sm text-muted-foreground">{lead(props)}</p>
			</div>
			{props.state === "ready" && <NextStep {...props} />}
			{props.state === "ready" && props.expiresText && (
				<p className="text-sm text-muted-foreground">
					This invitation works until {props.expiresText}.
				</p>
			)}
		</>
	);
}

function NextStep({
	step,
	email,
	role,
	studioName,
	studioSlug,
	flow,
	viewerEmail,
}: Props) {
	const studio = studioName ?? "the studio";
	if (step === "sign_in" && email) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					To accept, sign in as <Address value={email} />, or create an account
					with that address first. Then open this link again.
				</p>
				<Button asChild className="h-11 w-full">
					<Link route="session.create">Sign in</Link>
				</Button>
				<Button asChild variant="outline" className="h-11 w-full">
					<Link route="new_account.create">Create an account</Link>
				</Button>
			</div>
		);
	}
	if (step === "switch_account" && email && viewerEmail) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					You're signed in as <Address value={viewerEmail} />. Sign out, sign
					in as <Address value={email} />, then open this link again.
				</p>
				<Form route="session.destroy">
					{({ processing }) => (
						<Button type="submit" className="h-11 w-full" disabled={processing}>
							Sign out
						</Button>
					)}
				</Form>
			</div>
		);
	}
	if (step === "confirm_email" && email) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					Confirm <Address value={email} /> first: open the link we emailed you
					when you signed up. Then open this invitation link again.
				</p>
				<Form route="email_verification.resend">
					{({ processing }) => (
						<Button type="submit" className="h-11 w-full" disabled={processing}>
							{processing ? "Sending…" : "Send a new link"}
						</Button>
					)}
				</Form>
			</div>
		);
	}
	if (step === "already_member" && studioSlug) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					You're already a member of {studio}.
				</p>
				<Button asChild className="h-11 w-full">
					<Link route="tenant.dashboard" routeParams={{ tenant: studioSlug }}>
						Open {studio}
					</Link>
				</Button>
			</div>
		);
	}
	if (step === "accept" && flow && role) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">{ROLE_GETS[role]}</p>
				<Form route="invitations.accept">
					{({ processing }) => (
						<>
							{/* The invitation this page showed, so the POST can't use another one staged since. */}
							<input type="hidden" name="flow" value={flow} />
							<Button
								type="submit"
								className="h-11 w-full"
								disabled={processing}
							>
								{processing ? "Joining…" : `Join ${studio}`}
							</Button>
						</>
					)}
				</Form>
			</div>
		);
	}
	return null;
}

Invitation.layout = [AuthLayout];
```

In `apps/platform/inertia/pages/onboarding/create_tenant.tsx`, right after the paragraph `Clients will find you at your own address. You can change the details later.` (its closing `</p>`), add:

```tsx
				<p className="text-sm text-muted-foreground">
					Joining a studio instead? Open the invitation link the studio sent
					you.
				</p>
```

- [ ] **Step 6: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=invitations_http.spec.ts --files=account_routes.spec.ts --files=sessions.spec.ts --files=onboarding.spec.ts` → pass. Typecheck and `pnpm check` clean.

If "a member of another studio joins …" fails on the `update({ email: … })` because the `users` `beforeSave` hook isn't involved in a query update, the address is already canonical in the test, so it holds; if the update is refused by a check, use `User.findOrFail` + `merge({ email, emailVerifiedAt })` + `save()` instead.

- [ ] **Step 7: Commit**

```
git -C <repo> add apps/platform/app/controllers/invitations_controller.ts apps/platform/start/routes.ts apps/platform/inertia apps/platform/tests apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): open an invitation link and join the studio with a confirmed account (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs

**Files:** `apps/platform/docs/backend.md`, `apps/platform/database/README.md`, `apps/platform/docs/testing.md`, `apps/platform/docs/ui.md`, `apps/platform/docs/deploy.md`, `docs/requirements.md`, `docs/data-model.md`.

- [ ] **Step 1: backend.md**

1. "Tenancy and route access": after the Tenancy bullet, add a bullet:

`- Members and invitations (TAT-33): an owner invites an address as an owner or an artist, optionally offering a live, unlinked artist profile, from Settings, Members (/t/:tenant/settings/members, OWNERS). InvitationService (#modules/tenancy/services/invitation_service) owns tenant_invitations (TenantInvitation; RLS; one per studio and canonical address, replaced by a new invitation; not soft-deleted): invite / renew return the raw token once (TAT-18's newAccountToken; only hashAccountToken is stored) and the controller flashes the link to the Members page a single time (INVITATION_LINK_FLASH); revoke deletes; pending lists. The link (/invitations/<token>, ACCOUNT_TOKEN, throttleAccountLinks) only stages the token in the session (INVITATION_TOKEN_KEY, forgotten at sign-in and sign-out) and opens /invitations; preview(token, viewer) finds the studio through the invitation_tenant() SECURITY DEFINER lookup and works in that studio's context; accept(user, token, flow) (POST /invitations: auth, dbContext, verifiedEmail, throttleAccountLinks) locks the row, requires the flow id, a live invitation, a confirmed account with the same canonical address and no live membership, then creates the membership, claims the profile (ArtistService.claim: still live and unlinked, else the person joins without it) and deletes the invitation. No email is sent: the owner copies the link (Copy link, Share on WhatsApp). MemberService (#modules/tenancy/services/member_service) removes members (assertKeepsAnOwner, ArtistService.unlinkUser, membership.softDelete) and changes roles (assertKeepsAnOwner when demoting an owner); neither acts on the actor's own membership (MemberRuleError).`

2. Page history bullet: replace `A new page where someone new may start (invitations) goes in the guest group, and a flow that signs a user in without passing through a guest page must clear history on the first page it renders.` with `A flow that signs a user in without passing through a guest page must clear history on the first page it renders.`, and replace `The email confirmation page (/verify-email) is outside the group on purpose: its usual visitor is signed in, and it signs nobody in or out (TAT-18).` with `The email confirmation page (/verify-email) and the invitation page (/invitations, TAT-33) are outside the group on purpose: their usual visitor is signed in, and they sign nobody in or out.`

3. Artists bullet: replace `(TAT-33's claim path adds its own check before linking anyone else)` with `(the only other link is TAT-33's claim, ArtistService.claim, which re-checks under the row lock that the profile is live and unlinked and the account has none)`, and replace `and TAT-33 must unlink, not delete, a removed member's profile` with `and removing a member unlinks their profiles (unlinkUser), never deletes them (TAT-33)`.

4. Accounts, the gate bullet: replace `TAT-33's accept-invitation route uses it too` with `POST /invitations (TAT-33) uses it too`.

- [ ] **Step 2: database/README.md**

1. SECURITY DEFINER paragraph: `There are two:` → `There are three:`, add `invitation_tenant(requested_hash)` (TAT-33, the invitation page's lookup: the live tenant holding the invitation whose `token_hash` is exactly the argument) to the list, and add at the end: `invitation_tenant reads tenant_invitations.token_hash, tenant_invitations.tenant_id, tenants.id and tenants.deleted_at; a migration that drops or retypes one of them must replace it in the same migration.`
2. The "Not soft-deleted" list: add `tenant invitations (credentials, deleted when accepted or cancelled)` after `account tokens (single-use credentials, deleted when used)`.

- [ ] **Step 3: testing.md, ui.md, deploy.md**

- testing.md, the `twoStudios()` bullet: add `a pending invitation (invitation) and the artist's membership row (artistMembership) are the members routes' (TAT-33)`. And a sentence in the Accounts paragraph: `Invitations (TAT-33): #tests/helpers/invitations has invite, confirmedUser, invitationFlow (the page's flow id for a token) and expireInvitation; stage a link's token with .withSession({ [INVITATION_TOKEN_KEY]: token }).`
- ui.md, Components: add `- Settings, Members (TAT-33): the one-time link box (Copy link, Share on WhatsApp), the invite form, the members and invitations lists; destructive and promoting actions confirm with window.confirm. The invitation page (invitations/show) is an AuthLayout page outside the guest group.`
- deploy.md, the account-links access-log bullet: add `/invitations/` to the paths (`location ~ ^/(reset-password|verify-email|invitations)/ { access_log off; … }`) and say why (`an invitation link carries a 7-day token`). In the account email section add: `Invitees need a confirmed address too (TAT-33): until mail reaches inboxes, an artist joins by signing up, being confirmed with account:verify after you checked who they are, then opening the owner's invitation link again.`

- [ ] **Step 4: requirements.md and data-model.md**

- `docs/requirements.md`: tick `- [x] Invite members as owner or artist; revoke invites; remove members; switch between tenants` and add under it: `- The owner sends the invitation link themselves (copied, or shared on WhatsApp); no email. It works once, for 7 days, for an account with that confirmed address; a new invitation or a new link for the address replaces the old one. An invitation can offer an unlinked artist profile, which the new member gets if it is still free. Owners make members owners or artists and remove them (access ends at once; their profile stays, unlinked); nobody changes or removes themselves, and a studio always keeps an owner.`
- `docs/data-model.md`, the `TenantInvitation` row: `Email (canonical), role, an optional artist profile to claim, and a hashed single-use token that expires after 7 days. One per tenant and address (a new one replaces it); deleted when accepted or cancelled, so a token works once.`

- [ ] **Step 5: Commit**

```
git -C <repo> add apps/platform/docs apps/platform/database/README.md docs/requirements.md docs/data-model.md
git -C <repo> commit -m "docs: describe member invitations, removal and role changes (TAT-33)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `… pnpm -C <repo> typecheck`, `… pnpm -C <repo> build` → clean.
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` leaves `git -C <repo> status` clean; `database/schema.ts` changed only through Task 2's `pnpm migrate`.
- [ ] The full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/final.log 2>&1` → no failure. New tests: 4 + 1 (unit), 4 + 3 (tables and function), 3 (claims), 14 (InvitationService), 6 (MemberService), 9 (Members page), 11 (invitation page), 1 (sessions), and 6 each in `cross_tenant.spec.ts` and `role_access.spec.ts`: baseline + 68. If your count differs, list each file's count in the report.

### Task 10: Browser pass

Run the spec's "Browser pass" (dev server `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3401 pnpm -C <repo>/apps/platform dev`; confirm the throwaway account with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace account:verify <email>`), at 375 px and 1280 px, light and dark, steps 1 to 7. It also covers TAT-30's artist screens (step 2). Stop the dev server afterwards. Leave no invitation or throwaway member in the QA studio: cancel and remove them at the end, and say so in the report.

### Task 11: PR text (not committed)

Write `<scratchpad>/tat-33-pr.md`: title `feat(platform): member invitations, removal and role changes (TAT-33)`; body: the rulings in one line each, the threat notes in one line each, the two migrations (and that they change the shared dev database), the pilot note (invitees need a confirmed address: `account:verify` until TAT-20), the size (5 points, ruling 1), the carry-forwards, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
