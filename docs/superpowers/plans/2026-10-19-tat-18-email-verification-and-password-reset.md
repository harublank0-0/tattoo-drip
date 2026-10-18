# Email verification and password reset (TAT-18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new account confirms its email address with a single-use, expiring link before it can create a studio (TAT-33 reuses the same gate for invitations); a forgotten password is reset with a single-use link that signs out every session; signup and the reset request never reveal whether an address has an account; every new form is rate-limited; email addresses become case-insensitive. About 5 points (the ticket says 2).

**Architecture:** The `identity` module (`app/modules/identity/`) gains pure helpers (`email_address.ts`, `account_tokens.ts`, `session_identifier.ts`), a session user provider that stores `<user id>.<session version>` (`session_user_provider.ts`, used by `config/auth.ts`), `AccountTokenService` (the `account_tokens` table: SHA-256 digests, one per account and purpose, deleted when used), `AccountService` (signup, confirmation, reset, the operator's confirmation) and four emails. `users` gains `email_verified_at` and `session_version` and a canonical-email check. New limits in `AUTH_LIMITS` become `limiter.define` middleware in `start/limiter.ts`. One named middleware, `verifiedEmail`, gates `/onboarding`. Three controllers (`NewAccountController` rewritten, `PasswordResetController`, `EmailVerificationController`), six Inertia pages, a banner in the app shell, and an ace command `account:verify`.

**Tech Stack:** AdonisJS 7 (session guard, Shield, `@adonisjs/limiter`, `@adonisjs/mail` with Edge templates, `@adonisjs/queue`), Lucid on PostgreSQL 18, VineJS, Luxon, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-19-tat-18-email-verification-and-password-reset-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides: this worktree, `/home/blank/Coding/tattoo-drip-worktrees/tat-18`, or the main folder after a rebase; say which in your report). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **Migrations (exact names):** `apps/platform/database/migrations/1791680000000_canonicalize_user_emails.ts`, `1791680000001_add_email_verification_and_session_version_to_users.ts`, `1791680000002_create_account_tokens_table.ts`. Apply with `pnpm -C <repo>/apps/platform migrate` (owner role); it regenerates `database/schema.ts`, which you commit. They change the dev database the other checkouts share: say so in your report. **If the first one refuses** ("email address(es) belong to more than one account"), STOP and report the message: never edit, merge or delete a user row yourself (spec ruling 9; the user decides). To undo after applying: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate:rollback` from this branch rolls back Task 2's batch.
- **Routes (exact):** in the `guest` group: `GET /signup/sent` `new_account.sent`; `GET /forgot-password` `password_reset.create`; `POST /forgot-password` `password_reset.store` (`throttleResetRequest`, `throttleResetEmail`); `GET /forgot-password/sent` `password_reset.sent`; `GET /reset-password/:token` `password_reset.link` (`throttleAccountLinks`, `.where("token", ACCOUNT_TOKEN)`); `GET /reset-password` `password_reset.edit`; `POST /reset-password` `password_reset.update` (`throttleAccountLinks`). In no group: `GET /verify-email/:token` `email_verification.link` (`throttleAccountLinks`, token pattern); `GET /verify-email` `email_verification.show`; `POST /verify-email` `email_verification.confirm` (`throttleAccountLinks`). In the `auth` + `dbContext` group: `GET /confirm-email` `email_verification.notice`; `POST /confirm-email` `email_verification.resend` (`throttleVerifyCooldown`, `throttleVerifyResend`). `POST /signup` gains `throttleSignupEmail`; `GET` and `POST /onboarding` gain `middleware.verifiedEmail()`.
- **No new setting.** Never read or edit `apps/platform/.env`. No dependency, no `package.json` change (the command's test imports it by relative path because there is no `#commands` alias).
- **Copy (verbatim).** Flashes: `Password changed. Sign in with your new password.`, `We sent a new link to {email}.`. Pages and emails: the spec's Screens and Emails sections, as written in the code below. Subjects: `Confirm your email address`, `You already have a Tattoo Drip account`, `Choose a new password`, `Your Tattoo Drip password was changed`. Command: `No account uses that address.`, `That address is already confirmed.`, `Confirmed. The account can now set up a studio.`.
- Fixture addresses and slugs in new tests end in `-18` (`ink@reset-18.example`, `gate-studio-18`): the tests share the dev database.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- Lucid's `create` and `merge` throw on a key that isn't a column: pass a model only its columns (never a validator's `passwordConfirmation`).
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities only), touch targets 44 px (`h-11`), nothing wider than 375 px.
- Tests: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`).
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After controller, route, page or transformer changes run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 11), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **Tokens: single-use, hashed, expiring, bound to a purpose and an address.** Only SHA-256 digests are stored; one live token per account and purpose; a use is one `delete … returning`; a link for an address the account no longer has is dead. Tests: Task 1 "what is stored is the token's SHA-256, never the token"; Task 4 the `AccountTokenService` group; Task 6 "a confirmation link confirms its account once", "a link sent to an address the account no longer has confirms nothing"; Task 7 "a reset link works once", "an expired link, an altered one, a confirmation link or none resets nothing"; Task 9 "confirming is a POST…", "an altered link, a reset link or none confirms nothing".
2. **No account enumeration.** Signup and the reset request answer a taken and a free address identically (status, location, flash keys, cookie names, signed out); only the right mailbox hears the difference. Tests: Task 8 "a taken address answers exactly the same…", "a form error looks the same…"; Task 7 "asking for a link answers the same for every address…".
3. **A reset signs every session out, cookie sessions included.** The session stores `<id>.<version>`; a reset raises the version. Tests: Task 3 group; Task 7 "a completed reset changes the password, signs every session out and signs nobody in".
4. **The gate is one middleware and nothing else breaks.** `verifiedEmail` on `/onboarding`; unconfirmed members keep every studio page. Tests: Task 9 `verified_email.spec.ts` and the route guard in `account_routes.spec.ts`.
5. **Canonical emails, and a migration that never merges or deletes.** Tests: Task 1 `canonicalEmail`; Task 2 "an address is stored only in its canonical form", "the cleanup refuses case-variant duplicates and changes nothing", "the cleanup makes every other address canonical, exactly as canonicalEmail does"; the rewritten TAT-8 test "an address typed in another case is the same account…".
6. **Tokens never in a rendered URL, a Referer or a log; changes only by POST with CSRF.** Tests: Task 7 and Task 9 link tests (session only, `no-referrer`, `no-store`, no token in the page object), the CSRF tests, and the GET-changes-nothing assertions.
7. **Rate limits per client address, per email address and per account.** Tests: Task 7 "three requests an hour per address named…", "ten requests an hour per client address", "the link routes count 30 requests…"; Task 8 "three signups an hour naming one address…"; Task 9 "one new link a minute and five an hour"; the throttle guard in `account_routes.spec.ts`.
8. **A reset clears the login failures of the STORED address only.** Tests: Task 5 "clears the login failures of the stored address, and nothing else"; Task 6 "a reset clears the login failures counted for the account's stored address"; Task 7 "a locked-out account signs in after its reset…".

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> branch --show-current` → `harublank00/tat-18-email-verification-and-password-reset`; `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -1 -- docs/superpowers/plans/2026-10-19-tat-18-email-verification-and-password-reset.md` → the design commit "docs(platform): spec and plan for TAT-18 email verification and password reset".

- [ ] **Step 2: The base holds TAT-52's build**

TAT-52 is still being reviewed, so its commits may have moved; check names, not hashes. Each command must print at least one line:

```
git -C <repo> grep -n "export async function sendMailInTransaction(" -- apps/platform/app/services/mail_in_transaction.ts
git -C <repo> grep -n "ALERT_EMAILS: Env.schema.boolean.optional()," -- apps/platform/start/env.ts
git -C <repo> grep -n 'edge.mount("notifications"' -- apps/platform/start/view.ts
git -C <repo> ls-files apps/platform/database/migrations/1791670000002_create_staff_alerts_table.ts
```

If one prints nothing, STOP and ask the coordinator.

- [ ] **Step 3: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -n "export default class VerifyEmailMail extends BaseMail" -- apps/platform/app/modules/identity/emails/verify_email_mail.ts
git -C <repo> grep -n 'signup: { requests: 10, duration: "1 hour" },' -- apps/platform/app/modules/identity/services/auth_limits.ts
git -C <repo> grep -n 'export const throttleSignup = limiter.define("signup", (ctx) =>' -- apps/platform/start/limiter.ts
git -C <repo> grep -n 'email: email().unique({ table: "users", column: "email" }),' -- apps/platform/app/validators/user.ts
git -C <repo> grep -n 'await auth.use("web").login(user);' -- apps/platform/app/controllers/new_account_controller.ts
git -C <repo> grep -n 'redirectTo = "/";' -- apps/platform/app/middleware/guest_middleware.ts
git -C <repo> grep -n "provider: sessionUserProvider({" -- apps/platform/config/auth.ts
git -C <repo> grep -n '"global identity, read before any context exists (login, session, signup)",' -- apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> grep -n 'intakeGuard: () => import("#middleware/intake_guard_middleware"),' -- apps/platform/start/kernel.ts
git -C <repo> grep -n 'router.post("onboarding", \[controllers.Onboarding, "store"\]);' -- apps/platform/start/routes.ts
git -C <repo> grep -n '"initials",' -- apps/platform/app/transformers/user_transformer.ts
git -C <repo> grep -n "<OfflineBar />" -- apps/platform/inertia/layouts/app.tsx
git -C <repo> grep -n "Explore Feature packs" -- apps/platform/inertia/layouts/auth.tsx
git -C <repo> grep -n "signing in to a look-alike account doesn't reset another account's count" -- apps/platform/tests/functional/auth/rate_limits.spec.ts
git -C <repo> grep -n 'edge.mount("identity"' -- apps/platform/start/view.ts
git -C <repo> grep -n 'for (const path of \["/login", "/signup"\]) {' -- apps/platform/tests/functional/http/multipart.spec.ts
git -C <repo> grep -n 'test("the login and signup pages clear history"' -- apps/platform/tests/functional/auth/page_history.spec.ts
```

Each of these must print nothing:

```
git -C <repo> grep -n "account_tokens\|email_verified_at\|session_version\|verifiedEmail\|canonicalEmail" -- apps/platform
git -C <repo> ls-files apps/platform/commands
```

And `ls <repo>/apps/platform/database/migrations | tail -1` → `1791670000002_create_staff_alerts_table.ts`.

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 4: Install and environment**

If `<repo>/node_modules` is missing: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Check the platform env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok` (if not, ask the coordinator; never create or read it yourself). Check Postgres is up: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` lists the migrations up to `1791670000002` as completed.

- [ ] **Step 5: Baseline**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=rate_limits.spec.ts --files=onboarding.spec.ts --files=page_history.spec.ts --files=cookies.spec.ts --files=csrf.spec.ts --files=access.spec.ts --files=catalog_guard.spec.ts --files=multipart.spec.ts --files=public_limits.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=auth_limits.spec.ts --files=verify_email_mail.spec.ts --files=mail_messenger.spec.ts --files=send_mail_job.spec.ts --files=job_classes.spec.ts`. Expected: PASS. Then the full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line (the final count must be 87 higher; Task 12 has the breakdown).

---

### Task 1: Pure helpers: canonical emails, account tokens, session identifiers

**Files:**
- Create: `apps/platform/app/modules/identity/email_address.ts`, `apps/platform/app/modules/identity/account_tokens.ts`, `apps/platform/app/modules/identity/session_identifier.ts`
- Test: `apps/platform/tests/unit/modules/identity/email_address.spec.ts`, `apps/platform/tests/unit/modules/identity/account_tokens.spec.ts`, `apps/platform/tests/unit/modules/identity/session_identifier.spec.ts` (create)

**Interfaces:**
- `canonicalEmail(value: string): string` from `#modules/identity/email_address`.
- From `#modules/identity/account_tokens` (imports only `node:crypto`): `TOKEN_PURPOSES`, `type TokenPurpose`, `TOKEN_MINUTES`, `ACCOUNT_TOKEN`, `SESSION_TOKEN_KEYS`, `SENT_TO_FLASH`, `CONFIRMED_FLASH`, `newAccountToken(): string`, `hashAccountToken(token: string): string`, `linkPath(purpose: TokenPurpose, token: string): string`, `accountUrl(appUrl: string, path: string): string`.
- From `#modules/identity/session_identifier`: `sessionIdentifier(user: { id: string; sessionVersion: number }): string`, `parseSessionIdentifier(value: unknown): { userId: string; version: number } | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/identity/email_address.spec.ts`:

```ts
import { test } from "@japa/runner";
import { canonicalEmail } from "#modules/identity/email_address";

test.group("canonicalEmail", () => {
	test("trims and lower-cases the ASCII letters", ({ assert }) => {
		assert.equal(canonicalEmail("  Ink@Example.COM \n"), "ink@example.com");
		assert.equal(canonicalEmail("ink@example.com"), "ink@example.com");
	});

	test("keeps dots and +tags: what they mean depends on the provider", ({
		assert,
	}) => {
		assert.equal(
			canonicalEmail("I.N.K+Studio@Gmail.com"),
			"i.n.k+studio@gmail.com",
		);
	});

	test("leaves letters outside ASCII as they are", ({ assert }) => {
		assert.equal(canonicalEmail("ÉVA@Example.com"), "Éva@example.com");
		assert.equal(canonicalEmail("सीता@Example.com"), "सीता@example.com");
	});

	test("is stable: a canonical address stays as it is", ({ assert }) => {
		for (const value of ["INK@x.com", " a.B+c@D.np ", "ÉVA@x.com"]) {
			const once = canonicalEmail(value);
			assert.equal(canonicalEmail(once), once, value);
		}
	});
});
```

Create `apps/platform/tests/unit/modules/identity/account_tokens.spec.ts`:

```ts
import { createHash } from "node:crypto";
import { test } from "@japa/runner";
import {
	ACCOUNT_TOKEN,
	accountUrl,
	hashAccountToken,
	linkPath,
	newAccountToken,
	SESSION_TOKEN_KEYS,
	TOKEN_MINUTES,
	TOKEN_PURPOSES,
} from "#modules/identity/account_tokens";

test.group("Account tokens", () => {
	test("a new token is 43 base64url characters, never the same twice", ({
		assert,
	}) => {
		const tokens = new Set(Array.from({ length: 50 }, () => newAccountToken()));
		assert.equal(tokens.size, 50);
		for (const token of tokens) assert.match(token, ACCOUNT_TOKEN);
	});

	test("the link routes take exactly a token", ({ assert }) => {
		assert.isTrue(ACCOUNT_TOKEN.test("a".repeat(43)));
		for (const bad of [
			"a".repeat(42),
			"a".repeat(44),
			`${"a".repeat(42)}=`,
			`${"a".repeat(42)}.`,
			`${"a".repeat(42)}/`,
			"",
		]) {
			assert.isFalse(ACCOUNT_TOKEN.test(bad), bad);
		}
	});

	test("what is stored is the token's SHA-256, never the token", ({
		assert,
	}) => {
		const token = newAccountToken();
		const stored = hashAccountToken(token);

		assert.equal(stored, createHash("sha256").update(token).digest("hex"));
		assert.match(stored, /^[0-9a-f]{64}$/);
		assert.notInclude(stored, token);
	});

	test("confirmation links work for a day, reset links for an hour", ({
		assert,
	}) => {
		assert.deepEqual(TOKEN_MINUTES, { verify_email: 1440, reset_password: 60 });
		assert.sameMembers(Object.keys(SESSION_TOKEN_KEYS), [...TOKEN_PURPOSES]);
	});

	test("links point at the platform's own pages", ({ assert }) => {
		const token = "a".repeat(43);
		assert.equal(
			accountUrl("https://app.example.com", linkPath("verify_email", token)),
			`https://app.example.com/verify-email/${token}`,
		);
		assert.equal(
			accountUrl("http://localhost:3333", linkPath("reset_password", token)),
			`http://localhost:3333/reset-password/${token}`,
		);
	});
});
```

Create `apps/platform/tests/unit/modules/identity/session_identifier.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	parseSessionIdentifier,
	sessionIdentifier,
} from "#modules/identity/session_identifier";

const ID = "0199f0e2-7a4b-7c3d-8e9f-0123456789ab";

test.group("Session identifier", () => {
	test("is the user's id and the account's session version", ({ assert }) => {
		assert.equal(sessionIdentifier({ id: ID, sessionVersion: 1 }), `${ID}.1`);
		assert.deepEqual(parseSessionIdentifier(`${ID}.12`), {
			userId: ID,
			version: 12,
		});
	});

	test("a bare id, a version of 0 or anything else is no identifier", ({
		assert,
	}) => {
		for (const value of [
			ID,
			`${ID}.0`,
			`${ID}.01`,
			`${ID}.-1`,
			`${ID}.1.2`,
			`${ID.toUpperCase()}.1`,
			`${ID}.1 `,
			"",
			7,
			null,
			undefined,
		]) {
			assert.isNull(parseSessionIdentifier(value), String(value));
		}
	});

	test("refuses to write a session for a user without a version", ({
		assert,
	}) => {
		assert.throws(
			() =>
				sessionIdentifier({
					id: ID,
					sessionVersion: undefined as unknown as number,
				}),
			/session version is missing/,
		);
		assert.throws(
			() => sessionIdentifier({ id: ID, sessionVersion: 0 }),
			/session version is missing/,
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=email_address.spec.ts --files=account_tokens.spec.ts --files=session_identifier.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 and "Cannot find module" for `#modules/identity/email_address` in the log.

- [ ] **Step 3: The helpers**

Create `apps/platform/app/modules/identity/email_address.ts`:

```ts
/**
 * The one form an account's email address is stored and looked up in
 * (TAT-18): surrounding whitespace removed and the ASCII letters A to Z in
 * lower case. Nothing else changes. Other scripts keep their case: only
 * this rule is the same in JavaScript and in every Postgres locale (the
 * users_email_canonical check uses translate(), never lower()). Dots and
 * +tags stay, since what they mean depends on the provider. Never use
 * Vine's normalizeEmail() for accounts: it drops Gmail dots and +tags.
 */
export function canonicalEmail(value: string): string {
	return value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
```

Create `apps/platform/app/modules/identity/account_tokens.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/**
 * Single-use account links (TAT-18): one to confirm an email address, one
 * to choose a new password. One kind of token serves both; its purpose is
 * stored with it, so one can never be used as the other.
 */
export const TOKEN_PURPOSES = ["verify_email", "reset_password"] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

/** How long a link works after it is sent; the database's clock decides. */
export const TOKEN_MINUTES: Record<TokenPurpose, number> = {
	verify_email: 24 * 60,
	reset_password: 60,
};

/**
 * A token: 32 random bytes in base64url, 43 characters (256 bits). The link
 * routes match exactly this, so anything else is the router's 404 with no
 * query.
 */
export const ACCOUNT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where a link's GET puts its token, so the page the person then sees has
 * no token in its URL (spec ruling 5).
 */
export const SESSION_TOKEN_KEYS: Record<TokenPurpose, string> = {
	verify_email: "verify_email_token",
	reset_password: "reset_password_token",
};

/** The flash that carries the typed address to the "Check your email" page. */
export const SENT_TO_FLASH = "sentTo";

/** The flash that carries a just-confirmed address to the confirmation page. */
export const CONFIRMED_FLASH = "emailConfirmed";

export function newAccountToken(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * What is stored and looked up: the token's SHA-256 in hex. The token itself
 * is never stored, and matching a digest of 256 random bits through an index
 * leaks nothing usable (spec ruling 3).
 */
export function hashAccountToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** The path a token's email links to. */
export function linkPath(purpose: TokenPurpose, token: string): string {
	return purpose === "verify_email"
		? `/verify-email/${token}`
		: `/reset-password/${token}`;
}

/** An absolute link for an email: the platform's origin plus a path. */
export function accountUrl(appUrl: string, path: string): string {
	return new URL(path, appUrl).toString();
}
```

Create `apps/platform/app/modules/identity/session_identifier.ts`:

```ts
/**
 * What a signed-in session keeps (TAT-18): the user's id and the account's
 * session version, as `<id>.<version>`. A password reset raises the
 * version, so every session that still holds the old one finds no user on
 * its next request, whatever the session store (production keeps sessions
 * in cookies). SessionVersionUserProvider writes and checks it.
 */
const IDENTIFIER =
	/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,8})$/;

export function sessionIdentifier(user: {
	id: string;
	sessionVersion: number;
}): string {
	if (!Number.isInteger(user.sessionVersion) || user.sessionVersion < 1) {
		throw new Error(
			"Sign in a user loaded from the database: its session version is missing",
		);
	}
	return `${user.id}.${user.sessionVersion}`;
}

/**
 * The id and version a session holds, or null for anything else. A session
 * from before TAT-18 holds the bare id, so it signs out once.
 */
export function parseSessionIdentifier(
	value: unknown,
): { userId: string; version: number } | null {
	if (typeof value !== "string") return null;
	const match = IDENTIFIER.exec(value);
	if (!match) return null;
	return { userId: match[1], version: Number(match[2]) };
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=email_address.spec.ts --files=account_tokens.spec.ts --files=session_identifier.spec.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/identity apps/platform/tests/unit/modules/identity
git -C <repo> commit -m "feat(platform): add canonical emails, account tokens and session identifiers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The schema: canonical emails, confirmation and session version, account tokens

**Files:**
- Create: `apps/platform/database/migrations/1791680000000_canonicalize_user_emails.ts`, `1791680000001_add_email_verification_and_session_version_to_users.ts`, `1791680000002_create_account_tokens_table.ts`
- Modify: `apps/platform/app/models/user.ts`, `apps/platform/app/validators/user.ts` (login only), `apps/platform/app/modules/identity/services/auth_limits.ts` (one comment), `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`EXEMPT`), `apps/platform/tests/functional/auth/rate_limits.spec.ts` (one test replaced)
- Regenerated: `apps/platform/database/schema.ts` (by `pnpm migrate`)
- Test: `apps/platform/tests/functional/identity/users_table.spec.ts` (create)

**Interfaces:**
- `UserSchema` gains `emailVerifiedAt: DateTime | null` and `sessionVersion: number` (generated); `User` gains `get emailVerified(): boolean`, a `beforeCreate` hook that fills `sessionVersion = 1` and `emailVerifiedAt = null` in memory, and a `beforeSave` hook that stores `canonicalEmail(email)`.
- From the first migration (exported for the tests): `canonicalEmailSql(column)`, `refuseCaseDuplicates(table)`, `canonicalizeEmails(table)`, `EMAIL_CANONICAL_CHECK`.
- `loginValidator.email` is canonical. `signupValidator` keeps its `unique` rule until Task 8 (its addresses are trimmed but not yet canonical; Task 8 replaces it).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/users_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import {
	canonicalizeEmails,
	EMAIL_CANONICAL_CHECK,
	refuseCaseDuplicates,
} from "#database/migrations/1791680000000_canonicalize_user_emails";
import User from "#models/user";
import { canonicalEmail } from "#modules/identity/email_address";
import { dbClient, withTransaction } from "#services/db_context";

const PASSWORD = "secret-password";

/** A users row written straight to the table, past the model's hooks. */
function insertUser(email: string) {
	return withTransaction((trx) =>
		trx.rawQuery(
			"insert into users (email, password, created_at) values (?, ?, now()) returning id, session_version, email_verified_at",
			[email, "not-a-hash"],
		),
	);
}

const PROBE = "td_probe_emails.users";

/**
 * Runs `fn` against a scratch users table on the owner connection. DDL is
 * transactional: the schema exists only until the rollback, and the real
 * users table is never touched.
 */
async function withProbe(
	emails: string[],
	fn: (probe: TransactionClientContract) => Promise<void>,
) {
	const probe = await db.connection("owner").transaction();
	try {
		await probe.rawQuery("create schema td_probe_emails");
		await probe.rawQuery(
			`create table ${PROBE} (id serial primary key, email varchar(254) not null unique)`,
		);
		for (const email of emails) {
			await probe.rawQuery(`insert into ${PROBE} (email) values (?)`, [email]);
		}
		await fn(probe);
	} finally {
		await probe.rollback();
	}
}

async function probeEmails(probe: TransactionClientContract) {
	const { rows } = await probe.rawQuery(
		`select email from ${PROBE} order by id`,
	);
	return (rows as { email: string }[]).map(({ email }) => email);
}

test.group("Users and account tokens tables (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an address is stored only in its canonical form", async ({
		assert,
	}) => {
		for (const email of ["INK@table-18.example", " ink@table-18.example"]) {
			await assert.rejects(() => insertUser(email), /users_email_canonical/);
		}
		await insertUser("ink@table-18.example");
	});

	test("the model stores the canonical address, so case never makes a second account", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "  Ink@Table-18.EXAMPLE ",
			password: PASSWORD,
		});

		assert.equal(user.email, "ink@table-18.example");
		assert.equal(
			(await User.findOrFail(user.id)).email,
			"ink@table-18.example",
		);
		await assert.rejects(
			() =>
				withTransaction(() =>
					User.create({ email: "INK@table-18.example", password: PASSWORD }),
				),
			/users_email_unique/,
		);
	});

	test("a new account starts unconfirmed at session version 1", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "new@table-18.example",
			password: PASSWORD,
		});
		assert.equal(user.sessionVersion, 1);
		assert.isNull(user.emailVerifiedAt);
		assert.isFalse(user.emailVerified);

		const stored = await User.findOrFail(user.id);
		assert.equal(stored.sessionVersion, 1);
		assert.isNull(stored.emailVerifiedAt);

		const { rows } = await insertUser("raw@table-18.example");
		assert.equal(rows[0].session_version, 1);
		assert.isNull(rows[0].email_verified_at);
	});

	test("the session version stays positive", async ({ assert }) => {
		const user = await User.create({
			email: "version@table-18.example",
			password: PASSWORD,
		});
		await assert.rejects(
			() =>
				withTransaction((trx) =>
					trx.rawQuery("update users set session_version = 0 where id = ?", [
						user.id,
					]),
				),
			/users_session_version_positive/,
		);
	});

	test("account tokens: one per account and purpose, each digest once, known purposes, gone with the account", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "tokens@table-18.example",
			password: PASSWORD,
		});
		const other = await User.create({
			email: "other@table-18.example",
			password: PASSWORD,
		});
		const row = (
			userId: string,
			purpose: string,
			digit: number,
			expires = "now() + interval '1 hour'",
		) =>
			withTransaction((trx) =>
				trx.rawQuery(
					`insert into account_tokens (user_id, purpose, token_hash, email, expires_at, created_at) values (?, ?, ?, ?, ${expires}, now())`,
					[userId, purpose, String(digit).repeat(64), "tokens@table-18.example"],
				),
			);

		await row(user.id, "verify_email", 1);
		await row(user.id, "reset_password", 2);
		await assert.rejects(
			() => row(user.id, "verify_email", 3),
			/account_tokens_user_id_purpose_unique/,
		);
		await assert.rejects(
			() => row(other.id, "verify_email", 1),
			/account_tokens_token_hash_unique/,
		);
		await assert.rejects(
			() => row(other.id, "sign_in", 4),
			/account_tokens_purpose_check/,
		);
		await assert.rejects(
			() => row(other.id, "verify_email", 5, "now()"),
			/account_tokens_expires_after_creation/,
		);

		await dbClient().rawQuery("delete from users where id = ?", [user.id]);
		const { rows } = await dbClient().rawQuery(
			"select count(*)::int as n from account_tokens where user_id = ?",
			[user.id],
		);
		assert.equal(rows[0].n, 0);
	});

	test("the cleanup refuses case-variant duplicates and changes nothing", async ({
		assert,
	}) => {
		const emails = [
			"ink@example.com",
			"INK@example.com",
			" Ink@Example.com",
			"other@example.com",
		];
		await withProbe(emails, async (probe) => {
			await assert.rejects(
				() =>
					probe.transaction((inner) =>
						inner.rawQuery(refuseCaseDuplicates(PROBE)),
					),
				/1 email address\(es\) belong to more than one account/,
			);
			assert.deepEqual(await probeEmails(probe), emails);
		});
	});

	test("the cleanup makes every other address canonical, exactly as canonicalEmail does", async ({
		assert,
	}) => {
		const emails = [
			"  Ink@Example.COM ",
			"ÉVA@Example.com",
			"plain@example.com",
			"a.b+tag@Gmail.com",
		];
		await withProbe(emails, async (probe) => {
			await probe.rawQuery(refuseCaseDuplicates(PROBE));
			await probe.rawQuery(canonicalizeEmails(PROBE));

			assert.deepEqual(await probeEmails(probe), emails.map(canonicalEmail));
			await probe.rawQuery(
				`alter table ${PROBE} add constraint probe_canonical ${EMAIL_CANONICAL_CHECK}`,
			);
		});
	});
});
```

In `apps/platform/tests/functional/auth/rate_limits.spec.ts`, replace this test (canonical emails make a look-alike account impossible, so it can't be set up any more):

```ts
	test("signing in to a look-alike account doesn't reset another account's count", async ({
		client,
	}) => {
		// Emails are case-sensitive: INK@ is a separate account that shares
		// ink@'s count. Its owner signing in must not wipe the failures.
		await makeUser();
		await makeUser("INK@example.com");
		for (const ip of ["203.0.113.61", "203.0.113.62", "203.0.113.63"]) {
			for (let i = 0; i < 8; i++) {
				const failed = await login(client, ip, "wrong-password");
				failed.assertFlashMessage("error", WRONG);
			}
		}

		const own = await login(
			client,
			"203.0.113.64",
			PASSWORD,
			"INK@example.com",
		);
		own.assertHeader("location", "/dashboard");

		// 24 failures stand: the 25th guess is checked, the 26th is refused.
		const checked = await login(client, "203.0.113.65", "wrong-password");
		checked.assertFlashMessage("error", WRONG);
		const refused = await login(client, "203.0.113.65", "wrong-password");
		refused.assertFlashMessage("error", LOCKED);
	});
```

with:

```ts
	test("an address typed in another case is the same account, and shares its count", async ({
		client,
	}) => {
		// Emails are canonical (TAT-18): INK@ is ink@, so it signs in to the
		// same account and its failures count against the same address.
		await makeUser();
		for (const ip of ["203.0.113.61", "203.0.113.62"]) {
			for (let i = 0; i < 10; i++) {
				const failed = await login(
					client,
					ip,
					"wrong-password",
					"INK@Example.com",
				);
				failed.assertFlashMessage("error", WRONG);
			}
		}

		const own = await login(
			client,
			"203.0.113.64",
			PASSWORD,
			" Ink@EXAMPLE.com ",
		);
		own.assertHeader("location", "/dashboard");

		// 20 failures stand (the sign-in gave back only its own point): five
		// more are checked, the next is refused.
		for (let i = 0; i < 5; i++) {
			const checked = await login(client, "203.0.113.65", "wrong-password");
			checked.assertFlashMessage("error", WRONG);
		}
		const refused = await login(client, "203.0.113.65", "wrong-password");
		refused.assertFlashMessage("error", LOCKED);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=users_table.spec.ts --files=rate_limits.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 and "Cannot find module" for the migration file in the log (it doesn't exist yet). If it isn't a hang, the 7 new tests fail (no `users_email_canonical`, no `session_version`, no `account_tokens`) and the rewritten TAT-8 test fails (an upper-case address doesn't find the account).

- [ ] **Step 3: The canonical-email migration**

Create `apps/platform/database/migrations/1791680000000_canonicalize_user_emails.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/**
 * An address in its canonical form (TAT-18): no surrounding spaces, the
 * ASCII letters in lower case. translate() maps exactly those letters, so
 * the rule doesn't depend on the database's locale (lower() does) and is
 * the same as canonicalEmail() in #modules/identity/email_address (copied,
 * not imported: a migration never imports app code).
 */
export const canonicalEmailSql = (column: string) =>
	`translate(btrim(${column}), '${UPPER}', '${LOWER}')`;

/**
 * Run first by up(): two accounts whose addresses differ only in case or
 * surrounding spaces would end up with one address. The migration never
 * merges, renames or deletes an account: it stops, with everything rolled
 * back, and an operator decides (database/README.md, "Canonical emails").
 */
export function refuseCaseDuplicates(table: string) {
	return `
do $$
declare
	clashes integer;
begin
	select count(*) into clashes from (
		select 1 from ${table} group by ${canonicalEmailSql("email")} having count(*) > 1
	) as clashing;
	if clashes > 0 then
		raise exception '${table}: % email address(es) belong to more than one account once upper and lower case and surrounding spaces are ignored. Decide which account keeps each address and change the others by hand (apps/platform/database/README.md, Canonical emails), then migrate again', clashes;
	end if;
end
$$`;
}

/** Rewrites every address that isn't canonical yet. */
export function canonicalizeEmails(table: string) {
	return `update ${table} set email = ${canonicalEmailSql("email")} where email <> ${canonicalEmailSql("email")}`;
}

/** The check that keeps every address canonical, whatever writes it. */
export const EMAIL_CANONICAL_CHECK = `check (email = ${canonicalEmailSql("email")})`;

/**
 * Canonical emails (TAT-18, carry-forward (c) of TAT-8): with the existing
 * users_email_unique, one account per address whatever its case. down()
 * drops the check and leaves the addresses canonical: the old schema
 * accepts them, and their former case carried nothing anything reads.
 */
export default class extends BaseSchema {
	protected tableName = "users";

	async up() {
		this.schema.raw(refuseCaseDuplicates(this.tableName));
		this.schema.raw(canonicalizeEmails(this.tableName));
		this.schema.raw(
			`alter table users add constraint users_email_canonical ${EMAIL_CANONICAL_CHECK}`,
		);
	}

	async down() {
		this.schema.raw("alter table users drop constraint users_email_canonical");
	}
}
```

The SQL holds no `?`, so Knex reads no bindings in it.

- [ ] **Step 4: The confirmation and session-version migration**

Create `apps/platform/database/migrations/1791680000001_add_email_verification_and_session_version_to_users.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Email confirmation and server-side sign-out (TAT-18).
 * `email_verified_at`: when the address was confirmed (a link, a completed
 * password reset, or an operator's account:verify); null for every account
 * that exists today, since a backfill would prove nothing.
 * `session_version`: what each signed-in session must match; a password
 * reset raises it, which signs out every session, cookie-stored ones too.
 */
export default class extends BaseSchema {
	protected tableName = "users";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.timestamp("email_verified_at", { useTz: true }).nullable();
			table.integer("session_version").notNullable().defaultTo(1);
		});
		this.schema.raw(
			"alter table users add constraint users_session_version_positive check (session_version > 0)",
		);
	}

	async down() {
		this.schema.raw(
			"alter table users drop constraint users_session_version_positive",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("session_version");
			table.dropColumn("email_verified_at");
		});
	}
}
```

- [ ] **Step 5: The account tokens migration**

Create `apps/platform/database/migrations/1791680000002_create_account_tokens_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Single-use account links (TAT-18): one live token per account and
 * purpose (a new one replaces the old), stored as its SHA-256 only, bound to
 * the address it was sent to, deleted when used. Not tenant-owned and read
 * before any context exists, by a link anyone may open, so no row-level
 * security (exempt in catalog_guard.spec.ts, like users). Deleting the
 * account deletes its tokens. An expired row stays until it is replaced (at
 * most two per account). Not soft-deleted: a credential. The purposes are
 * TOKEN_PURPOSES in #modules/identity/account_tokens (copied, not imported).
 */
export default class extends BaseSchema {
	protected tableName = "account_tokens";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("user_id")
				.notNullable()
				.references("id")
				.inTable("users")
				.onDelete("CASCADE");
			table.enum("purpose", ["verify_email", "reset_password"]).notNullable();
			table.string("token_hash", 64).notNullable().unique();
			table.string("email", 254).notNullable();
			table.timestamp("expires_at", { useTz: true }).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();

			// One live token per account and purpose; also the user_id index.
			table.unique(["user_id", "purpose"]);
		});
		this.schema.raw(
			"alter table account_tokens add constraint account_tokens_expires_after_creation check (expires_at > created_at)",
		);
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
```

- [ ] **Step 6: Migrate**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate`
Expected: the three migrations run, and `git -C <repo> diff --stat -- apps/platform/database/schema.ts` shows `schema.ts` changed (`emailVerifiedAt` and `sessionVersion` on `UserSchema`, a new `AccountTokenSchema`). If the first migration refuses with "email address(es) belong to more than one account", STOP and report the message (Global Constraints). If the regenerated file differs anywhere else, the dev database holds another branch's migrations: STOP and report.

- [ ] **Step 7: The model**

Replace the whole of `apps/platform/app/models/user.ts`, which today is:

```ts
import { withAuthFinder } from "@adonisjs/auth/mixins/lucid";
import { compose } from "@adonisjs/core/helpers";
import hash from "@adonisjs/core/services/hash";
import { UserSchema } from "#database/schema";

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
	get initials() {
		const [first, last] = this.fullName
			? this.fullName.split(" ")
			: this.email.split("@");
		if (first && last) {
			return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
		}
		return `${first.slice(0, 2)}`.toUpperCase();
	}
}
```

with:

```ts
import { withAuthFinder } from "@adonisjs/auth/mixins/lucid";
import { compose } from "@adonisjs/core/helpers";
import hash from "@adonisjs/core/services/hash";
import { beforeCreate, beforeSave } from "@adonisjs/lucid/orm";
import { UserSchema } from "#database/schema";
import { canonicalEmail } from "#modules/identity/email_address";

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
	/**
	 * The database's defaults, in memory too (TAT-18): Lucid reads back only
	 * the id after an insert, and signing in needs the session version.
	 */
	@beforeCreate()
	static startUnconfirmed(user: User) {
		if (user.$attributes.sessionVersion === undefined) user.sessionVersion = 1;
		if (user.$attributes.emailVerifiedAt === undefined) {
			user.emailVerifiedAt = null;
		}
	}

	/**
	 * Every write stores the canonical address (TAT-18); the
	 * users_email_canonical check backs it up.
	 */
	@beforeSave()
	static canonicalizeEmail(user: User) {
		if (user.$dirty.email) user.email = canonicalEmail(user.email);
	}

	/** Whether the address is confirmed: by a link, a completed reset or account:verify. */
	get emailVerified() {
		return Boolean(this.emailVerifiedAt);
	}

	get initials() {
		const [first, last] = this.fullName
			? this.fullName.split(" ")
			: this.email.split("@");
		if (first && last) {
			return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
		}
		return `${first.slice(0, 2)}`.toUpperCase();
	}
}
```

- [ ] **Step 8: Login looks up the canonical address**

In `apps/platform/app/validators/user.ts`, replace:

```ts
import vine from "@vinejs/vine";

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254);
const password = () => vine.string().minLength(8).maxLength(32);
```

with:

```ts
import vine from "@vinejs/vine";
import { canonicalEmail } from "#modules/identity/email_address";

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().trim().email().maxLength(254);
const password = () => vine.string().minLength(8).maxLength(32);

/**
 * An account's address, as stored and looked up: canonical (TAT-18,
 * #modules/identity/email_address). The transform runs after the rules.
 */
const accountEmail = () => email().transform(canonicalEmail);
```

and in the same file replace:

```ts
export const loginValidator = vine.create({
	email: email(),
	password: vine.string(),
});
```

with:

```ts
export const loginValidator = vine.create({
	email: accountEmail(),
	password: vine.string(),
});
```

- [ ] **Step 9: Correct TAT-8's look-alike comment**

In `apps/platform/app/modules/identity/services/auth_limits.ts`, replace:

```ts
 * `verify` runs, so parallel guesses can't all pass a check first. A sign-in
 * gives back the two points it took and nothing more: failures already
 * counted for the email stay, because an email can be shared by look-alike
 * accounts (users.email is case-sensitive) and one account's sign-in must not
 * wipe another's count. A point is given back only while the window it was
```

with:

```ts
 * `verify` runs, so parallel guesses can't all pass a check first. A sign-in
 * gives back the two points it took and nothing more: failures already
 * counted for the email stay, since a sign-in proves the password, not who
 * made the earlier guesses (emails are canonical since TAT-18, so there are
 * no look-alike accounts any more). A point is given back only while the
 * window it was
```

(The next line, ` * taken in is still open, so a slow check can't erase failures of the next`, stays as it is.)

- [ ] **Step 10: The catalog guard knows `account_tokens`**

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, replace:

```ts
	rate_limits:
		"rate-limit counters keyed by HMAC digests (TAT-8), not tenant-owned",
```

with:

```ts
	rate_limits:
		"rate-limit counters keyed by HMAC digests (TAT-8), not tenant-owned",
	account_tokens:
		"single-use account links (TAT-18): SHA-256 digests only, read before any context exists by a link anyone may open, not tenant-owned",
```

- [ ] **Step 11: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=users_table.spec.ts --files=rate_limits.spec.ts --files=catalog_guard.spec.ts --files=access.spec.ts --files=onboarding.spec.ts --files=cookies.spec.ts`
Expected: PASS (7 new tests; `rate_limits.spec.ts` keeps its count with the replaced test). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 12: Commit**

```bash
git -C <repo> add apps/platform/database apps/platform/app/models/user.ts apps/platform/app/validators/user.ts apps/platform/app/modules/identity/services/auth_limits.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts apps/platform/tests/functional/auth/rate_limits.spec.ts apps/platform/tests/functional/identity
git -C <repo> commit -m "feat(platform): make emails canonical and add account confirmation, session versions and tokens" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Sessions carry the account's session version

**Files:**
- Create: `apps/platform/app/modules/identity/session_user_provider.ts`
- Modify: `apps/platform/config/auth.ts`
- Test: `apps/platform/tests/functional/identity/sessions.spec.ts` (create)

**Interfaces:**
- `SessionVersionUserProvider` (from `#modules/identity/session_user_provider`) extends `SessionLucidUserProvider<typeof User>`: `createUserForGuard(user)` returns an adapter whose `getId()` is `sessionIdentifier(user)`; `findById(identifier)` returns null unless the identifier parses and its version is the account's current one.
- What the session stores under `auth_web` becomes `<user id>.<session version>`. `client.loginAs(user)` writes it from the user instance passed, so a test that passes an instance loaded before a version change gets a signed-out session.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/sessions.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";

const PASSWORD = "secret-password";

function makeUser() {
	return User.create({ email: "ink@sessions-18.example", password: PASSWORD });
}

/** What a completed password reset does to every session (TAT-18). */
function raiseVersion(user: User) {
	return User.query().where("id", user.id).increment("session_version", 1);
}

test.group("Session versions (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("signing in stores the account's id with its session version", async ({
		client,
	}) => {
		const user = await makeUser();

		const response = await client
			.post("/login")
			.form({ email: user.email, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);

		response.assertHeader("location", "/dashboard");
		response.assertSession("auth_web", `${user.id}.1`);
	});

	test("a session from before the version changed is signed out on its next request", async ({
		client,
	}) => {
		const user = await makeUser();
		const before = await User.findOrFail(user.id);
		await raiseVersion(user);

		const old = await client.get("/dashboard").loginAs(before).redirects(0);
		old.assertStatus(302);
		old.assertHeader("location", "/login");

		const fresh = await client
			.get("/dashboard")
			.loginAs(await User.findOrFail(user.id))
			.redirects(0);
		fresh.assertHeader("location", "/onboarding");
	});

	test("a session holding a bare id, from before TAT-18, is signed out", async ({
		client,
	}) => {
		const user = await makeUser();

		const response = await client
			.get("/dashboard")
			.withSession({ auth_web: user.id })
			.redirects(0);

		response.assertHeader("location", "/login");
	});

	test("a signed-out session sees the guest pages again", async ({
		client,
	}) => {
		const user = await makeUser();
		const before = await User.findOrFail(user.id);
		await raiseVersion(user);

		const login = await client.get("/login").loginAs(before).redirects(0);

		login.assertStatus(200);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=sessions.spec.ts`
Expected: 4 FAIL: the session holds the bare id (`expected … to equal '<id>.1'`), and the stale or bare sessions still reach `/onboarding` and the guest page sends them away (302).

- [ ] **Step 3: The provider**

Create `apps/platform/app/modules/identity/session_user_provider.ts`:

```ts
import { SessionLucidUserProvider } from "@adonisjs/auth/session";
import type { SessionGuardUser } from "@adonisjs/auth/types/session";
import type User from "#models/user";
import {
	parseSessionIdentifier,
	sessionIdentifier,
} from "#modules/identity/session_identifier";

/**
 * The session guard's user provider, with the account's session version in
 * what the session stores (TAT-18): `<id>.<version>` instead of the id.
 * When a session's version isn't the account's current one, no user is
 * found, so every check (auth, guest, silent auth) treats the session as
 * signed out. It loads the user exactly as before: no extra query. The
 * model stays lazily imported, as config/auth.ts needs.
 */
export class SessionVersionUserProvider extends SessionLucidUserProvider<
	typeof User
> {
	override async createUserForGuard(
		user: User,
	): Promise<SessionGuardUser<User>> {
		const adapter = await super.createUserForGuard(user);
		return {
			getId: () => sessionIdentifier(user),
			getOriginal: () => adapter.getOriginal(),
		};
	}

	override async findById(
		identifier: unknown,
	): Promise<SessionGuardUser<User> | null> {
		const parsed = parseSessionIdentifier(identifier);
		if (!parsed) return null;
		const found = await super.findById(parsed.userId);
		if (!found || found.getOriginal().sessionVersion !== parsed.version) {
			return null;
		}
		return found;
	}
}
```

`super.findById` calls `this.createUserForGuard`, so the adapter it returns already writes the new identifier.

- [ ] **Step 4: Use it**

In `apps/platform/config/auth.ts`, replace:

```ts
import { defineConfig } from "@adonisjs/auth";
import { sessionGuard, sessionUserProvider } from "@adonisjs/auth/session";
import type {
	Authenticators,
	InferAuthEvents,
	InferAuthenticators,
} from "@adonisjs/auth/types";
```

with:

```ts
import { defineConfig } from "@adonisjs/auth";
import { sessionGuard } from "@adonisjs/auth/session";
import type {
	Authenticators,
	InferAuthEvents,
	InferAuthenticators,
} from "@adonisjs/auth/types";
import { SessionVersionUserProvider } from "#modules/identity/session_user_provider";
```

and replace:

```ts
			provider: sessionUserProvider({
				model: () => import("#models/user"),
			}),
```

with:

```ts
			/**
			 * The session stores the user's id with the account's session
			 * version, so a password reset signs every session out (TAT-18).
			 */
			provider: new SessionVersionUserProvider({
				model: () => import("#models/user"),
			}),
```

- [ ] **Step 5: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=sessions.spec.ts --files=cookies.spec.ts --files=csrf.spec.ts --files=access.spec.ts --files=tenant_routes.spec.ts --files=page_history.spec.ts --files=rate_limits.spec.ts`
Expected: PASS (4 new). Then `typecheck`: clean. If any test elsewhere fails with "its session version is missing", it signs in a user instance that lacks the column (built by hand or selected partly): load it with `User.findOrFail(id)` in that test and say so in your report.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/identity/session_user_provider.ts apps/platform/config/auth.ts apps/platform/tests/functional/identity/sessions.spec.ts
git -C <repo> commit -m "feat(platform): sign out every session of an account when its session version changes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Account tokens and the four account emails

**Files:**
- Create: `apps/platform/app/modules/identity/services/account_token_service.ts`
- Rewrite: `apps/platform/app/modules/identity/emails/verify_email_mail.ts`, `verify_email.edge`, `verify_email_text.edge`
- Create: `apps/platform/app/modules/identity/emails/account_exists_mail.ts`, `account_exists.edge`, `account_exists_text.edge`, `reset_password_mail.ts`, `reset_password.edge`, `reset_password_text.edge`, `password_changed_mail.ts`, `password_changed.edge`, `password_changed_text.edge`
- Create: `apps/platform/tests/helpers/accounts.ts`
- Modify: `apps/platform/tests/unit/jobs/mail_messenger.spec.ts`, `apps/platform/tests/unit/jobs/send_mail_job.spec.ts`
- Rewrite: `apps/platform/tests/unit/modules/identity/verify_email_mail.spec.ts`
- Test: `apps/platform/tests/unit/modules/identity/account_mails.spec.ts`, `apps/platform/tests/functional/identity/account_token_service.spec.ts` (create)

**Interfaces:**
- `AccountTokenService` (default export of `#modules/identity/services/account_token_service`, no dependencies): `issue(user: { id: string; email: string }, purpose): Promise<string>`, `state(token, purpose): Promise<TokenState>`, `consume(token, purpose): Promise<{ userId: string; email: string } | null>`, `revoke(userId, purpose): Promise<void>`; `type TokenState = { state: "live"; userId: string; email: string } | { state: "expired" } | { state: "unknown" }`. Every query goes through `dbClient()`, so it joins the open transaction.
- Mails (plain data, since queued mail is JSON until the worker renders it): `new VerifyEmailMail({ to, url })`, `new AccountExistsMail({ to, signInUrl, resetUrl })`, `new ResetPasswordMail({ to, url })`, `new PasswordChangedMail({ to, changedAt, resetUrl })`, and `changedAtText(at: DateTime): string` from the last one.
- `#tests/helpers/accounts`: `queuedMails(fake)`, `type QueuedMail`, `tokenOf(url)`, `expireToken(userId, purpose)`, `altered(token)`, `cookieNames(response)`.

- [ ] **Step 1: The test helper**

Create `apps/platform/tests/helpers/accounts.ts`:

```ts
import type queue from "@adonisjs/queue/services/main";
import type { ApiResponse } from "@japa/api-client";
import type { SendMailPayload } from "#jobs/send_mail_job";
import type { TokenPurpose } from "#modules/identity/account_tokens";
import { dbClient } from "#services/db_context";
import { parseSetCookie, setCookieLines } from "#tests/helpers/cookies";

type Fake = ReturnType<typeof queue.fake>;

/** One email a faked queue holds: its recipient, subject and template data. */
export type QueuedMail = {
	to: string;
	subject: string;
	data: Record<string, unknown>;
};

/** The emails a faked queue holds (SendMailJob payloads), in order. */
export function queuedMails(fake: Fake): QueuedMail[] {
	return fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "SendMailJob")
		.map(({ job }) => {
			const { message, views } = (job.payload as SendMailPayload).mailMessage;
			return {
				to: String(message.to?.[0]),
				subject: String(message.subject),
				data: (views.html?.data ?? {}) as Record<string, unknown>,
			};
		});
}

/** The token at the end of an account link (…/verify-email/<token>). */
export function tokenOf(url: unknown): string {
	return String(url).split("/").at(-1) ?? "";
}

/** Moves an account token's expiry into the past, as time would. */
export function expireToken(userId: string, purpose: TokenPurpose) {
	return dbClient().rawQuery(
		"update account_tokens set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where user_id = ? and purpose = ?",
		[userId, purpose],
	);
}

/** The token with its last character changed: the same shape, another token. */
export function altered(token: string): string {
	return `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
}

/** The names of the cookies a response sets, sorted. */
export function cookieNames(response: ApiResponse): string[] {
	return setCookieLines(response.headers()["set-cookie"])
		.map((line) => parseSetCookie(line).name)
		.sort();
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/platform/tests/functional/identity/account_token_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { hashAccountToken } from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { dbClient } from "#services/db_context";
import { altered, expireToken } from "#tests/helpers/accounts";

const tokens = new AccountTokenService();

function makeUser(email = "ink@tokens-18.example") {
	return User.create({ email, password: "secret-password" });
}

async function rowsOf(userId: string) {
	const { rows } = await dbClient().rawQuery(
		"select purpose, token_hash, email, extract(epoch from expires_at - created_at)::int as seconds from account_tokens where user_id = ? order by purpose",
		[userId],
	);
	return rows as {
		purpose: string;
		token_hash: string;
		email: string;
		seconds: number;
	}[];
}

test.group("AccountTokenService (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("issues a token stored only as its digest, for the account's address, for a day or an hour", async ({
		assert,
	}) => {
		const user = await makeUser();

		const confirm = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");

		assert.deepEqual(await rowsOf(user.id), [
			{
				purpose: "reset_password",
				token_hash: hashAccountToken(reset),
				email: user.email,
				seconds: 60 * 60,
			},
			{
				purpose: "verify_email",
				token_hash: hashAccountToken(confirm),
				email: user.email,
				seconds: 24 * 60 * 60,
			},
		]);
	});

	test("a new token replaces the account's older one of that purpose, and leaves the other alone", async ({
		assert,
	}) => {
		const user = await makeUser();
		const first = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");
		const second = await tokens.issue(user, "verify_email");

		assert.deepEqual(await tokens.state(first, "verify_email"), {
			state: "unknown",
		});
		assert.deepEqual(await tokens.state(second, "verify_email"), {
			state: "live",
			userId: user.id,
			email: user.email,
		});
		assert.equal((await tokens.state(reset, "reset_password")).state, "live");
		assert.lengthOf(await rowsOf(user.id), 2);
	});

	test("a token is used once: the second use finds nothing", async ({
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		assert.deepEqual(await tokens.consume(token, "reset_password"), {
			userId: user.id,
			email: user.email,
		});
		assert.isNull(await tokens.consume(token, "reset_password"));
		assert.deepEqual(await tokens.state(token, "reset_password"), {
			state: "unknown",
		});
	});

	test("an expired token reads as expired and can't be used", async ({
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		await expireToken(user.id, "verify_email");

		assert.deepEqual(await tokens.state(token, "verify_email"), {
			state: "expired",
		});
		assert.isNull(await tokens.consume(token, "verify_email"));
		assert.deepEqual(await tokens.state(token, "verify_email"), {
			state: "expired",
		});
	});

	test("a token works only for its own purpose, and an altered one finds nothing", async ({
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		assert.isNull(await tokens.consume(token, "reset_password"));
		assert.equal((await tokens.state(token, "reset_password")).state, "unknown");
		assert.equal(
			(await tokens.state(altered(token), "verify_email")).state,
			"unknown",
		);
		assert.isNull(await tokens.consume(altered(token), "verify_email"));
		assert.equal((await tokens.state(token, "verify_email")).state, "live");
	});

	test("revoking removes the account's token of that purpose only", async ({
		assert,
	}) => {
		const user = await makeUser();
		const confirm = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");

		await tokens.revoke(user.id, "verify_email");

		assert.equal((await tokens.state(confirm, "verify_email")).state, "unknown");
		assert.equal((await tokens.state(reset, "reset_password")).state, "live");
	});
});
```

Replace the whole of `apps/platform/tests/unit/modules/identity/verify_email_mail.spec.ts` with:

```ts
import { test } from "@japa/runner";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

// Any link survives: a query's `&` is escaped in HTML and kept as typed in text.
const url = "https://app.tattoo-drip.test/verify-email/abc?x=1&y=2";

async function render() {
	const mail = new VerifyEmailMail({ to: "ink@example.com", url });
	await mail.buildWithContents();
	return mail.message;
}

test.group("VerifyEmailMail", () => {
	test("is addressed to the person and leaves the sender to the config", async ({
		assert,
	}) => {
		const message = await render();

		message.assertTo("ink@example.com");
		message.assertSubject("Confirm your email address");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("renders the link in the shared layout: escaped in html, as typed in text", async () => {
		const message = await render();

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Tattoo Drip");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/verify-email/abc?x=1&amp;y=2"',
		);
		message.assertTextIncludes(url);
		message.assertTextIncludes("The link works for 24 hours");
	});

	test("says hello without a name and carries nothing but the link", async ({
		assert,
	}) => {
		const message = await render();
		message.assertHtmlIncludes("Hello,");
		message.assertTextIncludes("Hello,");

		const queued = new VerifyEmailMail({ to: "ink@example.com", url });
		await queued.build();
		assert.deepEqual(queued.message.toObject().views.html?.data, { url });
	});
});
```

Create `apps/platform/tests/unit/modules/identity/account_mails.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import AccountExistsMail from "#modules/identity/emails/account_exists_mail";
import PasswordChangedMail, {
	changedAtText,
} from "#modules/identity/emails/password_changed_mail";
import ResetPasswordMail from "#modules/identity/emails/reset_password_mail";

const TO = "ink@example.com";
const SIGN_IN = "https://app.tattoo-drip.test/login";
const RESET = "https://app.tattoo-drip.test/reset-password/abc";
const FORGOT = "https://app.tattoo-drip.test/forgot-password";

test.group("Account mails", () => {
	test("an address that already has an account gets a sign-in and a reset link", async ({
		assert,
	}) => {
		const mail = new AccountExistsMail({
			to: TO,
			signInUrl: SIGN_IN,
			resetUrl: RESET,
		});
		await mail.buildWithContents();
		const { message } = mail;

		message.assertTo(TO);
		message.assertSubject("You already have a Tattoo Drip account");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes("Hello,");
		message.assertHtmlIncludes(`href="${SIGN_IN}"`);
		message.assertHtmlIncludes(`href="${RESET}"`);
		message.assertTextIncludes(SIGN_IN);
		message.assertTextIncludes(RESET);
		message.assertTextIncludes("your account hasn't changed");
	});

	test("a reset link works for an hour, once", async ({ assert }) => {
		const mail = new ResetPasswordMail({ to: TO, url: RESET });
		await mail.buildWithContents();
		const { message } = mail;

		message.assertTo(TO);
		message.assertSubject("Choose a new password");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes(`href="${RESET}"`);
		message.assertTextIncludes(RESET);
		message.assertTextIncludes("It works for 1 hour, once.");
	});

	test("the password-changed notice names the time and links to a new request, never a token", async () => {
		const mail = new PasswordChangedMail({
			to: TO,
			changedAt: "19 Oct 2026 at 14:05 UTC",
			resetUrl: FORGOT,
		});
		await mail.buildWithContents();
		const { message } = mail;

		message.assertTo(TO);
		message.assertSubject("Your Tattoo Drip password was changed");
		message.assertHtmlIncludes("19 Oct 2026 at 14:05 UTC");
		message.assertHtmlIncludes(`href="${FORGOT}"`);
		message.assertTextIncludes(FORGOT);
		message.assertTextIncludes("every device that was signed in was signed out");
	});

	test("the change time is written in UTC", ({ assert }) => {
		assert.equal(
			changedAtText(DateTime.fromISO("2026-10-19T14:05:00Z")),
			"19 Oct 2026 at 14:05 UTC",
		);
		assert.equal(
			changedAtText(DateTime.fromISO("2026-10-19T19:50:00+05:45")),
			"19 Oct 2026 at 14:05 UTC",
		);
	});
});
```

In `apps/platform/tests/unit/jobs/mail_messenger.spec.ts`, replace:

```ts
import SendMailJob, { type SendMailPayload } from "#jobs/send_mail_job";
import User from "#models/user";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

const verifyUrl =
	"https://app.tattoo-drip.test/verify-email?token=abc&signature=xyz";
```

with:

```ts
import SendMailJob, { type SendMailPayload } from "#jobs/send_mail_job";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

const verifyUrl = "https://app.tattoo-drip.test/verify-email/abc";
```

and replace:

```ts
		const user = new User();

		user.email = "ink@example.com";
		user.fullName = "Ada Ink";

		const email = new VerifyEmailMail(user, verifyUrl);

		await mail.sendLater(email);

		fake.assertPushed(SendMailJob, {
			payload: (payload: SendMailPayload) =>
				payload.mailMessage.message.to?.[0] === user.email,
		});
```

with:

```ts
		const email = new VerifyEmailMail({
			to: "ink@example.com",
			url: verifyUrl,
		});

		await mail.sendLater(email);

		fake.assertPushed(SendMailJob, {
			payload: (payload: SendMailPayload) =>
				payload.mailMessage.message.to?.[0] === "ink@example.com",
		});
```

In `apps/platform/tests/unit/jobs/send_mail_job.spec.ts`, replace:

```ts
import SendMailJob from "#jobs/send_mail_job";
import User from "#models/user";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

const verifyUrl =
	"https://app.tattoo-drip.test/verify-email?token=abc&signature=xyz";
```

with:

```ts
import SendMailJob from "#jobs/send_mail_job";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

const verifyUrl = "https://app.tattoo-drip.test/verify-email/abc";
```

replace:

```ts
		const user = new User();

		user.email = "ink@example.com";
		user.fullName = "Ada Ink";

		const email = new VerifyEmailMail(user, verifyUrl);
```

with:

```ts
		const email = new VerifyEmailMail({
			to: "ink@example.com",
			url: verifyUrl,
		});
```

and replace:

```ts
		assert.include(String(sent?.data.message.html), "Hi Ada Ink,");
```

with:

```ts
		assert.include(String(sent?.data.message.html), "Hello,");
```

- [ ] **Step 3: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=account_mails.spec.ts --files=verify_email_mail.spec.ts --files=mail_messenger.spec.ts --files=send_mail_job.spec.ts > <scratchpad>/red.log 2>&1; echo $?` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=account_token_service.spec.ts > <scratchpad>/red2.log 2>&1; echo $?`
Expected: both exit 124 with "Cannot find module" (`account_exists_mail`, `account_token_service`) in the logs.

- [ ] **Step 4: The token service**

Create `apps/platform/app/modules/identity/services/account_token_service.ts`:

```ts
import {
	hashAccountToken,
	newAccountToken,
	TOKEN_MINUTES,
	type TokenPurpose,
} from "#modules/identity/account_tokens";
import { dbClient } from "#services/db_context";

export type TokenState =
	| { state: "live"; userId: string; email: string }
	| { state: "expired" }
	| { state: "unknown" };

/**
 * The `account_tokens` table (TAT-18): one live token per account and
 * purpose, stored as its SHA-256 only, bound to the address it was sent to.
 * Raw SQL through dbClient(), so each statement joins the open transaction
 * and the replace and the single use are one statement each.
 */
export default class AccountTokenService {
	/**
	 * A new token for the account's current address. It replaces the
	 * account's older token of this purpose, whose link stops working.
	 */
	async issue(
		user: { id: string; email: string },
		purpose: TokenPurpose,
	): Promise<string> {
		const token = newAccountToken();
		await dbClient().rawQuery(
			`insert into account_tokens (user_id, purpose, token_hash, email, expires_at, created_at)
			 values (?, ?, ?, ?, now() + make_interval(mins => ?), now())
			 on conflict (user_id, purpose) do update
			 set token_hash = excluded.token_hash, email = excluded.email,
			     expires_at = excluded.expires_at, created_at = excluded.created_at`,
			[user.id, purpose, hashAccountToken(token), user.email, TOKEN_MINUTES[purpose]],
		);
		return token;
	}

	/**
	 * What a link's page shows: live (its account and address), expired, or
	 * unknown (used, replaced, of another purpose or never issued).
	 */
	async state(token: string, purpose: TokenPurpose): Promise<TokenState> {
		const { rows } = await dbClient().rawQuery(
			"select user_id, email, expires_at > now() as live from account_tokens where token_hash = ? and purpose = ?",
			[hashAccountToken(token), purpose],
		);
		const row = rows[0] as
			| { user_id: string; email: string; live: boolean }
			| undefined;
		if (!row) return { state: "unknown" };
		if (!row.live) return { state: "expired" };
		return { state: "live", userId: row.user_id, email: row.email };
	}

	/**
	 * Uses a live token: deletes it and returns its account and address.
	 * One statement, so two requests with one token get it once.
	 */
	async consume(
		token: string,
		purpose: TokenPurpose,
	): Promise<{ userId: string; email: string } | null> {
		const { rows } = await dbClient().rawQuery(
			"delete from account_tokens where token_hash = ? and purpose = ? and expires_at > now() returning user_id, email",
			[hashAccountToken(token), purpose],
		);
		const row = rows[0] as { user_id: string; email: string } | undefined;
		return row ? { userId: row.user_id, email: row.email } : null;
	}

	/** Deletes the account's token of this purpose, if any. */
	async revoke(userId: string, purpose: TokenPurpose): Promise<void> {
		await dbClient().rawQuery(
			"delete from account_tokens where user_id = ? and purpose = ?",
			[userId, purpose],
		);
	}
}
```

- [ ] **Step 5: The confirmation email**

Replace the whole of `apps/platform/app/modules/identity/emails/verify_email_mail.ts` with:

```ts
import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type VerifyEmailMailData = {
	to: string;
	/** The confirmation link: APP_URL/verify-email/<token>. */
	url: string;
};

/**
 * Asks a person to confirm the address of their account (TAT-18). It prints
 * nothing the signup form took, not even the name: the form is open to
 * anyone, and the email goes to whatever address they typed. The subject
 * holds no link, since SendMailJob.failed() logs it.
 */
export default class VerifyEmailMail extends BaseMail {
	subject = "Confirm your email address";

	constructor(private data: VerifyEmailMailData) {
		super();
	}

	prepare() {
		const view = { url: this.data.url };
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/verify_email", view)
			.textView("identity::emails/verify_email_text", view);
	}
}
```

Replace the whole of `apps/platform/app/modules/identity/emails/verify_email.edge` with:

```edge
@email.layout({ title: 'Confirm your email address', preheader: 'One click to confirm the address of your Tattoo Drip account.' })
  <p style="margin: 0 0 16px;">Hello,</p>
  <p style="margin: 0;">Confirm that this is the email address of your Tattoo Drip account. The link works for 24 hours.</p>
  @!email.button({ href: url, text: 'Confirm email address' })
  <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
    If the button doesn't work, copy this link into your browser:<br />
    <a href="{{ url }}" style="color: #18181b; word-break: break-all;">{{ url }}</a>
  </p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
    If you didn't create a Tattoo Drip account, ignore this email: nothing happens without the link.
  </p>
@end
```

Replace the whole of `apps/platform/app/modules/identity/emails/verify_email_text.edge` with:

```edge
Hello,

Confirm that this is the email address of your Tattoo Drip account. The link works for 24 hours:

{{{ url }}}

If you didn't create a Tattoo Drip account, ignore this email: nothing happens without the link.
```

- [ ] **Step 6: The other three emails**

Create `apps/platform/app/modules/identity/emails/account_exists_mail.ts`:

```ts
import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type AccountExistsMailData = {
	to: string;
	/** APP_URL/login. */
	signInUrl: string;
	/** A reset link issued with this email: APP_URL/reset-password/<token>. */
	resetUrl: string;
};

/**
 * Answers a signup for an address that already has an account (TAT-18).
 * The signup page says "Check your email" either way, so the page never
 * tells whether an address is registered; this email tells its owner, with
 * a sign-in link and a reset link. No name: see VerifyEmailMail.
 */
export default class AccountExistsMail extends BaseMail {
	subject = "You already have a Tattoo Drip account";

	constructor(private data: AccountExistsMailData) {
		super();
	}

	prepare() {
		const view = {
			signInUrl: this.data.signInUrl,
			resetUrl: this.data.resetUrl,
		};
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/account_exists", view)
			.textView("identity::emails/account_exists_text", view);
	}
}
```

Create `apps/platform/app/modules/identity/emails/account_exists.edge`:

```edge
@email.layout({ title: 'You already have an account', preheader: 'Sign in, or choose a new password.' })
  <p style="margin: 0 0 16px;">Hello,</p>
  <p style="margin: 0;">Someone tried to create a Tattoo Drip account with this email address, but it already has one. If it was you, sign in instead:</p>
  @!email.button({ href: signInUrl, text: 'Sign in' })
  <p style="margin: 0 0 16px;">Forgot your password? Choose a new one with this link. It works for 1 hour:</p>
  <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px;">
    <a href="{{ resetUrl }}" style="color: #18181b; word-break: break-all;">{{ resetUrl }}</a>
  </p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
    If it wasn't you, ignore this email: your account hasn't changed.
  </p>
@end
```

Create `apps/platform/app/modules/identity/emails/account_exists_text.edge`:

```edge
Hello,

Someone tried to create a Tattoo Drip account with this email address, but it already has one. If it was you, sign in instead:

{{{ signInUrl }}}

Forgot your password? Choose a new one with this link. It works for 1 hour:

{{{ resetUrl }}}

If it wasn't you, ignore this email: your account hasn't changed.
```

Create `apps/platform/app/modules/identity/emails/reset_password_mail.ts`:

```ts
import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type ResetPasswordMailData = {
	to: string;
	/** The reset link: APP_URL/reset-password/<token>. */
	url: string;
};

/**
 * A password reset link (TAT-18), sent only to an address an account uses.
 * No name, and the subject holds no link.
 */
export default class ResetPasswordMail extends BaseMail {
	subject = "Choose a new password";

	constructor(private data: ResetPasswordMailData) {
		super();
	}

	prepare() {
		const view = { url: this.data.url };
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/reset_password", view)
			.textView("identity::emails/reset_password_text", view);
	}
}
```

Create `apps/platform/app/modules/identity/emails/reset_password.edge`:

```edge
@email.layout({ title: 'Choose a new password', preheader: 'A link to choose a new password for your Tattoo Drip account.' })
  <p style="margin: 0 0 16px;">Hello,</p>
  <p style="margin: 0;">Someone asked to reset the password of your Tattoo Drip account. Choose a new one with this link. It works for 1 hour, once.</p>
  @!email.button({ href: url, text: 'Choose a new password' })
  <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
    If the button doesn't work, copy this link into your browser:<br />
    <a href="{{ url }}" style="color: #18181b; word-break: break-all;">{{ url }}</a>
  </p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
    If you didn't ask, ignore this email: your password stays as it is.
  </p>
@end
```

Create `apps/platform/app/modules/identity/emails/reset_password_text.edge`:

```edge
Hello,

Someone asked to reset the password of your Tattoo Drip account. Choose a new one with this link. It works for 1 hour, once.

{{{ url }}}

If you didn't ask, ignore this email: your password stays as it is.
```

Create `apps/platform/app/modules/identity/emails/password_changed_mail.ts`:

```ts
import { BaseMail } from "@adonisjs/mail";
import type { DateTime } from "luxon";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type PasswordChangedMailData = {
	to: string;
	/** changedAtText() of the change. */
	changedAt: string;
	/** APP_URL/forgot-password: a page to ask for a new link, never a token. */
	resetUrl: string;
};

/** When the password changed, for the email: "19 Oct 2026 at 14:05 UTC". */
export function changedAtText(at: DateTime): string {
	return at
		.setZone("utc")
		.setLocale("en-US")
		.toFormat("d LLL yyyy 'at' HH:mm 'UTC'");
}

/**
 * Tells the account's mailbox that its password was changed and every
 * session signed out (TAT-18), with a way to take the account back.
 */
export default class PasswordChangedMail extends BaseMail {
	subject = "Your Tattoo Drip password was changed";

	constructor(private data: PasswordChangedMailData) {
		super();
	}

	prepare() {
		const view = {
			changedAt: this.data.changedAt,
			resetUrl: this.data.resetUrl,
		};
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/password_changed", view)
			.textView("identity::emails/password_changed_text", view);
	}
}
```

Create `apps/platform/app/modules/identity/emails/password_changed.edge`:

```edge
@email.layout({ title: 'Your password was changed', preheader: 'The password of your Tattoo Drip account was changed.' })
  <p style="margin: 0 0 16px;">Hello,</p>
  <p style="margin: 0 0 16px;">The password of your Tattoo Drip account was changed on {{ changedAt }}, and every device that was signed in was signed out.</p>
  <p style="margin: 0;">If it was you, there's nothing to do. If it wasn't, choose a new password now and check who else can read this mailbox:</p>
  @!email.button({ href: resetUrl, text: 'Choose a new password' })
@end
```

Create `apps/platform/app/modules/identity/emails/password_changed_text.edge`:

```edge
Hello,

The password of your Tattoo Drip account was changed on {{{ changedAt }}}, and every device that was signed in was signed out.

If it was you, there's nothing to do. If it wasn't, choose a new password now and check who else can read this mailbox:

{{{ resetUrl }}}
```

The module's templates are already mounted (`edge.mount("identity", …)` in `start/view.ts`) and copied into the build (`app/modules/**/*.edge` in `adonisrc.ts`).

- [ ] **Step 7: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=account_mails.spec.ts --files=verify_email_mail.spec.ts --files=mail_messenger.spec.ts --files=send_mail_job.spec.ts --files=templates_in_build.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=account_token_service.spec.ts`
Expected: PASS (unit: 4 new mail tests, `verify_email_mail.spec.ts` now 3; functional: 6). Then `typecheck`: clean.

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app/modules/identity apps/platform/tests/helpers/accounts.ts apps/platform/tests/unit apps/platform/tests/functional/identity
git -C <repo> commit -m "feat(platform): add single-use account tokens and the account emails" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The new rate limits

**Files:**
- Modify: `apps/platform/app/modules/identity/services/auth_limits.ts`, `apps/platform/start/limiter.ts`
- Test: `apps/platform/tests/unit/modules/identity/auth_limits.spec.ts` (add tests)

**Interfaces:**
- `AUTH_LIMITS` gains `signupPerEmail` (3 per hour), `resetPerIp` (10 per hour), `resetPerEmail` (3 per hour), `accountLinksPerIp` (30 per 15 minutes), `verifyResendCooldown` (1 per minute), `verifyResendPerUser` (5 per hour).
- `emailCountKey(email: string): string` (the digest of the trimmed, lower-cased address; `loginEmailKey` is now `login_email_${emailCountKey(email)}`, the same keys as before) and `clearLoginFailures(storedEmail: string): Promise<void>`.
- From `#start/limiter`: `throttleSignup` (unchanged keys), `throttleSignupEmail`, `throttleResetRequest`, `throttleResetEmail`, `throttleAccountLinks`, `throttleVerifyCooldown`, `throttleVerifyResend`. A `limiter.define(name, …)` key is `${name}_${usingKey}`, and its middleware function is named `${name}Throttle` (Task 9's route guard reads that name).

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/unit/modules/identity/auth_limits.spec.ts`, replace:

```ts
import {
	AUTH_LIMITS,
	loginEmailKey,
	loginIpKey,
	throttleLogin,
} from "#modules/identity/services/auth_limits";
```

with:

```ts
import {
	AUTH_LIMITS,
	clearLoginFailures,
	emailCountKey,
	loginEmailKey,
	loginIpKey,
	throttleLogin,
} from "#modules/identity/services/auth_limits";
```

and append at the end of the file:

```ts

test.group("Auth limits: account emails (TAT-18)", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));

	test("an address's count ignores case and spaces and holds only a digest", ({
		assert,
	}) => {
		const key = emailCountKey(" Ink@Example.com ");

		assert.match(key, /^[A-Za-z0-9_-]{43}$/);
		assert.notInclude(key, "example");
		assert.equal(key, emailCountKey("ink@example.com"));
		assert.equal(loginEmailKey("ink@example.com"), `login_email_${key}`);
	});

	test("a completed reset clears the login failures of the stored address, and nothing else", async ({
		assert,
	}) => {
		const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
		const perIp = limiter.use({ ...AUTH_LIMITS.loginPerIp });
		await perEmail.increment(loginEmailKey("ink@example.com"), 5);
		await perEmail.increment(loginEmailKey("other@example.com"), 2);
		await perIp.increment(loginIpKey("203.0.113.80"), 4);

		await clearLoginFailures("ink@example.com");

		assert.isNull(await perEmail.get(loginEmailKey("ink@example.com")));
		assert.equal(
			(await perEmail.get(loginEmailKey("other@example.com")))?.consumed,
			2,
		);
		assert.equal((await perIp.get(loginIpKey("203.0.113.80")))?.consumed, 4);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=auth_limits.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 and "does not provide an export named 'clearLoginFailures'" in the log.

- [ ] **Step 3: The limits and the helpers**

In `apps/platform/app/modules/identity/services/auth_limits.ts`, replace:

```ts
/**
 * The auth rate limits (TAT-8), by name. Each window is fixed: it starts
 * with the first counted attempt, and a lockout ends when it does (no extra
 * block). Password reset (TAT-18) adds its own entries here and a named
 * middleware in start/limiter.ts.
 */
export const AUTH_LIMITS = {
	/** Login attempts from one client address that didn't sign in. */
	loginPerIp: { requests: 10, duration: "15 mins" },
	/**
	 * Failed logins for one email, from any address. More than twice
	 * loginPerIp over the same window, so one address alone can never lock an
	 * account: it fits at most two of its windows into one of these.
	 */
	loginPerEmail: { requests: 25, duration: "15 mins" },
	/** Every signup request from one client address. */
	signup: { requests: 10, duration: "1 hour" },
} as const;

export function loginIpKey(ip: string) {
	return `login_ip_${digest(clientAddress(ip))}`;
}

/** Case and surrounding spaces don't make a separate count. */
export function loginEmailKey(email: string) {
	return `login_email_${digest(email.trim().toLowerCase())}`;
}
```

with:

```ts
/**
 * The auth rate limits (TAT-8, TAT-18), by name. Each window is fixed: it
 * starts with the first counted attempt, and a lockout ends when it does
 * (no extra block). The request limits are `limiter.define` middleware in
 * start/limiter.ts; login counts failures in throttleLogin below.
 */
export const AUTH_LIMITS = {
	/** Login attempts from one client address that didn't sign in. */
	loginPerIp: { requests: 10, duration: "15 mins" },
	/**
	 * Failed logins for one email, from any address. More than twice
	 * loginPerIp over the same window, so one address alone can never lock an
	 * account: it fits at most two of its windows into one of these.
	 */
	loginPerEmail: { requests: 25, duration: "15 mins" },
	/** Every signup request from one client address. */
	signup: { requests: 10, duration: "1 hour" },
	/**
	 * Signups naming one email address, from any client address (TAT-18):
	 * each one emails that address (a confirmation link, or "you already
	 * have an account").
	 */
	signupPerEmail: { requests: 3, duration: "1 hour" },
	/** Password reset requests from one client address (TAT-18). */
	resetPerIp: { requests: 10, duration: "1 hour" },
	/**
	 * Password reset requests naming one email address, registered or not,
	 * from any client address: the emails one mailbox can get, and the
	 * guesses about one address.
	 */
	resetPerEmail: { requests: 3, duration: "1 hour" },
	/** Opening or using a reset or confirmation link, from one client address. */
	accountLinksPerIp: { requests: 30, duration: "15 mins" },
	/** "Send a new link": one a minute per account... */
	verifyResendCooldown: { requests: 1, duration: "1 min" },
	/** ...and five an hour. */
	verifyResendPerUser: { requests: 5, duration: "1 hour" },
} as const;

export function loginIpKey(ip: string) {
	return `login_ip_${digest(clientAddress(ip))}`;
}

/**
 * An email address's part of a count key: a digest, so the table holds no
 * address; case and surrounding spaces don't make a separate count.
 */
export function emailCountKey(email: string) {
	return digest(email.trim().toLowerCase());
}

export function loginEmailKey(email: string) {
	return `login_email_${emailCountKey(email)}`;
}

/**
 * Forgets the failed logins counted for an account's address (TAT-18): a
 * completed password reset proves the mailbox, so someone else's guesses no
 * longer keep its owner out. Pass the address the account has STORED (the
 * reset knows the account, never a typed address). The client addresses'
 * counts stay: one address's attempts span many accounts.
 */
export async function clearLoginFailures(storedEmail: string) {
	await limiter
		.use({ ...AUTH_LIMITS.loginPerEmail })
		.delete(loginEmailKey(storedEmail));
}
```

- [ ] **Step 4: The middleware**

Replace the whole of `apps/platform/start/limiter.ts`, which today is:

```ts
/*
|--------------------------------------------------------------------------
| Named HTTP limiters
|--------------------------------------------------------------------------
|
| Each counts every request to the routes it guards, per client address
| (TAT-8). A refused request goes back to its form with "Too many attempts"
| (app/exceptions/handler.ts). The numbers live in AUTH_LIMITS; password
| reset (TAT-18) adds its limiters here.
|
*/

import limiter from "@adonisjs/limiter/services/main";
import { AUTH_LIMITS } from "#modules/identity/services/auth_limits";
import { clientAddress, digest } from "#services/rate_limits";

export const throttleSignup = limiter.define("signup", (ctx) =>
	limiter
		.allowRequests(AUTH_LIMITS.signup.requests)
		.every(AUTH_LIMITS.signup.duration)
		.usingKey(digest(clientAddress(ctx.request.ip()))),
);
```

with:

```ts
/*
|--------------------------------------------------------------------------
| Named HTTP limiters
|--------------------------------------------------------------------------
|
| Each counts every request to the routes it guards (TAT-8, TAT-18): per
| client address, per email address named, or per signed-in account. A
| refused request goes back to its form with "Too many attempts"
| (app/exceptions/handler.ts). The numbers live in AUTH_LIMITS. A key is
| `<name>_<digest>`, so the table holds no address.
|
*/

import type { HttpContext } from "@adonisjs/core/http";
import limiter from "@adonisjs/limiter/services/main";
import {
	AUTH_LIMITS,
	emailCountKey,
} from "#modules/identity/services/auth_limits";
import { clientAddress, digest } from "#services/rate_limits";

type Limit = { requests: number; duration: string };

/** Every request from one client address. */
function perAddress(ctx: HttpContext, limit: Limit) {
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(digest(clientAddress(ctx.request.ip())));
}

/**
 * Every request naming one email address, registered or not (TAT-18). A
 * request that names none isn't counted here: validation refuses it, and
 * the client address's limit already counted it.
 */
function perEmail(ctx: HttpContext, limit: Limit) {
	const email = ctx.request.input("email");
	if (typeof email !== "string" || email.trim() === "") {
		return limiter.noLimit();
	}
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(emailCountKey(email));
}

/** Every request of the signed-in account; use it after auth. */
function perAccount(ctx: HttpContext, limit: Limit) {
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(digest(ctx.auth.getUserOrFail().id));
}

export const throttleSignup = limiter.define("signup", (ctx) =>
	perAddress(ctx, AUTH_LIMITS.signup),
);
export const throttleSignupEmail = limiter.define("signup_email", (ctx) =>
	perEmail(ctx, AUTH_LIMITS.signupPerEmail),
);
export const throttleResetRequest = limiter.define("reset_ip", (ctx) =>
	perAddress(ctx, AUTH_LIMITS.resetPerIp),
);
export const throttleResetEmail = limiter.define("reset_email", (ctx) =>
	perEmail(ctx, AUTH_LIMITS.resetPerEmail),
);
export const throttleAccountLinks = limiter.define("account_links", (ctx) =>
	perAddress(ctx, AUTH_LIMITS.accountLinksPerIp),
);
export const throttleVerifyCooldown = limiter.define("verify_cooldown", (ctx) =>
	perAccount(ctx, AUTH_LIMITS.verifyResendCooldown),
);
export const throttleVerifyResend = limiter.define("verify_resend", (ctx) =>
	perAccount(ctx, AUTH_LIMITS.verifyResendPerUser),
);
```

`throttleSignup` keeps its key (`signup_<digest of the client address>`), so TAT-8's tests don't change.

- [ ] **Step 5: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=auth_limits.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=rate_limits.spec.ts --files=public_limits.spec.ts`
Expected: PASS (2 new unit tests; the functional ones unchanged). Then `typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/identity/services/auth_limits.ts apps/platform/start/limiter.ts apps/platform/tests/unit/modules/identity/auth_limits.spec.ts
git -C <repo> commit -m "feat(platform): add rate limits for signup emails, password reset and account links" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 6: AccountService: signup, confirmation and reset

**Files:**
- Create: `apps/platform/app/modules/identity/services/account_service.ts`
- Test: `apps/platform/tests/functional/identity/account_service.spec.ts` (create)

**Interfaces:**
- `AccountService` (default export of `#modules/identity/services/account_service`, `@inject()`, depends on `AccountTokenService`): `signUp(input: SignupInput): Promise<void>` with `type SignupInput = { fullName: string | null; email: string; password: string }` (extra fields such as `passwordConfirmation` are ignored), `sendVerification(user: User): Promise<void>`, `tokenState(token, purpose): Promise<TokenState>`, `confirmEmail(token): Promise<User | null>`, `markVerified(email): Promise<"unknown" | "already" | "confirmed">`, `requestPasswordReset(email): Promise<void>`, `resetPassword(token, password): Promise<User | null>`.
- Every method runs in `withTransaction` (a savepoint inside a request transaction, its own transaction on guest routes) and queues its email with `sendMailInTransaction`, so an email exists only if its transaction commits. Links are `APP_URL` plus `linkPath`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/account_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import User from "#models/user";
import AccountService from "#modules/identity/services/account_service";
import AccountTokenService from "#modules/identity/services/account_token_service";
import {
	AUTH_LIMITS,
	loginEmailKey,
} from "#modules/identity/services/auth_limits";
import { dbClient } from "#services/db_context";
import env from "#start/env";
import {
	altered,
	expireToken,
	queuedMails,
	tokenOf,
} from "#tests/helpers/accounts";

const tokens = new AccountTokenService();
const accounts = new AccountService(tokens);
const PASSWORD = "secret-password";

/** A link on this platform, as the emails write it. */
const appLink = (path: string) => new URL(path, env.get("APP_URL")).toString();

async function signsIn(email: string, password: string) {
	try {
		await User.verifyCredentials(email, password);
		return true;
	} catch {
		return false;
	}
}

test.group("AccountService (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("signing up a new address makes an unconfirmed account and emails it a confirmation link", async ({
		assert,
	}) => {
		const fake = queue.fake();

		await accounts.signUp({
			fullName: "Ada Ink",
			email: " Ada@Service-18.example ",
			password: PASSWORD,
		});

		const user = await User.findByOrFail("email", "ada@service-18.example");
		assert.equal(user.fullName, "Ada Ink");
		assert.isNull(user.emailVerifiedAt);
		assert.equal(user.sessionVersion, 1);
		assert.isTrue(await signsIn(user.email, PASSWORD));
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[["ada@service-18.example", "Confirm your email address"]],
		);
		const url = String(mails[0].data.url);
		assert.isTrue(url.startsWith(appLink("/verify-email/")));
		assert.deepEqual(await tokens.state(tokenOf(url), "verify_email"), {
			state: "live",
			userId: user.id,
			email: user.email,
		});
	});

	test("signing up a taken address changes nothing and emails its owner a sign-in and a reset link", async ({
		assert,
	}) => {
		const owner = await User.create({
			fullName: "Owner",
			email: "taken@service-18.example",
			password: PASSWORD,
		});
		const fake = queue.fake();

		await accounts.signUp({
			fullName: "Someone Else",
			email: "TAKEN@service-18.example",
			password: "another-password",
		});

		const rows = await User.query().where("email", "taken@service-18.example");
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].fullName, "Owner");
		assert.isTrue(await signsIn(owner.email, PASSWORD));
		assert.isFalse(await signsIn(owner.email, "another-password"));
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[owner.email, "You already have a Tattoo Drip account"]],
		);
		assert.equal(mails[0].data.signInUrl, appLink("/login"));
		const reset = String(mails[0].data.resetUrl);
		assert.isTrue(reset.startsWith(appLink("/reset-password/")));
		assert.containSubset(await tokens.state(tokenOf(reset), "reset_password"), {
			state: "live",
			userId: owner.id,
		});
		assert.notInclude(JSON.stringify(mails[0].data), "Someone Else");
	});

	test("a confirmation link confirms its account once", async ({ assert }) => {
		const user = await User.create({
			email: "once@service-18.example",
			password: PASSWORD,
		});
		const fake = queue.fake();
		await accounts.sendVerification(user);
		const token = tokenOf(queuedMails(fake)[0].data.url);

		const confirmed = await accounts.confirmEmail(token);

		assert.equal(confirmed?.id, user.id);
		const at = (await User.findOrFail(user.id)).emailVerifiedAt;
		assert.isNotNull(at);
		assert.isNull(await accounts.confirmEmail(token));
		assert.equal(
			(await User.findOrFail(user.id)).emailVerifiedAt?.toMillis(),
			at?.toMillis(),
		);
	});

	test("a link sent to an address the account no longer has confirms nothing", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "before@service-18.example",
			password: PASSWORD,
		});
		const token = await tokens.issue(user, "verify_email");
		await dbClient().rawQuery("update users set email = ? where id = ?", [
			"after@service-18.example",
			user.id,
		]);

		assert.isNull(await accounts.confirmEmail(token));
		assert.isNull((await User.findOrFail(user.id)).emailVerifiedAt);
	});

	test("the operator's confirmation: unknown, confirmed (its link revoked), then already", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "pilot@service-18.example",
			password: PASSWORD,
		});
		const token = await tokens.issue(user, "verify_email");

		assert.equal(await accounts.markVerified("nobody@service-18.example"), "unknown");
		assert.equal(
			await accounts.markVerified(" PILOT@service-18.example "),
			"confirmed",
		);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "unknown");
		assert.equal(await accounts.markVerified("pilot@service-18.example"), "already");
	});

	test("a reset request emails a link only when an account uses the address", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "reset@service-18.example",
			password: PASSWORD,
		});
		const fake = queue.fake();

		await accounts.requestPasswordReset("nobody@service-18.example");
		await accounts.requestPasswordReset(" RESET@Service-18.example ");

		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Choose a new password"]],
		);
		assert.containSubset(
			await tokens.state(tokenOf(mails[0].data.url), "reset_password"),
			{ state: "live", userId: user.id },
		);
		const { rows } = await dbClient().rawQuery(
			"select count(*)::int as n from account_tokens where email = ?",
			["nobody@service-18.example"],
		);
		assert.equal(rows[0].n, 0);
	});

	test("a reset sets the password, signs every session out, confirms the address and emails a notice, once", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "done@service-18.example",
			password: PASSWORD,
		});
		const pending = await tokens.issue(user, "verify_email");
		const token = await tokens.issue(user, "reset_password");
		const fake = queue.fake();

		const reset = await accounts.resetPassword(token, "a-new-password");

		assert.equal(reset?.id, user.id);
		const after = await User.findOrFail(user.id);
		assert.equal(after.sessionVersion, 2);
		assert.isNotNull(after.emailVerifiedAt);
		assert.isTrue(await signsIn(user.email, "a-new-password"));
		assert.isFalse(await signsIn(user.email, PASSWORD));
		assert.equal((await tokens.state(pending, "verify_email")).state, "unknown");
		assert.equal((await tokens.state(token, "reset_password")).state, "unknown");
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Your Tattoo Drip password was changed"]],
		);
		assert.equal(mails[0].data.resetUrl, appLink("/forgot-password"));
		assert.match(
			String(mails[0].data.changedAt),
			/^\d{1,2} [A-Z][a-z]{2} \d{4} at \d{2}:\d{2} UTC$/,
		);
		assert.notInclude(JSON.stringify(mails[0].data), "/reset-password/");

		assert.isNull(await accounts.resetPassword(token, "a-third-password"));
		assert.equal((await User.findOrFail(user.id)).sessionVersion, 2);
		assert.isTrue(await signsIn(user.email, "a-new-password"));
	});

	test("a reset clears the login failures counted for the account's stored address", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "locked@service-18.example",
			password: PASSWORD,
		});
		const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
		await perEmail.increment(loginEmailKey(user.email), 25);

		await accounts.resetPassword(
			await tokens.issue(user, "reset_password"),
			"a-new-password",
		);

		assert.isNull(await perEmail.get(loginEmailKey(user.email)));
	});

	test("an expired token, a confirmation token or an altered one resets nothing", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "kept@service-18.example",
			password: PASSWORD,
		});
		const expired = await tokens.issue(user, "reset_password");
		await expireToken(user.id, "reset_password");
		const confirmation = await tokens.issue(user, "verify_email");

		for (const token of [expired, confirmation, altered(confirmation)]) {
			assert.isNull(await accounts.resetPassword(token, "a-new-password"));
		}

		assert.equal((await User.findOrFail(user.id)).sessionVersion, 1);
		assert.isTrue(await signsIn(user.email, PASSWORD));
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=account_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 and "Cannot find module" for `account_service` in the log.

- [ ] **Step 3: The service**

Create `apps/platform/app/modules/identity/services/account_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	accountUrl,
	linkPath,
	type TokenPurpose,
} from "#modules/identity/account_tokens";
import { canonicalEmail } from "#modules/identity/email_address";
import AccountExistsMail from "#modules/identity/emails/account_exists_mail";
import PasswordChangedMail, {
	changedAtText,
} from "#modules/identity/emails/password_changed_mail";
import ResetPasswordMail from "#modules/identity/emails/reset_password_mail";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountTokenService, {
	type TokenState,
} from "#modules/identity/services/account_token_service";
import { clearLoginFailures } from "#modules/identity/services/auth_limits";
import { afterCommit, withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";
import { sendMailInTransaction } from "#services/mail_in_transaction";
import env from "#start/env";

export type SignupInput = {
	fullName: string | null;
	email: string;
	password: string;
};

/** A link on this platform, for an email. */
function appLink(path: string) {
	return accountUrl(env.get("APP_URL"), path);
}

/**
 * Accounts (TAT-18): signup, email confirmation and password reset. Each
 * method runs in one transaction (a savepoint inside a request's) and
 * queues its email with sendMailInTransaction, so an email exists only if
 * its writes committed. Tokens come from AccountTokenService.
 */
@inject()
export default class AccountService {
	constructor(private tokens: AccountTokenService) {}

	/**
	 * Signs a person up without telling whether the address already has an
	 * account (spec ruling 6). A new address gets an unconfirmed account and
	 * a confirmation link; a taken one gets "you already have an account"
	 * with a reset link, and its account doesn't change. Either way the
	 * model hashes the password once, one token is written and one email is
	 * queued. Nobody is signed in.
	 */
	async signUp(input: SignupInput): Promise<void> {
		const email = canonicalEmail(input.email);
		await withTransaction(async (trx) => {
			const created = await this.createAccount({
				fullName: input.fullName,
				email,
				password: input.password,
			});
			if (created) {
				const token = await this.tokens.issue(created, "verify_email");
				await sendMailInTransaction(
					new VerifyEmailMail({
						to: created.email,
						url: this.linkFor("verify_email", token),
					}),
					trx,
				);
				return;
			}
			const existing = await User.findByOrFail("email", email);
			const token = await this.tokens.issue(existing, "reset_password");
			await sendMailInTransaction(
				new AccountExistsMail({
					to: existing.email,
					signInUrl: appLink("/login"),
					resetUrl: this.linkFor("reset_password", token),
				}),
				trx,
			);
		});
	}

	/**
	 * The new account, or null when the address is taken. The insert runs in
	 * a savepoint, after the model hashed the password.
	 */
	private async createAccount(input: SignupInput): Promise<User | null> {
		try {
			return await withTransaction(() => User.create(input));
		} catch (error) {
			if (isUniqueViolation(error, "users_email_unique")) return null;
			throw error;
		}
	}

	/**
	 * A new confirmation link for an account whose address isn't confirmed
	 * (spec ruling 15). The older link stops working.
	 */
	async sendVerification(user: User): Promise<void> {
		await withTransaction(async (trx) => {
			const token = await this.tokens.issue(user, "verify_email");
			await sendMailInTransaction(
				new VerifyEmailMail({
					to: user.email,
					url: this.linkFor("verify_email", token),
				}),
				trx,
			);
		});
	}

	/** What a link's page shows: live (with its address), expired or unknown. */
	tokenState(token: string, purpose: TokenPurpose): Promise<TokenState> {
		return this.tokens.state(token, purpose);
	}

	/**
	 * Confirms the address a live confirmation link was sent to, once
	 * (spec ruling 16). Whoever is signed in doesn't matter: the link proves
	 * the mailbox, and it signs nobody in. Null for a dead link, or one sent
	 * to an address the account no longer has.
	 */
	async confirmEmail(token: string): Promise<User | null> {
		return withTransaction(async () => {
			const claim = await this.tokens.consume(token, "verify_email");
			if (!claim) return null;
			const user = await User.query()
				.where("id", claim.userId)
				.forUpdate()
				.first();
			if (!user || user.email !== claim.email) return null;
			if (!user.emailVerifiedAt) {
				user.emailVerifiedAt = DateTime.now();
				await user.save();
			}
			return user;
		});
	}

	/**
	 * Confirms an account's address without a link (spec ruling 20): the
	 * operator's account:verify, once they checked the person some other
	 * way. Revokes the account's confirmation link.
	 */
	async markVerified(
		email: string,
	): Promise<"unknown" | "already" | "confirmed"> {
		return withTransaction(async () => {
			const user = await User.query()
				.where("email", canonicalEmail(email))
				.forUpdate()
				.first();
			if (!user) return "unknown";
			if (user.emailVerifiedAt) return "already";
			user.emailVerifiedAt = DateTime.now();
			await user.save();
			await this.tokens.revoke(user.id, "verify_email");
			return "confirmed";
		});
	}

	/**
	 * Emails a reset link when an account uses this address, and does
	 * nothing otherwise (spec ruling 11). The caller answers the same either
	 * way.
	 */
	async requestPasswordReset(email: string): Promise<void> {
		await withTransaction(async (trx) => {
			const user = await User.findBy("email", canonicalEmail(email));
			if (!user) return;
			const token = await this.tokens.issue(user, "reset_password");
			await sendMailInTransaction(
				new ResetPasswordMail({
					to: user.email,
					url: this.linkFor("reset_password", token),
				}),
				trx,
			);
		});
	}

	/**
	 * Sets a new password with a live reset link, once (spec ruling 13).
	 * Raises the session version (every session signs out), confirms the
	 * address if it wasn't (the link proved the mailbox), emails the
	 * account's address that its password changed, and once committed
	 * clears the login failures of that stored address. Signs nobody in.
	 * Null for a dead link, or one sent to an address the account no longer
	 * has.
	 */
	async resetPassword(token: string, password: string): Promise<User | null> {
		return withTransaction(async (trx) => {
			const claim = await this.tokens.consume(token, "reset_password");
			if (!claim) return null;
			const user = await User.query()
				.where("id", claim.userId)
				.forUpdate()
				.first();
			if (!user || user.email !== claim.email) return null;
			user.password = password;
			user.sessionVersion += 1;
			if (!user.emailVerifiedAt) {
				user.emailVerifiedAt = DateTime.now();
				await this.tokens.revoke(user.id, "verify_email");
			}
			await user.save();
			await sendMailInTransaction(
				new PasswordChangedMail({
					to: user.email,
					changedAt: changedAtText(DateTime.now()),
					resetUrl: appLink("/forgot-password"),
				}),
				trx,
			);
			const storedEmail = user.email;
			afterCommit(() => clearLoginFailures(storedEmail));
			return user;
		});
	}

	private linkFor(purpose: TokenPurpose, token: string) {
		return appLink(linkPath(purpose, token));
	}
}
```

The users table has no row-level security, so none of this needs a tenant context. `user.password = password` is hashed by the model's `beforeSave` hook (`withAuthFinder`).

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=account_service.spec.ts --files=account_token_service.spec.ts`
Expected: PASS (9 new). Then `typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/identity/services/account_service.ts apps/platform/tests/functional/identity/account_service.spec.ts
git -C <repo> commit -m "feat(platform): add the account service for signup, confirmation and password reset" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Password reset pages

**Files:**
- Modify: `apps/platform/app/validators/user.ts`, `apps/platform/app/middleware/guest_middleware.ts`, `apps/platform/start/routes.ts`
- Create: `apps/platform/app/controllers/password_reset_controller.ts`
- Create: `apps/platform/inertia/pages/auth/forgot_password.tsx`, `apps/platform/inertia/pages/auth/reset_password.tsx`, `apps/platform/inertia/pages/auth/check_email.tsx`
- Rewrite: `apps/platform/inertia/pages/auth/login.tsx`
- Regenerated: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/identity/password_reset.spec.ts` (create); modify `apps/platform/tests/functional/auth/page_history.spec.ts`

**Interfaces:**
- `passwordResetRequestValidator` (`{ email }`, canonical) and `newPasswordValidator` (`{ password, passwordConfirmation }`, signup's rules) from `#validators/user`.
- `PasswordResetController`: `create`, `store`, `sent`, `link`, `edit`, `update` (routes in Global Constraints).
- Pages: `auth/forgot_password` (no props), `auth/check_email` (`{ purpose: "signup" | "reset"; email: string | null }`, Task 8 renders the signup purpose), `auth/reset_password` (`{ state: "ready" | "expired" | "invalid"; email: string | null }`).
- The guest middleware sends a signed-in visitor to `/dashboard` (was `/`).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/password_reset.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	SENT_TO_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import {
	AUTH_LIMITS,
	emailCountKey,
	loginEmailKey,
} from "#modules/identity/services/auth_limits";
import env from "#start/env";
import {
	altered,
	cookieNames,
	expireToken,
	queuedMails,
} from "#tests/helpers/accounts";
import { assertValidationError } from "#tests/helpers/validation";

const KEY = SESSION_TOKEN_KEYS.reset_password;
const OLD = "the-old-password";
const NEW = "a-new-password";
const REFUSED = "Invalid or expired CSRF token";
const tokens = new AccountTokenService();

function makeUser(email = "ink@reset-18.example") {
	return User.create({ email, password: OLD });
}

/** POST /forgot-password from one client address. */
function ask(client: ApiClient, email: string, ip = "203.0.113.110") {
	return client
		.post("/forgot-password")
		.header("x-forwarded-for", ip)
		.header("referer", "/forgot-password")
		.form({ email })
		.withCsrfToken()
		.redirects(0);
}

/** POST /reset-password with `token` in the session, as the link leaves it. */
function choose(
	client: ApiClient,
	token: string | null,
	password = NEW,
	confirmation = password,
) {
	return client
		.post("/reset-password")
		.withSession(token ? { [KEY]: token } : {})
		.header("referer", "/reset-password")
		.form({ password, passwordConfirmation: confirmation })
		.withCsrfToken()
		.redirects(0);
}

async function signsIn(email: string, password: string) {
	try {
		await User.verifyCredentials(email, password);
		return true;
	} catch {
		return false;
	}
}

test.group("Password reset (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("asking for a link answers the same for every address; only an account's address gets an email", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const fake = queue.fake();

		const known = await ask(client, "INK@Reset-18.example", "203.0.113.111");
		const unknown = await ask(client, "nobody@reset-18.example", "203.0.113.112");

		for (const response of [known, unknown]) {
			response.assertStatus(302);
			response.assertHeader("location", "/forgot-password/sent");
			response.assertFlashMissing("error");
		}
		known.assertFlashMessage(SENT_TO_FLASH, user.email);
		unknown.assertFlashMessage(SENT_TO_FLASH, "nobody@reset-18.example");
		assert.deepEqual(cookieNames(known), cookieNames(unknown));
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Choose a new password"]],
		);
		assert.isTrue(
			String(mails[0].data.url).startsWith(
				new URL("/reset-password/", env.get("APP_URL")).toString(),
			),
		);
	});

	test("the sent page shows the address it was asked for, or none", async ({
		client,
		assert,
	}) => {
		const page = await client
			.get("/forgot-password/sent")
			.withFlashMessages({ [SENT_TO_FLASH]: "ink@reset-18.example" })
			.withInertia();
		page.assertInertiaComponent("auth/check_email");
		assert.containSubset(page.inertiaProps, {
			purpose: "reset",
			email: "ink@reset-18.example",
		});

		const reload = await client.get("/forgot-password/sent").withInertia();
		assert.containSubset(reload.inertiaProps, { purpose: "reset", email: null });
	});

	test("three requests an hour per address named, registered or not, from anywhere", async ({
		client,
	}) => {
		for (const ip of ["203.0.113.121", "203.0.113.122", "203.0.113.123"]) {
			(await ask(client, "nobody@reset-18.example", ip)).assertHeader(
				"location",
				"/forgot-password/sent",
			);
		}

		const refused = await ask(client, "Nobody@Reset-18.example", "203.0.113.124");
		refused.assertHeader("location", "/forgot-password");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		(await ask(client, "someone@reset-18.example", "203.0.113.124")).assertHeader(
			"location",
			"/forgot-password/sent",
		);
	});

	test("ten requests an hour per client address; a refused one never reaches the address count", async ({
		client,
		assert,
	}) => {
		for (let i = 0; i < 10; i++) {
			(await ask(client, `person${i}@reset-18.example`, "203.0.113.130")).assertHeader(
				"location",
				"/forgot-password/sent",
			);
		}

		const refused = await ask(client, "person10@reset-18.example", "203.0.113.130");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		assert.isNull(
			await limiter
				.use({ ...AUTH_LIMITS.resetPerEmail })
				.get(`reset_email_${emailCountKey("person10@reset-18.example")}`),
		);
	});

	test("the emailed link only moves its token into the session and opens the form without it", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		const response = await client.get(`/reset-password/${token}`).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/reset-password");
		response.assertHeader("referrer-policy", "no-referrer");
		response.assertHeader("cache-control", "no-store");
		response.assertSession(KEY, token);
		assert.isTrue(await signsIn(user.email, OLD));
		(await client.get("/reset-password/not-a-token").redirects(0)).assertStatus(
			404,
		);
	});

	test("the form shows the account's address for a live link, never the token, and says when a link is dead", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		const live = await client
			.get("/reset-password")
			.withSession({ [KEY]: token })
			.withInertia();
		live.assertInertiaComponent("auth/reset_password");
		assert.containSubset(live.inertiaProps, {
			state: "ready",
			email: user.email,
		});
		assert.notInclude(JSON.stringify(live.body()), token);
		live.assertHeader("cache-control", "no-store");
		live.assertHeader("referrer-policy", "same-origin");

		const none = await client.get("/reset-password").withInertia();
		assert.containSubset(none.inertiaProps, { state: "invalid", email: null });

		await expireToken(user.id, "reset_password");
		const expired = await client
			.get("/reset-password")
			.withSession({ [KEY]: token })
			.withInertia();
		assert.containSubset(expired.inertiaProps, {
			state: "expired",
			email: null,
		});
	});

	test("a new password follows signup's rules, and an error changes nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		assertValidationError(await choose(client, token, "short"), "password");
		assertValidationError(await choose(client, token, "x".repeat(33)), "password");
		assertValidationError(
			await choose(client, token, NEW, "something-else"),
			"passwordConfirmation",
		);

		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal((await tokens.state(token, "reset_password")).state, "live");
	});

	test("a completed reset changes the password, signs every session out and signs nobody in", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const before = await User.findOrFail(user.id);
		const token = await tokens.issue(user, "reset_password");

		const response = await choose(client, token);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
		response.assertFlashMessage(
			"success",
			"Password changed. Sign in with your new password.",
		);
		response.assertSessionMissing("auth_web");
		response.assertSessionMissing(KEY);
		assert.isTrue(await signsIn(user.email, NEW));
		assert.isFalse(await signsIn(user.email, OLD));
		const elsewhere = await client.get("/dashboard").loginAs(before).redirects(0);
		elsewhere.assertHeader("location", "/login");
	});

	test("a reset link works once: a replay changes nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");
		(await choose(client, token)).assertHeader("location", "/login");

		const replay = await choose(client, token, "a-third-password");

		replay.assertHeader("location", "/reset-password");
		replay.assertFlashMissing("success");
		assert.isTrue(await signsIn(user.email, NEW));
		assert.isFalse(await signsIn(user.email, "a-third-password"));
	});

	test("an expired link, an altered one, a confirmation link or none resets nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const reset = await tokens.issue(user, "reset_password");
		const confirmation = await tokens.issue(user, "verify_email");

		for (const token of [altered(reset), confirmation, null]) {
			(await choose(client, token)).assertHeader("location", "/reset-password");
		}
		await expireToken(user.id, "reset_password");
		(await choose(client, reset)).assertHeader("location", "/reset-password");

		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal((await User.findOrFail(user.id)).sessionVersion, 1);
	});

	test("a locked-out account signs in after its reset, which also confirms its address and emails a notice", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		await limiter
			.use({ ...AUTH_LIMITS.loginPerEmail })
			.increment(loginEmailKey(user.email), 25);
		const signIn = (password: string) =>
			client
				.post("/login")
				.header("referer", "/login")
				.form({ email: user.email, password })
				.withCsrfToken()
				.redirects(0);
		(await signIn(OLD)).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
		const fake = queue.fake();

		await choose(client, await tokens.issue(user, "reset_password"));

		(await signIn(NEW)).assertHeader("location", "/dashboard");
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.deepEqual(
			queuedMails(fake).map(({ to, subject }) => [to, subject]),
			[[user.email, "Your Tattoo Drip password was changed"]],
		);
	});

	test("a signed-in visitor of the reset pages goes to the dashboard, and a link stores nothing for them", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		(await client.get("/forgot-password").loginAs(user).redirects(0)).assertHeader(
			"location",
			"/dashboard",
		);
		const link = await client
			.get(`/reset-password/${token}`)
			.loginAs(user)
			.redirects(0);
		link.assertHeader("location", "/dashboard");
		link.assertSessionMissing(KEY);
		assert.equal((await tokens.state(token, "reset_password")).state, "live");
	});

	test("a reset without this session's CSRF token is refused", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		const response = await client
			.post("/reset-password")
			.withSession({ [KEY]: token })
			.form({ password: NEW, passwordConfirmation: NEW })
			.redirects(0);

		response.assertFlashMessage("error", REFUSED);
		assert.isTrue(await signsIn(user.email, OLD));
	});

	test("the link routes count 30 requests per client address in 15 minutes", async ({
		client,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");
		const open = () =>
			client
				.get(`/reset-password/${token}`)
				.header("x-forwarded-for", "203.0.113.140")
				.header("referer", "/login")
				.redirects(0);
		for (let i = 0; i < 30; i++) {
			(await open()).assertHeader("location", "/reset-password");
		}

		(await open()).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
	});
});
```

In `apps/platform/tests/functional/auth/page_history.spec.ts`, replace:

```ts
	test("the login and signup pages clear history", async ({
		client,
		assert,
	}) => {
		const login = await client.get("/login").withInertia();
		const signup = await client.get("/signup").withInertia();

		login.assertInertiaComponent("auth/login");
		assert.isTrue(login.body().clearHistory);
		signup.assertInertiaComponent("auth/signup");
		assert.isTrue(signup.body().clearHistory);
	});
```

with:

```ts
	test("every guest page clears history", async ({ client, assert }) => {
		for (const [path, component] of [
			["/login", "auth/login"],
			["/signup", "auth/signup"],
			["/forgot-password", "auth/forgot_password"],
			["/forgot-password/sent", "auth/check_email"],
			["/reset-password", "auth/reset_password"],
		] as const) {
			const page = await client.get(path).withInertia();

			page.assertInertiaComponent(component);
			assert.isTrue(page.body().clearHistory, path);
		}
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=password_reset.spec.ts --files=page_history.spec.ts`
Expected: the 14 new tests FAIL (404 for `/forgot-password` and `/reset-password…`, and the guest redirect goes to `/`), and "every guest page clears history" fails on `/forgot-password`.

- [ ] **Step 3: Validators**

In `apps/platform/app/validators/user.ts`, after the `loginValidator` block (it ends with `password: vine.string(),` and `});`), add:

```ts

/**
 * Asking for a password reset link (TAT-18): the address in its canonical
 * form, registered or not.
 */
export const passwordResetRequestValidator = vine.create({
	email: accountEmail(),
});

/** A new password from a reset link: signup's rules, never weaker (TAT-18). */
export const newPasswordValidator = vine.create({
	password: password(),
	passwordConfirmation: password().sameAs("password"),
});
```

- [ ] **Step 4: Signed-in visitors of guest pages go to their studio**

In `apps/platform/app/middleware/guest_middleware.ts`, replace:

```ts
	/**
	 * The URL to redirect to when user is logged-in
	 */
	redirectTo = "/";
```

with:

```ts
	/**
	 * Where a signed-in visitor of a guest page goes: their studio, through
	 * /dashboard (TAT-18; it was the starter kit's home page). A reset link
	 * opened while signed in stays valid for its hour.
	 */
	redirectTo = "/dashboard";
```

- [ ] **Step 5: The controller**

Create `apps/platform/app/controllers/password_reset_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import {
	SENT_TO_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
import {
	newPasswordValidator,
	passwordResetRequestValidator,
} from "#validators/user";

const TOKEN_KEY = SESSION_TOKEN_KEYS.reset_password;

/**
 * Password reset (TAT-18). Guest pages only: the guest group clears page
 * history (TAT-82). Asking for a link answers the same whether or not an
 * account uses the address. The emailed link's GET only moves its token
 * into the session and opens /reset-password, whose URL holds no token; the
 * new password is that page's POST, so a mail scanner that opens the link
 * changes nothing.
 */
@inject()
export default class PasswordResetController {
	constructor(private accounts: AccountService) {}

	async create({ inertia }: HttpContext) {
		return inertia.render("auth/forgot_password", {});
	}

	async store({ request, response, session }: HttpContext) {
		const { email } = await request.validateUsing(
			passwordResetRequestValidator,
		);
		await this.accounts.requestPasswordReset(email);
		session.flash(SENT_TO_FLASH, email);
		return response.redirect().toRoute("password_reset.sent");
	}

	async sent({ inertia, session }: HttpContext) {
		const email = session.flashMessages.get(SENT_TO_FLASH);
		return inertia.render("auth/check_email", {
			purpose: "reset",
			email: typeof email === "string" ? email : null,
		});
	}

	async link({ params, session, response }: HttpContext) {
		session.put(TOKEN_KEY, params.token);
		response.header("Referrer-Policy", "no-referrer");
		response.header("Cache-Control", "no-store");
		return response.redirect().toRoute("password_reset.edit");
	}

	async edit({ session, inertia, response }: HttpContext) {
		response.header("Cache-Control", "no-store");
		response.header("Referrer-Policy", "same-origin");
		const token = session.get(TOKEN_KEY);
		const found =
			typeof token === "string"
				? await this.accounts.tokenState(token, "reset_password")
				: { state: "unknown" as const };
		if (found.state === "live") {
			return inertia.render("auth/reset_password", {
				state: "ready",
				email: found.email,
			});
		}
		return inertia.render("auth/reset_password", {
			state: found.state === "expired" ? "expired" : "invalid",
			email: null,
		});
	}

	async update({ request, session, response }: HttpContext) {
		const { password } = await request.validateUsing(newPasswordValidator);
		const token = session.get(TOKEN_KEY);
		const user =
			typeof token === "string"
				? await this.accounts.resetPassword(token, password)
				: null;
		if (!user) return response.redirect().toRoute("password_reset.edit");
		session.forget(TOKEN_KEY);
		session.flash("success", "Password changed. Sign in with your new password.");
		return response.redirect().toRoute("session.create");
	}
}
```

- [ ] **Step 6: The routes**

In `apps/platform/start/routes.ts`, replace:

```ts
import { ARTIST_SLUG } from "#modules/artists/validators/artist";
import { DEPOSIT_TOKEN } from "#modules/payments/deposit_links";
import { middleware } from "#start/kernel";
import { throttleSignup } from "#start/limiter";
```

with:

```ts
import { ARTIST_SLUG } from "#modules/artists/validators/artist";
import { ACCOUNT_TOKEN } from "#modules/identity/account_tokens";
import { DEPOSIT_TOKEN } from "#modules/payments/deposit_links";
import { middleware } from "#start/kernel";
import {
	throttleAccountLinks,
	throttleResetEmail,
	throttleResetRequest,
	throttleSignup,
} from "#start/limiter";
```

and replace:

```ts
		router.get("login", [controllers.Session, "create"]);
		router.post("login", [controllers.Session, "store"]);
	})
	.use(middleware.guest());
```

with:

```ts
		router.get("login", [controllers.Session, "create"]);
		router.post("login", [controllers.Session, "store"]);

		/**
		 * Password reset (TAT-18). Asking for a link counts per client
		 * address, then per address named; the link and the new password
		 * count per client address. The link's token lives in the session,
		 * never in a page's URL.
		 */
		router
			.get("forgot-password", [controllers.PasswordReset, "create"])
			.as("password_reset.create");
		router
			.post("forgot-password", [controllers.PasswordReset, "store"])
			.use([throttleResetRequest, throttleResetEmail])
			.as("password_reset.store");
		router
			.get("forgot-password/sent", [controllers.PasswordReset, "sent"])
			.as("password_reset.sent");
		router
			.get("reset-password/:token", [controllers.PasswordReset, "link"])
			.where("token", ACCOUNT_TOKEN)
			.use(throttleAccountLinks)
			.as("password_reset.link");
		router
			.get("reset-password", [controllers.PasswordReset, "edit"])
			.as("password_reset.edit");
		router
			.post("reset-password", [controllers.PasswordReset, "update"])
			.use(throttleAccountLinks)
			.as("password_reset.update");
	})
	.use(middleware.guest());
```

- [ ] **Step 7: The pages**

Create `apps/platform/inertia/pages/auth/check_email.tsx`:

```tsx
import { Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import AuthLayout from "~/layouts/auth";

/**
 * After a signup or a reset request (TAT-18): the same words whether or not
 * the address has an account, so the page never tells.
 */
export default function CheckEmail({
	purpose,
	email,
}: {
	purpose: "signup" | "reset";
	email: string | null;
}) {
	const address = email ? (
		<strong className="font-medium break-all text-foreground">{email}</strong>
	) : (
		"the address you entered"
	);

	return (
		<>
			<Head title="Check your email" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Check your email
				</h1>
				{purpose === "signup" ? (
					<p className="text-sm text-muted-foreground">
						We sent a link to {address}. Open it to confirm your address, then
						sign in to set up your studio.
					</p>
				) : (
					<p className="text-sm text-muted-foreground">
						If an account uses {address}, we sent it a link to choose a new
						password.
					</p>
				)}
			</div>

			<p className="text-sm text-muted-foreground">
				{purpose === "signup"
					? "The link works for 24 hours. If this address already has an account, the email says how to sign in instead. Nothing there after a few minutes? Check your spam folder."
					: "The link works for 1 hour. Nothing there after a few minutes? Check your spam folder, or ask for a new link."}
			</p>

			<div className="flex flex-col items-center text-sm">
				{purpose === "reset" && (
					<Link
						route="password_reset.create"
						className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
					>
						Ask for a new link
					</Link>
				)}
				<Link
					route="session.create"
					className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
				>
					Back to sign in
				</Link>
			</div>
		</>
	);
}

CheckEmail.layout = [AuthLayout];
```

Create `apps/platform/inertia/pages/auth/forgot_password.tsx`:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AuthLayout from "~/layouts/auth";

/**
 * Asking for a password reset link (TAT-18). The next page says the same
 * whether or not the address has an account.
 */
export default function ForgotPassword() {
	return (
		<>
			<Head title="Reset your password" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Reset your password
				</h1>
				<p className="text-sm text-muted-foreground">
					Enter your account's email address and we'll send you a link to
					choose a new password.
				</p>
			</div>

			<Form route="password_reset.store">
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.email}>
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								name="email"
								type="email"
								autoComplete="email"
								placeholder="you@example.com"
								className="h-11"
								aria-invalid={!!errors.email}
							/>
							{errors.email && <FieldError>{errors.email}</FieldError>}
						</Field>

						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Sending…" : "Send the link"}
						</Button>
					</FieldGroup>
				)}
			</Form>

			<p className="text-center text-sm">
				<Link
					route="session.create"
					className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
				>
					Back to sign in
				</Link>
			</p>
		</>
	);
}

ForgotPassword.layout = [AuthLayout];
```

Create `apps/platform/inertia/pages/auth/reset_password.tsx`:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AuthLayout from "~/layouts/auth";

type Props = { state: "ready" | "expired" | "invalid"; email: string | null };

/**
 * The page a reset link opens (TAT-18). The token stays in the session;
 * this page's URL never holds it. The new password is this form's POST.
 */
export default function ResetPassword({ state, email }: Props) {
	if (state !== "ready" || !email) {
		return <DeadLink expired={state === "expired"} />;
	}

	return (
		<>
			<Head title="Choose a new password" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Choose a new password
				</h1>
				<p className="text-sm text-muted-foreground">
					For{" "}
					<strong className="font-medium break-all text-foreground">
						{email}
					</strong>
					. Every device signed in to this account will be signed out; then
					sign in with the new password.
				</p>
			</div>

			<Form route="password_reset.update">
				{({ errors, processing }) => (
					<FieldGroup>
						{/* Lets a password manager file the new password under this account. */}
						<input
							type="email"
							autoComplete="username"
							value={email}
							readOnly
							hidden
						/>

						<Field data-invalid={!!errors.password}>
							<FieldLabel htmlFor="password">New password</FieldLabel>
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="new-password"
								className="h-11"
								aria-invalid={!!errors.password}
								aria-describedby="password-rules"
							/>
							<FieldDescription id="password-rules">
								8 to 32 characters.
							</FieldDescription>
							{errors.password && <FieldError>{errors.password}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.passwordConfirmation}>
							<FieldLabel htmlFor="passwordConfirmation">
								Confirm new password
							</FieldLabel>
							<Input
								id="passwordConfirmation"
								name="passwordConfirmation"
								type="password"
								autoComplete="new-password"
								className="h-11"
								aria-invalid={!!errors.passwordConfirmation}
							/>
							{errors.passwordConfirmation && (
								<FieldError>{errors.passwordConfirmation}</FieldError>
							)}
						</Field>

						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Changing…" : "Change password"}
						</Button>
					</FieldGroup>
				)}
			</Form>
		</>
	);
}

function DeadLink({ expired }: { expired: boolean }) {
	const title = expired ? "This link has expired" : "This link no longer works";

	return (
		<>
			<Head title={title} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				<p className="text-sm text-muted-foreground">
					{expired
						? "Reset links work for 1 hour."
						: "It was already used, or a newer link replaced it."}{" "}
					Ask for a new one if you still need it.
				</p>
			</div>
			<Button asChild className="h-11 w-full">
				<Link route="password_reset.create">Ask for a new link</Link>
			</Button>
			<p className="text-center text-sm">
				<Link
					route="session.create"
					className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
				>
					Back to sign in
				</Link>
			</p>
		</>
	);
}

ResetPassword.layout = [AuthLayout];
```

Replace the whole of `apps/platform/inertia/pages/auth/login.tsx` (today the starter kit's form: "Welcome back", "Sign in to continue building.", the email and password fields, "Sign in", "New here? Create an account") with:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AuthLayout from "~/layouts/auth";

export default function Login() {
	return (
		<>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
				<p className="text-sm text-muted-foreground">Sign in to your studio.</p>
			</div>

			<Form route="session.store">
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.email}>
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								name="email"
								type="email"
								autoComplete="username"
								placeholder="you@example.com"
								aria-invalid={!!errors.email}
							/>
							{errors.email && <FieldError>{errors.email}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.password}>
							<FieldLabel htmlFor="password">Password</FieldLabel>
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="current-password"
								placeholder="••••••••"
								aria-invalid={!!errors.password}
							/>
							{errors.password && <FieldError>{errors.password}</FieldError>}
						</Field>

						<Button type="submit" disabled={processing}>
							{processing ? "One moment…" : "Sign in"}
						</Button>
					</FieldGroup>
				)}
			</Form>

			<div className="flex flex-col items-center text-sm text-muted-foreground">
				<Link
					route="password_reset.create"
					className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground"
				>
					Forgot your password?
				</Link>
				<p>
					New here?{" "}
					<Link
						route="new_account.create"
						className="text-foreground underline underline-offset-4"
					>
						Create an account
					</Link>
				</p>
			</div>
		</>
	);
}

Login.layout = [AuthLayout];
```

- [ ] **Step 8: Regenerate types, run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=password_reset.spec.ts --files=page_history.spec.ts --files=rate_limits.spec.ts --files=access.spec.ts --files=head.spec.ts`
Expected: PASS (14 new; `page_history.spec.ts` keeps its count). Then `typecheck`: clean.

- [ ] **Step 9: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/inertia apps/platform/.adonisjs apps/platform/tests/functional
git -C <repo> commit -m "feat(platform): reset a forgotten password with a single-use link" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Signup that never tells whether an address is taken

**Files:**
- Modify: `apps/platform/app/validators/user.ts`, `apps/platform/start/routes.ts`, `apps/platform/inertia/pages/auth/signup.tsx`, `apps/platform/inertia/layouts/auth.tsx`
- Rewrite: `apps/platform/app/controllers/new_account_controller.ts`
- Modify tests: `apps/platform/tests/functional/tenancy/onboarding.spec.ts` ("signup lands…"), `apps/platform/tests/functional/auth/rate_limits.spec.ts` (one location), `apps/platform/tests/functional/auth/page_history.spec.ts` (one page)
- Regenerated: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/identity/signup.spec.ts` (create)

**Interfaces:**
- `signupValidator`: `fullName` trimmed, at most 255 characters, nullable; `email` canonical with no unique rule; `password` and `passwordConfirmation` as before.
- `NewAccountController`: `create`, `store` (always redirects to `/signup/sent` with the address in the `sentTo` flash; nobody is signed in), `sent` (renders `auth/check_email` with `purpose: "signup"`).
- `POST /signup` runs `throttleSignup` then `throttleSignupEmail`; `GET /signup/sent` is `new_account.sent` in the guest group.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/signup.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import { SENT_TO_FLASH } from "#modules/identity/account_tokens";
import env from "#start/env";
import { cookieNames, queuedMails } from "#tests/helpers/accounts";
import { assertValidationError } from "#tests/helpers/validation";

const PASSWORD = "secret-password";

function form(email: string, fullName = "Ada Ink") {
	return {
		fullName,
		email,
		password: PASSWORD,
		passwordConfirmation: PASSWORD,
	};
}

/** POST /signup from one client address. */
function signup(
	client: ApiClient,
	body: Record<string, string>,
	ip = "203.0.113.90",
) {
	return client
		.post("/signup")
		.header("x-forwarded-for", ip)
		.header("referer", "/signup")
		.form(body)
		.withCsrfToken()
		.redirects(0);
}

const appLink = (path: string) => new URL(path, env.get("APP_URL")).toString();

test.group("Signup (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new address gets an unconfirmed account, a confirmation email and the check-your-email page, signed out", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();

		const response = await signup(client, form("  Ada@Signup-18.example "));

		response.assertStatus(302);
		response.assertHeader("location", "/signup/sent");
		response.assertFlashMessage(SENT_TO_FLASH, "ada@signup-18.example");
		response.assertSessionMissing("auth_web");
		const user = await User.findByOrFail("email", "ada@signup-18.example");
		assert.equal(user.fullName, "Ada Ink");
		assert.isNull(user.emailVerifiedAt);
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[["ada@signup-18.example", "Confirm your email address"]],
		);
		assert.isTrue(String(mails[0].data.url).startsWith(appLink("/verify-email/")));
		assert.notInclude(JSON.stringify(mails[0].data), "Ada Ink");
	});

	test("a taken address answers exactly the same, and only its owner's mailbox hears the difference", async ({
		client,
		assert,
	}) => {
		await User.create({
			fullName: "Owner",
			email: "taken@signup-18.example",
			password: "the-owners-password",
		});
		const fake = queue.fake();

		const fresh = await signup(client, form("fresh@signup-18.example"), "203.0.113.91");
		const taken = await signup(client, form("TAKEN@signup-18.example"), "203.0.113.92");

		for (const response of [fresh, taken]) {
			response.assertStatus(302);
			response.assertHeader("location", "/signup/sent");
			response.assertSessionMissing("auth_web");
			response.assertFlashMissing("error");
			response.assertFlashMissing("inputErrorsBag");
		}
		taken.assertFlashMessage(SENT_TO_FLASH, "taken@signup-18.example");
		assert.deepEqual(cookieNames(taken), cookieNames(fresh));

		const owners = await User.query().where("email", "taken@signup-18.example");
		assert.lengthOf(owners, 1);
		assert.equal(owners[0].fullName, "Owner");
		await User.verifyCredentials("taken@signup-18.example", "the-owners-password");
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[
				["fresh@signup-18.example", "Confirm your email address"],
				["taken@signup-18.example", "You already have a Tattoo Drip account"],
			],
		);
		assert.equal(mails[1].data.signInUrl, appLink("/login"));
		assert.isTrue(
			String(mails[1].data.resetUrl).startsWith(appLink("/reset-password/")),
		);
	});

	test("the check-your-email page shows the address it was sent to, or none", async ({
		client,
		assert,
	}) => {
		const page = await client
			.get("/signup/sent")
			.withFlashMessages({ [SENT_TO_FLASH]: "ada@signup-18.example" })
			.withInertia();
		page.assertInertiaComponent("auth/check_email");
		assert.containSubset(page.inertiaProps, {
			purpose: "signup",
			email: "ada@signup-18.example",
		});

		const reload = await client.get("/signup/sent").withInertia();
		assert.containSubset(reload.inertiaProps, { purpose: "signup", email: null });
	});

	test("three signups an hour naming one address, from anywhere; a fourth is refused", async ({
		client,
		assert,
	}) => {
		queue.fake();
		for (const ip of ["203.0.113.161", "203.0.113.162", "203.0.113.163"]) {
			(await signup(client, form("busy@signup-18.example"), ip)).assertHeader(
				"location",
				"/signup/sent",
			);
		}

		const refused = await signup(
			client,
			form("Busy@Signup-18.example"),
			"203.0.113.164",
		);
		refused.assertHeader("location", "/signup");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		(
			await signup(client, form("other@signup-18.example"), "203.0.113.164")
		).assertHeader("location", "/signup/sent");
		assert.lengthOf(await User.query().where("email", "busy@signup-18.example"), 1);
	});

	test("a form error looks the same whether or not the address is taken", async ({
		client,
		assert,
	}) => {
		await User.create({ email: "taken@signup-18.example", password: PASSWORD });

		for (const [email, ip] of [
			["taken@signup-18.example", "203.0.113.150"],
			["free@signup-18.example", "203.0.113.151"],
		] as const) {
			const response = await signup(
				client,
				{ ...form(email), passwordConfirmation: "not-the-same" },
				ip,
			);
			response.assertHeader("location", "/signup");
			assertValidationError(response, "passwordConfirmation");
			assert.notProperty(response.flashMessage("inputErrorsBag") ?? {}, "email");
		}
		assert.isNull(await User.findBy("email", "free@signup-18.example"));
	});
});
```

In `apps/platform/tests/functional/tenancy/onboarding.spec.ts`, replace:

```ts
	test("signup lands on onboarding", async ({ client }) => {
```

with:

```ts
	test("signup lands on the check-your-email page, signed out (TAT-18)", async ({
		client,
	}) => {
```

and, in the same test, replace:

```ts
		response.assertStatus(302);
		response.assertHeader("location", "/onboarding");
	});

	test("login without a tenant also goes to /dashboard, which sends it to onboarding", async ({
```

with:

```ts
		response.assertStatus(302);
		response.assertHeader("location", "/signup/sent");
		response.assertSessionMissing("auth_web");
	});

	test("login without a tenant also goes to /dashboard, which sends it to onboarding", async ({
```

In `apps/platform/tests/functional/auth/rate_limits.spec.ts`, replace:

```ts
		const elsewhere = await signup("203.0.113.52", valid);
		elsewhere.assertHeader("location", "/onboarding");
```

with:

```ts
		const elsewhere = await signup("203.0.113.52", valid);
		elsewhere.assertHeader("location", "/signup/sent");
```

In `apps/platform/tests/functional/auth/page_history.spec.ts`, replace:

```ts
			["/forgot-password/sent", "auth/check_email"],
```

with:

```ts
			["/forgot-password/sent", "auth/check_email"],
			["/signup/sent", "auth/check_email"],
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=signup.spec.ts --files=onboarding.spec.ts --files=rate_limits.spec.ts --files=page_history.spec.ts`
Expected: the 5 new tests FAIL (signup still signs in and redirects to `/onboarding`; a taken address is a field error; `/signup/sent` is a 404), and so do the three edited assertions.

- [ ] **Step 3: The validator**

In `apps/platform/app/validators/user.ts`, replace:

```ts
 * The "passwordConfirmation" field is declared explicitly, so that it is part
 * of the request body type shared with the frontend. Otherwise the signup form
 * has no way to know about the errors reported for this field.
 */
export const signupValidator = vine.create({
	fullName: vine.string().nullable(),
	email: email().unique({ table: "users", column: "email" }),
	password: password(),
	passwordConfirmation: password().sameAs("password"),
});
```

with:

```ts
 * The "passwordConfirmation" field is declared explicitly, so that it is part
 * of the request body type shared with the frontend. Otherwise the signup form
 * has no way to know about the errors reported for this field.
 *
 * No unique rule on the email (TAT-18): the answer must never tell whether
 * an address has an account. AccountService.signUp handles a taken one.
 */
export const signupValidator = vine.create({
	fullName: vine.string().trim().maxLength(255).nullable(),
	email: accountEmail(),
	password: password(),
	passwordConfirmation: password().sameAs("password"),
});
```

- [ ] **Step 4: The controller**

Replace the whole of `apps/platform/app/controllers/new_account_controller.ts`, which today is:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import User from "#models/user";
import { signupValidator } from "#validators/user";

export default class NewAccountController {
	async create({ inertia }: HttpContext) {
		return inertia.render("auth/signup", {});
	}

	async store({ request, response, auth }: HttpContext) {
		const { fullName, email, password } =
			await request.validateUsing(signupValidator);
		const user = await User.create({ fullName, email, password });

		await auth.use("web").login(user);
		// A new account has no tenant yet.
		response.redirect().toRoute("onboarding.create");
	}
}
```

with:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { SENT_TO_FLASH } from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
import { signupValidator } from "#validators/user";

/**
 * Self-signup (TAT-18). The answer is the same for a new address and a taken
 * one: "Check your email", and nobody signed in. AccountService decides what
 * the email says.
 */
@inject()
export default class NewAccountController {
	constructor(private accounts: AccountService) {}

	async create({ inertia }: HttpContext) {
		return inertia.render("auth/signup", {});
	}

	async store({ request, response, session }: HttpContext) {
		const input = await request.validateUsing(signupValidator);
		await this.accounts.signUp(input);
		session.flash(SENT_TO_FLASH, input.email);
		return response.redirect().toRoute("new_account.sent");
	}

	async sent({ inertia, session }: HttpContext) {
		const email = session.flashMessages.get(SENT_TO_FLASH);
		return inertia.render("auth/check_email", {
			purpose: "signup",
			email: typeof email === "string" ? email : null,
		});
	}
}
```

- [ ] **Step 5: The routes**

In `apps/platform/start/routes.ts`, replace:

```ts
import {
	throttleAccountLinks,
	throttleResetEmail,
	throttleResetRequest,
	throttleSignup,
} from "#start/limiter";
```

with:

```ts
import {
	throttleAccountLinks,
	throttleResetEmail,
	throttleResetRequest,
	throttleSignup,
	throttleSignupEmail,
} from "#start/limiter";
```

and replace:

```ts
		router.get("signup", [controllers.NewAccount, "create"]);
		router
			.post("signup", [controllers.NewAccount, "store"])
			.use(throttleSignup);
```

with:

```ts
		router.get("signup", [controllers.NewAccount, "create"]);
		// Every signup counts per client address, then per address named
		// (TAT-8, TAT-18); a taken address gets the same answer as a new one.
		router
			.post("signup", [controllers.NewAccount, "store"])
			.use([throttleSignup, throttleSignupEmail]);
		router
			.get("signup/sent", [controllers.NewAccount, "sent"])
			.as("new_account.sent");
```

- [ ] **Step 6: The signup page and the guest layout's words**

In `apps/platform/inertia/pages/auth/signup.tsx`, replace:

```tsx
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
```

with:

```tsx
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
```

replace:

```tsx
				<p className="text-sm text-muted-foreground">
					Start building with the starter kit.
				</p>
```

with:

```tsx
				<p className="text-sm text-muted-foreground">
					Set up your studio in a few minutes.
				</p>
```

and replace:

```tsx
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="new-password"
								placeholder="••••••••"
								aria-invalid={!!errors.password}
							/>
							{errors.password && <FieldError>{errors.password}</FieldError>}
```

with:

```tsx
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="new-password"
								placeholder="••••••••"
								aria-invalid={!!errors.password}
								aria-describedby="password-rules"
							/>
							<FieldDescription id="password-rules">
								8 to 32 characters.
							</FieldDescription>
							{errors.password && <FieldError>{errors.password}</FieldError>}
```

In `apps/platform/inertia/layouts/auth.tsx`, replace:

```tsx
import ThemeToggle from "~/components/theme_toggle";
import { Button } from "~/components/ui/button";
```

with:

```tsx
import ThemeToggle from "~/components/theme_toggle";
```

and replace:

```tsx
					<p className="max-w-[22ch] font-serif text-2xl leading-snug text-balance">
						Auth, kept intentionally minimal so you can build it your way.
					</p>

					<div className="flex flex-col gap-2">
						<p className="text-sm font-medium">
							Looking for production-ready auth?
						</p>
						<p className="max-w-sm text-sm text-muted-foreground">
							Check out Feature packs, production-ready full-stack components
							from the creator of AdonisJS.
						</p>
						<Button asChild variant="link" className="self-start px-0">
							<a
								href="https://plus.adonisjs.com/feature-packs"
								target="_blank"
								rel="noreferrer"
							>
								Explore Feature packs →
							</a>
						</Button>
					</div>
```

with:

```tsx
					<p className="max-w-[22ch] font-serif text-2xl leading-snug text-balance">
						Inquiries, quotes and deposits for your studio, in one place.
					</p>

					<p className="max-w-sm text-sm text-muted-foreground">
						Tattoo Drip turns your booking link into complete inquiries, then
						helps you quote, take the deposit and book the session.
					</p>
```

These pages now hold reset and confirmation state, so the layout links nowhere else (spec ruling 25).

- [ ] **Step 7: Regenerate types, run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=signup.spec.ts --files=onboarding.spec.ts --files=rate_limits.spec.ts --files=page_history.spec.ts --files=public_limits.spec.ts --files=multipart.spec.ts`
Expected: PASS (5 new). Then `typecheck`: clean.

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/inertia apps/platform/.adonisjs apps/platform/tests/functional
git -C <repo> commit -m "feat(platform): answer every signup with a confirmation email, never 'already taken'" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Email confirmation, the gate and the banner

**Files:**
- Create: `apps/platform/app/middleware/verified_email_middleware.ts`, `apps/platform/app/controllers/email_verification_controller.ts`
- Modify: `apps/platform/start/kernel.ts`, `apps/platform/start/routes.ts`, `apps/platform/app/transformers/user_transformer.ts`, `apps/platform/inertia/layouts/app.tsx`
- Create: `apps/platform/inertia/pages/auth/verify_email.tsx`, `apps/platform/inertia/pages/auth/confirm_email.tsx`, `apps/platform/inertia/components/shell/verify_email_bar.tsx`
- Modify tests: `apps/platform/tests/functional/tenancy/onboarding.spec.ts` (`makeUser`), `apps/platform/tests/functional/auth/page_history.spec.ts` (`makeUser` and one test), `apps/platform/tests/functional/http/multipart.spec.ts` (three paths)
- Regenerated: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/identity/email_verification.spec.ts`, `apps/platform/tests/functional/identity/verified_email.spec.ts`, `apps/platform/tests/functional/identity/account_routes.spec.ts` (create)

**Interfaces:**
- Named middleware `verifiedEmail` (`middleware.verifiedEmail()`): after `auth`; an account whose address isn't confirmed is redirected to `email_verification.notice` for any method. TAT-33 adds it to its accept-invitation route and to `NEEDS_CONFIRMED_EMAIL` in `account_routes.spec.ts`.
- `EmailVerificationController`: `link`, `show`, `confirm`, `notice`, `resend`. `auth/verify_email` props: `{ state: "ready" | "done" | "expired" | "invalid"; email: string | null; forSignedInUser: boolean; signedInEmail: string | null; canResend: boolean }`; `auth/confirm_email`: `{ email: string }`.
- The shared `user` prop gains `emailVerified: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/email_verification.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	CONFIRMED_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { AUTH_LIMITS } from "#modules/identity/services/auth_limits";
import { digest } from "#services/rate_limits";
import {
	altered,
	expireToken,
	queuedMails,
	tokenOf,
} from "#tests/helpers/accounts";

const KEY = SESSION_TOKEN_KEYS.verify_email;
const REFUSED = "Invalid or expired CSRF token";
const tokens = new AccountTokenService();

function makeUser(email = "ink@verify-18.example") {
	return User.create({ email, password: "secret-password" });
}

const reload = (user: User) => User.findOrFail(user.id);

/** POST /verify-email with `token` in the session, as the link leaves it. */
function confirm(client: ApiClient, token: string | null) {
	return client
		.post("/verify-email")
		.withSession(token ? { [KEY]: token } : {})
		.withCsrfToken()
		.redirects(0);
}

/** "Send a new link", as the notice page and the banner post it. */
function resend(client: ApiClient, user: User) {
	return client
		.post("/confirm-email")
		.header("referer", "/confirm-email")
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

test.group("Email confirmation (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("the emailed link only moves its token into the session and opens the page without it", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const response = await client.get(`/verify-email/${token}`).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/verify-email");
		response.assertHeader("referrer-policy", "no-referrer");
		response.assertHeader("cache-control", "no-store");
		response.assertSession(KEY, token);
		assert.isNull((await reload(user)).emailVerifiedAt);
	});

	test("a malformed link is the router's 404", async ({ client }) => {
		(await client.get("/verify-email/short").redirects(0)).assertStatus(404);
		(
			await client.get(`/verify-email/${"a".repeat(42)}=`).redirects(0)
		).assertStatus(404);
	});

	test("the page shows what a live link confirms, never the token", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia();

		page.assertInertiaComponent("auth/verify_email");
		assert.containSubset(page.inertiaProps, {
			state: "ready",
			email: user.email,
			forSignedInUser: false,
			signedInEmail: null,
			canResend: false,
		});
		assert.notInclude(JSON.stringify(page.body()), token);
		page.assertHeader("cache-control", "no-store");
		page.assertHeader("referrer-policy", "same-origin");
	});

	test("confirming is a POST: it confirms the address once and signs nobody in; a replay finds a dead link", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const first = await confirm(client, token);
		first.assertHeader("location", "/verify-email");
		first.assertFlashMessage(CONFIRMED_FLASH, user.email);
		first.assertSessionMissing(KEY);
		first.assertSessionMissing("auth_web");
		const confirmedAt = (await reload(user)).emailVerifiedAt;
		assert.isNotNull(confirmedAt);

		const replay = await confirm(client, token);
		replay.assertFlashMissing(CONFIRMED_FLASH);
		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia();
		assert.equal(page.inertiaProps.state, "invalid");
		assert.equal(
			(await reload(user)).emailVerifiedAt?.toMillis(),
			confirmedAt?.toMillis(),
		);
	});

	test("after confirming, the page says so and offers the next step", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const guest = await client
			.get("/verify-email")
			.withFlashMessages({ [CONFIRMED_FLASH]: user.email })
			.withInertia();
		assert.containSubset(guest.inertiaProps, {
			state: "done",
			email: user.email,
			forSignedInUser: false,
			signedInEmail: null,
		});

		const owner = await client
			.get("/verify-email")
			.withFlashMessages({ [CONFIRMED_FLASH]: user.email })
			.withInertia()
			.loginAs(user);
		assert.containSubset(owner.inertiaProps, {
			state: "done",
			forSignedInUser: true,
			signedInEmail: user.email,
			canResend: false,
		});
	});

	test("an expired link confirms nothing, and the page offers a new one", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		await expireToken(user.id, "verify_email");

		(await confirm(client, token)).assertFlashMissing(CONFIRMED_FLASH);

		assert.isNull((await reload(user)).emailVerifiedAt);
		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia()
			.loginAs(user);
		assert.containSubset(page.inertiaProps, {
			state: "expired",
			canResend: true,
			signedInEmail: user.email,
		});
	});

	test("an altered link, a reset link or none confirms nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");

		for (const value of [altered(token), reset, null]) {
			(await confirm(client, value)).assertFlashMissing(CONFIRMED_FLASH);
			const page = await client
				.get("/verify-email")
				.withSession(value ? { [KEY]: value } : {})
				.withInertia();
			assert.equal(page.inertiaProps.state, "invalid");
		}

		assert.isNull((await reload(user)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "live");
	});

	test("a link confirms the account it was sent to, whoever is signed in", async ({
		client,
		assert,
	}) => {
		const owner = await makeUser("owner@verify-18.example");
		const other = await makeUser("other@verify-18.example");
		const token = await tokens.issue(owner, "verify_email");

		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia()
			.loginAs(other);
		assert.containSubset(page.inertiaProps, {
			state: "ready",
			email: owner.email,
			forSignedInUser: false,
			signedInEmail: other.email,
		});

		await client
			.post("/verify-email")
			.withSession({ [KEY]: token })
			.withCsrfToken()
			.loginAs(other)
			.redirects(0);

		assert.isNotNull((await reload(owner)).emailVerifiedAt);
		assert.isNull((await reload(other)).emailVerifiedAt);
	});

	test("a confirmation without this session's CSRF token is refused", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const response = await client
			.post("/verify-email")
			.withSession({ [KEY]: token })
			.redirects(0);

		response.assertFlashMessage("error", REFUSED);
		assert.isNull((await reload(user)).emailVerifiedAt);
	});

	test("an unconfirmed account's own page shows its address; a confirmed one goes on, a guest signs in", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const page = await client.get("/confirm-email").withInertia().loginAs(user);
		page.assertInertiaComponent("auth/confirm_email");
		assert.deepEqual(page.inertiaProps.email, user.email);

		user.emailVerifiedAt = DateTime.now();
		await user.save();
		(
			await client.get("/confirm-email").loginAs(await reload(user)).redirects(0)
		).assertHeader("location", "/dashboard");
		(await client.get("/confirm-email").redirects(0)).assertHeader(
			"location",
			"/login",
		);
	});

	test("'Send a new link' emails a link that replaces the old one", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const old = await tokens.issue(user, "verify_email");
		const fake = queue.fake();

		const response = await resend(client, user);

		response.assertHeader("location", "/confirm-email");
		response.assertFlashMessage(
			"success",
			`We sent a new link to ${user.email}.`,
		);
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Confirm your email address"]],
		);
		assert.equal(
			(await tokens.state(tokenOf(mails[0].data.url), "verify_email")).state,
			"live",
		);
		assert.equal((await tokens.state(old, "verify_email")).state, "unknown");
	});

	test("one new link a minute, and five an hour, per account", async ({
		client,
	}) => {
		const user = await makeUser();
		queue.fake();

		(await resend(client, user)).assertFlashMessage(
			"success",
			`We sent a new link to ${user.email}.`,
		);
		(await resend(client, user)).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 1 minute.",
		);

		await limiter.clear(["memory"]);
		await limiter
			.use({ ...AUTH_LIMITS.verifyResendPerUser })
			.increment(`verify_resend_${digest(user.id)}`, 5);
		(await resend(client, user)).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
	});

	test("a confirmed account gets no link", async ({ client, assert }) => {
		const user = await makeUser();
		user.emailVerifiedAt = DateTime.now();
		await user.save();
		const fake = queue.fake();

		(await resend(client, await reload(user))).assertHeader(
			"location",
			"/dashboard",
		);

		assert.lengthOf(queuedMails(fake), 0);
	});
});
```

Create `apps/platform/tests/functional/identity/verified_email.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { inUser, studioWithOwner } from "#tests/helpers/tenants";

const PASSWORD = "secret-password";

const studio = {
	name: "Gate Studio",
	type: "studio",
	slug: "gate-studio-18",
	timezone: "Asia/Kathmandu",
};

function createTenant(client: ApiClient, user: User) {
	return client
		.post("/onboarding")
		.form(studio)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

test.group("The confirmed-email gate (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an unconfirmed account can't open onboarding or create a tenant", async ({
		client,
		assert,
	}) => {
		const user = await User.create({
			email: "new@gate-18.example",
			password: PASSWORD,
		});

		(await client.get("/onboarding").loginAs(user).redirects(0)).assertHeader(
			"location",
			"/confirm-email",
		);
		(await createTenant(client, user)).assertHeader("location", "/confirm-email");

		assert.isFalse(
			await inUser(user, () => new TenancyService().hasTenant(user)),
		);
	});

	test("a confirmed account creates its tenant", async ({ client, assert }) => {
		const user = await User.create({
			email: "confirmed@gate-18.example",
			password: PASSWORD,
			emailVerifiedAt: DateTime.now(),
		});

		(await client.get("/onboarding").loginAs(user).redirects(0)).assertStatus(
			200,
		);
		(await createTenant(client, user)).assertHeader("location", "/dashboard");

		assert.isTrue(await inUser(user, () => new TenancyService().hasTenant(user)));
	});

	test("an unconfirmed member keeps every studio page, and the shared prop says so", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner("gate-studio-18", "Gate Studio");

		const inbox = await client
			.get("/t/gate-studio-18/inbox")
			.withInertia()
			.loginAs(owner);
		inbox.assertStatus(200);
		assert.isFalse(inbox.inertiaProps.user.emailVerified);

		owner.emailVerifiedAt = DateTime.now();
		await owner.save();
		const after = await client
			.get("/t/gate-studio-18/inbox")
			.withInertia()
			.loginAs(await User.findOrFail(owner.id));
		assert.isTrue(after.inertiaProps.user.emailVerified);
	});
});
```

Create `apps/platform/tests/functional/identity/account_routes.spec.ts`:

```ts
import router from "@adonisjs/core/services/router";
import { test } from "@japa/runner";

/**
 * Routes that create a tenant or accept an invitation: they need a
 * confirmed address (TAT-18). TAT-33 adds accepting an invitation here.
 */
const NEEDS_CONFIRMED_EMAIL = ["GET /onboarding", "POST /onboarding"];

/**
 * What each account form and link counts, in order. limiter.define names
 * its middleware `<name>Throttle` (start/limiter.ts).
 */
const THROTTLES: Record<string, string[]> = {
	"POST /signup": ["signupThrottle", "signup_emailThrottle"],
	"POST /forgot-password": ["reset_ipThrottle", "reset_emailThrottle"],
	"GET /reset-password/:token": ["account_linksThrottle"],
	"POST /reset-password": ["account_linksThrottle"],
	"GET /verify-email/:token": ["account_linksThrottle"],
	"POST /verify-email": ["account_linksThrottle"],
	"POST /confirm-email": ["verify_cooldownThrottle", "verify_resendThrottle"],
};

/** Where someone new may start: guest pages, which clear page history (TAT-82). */
const GUEST = [
	"GET /signup",
	"POST /signup",
	"GET /signup/sent",
	"GET /login",
	"POST /login",
	"GET /forgot-password",
	"POST /forgot-password",
	"GET /forgot-password/sent",
	"GET /reset-password/:token",
	"GET /reset-password",
	"POST /reset-password",
];

/** Open to guests and signed-in visitors alike (spec ruling 16). */
const OPEN = [
	"GET /verify-email/:token",
	"GET /verify-email",
	"POST /verify-email",
];

/** The route's own middleware names, in the order they run. */
function middlewareOf(key: string): string[] {
	const [method, pattern] = key.split(" ");
	const route = Object.values(router.toJSON())
		.flat()
		.find(
			(entry) => entry.pattern === pattern && entry.methods.includes(method),
		);
	if (!route) throw new Error(`No route ${key}`);
	return [...route.middleware.all()].map((entry) => entry.name);
}

test.group("Account routes (TAT-18)", () => {
	test("every route that creates a tenant or accepts an invitation runs verifiedEmail after auth", ({
		assert,
	}) => {
		for (const key of NEEDS_CONFIRMED_EMAIL) {
			const names = middlewareOf(key);
			assert.isAtLeast(names.indexOf("auth"), 0, key);
			assert.isAbove(names.indexOf("verifiedEmail"), names.indexOf("auth"), key);
		}
	});

	test("every account form and link counts its requests", ({ assert }) => {
		for (const [key, throttles] of Object.entries(THROTTLES)) {
			assert.deepEqual(
				middlewareOf(key).filter((name) => name.endsWith("Throttle")),
				throttles,
				key,
			);
		}
	});

	test("the pages where someone new may start are guest pages; the confirmation page isn't", ({
		assert,
	}) => {
		for (const key of GUEST) assert.include(middlewareOf(key), "guest", key);
		for (const key of OPEN) {
			const names = middlewareOf(key);
			assert.notInclude(names, "guest", key);
			assert.notInclude(names, "auth", key);
		}
		assert.include(middlewareOf("GET /confirm-email"), "auth");
	});
});
```

In `apps/platform/tests/functional/tenancy/onboarding.spec.ts`, replace:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
```

with:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
```

and replace:

```ts
function makeUser(email = "ink@example.com") {
	return User.create({ email, password: PASSWORD });
}
```

with:

```ts
/** Creating a tenant needs a confirmed address (TAT-18). */
function makeUser(email = "ink@example.com") {
	return User.create({
		email,
		password: PASSWORD,
		emailVerifiedAt: DateTime.now(),
	});
}
```

In `apps/platform/tests/functional/auth/page_history.spec.ts`, replace:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
```

with:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
```

replace:

```ts
function makeUser() {
	return User.create({ email: "ink@example.com", password: "secret-password" });
}
```

with:

```ts
/** A confirmed account: /onboarding is a signed-in page it may open (TAT-18). */
function makeUser() {
	return User.create({
		email: "ink@example.com",
		password: "secret-password",
		emailVerifiedAt: DateTime.now(),
	});
}
```

and replace:

```ts
	test("signed-in pages don't clear history", async ({ client, assert }) => {
```

with:

```ts
	test("the confirmation pages don't clear history: they sign nobody in or out", async ({
		client,
		assert,
	}) => {
		const user = await User.create({
			email: "new@history-18.example",
			password: "secret-password",
		});

		const verify = await client.get("/verify-email").withInertia();
		verify.assertInertiaComponent("auth/verify_email");
		assert.notProperty(verify.body(), "clearHistory");

		const notice = await client
			.get("/confirm-email")
			.withInertia()
			.loginAs(user);
		notice.assertInertiaComponent("auth/confirm_email");
		assert.notProperty(notice.body(), "clearHistory");
	});

	test("signed-in pages don't clear history", async ({ client, assert }) => {
```

In `apps/platform/tests/functional/http/multipart.spec.ts`, replace:

```ts
	for (const path of ["/login", "/signup"]) {
```

with:

```ts
	for (const path of [
		"/login",
		"/signup",
		"/forgot-password",
		"/reset-password",
		"/verify-email",
	]) {
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=email_verification.spec.ts --files=verified_email.spec.ts --files=account_routes.spec.ts --files=page_history.spec.ts --files=multipart.spec.ts --files=onboarding.spec.ts`
Expected: the new tests FAIL (`/verify-email…` and `/confirm-email` are 404s, onboarding is open to unconfirmed accounts, `user.emailVerified` is undefined, the route guard finds no route), and the `/verify-email` multipart case fails; the other tests pass.

- [ ] **Step 3: The gate**

Create `apps/platform/app/middleware/verified_email_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";

/**
 * The one gate for "needs a confirmed email address" (TAT-18): creating a
 * tenant now, accepting an invitation with TAT-33. Use it after auth. An
 * account whose address isn't confirmed goes to the page that asks for it,
 * whatever the method, and nothing it sent is used.
 */
export default class VerifiedEmailMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!ctx.auth.getUserOrFail().emailVerified) {
			return ctx.response.redirect().toRoute("email_verification.notice");
		}
		return next();
	}
}
```

In `apps/platform/start/kernel.ts`, replace:

```ts
	intakeGuard: () => import("#middleware/intake_guard_middleware"),
});
```

with:

```ts
	intakeGuard: () => import("#middleware/intake_guard_middleware"),
	verifiedEmail: () => import("#middleware/verified_email_middleware"),
});
```

- [ ] **Step 4: The controller**

Create `apps/platform/app/controllers/email_verification_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import {
	CONFIRMED_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";

const TOKEN_KEY = SESSION_TOKEN_KEYS.verify_email;

/**
 * Email confirmation (TAT-18). The emailed link's GET only moves its token
 * into the session and opens /verify-email, whose URL holds no token;
 * confirming is that page's POST, so a mail scanner that opens links
 * changes nothing. Open to guests and to whoever is signed in: the link
 * proves the mailbox and signs nobody in. /confirm-email is the signed-in
 * account's own page: where verifiedEmail sends it, and "Send a new link".
 */
@inject()
export default class EmailVerificationController {
	constructor(private accounts: AccountService) {}

	async link({ params, session, response }: HttpContext) {
		session.put(TOKEN_KEY, params.token);
		response.header("Referrer-Policy", "no-referrer");
		response.header("Cache-Control", "no-store");
		return response.redirect().toRoute("email_verification.show");
	}

	async show({ session, auth, inertia, response }: HttpContext) {
		response.header("Cache-Control", "no-store");
		response.header("Referrer-Policy", "same-origin");
		const viewer = auth.user;
		const signedIn = {
			signedInEmail: viewer?.email ?? null,
			canResend: Boolean(viewer && !viewer.emailVerified),
		};

		const confirmed = session.flashMessages.get(CONFIRMED_FLASH);
		if (typeof confirmed === "string") {
			return inertia.render("auth/verify_email", {
				state: "done",
				email: confirmed,
				forSignedInUser: viewer?.email === confirmed,
				...signedIn,
				canResend: false,
			});
		}

		const token = session.get(TOKEN_KEY);
		const found =
			typeof token === "string"
				? await this.accounts.tokenState(token, "verify_email")
				: { state: "unknown" as const };
		if (found.state === "live") {
			return inertia.render("auth/verify_email", {
				state: "ready",
				email: found.email,
				forSignedInUser: viewer?.id === found.userId,
				...signedIn,
			});
		}
		return inertia.render("auth/verify_email", {
			state: found.state === "expired" ? "expired" : "invalid",
			email: null,
			forSignedInUser: false,
			...signedIn,
		});
	}

	async confirm({ session, response }: HttpContext) {
		const token = session.get(TOKEN_KEY);
		const user =
			typeof token === "string"
				? await this.accounts.confirmEmail(token)
				: null;
		if (user) {
			session.forget(TOKEN_KEY);
			session.flash(CONFIRMED_FLASH, user.email);
		}
		return response.redirect().toRoute("email_verification.show");
	}

	async notice({ auth, inertia, response }: HttpContext) {
		const user = auth.getUserOrFail();
		if (user.emailVerified) return response.redirect().toRoute("dashboard");
		return inertia.render("auth/confirm_email", { email: user.email });
	}

	async resend({ auth, session, response }: HttpContext) {
		const user = auth.getUserOrFail();
		if (user.emailVerified) return response.redirect().toRoute("dashboard");
		await this.accounts.sendVerification(user);
		session.flash("success", `We sent a new link to ${user.email}.`);
		return response.redirect().back();
	}
}
```

- [ ] **Step 5: The routes**

In `apps/platform/start/routes.ts`, replace:

```ts
import {
	throttleAccountLinks,
	throttleResetEmail,
	throttleResetRequest,
	throttleSignup,
	throttleSignupEmail,
} from "#start/limiter";
```

with:

```ts
import {
	throttleAccountLinks,
	throttleResetEmail,
	throttleResetRequest,
	throttleSignup,
	throttleSignupEmail,
	throttleVerifyCooldown,
	throttleVerifyResend,
} from "#start/limiter";
```

and replace:

```ts
router
	.group(() => {
		router.get("dashboard", [controllers.Dashboard, "show"]).as("dashboard");
		router.post("logout", [controllers.Session, "destroy"]);

		router.get("onboarding", [controllers.Onboarding, "create"]);
		router.post("onboarding", [controllers.Onboarding, "store"]);
	})
	.use([middleware.auth(), middleware.dbContext()]);
```

with:

```ts
/**
 * Email confirmation links (TAT-18): open to guests and to whoever is signed
 * in (the link proves the mailbox and signs nobody in), so in no group. The
 * link's GET and the POST count per client address.
 */
router
	.get("verify-email/:token", [controllers.EmailVerification, "link"])
	.where("token", ACCOUNT_TOKEN)
	.use(throttleAccountLinks)
	.as("email_verification.link");
router
	.get("verify-email", [controllers.EmailVerification, "show"])
	.as("email_verification.show");
router
	.post("verify-email", [controllers.EmailVerification, "confirm"])
	.use(throttleAccountLinks)
	.as("email_verification.confirm");

router
	.group(() => {
		router.get("dashboard", [controllers.Dashboard, "show"]).as("dashboard");
		router.post("logout", [controllers.Session, "destroy"]);

		// The unconfirmed account's own page (TAT-18): where verifiedEmail
		// sends it, and "Send a new link" (one a minute, five an hour).
		router
			.get("confirm-email", [controllers.EmailVerification, "notice"])
			.as("email_verification.notice");
		router
			.post("confirm-email", [controllers.EmailVerification, "resend"])
			.use([throttleVerifyCooldown, throttleVerifyResend])
			.as("email_verification.resend");

		// Creating a tenant needs a confirmed address (TAT-18).
		router
			.get("onboarding", [controllers.Onboarding, "create"])
			.use(middleware.verifiedEmail());
		router
			.post("onboarding", [controllers.Onboarding, "store"])
			.use(middleware.verifiedEmail());
	})
	.use([middleware.auth(), middleware.dbContext()]);
```

- [ ] **Step 6: The shared prop, the pages and the banner**

In `apps/platform/app/transformers/user_transformer.ts`, replace:

```ts
			"fullName",
			"email",
			"createdAt",
```

with:

```ts
			"fullName",
			"email",
			"emailVerified",
			"createdAt",
```

Create `apps/platform/inertia/pages/auth/verify_email.tsx`:

```tsx
import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/layouts/auth";

type State = "ready" | "done" | "expired" | "invalid";

type Props = {
	state: State;
	email: string | null;
	forSignedInUser: boolean;
	signedInEmail: string | null;
	canResend: boolean;
};

const TITLES: Record<State, string> = {
	ready: "Confirm your email address",
	done: "Email address confirmed",
	expired: "This link has expired",
	invalid: "This link no longer works",
};

function Address({ value }: { value: string }) {
	return (
		<strong className="font-medium break-all text-foreground">{value}</strong>
	);
}

function lead(state: State, email: string | null): ReactNode {
	if (state === "ready" && email) {
		return (
			<>
				Confirm <Address value={email} /> as the email address of your Tattoo
				Drip account.
			</>
		);
	}
	if (state === "done" && email) {
		return (
			<>
				Thanks: <Address value={email} /> is confirmed.
			</>
		);
	}
	if (state === "expired") return "Confirmation links work for 24 hours.";
	return "It was already used, or a newer link replaced it.";
}

/**
 * The page a confirmation link opens (TAT-18). The token stays in the
 * session; this page's URL never holds it. Confirming is this form's POST,
 * and it signs nobody in.
 */
export default function VerifyEmail({
	state,
	email,
	forSignedInUser,
	signedInEmail,
	canResend,
}: Props) {
	return (
		<>
			<Head title={TITLES[state]} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{TITLES[state]}
				</h1>
				<p className="text-sm text-muted-foreground">{lead(state, email)}</p>
			</div>

			{state === "ready" && signedInEmail && !forSignedInUser && (
				<p className="text-sm text-muted-foreground">
					You're signed in as <Address value={signedInEmail} />. Confirming
					changes nothing for that account.
				</p>
			)}

			{state === "ready" ? (
				<Form route="email_verification.confirm">
					{({ processing }) => (
						<Button type="submit" className="h-11 w-full" disabled={processing}>
							{processing ? "Confirming…" : "Confirm email"}
						</Button>
					)}
				</Form>
			) : (
				<NextStep
					done={state === "done"}
					signedIn={Boolean(signedInEmail)}
					canResend={canResend}
				/>
			)}
		</>
	);
}

function NextStep({
	done,
	signedIn,
	canResend,
}: {
	done: boolean;
	signedIn: boolean;
	canResend: boolean;
}) {
	if (canResend) {
		return (
			<Form route="email_verification.resend">
				{({ processing }) => (
					<Button type="submit" className="h-11 w-full" disabled={processing}>
						{processing ? "Sending…" : "Send a new link"}
					</Button>
				)}
			</Form>
		);
	}
	if (signedIn) {
		return (
			<Button asChild className="h-11 w-full">
				<Link route="dashboard">Continue</Link>
			</Button>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">
				{done ? "Sign in to set up your studio." : "Sign in to send a new link."}
			</p>
			<Button asChild className="h-11 w-full">
				<Link route="session.create">Sign in</Link>
			</Button>
		</div>
	);
}

VerifyEmail.layout = [AuthLayout];
```

Create `apps/platform/inertia/pages/auth/confirm_email.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/layouts/auth";

/**
 * Where an unconfirmed account goes when it tries to create a tenant
 * (TAT-18, the verifiedEmail gate): its address, "Send a new link", and a
 * way out when the address is wrong.
 */
export default function ConfirmEmail({ email }: { email: string }) {
	return (
		<>
			<Head title="Confirm your email address" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Confirm your email address
				</h1>
				<p className="text-sm text-muted-foreground">
					We sent a link to{" "}
					<strong className="font-medium break-all text-foreground">
						{email}
					</strong>
					. Open it to confirm your address, then you can set up your studio.
				</p>
			</div>

			<p className="text-sm text-muted-foreground">
				The link works for 24 hours. Nothing there? Check your spam folder, or
				send a new link.
			</p>

			<Form route="email_verification.resend">
				{({ processing }) => (
					<Button type="submit" className="h-11 w-full" disabled={processing}>
						{processing ? "Sending…" : "Send a new link"}
					</Button>
				)}
			</Form>

			<div className="flex flex-col gap-2 border-t pt-4">
				<p className="text-sm text-muted-foreground">
					Wrong address? Sign out, then create the account again with the
					right one.
				</p>
				<Form route="session.destroy">
					<Button type="submit" variant="outline" className="h-11 w-full">
						Sign out
					</Button>
				</Form>
			</div>
		</>
	);
}

ConfirmEmail.layout = [AuthLayout];
```

Create `apps/platform/inertia/components/shell/verify_email_bar.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { Button } from "~/components/ui/button";

/**
 * Under the top bar while the signed-in account's address isn't confirmed
 * (TAT-18). Nothing on a studio page is blocked; it only asks, with "Send a
 * new link".
 */
export default function VerifyEmailBar() {
	const { user } = usePage().props;
	if (!user || user.emailVerified) return null;

	return (
		<section
			aria-label="Email confirmation"
			className="flex flex-wrap items-center justify-center gap-x-3 border-b bg-muted px-4 text-sm"
		>
			<p className="py-2">
				Confirm your email address: we sent a link to{" "}
				<strong className="font-medium break-all">{user.email}</strong>.
			</p>
			<Form route="email_verification.resend">
				{({ processing }) => (
					<Button
						type="submit"
						variant="link"
						className="h-11 px-0"
						disabled={processing}
					>
						{processing ? "Sending…" : "Send a new link"}
					</Button>
				)}
			</Form>
		</section>
	);
}
```

In `apps/platform/inertia/layouts/app.tsx`, replace:

```tsx
import TopBar from "~/components/shell/top_bar";
```

with:

```tsx
import TopBar from "~/components/shell/top_bar";
import VerifyEmailBar from "~/components/shell/verify_email_bar";
```

and replace:

```tsx
				<TopBar />
				<OfflineBar />
```

with:

```tsx
				<TopBar />
				<OfflineBar />
				<VerifyEmailBar />
```

- [ ] **Step 7: Regenerate types, run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=email_verification.spec.ts --files=verified_email.spec.ts --files=account_routes.spec.ts --files=page_history.spec.ts --files=multipart.spec.ts --files=onboarding.spec.ts --files=tenant_routes.spec.ts --files=access.spec.ts --files=sessions.spec.ts`
Expected: PASS (13 + 3 + 3 new, 1 new in `page_history.spec.ts`, 3 new multipart cases). Then `typecheck`: clean.

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app apps/platform/start apps/platform/inertia apps/platform/.adonisjs apps/platform/tests/functional
git -C <repo> commit -m "feat(platform): confirm email addresses and require one to create a studio" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 10: The operator's `account:verify`

**Files:**
- Create: `apps/platform/commands/verify_account.ts`
- Test: `apps/platform/tests/functional/identity/verify_account_command.spec.ts` (create)

**Interfaces:**
- `node ace account:verify <email>` (`node build/ace.js account:verify <email>` in production): `AccountService.markVerified`. Logs `Confirmed. The account can now set up a studio.`, `That address is already confirmed.` or, with exit code 1, `No account uses that address.`. Prints no token, id or link. Ace loads app commands from `commands/` itself; nothing registers it.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/identity/verify_account_command.spec.ts`:

```ts
import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import AccountTokenService from "#modules/identity/services/account_token_service";
// No #commands alias exists (and package.json stays as it is), so the
// command is imported by path.
import VerifyAccount from "../../../commands/verify_account.js";

const tokens = new AccountTokenService();

test.group("account:verify (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		ace.ui.switchMode("raw");
		return () => ace.ui.switchMode("normal");
	});

	test("confirms an account's address and kills its confirmation link", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "pilot@command-18.example",
			password: "secret-password",
		});
		const token = await tokens.issue(user, "verify_email");

		const command = await ace.create(VerifyAccount, [
			" Pilot@Command-18.example ",
		]);
		await command.exec();

		command.assertSucceeded();
		command.assertLogMatches(/Confirmed\. The account can now set up a studio\./);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "unknown");
	});

	test("says so when the address is already confirmed", async ({ assert }) => {
		const user = await User.create({
			email: "done@command-18.example",
			password: "secret-password",
		});
		await (await ace.create(VerifyAccount, [user.email])).exec();

		const again = await ace.create(VerifyAccount, [user.email]);
		await again.exec();

		again.assertSucceeded();
		again.assertLogMatches(/That address is already confirmed\./);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
	});

	test("fails for an address no account uses", async () => {
		const command = await ace.create(VerifyAccount, [
			"nobody@command-18.example",
		]);
		await command.exec();

		command.assertFailed();
		command.assertLogMatches(/No account uses that address\./);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=verify_account_command.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 and "Cannot find module" for `commands/verify_account.js` in the log.

- [ ] **Step 3: The command**

Create `apps/platform/commands/verify_account.ts`:

```ts
import { args, BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";

/**
 * Confirms an account's email address without a link (TAT-18): the
 * operator's way to let a pilot studio in while the platform can't send
 * email yet (TAT-20). It skips the proof the link gives, so check who is
 * asking some other way first. Prints no token, id or link.
 *
 *   node ace account:verify owner@example.com           (development)
 *   node build/ace.js account:verify owner@example.com  (production)
 */
export default class VerifyAccount extends BaseCommand {
	static commandName = "account:verify";
	static description =
		"Mark an account's email address as confirmed, after checking the person yourself";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The account's email address" })
	declare email: string;

	async run() {
		// Imported once the app has started: models need a booted app.
		const { default: AccountService } = await import(
			"#modules/identity/services/account_service"
		);
		const accounts = await this.app.container.make(AccountService);
		const result = await accounts.markVerified(this.email);
		if (result === "unknown") {
			this.logger.error("No account uses that address.");
			this.exitCode = 1;
			return;
		}
		if (result === "already") {
			this.logger.info("That address is already confirmed.");
			return;
		}
		this.logger.success("Confirmed. The account can now set up a studio.");
	}
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=verify_account_command.spec.ts`
Expected: PASS, 3 tests. Then `typecheck`: clean, and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace list | grep "account:verify"` prints the command with its description.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/commands apps/platform/tests/functional/identity/verify_account_command.spec.ts
git -C <repo> commit -m "feat(platform): let an operator confirm an account's email with account:verify" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/jobs-and-email.md`, `apps/platform/docs/testing.md`, `apps/platform/docs/ui.md`, `apps/platform/docs/deploy.md`, `apps/platform/database/README.md`, `apps/platform/.env.example`
- Modify: `docs/requirements.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/README.md`, `README.md`

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`:

- In the Tenancy bullet, replace "New users create their first tenant at `/onboarding` (only while they have none: one tenant per account for now). Login, signup and onboarding land on `/dashboard`," with "New users create their first tenant at `/onboarding` (only while they have none: one tenant per account for now), once their email address is confirmed (`middleware.verifiedEmail()`, see [Accounts](#accounts)). Login and onboarding land on `/dashboard`,".
- In the Page history bullet, replace "the guest middleware (the `guest` route group: login, signup) calls" with "the guest middleware (the `guest` route group: login, signup and the password reset pages) calls", and replace "A new page where someone new may start (password reset, invitations) goes in the `guest` group, and a flow that signs a user in without passing through a guest page must clear history on the first page it renders." with "A new page where someone new may start (invitations) goes in the `guest` group, and a flow that signs a user in without passing through a guest page must clear history on the first page it renders. A signed-in visitor of a guest page goes to `/dashboard`. The email confirmation page (`/verify-email`) is outside the group on purpose: its usual visitor is signed in, and it signs nobody in or out (TAT-18)."
- In the first Rate limits bullet, replace "Signup: 10 requests per address per hour (the `throttleSignup` middleware from `start/limiter.ts`)." with "Signup: 10 requests per address per hour (the `throttleSignup` middleware from `start/limiter.ts`), then 3 per email address named per hour (`throttleSignupEmail`, TAT-18)." and replace "failures already counted for the email stay, because look-alike accounts (`users.email` is case-sensitive) share one count and one account's sign-in must not wipe another's." with "failures already counted for the email stay (a sign-in proves the password, not who made the earlier guesses; since TAT-18 emails are canonical, so look-alike accounts no longer exist)."
- In the third Rate limits bullet, replace "Adding a limit (password reset, TAT-18): put its numbers in `AUTH_LIMITS`, then use either a `limiter.define` middleware in `start/limiter.ts` (counts every request; a reset request must count unknown emails too) or a wrapper like `throttleLogin` (counts failures)." with "Adding a limit: put its numbers in `AUTH_LIMITS`, then use either a `limiter.define` middleware in `start/limiter.ts` (counts every request, unknown emails too; `perAddress`, `perEmail` and `perAccount` build the keys) or a wrapper like `throttleLogin` (counts failures). TAT-18's: 3 reset requests per email address and 10 per client address an hour, 30 opens or uses of an account link per client address per 15 minutes, and one new confirmation link a minute and five an hour per account. A completed reset clears the login failures of the account's stored address (`clearLoginFailures`)."
- Before the `## Phone numbers` heading, add:

```markdown
## Accounts

- Email addresses (TAT-18): `canonicalEmail` (`#modules/identity/email_address`) is the one form an address is stored and looked up in: trimmed, ASCII letters in lower case, nothing else (dots, `+tags` and other scripts stay). The `accountEmail()` rule in `#validators/user` applies it to signup, login and the reset request, the `User` model's `beforeSave` hook to every write, and the `users_email_canonical` check to the table, so `users_email_unique` means one account per address whatever its case. Never use Vine's `normalizeEmail()` for accounts.
- Account links (TAT-18): `AccountTokenService` (`#modules/identity/services/account_token_service`) owns `account_tokens`: one live token per account and purpose (`verify_email` for 24 hours, `reset_password` for 60 minutes), stored as its SHA-256 only, bound to the address it was sent to, replaced by the next one and deleted when used (`consume`, one `delete … returning`). The emailed link (`/verify-email/<token>`, `/reset-password/<token>`) only puts the token in the session (`SESSION_TOKEN_KEYS`) and redirects to a page without it (`Referrer-Policy: no-referrer`, `Cache-Control: no-store`); the change is that page's POST, so a mail scanner that opens links changes nothing. Never put a token in a page's URL, its props or a log.
- `AccountService` (`#modules/identity/services/account_service`) has the flows. `signUp` never says whether an address has an account: a new one gets an unconfirmed account and a confirmation email, a taken one an "already have an account" email with a reset link, and nobody is signed in. `requestPasswordReset` emails only an address an account uses; the page says the same either way. `resetPassword` sets the password (signup's rule), raises `session_version`, confirms the address, emails a notice and clears the stored address's login failures after the commit; it signs nobody in. `confirmEmail` confirms the account the link was sent to, whoever is signed in. Account emails print nothing the signup form took (no name).
- Sessions (TAT-18): the session stores `<user id>.<session version>` (`SessionVersionUserProvider` in `#modules/identity/session_user_provider`, used by `config/auth.ts`), and a session whose version isn't the account's is signed out on its next request. Anything that should end every session of an account (a password change, a later "sign out everywhere") raises `users.session_version`.
- The confirmed-email gate (TAT-18): `middleware.verifiedEmail()`, after `auth`, sends an account whose address isn't confirmed to `/confirm-email`. It guards `/onboarding`; TAT-33's accept-invitation route uses it too, and `tests/functional/identity/account_routes.spec.ts` lists the gated routes. Unconfirmed accounts keep every page of the tenants they already belong to; `TenancyService.createTenant` itself isn't gated. The shared `user` prop has `emailVerified` (the confirmation bar).
- Operator confirmation: `node ace account:verify <email>` (`node build/ace.js …` in production) confirms an existing account's address without a link, after you checked the person yourself; it prints no token, id or link. It is the pilot's way in until the sending domain exists ([deploy](deploy.md#account-email)).
```

- [ ] **Step 2: Jobs and email, testing, UI**

In `apps/platform/docs/jobs-and-email.md`, after the bullet that starts "- New-inquiry alerts (TAT-51, TAT-52):", add:

```markdown
- Account emails (TAT-18): `VerifyEmailMail`, `AccountExistsMail`, `ResetPasswordMail` and `PasswordChangedMail` (`#modules/identity/emails/`) take plain data (`to` and the links), print no name, and are queued by `AccountService` with `sendMailInTransaction`. `ALERT_EMAILS` doesn't apply to them: an account can't be confirmed or recovered without them. Their links work like passwords, which is why `SendMailJob` keeps failed rows one day; a failed send leaves the account as it was, and the person asks for a new link.
```

In `apps/platform/docs/testing.md`, after the paragraph that starts "Staff alert emails (TAT-52) are on in tests:", add:

```markdown
Accounts (TAT-18): `User.create` leaves the address unconfirmed (like the accounts from before TAT-18); a test that opens or posts `/onboarding` creates its user with `emailVerifiedAt: DateTime.now()`. The session's `auth_web` holds `<user id>.<session version>`, which `loginAs(user)` writes from the instance you pass: an instance loaded before the version changed is a signed-out session (the reset's sign-out is tested that way), and a user built without the column fails with "its session version is missing". `#tests/helpers/accounts` reads the emails a faked queue holds (`queuedMails`), the token in a link (`tokenOf`), expires a token (`expireToken`) and alters one (`altered`). Put a link's token in a request with `.withSession({ [SESSION_TOKEN_KEYS.reset_password]: token })`, as the link's GET leaves it. The link routes count 30 requests per client address per 15 minutes and the reset request 3 per address named: a test that sends more gives them distinct `x-forwarded-for` values or addresses.
```

In `apps/platform/docs/ui.md`:

- At the end of the App shell's first bullet (it ends "a row above the account menu in the sidebar."), add: " The email confirmation bar (`inertia/components/shell/verify_email_bar.tsx`, TAT-18) shows under the top bar while the signed-in account's address isn't confirmed (the shared `user.emailVerified`), with \"Send a new link\"."
- At the end of "## Components, forms and theme", add:

```markdown
- Guest pages (`AuthLayout`, TAT-18): login, signup, the password reset pages, "Check your email", the confirmation page and the confirm-email notice. Give each its own `<Head title>`, 44 px buttons and inputs, and no third-party link: these pages hold reset and confirmation state.
```

- [ ] **Step 3: Deploy, database, env example**

In `apps/platform/docs/deploy.md`:

- Before the `### Storefront settings (Vercel, TAT-13)` heading, add:

```markdown
### Account email

- Signup, email confirmation and password reset (TAT-18) need working mail: `MAIL_FROM_ADDRESS` on the platform's sending domain with SPF, DKIM and DMARC (TAT-20), `SMTP_*` a provider allowed to send for it, `APP_URL` the dashboard's public https origin (the links point there), and a running worker. `ALERT_EMAILS=false` doesn't stop these emails.
- Until mail reaches inboxes, a new account can sign in but can't create a studio. Confirm a pilot's account by hand with `node build/ace.js account:verify <email>` once you have checked who is asking (in person or by phone: it skips the proof the link gives). It prints no token, id or link.
- A send that fails retries 3 times, then logs one "Sending email failed." line with the recipient and the subject, never the link. The account is untouched; the person asks for a new link ("Send a new link", or a new reset request).
- Every signed-in session signs out once after this release: sessions now carry the account's session version.
```

- Under "### Reverse proxy", after the bullet that starts "- No access log for the deposit paths,", add: "- No access log for the account links either: `GET /reset-password/<token>` and `GET /verify-email/<token>` carry a single-use token for up to an hour or a day. In nginx: `location ~ ^/(reset-password|verify-email)/ { access_log off; ... }` with the same `proxy_pass` and headers as the dashboard's. The pages they open have no token in their URL."
- Under "### After the first deploy", add: "- Sign up with an address you own: \"Confirm your email address\" arrives (spam folder included), its link opens the confirmation page, and confirming lets you set up a studio. \"Forgot your password?\" sends \"Choose a new password\"; finishing the reset signs out your other browser."

In `apps/platform/database/README.md`:

- After the bullet that starts "- **Exception: `rate_limits`.**", add:

```markdown
- **Exception: `account_tokens`** (TAT-18) isn't tenant-owned and has no row-level security, like `users`: a confirmation or reset link is read before any context exists. It holds SHA-256 digests of single-use tokens, one per account and purpose, deleted when used and by `on delete cascade` with the account.
- **Canonical emails (TAT-18).** `users_email_canonical` keeps every address trimmed, with its ASCII letters in lower case (`translate()`, never `lower()`, so the database's locale doesn't matter): the rule of `canonicalEmail` in `#modules/identity/email_address`. Migration `1791680000000` rewrote existing addresses and refuses to apply while two accounts would end up with one address. To resolve it, list them as the owner role with `select id, email, created_at from users where translate(btrim(email), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') in (select translate(btrim(email), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') from users group by 1 having count(*) > 1) order by email, created_at;`, decide with the people concerned which account keeps each address, give each other account an address of its own (for example `update users set email = 'duplicate-<id>@invalid' where id = '<id>'`: `.invalid` never receives mail), then migrate again. Never merge or delete the rows.
```

- In the soft-delete bullet, replace "staff alerts (ids only, kept read or unread), and queue tables." with "staff alerts (ids only, kept read or unread), account tokens (single-use credentials, deleted when used), and queue tables."

In `apps/platform/.env.example`, after the line `# ALERT_EMAILS=false`, add:

```
# Account emails (TAT-18: confirmation links, password reset) always send:
# ALERT_EMAILS doesn't switch them off. In production they need SMTP_* and a
# MAIL_FROM_ADDRESS on a working sending domain; until then confirm a pilot's
# account by hand with `node build/ace.js account:verify <email>`.
```

- [ ] **Step 4: Requirements, architecture, data model, indexes**

In `docs/requirements.md`, replace:

```markdown
- [ ] Sign up with email and password, verify the email, log in and out, reset the password
- [ ] Create a `studio` or `independent` tenant (needs a verified email), with a unique slug that is also its subdomain
```

with:

```markdown
- [x] Sign up with email and password, verify the email, log in and out, reset the password
- Signup always answers "Check your email": a new address gets a confirmation link (24 hours), a registered one an email saying it already has an account; the page never tells which. Email addresses are case-insensitive. A reset link works once, for an hour, signs every device out and emails the account that its password changed; asking for one never tells whether an address has an account.
- [x] Create a `studio` or `independent` tenant (needs a verified email), with a unique slug that is also its subdomain
- Accounts that existed before email confirmation keep every studio they belong to; any account confirms its address before it creates a tenant (or, with invitations, joins one).
```

In `docs/architecture.md`, replace "- Auth uses AdonisJS's session guard: email and password, email verification, password reset and rate-limited login." with "- Auth uses AdonisJS's session guard with email and password. The session holds the account's session version as well as its id, so a password reset signs out every session although production keeps sessions in cookies. Email confirmation and password reset use single-use links (a token stored only as its SHA-256, one per account and purpose); creating a tenant or accepting an invitation needs a confirmed address. Login, signup, password reset and the links are rate-limited, and neither signup nor a reset request reveals whether an address has an account (TAT-18)."

In `docs/data-model.md`:

- In the mermaid diagram, after `  User ||--o{ TenantMembership : has`, add `  User ||--o{ AccountToken : has`.
- Replace `| **User** | A person who can log in, with a verified email |` with:

```markdown
| **User** | A person who can log in: a canonical email address (trimmed, ASCII letters in lower case, so unique whatever its case), when that address was confirmed (needed to create a tenant or accept an invitation), and a session version that a password reset raises to sign out every session |
| **AccountToken** | A single-use link for one account: confirm its email address (24 hours) or choose a new password (60 minutes). Only the token's SHA-256 is stored, with the address it was sent to; one per account and purpose, replaced by the next, deleted when used |
```

In `docs/README.md`, replace "| Platform services, controllers, tenancy, public API, database conventions |" with "| Platform services, controllers, tenancy, accounts, public API, database conventions |", and "| Deploying the platform, production settings, the public API checklist, dashboard cookies and domains |" with "| Deploying the platform, production settings, the public API checklist, account email, dashboard cookies and domains |".

In `README.md`, under "## Deployment", after the bullet that starts "- **Platform settings in production:**", add: "- **Account email:** signup, email confirmation and password reset (TAT-18) need working SMTP in production (`MAIL_FROM_ADDRESS` on a sending domain with SPF, DKIM and DMARC, TAT-20). Until then, confirm a pilot's account with `node build/ace.js account:verify <email>`: see the [account email checklist](apps/platform/docs/deploy.md#account-email)."

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/docs apps/platform/database/README.md apps/platform/.env.example docs/requirements.md docs/architecture.md docs/data-model.md docs/README.md README.md
git -C <repo> commit -m "docs(platform): document accounts, email confirmation and password reset" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification

- [ ] **Step 1: Generated files are current**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> status --short`
Expected: no changes (Tasks 7, 8 and 9 committed `.adonisjs/`). If `.adonisjs/` changed, commit it as `chore(platform): regenerate types` with the trailer.

- [ ] **Step 2: Root gates**

From the repo root: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> typecheck`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> build`.
Expected: all clean. If `pnpm check` fails with "nested root configuration" because of another agent's `.claude/worktrees/*` checkout, run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check apps packages` instead and say so. After the build, `ls <repo>/apps/platform/build/commands/verify_account.js` exists (the production `account:verify`).

- [ ] **Step 3: Full suite**

Run in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/full.log 2>&1` and wait for the notification.
Expected: all pass, 87 more than Task 0's baseline (Task 1: 12; Task 2: 7; Task 3: 4; Task 4: 6 + 4 + 3 − 5 (the rewritten `verify_email_mail.spec.ts` has 3 tests instead of 5) = 8; Task 5: 2; Task 6: 9; Task 7: 14; Task 8: 5; Task 9: 13 + 3 + 3 + 1 + 3 multipart cases = 23; Task 10: 3). Report the exact count from the log's `Tests` line. No file under `apps/storefront` or `packages/` changes, so their tests needn't run.

- [ ] **Step 4: What changed, and a clean tree**

Run: `git -C <repo> log --format=%h -1 -- docs/superpowers/plans/2026-10-19-tat-18-email-verification-and-password-reset.md` (the design commit), then `git -C <repo> diff <that hash> --stat -- apps/platform/database` (expected: the three migrations, `schema.ts` and `README.md`), `git -C <repo> diff <that hash> --stat -- apps/storefront packages apps/platform/package.json pnpm-lock.yaml` (expected: empty) and `git -C <repo> status -sb` (expected: clean). `git -C <repo> log --oneline -12` lists the design commit and Tasks 1 to 11.

---

### Task 13: Browser pass

Do it after the reviews, at 375 px and 1280 px, light and dark. Mailpit isn't installed and nothing may be installed or downloaded: the worker sends to the throwaway sink below, which relays nothing, so no mail can leave the machine.

- [ ] **Step 1: The sink**

Create `<scratchpad>/t18-pass/smtp-sink.mjs` (TAT-52's sink):

```js
// A throwaway SMTP sink for the TAT-18 browser pass: listens on 127.0.0.1:1025,
// answers just enough SMTP for nodemailer and appends every message to
// mails.jsonl next to this file. Nothing is ever relayed.
import fs from "node:fs";
import net from "node:net";

const OUT = new URL("./mails.jsonl", import.meta.url).pathname;
const server = net.createServer((socket) => {
	let buffer = "";
	let data = null;
	let envelope = { from: null, to: [] };
	socket.setEncoding("utf8");
	socket.write("220 sink ESMTP\r\n");
	socket.on("data", (chunk) => {
		buffer += chunk;
		for (;;) {
			if (data !== null) {
				const end = buffer.indexOf("\r\n.\r\n");
				if (end === -1) return;
				data = buffer.slice(0, end);
				buffer = buffer.slice(end + 5);
				fs.appendFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), envelope, raw: data })}\n`);
				data = null;
				envelope = { from: null, to: [] };
				socket.write("250 OK queued\r\n");
				continue;
			}
			const eol = buffer.indexOf("\r\n");
			if (eol === -1) return;
			const line = buffer.slice(0, eol);
			buffer = buffer.slice(eol + 2);
			const cmd = line.slice(0, 4).toUpperCase();
			if (cmd === "EHLO" || cmd === "HELO") socket.write("250-sink\r\n250 8BITMIME\r\n");
			else if (cmd === "MAIL") { envelope.from = line.slice(10); socket.write("250 OK\r\n"); }
			else if (cmd === "RCPT") { envelope.to.push(line.slice(8)); socket.write("250 OK\r\n"); }
			else if (cmd === "DATA") { data = ""; socket.write("354 go ahead\r\n"); }
			else if (cmd === "QUIT") { socket.write("221 bye\r\n"); socket.end(); return; }
			else socket.write("250 OK\r\n");
		}
	});
	socket.on("error", () => {});
});
server.listen(1025, "127.0.0.1", () => console.log("sink on 127.0.0.1:1025"));
```

And `<scratchpad>/t18-pass/readmail.mjs`, which prints the last email's recipient, subject, text part and links (`node readmail.mjs` for the last one, `node readmail.mjs 2` for the third):

```js
import fs from "node:fs";

const file = new URL("./mails.jsonl", import.meta.url).pathname;
const mails = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const which = Number(process.argv[2] ?? mails.length - 1);
const { envelope, raw } = mails[which];
const [head, ...rest] = raw.split("\r\n\r\n");
const body = rest.join("\r\n\r\n");
const headers = head.replace(/\r\n[ \t]+/g, " ");
const qp = (s) => s.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
console.log("count:", mails.length, "showing:", which, "to:", envelope.to.join(", "));
console.log("Subject:", (headers.match(/^Subject: (.*)$/im) ?? [])[1]);
const boundary = (headers.match(/boundary="?([^";\r\n]+)"?/i) ?? [])[1];
for (const part of boundary ? body.split(`--${boundary}`).slice(1, -1) : [body]) {
	const [partHead, ...partBody] = part.replace(/^\r\n/, "").split("\r\n\r\n");
	const type = (partHead.match(/Content-Type: ([^;\r\n]+)/i) ?? [])[1];
	const encoding = (partHead.match(/Content-Transfer-Encoding: (\S+)/i) ?? [])[1] ?? "";
	let text = partBody.join("\r\n\r\n");
	if (encoding === "base64") text = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
	else if (/quoted-printable/i.test(encoding)) text = Buffer.from(qp(text), "latin1").toString("utf8");
	if (type === "text/plain") console.log(`--- text\n${text.trim()}`);
	else console.log("--- links:", [...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(" | "));
}
```

- [ ] **Step 2: Start the sink, the dev server and the worker on this checkout**

Unset `ALERT_EMAILS`, `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS` and `TRUST_PROXY` in the shell first. Then, each with `run_in_background`:

```
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node <scratchpad>/t18-pass/smtp-sink.mjs
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH HOST=127.0.0.1 PORT=3401 APP_URL=http://127.0.0.1:3401 TURNSTILE_SECRET_KEY= pnpm -C <repo>/apps/platform dev
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH APP_URL=http://127.0.0.1:3401 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_USERNAME= SMTP_PASSWORD= pnpm -C <repo>/apps/platform worker
```

The command line wins over `.env`: the links point at this server and mail can only reach the sink. Use `http://127.0.0.1:3401` for every page (the links' host, so the session is the same one). Note the PIDs (`pgrep -af smtp-sink`, `pgrep -af "ace serve"`, `pgrep -af "queue:work"`): stop exactly those afterwards; never touch port 3333. Drive the browser with the tools earlier passes used (Playwright from `/home/blank/Coding/tattoo-drip/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs`, headless Chromium, viewports 375×812 and 1280×800, `colorScheme` light and dark); the QA account's credentials are in `<scratchpad>/qa-account.env`: read them inside your script and never print them. New accounts in this pass use throwaway addresses such as `tat18-pass-1@example.test`.

- [ ] **Step 3: Signup and confirmation**

1. Sign up `tat18-pass-1@example.test`: "Check your email" with the address; `node <scratchpad>/t18-pass/readmail.mjs` shows "Confirm your email address", "Hello,", no name, a `/verify-email/…` link. Sign up again with `TAT18-PASS-1@example.test`: the same page; the sink's next email is "You already have a Tattoo Drip account" with a sign-in link and a `/reset-password/…` link.
2. Signed out, open the confirmation link: the address shows, the URL is `/verify-email` with no token; Confirm: "Email address confirmed"; Sign in: onboarding's form opens (don't create a studio unless you name it `tat18-pass-<n>`). Open the same link again: "This link no longer works".

- [ ] **Step 4: The gate and the bar**

1. Sign up `tat18-pass-2@example.test` and sign in without confirming: `/onboarding` opens "Confirm your email address"; "Send a new link" toasts "We sent a new link to …" and the sink gets a second confirmation email; a second click within a minute toasts "Too many attempts. Try again in 1 minute."; "Sign out" works.
2. Sign in as the QA account (an existing, unconfirmed owner): the bar "Confirm your email address: we sent a link to …" shows on every studio page (top bar at 375 px, top of the content at 1280 px) and nothing else changed; "Send a new link", open the link in the same browser, Confirm, Continue: the bar is gone.

- [ ] **Step 5: Password reset**

1. Login page, "Forgot your password?", `tat18-pass-1@example.test`: "Check your email" ("If an account uses …"); then `nobody-18@example.test`: the same page and nothing new in the sink.
2. Open the reset link: "Choose a new password" with the address. Mismatched passwords: the error under "Confirm new password"; a 7-character password: the error under "New password". Set a new one: the login page with "Password changed. Sign in with your new password."; the old password fails, the new one works; the sink has "Your Tattoo Drip password was changed" with a link to `/forgot-password` and no token. Open the reset link again: "This link no longer works".
3. Sign in as `tat18-pass-1` in a second browser context, complete another reset in the first: the second context's next click lands on the login page.
4. Four reset requests for one address: the fourth toasts "Too many attempts. Try again in 60 minutes."

- [ ] **Step 6: Phone width, keyboard, theme**

At 375 px nothing is wider than the screen on any new page or the bar, and every button and input is 44 px tall. Tab through every new page: focus is visible, the field errors are announced (`role="alert"`), the toasts are announced. Dark mode: the bar, the pages and the error text read well. No page loads anything from another origin (DevTools Network).

- [ ] **Step 7: Stop**

Stop the three processes by their PIDs, then `git -C <repo> status --short`: if the dev server regenerated a tracked file (`.adonisjs/…`), restore it with `git -C <repo> checkout -- <file>`. Say in your report which accounts the pass left in the shared dev database (the throwaway ones, and that the QA account is now confirmed).

---

### Task 14: PR text (not committed)

- [ ] **Step 1: Write it**

Write `<scratchpad>/pr3-tat-18.md`. Say up front that the ticket grew from 2 to **about 5 points** and what was left out to keep it there (email change, a change-password and sign-out-everywhere page, the password policy, pruning unconfirmed accounts). Then a few "what and why" bullets per change (mentor mode): the single-use tokens and why a link's GET only fills the session; signup and the reset request that never tell whether an address is taken; canonical emails and the migration that refuses instead of merging; the session version and why cookie sessions needed it; the `verifiedEmail` gate and what unconfirmed accounts can still do; the limits; the four emails and why they carry no name; `account:verify` and what production needs before signup works (deploy.md, "Account email"); the three migrations (they change the shared dev database, and everyone signs out once). The rulings the user should see first: signup no longer signs in; a taken address's email holds a reset link; existing accounts start unconfirmed (the QA and development accounts too); ASCII-only case folding, no Gmail dot or plus folding; a confirmation link works whoever is signed in; no switch to skip confirmation; a reset doesn't sign in; the guest layout's words. The carry-forwards as tickets for the user to file (the spec's list), with TAT-33's note. The spec's browser pass as a checklist with its results. Do not push and do not open a PR.
