# Deposit page: amount, studio QR codes, reference code, proof upload (TAT-65) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners copy a per-project deposit link from the project page; `GET` and `POST /api/v1/tenants/:tenant/deposits/:token` serve its public deposit page (amount, the studio's deposit-page methods, a reference code, the deposit policy) and take one payment screenshot, stored privately as a `submitted` deposit payment that alerts the owners; the contract, SDK and React hooks follow, and the storefront page itself is specified for TAT-65b.

**Architecture:** A `deposit_links` row per project keeps a random nonce (the token is HMAC-derived from it with `APP_KEY`), the token's SHA-256 (the lookup), a 6-character reference code and a 30-day expiry. `DepositLinkService` makes and resolves links; `DepositPageService.show` computes the page and its state (pure `depositState`), and `submitProof` pre-checks, stores the image, locks the project, re-checks and inserts the payment with its proof in one INSERT, queueing `DepositProofAlertJob`. TAT-32's public tenant group serves the two routes behind a `depositThrottle` middleware (TAT-8's limiter, per address and per token); the dashboard gets an owner-only panel and a Projects badge.

**Tech Stack:** AdonisJS 7 (bodyparser 11.0.4, `@adonisjs/limiter` 3.0.1), Lucid on PostgreSQL 18 with RLS, VineJS, `@adonisjs/queue` 0.6.2, sharp through `ImageService`, Japa; Inertia + React 19 + shadcn for the dashboard; `openapi-typescript`; the SDK on `fetch` and TanStack Query 5, tested with `node:test` and `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-65-deposit-page-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- `<repo>` is the checkout you build in (this branch's worktree is `/home/blank/Coding/tattoo-drip-worktrees/tat-65`). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls, so every command uses `-C <repo>` or absolute paths.
- **TAT-51 first.** The coordinator rebases this branch onto TAT-51's final, reviewed tip (which contains TAT-32's) before Task 1. Tasks marked **(needs TAT-32/51)** use their code. The names below are those of TAT-32 at 332dafd and TAT-51's plan (`docs/superpowers/plans/2026-10-18-tat-51-inquiry-intake.md`); if a review renamed one, use the real name and note the deviation in your report.
- **One migration:** `apps/platform/database/migrations/1791650000000_create_deposit_links_table.ts`. `database/schema.ts` changes only through `pnpm -C <repo>/apps/platform migrate`.
- Fixture slugs in new tests end in `-65` (`deposit-needle-65`, …): the tests share the dev database, where a slug someone once used stays taken. Unknown slugs are ones no studio has (`no-such-studio-td65`).
- Values (verbatim): `DEPOSIT_LINK_DAYS = 30`; token `DEPOSIT_TOKEN = /^[A-Za-z0-9_-]{43}$/`; nonce 22 base64url characters; `token_hash` 64 lowercase hex; `REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"`, `REFERENCE_LENGTH = 6`, `REFERENCE_TRIES = 5`; `DEPOSIT_METHOD_KINDS = ["fonepay", "esewa", "khalti", "bank"]`; limits: reads 120 per address and 60 per token per `"10 mins"`, uploads 20 per address and 10 per token per `"1 hour"`; image purposes `"payment_proof"` (the proof) and `"payment_qr"` (QR codes); `STOREFRONT_URL` default `http://{tenant}.localhost:3000`; a link is `<origin>/deposit#<token>`.
- Messages (verbatim). API codes (409): `deposit_not_due` "This deposit can't be paid here right now. Reload the page to see why."; `deposit_changed` "The deposit amount changed. Check the new amount before you upload." Field messages: proof missing "Attach a screenshot of your payment."; proof over 10 MB "Use an image of 10 MB or less."; proof type `IMAGE_FORMAT_MESSAGE` ("Upload a JPEG, PNG or WebP image."); method "Choose how you paid."; expectedAmount "Reload the page and try again." Dashboard flashes: "Deposit link ready: send it to the client." (first link), "New link made. The old one no longer works." (replaced). `DEPOSIT_LINK_PROBLEMS`: `not_deposit_pending` "A deposit link can only be made while the project waits for its deposit."; `quote_expired` "The quote has expired: revise it first."; `nothing_due` "Nothing is left to pay on this deposit."; `no_payment_methods` "Show a payment method on the deposit page first (Settings, Payments)." Confirm: "Make a new link? The link you sent before stops working." Job log: "Deposit proof received." (failure: "Alerting owners to a deposit proof failed."). Chat message: `Hi <first name>, please pay your deposit of <dueText> to <studio>. Write <code> in the payment remark, then send a screenshot of the payment on this page:\n<url>` ("Hi" alone without a name).
- The raw token is never stored, logged, put in a rate-limit key or a job payload. Rate-limit keys are `digest()` values.
- Uploads on the public API follow TAT-32 ruling 16 as amended (TAT-51's build): the POST route is listed in `multipart.processManually` and the handler reads its body with `receiveUploads(request)` after the link check, then `discardUploads(request)` in a `finally`. The body parser never writes a deposit upload to disk before that.
- The dev database is shared with the other checkouts: after Task 1's `pnpm migrate` it has `deposit_links`, so another checkout's `pnpm migrate` regenerates its `schema.ts` with `DepositLinkSchema`. Say so in your report.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- Contract first: edit `packages/types/openapi.yaml`, then `pnpm -C <repo> --filter @tattoo-drip/types generate`. Never hand-edit `openapi.gen.ts`, `database/schema.ts` or `.adonisjs/`. After route or controller changes run `pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- Tests: `PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module hangs Japa, so RED steps run as `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background). SDK tests: `pnpm -C <repo> --filter @tattoo-drip/sdk test`; React tests (Task 12): `pnpm -C <repo> --filter @tattoo-drip/react test`. `pnpm typecheck` is the authority over editor diagnostics. The pre-commit hook runs Biome and may rewrite staged files: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the area scope (`platform`, `types`, `sdk`, `react`), ending with your session's attribution line (e.g. `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Never push, never open a PR.

## Review Focus

1. **A page left open while the studio revises the quote.** The client paid the old amount and uploads: the POST must be 409 `deposit_changed`, never a payment for the new amount. Tests: Task 8 "it records what is still due", Task 15 "a stale amount is 409".
2. **A double tap, or two tabs.** The second upload is 409 `deposit_not_due` and exactly one payment and one stored file remain, also when both passed the pre-check. Tests: Task 8 "a submission that loses the race under the lock", Task 15 "a second screenshot while one waits".
3. **Paid, then revised.** A project the studio revised after the deposit was verified is back in `quoted`; its link still opens and says `paid`. Tests: Task 3 "nothing left to pay is paid", Task 8 "each state".
4. **The token leaks nowhere.** Not in `deposit_links`, not in a rate-limit key, not in the job's payload or log line. Tests: Task 5 "only its hash and nonce stored", Task 11 "the keys are digests", Task 6 "logs ids only".
5. **A replaced link.** The URL the client had is the same 404 as an unknown one, and the reference code they may already have typed stays. Tests: Task 5 "making it again", Task 9 "New link replaces it", Task 14 "a link that doesn't work is the same 404".

---

## Before Task 1: preconditions

- [ ] **Branch and base.** `git -C <repo> status -sb` shows `harublank00/tat-65-deposit-page-amount-studio-qr-codes-reference-code-proof` and a clean tree. `git -C <repo> merge-base --is-ancestor harublank00/tat-51-post-inquiries-intake-with-references-client-matched-by HEAD; echo $?` prints `0` (TAT-51's tip, with its review fixes, is in). If not, stop and report.
- [ ] **TAT-32 and TAT-51 names this plan uses.** Each prints a match (else find the real name, use it, and note the deviation):
  - `rg -n 'export class ApiException|static of\(|static notFound' <repo>/apps/platform/app/services/public_api_errors.ts`
  - `rg -n 'export const API_ERRORS|export type ApiErrorCode|too_many_open_inquiries' <repo>/apps/platform/app/services` (the file that holds the code list and TAT-51's codes: Task 13 adds two codes next to them)
  - `rg -n 'export function publicTenantContext' <repo>/apps/platform/app/middleware/public_tenant_middleware.ts`
  - `rg -n 'export async function (discardUploads|receiveUploads)' <repo>/apps/platform/app/services/uploads.ts` (TAT-51's build reads an upload route's body in the handler; its spec at 0afebca still says auto-processing)
  - `rg -n 'processManually' <repo>/apps/platform/config/bodyparser.ts <repo>/apps/platform/tests/functional/api/api_routes.spec.ts` (the list of upload routes, and the guard that every API write route is in it: Task 14 adds the deposit route)
  - `rg -n 'bodyType|receiveUploads|discardUploads' <repo>/apps/platform/app/controllers/public_inquiries_controller.ts` (the multipart pattern Task 14 copies)
  - `rg -n 'export async function (tempUploads|newTempUploads)' <repo>/apps/platform/tests/helpers/uploads.ts`
  - `rg -n 'encoding\?:|isolationCase.encoding|export function publicMarkers|function urlFor' <repo>/apps/platform/tests/isolation/public_cases.ts <repo>/apps/platform/tests/helpers/public_isolation.ts`
  - `rg -n 'UNCACHED_GET_ROUTES' <repo>/apps/platform/tests/functional/api/api_routes.spec.ts`
  - `rg -n 'as\("api.v1.inquiries.store"\)' <repo>/apps/platform/start/routes.ts`
  - `rg -n 'export function (assertApiData|assertApiError|assertApiHeaders|assertNoCookies)' <repo>/apps/platform/tests/helpers/api.ts`
  - `rg -n 'UPLOAD_TIMEOUT_MS|timeoutMs\?: number|inquiries: \{' <repo>/packages/sdk/src/client.ts`
  - `rg -n '"test":' <repo>/packages/sdk/package.json`
  - `rg -n 'name: MVP|operationId: createInquiry' <repo>/packages/types/openapi.yaml`
- [ ] **Install and migrate.** `pnpm -C <repo> install`, then `pnpm -C <repo>/apps/platform migrate` (applies TAT-24's and TAT-32's migrations if they aren't yet).
- [ ] **Baseline.** `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=deposit_service.spec.ts --files=payment_method_service.spec.ts --files=project_page.spec.ts --files=cross_tenant.spec.ts --files=public_api.spec.ts --files=api_routes.spec.ts --files=inquiries.spec.ts` passes, and so does `pnpm -C <repo> --filter @tattoo-drip/sdk test`.

---

### Task 1: The `deposit_links` table

**Files:**
- Create: `apps/platform/database/migrations/1791650000000_create_deposit_links_table.ts`, `apps/platform/app/modules/payments/models/deposit_link.ts`
- Regenerate: `apps/platform/database/schema.ts` (by `pnpm migrate`)
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Test: `apps/platform/tests/functional/payments/deposit_links_table.spec.ts` (create)

**Interfaces:**
- Produces: table `deposit_links` (`id`, `tenant_id`, `project_id`, `reference_code` varchar(6), `token_nonce` varchar(22), `token_hash` varchar(64), `expires_at`, `created_at`, `updated_at`); constraints `deposit_links_tenant_id_project_id_foreign`, `deposit_links_tenant_id_project_id_unique`, `deposit_links_tenant_id_reference_code_unique`, `deposit_links_token_hash_unique`, `deposit_links_reference_code_format`, `deposit_links_token_nonce_format`, `deposit_links_token_hash_format`; model `DepositLink` (default export of `#modules/payments/models/deposit_link`) with `tenantId`, `projectId`, `referenceCode`, `tokenNonce`, `tokenHash`, `expiresAt: DateTime`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/payments/deposit_links_table.spec.ts`:

```ts
import { randomBytes } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, makeProject } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A random reference code from the alphabet. */
const code = () =>
	Array.from(
		{ length: 6 },
		() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
	).join("");

/** A link row's columns with fresh unique values; `over` replaces any. */
function linkValues(
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) {
	return {
		tenant_id: tenantId,
		project_id: projectId,
		reference_code: code(),
		token_nonce: randomBytes(16).toString("base64url"),
		token_hash: randomBytes(32).toString("hex"),
		expires_at: new Date(Date.now() + 86_400_000),
		...over,
	};
}

const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		}),
	);

test.group("deposit_links table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security keeps each studio's links to itself", async ({
		assert,
	}) => {
		await assertRowLevelSecurity(assert, "deposit_links", async (tenant) =>
			linkValues(tenant.id, (await projectIn(tenant)).id),
		);
	});

	test("a link points only at its own studio's project", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("links-a-65");
		const { tenant: b } = await studioWithOwner("links-b-65");
		const theirs = await projectIn(b);

		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_links", linkValues(a.id, theirs.id)),
					),
				/deposit_links_tenant_id_project_id_foreign/,
			);
		});
	});

	test("one link per project, one code per studio, one row per token hash", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-unique-65");
		const first = await projectIn(tenant);
		const second = await projectIn(tenant);
		const taken = linkValues(tenant.id, first.id);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "deposit_links", taken);
			const rejects = (values: Record<string, unknown>, message: RegExp) =>
				assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(inner, "deposit_links", values),
						),
					message,
				);

			await rejects(
				linkValues(tenant.id, first.id),
				/deposit_links_tenant_id_project_id_unique/,
			);
			await rejects(
				linkValues(tenant.id, second.id, {
					reference_code: taken.reference_code,
				}),
				/deposit_links_tenant_id_reference_code_unique/,
			);
			await rejects(
				linkValues(tenant.id, second.id, { token_hash: taken.token_hash }),
				/deposit_links_token_hash_unique/,
			);
			// The positive control: a second project with its own values is fine.
			await insertRow(trx, "deposit_links", linkValues(tenant.id, second.id));
		});
	});

	test("the code, the nonce and the hash keep their shapes", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-format-65");
		const project = await projectIn(tenant);
		const cases: [Record<string, unknown>, string][] = [
			// 1 and O are not in the alphabet.
			[{ reference_code: "ABC12O" }, "deposit_links_reference_code_format"],
			[{ reference_code: "abcdef" }, "deposit_links_reference_code_format"],
			[{ reference_code: "ABCDE" }, "deposit_links_reference_code_format"],
			[{ token_nonce: "short" }, "deposit_links_token_nonce_format"],
			[{ token_nonce: `${"a".repeat(21)}=` }, "deposit_links_token_nonce_format"],
			[{ token_hash: "A".repeat(64) }, "deposit_links_token_hash_format"],
			[{ token_hash: "a".repeat(63) }, "deposit_links_token_hash_format"],
		];

		await withDbContext({ tenantId: tenant.id }, async () => {
			for (const [over, constraint] of cases) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(
								inner,
								"deposit_links",
								linkValues(tenant.id, project.id, over),
							),
						),
					new RegExp(constraint),
				);
			}
		});
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=deposit_links_table.spec.ts`
Expected: FAIL: every test with `relation "deposit_links" does not exist`.

- [ ] **Step 3: Write the migration**

Create `apps/platform/database/migrations/1791650000000_create_deposit_links_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Deposit links (TAT-65): one per project, the bearer link to its public
 * deposit page. The token itself is never stored: `token_nonce` derives it
 * with APP_KEY (tokenFor in #modules/payments/deposit_links), and
 * `token_hash`, its SHA-256 in hex, is what a request is looked up by. A
 * new link replaces the nonce, the hash and the expiry in place; the
 * reference code stays. Not soft-deleted: a link is a credential, not a
 * record, and a deleted project's link is dead because the deposit page
 * loads only live projects.
 */
export default class extends BaseSchema {
	protected tableName = "deposit_links";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			// What the client writes in the payment remark; grants nothing.
			table.string("reference_code", 6).notNullable();
			table.string("token_nonce", 22).notNullable();
			table.string("token_hash", 64).notNullable();
			table.timestamp("expires_at", { useTz: true }).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects");
			table.unique(["tenant_id", "project_id"]);
			table.unique(["tenant_id", "reference_code"]);
			// Global: a request is looked up by the hash (and its path's tenant).
			table.unique(["token_hash"]);
			table.index(["tenant_id"]);
		});

		this.schema.raw(
			"alter table deposit_links add constraint deposit_links_reference_code_format check (reference_code ~ '^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$')",
		);
		this.schema.raw(
			"alter table deposit_links add constraint deposit_links_token_nonce_format check (token_nonce ~ '^[A-Za-z0-9_-]{22}$')",
		);
		this.schema.raw(
			"alter table deposit_links add constraint deposit_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

Run: `pnpm -C <repo>/apps/platform migrate`
Expected: the migration runs; `git -C <repo> diff --stat apps/platform/database/schema.ts` shows a new `DepositLinkSchema` class.

- [ ] **Step 4: The model**

Create `apps/platform/app/modules/payments/models/deposit_link.ts`:

```ts
import { DepositLinkSchema } from "#database/schema";

/**
 * A project's deposit link (TAT-65): the bearer link to its public deposit
 * page. The token is never stored: `tokenNonce` derives it (tokenFor in
 * #modules/payments/deposit_links) and `tokenHash` is what a request is
 * looked up by. One per project, replaced in place by a new link; the
 * reference code stays. Read and change links through DepositLinkService.
 */
export default class DepositLink extends DepositLinkSchema {}
```

- [ ] **Step 5: Run the tests to verify they pass, then the catalog guard**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=deposit_links_table.spec.ts`
Expected: PASS.

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=catalog_guard.spec.ts`
Expected: FAIL in "each protected table has exactly the expected policies" (`deposit_links` is missing from `EXPECTED_POLICIES`).

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, add to `EXPECTED_POLICIES`, after `clients`:

```ts
	deposit_links: ["tenant_isolation:ALL"],
```

Run it again. Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/database apps/platform/app/modules/payments/models/deposit_link.ts apps/platform/tests/functional/payments/deposit_links_table.spec.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> commit -m "feat(platform): add the deposit_links table

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tokens, reference codes, the link's URL and its chat message

**Files:**
- Create: `apps/platform/app/modules/payments/deposit_links.ts`
- Modify: `apps/platform/start/env.ts`, `apps/platform/.env.example`, `apps/platform/.env.test`
- Test: `apps/platform/tests/unit/modules/payments/deposit_links.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/payments/deposit_links`: `DEPOSIT_LINK_DAYS = 30`, `DEPOSIT_TOKEN: RegExp`, `REFERENCE_ALPHABET`, `REFERENCE_LENGTH = 6`, `DEV_STOREFRONT_URL = "http://{tenant}.localhost:3000"`, `newTokenNonce(): string`, `tokenFor(nonce: string): string`, `hashToken(token: string): string`, `newReferenceCode(): string`, `depositPageUrl(slug: string, token: string, template?: string): string`, `depositMessage(input: { clientName: string; studioName: string; dueText: string; referenceCode: string; url: string }): string`. Env: `STOREFRONT_URL` (optional string).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/payments/deposit_links.spec.ts`:

```ts
import { createHash } from "node:crypto";
import { test } from "@japa/runner";
import {
	DEPOSIT_TOKEN,
	DEV_STOREFRONT_URL,
	depositMessage,
	depositPageUrl,
	hashToken,
	newReferenceCode,
	newTokenNonce,
	REFERENCE_ALPHABET,
	tokenFor,
} from "#modules/payments/deposit_links";

const TOKEN = "T".repeat(43);

test.group("deposit link tokens", () => {
	test("a nonce is 22 base64url characters, new each time", ({ assert }) => {
		const nonces = new Set(Array.from({ length: 50 }, () => newTokenNonce()));

		assert.equal(nonces.size, 50);
		for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
	});

	test("the token is 43 base64url characters: the same for one nonce, another for another", ({
		assert,
	}) => {
		const nonce = newTokenNonce();
		const token = tokenFor(nonce);

		assert.match(token, DEPOSIT_TOKEN);
		assert.equal(tokenFor(nonce), token);
		assert.notEqual(tokenFor(newTokenNonce()), token);
		assert.notInclude(token, nonce, "the token doesn't show its nonce");
	});

	test("the hash is the token's SHA-256 in hex", ({ assert }) => {
		const token = tokenFor(newTokenNonce());

		assert.equal(
			hashToken(token),
			createHash("sha256").update(token).digest("hex"),
		);
		assert.match(hashToken(token), /^[0-9a-f]{64}$/);
	});

	test("DEPOSIT_TOKEN takes exactly 43 base64url characters", ({ assert }) => {
		assert.isTrue(DEPOSIT_TOKEN.test("a".repeat(43)));
		assert.isTrue(DEPOSIT_TOKEN.test(`${"A".repeat(41)}-_`));
		for (const bad of [
			"a".repeat(42),
			"a".repeat(44),
			`${"a".repeat(42)}=`,
			`${"a".repeat(42)}/`,
			`${"a".repeat(42)}+`,
		]) {
			assert.isFalse(DEPOSIT_TOKEN.test(bad), bad);
		}
	});
});

test.group("reference codes", () => {
	test("6 symbols that can't be misread", ({ assert }) => {
		assert.equal(REFERENCE_ALPHABET, "23456789ABCDEFGHJKMNPQRSTVWXYZ");
		const codes = new Set(Array.from({ length: 200 }, () => newReferenceCode()));

		assert.equal(codes.size, 200);
		for (const code of codes) {
			assert.match(code, /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
		}
	});
});

test.group("depositPageUrl", () => {
	test("the studio's origin from the template, then /deposit and the token in the fragment", ({
		assert,
	}) => {
		assert.equal(
			depositPageUrl("black-needle", TOKEN, "https://{tenant}.tattoodrip.app"),
			`https://black-needle.tattoodrip.app/deposit#${TOKEN}`,
		);
		// Only the origin counts.
		assert.equal(
			depositPageUrl(
				"black-needle",
				TOKEN,
				"http://{tenant}.localhost:3000/ignored",
			),
			`http://black-needle.localhost:3000/deposit#${TOKEN}`,
		);
	});

	test("the default is STOREFRONT_URL, which .env.test sets to the dev host", ({
		assert,
	}) => {
		assert.equal(DEV_STOREFRONT_URL, "http://{tenant}.localhost:3000");
		assert.equal(
			depositPageUrl("black-needle", TOKEN),
			`http://black-needle.localhost:3000/deposit#${TOKEN}`,
		);
	});

	test("a template without {tenant} is a configuration error", ({ assert }) => {
		assert.throws(
			() => depositPageUrl("black-needle", TOKEN, "https://tattoodrip.app"),
			/STOREFRONT_URL must contain \{tenant\}/,
		);
	});
});

test.group("depositMessage", () => {
	const input = {
		clientName: "  Sita Rai ",
		studioName: "Black Needle",
		dueText: "NPR 3,000",
		referenceCode: "7K3M9Q",
		url: `https://black-needle.tattoodrip.app/deposit#${TOKEN}`,
	};

	test("greets by first name, names the amount, studio and code, and ends with the link", ({
		assert,
	}) => {
		assert.equal(
			depositMessage(input),
			`Hi Sita, please pay your deposit of NPR 3,000 to Black Needle. Write 7K3M9Q in the payment remark, then send a screenshot of the payment on this page:\nhttps://black-needle.tattoodrip.app/deposit#${TOKEN}`,
		);
	});

	test("without a name it says Hi", ({ assert }) => {
		assert.match(
			depositMessage({ ...input, clientName: "  " }),
			/^Hi, please pay/,
		);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=deposit_links.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/deposit_links` in the log.

- [ ] **Step 3: The setting**

In `apps/platform/start/env.ts`, after `APP_URL: …,` add:

```ts
	// The studio pages' origin with {tenant} for the slug, e.g.
	// https://{tenant}.example.com: deposit links are built from it (TAT-65).
	// Unset: http://{tenant}.localhost:3000 (TAT-12's dev host).
	STOREFRONT_URL: Env.schema.string.optional(),
```

In `apps/platform/.env.example`, after the `APP_URL=` line add:

```
# The studio pages' origin, with {tenant} where the slug goes. Deposit links
# are built from it (TAT-65). Unset: http://{tenant}.localhost:3000
# STOREFRONT_URL=https://{tenant}.example.com
```

In `apps/platform/.env.test`, add a line (so test URLs never depend on a developer's `.env`):

```
STOREFRONT_URL=http://{tenant}.localhost:3000
```

- [ ] **Step 4: Write the helpers**

Create `apps/platform/app/modules/payments/deposit_links.ts`:

```ts
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import env from "#start/env";

/** How long a deposit link works after it is made or replaced (TAT-65). */
export const DEPOSIT_LINK_DAYS = 30;

/**
 * A deposit link's token: 43 base64url characters (256 bits). The deposit
 * routes match it, so anything else never reaches a query.
 */
export const DEPOSIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The reference code's symbols: digits and capitals that can't be misread
 * when typed into a payment remark (no 0, 1, I, L, O or U).
 */
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERENCE_LENGTH = 6;

/** Where deposit links point without STOREFRONT_URL: TAT-12's dev host. */
export const DEV_STOREFRONT_URL = "http://{tenant}.localhost:3000";

/** A fresh nonce for a link: 16 random bytes in base64url (22 characters). */
export function newTokenNonce(): string {
	return randomBytes(16).toString("base64url");
}

/**
 * A link's token, derived from its nonce with APP_KEY, so the owner's page
 * can show the link again at any time while the database holds no token.
 * Rotating APP_KEY changes every token: the stored hashes stop matching and
 * every link stops working.
 */
export function tokenFor(nonce: string): string {
	return createHmac("sha256", env.get("APP_KEY").release())
		.update(`deposit-link:v1:${nonce}`)
		.digest("base64url");
}

/** What a token is looked up by: its SHA-256 in hex. */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** A random reference code: REFERENCE_LENGTH symbols of REFERENCE_ALPHABET. */
export function newReferenceCode(): string {
	let code = "";
	for (let i = 0; i < REFERENCE_LENGTH; i++) {
		code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
	}
	return code;
}

/**
 * The public deposit page of `slug`'s link: the origin of `template`
 * (STOREFRONT_URL) with the slug for `{tenant}`, then `/deposit#<token>`.
 * The token is in the fragment, which browsers never send to the
 * storefront's host, its logs or a Referer.
 */
export function depositPageUrl(
	slug: string,
	token: string,
	template: string = env.get("STOREFRONT_URL") ?? DEV_STOREFRONT_URL,
): string {
	if (!template.includes("{tenant}")) {
		throw new Error(
			"STOREFRONT_URL must contain {tenant}, e.g. https://{tenant}.example.com",
		);
	}
	const { origin } = new URL(template.replaceAll("{tenant}", slug));
	return `${origin}/deposit#${token}`;
}

export type DepositMessageInput = {
	clientName: string;
	studioName: string;
	dueText: string;
	referenceCode: string;
	url: string;
};

/**
 * The deposit link as a chat message to the client, in English, the link
 * last and on its own line so every chat app makes it tappable. TAT-52
 * turns the one-tap messages into editable templates.
 */
export function depositMessage({
	clientName,
	studioName,
	dueText,
	referenceCode,
	url,
}: DepositMessageInput): string {
	const firstName = clientName.trim().split(/\s+/)[0];
	const greeting = firstName ? `Hi ${firstName}` : "Hi";
	return `${greeting}, please pay your deposit of ${dueText} to ${studioName}. Write ${referenceCode} in the payment remark, then send a screenshot of the payment on this page:\n${url}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=deposit_links.spec.ts`
Expected: PASS. (If "the default is STOREFRONT_URL" fails, check that the test runner loads `.env.test` over `.env`; if it doesn't, pass `DEV_STOREFRONT_URL` explicitly in that assertion and note it.)

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/deposit_links.ts apps/platform/start/env.ts apps/platform/.env.example apps/platform/.env.test apps/platform/tests/unit/modules/payments/deposit_links.spec.ts
git -C <repo> commit -m "feat(platform): derive deposit link tokens and reference codes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The deposit page's state

**Files:**
- Create: `apps/platform/app/modules/payments/deposit_page.ts`
- Test: `apps/platform/tests/unit/modules/payments/deposit_page.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/payments/deposit_page`: `DEPOSIT_STATES = ["due", "submitted", "paid", "updating", "expired", "cancelled"] as const`, `type DepositState`, `DEPOSIT_METHOD_KINDS = ["fonepay", "esewa", "khalti", "bank"] as const`, `type DepositMethodKind`, `type DepositFacts = { status: ProjectStatus; quoteExpired: boolean; settled: boolean; proofPending: boolean }`, `depositState(facts: DepositFacts): DepositState`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/payments/deposit_page.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	DEPOSIT_STATES,
	type DepositFacts,
	depositState,
} from "#modules/payments/deposit_page";
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";

const facts = (over: Partial<DepositFacts> = {}): DepositFacts => ({
	status: "deposit_pending",
	quoteExpired: false,
	settled: false,
	proofPending: false,
	...over,
});

test.group("depositState", () => {
	test("deposit_pending is due with a live quote, expired with an expired one", ({
		assert,
	}) => {
		assert.equal(depositState(facts()), "due");
		assert.equal(depositState(facts({ quoteExpired: true })), "expired");
	});

	test("a waiting screenshot is submitted, whatever the quote did since", ({
		assert,
	}) => {
		assert.equal(depositState(facts({ proofPending: true })), "submitted");
		assert.equal(
			depositState(facts({ proofPending: true, quoteExpired: true })),
			"submitted",
		);
		assert.equal(
			depositState(facts({ status: "quoted", proofPending: true })),
			"submitted",
		);
	});

	test("nothing left to pay is paid, also after a revision sent the project back to quoted (TAT-64)", ({
		assert,
	}) => {
		for (const status of [
			"deposit_pending",
			"quoted",
			"on_hold",
			"booked",
			"in_progress",
			"completed",
			"healing_check",
		] as ProjectStatus[]) {
			assert.equal(depositState(facts({ status, settled: true })), "paid", status);
		}
		assert.equal(
			depositState(facts({ settled: true, proofPending: true })),
			"paid",
			"a screenshot waiting on a paid deposit changes nothing for the client",
		);
	});

	test("cancelled and declined are cancelled, even when paid", ({ assert }) => {
		for (const status of ["cancelled", "declined"] as ProjectStatus[]) {
			assert.equal(depositState(facts({ status })), "cancelled", status);
			assert.equal(
				depositState(facts({ status, settled: true, proofPending: true })),
				"cancelled",
				status,
			);
		}
	});

	test("any other status with the deposit not covered is updating", ({
		assert,
	}) => {
		for (const status of [
			"reviewing",
			"quoted",
			"on_hold",
			"booked",
			"in_progress",
			"completed",
			"healing_check",
		] as ProjectStatus[]) {
			assert.equal(depositState(facts({ status })), "updating", status);
		}
	});

	test("every combination gives one of DEPOSIT_STATES", ({ assert }) => {
		for (const status of PROJECT_STATUSES) {
			for (const quoteExpired of [false, true]) {
				for (const settled of [false, true]) {
					for (const proofPending of [false, true]) {
						assert.include(
							DEPOSIT_STATES,
							depositState({ status, quoteExpired, settled, proofPending }),
						);
					}
				}
			}
		}
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=deposit_page.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/deposit_page` in the log.

- [ ] **Step 3: Write the state function**

Create `apps/platform/app/modules/payments/deposit_page.ts`:

```ts
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/**
 * What the public deposit page says (TAT-65): `due` (pay and send a
 * screenshot), `submitted` (a screenshot waits for the studio), `paid`
 * (nothing left to pay), `updating` (the studio is changing the quote),
 * `expired` (the quote expired before the deposit came) or `cancelled`.
 */
export const DEPOSIT_STATES = [
	"due",
	"submitted",
	"paid",
	"updating",
	"expired",
	"cancelled",
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

/** The kinds of payment method a deposit page can show: all but cash. */
export const DEPOSIT_METHOD_KINDS = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
] as const;
export type DepositMethodKind = (typeof DEPOSIT_METHOD_KINDS)[number];

export type DepositFacts = {
	status: ProjectStatus;
	/** The project's current quote has expired. */
	quoteExpired: boolean;
	/** Nothing is left to pay: a zero deposit, or verified deposit money reaching it. */
	settled: boolean;
	/** A deposit payment waits for the studio's decision. */
	proofPending: boolean;
};

/**
 * The page's state; the first rule that matches wins. A cancelled (or
 * declined) project says so whatever was paid. A covered deposit is paid in
 * any other status, also when a revision sent the project back to `quoted`
 * (expiry spares it, TAT-64). A waiting screenshot comes next, so the client
 * isn't asked to pay twice. Then `deposit_pending` is due, or expired once
 * the quote has (before the sweep cancels the project), and anything else
 * means the studio is still working on the quote.
 */
export function depositState(facts: DepositFacts): DepositState {
	if (facts.status === "cancelled" || facts.status === "declined") {
		return "cancelled";
	}
	if (facts.settled) return "paid";
	if (facts.proofPending) return "submitted";
	if (facts.status === "deposit_pending") {
		return facts.quoteExpired ? "expired" : "due";
	}
	return "updating";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=deposit_page.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/deposit_page.ts apps/platform/tests/unit/modules/payments/deposit_page.spec.ts
git -C <repo> commit -m "feat(platform): compute the deposit page's state

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The reads and writes the deposit page needs from existing services

**Files:**
- Modify: `apps/platform/app/modules/payments/services/deposit_service.ts`, `apps/platform/app/modules/payments/services/payment_method_service.ts`, `apps/platform/app/modules/projects/services/project_service.ts`
- Test: `apps/platform/tests/functional/payments/deposit_reads.spec.ts` (create)

**Interfaces:**
- Consumes: `StoredImage` (`#modules/media/services/image_service`), `PaymentMethodKind`.
- Produces: `DepositService.remaining(tenant, project, quote: Pick<Quote, "depositAmount" | "currency">): Promise<number>`, `DepositService.pendingProof(tenant, project): Promise<Payment | null>`, `DepositService.lastDecisionRejected(tenant, project): Promise<boolean>`, `DepositService.countPendingProofs(tenant): Promise<number>`, `DepositService.recordProof(tenant, project, input: { amount: number; currency: string; method: PaymentMethodKind; proof: StoredImage }): Promise<Payment>`; `PaymentMethodService.listForDepositPage(tenant): Promise<PaymentMethod[]>`; `ProjectService.findLive(tenant, id: string): Promise<TattooProject | null>`, `ProjectService.lockLive(trx: TransactionClientContract, tenant, id: string): Promise<TattooProject | null>`. (`tenant` is `Pick<Tenant, "id">` throughout, `project` `Pick<TattooProject, "id">`.)

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/deposit_reads.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type Quote from "#modules/projects/models/quote";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { withTransaction } from "#services/db_context";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const images = new ImageService();
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const artists = new ArtistService(images);
const projects = new ProjectService(
	artists,
	quotes,
	deposits,
	new SessionService(artists, deposits),
);
const methods = new PaymentMethodService(images);

/** A decided payment: the database wants a decision time with the status. */
const decided = (status: "verified" | "rejected", at = DateTime.utc()) => ({
	status,
	verifiedAt: at,
});

/** A deposit_pending project with a fixed quote (deposit NPR 3,000 = 300,000 paisa). */
function quotedProject(
	tenant: { id: string },
	over: Parameters<typeof makeQuote>[2] = {},
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		});
		const quote: Quote = await makeQuote(tenant, project, over);
		return { project, quote };
	});
}

test.group("DepositService: what the deposit page reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("remaining is the deposit minus verified deposit money in the quote's currency, never below zero", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-left-65");
		const { project, quote } = await quotedProject(tenant);
		const left = () =>
			inTenant(tenant, () => deposits.remaining(tenant, project, quote));

		assert.equal(await left(), 300_000);
		await inTenant(tenant, async () => {
			await makePayment(tenant, project, {
				amount: 100_000,
				...decided("verified"),
			});
			// None of these count: waiting, rejected, another kind, another currency.
			await makePayment(tenant, project, { amount: 50_000 });
			await makePayment(tenant, project, {
				amount: 50_000,
				...decided("rejected"),
			});
			await makePayment(tenant, project, {
				kind: "session",
				amount: 50_000,
				...decided("verified"),
			});
			await makePayment(tenant, project, {
				amount: 50_000,
				currency: "USD",
				...decided("verified"),
			});
		});
		assert.equal(await left(), 200_000);

		await inTenant(tenant, () =>
			makePayment(tenant, project, { amount: 500_000, ...decided("verified") }),
		);
		assert.equal(await left(), 0);
	});

	test("a zero deposit leaves nothing to pay", async ({ assert }) => {
		const { tenant } = await studioWithOwner("reads-zero-65");
		const { project, quote } = await quotedProject(tenant, {
			depositAmount: 0,
		});

		assert.equal(
			await inTenant(tenant, () => deposits.remaining(tenant, project, quote)),
			0,
		);
	});

	test("pendingProof is the submitted deposit payment; decided ones and other kinds aren't", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-pending-65");
		const { project } = await quotedProject(tenant);
		const pending = () =>
			inTenant(tenant, () => deposits.pendingProof(tenant, project));

		assert.isNull(await pending());
		await inTenant(tenant, async () => {
			await makePayment(tenant, project, { kind: "session" });
			await makePayment(tenant, project, { ...decided("rejected") });
		});
		assert.isNull(await pending());

		const waiting = await inTenant(tenant, () => makePayment(tenant, project));
		assert.equal((await pending())?.id, waiting.id);
	});

	test("lastDecisionRejected follows the studio's latest decision on a deposit payment", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-rejected-65");
		const { project } = await quotedProject(tenant);
		const rejected = () =>
			inTenant(tenant, () => deposits.lastDecisionRejected(tenant, project));

		assert.isFalse(await rejected());
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				...decided("rejected", DateTime.utc().minus({ hours: 2 })),
			}),
		);
		assert.isTrue(await rejected());
		// A waiting payment is no decision.
		await inTenant(tenant, () => makePayment(tenant, project));
		assert.isTrue(await rejected());
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				amount: 100_000,
				...decided("verified"),
			}),
		);
		assert.isFalse(await rejected());
	});

	test("countPendingProofs counts this studio's submitted deposit payments only", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-count-a-65");
		const { tenant: other } = await studioWithOwner("reads-count-b-65");
		const one = await quotedProject(tenant);
		const two = await quotedProject(tenant);
		const theirs = await quotedProject(other);
		await inTenant(tenant, async () => {
			await makePayment(tenant, one.project);
			await makePayment(tenant, two.project);
			await makePayment(tenant, two.project, { kind: "session" });
			await makePayment(tenant, one.project, { ...decided("verified") });
		});
		await inTenant(other, () => makePayment(other, theirs.project));

		assert.equal(
			await inTenant(tenant, () => deposits.countPendingProofs(tenant)),
			2,
		);
		assert.equal(
			await inTenant(other, () => deposits.countPendingProofs(tenant)),
			0,
			"another studio's context counts none of this studio's",
		);
	});

	test("recordProof inserts a submitted deposit payment with its proof", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-record-65");
		const { project } = await quotedProject(tenant);
		const proof = {
			key: `tenants/${tenant.id}/payment_proof/receipt.png`,
			width: 300,
			height: 200,
		};

		const payment = await inTenant(tenant, () =>
			deposits.recordProof(tenant, project, {
				amount: 300_000,
				currency: "NPR",
				method: "esewa",
				proof,
			}),
		);

		assert.deepEqual(
			[
				payment.tenantId,
				payment.projectId,
				payment.kind,
				payment.status,
				payment.amount,
				payment.currency,
				payment.method,
				payment.proofImageKey,
				payment.proofImageWidth,
				payment.proofImageHeight,
				payment.verifiedAt,
				payment.verifiedByUserId,
			],
			[
				tenant.id,
				project.id,
				"deposit",
				"submitted",
				300_000,
				"NPR",
				"esewa",
				proof.key,
				300,
				200,
				null,
				null,
			],
		);
	});
});

test.group("PaymentMethodService.listForDepositPage", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the live methods shown on the deposit page, in the owner's order", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-methods-65");
		const listed = await inTenant(tenant, async () => {
			await methods.create(tenant, {
				kind: "bank",
				label: "NIC Asia",
				bankName: "NIC Asia Bank",
				accountName: "Black Needle",
				accountNumber: "0123456789",
				showOnDepositPage: true,
			});
			await methods.create(tenant, {
				kind: "esewa",
				label: "eSewa (hidden)",
				accountNumber: "9800000001",
			});
			await methods.create(tenant, { kind: "cash", label: "Cash" });
			const khalti = await methods.create(tenant, {
				kind: "khalti",
				label: "Khalti",
				accountNumber: "9800000002",
				showOnDepositPage: true,
			});
			const before = (await methods.listForDepositPage(tenant)).map(
				({ label }) => label,
			);
			await methods.delete(tenant, khalti);
			const after = (await methods.listForDepositPage(tenant)).map(
				({ label }) => label,
			);
			return { before, after };
		});

		assert.deepEqual(listed.before, ["NIC Asia", "Khalti"]);
		assert.deepEqual(listed.after, ["NIC Asia"]);
	});

	test("another studio's context sees none of them", async ({ assert }) => {
		const { tenant } = await studioWithOwner("reads-methods-a-65");
		const { tenant: other } = await studioWithOwner("reads-methods-b-65");
		await inTenant(tenant, () =>
			methods.create(tenant, {
				kind: "khalti",
				label: "Khalti",
				accountNumber: "9800000002",
				showOnDepositPage: true,
			}),
		);

		assert.lengthOf(
			await inTenant(other, () => methods.listForDepositPage(tenant)),
			0,
		);
	});
});

test.group("ProjectService.findLive and lockLive", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the studio's live project, else null: deleted, unknown, another studio's", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-live-a-65");
		const { tenant: other } = await studioWithOwner("reads-live-b-65");
		const { project } = await quotedProject(tenant);
		const { project: gone } = await quotedProject(tenant);
		const { project: theirs } = await quotedProject(other);
		await inTenant(tenant, () => gone.softDelete());
		const find = (id: string) =>
			inTenant(tenant, () => projects.findLive(tenant, id));

		assert.equal((await find(project.id))?.id, project.id);
		assert.isNull(await find(gone.id));
		assert.isNull(await find(theirs.id));
		assert.isNull(await find("0195f3a0-0000-7000-8000-000000000065"));
	});

	test("lockLive reads the same rows inside a transaction", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-lock-65");
		const { project } = await quotedProject(tenant);
		const { project: gone } = await quotedProject(tenant);
		await inTenant(tenant, () => gone.softDelete());
		const lock = (id: string) =>
			inTenant(tenant, () =>
				withTransaction((trx) => projects.lockLive(trx, tenant, id)),
			);

		assert.equal((await lock(project.id))?.id, project.id);
		assert.isNull(await lock(gone.id));
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=deposit_reads.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL (`deposits.remaining is not a function`, `methods.listForDepositPage is not a function`, `projects.findLive is not a function`, or the matching type errors).

- [ ] **Step 3: `DepositService`**

In `apps/platform/app/modules/payments/services/deposit_service.ts`:

- Add the imports `import type { StoredImage } from "#modules/media/services/image_service";`, `import type { PaymentMethodKind } from "#modules/payments/models/payment_method";` and `import type Quote from "#modules/projects/models/quote";`.
- Replace the class comment ("Whether a project's deposit is covered. Read-only; TAT-65 … grow it. The current quote comes from QuoteService.") with:

```ts
/**
 * A project's deposit: whether it is covered, what is left to pay, and the
 * proofs clients send from the deposit page (TAT-65 owns this class). The
 * current quote comes from QuoteService. Only payments in the quote's
 * currency count; another currency is not converted.
 */
```

- After `verifiedPaid`, add:

```ts
	/**
	 * What is left to pay of `quote`'s deposit, in minor units: the deposit
	 * minus the verified deposit money in the quote's currency, never below
	 * zero. Zero means nothing is due (a zero deposit too), as in isSettled.
	 */
	async remaining(
		tenant: TenantRef,
		project: ProjectRef,
		quote: Pick<Quote, "depositAmount" | "currency">,
	): Promise<number> {
		const paid = await this.verifiedPaid(tenant, project, quote.currency);
		return Math.max(0, quote.depositAmount - paid);
	}

	/**
	 * The project's newest deposit proof waiting for the studio (a
	 * `submitted` deposit payment), or null. The deposit page takes one at a
	 * time, so there is at most one from it.
	 */
	async pendingProof(
		tenant: TenantRef,
		project: ProjectRef,
	): Promise<Payment | null> {
		return Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "deposit")
			.where("status", "submitted")
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.first();
	}

	/**
	 * Whether the studio's latest decision on one of the project's deposit
	 * payments was a rejection: the deposit page then asks for a new
	 * screenshot.
	 */
	async lastDecisionRejected(
		tenant: TenantRef,
		project: ProjectRef,
	): Promise<boolean> {
		const last = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.where("kind", "deposit")
			.whereNot("status", "submitted")
			.orderBy("verified_at", "desc")
			.orderBy("id", "desc")
			.first();
		return last?.status === "rejected";
	}

	/**
	 * How many deposit proofs wait for the studio: the Projects badge
	 * (TAT-65). Payments have no soft delete and nothing deletes projects
	 * from the dashboard yet, so every waiting deposit payment counts (TAT-42
	 * defines the cascade).
	 */
	async countPendingProofs(tenant: TenantRef): Promise<number> {
		const [row] = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("kind", "deposit")
			.where("status", "submitted")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/**
	 * Records the proof a client sent from the deposit page: a `submitted`
	 * deposit payment of `amount` with its stored image, in one INSERT (a
	 * payment's proof can never be set afterwards: payments_guard). Call it
	 * inside the transaction that stored the image.
	 */
	async recordProof(
		tenant: TenantRef,
		project: ProjectRef,
		input: {
			amount: number;
			currency: string;
			method: PaymentMethodKind;
			proof: StoredImage;
		},
	): Promise<Payment> {
		return Payment.create({
			tenantId: tenant.id,
			projectId: project.id,
			kind: "deposit",
			amount: input.amount,
			currency: input.currency,
			method: input.method,
			proofImageKey: input.proof.key,
			proofImageWidth: input.proof.width,
			proofImageHeight: input.proof.height,
			status: "submitted",
		});
	}
```

- [ ] **Step 4: `PaymentMethodService.listForDepositPage`**

In `apps/platform/app/modules/payments/services/payment_method_service.ts`, after `list`, add:

```ts
	/**
	 * The live methods the studio shows on the deposit page (TAT-65), in the
	 * owner's order. Cash never shows: checkPaymentMethod forbids it, and it
	 * is filtered here too.
	 */
	async listForDepositPage(tenant: TenantRef): Promise<PaymentMethod[]> {
		return PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.where("show_on_deposit_page", true)
			.whereNot("kind", "cash")
			.orderBy("position", "asc")
			.orderBy("id", "asc");
	}
```

- [ ] **Step 5: `ProjectService.findLive` and `lockLive`**

In `apps/platform/app/modules/projects/services/project_service.ts`, after `findManyFor`, add:

```ts
	/**
	 * The tenant's live project with this id, for code that acts for no
	 * member (the public deposit page, TAT-65), or null for an unknown,
	 * deleted or other tenant's id. Never use it to answer a member: findFor
	 * applies their role.
	 */
	async findLive(
		tenant: TenantRef,
		id: string,
	): Promise<TattooProject | null> {
		return TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.first();
	}

	/**
	 * findLive with the row locked until `trx` ends: the lock every project
	 * write takes first, so a deposit proof serializes with an accept, a
	 * revision, an expiry or a verification of the same project.
	 */
	async lockLive(
		trx: TransactionClientContract,
		tenant: TenantRef,
		id: string,
	): Promise<TattooProject | null> {
		return TattooProject.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", id)
			.forUpdate()
			.first();
	}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposit_reads.spec.ts --files=deposit_service.spec.ts --files=payment_method_service.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/services apps/platform/app/modules/projects/services/project_service.ts apps/platform/tests/functional/payments/deposit_reads.spec.ts
git -C <repo> commit -m "feat(platform): add the deposit page's reads and the proof insert

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `DepositLinkService`: make, replace and resolve links

**Files:**
- Modify: `apps/platform/app/modules/payments/errors.ts`
- Create: `apps/platform/app/modules/payments/services/deposit_link_service.ts`, `apps/platform/tests/helpers/deposits.ts`
- Test: `apps/platform/tests/functional/payments/deposit_link_service.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `DepositLink`; Task 2's helpers; Task 4's `DepositService.isSettled`, `PaymentMethodService.listForDepositPage`, `ProjectService.lockLive`; `QuoteService.current`, `isExpired`, `withTransaction`, `isUniqueViolation`.
- Produces: from `#modules/payments/errors`: `DEPOSIT_LINK_RULE_REASONS`, `type DepositLinkRuleReason` (`"not_deposit_pending" | "quote_expired" | "nothing_due" | "no_payment_methods"`), `DepositLinkRuleError(reason)` with `readonly reason`, `DEPOSIT_PROOF_REASONS`, `type DepositProofReason` (`"not_due" | "method_unavailable" | "amount_changed"`), `DepositProofError(reason)`, `DepositPageNotFoundError()`. `DepositLinkService` (default export of `#modules/payments/services/deposit_link_service`, `@inject()` with `ProjectService`, `QuoteService`, `DepositService`, `PaymentMethodService`): `issue(tenant: Pick<Tenant, "id">, member: Member, project: Pick<TattooProject, "id">): Promise<{ link: DepositLink; token: string; replaced: boolean }>`, `issueProblem(tenant, project: TattooProject): Promise<DepositLinkRuleReason | null>`, `resolve(tenant, token: string): Promise<DepositLink | null>`, `forProject(tenant: Pick<Tenant, "id" | "slug">, project): Promise<{ referenceCode: string; expiresAt: DateTime; url: string | null } | null>`, `protected newCode(): string`; `REFERENCE_TRIES = 5`. From `#tests/helpers/deposits`: `OWNER`, `depositServices(images?)` (returns `{ images, artists, quotes, deposits, projects, methods, links }`), `depositReady(tenant, quote?)` (returns `{ method, client, project, quote }`).

- [ ] **Step 1: The test helpers**

Create `apps/platform/tests/helpers/deposits.ts`:

```ts
import { randomUUID } from "node:crypto";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositLinkService from "#modules/payments/services/deposit_link_service";
import DepositService from "#modules/payments/services/deposit_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";

type TenantRef = { id: string };

/** An owner: the services never read the user for owners, so any id will do. */
export const OWNER = { userId: randomUUID(), role: "owner" as const };

/**
 * The deposit services wired as the container does. Pass an ImageService
 * that records or fails its stores.
 */
export function depositServices(images: ImageService = new ImageService()) {
	const artists = new ArtistService(images);
	const quotes = new QuoteService();
	const deposits = new DepositService(quotes);
	const projects = new ProjectService(
		artists,
		quotes,
		deposits,
		new SessionService(artists, deposits),
	);
	const methods = new PaymentMethodService(images);
	const links = new DepositLinkService(projects, quotes, deposits, methods);
	return { images, artists, quotes, deposits, projects, methods, links };
}

/**
 * What a deposit link needs in `tenant`: an eSewa method shown on the
 * deposit page (ID 9801234567, name "Black Needle") and a deposit_pending
 * project for Sita Rai with a fixed quote (NPR 15,000; deposit NPR 3,000,
 * i.e. 300,000 paisa) valid for two weeks. Call it inside
 * `inTenant(tenant, …)`.
 */
export async function depositReady(
	tenant: TenantRef,
	quote: Parameters<typeof makeQuote>[2] = {},
) {
	const method = await new PaymentMethodService(new ImageService()).create(
		tenant,
		{
			kind: "esewa",
			label: "eSewa",
			accountNumber: "9801234567",
			accountName: "Black Needle",
			showOnDepositPage: true,
		},
	);
	const client = await makeClient(tenant, { name: "Sita Rai" });
	const project = await makeProject(tenant, client, {
		status: "deposit_pending",
	});
	return {
		method,
		client,
		project,
		quote: await makeQuote(tenant, project, quote),
	};
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/platform/tests/functional/payments/deposit_link_service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	DEPOSIT_LINK_DAYS,
	DEPOSIT_TOKEN,
	depositPageUrl,
	hashToken,
	newTokenNonce,
	tokenFor,
} from "#modules/payments/deposit_links";
import { DepositLinkRuleError } from "#modules/payments/errors";
import DepositLink from "#modules/payments/models/deposit_link";
import DepositLinkService from "#modules/payments/services/deposit_link_service";
import { depositReady, depositServices, OWNER } from "#tests/helpers/deposits";
import { makePayment } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const services = depositServices();
const { links } = services;
const ARTIST = { userId: randomUUID(), role: "artist" as const };

/** A DepositLinkService whose first codes are the ones a test gives it. */
class ScriptedCodes extends DepositLinkService {
	codes: string[] = [];

	protected override newCode() {
		return this.codes.shift() ?? super.newCode();
	}
}

/** The DepositLinkRuleError reason a refused issue gives, or null if it went through. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof DepositLinkRuleError) return error.reason;
		throw error;
	}
}

const rows = (tenant: { id: string }) =>
	inTenant(tenant, () => DepositLink.query().orderBy("id"));

test.group("DepositLinkService.issue", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner makes the link: a 43-character token, only its hash and nonce stored, a 6-character code, 30 days", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-make-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		const { link, token, replaced } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.isFalse(replaced);
		assert.match(token, DEPOSIT_TOKEN);
		assert.equal(link.projectId, project.id);
		assert.equal(link.tokenHash, hashToken(token));
		assert.equal(tokenFor(link.tokenNonce), token);
		assert.match(link.referenceCode, /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
		assert.closeTo(
			link.expiresAt.diff(DateTime.now(), "days").days,
			DEPOSIT_LINK_DAYS,
			0.01,
		);
		const stored = await rows(tenant);
		assert.lengthOf(stored, 1);
		assert.notInclude(
			JSON.stringify(stored[0].serialize()),
			token,
			"the token itself is never stored",
		);
	});

	test("making it again replaces the token and the expiry, keeps the row and the code; the old token is dead", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-replace-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		const first = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		const second = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);

		assert.isTrue(second.replaced);
		assert.notEqual(second.token, first.token);
		assert.equal(second.link.id, first.link.id);
		assert.equal(second.link.referenceCode, first.link.referenceCode);
		assert.lengthOf(await rows(tenant), 1);
		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, first.token)),
		);
		assert.equal(
			(await inTenant(tenant, () => links.resolve(tenant, second.token)))?.id,
			first.link.id,
		);
	});

	test("anyone but an owner gets a 404, and no link", async ({ assert }) => {
		const { tenant } = await studioWithOwner("links-artist-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		await assert.rejects(
			() => inTenant(tenant, () => links.issue(tenant, ARTIST, project)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		assert.lengthOf(await rows(tenant), 0);
	});

	test("a project that isn't waiting for a deposit it can take gets no link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-refuse-65");
		const cases = await inTenant(tenant, async () => {
			const quoted = await depositReady(tenant);
			quoted.project.status = "quoted";
			await quoted.project.save();
			const expired = await depositReady(tenant, {
				expiresAt: DateTime.utc().minus({ minutes: 1 }),
			});
			const zero = await depositReady(tenant, { depositAmount: 0 });
			const paid = await depositReady(tenant);
			await makePayment(tenant, paid.project, {
				amount: 300_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return [
				[quoted.project, "not_deposit_pending"],
				[expired.project, "quote_expired"],
				[zero.project, "nothing_due"],
				[paid.project, "nothing_due"],
			] as const;
		});

		for (const [project, reason] of cases) {
			assert.equal(
				await reasonOf(() =>
					inTenant(tenant, () => links.issue(tenant, OWNER, project)),
				),
				reason,
				reason,
			);
		}
		assert.lengthOf(await rows(tenant), 0);
	});

	test("a studio that shows no method on the deposit page gets no link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-no-method-65");
		const { project } = await inTenant(tenant, async () => {
			const ready = await depositReady(tenant);
			ready.method.showOnDepositPage = false;
			await ready.method.save();
			return ready;
		});

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => links.issue(tenant, OWNER, project)),
			),
			"no_payment_methods",
		);
		assert.equal(
			await inTenant(tenant, () => links.issueProblem(tenant, project)),
			"no_payment_methods",
		);
	});

	test("a reference code the studio already uses is drawn again", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-code-65");
		const scripted = new ScriptedCodes(
			services.projects,
			services.quotes,
			services.deposits,
			services.methods,
		);
		const [one, two] = await inTenant(tenant, async () => [
			await depositReady(tenant),
			await depositReady(tenant),
		]);
		const first = await inTenant(tenant, () =>
			scripted.issue(tenant, OWNER, one.project),
		);
		const fresh = first.link.referenceCode === "ABCDEF" ? "ABCDEG" : "ABCDEF";
		scripted.codes = [first.link.referenceCode, fresh];

		const second = await inTenant(tenant, () =>
			scripted.issue(tenant, OWNER, two.project),
		);

		assert.equal(second.link.referenceCode, fresh);
		assert.lengthOf(await rows(tenant), 2);
	});

	test("after five taken codes in a row it gives up", async ({ assert }) => {
		const { tenant } = await studioWithOwner("links-code-full-65");
		const scripted = new ScriptedCodes(
			services.projects,
			services.quotes,
			services.deposits,
			services.methods,
		);
		const [one, two] = await inTenant(tenant, async () => [
			await depositReady(tenant),
			await depositReady(tenant),
		]);
		const first = await inTenant(tenant, () =>
			scripted.issue(tenant, OWNER, one.project),
		);
		scripted.codes = Array(5).fill(first.link.referenceCode);

		await assert.rejects(
			() => inTenant(tenant, () => scripted.issue(tenant, OWNER, two.project)),
			/deposit_links_tenant_id_reference_code_unique/,
		);
		assert.lengthOf(await rows(tenant), 1);
	});
});

test.group("DepositLinkService.resolve and forProject", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("resolve finds a live link only: not an unknown, expired or another studio's token", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-resolve-a-65");
		const { tenant: other } = await studioWithOwner("links-resolve-b-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { project: theirs } = await inTenant(other, () =>
			depositReady(other),
		);
		const mine = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		const foreign = await inTenant(other, () =>
			links.issue(other, OWNER, theirs),
		);
		const resolve = (token: string) =>
			inTenant(tenant, () => links.resolve(tenant, token));

		assert.equal((await resolve(mine.token))?.id, mine.link.id);
		assert.isNull(await resolve(tokenFor(newTokenNonce())));
		assert.isNull(await resolve(foreign.token));
		assert.isNull(
			await inTenant(other, () => links.resolve(tenant, foreign.token)),
			"another studio's context with this studio's id finds nothing either",
		);

		await inTenant(tenant, async () => {
			mine.link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await mine.link.save();
		});
		assert.isNull(await resolve(mine.token));
	});

	test("forProject rebuilds the URL; it is null once the link expired or its hash stopped matching", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-page-65");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const read = () =>
			inTenant(tenant, () => links.forProject(tenant, project));

		assert.isNull(await read());

		const { link, token } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		const shown = await read();
		assert.equal(shown?.url, depositPageUrl(tenant.slug, token));
		assert.equal(shown?.referenceCode, link.referenceCode);
		assert.equal(shown?.expiresAt.toMillis(), link.expiresAt.toMillis());

		// What a rotated APP_KEY looks like: the nonce no longer gives the hash.
		await inTenant(tenant, async () => {
			link.tokenHash = "0".repeat(64);
			await link.save();
		});
		assert.isNull((await read())?.url);

		const fresh = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		await inTenant(tenant, async () => {
			fresh.link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await fresh.link.save();
		});
		const expired = await read();
		assert.isNull(expired?.url);
		assert.equal(expired?.referenceCode, link.referenceCode);
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=deposit_link_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/services/deposit_link_service` (or "does not provide an export named 'DepositLinkRuleError'") in the log.

- [ ] **Step 4: The errors**

Append to `apps/platform/app/modules/payments/errors.ts`:

```ts
export const DEPOSIT_LINK_RULE_REASONS = [
	"not_deposit_pending",
	"quote_expired",
	"nothing_due",
	"no_payment_methods",
] as const;
export type DepositLinkRuleReason = (typeof DEPOSIT_LINK_RULE_REASONS)[number];

const LINK_MESSAGES: Record<DepositLinkRuleReason, string> = {
	not_deposit_pending: "Only a deposit-pending project can have a deposit link",
	quote_expired: "The project's current quote has expired",
	nothing_due: "The project's deposit is zero or already covered",
	no_payment_methods:
		"The tenant shows no payment method on the deposit page",
};

/**
 * A deposit link can't be made now (TAT-65); `reason` says why, and
 * DEPOSIT_LINK_PROBLEMS has the owner's text. Thrown after the savepoint
 * rolled back. The message is for developers.
 */
export class DepositLinkRuleError extends Error {
	constructor(readonly reason: DepositLinkRuleReason) {
		super(LINK_MESSAGES[reason]);
		this.name = "DepositLinkRuleError";
	}
}

export const DEPOSIT_PROOF_REASONS = [
	"not_due",
	"method_unavailable",
	"amount_changed",
] as const;
export type DepositProofReason = (typeof DEPOSIT_PROOF_REASONS)[number];

const PROOF_MESSAGES: Record<DepositProofReason, string> = {
	not_due: "The deposit page's state is not due",
	method_unavailable: "The tenant doesn't show that kind of payment method",
	amount_changed: "The expected amount is not what is due now",
};

/**
 * A deposit proof the page can't take now (TAT-65). Thrown before the
 * image is stored, or after the savepoint that stored it rolled back (and
 * deleted it). The message is for developers.
 */
export class DepositProofError extends Error {
	constructor(readonly reason: DepositProofReason) {
		super(PROOF_MESSAGES[reason]);
		this.name = "DepositProofError";
	}
}

/**
 * A deposit link that doesn't work: unknown, replaced, expired, another
 * tenant's, or its project is gone. One error for all of them, so the API
 * answers every one with the same 404.
 */
export class DepositPageNotFoundError extends Error {
	constructor() {
		super("No live deposit link with this token in the tenant");
		this.name = "DepositPageNotFoundError";
	}
}
```

- [ ] **Step 5: The service**

Create `apps/platform/app/modules/payments/services/deposit_link_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { DateTime } from "luxon";
import {
	DEPOSIT_LINK_DAYS,
	depositPageUrl,
	hashToken,
	newReferenceCode,
	newTokenNonce,
	tokenFor,
} from "#modules/payments/deposit_links";
import {
	DepositLinkRuleError,
	type DepositLinkRuleReason,
} from "#modules/payments/errors";
import DepositLink from "#modules/payments/models/deposit_link";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { isExpired } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;
type ProjectRef = Pick<TattooProject, "id">;
type Fresh = Pick<DepositLink, "tokenNonce" | "tokenHash" | "expiresAt">;

/**
 * Draws of a reference code before giving up. Each existing code makes a
 * collision a 1 in 729 million event, so a studio never gets here.
 */
export const REFERENCE_TRIES = 5;

const CODE_TAKEN = "deposit_links_tenant_id_reference_code_unique";

/**
 * Deposit links (TAT-65): one per project, the bearer link to its public
 * deposit page. Owners make or replace a link; the public API resolves a
 * token to its link. The token is derived from the row's nonce (tokenFor)
 * and never stored.
 */
@inject()
export default class DepositLinkService {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private methods: PaymentMethodService,
	) {}

	/**
	 * Makes the project's deposit link, or replaces it: a new token that
	 * works for DEPOSIT_LINK_DAYS, the old one dead at once. The reference
	 * code is drawn with the first link and kept. Owners only: anyone else
	 * gets E_ROW_NOT_FOUND (a 404, like a project that isn't theirs). Under
	 * the project's lock, issueProblem must find nothing, else
	 * DepositLinkRuleError. Returns the link, its token and whether it
	 * replaced an earlier one.
	 */
	async issue(
		tenant: TenantRef,
		member: Member,
		project: ProjectRef,
	): Promise<{ link: DepositLink; token: string; replaced: boolean }> {
		if (member.role !== "owner") {
			throw new lucidErrors.E_ROW_NOT_FOUND(DepositLink);
		}
		return withTransaction(async (trx) => {
			const live = await this.projects.lockLive(trx, tenant, project.id);
			if (!live) throw new lucidErrors.E_ROW_NOT_FOUND(DepositLink);
			const problem = await this.issueProblem(tenant, live);
			if (problem) throw new DepositLinkRuleError(problem);

			const tokenNonce = newTokenNonce();
			const token = tokenFor(tokenNonce);
			const fresh: Fresh = {
				tokenNonce,
				tokenHash: hashToken(token),
				expiresAt: DateTime.now().plus({ days: DEPOSIT_LINK_DAYS }),
			};
			const existing = await DepositLink.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("project_id", live.id)
				.forUpdate()
				.first();
			if (existing) {
				existing.merge(fresh);
				await existing.save();
				return { link: existing, token, replaced: true };
			}
			const link = await this.insertWithCode(tenant, live, fresh);
			return { link, token, replaced: false };
		});
	}

	/**
	 * What stops an owner from making the project's link now, or null: it
	 * must be deposit_pending, with a current quote that hasn't expired, a
	 * deposit that isn't covered (a zero deposit is covered), and at least
	 * one method on the deposit page. The project page shows the reason.
	 */
	async issueProblem(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<DepositLinkRuleReason | null> {
		if (project.status !== "deposit_pending") return "not_deposit_pending";
		const quote = await this.quotes.current(tenant, project);
		if (!quote || isExpired(quote)) return "quote_expired";
		if (await this.deposits.isSettled(tenant, project)) return "nothing_due";
		const shown = await this.methods.listForDepositPage(tenant);
		if (shown.length === 0) return "no_payment_methods";
		return null;
	}

	/**
	 * The link of `token` in this tenant while it works, else null: unknown,
	 * replaced, expired and another tenant's tokens are all null. Looked up
	 * by the token's hash, never the token.
	 */
	async resolve(tenant: TenantRef, token: string): Promise<DepositLink | null> {
		const link = await DepositLink.query()
			.where("tenant_id", tenant.id)
			.where("token_hash", hashToken(token))
			.first();
		if (!link || link.expiresAt.toMillis() <= DateTime.now().toMillis()) {
			return null;
		}
		return link;
	}

	/**
	 * The project's link for its owner's page, or null when it has none: the
	 * URL rebuilt from the nonce (null once the link expired, or when the
	 * hash no longer matches because APP_KEY was rotated), the reference
	 * code and the expiry.
	 */
	async forProject(
		tenant: Pick<Tenant, "id" | "slug">,
		project: ProjectRef,
	): Promise<{
		referenceCode: string;
		expiresAt: DateTime;
		url: string | null;
	} | null> {
		const link = await DepositLink.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.first();
		if (!link) return null;
		const token = tokenFor(link.tokenNonce);
		const works =
			hashToken(token) === link.tokenHash &&
			link.expiresAt.toMillis() > DateTime.now().toMillis();
		return {
			referenceCode: link.referenceCode,
			expiresAt: link.expiresAt,
			url: works ? depositPageUrl(tenant.slug, token) : null,
		};
	}

	/** A new reference code. Protected, so a test can force a collision. */
	protected newCode(): string {
		return newReferenceCode();
	}

	/**
	 * Inserts the project's first link with a new reference code. A code
	 * the studio already uses is drawn again, each try in its own savepoint,
	 * up to REFERENCE_TRIES times; then the unique violation surfaces.
	 */
	private async insertWithCode(
		tenant: TenantRef,
		project: ProjectRef,
		fresh: Fresh,
	): Promise<DepositLink> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await withTransaction(() =>
					DepositLink.create({
						tenantId: tenant.id,
						projectId: project.id,
						referenceCode: this.newCode(),
						...fresh,
					}),
				);
			} catch (error) {
				if (attempt >= REFERENCE_TRIES || !isUniqueViolation(error, CODE_TAKEN)) {
					throw error;
				}
			}
		}
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposit_link_service.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/errors.ts apps/platform/app/modules/payments/services/deposit_link_service.ts apps/platform/tests/helpers/deposits.ts apps/platform/tests/functional/payments/deposit_link_service.spec.ts
git -C <repo> commit -m "feat(platform): make, replace and resolve deposit links

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The owners' alert job

**Files:**
- Create: `apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts`
- Test: `apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts` (create)

**Interfaces:**
- Consumes: `TenantJob` (`#services/tenant_job`), `Payment`.
- Produces: `DepositProofAlertJob` (default export of `#modules/payments/jobs/deposit_proof_alert_job`), payload `{ tenantId: string; paymentId: string }`; for a payment still `submitted` it logs `logger.info({ tenantId, projectId, paymentId }, "Deposit proof received.")`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import { makeClient, makePayment, makeProject } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const MESSAGE = "Deposit proof received.";

/** Runs the job the way the worker does and returns what it logged with MESSAGE. */
async function run(payload: { tenantId: string; paymentId: string }) {
	const job = new DepositProofAlertJob();
	job.$hydrate(payload, {
		jobId: "deposit-proof-alert-spec",
		name: "DepositProofAlertJob",
		attempt: 1,
		queue: "default",
		priority: 0,
		acquiredAt: new Date(),
		stalledCount: 0,
	});
	const info = mock.method(logger, "info", () => {});
	try {
		await job.execute();
	} finally {
		info.mock.restore();
	}
	return info.mock.calls
		.map((call) => call.arguments)
		.filter((args) => args[1] === MESSAGE);
}

const paymentIn = (
	tenant: { id: string },
	over: Parameters<typeof makePayment>[2] = {},
) =>
	inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		});
		return makePayment(tenant, project, {
			method: "esewa",
			proofImageKey: `tenants/${tenant.id}/payment_proof/receipt.png`,
			proofImageWidth: 300,
			proofImageHeight: 200,
			...over,
		});
	});

test.group("DepositProofAlertJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("logs ids only for a proof that waits: no amount, key or link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-proof-65");
		const payment = await paymentIn(tenant);

		const logged = await run({ tenantId: tenant.id, paymentId: payment.id });

		assert.deepEqual(logged, [
			[
				{ tenantId: tenant.id, projectId: payment.projectId, paymentId: payment.id },
				MESSAGE,
			],
		]);
	});

	test("a decided, missing or other studio's payment needs no alert", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-proof-a-65");
		const { tenant: other } = await studioWithOwner("alert-proof-b-65");
		const decided = await paymentIn(tenant, {
			status: "rejected",
			verifiedAt: DateTime.utc(),
		});
		const theirs = await paymentIn(other);

		for (const paymentId of [decided.id, randomUUID(), theirs.id]) {
			assert.deepEqual(
				await run({ tenantId: tenant.id, paymentId }),
				[],
				paymentId,
			);
		}
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=deposit_proof_alert_job.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/jobs/deposit_proof_alert_job` in the log.

- [ ] **Step 3: Write the job**

Create `apps/platform/app/modules/payments/jobs/deposit_proof_alert_job.ts`:

```ts
import logger from "@adonisjs/core/services/logger";
import Payment from "#modules/payments/models/payment";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; paymentId: string };

/**
 * Alerts a studio's owners that a client sent a deposit proof from the
 * deposit page. DepositPageService.submitProof (TAT-65) queues it in the
 * payment's transaction, so it exists exactly when the payment does. For
 * now it logs the ids (never the link, the token, a URL or the amount):
 * TAT-52 sends the owners' email and in-app alert from here; the dashboard's
 * Projects badge already counts the proofs that wait. Safe to repeat; a
 * payment that is gone or already decided needs no alert.
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
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, paymentId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, paymentId },
			"Alerting owners to a deposit proof failed.",
		);
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=deposit_proof_alert_job.spec.ts`
Expected: PASS.

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=job_classes.spec.ts`
Expected: PASS (it extends `TenantJob`, so the guard needs no allowlist entry).

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/jobs apps/platform/tests/functional/payments/deposit_proof_alert_job.spec.ts
git -C <repo> commit -m "feat(platform): add the job that alerts owners to a deposit proof

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The proof validator

**Files:**
- Create: `apps/platform/app/modules/payments/validators/deposit_proof.ts`
- Test: `apps/platform/tests/unit/modules/payments/deposit_proof_validator.spec.ts` (create)

**Interfaces:**
- Consumes: `imageFile()` (`#modules/media/validators/image_file`), `IMAGE_FORMAT_MESSAGE` (`#modules/media/errors`), `DEPOSIT_METHOD_KINDS` (Task 3).
- Produces, from `#modules/payments/validators/deposit_proof`: `depositProofValidator` (fields `proof`, `method`, `expectedAmount`), `type DepositProofInput = Infer<typeof depositProofValidator>`, `PROOF_MESSAGE`, `METHOD_MESSAGE`, `AMOUNT_MESSAGE`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/payments/deposit_proof_validator.spec.ts`:

```ts
import { MultipartFile } from "@adonisjs/core/bodyparser";
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import {
	AMOUNT_MESSAGE,
	depositProofValidator,
	METHOD_MESSAGE,
	PROOF_MESSAGE,
} from "#modules/payments/validators/deposit_proof";

/** A parsed upload, as the validator sees it. */
function upload(clientName: string, size = 1000) {
	const file = new MultipartFile(
		{ fieldName: "proof", clientName, headers: {} },
		{},
	);
	file.size = size;
	file.extname = clientName.split(".").pop();
	file.state = "consumed";
	return file;
}

/** What the controller hands over: the multipart strings and the first proof part. */
const body = (over: Record<string, unknown> = {}) => ({
	proof: upload("receipt.png"),
	method: "esewa",
	expectedAmount: "300000",
	...over,
});

const without = (field: string) =>
	Object.fromEntries(Object.entries(body()).filter(([key]) => key !== field));

/** Field → message of a refused body, or {} when it passes. */
async function problems(data: Record<string, unknown>) {
	try {
		await depositProofValidator.validate(data);
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

test.group("depositProofValidator", () => {
	test("a complete body passes, with the amount as a number", async ({
		assert,
	}) => {
		const output = await depositProofValidator.validate(body());

		assert.equal(output.method, "esewa");
		assert.strictEqual(output.expectedAmount, 300_000);
		assert.equal(output.proof.clientName, "receipt.png");
	});

	test("each field is required, with its message", async ({ assert }) => {
		assert.deepEqual(await problems(without("proof")), { proof: PROOF_MESSAGE });
		assert.deepEqual(await problems(without("method")), {
			method: METHOD_MESSAGE,
		});
		assert.deepEqual(await problems(without("expectedAmount")), {
			expectedAmount: AMOUNT_MESSAGE,
		});
	});

	test("the method is a kind a deposit page can show", async ({ assert }) => {
		for (const kind of ["fonepay", "esewa", "khalti", "bank"]) {
			assert.deepEqual(await problems(body({ method: kind })), {}, kind);
		}
		for (const kind of ["cash", "paypal", ""]) {
			assert.deepEqual(
				await problems(body({ method: kind })),
				{ method: METHOD_MESSAGE },
				kind,
			);
		}
	});

	test("the amount is whole paisa from 1 to 1,000,000,000", async ({
		assert,
	}) => {
		assert.deepEqual(await problems(body({ expectedAmount: "1" })), {});
		assert.deepEqual(await problems(body({ expectedAmount: "1000000000" })), {});
		for (const amount of ["0", "-5", "12.5", "abc", "1000000001"]) {
			assert.deepEqual(
				await problems(body({ expectedAmount: amount })),
				{ expectedAmount: AMOUNT_MESSAGE },
				amount,
			);
		}
	});

	test("the screenshot is a JPEG, PNG or WebP of 10 MB at most", async ({
		assert,
	}) => {
		for (const name of ["a.jpg", "a.jpeg", "a.png", "a.webp"]) {
			assert.deepEqual(await problems(body({ proof: upload(name) })), {}, name);
		}
		assert.deepEqual(
			await problems(body({ proof: upload("big.png", 10 * 1024 * 1024 + 1) })),
			{ proof: "Use an image of 10 MB or less." },
		);
		for (const name of ["moving.gif", "photo.heic", "notes.pdf"]) {
			assert.deepEqual(
				await problems(body({ proof: upload(name) })),
				{ proof: IMAGE_FORMAT_MESSAGE },
				name,
			);
		}
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=deposit_proof_validator.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/validators/deposit_proof` in the log.

- [ ] **Step 3: Write the validator**

Create `apps/platform/app/modules/payments/validators/deposit_proof.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";
import { DEPOSIT_METHOD_KINDS } from "#modules/payments/deposit_page";

export const PROOF_MESSAGE = "Attach a screenshot of your payment.";
export const METHOD_MESSAGE = "Choose how you paid.";
export const AMOUNT_MESSAGE = "Reload the page and try again.";

/**
 * A deposit proof from the public deposit page (TAT-65), as the multipart
 * body gives it: the first `proof` file (the controller passes
 * `request.file("proof")`), `method` and `expectedAmount` (the `due` the
 * page showed, in paisa). The image is only filtered here (size,
 * extension): ImageService checks what it really is. Whether the studio
 * shows that method, and whether the amount is still what is due, is
 * DepositPageService's job. Any other field is dropped.
 */
export const depositProofValidator = vine.create({
	proof: imageFile(),
	method: vine.enum(DEPOSIT_METHOD_KINDS),
	expectedAmount: vine.number().withoutDecimals().range([1, 1_000_000_000]),
});

export type DepositProofInput = Infer<typeof depositProofValidator>;

depositProofValidator.messagesProvider = new SimpleMessagesProvider({
	"proof.required": PROOF_MESSAGE,
	"proof.file": PROOF_MESSAGE,
	"proof.file.size": "Use an image of 10 MB or less.",
	"proof.file.extname": IMAGE_FORMAT_MESSAGE,
	"method.required": METHOD_MESSAGE,
	"method.enum": METHOD_MESSAGE,
	"expectedAmount.required": AMOUNT_MESSAGE,
	"expectedAmount.number": AMOUNT_MESSAGE,
	"expectedAmount.withoutDecimals": AMOUNT_MESSAGE,
	"expectedAmount.range": AMOUNT_MESSAGE,
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=deposit_proof_validator.spec.ts`
Expected: PASS. If a message test fails with VineJS's default text, the rule name differs from the key: print `error.messages` (each carries `rule`) and key the message by that rule (`"<field>.<rule>"`); keep the messages verbatim. If an empty `method` gives `required` instead of `enum`, both keys already carry the same message.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/validators/deposit_proof.ts apps/platform/tests/unit/modules/payments/deposit_proof_validator.spec.ts
git -C <repo> commit -m "feat(platform): validate deposit proofs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `DepositPageService`: the page and the proof

**Files:**
- Create: `apps/platform/app/modules/payments/services/deposit_page_service.ts`
- Modify: `apps/platform/tests/helpers/deposits.ts`
- Test: `apps/platform/tests/functional/payments/deposit_page_service.spec.ts` (create)

**Interfaces:**
- Consumes: Task 3's `depositState`, `DepositMethodKind`; Task 4's `DepositService.remaining`/`pendingProof`/`lastDecisionRejected`/`recordProof`, `PaymentMethodService.listForDepositPage`, `ProjectService.findLive`/`lockLive`; Task 5's `DepositLinkService.resolve`, `DepositProofError`, `DepositPageNotFoundError`; Task 6's `DepositProofAlertJob`; `ArtistService.list`, `ImageService.store`/`url`/`delete`, `afterRollback`, `withTransaction`, `dispatchInTransaction`.
- Produces: `DepositPageService` (default export of `#modules/payments/services/deposit_page_service`, `@inject()` with `DepositLinkService`, `ProjectService`, `QuoteService`, `DepositService`, `PaymentMethodService`, `ArtistService`, `ImageService`): `show(tenant: DepositStudio, token: string): Promise<DepositPage>` and `submitProof(tenant: DepositStudio, token: string, submission: ProofSubmission): Promise<DepositPage>` (both throw `DepositPageNotFoundError` for a dead link), `protected precheck(tenant, token, submission): Promise<DepositPage>`; types `DepositStudio = Pick<Tenant, "id" | "name" | "timezone" | "depositPolicy">`, `ShownMethod = { kind; label; accountName; accountNumber; bankName; qrImageUrl: string | null }`, `DepositPage = { projectId: string; studioName: string; timezone: string; depositPolicy: string | null; brief: string; artistName: string | null; quote: Quote; due: number; referenceCode: string; state: DepositState; lastProofRejected: boolean; proofSubmittedAt: DateTime | null; methods: ShownMethod[] }`, `ProofSubmission = { proof: Pick<MultipartFile, "tmpPath">; method: DepositMethodKind; expectedAmount: number }`. `depositServices()` also returns `pages`.

- [ ] **Step 1: The helper gets the page service**

In `apps/platform/tests/helpers/deposits.ts`, add `import DepositPageService from "#modules/payments/services/deposit_page_service";` and, in `depositServices`, replace `return { images, artists, quotes, deposits, projects, methods, links };` with:

```ts
	const pages = new DepositPageService(
		links,
		projects,
		quotes,
		deposits,
		methods,
		artists,
		images,
	);
	return { images, artists, quotes, deposits, projects, methods, links, pages };
```

- [ ] **Step 2: Write the failing tests**

Create `apps/platform/tests/functional/payments/deposit_page_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { InvalidImageError } from "#modules/media/errors";
import { newTokenNonce, tokenFor } from "#modules/payments/deposit_links";
import {
	DepositPageNotFoundError,
	DepositProofError,
} from "#modules/payments/errors";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import Payment from "#modules/payments/models/payment";
import DepositPageService, {
	type DepositStudio,
	type ProofSubmission,
} from "#modules/payments/services/deposit_page_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withDbContext } from "#services/db_context";
import { depositReady, depositServices, OWNER } from "#tests/helpers/deposits";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { makeArtist, makePayment } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Skips the pre-check, as if another submission landed between it and the
 * project's lock: only the check under the lock can refuse it.
 */
class RacingPages extends DepositPageService {
	protected override async precheck(tenant: DepositStudio, token: string) {
		return this.show(tenant, token);
	}
}

const verified = () => ({ status: "verified" as const, verifiedAt: DateTime.utc() });

/** A studio with a deposit-pending project, its eSewa method and its link. */
async function studioWithDeposit(
	slug: string,
	services = depositServices(),
	quote: Parameters<typeof depositReady>[1] = {},
) {
	const { tenant } = await studioWithOwner(slug, "Black Needle");
	const ready = await inTenant(tenant, () => depositReady(tenant, quote));
	const issued = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	return { tenant, services, ...ready, ...issued };
}

const submission = async (
	over: Partial<ProofSubmission> = {},
): Promise<ProofSubmission> => ({
	proof: await uploadOf(await testImages.png()),
	method: "esewa",
	expectedAmount: 300_000,
	...over,
});

const show = (
	services: ReturnType<typeof depositServices>,
	tenant: Tenant,
	token: string,
) => inTenant(tenant, () => services.pages.show(tenant, token));

/** The DepositProofError reason a refused submit gives, or null if it went through. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof DepositProofError) return error.reason;
		throw error;
	}
}

const paymentsOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () =>
		Payment.query().where("project_id", projectId).orderBy("id"),
	);

const privateFile = (key: string) => drive.use("private").exists(key);

/** Rows in the queue table, committed or in the test's transaction. */
const queuedJobs = async () =>
	Number((await db.from("queue_jobs").count("* as total"))[0].total);

test.group("DepositPageService.show", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a due deposit: the studio, the brief and artist, what is due, the code, the methods and the policy", async ({
		assert,
	}) => {
		const { tenant, services, project, link, token } =
			await studioWithDeposit("page-due-65");
		await inTenant(tenant, async () => {
			tenant.merge({ depositPolicy: "Deposits hold your date." });
			await tenant.save();
			const artist = await makeArtist(tenant, "sita");
			project.artistId = artist.id;
			await project.save();
		});

		const page = await show(services, tenant, token);

		assert.deepEqual(
			{
				projectId: page.projectId,
				studioName: page.studioName,
				timezone: page.timezone,
				depositPolicy: page.depositPolicy,
				brief: page.brief,
				artistName: page.artistName,
				deposit: page.quote.depositAmount,
				due: page.due,
				referenceCode: page.referenceCode,
				state: page.state,
				lastProofRejected: page.lastProofRejected,
				proofSubmittedAt: page.proofSubmittedAt,
				methods: page.methods,
			},
			{
				projectId: project.id,
				studioName: "Black Needle",
				timezone: "Asia/Kathmandu",
				depositPolicy: "Deposits hold your date.",
				brief: "A small fine-line moth on the forearm",
				artistName: "Sita",
				deposit: 300_000,
				due: 300_000,
				referenceCode: link.referenceCode,
				state: "due",
				lastProofRejected: false,
				proofSubmittedAt: null,
				methods: [
					{
						kind: "esewa",
						label: "eSewa",
						accountName: "Black Needle",
						accountNumber: "9801234567",
						bankName: null,
						qrImageUrl: null,
					},
				],
			},
		);
	});

	test("a QR code shows by its public URL; hidden and cash methods don't show", async ({
		assert,
	}) => {
		const { tenant, services, token } = await studioWithDeposit("page-qr-65");
		await inTenant(tenant, async () => {
			await services.methods.create(tenant, {
				kind: "khalti",
				label: "Khalti",
				accountNumber: "9800000002",
				showOnDepositPage: true,
				qr: await uploadOf(await testImages.png()),
			});
			await services.methods.create(tenant, {
				kind: "bank",
				label: "Hidden bank",
				bankName: "NIC Asia Bank",
				accountName: "Black Needle",
				accountNumber: "0123456789",
			});
			await services.methods.create(tenant, { kind: "cash", label: "Cash" });
		});

		const { methods } = await show(services, tenant, token);

		assert.deepEqual(
			methods.map(({ label }) => label),
			["eSewa", "Khalti"],
		);
		assert.match(
			methods[1].qrImageUrl ?? "",
			new RegExp(`/uploads/tenants/${tenant.id}/payment_qr/`),
		);
	});

	test("each state, with payment methods only while due", async ({
		assert,
	}) => {
		const services = depositServices();
		const { tenant } = await studioWithOwner("page-states-65", "Black Needle");
		const made = async () => {
			const ready = await depositReady(tenant);
			const { token } = await services.links.issue(tenant, OWNER, ready.project);
			return { ...ready, token };
		};
		const cases = await inTenant(tenant, async () => {
			const waiting = await made();
			const proof = await makePayment(tenant, waiting.project, {
				method: "esewa",
			});
			// Revised after the client paid: back in quoted, still paid (TAT-64).
			const paid = await made();
			await makePayment(tenant, paid.project, verified());
			paid.project.status = "quoted";
			await paid.project.save();
			const cancelled = await made();
			cancelled.project.status = "cancelled";
			await cancelled.project.save();
			const revising = await made();
			revising.project.status = "quoted";
			await revising.project.save();
			const expired = await made();
			expired.quote.expiresAt = DateTime.utc().minus({ minutes: 1 });
			await expired.quote.save();
			return { waiting, proof, paid, cancelled, revising, expired };
		});

		const waiting = await show(services, tenant, cases.waiting.token);
		assert.equal(waiting.state, "submitted");
		assert.equal(
			waiting.proofSubmittedAt?.toMillis(),
			cases.proof.createdAt.toMillis(),
		);
		for (const [name, state] of [
			["paid", "paid"],
			["cancelled", "cancelled"],
			["revising", "updating"],
			["expired", "expired"],
		] as const) {
			const page = await show(services, tenant, cases[name].token);
			assert.equal(page.state, state, name);
			assert.deepEqual(page.methods, [], name);
		}
		assert.equal((await show(services, tenant, cases.paid.token)).due, 0);
		assert.deepEqual(waiting.methods, []);
	});

	test("a rejected last screenshot is flagged on the due page", async ({
		assert,
	}) => {
		const { tenant, services, project, token } =
			await studioWithDeposit("page-rejected-65");
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			}),
		);

		const page = await show(services, tenant, token);

		assert.equal(page.state, "due");
		assert.isTrue(page.lastProofRejected);
	});

	test("a dead link is DepositPageNotFoundError: unknown, replaced, expired, deleted project, another studio's", async ({
		assert,
	}) => {
		const mine = await studioWithDeposit("page-dead-a-65");
		const theirs = await studioWithDeposit("page-dead-b-65", mine.services);
		const { tenant, services, project, link, token } = mine;
		const dead = (candidate: string) =>
			assert.rejects(
				() => show(services, tenant, candidate),
				DepositPageNotFoundError,
			);

		await dead(tokenFor(newTokenNonce()));
		await dead(theirs.token);

		const replaced = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, project),
		);
		await dead(token);

		await inTenant(tenant, async () => {
			link.merge({ expiresAt: DateTime.utc().minus({ seconds: 1 }) });
			await link.save();
		});
		await dead(replaced.token);

		const other = await inTenant(tenant, async () => {
			const ready = await depositReady(tenant);
			const issued = await services.links.issue(tenant, OWNER, ready.project);
			await ready.project.softDelete();
			return issued;
		});
		await dead(other.token);
	});
});

test.group("DepositPageService.submitProof", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("records a submitted deposit payment with its private image, queues the alert, and answers in submitted", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const { tenant, services, project, token } = await studioWithDeposit(
			"proof-take-65",
			depositServices(images),
		);
		const fake = queue.fake();

		const page = await inTenant(tenant, async () =>
			services.pages.submitProof(tenant, token, await submission()),
		);

		assert.equal(page.state, "submitted");
		assert.deepEqual(page.methods, []);
		const payments = await paymentsOf(tenant, project.id);
		assert.deepEqual(
			payments.map((row) => [
				row.kind,
				row.status,
				row.amount,
				row.currency,
				row.method,
				row.proofImageKey,
				row.proofImageWidth,
				row.proofImageHeight,
			]),
			[["deposit", "submitted", 300_000, "NPR", "esewa", images.keys[0], 300, 200]],
		);
		assert.match(images.keys[0], new RegExp(`^tenants/${tenant.id}/payment_proof/`));
		assert.isTrue(await privateFile(images.keys[0]));
		fake.assertPushed(DepositProofAlertJob, {
			payload: { tenantId: tenant.id, paymentId: payments[0].id },
		});
		fake.assertPushedCount(1);
	});

	test("it records what is still due, and refuses the amount the page no longer shows", async ({
		assert,
	}) => {
		const { tenant, services, project, token } =
			await studioWithDeposit("proof-due-65");
		await inTenant(tenant, () =>
			makePayment(tenant, project, { amount: 100_000, ...verified() }),
		);

		assert.equal(
			await reasonOf(async () =>
				inTenant(tenant, async () =>
					services.pages.submitProof(tenant, token, await submission()),
				),
			),
			"amount_changed",
		);
		await inTenant(tenant, async () =>
			services.pages.submitProof(
				tenant,
				token,
				await submission({ expectedAmount: 200_000 }),
			),
		);

		const waiting = (await paymentsOf(tenant, project.id)).filter(
			(row) => row.status === "submitted",
		);
		assert.deepEqual(
			waiting.map((row) => row.amount),
			[200_000],
		);
	});

	test("every refusal comes before the image is decoded, and changes nothing", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const services = depositServices(images);
		const { tenant } = await studioWithOwner("proof-refuse-65", "Black Needle");
		const made = async () => {
			const ready = await depositReady(tenant);
			const { token } = await services.links.issue(tenant, OWNER, ready.project);
			return { ...ready, token };
		};
		const cases = await inTenant(tenant, async () => {
			const waiting = await made();
			await makePayment(tenant, waiting.project, { method: "esewa" });
			const paid = await made();
			await makePayment(tenant, paid.project, verified());
			const cancelled = await made();
			cancelled.project.status = "cancelled";
			await cancelled.project.save();
			const expired = await made();
			expired.quote.expiresAt = DateTime.utc().minus({ minutes: 1 });
			await expired.quote.save();
			const due = await made();
			return [
				[waiting.token, {}, "not_due"],
				[paid.token, {}, "not_due"],
				[cancelled.token, {}, "not_due"],
				[expired.token, {}, "not_due"],
				[due.token, { method: "khalti" }, "method_unavailable"],
				[due.token, { expectedAmount: 250_000 }, "amount_changed"],
			] as const;
		});
		const before = await inTenant(tenant, () => Payment.query().orderBy("id"));

		for (const [token, over, reason] of cases) {
			assert.equal(
				await reasonOf(async () =>
					inTenant(tenant, async () =>
						services.pages.submitProof(tenant, token, await submission(over)),
					),
				),
				reason,
				reason,
			);
		}

		assert.deepEqual(images.keys, [], "no image was decoded");
		assert.deepEqual(
			(await inTenant(tenant, () => Payment.query().orderBy("id"))).map(
				({ id }) => id,
			),
			before.map(({ id }) => id),
		);
	});

	test("an upload that isn't an image is InvalidImageError, and nothing is kept", async ({
		assert,
	}) => {
		const { tenant, services, project, token } =
			await studioWithDeposit("proof-fake-65");

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					services.pages.submitProof(
						tenant,
						token,
						await submission({
							proof: await uploadOf(Buffer.from("<?php echo 'hi'; ?>")),
						}),
					),
				),
			InvalidImageError,
		);
		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
	});

	test("a submission that loses the race under the lock is refused, and its stored image is deleted", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const services = depositServices(images);
		const racing = new RacingPages(
			services.links,
			services.projects,
			services.quotes,
			services.deposits,
			services.methods,
			services.artists,
			images,
		);
		const { tenant, project, token } = await studioWithDeposit(
			"proof-race-65",
			services,
		);
		const winner = await inTenant(tenant, () =>
			makePayment(tenant, project, { method: "esewa" }),
		);

		assert.equal(
			await reasonOf(async () =>
				inTenant(tenant, async () =>
					racing.submitProof(tenant, token, await submission()),
				),
			),
			"not_due",
		);
		assert.lengthOf(images.keys, 1, "the image was stored before the lock");
		assert.isFalse(await privateFile(images.keys[0]));
		assert.deepEqual(
			(await paymentsOf(tenant, project.id)).map(({ id }) => id),
			[winner.id],
		);
	});

	test("a failure later in the request deletes the image and drops the alert", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const { tenant, services, project, token } = await studioWithDeposit(
			"proof-later-65",
			depositServices(images),
		);
		const before = await queuedJobs();

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await services.pages.submitProof(tenant, token, await submission());
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.lengthOf(images.keys, 1);
		assert.isFalse(await privateFile(images.keys[0]));
		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
		assert.equal(await queuedJobs(), before);

		// The positive control: a submission that commits leaves its job.
		await inTenant(tenant, async () =>
			services.pages.submitProof(tenant, token, await submission()),
		);
		assert.equal(await queuedJobs(), before + 1);
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=deposit_page_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/services/deposit_page_service` in the log.

- [ ] **Step 4: Write the service**

Create `apps/platform/app/modules/payments/services/deposit_page_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import {
	type DepositMethodKind,
	type DepositState,
	depositState,
} from "#modules/payments/deposit_page";
import {
	DepositPageNotFoundError,
	DepositProofError,
} from "#modules/payments/errors";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import type PaymentMethod from "#modules/payments/models/payment_method";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type Quote from "#modules/projects/models/quote";
import { isExpired } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";

/** What the page needs of the studio: the public tenant the path resolved. */
export type DepositStudio = Pick<
	Tenant,
	"id" | "name" | "timezone" | "depositPolicy"
>;

/** A payment method as the page shows it: the kind's own details and a public QR URL. */
export type ShownMethod = Pick<
	PaymentMethod,
	"kind" | "label" | "accountName" | "accountNumber" | "bankName"
> & { qrImageUrl: string | null };

/** The deposit page of one link (openapi.yaml, DepositPage, before formatting). */
export type DepositPage = {
	projectId: string;
	studioName: string;
	timezone: string;
	depositPolicy: string | null;
	brief: string;
	artistName: string | null;
	/** The project's current quote: its deposit, currency and expiry. */
	quote: Quote;
	/** What is still to pay, in minor units (DepositService.remaining). */
	due: number;
	referenceCode: string;
	state: DepositState;
	/** In `due`: the studio rejected the last screenshot. */
	lastProofRejected: boolean;
	/** When the screenshot that waits was sent, or null. */
	proofSubmittedAt: DateTime | null;
	/** The studio's deposit-page methods, only in `due`; otherwise empty. */
	methods: ShownMethod[];
};

/** A validated proof: the upload, how the client paid and the `due` the page showed. */
export type ProofSubmission = {
	proof: Pick<MultipartFile, "tmpPath">;
	method: DepositMethodKind;
	expectedAmount: number;
};

const PURPOSE = "payment_proof";

/**
 * The public deposit page (TAT-65): what a link's token shows, and the one
 * write it takes, the client's payment screenshot. The tenant comes from
 * the path (the public API's request transaction, in its RLS context); a
 * link that doesn't work is DepositPageNotFoundError, whatever the reason.
 */
@inject()
export default class DepositPageService {
	constructor(
		private links: DepositLinkService,
		private projects: ProjectService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private methods: PaymentMethodService,
		private artists: ArtistService,
		private images: ImageService,
	) {}

	/**
	 * The page of `token`: the live link, its live project and the current
	 * quote, else DepositPageNotFoundError. A link is only made for a quoted
	 * project and quotes are never deleted, so a missing quote is a dead
	 * link too. Payment methods come only while the deposit is due.
	 */
	async show(tenant: DepositStudio, token: string): Promise<DepositPage> {
		const link = await this.links.resolve(tenant, token);
		const project = link
			? await this.projects.findLive(tenant, link.projectId)
			: null;
		const quote = project ? await this.quotes.current(tenant, project) : null;
		if (!link || !project || !quote) throw new DepositPageNotFoundError();

		const due = await this.deposits.remaining(tenant, project, quote);
		const pending = await this.deposits.pendingProof(tenant, project);
		const state = depositState({
			status: project.status,
			quoteExpired: isExpired(quote),
			settled: due === 0,
			proofPending: pending !== null,
		});
		return {
			projectId: project.id,
			studioName: tenant.name,
			timezone: tenant.timezone,
			depositPolicy: tenant.depositPolicy,
			brief: project.brief,
			artistName: await this.artistName(tenant, project.artistId),
			quote,
			due,
			referenceCode: link.referenceCode,
			state,
			lastProofRejected:
				state === "due" &&
				(await this.deposits.lastDecisionRejected(tenant, project)),
			proofSubmittedAt: pending?.createdAt ?? null,
			methods: state === "due" ? await this.shownMethods(tenant) : [],
		};
	}

	/**
	 * Records the client's screenshot as a `submitted` deposit payment of
	 * what is due, all or nothing, and queues the owners' alert. The page is
	 * checked first (DepositProofError: `not_due`, `method_unavailable`,
	 * `amount_changed`), so a refusal decodes no image. Then the image is
	 * stored with its deletion registered at once, before any row lock (the
	 * backend conventions), the project is locked and the page checked
	 * again: a submission that lost a race to another one is refused there,
	 * and its savepoint's rollback deletes its image. InvalidImageError for
	 * an upload that isn't an image we take. Returns the page as it now is
	 * (`submitted`).
	 */
	async submitProof(
		tenant: DepositStudio,
		token: string,
		submission: ProofSubmission,
	): Promise<DepositPage> {
		const before = await this.precheck(tenant, token, submission);
		return withTransaction(async (trx) => {
			const proof = await this.images.store(submission.proof, {
				tenant,
				purpose: PURPOSE,
			});
			afterRollback(() => this.images.delete(PURPOSE, proof.key));

			const project = await this.projects.lockLive(
				trx,
				tenant,
				before.projectId,
			);
			if (!project) throw new DepositPageNotFoundError();
			const now = await this.show(tenant, token);
			assertTakes(now, submission);

			const payment = await this.deposits.recordProof(tenant, project, {
				amount: now.due,
				currency: now.quote.currency,
				method: submission.method,
				proof,
			});
			await dispatchInTransaction(
				DepositProofAlertJob.dispatch({
					tenantId: tenant.id,
					paymentId: payment.id,
				}),
				trx,
			);
			return this.show(tenant, token);
		});
	}

	/**
	 * The page before anything is stored, refusing what can be refused
	 * already. Protected, so a test can skip it to stage a race that only the
	 * check under the lock can catch.
	 */
	protected async precheck(
		tenant: DepositStudio,
		token: string,
		submission: ProofSubmission,
	): Promise<DepositPage> {
		const page = await this.show(tenant, token);
		assertTakes(page, submission);
		return page;
	}

	private async artistName(
		tenant: DepositStudio,
		artistId: string | null,
	): Promise<string | null> {
		if (!artistId) return null;
		const artists = await this.artists.list(tenant);
		return artists.find(({ id }) => id === artistId)?.name ?? null;
	}

	private async shownMethods(tenant: DepositStudio): Promise<ShownMethod[]> {
		const methods = await this.methods.listForDepositPage(tenant);
		return Promise.all(
			methods.map(async (method) => ({
				kind: method.kind,
				label: method.label,
				accountName: method.accountName,
				accountNumber: method.accountNumber,
				bankName: method.bankName,
				qrImageUrl: method.qrImageKey
					? await this.images.url("payment_qr", method.qrImageKey)
					: null,
			})),
		);
	}
}

/** Refuses a proof the page can't take: not due, a method it doesn't list, a stale amount. */
function assertTakes(
	page: DepositPage,
	{ method, expectedAmount }: Pick<ProofSubmission, "method" | "expectedAmount">,
) {
	if (page.state !== "due") throw new DepositProofError("not_due");
	if (!page.methods.some(({ kind }) => kind === method)) {
		throw new DepositProofError("method_unavailable");
	}
	if (expectedAmount !== page.due) {
		throw new DepositProofError("amount_changed");
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=deposit_page_service.spec.ts --files=deposit_link_service.spec.ts`
Expected: PASS. (If "a failure later in the request" leaves the file, the image was stored outside the savepoint: keep `store` and `afterRollback` inside the `withTransaction` callback, with no `await` between them.)

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors. (If Biome reorders or merges the two imports from `#modules/payments/deposit_page` or the type imports, keep its version.)

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/services/deposit_page_service.ts apps/platform/tests/helpers/deposits.ts apps/platform/tests/functional/payments/deposit_page_service.spec.ts
git -C <repo> commit -m "feat(platform): show the deposit page and take a payment screenshot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The deposit link on the project page (route, panel props, isolation)

**Files:**
- Modify: `apps/platform/app/modules/payments/deposit_links.ts`, `apps/platform/app/controllers/projects_controller.ts`, `apps/platform/inertia/components/projects.ts` (the prop's type; Task 10 renders it), `apps/platform/start/routes.ts`, `apps/platform/tests/helpers/tenants.ts`, `apps/platform/tests/isolation/cases.ts`
- Create: `apps/platform/app/controllers/deposit_links_controller.ts`
- Regenerate: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/payments/deposit_links_http.spec.ts` (create)

**Interfaces:**
- Consumes: Task 5's `DepositLinkService` (`issue`, `issueProblem`, `forProject`), `DepositLinkRuleError`, `depositServices`, `depositReady`; Task 4's `DepositService.remaining`/`pendingProof`; Task 2's `depositMessage`; `chatLinks`, `formatMoney`, `formatDay`.
- Produces: `DEPOSIT_LINK_PROBLEMS: Record<DepositLinkRuleReason, string>` in `#modules/payments/deposit_links`; route `POST /t/:tenant/projects/:id/deposit-link` named `tenant.projects.deposit_link.store` (`DepositLinksController.store`); types `ChatMessageProps` and `ProjectPageProps["deposit"]` in `~/components/projects`; the project page prop `deposit: { link: { url: string | null; referenceCode: string; expiresText: string } | null; problem: string | null; message: { text: string; whatsappUrl: string; viberUrl: string } | null; proofReceivedText: string | null } | null` (owners, `deposit_pending` only). The `twoStudios()` fixture gains `depositMethod`, `depositProject`, `depositToken`, `depositReferenceCode`; `IsolationCase.resource` gains `"depositProject"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/deposit_links_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import { chatLinks } from "#modules/clients/contact_links";
import { depositPageUrl, tokenFor } from "#modules/payments/deposit_links";
import DepositLink from "#modules/payments/models/deposit_link";
import { formatDay } from "#modules/projects/quotes";
import { depositReady, depositServices } from "#tests/helpers/deposits";
import { makeArtist, makePayment } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "deposit-needle-65";
const KTM = "Asia/Kathmandu";
const page = (id: string) => `/t/${SLUG}/projects/${id}`;
const linkRoute = (id: string) => `${page(id)}/deposit-link`;
const URL_SHAPE = new RegExp(
	`^http://${SLUG}\\.localhost:3000/deposit#[A-Za-z0-9_-]{43}$`,
);
const { links } = depositServices();

async function ready() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
	const { project, client, method } = await inTenant(tenant, () =>
		depositReady(tenant),
	);
	return { owner, tenant, project, client, method };
}

/** The project page's deposit prop for `user`. */
async function panelFor(client: ApiClient, user: User, projectId: string) {
	const response = await client
		.get(page(projectId))
		.withInertia()
		.loginAs(user);
	response.assertStatus(200);
	return response.inertiaProps.deposit;
}

function makeLink(client: ApiClient, user: User, projectId: string) {
	return client
		.post(linkRoute(projectId))
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

const linkOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () =>
		DepositLink.query().where("project_id", projectId).first(),
	);

test.group("The deposit link on the project page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("before a link, the panel offers one", async ({ client, assert }) => {
		const { owner, project } = await ready();

		assert.deepEqual(await panelFor(client, owner, project.id), {
			link: null,
			problem: null,
			message: null,
			proofReceivedText: null,
		});
	});

	test("an owner makes the link; the page shows it, the code, its last day and the chat message", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, client: customer } = await ready();

		const response = await makeLink(client, owner, project.id);

		response.assertStatus(302);
		response.assertHeader("location", page(project.id));
		response.assertFlashMessage(
			"success",
			"Deposit link ready: send it to the client.",
		);
		const link = await linkOf(tenant, project.id);
		const panel = await panelFor(client, owner, project.id);
		const url = depositPageUrl(SLUG, tokenFor(link?.tokenNonce ?? ""));
		assert.match(panel.link.url, URL_SHAPE);
		assert.equal(panel.link.url, url);
		assert.equal(panel.link.referenceCode, link?.referenceCode);
		assert.equal(
			panel.link.expiresText,
			formatDay(link?.expiresAt.setZone(KTM).toFormat("yyyy-MM-dd") ?? ""),
		);
		assert.isNull(panel.problem);
		const text = `Hi Sita, please pay your deposit of NPR 3,000 to Black Needle. Write ${link?.referenceCode} in the payment remark, then send a screenshot of the payment on this page:\n${url}`;
		const chat = chatLinks(customer.phone ?? "", text);
		assert.deepEqual(panel.message, {
			text,
			whatsappUrl: chat.whatsapp,
			viberUrl: chat.viber,
		});
	});

	test("New link replaces it: another URL, the same code, and the old token is dead", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await makeLink(client, owner, project.id);
		const before = await panelFor(client, owner, project.id);

		const response = await makeLink(client, owner, project.id);

		response.assertFlashMessage(
			"success",
			"New link made. The old one no longer works.",
		);
		const after = await panelFor(client, owner, project.id);
		assert.notEqual(after.link.url, before.link.url);
		assert.equal(after.link.referenceCode, before.link.referenceCode);
		const oldToken = new URL(before.link.url).hash.slice(1);
		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, oldToken)),
		);
	});

	test("an artist, even the assigned one, gets a 404 and no panel", async ({
		client,
		assert,
	}) => {
		const { tenant, project } = await ready();
		const asha = await artistIn(tenant, "asha@deposit-needle-65.example");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			project.artistId = profile.id;
			await project.save();
		});

		const response = await makeLink(client, asha, project.id);

		response.assertStatus(404);
		assert.isNull(await panelFor(client, asha, project.id));
		assert.isNull(await linkOf(tenant, project.id));
	});

	test("a project that isn't waiting for a deposit shows no panel, and its POST says why", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await inTenant(tenant, async () => {
			project.status = "quoted";
			await project.save();
		});

		assert.isNull(await panelFor(client, owner, project.id));
		const response = await makeLink(client, owner, project.id);
		response.assertStatus(302);
		response.assertFlashMessage(
			"error",
			"A deposit link can only be made while the project waits for its deposit.",
		);
		assert.isNull(await linkOf(tenant, project.id));
	});

	test("with no method on the deposit page, the panel says what to fix and the POST refuses", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, method } = await ready();
		await inTenant(tenant, async () => {
			method.showOnDepositPage = false;
			await method.save();
		});
		const fix =
			"Show a payment method on the deposit page first (Settings, Payments).";

		assert.equal((await panelFor(client, owner, project.id)).problem, fix);
		(await makeLink(client, owner, project.id)).assertFlashMessage("error", fix);
		assert.isNull(await linkOf(tenant, project.id));
	});

	test("an expired link shows no URL or message, and New link makes a working one", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await makeLink(client, owner, project.id);
		await inTenant(tenant, async () => {
			const link = await DepositLink.query()
				.where("project_id", project.id)
				.firstOrFail();
			link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await link.save();
		});

		const expired = await panelFor(client, owner, project.id);
		assert.isNull(expired.link.url);
		assert.isString(expired.link.referenceCode);
		assert.isNull(expired.message);

		await makeLink(client, owner, project.id);
		assert.match((await panelFor(client, owner, project.id)).link.url, URL_SHAPE);
	});

	test("a waiting screenshot shows when it came", async ({ client, assert }) => {
		const { owner, tenant, project } = await ready();
		await inTenant(tenant, () => makePayment(tenant, project, { method: "esewa" }));

		assert.equal(
			(await panelFor(client, owner, project.id)).proofReceivedText,
			formatDay(DateTime.now().setZone(KTM).toFormat("yyyy-MM-dd")),
		);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposit_links_http.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: the panel prop is `undefined` and every POST is a 404 (no route).

- [ ] **Step 3: The owner's text for each problem**

In `apps/platform/app/modules/payments/deposit_links.ts`, add `import type { DepositLinkRuleReason } from "#modules/payments/errors";` to the imports, and append:

```ts
/** Why an owner can't make a deposit link now: the project page and its flash say it. */
export const DEPOSIT_LINK_PROBLEMS: Record<DepositLinkRuleReason, string> = {
	not_deposit_pending:
		"A deposit link can only be made while the project waits for its deposit.",
	quote_expired: "The quote has expired: revise it first.",
	nothing_due: "Nothing is left to pay on this deposit.",
	no_payment_methods:
		"Show a payment method on the deposit page first (Settings, Payments).",
};
```

- [ ] **Step 4: The controller and the route**

Create `apps/platform/app/controllers/deposit_links_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { DEPOSIT_LINK_PROBLEMS } from "#modules/payments/deposit_links";
import { DepositLinkRuleError } from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";

/**
 * Making or replacing a project's deposit link from its page (TAT-65). The
 * :id loads through ProjectService.findFor first, so another tenant's
 * project, or another artist's, is a 404; DepositLinkService then lets only
 * owners through (an assigned artist gets the same 404).
 */
@inject()
export default class DepositLinksController {
	constructor(
		private projects: ProjectService,
		private links: DepositLinkService,
	) {}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		try {
			const { replaced } = await this.links.issue(tenant, membership, project);
			ctx.session.flash(
				"success",
				replaced
					? "New link made. The old one no longer works."
					: "Deposit link ready: send it to the client.",
			);
		} catch (error) {
			if (!(error instanceof DepositLinkRuleError)) throw error;
			ctx.session.flash("error", DEPOSIT_LINK_PROBLEMS[error.reason]);
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}
}
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains `DepositLinks` in the controllers index.

In `apps/platform/start/routes.ts`, inside the `/projects` group, after the `.as("tenant.projects.artist.update");` statement, add:

```ts
				// Owners only: DepositLinkService gives anyone else a 404 (TAT-65).
				router
					.post(":id/deposit-link", [controllers.DepositLinks, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.deposit_link.store");
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains the route `tenant.projects.deposit_link.store`.

- [ ] **Step 5: The panel's props**

In `apps/platform/app/controllers/projects_controller.ts`:

- Add the imports:

```ts
import type Client from "#modules/clients/models/client";
import {
	DEPOSIT_LINK_PROBLEMS,
	depositMessage,
} from "#modules/payments/deposit_links";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
```

- In the constructor, after `private images: ImageService,`, add:

```ts
		private depositLinks: DepositLinkService,
		private deposits: DepositService,
```

- In `show`, in the object passed to `ctx.inertia.render("projects/show", …)`, after the `clientId: …` entry, add:

```ts
			// Owners only, while the project waits for its deposit (TAT-65).
			deposit:
				membership.role === "owner" && project.status === "deposit_pending"
					? await this.depositPanel(tenant, project, client)
					: null,
```

- After `show`, add:

```ts
	/**
	 * The deposit panel (TAT-65): the project's link, rebuilt from its nonce
	 * (`url` null once it no longer works), why a link can't be made now,
	 * the chat message that sends it (with a working link and a phone), and
	 * the day a screenshot came, while one waits.
	 */
	private async depositPanel(
		tenant: Tenant,
		project: TattooProject,
		client: Pick<Client, "name" | "phone"> | null,
	) {
		const day = (at: DateTime) =>
			formatDay(at.setZone(tenant.timezone).toFormat("yyyy-MM-dd"));
		const link = await this.depositLinks.forProject(tenant, project);
		const problem = await this.depositLinks.issueProblem(tenant, project);
		const quote = await this.quotes.current(tenant, project);
		const due = quote
			? await this.deposits.remaining(tenant, project, quote)
			: 0;
		const pending = await this.deposits.pendingProof(tenant, project);
		const url = link?.url ?? null;
		return {
			link: link
				? { url, referenceCode: link.referenceCode, expiresText: day(link.expiresAt) }
				: null,
			problem: problem ? DEPOSIT_LINK_PROBLEMS[problem] : null,
			message:
				link && url && client?.phone
					? chatMessage(
							depositMessage({
								clientName: client.name,
								studioName: tenant.name,
								dueText: formatMoney(due),
								referenceCode: link.referenceCode,
								url,
							}),
							client.phone,
						)
					: null,
			proofReceivedText: pending ? day(pending.createdAt) : null,
		};
	}
```

- Replace the body of `messageProps` (the three lines from `const text = quoteMessage(` to `return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };`) with:

```ts
	return chatMessage(
		quoteMessage({ clientName, studioName, quote, timezone }),
		phone,
	);
```

and add at the end of the file:

```ts
/** A chat message and the links that send it: WhatsApp prefilled, Viber to paste. */
function chatMessage(text: string, phone: string) {
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}
```

`ctx.inertia.render` checks the props against the page's props type (`.adonisjs/server/pages.d.ts`), so the type gets the new prop now (Task 10 renders it). In `apps/platform/inertia/components/projects.ts`, before `export type ProjectPageProps`, add:

```ts
/** A chat message and its one-tap links (WhatsApp prefilled; Viber's link takes no text). */
export type ChatMessageProps = {
	text: string;
	whatsappUrl: string;
	viberUrl: string;
};
```

In `ProjectPageProps`, replace `message: { text: string; whatsappUrl: string; viberUrl: string } | null;` with `message: ChatMessageProps | null;`, and add after `clientId`'s entry:

```ts
	/**
	 * Owners only, while the project waits for its deposit (TAT-65): the
	 * link (`url` null once it no longer works), why one can't be made now,
	 * the chat message that sends it, and the day a screenshot came.
	 */
	deposit: {
		link: {
			url: string | null;
			referenceCode: string;
			expiresText: string;
		} | null;
		problem: string | null;
		message: ChatMessageProps | null;
		proofReceivedText: string | null;
	} | null;
```

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=deposit_links_http.spec.ts --files=project_page.spec.ts --files=quotes_http.spec.ts`
Expected: PASS (the quote message is unchanged).

- [ ] **Step 6: The isolation fixture and case**

In `apps/platform/tests/helpers/tenants.ts`:

- Add `import { depositServices } from "#tests/helpers/deposits";` to the imports and, after `const artists = new ArtistService(new ImageService());`, add `const depositLinks = depositServices().links;`.
- In `studio()`, after the `newInquiry` block, add:

```ts
	// A deposit_pending project with its deposit link, and the eSewa method
	// the deposit page shows, for the deposit routes (TAT-65).
	const deposit = await inTenant(tenant, async () => {
		const method = await paymentMethods.create(tenant, {
			kind: "esewa",
			label: `${name} eSewa`,
			accountNumber: "9801234567",
			accountName: name,
			showOnDepositPage: true,
		});
		const project = await makeProject(tenant, pipeline.client, {
			status: "deposit_pending",
		});
		await makeQuote(tenant, project);
		const { link, token } = await depositLinks.issue(
			tenant,
			{ userId: owner.id, role: "owner" },
			project,
		);
		return { method, project, link, token };
	});
```

- In the returned object, after `client: pipeline.client,`, add:

```ts
		// The deposit routes' resources (TAT-65): the project for the
		// dashboard's :id, the raw token and the code for the public API.
		depositMethod: deposit.method,
		depositProject: deposit.project,
		depositToken: deposit.token,
		depositReferenceCode: deposit.link.referenceCode,
```

- In the comment above `twoStudios`, before "Later tickets add seed data", add: "a deposit_pending project with its deposit link (`depositProject`, `depositToken`, `depositReferenceCode`) and the eSewa method its page shows (`depositMethod`);".

In `apps/platform/tests/isolation/cases.ts`:

- Add `import DepositLink from "#modules/payments/models/deposit_link";` to the imports.
- In `IsolationCase.resource`, add `| "depositProject"` after `| "quotedProject"`.
- After the `projectRows` snapshot helper (or with the other snapshot helpers), add:

```ts
const depositLinkRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await DepositLink.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((link) => link.serialize()),
	);
```

- After the case for `PUT /t/:tenant/projects/:id/artist`, add:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/deposit-link",
		resource: "depositProject",
		actor: "owner",
		ownStatus: 302,
		// A new link replaces the nonce, hash and expiry: A's snapshot changes.
		snapshot: depositLinkRows,
	},
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=deposit_links_http.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts --files=public_api.spec.ts`
Expected: PASS: the route guard finds the new case, the cross-tenant harness proves B's slug and B's project are a 404 with B unchanged, and the public harness still passes with the bigger fixture.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/deposit_links.ts apps/platform/app/controllers/deposit_links_controller.ts apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/projects.ts apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/tests/helpers/tenants.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/payments/deposit_links_http.spec.ts
git -C <repo> commit -m "feat(platform): let owners make and replace a project's deposit link

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The deposit panel on screen, and the Projects badge

**Files:**
- Modify: `apps/platform/inertia/pages/projects/show.tsx`, `apps/platform/inertia/components/shell/nav_items.ts`, `apps/platform/inertia/components/shell/nav_badge.tsx`, `apps/platform/inertia/components/shell/side_nav.tsx`, `apps/platform/inertia/components/shell/tab_bar.tsx`, `apps/platform/inertia/layouts/app.tsx`, `apps/platform/app/middleware/inertia_middleware.ts`
- Test: `apps/platform/tests/unit/inertia/nav_items.spec.ts` (append), `apps/platform/tests/functional/payments/proof_badge.spec.ts` (create)

**Interfaces:**
- Consumes: Task 9's `deposit` prop, its types `ChatMessageProps` and `ProjectPageProps["deposit"]`, and route `tenant.projects.deposit_link.store`; Task 4's `DepositService.countPendingProofs`.
- Produces: the `DepositCard` on the project page; shared prop `proofCount: number | null` (owners on a tenant page); `navItems(tenant, inboxCount, proofCount = null)`; `ShellNavItem.badgeLabel?: string`; `NavBadge` prop `label` (default `"new"`).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/proof_badge.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { makeClient, makePayment, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "badge-needle-65";

test.group("Projects badge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the number of deposit proofs to check on every tenant page; artists get null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG);
		const artist = await artistIn(tenant, `artist@${SLUG}.example`);
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const one = await makeProject(tenant, customer, {
				status: "deposit_pending",
			});
			const two = await makeProject(tenant, customer, {
				status: "deposit_pending",
			});
			await makePayment(tenant, one);
			await makePayment(tenant, two);
			await makePayment(tenant, two, { kind: "session" });
			await makePayment(tenant, one, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
		});

		const ownerProps = (
			await client.get(`/t/${SLUG}/projects`).withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.proofCount, 2);

		const artistResponse = await client
			.get(`/t/${SLUG}/projects`)
			.withInertia()
			.loginAs(artist);
		artistResponse.assertStatus(200);
		assert.isNull(artistResponse.inertiaProps.proofCount);
	});
});
```

In `apps/platform/tests/unit/inertia/nav_items.spec.ts`, add `badgeLabel?: string;` to the `Item` type after `badge?: number;`, change `navItems`'s type in `NavModule` to

```ts
	navItems(
		tenant: { slug: string; role: string },
		inboxCount: number | null,
		proofCount?: number | null,
	): Item[];
```

and add, inside `test.group("navItems", …)`, after "the Inbox badge shows only above zero":

```ts
	test("the Projects badge counts deposit proofs to check, for owners only", ({
		assert,
	}) => {
		const projects = (role: string, count: number | null) =>
			navItems({ slug: "bnt", role }, 0, count).find(
				({ key }) => key === "projects",
			);

		assert.deepEqual(projects("owner", 2), {
			key: "projects",
			label: "Projects",
			route: "tenant.projects.index",
			badge: 2,
			badgeLabel: "to check",
		});
		assert.notProperty(projects("owner", 0), "badge");
		assert.notProperty(projects("owner", null), "badge");
		assert.notProperty(projects("artist", 4), "badge");
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=proof_badge.spec.ts`
Expected: FAIL (`proofCount` is `undefined`).

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=nav_items.spec.ts`
Expected: FAIL in "the Projects badge" (no `badge` on Projects).

- [ ] **Step 3: The shared count and the badge**

In `apps/platform/app/middleware/inertia_middleware.ts`, add `import DepositService from "#modules/payments/services/deposit_service";` after the `InquiryService` import; after the `inboxCount` block add:

```ts
		// The Projects badge: deposit proofs waiting for an owner (TAT-65).
		const proofCount =
			tenant && membership?.role === "owner" && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(
								await ctx.containerResolver.make(DepositService)
							).countPendingProofs(tenant),
					)
				: null;
```

and after the `inboxCount: ctx.inertia.always(inboxCount),` entry:

```ts
			/** Deposit proofs waiting for an owner; null unless an owner is on a tenant page. */
			proofCount: ctx.inertia.always(proofCount),
```

In `apps/platform/inertia/components/shell/nav_items.ts`:

- In `ShellNavItem`, replace the `badge` comment and line with:

```ts
	/** A count on the item (new inquiries, proofs to check); absent unless above zero. */
	badge?: number;
	/** What the badge counts, read by screen readers after the number: "new" when absent. */
	badgeLabel?: string;
```

- Replace the `navItems` comment's last sentence "The server 404s the rest anyway." with "Owners also see on Projects how many deposit proofs wait (TAT-65). The server 404s the rest anyway."
- Change the signature to `export function navItems(tenant: { slug: string; role: string }, inboxCount: number | null, proofCount: number | null = null): ShellNavItem[] {`.
- Replace the Projects entry with:

```ts
	items.push({
		key: "projects",
		label: "Projects",
		route: "tenant.projects.index",
		...(owner && proofCount && proofCount > 0
			? { badge: proofCount, badgeLabel: "to check" }
			: {}),
	});
```

Replace `apps/platform/inertia/components/shell/nav_badge.tsx` with:

```tsx
import { cn } from "cn";

/**
 * The count on a destination, e.g. new inquiries; read out as "3 new", or
 * with `label` ("2 to check").
 */
export default function NavBadge({
	count,
	label = "new",
	className,
}: {
	count: number;
	label?: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground tabular-nums",
				className,
			)}
		>
			{count}
			<span className="sr-only"> {label}</span>
		</span>
	);
}
```

In `apps/platform/inertia/components/shell/side_nav.tsx`, replace `{item.badge ? <NavBadge count={item.badge} /> : null}` with `{item.badge ? <NavBadge count={item.badge} label={item.badgeLabel} /> : null}`. In `apps/platform/inertia/components/shell/tab_bar.tsx`, add `label={item.badgeLabel}` to the `<NavBadge` element after `count={item.badge}`. In `apps/platform/inertia/layouts/app.tsx`, replace

```tsx
	const { tenant, inboxCount } = usePage().props;
	const items = tenant ? navItems(tenant, inboxCount) : [];
```

with

```tsx
	const { tenant, inboxCount, proofCount } = usePage().props;
	const items = tenant ? navItems(tenant, inboxCount, proofCount) : [];
```

- [ ] **Step 4: The panel**

(Task 9 added `ChatMessageProps` and `ProjectPageProps["deposit"]` to `~/components/projects`.) In `apps/platform/inertia/pages/projects/show.tsx`:

- Add `type ChatMessageProps,` to the import from `~/components/projects`.
- Add `deposit,` to `ProjectShow`'s destructured props (after `clientId,`).
- After the Quote card's closing `</Card>`, add:

```tsx
				{deposit && (
					<DepositCard
						projectId={project.id}
						deposit={deposit}
						onSent={markContacted}
					/>
				)}
```

- In `ChatMessage`, change the prop type `message: NonNullable<ProjectPageProps["message"]>;` to `message: ChatMessageProps;`.
- After the `ChatMessage` function, add:

```tsx
/**
 * The deposit link, for owners while the project waits for its deposit
 * (TAT-65): copy it or send it in a chat, read the reference code, replace
 * a leaked or expired link, and see when a screenshot came.
 */
function DepositCard({
	projectId,
	deposit,
	onSent,
}: {
	projectId: string;
	deposit: NonNullable<ProjectPageProps["deposit"]>;
	onSent: () => void;
}) {
	const tenant = useTenant();
	const [busy, setBusy] = useState(false);
	const { link, problem, message, proofReceivedText } = deposit;

	const issue = () => {
		if (
			link &&
			!window.confirm(
				"Make a new link? The link you sent before stops working.",
			)
		) {
			return;
		}
		router.post(
			urlFor("tenant.projects.deposit_link.store", {
				tenant: tenant.slug,
				id: projectId,
			}),
			{},
			{
				preserveScroll: true,
				onStart: () => setBusy(true),
				onFinish: () => setBusy(false),
			},
		);
	};
	const copy = (url: string) => {
		navigator.clipboard.writeText(url).then(
			() => toast.success("Link copied."),
			() => toast.error("Couldn't copy: select the link instead."),
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Deposit</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{proofReceivedText && (
					<output className="block rounded-md border p-3 text-sm">
						Payment screenshot received {proofReceivedText}.
					</output>
				)}
				{link?.url ? (
					<>
						<Field>
							<FieldLabel htmlFor="deposit-link">Deposit link</FieldLabel>
							<div className="flex gap-2">
								<Input
									id="deposit-link"
									readOnly
									value={link.url}
									onFocus={(event) => event.currentTarget.select()}
									className="min-w-0 flex-1"
								/>
								<Button
									type="button"
									variant="outline"
									onClick={() => copy(link.url ?? "")}
								>
									Copy link
								</Button>
							</div>
							<FieldDescription>
								Works until {link.expiresText}. The client pays with your QR
								codes and sends a screenshot there.
							</FieldDescription>
						</Field>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							<dt className="text-muted-foreground">Reference code</dt>
							<dd className="font-mono tracking-widest">
								{link.referenceCode}
							</dd>
						</dl>
						{message && <ChatMessage message={message} onSent={onSent} />}
					</>
				) : (
					<p className="text-sm text-muted-foreground">
						{link
							? `The link you sent no longer works. Make a new one: the reference code stays ${link.referenceCode}.`
							: "Make a link where the client pays the deposit with your QR codes and sends a screenshot."}
					</p>
				)}
				{problem ? (
					<p className="text-sm text-muted-foreground">{problem}</p>
				) : (
					<div>
						<Button
							type="button"
							size="sm"
							variant={link?.url ? "outline" : "default"}
							disabled={busy}
							onClick={issue}
						>
							{busy ? "Saving…" : link ? "New link" : "Make deposit link"}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
```

(`useState`, `router`, `toast`, `urlFor`, `useTenant`, `Button`, `Card*`, `Field`, `FieldDescription`, `FieldLabel` and `Input` are already imported in `show.tsx`; add any the file lacks.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=nav_items.spec.ts`
Expected: PASS.

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=proof_badge.spec.ts --files=inbox.spec.ts --files=project_page.spec.ts --files=deposit_links_http.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors (the inertia project too).

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/inertia apps/platform/app/middleware/inertia_middleware.ts apps/platform/tests/unit/inertia/nav_items.spec.ts apps/platform/tests/functional/payments/proof_badge.spec.ts
git -C <repo> commit -m "feat(platform): show the deposit link panel and a Projects badge for proofs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The deposit endpoints' rate limits

**Files:**
- Create: `apps/platform/app/modules/payments/deposit_limits.ts`, `apps/platform/app/middleware/deposit_throttle_middleware.ts`
- Modify: `apps/platform/start/kernel.ts`
- Test: `apps/platform/tests/unit/modules/payments/deposit_limits.spec.ts` (create)

**Interfaces:**
- Consumes: `digest`, `clientAddress` (`#services/rate_limits`); `limiter.multi` (`@adonisjs/limiter/services/main`).
- Produces: `DEPOSIT_LIMITS` and `type DepositAction = "read" | "submit"`, `depositLimitKeys(action, ip: string, token: string): { perAddress: string; perToken: string }` from `#modules/payments/deposit_limits`; named middleware `middleware.depositThrottle()` (`#middleware/deposit_throttle_middleware`). Its behaviour over HTTP is tested in Task 15.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/payments/deposit_limits.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	DEPOSIT_LIMITS,
	depositLimitKeys,
} from "#modules/payments/deposit_limits";
import { clientAddress, digest } from "#services/rate_limits";

const TOKEN = "T".repeat(43);
const IP = "203.0.113.7";

test.group("Deposit rate limits", () => {
	test("reads per 10 minutes, uploads per hour, per address and per token", ({
		assert,
	}) => {
		assert.deepEqual(DEPOSIT_LIMITS, {
			read: {
				perAddress: { requests: 120, duration: "10 mins" },
				perToken: { requests: 60, duration: "10 mins" },
			},
			submit: {
				perAddress: { requests: 20, duration: "1 hour" },
				perToken: { requests: 10, duration: "1 hour" },
			},
		});
	});

	test("the keys are digests: no address and no token in them", ({ assert }) => {
		const keys = depositLimitKeys("read", IP, TOKEN);

		assert.deepEqual(keys, {
			perAddress: `deposit_read_ip_${digest(IP)}`,
			perToken: `deposit_read_token_${digest(TOKEN)}`,
		});
		for (const key of Object.values(keys)) {
			assert.notInclude(key, IP);
			assert.notInclude(key, TOKEN);
			assert.isAtMost(key.length, 255);
		}
	});

	test("reads and uploads count apart; one IPv6 /64 is one address", ({
		assert,
	}) => {
		assert.notEqual(
			depositLimitKeys("read", IP, TOKEN).perToken,
			depositLimitKeys("submit", IP, TOKEN).perToken,
		);
		assert.equal(
			depositLimitKeys("read", "2001:db8:1:2::1", TOKEN).perAddress,
			depositLimitKeys("read", "2001:db8:1:2:ffff::9", TOKEN).perAddress,
		);
		assert.equal(
			depositLimitKeys("read", "2001:db8:1:2::1", TOKEN).perAddress,
			`deposit_read_ip_${digest(clientAddress("2001:db8:1:2::1"))}`,
		);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=deposit_limits.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/payments/deposit_limits` in the log.

- [ ] **Step 3: The limits, the keys and the middleware**

Create `apps/platform/app/modules/payments/deposit_limits.ts`:

```ts
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The deposit page's rate limits (TAT-65), per client address and per link
 * token, reads and proof uploads counted apart. Fixed windows, like
 * AUTH_LIMITS. Generous per address because many customers share one
 * carrier-NAT address. TAT-38 may move the per-address part ahead of the
 * tenant lookup; the per-token part stays here.
 */
export const DEPOSIT_LIMITS = {
	read: {
		perAddress: { requests: 120, duration: "10 mins" },
		perToken: { requests: 60, duration: "10 mins" },
	},
	submit: {
		perAddress: { requests: 20, duration: "1 hour" },
		perToken: { requests: 10, duration: "1 hour" },
	},
} as const;

export type DepositAction = keyof typeof DEPOSIT_LIMITS;

/**
 * The limiter keys of one request: digests (HMAC with APP_KEY), so
 * `rate_limits` holds neither the address nor the token.
 */
export function depositLimitKeys(
	action: DepositAction,
	ip: string,
	token: string,
) {
	return {
		perAddress: `deposit_${action}_ip_${digest(clientAddress(ip))}`,
		perToken: `deposit_${action}_token_${digest(token)}`,
	};
}
```

Create `apps/platform/app/middleware/deposit_throttle_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import limiter from "@adonisjs/limiter/services/main";
import {
	DEPOSIT_LIMITS,
	depositLimitKeys,
} from "#modules/payments/deposit_limits";
import { READ_METHODS } from "#services/public_api";

/**
 * The deposit routes' rate limits (TAT-65). Every request to
 * /deposits/:token counts against its client address, then its token
 * (GET and HEAD as reads, anything else as a proof upload), 404s and
 * refusals included. Over either limit it throws E_TOO_MANY_REQUESTS, which
 * the API answers as 429 `rate_limited` with Retry-After. Runs after
 * publicTenant and before the handler reads the body (the upload route is
 * in multipart.processManually), so a refused upload never reaches the
 * disk. The counts live on the limiter's own connection, so a request that
 * fails later still counts.
 */
export default class DepositThrottleMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const action = READ_METHODS.has(ctx.request.method()) ? "read" : "submit";
		const limits = DEPOSIT_LIMITS[action];
		const keys = depositLimitKeys(
			action,
			ctx.request.ip(),
			String(ctx.params.token),
		);
		// The address first, so a refused address never adds to the token's
		// count. multi() parses the durations in the objects it gets: copies.
		await limiter
			.multi([
				{ ...limits.perAddress, key: keys.perAddress },
				{ ...limits.perToken, key: keys.perToken },
			])
			.consume();
		return next();
	}
}
```

(`READ_METHODS` is TAT-32's set in `#services/public_api`. If it isn't there yet when you build this task, use `new Set(["GET", "HEAD"])` locally and switch to the import in Task 14.)

In `apps/platform/start/kernel.ts`, add to `router.named({ … })`, after `publicCache`:

```ts
	depositThrottle: () => import("#middleware/deposit_throttle_middleware"),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=deposit_limits.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors (`limiter.multi` takes `{ requests, duration, key }`; if its type wants mutable fields, the spreads already give copies).

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/payments/deposit_limits.ts apps/platform/app/middleware/deposit_throttle_middleware.ts apps/platform/start/kernel.ts apps/platform/tests/unit/modules/payments/deposit_limits.spec.ts
git -C <repo> commit -m "feat(platform): rate-limit the deposit endpoints per address and token

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12 (needs TAT-32/51): Contract, types, SDK and React

**Files:**
- Modify: `packages/types/openapi.yaml`, `packages/types/src/index.ts`
- Regenerate: `packages/types/src/openapi.gen.ts`
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`, `packages/react/src/queries.ts`, `packages/react/src/hooks.ts`, `packages/react/src/index.ts`, `packages/react/package.json`, `packages/react/tsconfig.json`, `pnpm-lock.yaml`, `packages/AGENTS.md`
- Create: `packages/react/tsconfig.test.json`
- Test: `packages/sdk/test/client.test.ts` (append), `packages/react/test/deposit.test.ts` (create)

**Interfaces:**
- Consumes: TAT-32's `request<T>(url, init, call)`, `getData`, `RequestOptions` (with TAT-51's `timeoutMs`), `UPLOAD_TIMEOUT_MS`, `TattooApiError`, `isTattooApiError`, and the test helpers `fakeFetch`, `json`, `client`, `hangUntilAborted`, `rejection` in `client.test.ts`; the contract's `MVP` tag (TAT-51), `Tenant` parameter, `CacheControl` header and shared responses.
- Produces: operations `getDeposit`, `submitDepositProof`; schemas `DepositState`, `DepositPaymentMethod`, `DepositPage`, `DepositProofForm`; parameter `DepositToken`; types `DepositState`, `DepositPaymentMethod`, `DepositPage`, `DepositProofForm` from `@tattoo-drip/types`; SDK `SubmitDepositProofInput = { proof: Blob; method: DepositPaymentMethod["kind"]; expectedAmount: number }`, `client.deposits.get(token: string, call?: RequestOptions): Promise<DepositPage>`, `client.deposits.submitProof(token: string, input: SubmitDepositProofInput, call?: RequestOptions): Promise<DepositPage>`; React `tattooKeys.deposit(tenant, token)`, `tattooQueries.deposit(client, token)`, `tattooMutations.submitDepositProof(client, queryClient, token)`, `useDeposit(token)`, `useSubmitDepositProof(token)`; `pnpm --filter @tattoo-drip/react test`.

- [ ] **Step 1: Write the failing SDK tests**

Append to `packages/sdk/test/client.test.ts`:

```ts
describe("deposits", () => {
	const TOKEN = "T".repeat(43);
	const PAGE = {
		studio: { name: "Black Needle" },
		project: { brief: "A fine-line moth", artistName: null },
		deposit: {
			amount: 300_000,
			amountText: "NPR 3,000",
			due: 300_000,
			dueText: "NPR 3,000",
			currency: "NPR",
			payBy: "2026-11-01",
			payByText: "1 Nov 2026",
		},
		referenceCode: "7K3M9Q",
		state: "due",
		lastProofRejected: false,
		proofSubmittedAt: null,
		paymentMethods: [],
		depositPolicy: null,
	};
	const proof = () =>
		new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

	test("get reads the token's page under the tenant, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: PAGE }));

		const page = await client(fetch).deposits.get(TOKEN);

		assert.deepEqual(page, PAGE);
		assert.equal(
			calls[0].url,
			`https://api.example.com/api/v1/tenants/api-needle-32/deposits/${TOKEN}`,
		);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("get encodes the token", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: PAGE }));

		await client(fetch).deposits.get("a/b?c");

		assert.match(calls[0].url, /\/deposits\/a%2Fb%3Fc$/);
	});

	test("a link that doesn't work is a 404 TattooApiError", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		const error = await rejection(client(fetch).deposits.get(TOKEN));

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 404);
		assert.equal(error.code, "not_found");
	});

	test("submitProof posts one multipart form and returns the new page", async () => {
		const submitted = { ...PAGE, state: "submitted" };
		const { calls, fetch } = fakeFetch(() => json(201, { data: submitted }));

		const page = await client(fetch).deposits.submitProof(TOKEN, {
			proof: proof(),
			method: "esewa",
			expectedAmount: 300_000,
		});

		assert.deepEqual(page, submitted);
		assert.equal(calls[0].init.method, "POST");
		assert.equal(
			calls[0].url,
			`https://api.example.com/api/v1/tenants/api-needle-32/deposits/${TOKEN}`,
		);
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.has("content-type"), false, "fetch sets the multipart boundary");
		const form = calls[0].init.body as FormData;
		assert.deepEqual([...form.keys()].sort(), ["expectedAmount", "method", "proof"]);
		assert.equal(form.get("method"), "esewa");
		assert.equal(form.get("expectedAmount"), "300000");
		assert.equal((form.get("proof") as File).type, "image/png");
	});

	test("a stale amount is a TattooApiError with deposit_changed", async () => {
		const { fetch } = fakeFetch(() =>
			json(409, {
				error: {
					code: "deposit_changed",
					message:
						"The deposit amount changed. Check the new amount before you upload.",
				},
			}),
		);

		const error = await rejection(
			client(fetch).deposits.submitProof(TOKEN, {
				proof: proof(),
				method: "esewa",
				expectedAmount: 250_000,
			}),
		);

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 409);
		assert.equal(error.code, "deposit_changed");
	});

	test("an upload waits longer than the client's timeout", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(
			() =>
				new Promise<Response>((resolve) =>
					setTimeout(() => resolve(json(201, { data: PAGE })), 60),
				),
		);

		const page = await client(fetch, { timeoutMs: 20 }).deposits.submitProof(
			TOKEN,
			{ proof: proof(), method: "esewa", expectedAmount: 300_000 },
		);

		assert.deepEqual(page, PAGE);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: FAIL: every `deposits` test (`Cannot read properties of undefined (reading 'get')` / `'submitProof'`); the earlier tests still pass.

- [ ] **Step 3: The contract**

In `packages/types/openapi.yaml`:

(a) After the whole `/tenants/{tenant}/inquiries:` path item (TAT-51), before `components:`, insert:

```yaml
  /tenants/{tenant}/deposits/{token}:
    parameters:
      - $ref: "#/components/parameters/Tenant"
      - $ref: "#/components/parameters/DepositToken"
    get:
      operationId: getDeposit
      tags: [MVP]
      summary: A project's deposit page, through its link
      description: |
        What the client's deposit page shows: the studio, the project's
        brief, the deposit, the reference code to write in the payment
        remark, the studio's payment methods (only while the deposit is
        due) and its deposit policy. Never cached. Every link that doesn't
        work (unknown, replaced, expired, another studio's, or its project
        gone) is the same 404. Rate-limited per address and per link.
      responses:
        "200":
          description: The deposit page
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { $ref: "#/components/schemas/DepositPage" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
        default: { $ref: "#/components/responses/Error" }
    post:
      operationId: submitDepositProof
      tags: [MVP]
      summary: Send a screenshot of the deposit payment
      description: |
        One `multipart/form-data` request: the screenshot (`proof`, a JPEG,
        PNG or WebP of 10 MB at most), how the client paid (`method`, one of
        the page's `paymentMethods` kinds) and the amount the page showed
        (`expectedAmount`, its `deposit.due`). The API keeps the image
        privately, records a payment for the studio to check, and answers
        with the page as it now is (`submitted`). One screenshot waits at a
        time. Under an old slug it is a 404. Rate-limited per address and
        per link.

        Own codes (409): `deposit_not_due` (the page's state isn't `due`, for
        example a screenshot already waits; reload the page) and
        `deposit_changed` (`expectedAmount` isn't what is due now; reload
        the page).
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema: { $ref: "#/components/schemas/DepositProofForm" }
            encoding:
              proof:
                contentType: image/jpeg, image/png, image/webp
      responses:
        "201":
          description: Received. The studio checks it and confirms on WhatsApp or Viber.
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { $ref: "#/components/schemas/DepositPage" }
        "400": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: The page can't take a screenshot now (`deposit_not_due`, `deposit_changed`)
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "413": { $ref: "#/components/responses/Error" }
        "415": { $ref: "#/components/responses/Error" }
        "422": { $ref: "#/components/responses/ValidationError" }
        "429": { $ref: "#/components/responses/RateLimited" }
        default: { $ref: "#/components/responses/Error" }

```

(b) Under `components.parameters`, after `Tenant`, add:

```yaml
    DepositToken:
      name: token
      in: path
      required: true
      description: |
        The deposit link's secret: the fragment of the link the studio sent
        (`https://<studio>/deposit#<token>`). A bearer secret: never log it
        or send it to analytics.
      schema:
        type: string
        pattern: "^[A-Za-z0-9_-]{43}$"
```

(c) In `ErrorResponse`'s `code` description, after the sentence that lists the intake codes (ending `` (409, `createInquiry`) ``), add: `` `deposit_not_due`, `deposit_changed` (409, `submitDepositProof`). `` (keep the text's last sentence, "Treat an unknown code by its HTTP status.", last).

(d) At the end of `components.schemas`, add:

```yaml
    DepositState:
      type: string
      description: |
        What the deposit page says: `due` (pay, then send a screenshot),
        `submitted` (a screenshot waits for the studio), `paid` (nothing
        left to pay), `updating` (the studio is changing the quote),
        `expired` (the quote expired) or `cancelled`.
      enum: [due, submitted, paid, updating, expired, cancelled]

    DepositPaymentMethod:
      type: object
      required: [kind, label, qrImageUrl, accountName, accountNumber, bankName]
      additionalProperties: false
      properties:
        kind:
          type: string
          enum: [fonepay, esewa, khalti, bank]
        label: { type: string, examples: [eSewa] }
        qrImageUrl:
          type: [string, "null"]
          format: uri
          description: The studio's QR code, a public image.
        accountName: { type: [string, "null"] }
        accountNumber:
          type: [string, "null"]
          description: The bank account number, or the eSewa or Khalti ID.
        bankName: { type: [string, "null"] }

    DepositPage:
      type: object
      required: [studio, project, deposit, referenceCode, state, lastProofRejected, proofSubmittedAt, paymentMethods, depositPolicy]
      additionalProperties: false
      properties:
        studio:
          type: object
          required: [name]
          additionalProperties: false
          properties:
            name: { type: string }
        project:
          type: object
          required: [brief, artistName]
          additionalProperties: false
          properties:
            brief: { type: string }
            artistName: { type: [string, "null"] }
        deposit:
          type: object
          required: [amount, amountText, due, dueText, currency, payBy, payByText]
          additionalProperties: false
          properties:
            amount:
              type: integer
              minimum: 0
              description: The current quote's deposit, in paisa.
            amountText: { type: string, examples: ["NPR 3,000"] }
            due:
              type: integer
              minimum: 0
              description: What is still to pay, in paisa. Send it back as `expectedAmount`.
            dueText: { type: string, examples: ["NPR 3,000"] }
            currency: { type: string, examples: [NPR] }
            payBy:
              type: string
              format: date
              description: The quote's last valid day, in the studio's timezone.
            payByText: { type: string, examples: ["28 Oct 2026"] }
        referenceCode:
          type: string
          pattern: "^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$"
          description: What the client writes in the payment remark.
          examples: [7K3M9Q]
        state: { $ref: "#/components/schemas/DepositState" }
        lastProofRejected:
          type: boolean
          description: In `due`, the studio couldn't confirm the last screenshot.
        proofSubmittedAt:
          type: [string, "null"]
          format: date-time
          description: When the screenshot that waits was sent.
        paymentMethods:
          type: array
          description: The studio's payment methods, only in `due`; empty otherwise.
          items: { $ref: "#/components/schemas/DepositPaymentMethod" }
        depositPolicy:
          type: [string, "null"]
          description: The studio's own words about deposits.

    DepositProofForm:
      type: object
      description: The multipart body of `submitDepositProof`
      required: [proof, method, expectedAmount]
      properties:
        proof:
          type: string
          format: binary
          description: The payment screenshot (JPEG, PNG or WebP, 10 MB at most). Its metadata is removed, and only the studio sees it.
        method:
          type: string
          enum: [fonepay, esewa, khalti, bank]
          description: How the client paid, one of the page's `paymentMethods` kinds.
        expectedAmount:
          type: integer
          minimum: 1
          description: The `deposit.due` the page showed, in paisa.
```

- [ ] **Step 4: Regenerate and export the types**

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate`
Expected: `openapi.gen.ts` gains `getDeposit`, `submitDepositProof` and the four schemas.

In `packages/types/src/index.ts`, after the `InquiryReceipt` export (TAT-51), add:

```ts
export type DepositState = Schemas["DepositState"];
export type DepositPaymentMethod = Schemas["DepositPaymentMethod"];
export type DepositPage = Schemas["DepositPage"];
export type DepositProofForm = Schemas["DepositProofForm"];
```

Run: `pnpm -C <repo> --filter @tattoo-drip/types typecheck`
Expected: no errors.

- [ ] **Step 5: The SDK**

In `packages/sdk/src/client.ts`:

- Add `DepositPage,` and `DepositPaymentMethod,` to the type import from `@tattoo-drip/types` (alphabetical, where Biome puts them).
- After the `CreateInquiryInput` interface (TAT-51), add:

```ts
/** A deposit proof: the screenshot, how the client paid, and the `deposit.due` the page showed. */
export interface SubmitDepositProofInput {
	/** A JPEG, PNG or WebP of 10 MB at most. */
	proof: Blob;
	/** One of the page's `paymentMethods` kinds. */
	method: DepositPaymentMethod["kind"];
	/** The page's `deposit.due`, in paisa. */
	expectedAmount: number;
}
```

- After the `inquiries: { … },` entry, add:

```ts
		deposits: {
			/**
			 * The deposit page of a link's token (the fragment of the link the
			 * studio sent). A link that doesn't work is a 404 TattooApiError
			 * (`not_found`).
			 */
			get: (token: string, call?: RequestOptions) =>
				getData<DepositPage>(
					`${tenantRoot}/deposits/${encodeURIComponent(token)}`,
					call,
				),
			/**
			 * Sends the payment screenshot as one multipart request and returns
			 * the page as it now is (`submitted`). Waits up to 2 minutes (an
			 * upload) unless `call.timeoutMs` says otherwise. Fails with a
			 * TattooApiError such as `validation_failed` (fields `proof`,
			 * `method`, `expectedAmount`), `deposit_not_due`, `deposit_changed`,
			 * `payload_too_large` or `rate_limited`.
			 */
			submitProof: async (
				token: string,
				input: SubmitDepositProofInput,
				call: RequestOptions = {},
			) => {
				const form = new FormData();
				form.set("method", input.method);
				form.set("expectedAmount", String(input.expectedAmount));
				form.append("proof", input.proof);

				const body = await request<{ data: DepositPage }>(
					`${tenantRoot}/deposits/${encodeURIComponent(token)}`,
					// No Content-Type: fetch sets multipart's boundary itself.
					{ method: "POST", body: form },
					{ ...call, timeoutMs: call.timeoutMs ?? UPLOAD_TIMEOUT_MS },
				);
				return body.data;
			},
		},
```

In `packages/sdk/src/index.ts`, add `type SubmitDepositProofInput,` to the export list from `./client.js`.

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: PASS (the earlier tests plus these 6).

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk typecheck`
Expected: no errors.

- [ ] **Step 6: The React test runner and the failing React tests**

In `packages/react/package.json`, set `scripts` to:

```json
	"scripts": {
		"build": "tsc",
		"typecheck": "tsc --noEmit && tsc -p tsconfig.test.json",
		"test": "node --import tsx --test \"test/**/*.test.ts\""
	},
```

and add to `devDependencies` (keep the others): `"@types/node": "~26.6.2"` and `"tsx": "^4.23.12"` (the SDK's versions).

In `packages/react/tsconfig.json`, add `"types": []` to `compilerOptions` (so `@types/node` never reaches the source). Create `packages/react/tsconfig.test.json`:

```json
{
	"extends": "./tsconfig.json",
	"compilerOptions": {
		"rootDir": ".",
		"noEmit": true,
		"types": ["node"]
	},
	"include": ["src", "test"]
}
```

Run: `pnpm -C <repo> install`
Expected: `pnpm-lock.yaml` gains `tsx` and `@types/node` under `packages/react` (already in the store).

Create `packages/react/test/deposit.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { createTattooClient, TattooApiError } from "@tattoo-drip/sdk";
import type { DepositPage } from "@tattoo-drip/types";
import { tattooKeys, tattooMutations, tattooQueries } from "../src/queries.js";

const TENANT = "deposit-needle-65";
const TOKEN = "T".repeat(43);
const PAGE: DepositPage = {
	studio: { name: "Black Needle" },
	project: { brief: "A fine-line moth", artistName: null },
	deposit: {
		amount: 300_000,
		amountText: "NPR 3,000",
		due: 300_000,
		dueText: "NPR 3,000",
		currency: "NPR",
		payBy: "2026-11-01",
		payByText: "1 Nov 2026",
	},
	referenceCode: "7K3M9Q",
	state: "due",
	lastProofRejected: false,
	proofSubmittedAt: null,
	paymentMethods: [],
	depositPolicy: null,
};

/** A client whose fetch answers every call with `status` and `body`. */
function clientAnswering(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		calls.push({ url: String(input), init });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	const client = createTattooClient({
		baseUrl: "https://api.example.com",
		tenant: TENANT,
		fetch,
	});
	return { calls, client };
}

describe("tattooQueries.deposit", () => {
	test("its key starts with the tenant and ends with the token", () => {
		const { client } = clientAnswering(200, { data: PAGE });
		const key = ["tattoo-drip", "tenant", TENANT, "deposit", TOKEN];

		assert.deepEqual(tattooQueries.deposit(client, TOKEN).queryKey, key);
		assert.deepEqual(tattooKeys.deposit(TENANT, TOKEN), key);
	});

	test("it loads the page through the SDK", async () => {
		const { calls, client } = clientAnswering(200, { data: PAGE });

		const page = await new QueryClient().fetchQuery(
			tattooQueries.deposit(client, TOKEN),
		);

		assert.deepEqual(page, PAGE);
		assert.equal(
			calls[0].url,
			`https://api.example.com/api/v1/tenants/${TENANT}/deposits/${TOKEN}`,
		);
	});

	test("a 4xx is not retried; a network error is, up to 3 times", () => {
		const { client } = clientAnswering(200, { data: PAGE });
		const retry = tattooQueries.deposit(client, TOKEN).retry as (
			failures: number,
			error: unknown,
		) => boolean;
		const offline = new TattooApiError(0, {
			code: "network_error",
			message: "The Tattoo Drip API could not be reached.",
		});

		assert.equal(
			retry(0, new TattooApiError(404, { code: "not_found", message: "Not found." })),
			false,
		);
		assert.equal(
			retry(0, new TattooApiError(429, { code: "rate_limited", message: "Slow down." })),
			false,
		);
		assert.equal(retry(0, offline), true);
		assert.equal(retry(2, offline), true);
		assert.equal(retry(3, offline), false);
	});
});

describe("tattooMutations.submitDepositProof", () => {
	test("posts the proof, is never retried, and puts the answer in the deposit query", async () => {
		const answered: DepositPage = { ...PAGE, state: "submitted" };
		const { calls, client } = clientAnswering(201, { data: answered });
		const queryClient = new QueryClient();
		const options = tattooMutations.submitDepositProof(
			client,
			queryClient,
			TOKEN,
		);

		const page = await options.mutationFn({
			proof: new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }),
			method: "esewa",
			expectedAmount: 300_000,
		});
		options.onSuccess(page);

		assert.equal(options.retry, false);
		assert.equal(calls[0].init.method, "POST");
		assert.deepEqual(
			queryClient.getQueryData(tattooKeys.deposit(TENANT, TOKEN)),
			answered,
		);
	});
});
```

Run: `pnpm -C <repo> --filter @tattoo-drip/react test`
Expected: FAIL (`tattooQueries.deposit is not a function`, `tattooMutations` is not exported).

- [ ] **Step 7: The React options and hooks**

In `packages/react/src/queries.ts`:

- Change the TanStack import to `import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";`, add `import { isTattooApiError } from "@tattoo-drip/sdk";`, add `type SubmitDepositProofInput,` to the type import from `@tattoo-drip/sdk`, and add `import type { DepositPage } from "@tattoo-drip/types";`.
- In `tattooKeys`, after `availability`, add:

```ts
	deposit: (tenant: string, token: string) =>
		[...tattooKeys.tenant(tenant), "deposit", token] as const,
```

- In `tattooQueries`, after `availability`, add:

```ts
	/**
	 * A deposit page by its link's token. A 4xx (a link that doesn't work,
	 * a rate limit) won't change by asking again at once, so only network
	 * errors and 5xx are retried. Refetched when the window regains focus,
	 * so coming back from the payment app shows the latest state.
	 */
	deposit: (client: TattooClient, token: string) =>
		queryOptions({
			queryKey: tattooKeys.deposit(client.tenant, token),
			queryFn: ({ signal }) => client.deposits.get(token, { signal }),
			retry: (failures, error) =>
				!(isTattooApiError(error) && error.status >= 400 && error.status < 500) &&
				failures < 3,
		}),
```

- At the end of the file, add:

```ts
/**
 * Mutation options, as plain objects: the hooks use them, and tests run
 * them without React.
 */
export const tattooMutations = {
	/**
	 * Sends a deposit proof. Never retried: a retry after a timeout could
	 * send it twice (the API answers a second one with `deposit_not_due`).
	 * The answer, the page in `submitted`, replaces the cached deposit page.
	 */
	submitDepositProof: (
		client: TattooClient,
		queryClient: QueryClient,
		token: string,
	) => ({
		mutationFn: (input: SubmitDepositProofInput) =>
			client.deposits.submitProof(token, input),
		retry: false as const,
		onSuccess: (page: DepositPage) => {
			queryClient.setQueryData(tattooKeys.deposit(client.tenant, token), page);
		},
	}),
};
```

In `packages/react/src/hooks.ts`, change the TanStack import to `import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";`, change `import { tattooQueries } from "./queries.js";` to `import { tattooMutations, tattooQueries } from "./queries.js";`, and append:

```ts
/** A deposit page by its link's token (the fragment of the link the studio sent). */
export function useDeposit(token: string) {
	return useQuery(tattooQueries.deposit(useTattooClient(), token));
}

/**
 * Sends the payment screenshot (`client.deposits.submitProof`); on success
 * `useDeposit(token)` shows the answer (`submitted`).
 */
export function useSubmitDepositProof(token: string) {
	const client = useTattooClient();
	const queryClient = useQueryClient();
	return useMutation(
		tattooMutations.submitDepositProof(client, queryClient, token),
	);
}
```

In `packages/react/src/index.ts`, add `useDeposit,` and `useSubmitDepositProof,` to the export list from `./hooks.js`, and change `export { tattooKeys, tattooQueries } from "./queries.js";` to `export { tattooKeys, tattooMutations, tattooQueries } from "./queries.js";`.

In `packages/AGENTS.md`, replace "The React hooks have none yet (TAT-11): validate changed hook behavior explicitly." with "The React package tests its query and mutation option factories in `packages/react/test` the same way (`pnpm --filter @tattoo-drip/react test`, no rendering); hook rendering tests are TAT-11's."

- [ ] **Step 8: Run the tests and typecheck**

Run: `pnpm -C <repo> --filter @tattoo-drip/react test`
Expected: PASS (4 tests).

Run: `pnpm -C <repo> --filter @tattoo-drip/types typecheck && pnpm -C <repo> --filter @tattoo-drip/sdk typecheck && pnpm -C <repo> --filter @tattoo-drip/react typecheck`
Expected: no errors. (If `"types": []` breaks the JSX types of `provider.tsx`, remove it from `tsconfig.json`, keep the test tsconfig, and note it.)

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate && git -C <repo> diff --exit-code packages/types/src/openapi.gen.ts`
Expected: no diff.

- [ ] **Step 9: Commit, one per package**

```bash
git -C <repo> add packages/types
git -C <repo> commit -m "feat(types): describe the deposit page and its proof upload

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git -C <repo> add packages/sdk
git -C <repo> commit -m "feat(sdk): read deposit pages and send payment screenshots

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git -C <repo> add packages/react packages/AGENTS.md pnpm-lock.yaml
git -C <repo> commit -m "feat(react): add useDeposit and useSubmitDepositProof

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13 (needs TAT-32/51): The deposit codes in the public API's one list

**Files:**
- Modify: the file that holds `ApiErrorCode` and `API_ERRORS` (TAT-32: `apps/platform/app/services/public_api.ts`, re-exported by `public_api_errors.ts`; use the one the precondition found, next to TAT-51's intake codes)
- Test: `apps/platform/tests/unit/services/public_api_errors.spec.ts` (append)

**Interfaces:**
- Consumes: TAT-32's `ApiErrorCode`, `API_ERRORS`, `apiErrorFor`; TAT-51's `ApiException.of`.
- Produces: `ApiErrorCode` gains `"deposit_not_due" | "deposit_changed"`, with their `API_ERRORS` entries (409).

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/unit/services/public_api_errors.spec.ts`:

```ts
test.group("The deposit codes", () => {
	test("deposit_not_due and deposit_changed are 409s with their one message", ({
		assert,
	}) => {
		const cases = [
			[
				"deposit_not_due",
				"This deposit can't be paid here right now. Reload the page to see why.",
			],
			[
				"deposit_changed",
				"The deposit amount changed. Check the new amount before you upload.",
			],
		] as const;

		for (const [code, message] of cases) {
			assert.deepEqual(
				apiErrorFor(ApiException.of(code)),
				{ status: 409, body: { error: { code, message } }, headers: {} },
				code,
			);
		}
	});
});
```

(`apiErrorFor` and `ApiException` are already imported in this spec by TAT-32 and TAT-51.)

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=public_api_errors.spec.ts`
Expected: FAIL (a type error on the codes, or `API_ERRORS[code]` undefined: `Cannot destructure property 'status'`).

- [ ] **Step 3: Add the codes**

In the file holding the list, add to the `ApiErrorCode` union after TAT-51's intake codes:

```ts
	// submitDepositProof (TAT-65)
	| "deposit_not_due"
	| "deposit_changed"
```

and to `API_ERRORS`, after `too_many_open_inquiries`:

```ts
	deposit_not_due: {
		status: 409,
		code: "deposit_not_due",
		message:
			"This deposit can't be paid here right now. Reload the page to see why.",
	},
	deposit_changed: {
		status: 409,
		code: "deposit_changed",
		message:
			"The deposit amount changed. Check the new amount before you upload.",
	},
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=public_api_errors.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/services apps/platform/tests/unit/services/public_api_errors.spec.ts
git -C <repo> commit -m "feat(platform): add the deposit codes to the public API's error list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14 (needs TAT-32/51): The two endpoints and their isolation cases

**Files:**
- Create: `apps/platform/app/controllers/public_deposits_controller.ts`, `apps/platform/app/transformers/public_deposit_transformer.ts`
- Modify: `apps/platform/start/routes.ts`, `apps/platform/config/bodyparser.ts`, `apps/platform/tests/helpers/deposits.ts`, `apps/platform/tests/isolation/public_cases.ts`, `apps/platform/tests/helpers/public_isolation.ts`, `apps/platform/tests/functional/api/api_routes.spec.ts`, `apps/platform/app/middleware/deposit_throttle_middleware.ts` (only if Task 11 used a local `READ_METHODS`)
- Regenerate: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/api/deposits.spec.ts` (create)

**Interfaces:**
- Consumes: Task 8's `DepositPageService`, Task 7's `depositProofValidator` and `METHOD_MESSAGE`, Task 5's errors, Task 13's codes, Task 11's `depositThrottle`, Task 2's `DEPOSIT_TOKEN`; TAT-32's `publicTenantContext`, `ApiException`, `ctx.serialize`, `assertApiData`, `assertApiError`, `assertApiHeaders`, `PublicIsolationCase`, `publicMarkers`, `assertPublicIsolation`; TAT-51's `ApiException.of`, `receiveUploads`, `discardUploads`, `multipart.processManually` and its guard, `tempUploads`, `newTempUploads`, the harness's `encoding`.
- Produces: routes `GET` and `POST /api/v1/tenants/:tenant/deposits/:token` named `api.v1.deposits.show` and `api.v1.deposits.store`; from `#tests/helpers/deposits`: `type ProofPart = { field: string; name: string; type: string; data: Buffer }`, `proofPart(name?): Promise<ProofPart>`, `depositPath(slug, token): string`, `postProof(client, slug, token, fields, parts?)` (the unsent request), `storedProofs(tenant): Promise<string[]>`; `PublicIsolationCase.params?` and `.files?`.

- [ ] **Step 1: The HTTP helpers**

In `apps/platform/tests/helpers/deposits.ts`, add the imports `import { readdir } from "node:fs/promises";`, `import app from "@adonisjs/core/services/app";`, `import type { ApiClient } from "@japa/api-client";` and `import { testImages } from "#tests/helpers/images";`, and append:

```ts
export type ProofPart = {
	field: string;
	name: string;
	type: string;
	data: Buffer;
};

/** A small PNG payment screenshot (300 × 200), as the `proof` part. */
export async function proofPart(name = "receipt.png"): Promise<ProofPart> {
	return {
		field: "proof",
		name,
		type: "image/png",
		data: await testImages.png(),
	};
}

/** The deposit page's API path. */
export const depositPath = (slug: string, token: string) =>
	`/api/v1/tenants/${slug}/deposits/${token}`;

/**
 * POST a proof as multipart: the fields, then each part. Not sent yet, so a
 * test can add headers before awaiting it.
 */
export function postProof(
	client: ApiClient,
	slug: string,
	token: string,
	fields: Record<string, string>,
	parts: ProofPart[] = [],
) {
	const request = client.post(depositPath(slug, token)).fields(fields);
	for (const part of parts) {
		request.file(part.field, part.data, {
			filename: part.name,
			contentType: part.type,
		});
	}
	return request;
}

/** The payment proofs stored for `tenant` on the private test disk. */
export function storedProofs(tenant: { id: string }): Promise<string[]> {
	return readdir(
		app.tmpPath("storage", "private", "tenants", tenant.id, "payment_proof"),
	).catch(() => [] as string[]);
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/platform/tests/functional/api/deposits.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { newTokenNonce, tokenFor } from "#modules/payments/deposit_links";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import Payment from "#modules/payments/models/payment";
import {
	AMOUNT_MESSAGE,
	METHOD_MESSAGE,
	PROOF_MESSAGE,
} from "#modules/payments/validators/deposit_proof";
import { formatDay, validUntil } from "#modules/projects/quotes";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
} from "#tests/helpers/api";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
	postProof,
	proofPart,
	storedProofs,
} from "#tests/helpers/deposits";
import { testImages } from "#tests/helpers/images";
import { makeArtist } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "deposit-api-65";
const KTM = "Asia/Kathmandu";
const services = depositServices();
const PROOF = { method: "esewa", expectedAmount: "300000" };

/** A studio with a policy, an assigned artist, a deposit due and its link. */
async function deposit(slug = SLUG) {
	const { tenant } = await studioWithOwner(slug, "Black Needle");
	const ready = await inTenant(tenant, async () => {
		tenant.merge({ depositPolicy: "Deposits hold your date." });
		await tenant.save();
		const ready = await depositReady(tenant);
		const artist = await makeArtist(tenant, "sita");
		ready.project.artistId = artist.id;
		await ready.project.save();
		return ready;
	});
	const issued = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	return { tenant, ...ready, ...issued };
}

const paymentsOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () => Payment.query().where("project_id", projectId));

test.group("Public API: GET /deposits/:token", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers exactly the contract's DepositPage, no-store, no cookie", async ({
		client,
	}) => {
		const { link, quote, token } = await deposit();
		const payBy = validUntil(quote.expiresAt, KTM);

		const response = await client.get(depositPath(SLUG, token));

		assertApiData(response, {
			studio: { name: "Black Needle" },
			project: {
				brief: "A small fine-line moth on the forearm",
				artistName: "Sita",
			},
			deposit: {
				amount: 300_000,
				amountText: "NPR 3,000",
				due: 300_000,
				dueText: "NPR 3,000",
				currency: "NPR",
				payBy,
				payByText: formatDay(payBy),
			},
			referenceCode: link.referenceCode,
			state: "due",
			lastProofRejected: false,
			proofSubmittedAt: null,
			paymentMethods: [
				{
					kind: "esewa",
					label: "eSewa",
					qrImageUrl: null,
					accountName: "Black Needle",
					accountNumber: "9801234567",
					bankName: null,
				},
			],
			depositPolicy: "Deposits hold your date.",
		});
		response.assertHeader("cache-control", "no-store");
		assertApiHeaders(response);
	});

	test("a link that doesn't work is the same 404: unknown, malformed, replaced, expired, unknown studio", async ({
		client,
	}) => {
		const { tenant, project, token } = await deposit();
		const replaced = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, project),
		);
		await inTenant(tenant, async () => {
			replaced.link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await replaced.link.save();
		});

		for (const path of [
			depositPath(SLUG, tokenFor(newTokenNonce())),
			depositPath(SLUG, "short"),
			depositPath(SLUG, `${"a".repeat(43)}=`),
			depositPath(SLUG, token),
			depositPath(SLUG, replaced.token),
			depositPath("no-such-studio-td65", replaced.token),
		]) {
			assertApiError(await client.get(path), 404, "not_found");
		}
	});
});

test.group("Public API: POST /deposits/:token", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("takes the screenshot: 201 with the page in submitted, a private image, the alert queued, no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, project, token } = await deposit();
		const fake = queue.fake();
		const before = await tempUploads();

		const response = await postProof(client, SLUG, token, PROOF, [
			await proofPart(),
		]);

		response.assertStatus(201);
		response.assertHeader("cache-control", "no-store");
		assertApiHeaders(response);
		const page = response.body().data;
		assert.equal(page.state, "submitted");
		assert.isString(page.proofSubmittedAt);
		assert.deepEqual(page.paymentMethods, []);
		const payments = await paymentsOf(tenant, project.id);
		assert.deepEqual(
			payments.map((row) => [row.kind, row.status, row.amount, row.method]),
			[["deposit", "submitted", 300_000, "esewa"]],
		);
		assert.lengthOf(await storedProofs(tenant), 1);
		assert.notInclude(
			JSON.stringify(response.body()),
			payments[0].proofImageKey ?? "",
			"the answer never names the private image",
		);
		fake.assertPushed(DepositProofAlertJob, {
			payload: { tenantId: tenant.id, paymentId: payments[0].id },
		});
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a JSON body is 415 for a live link, and the 404 for a dead one", async ({
		client,
	}) => {
		const { token } = await deposit();

		assertApiError(
			await client
				.post(depositPath(SLUG, token))
				.json({ method: "esewa", expectedAmount: 300_000 }),
			415,
			"unsupported_media_type",
		);
		assertApiError(
			await client
				.post(depositPath(SLUG, tokenFor(newTokenNonce())))
				.json({ method: "esewa", expectedAmount: 300_000 }),
			404,
			"not_found",
		);
	});

	test("a missing or wrong field is 422 with its message, and leaves no temp upload or row", async ({
		client,
		assert,
	}) => {
		const { tenant, project, token } = await deposit();
		const before = await tempUploads();
		const png = await proofPart();
		const cases: [Record<string, string>, typeof png[], Record<string, string[]>][] = [
			[PROOF, [], { proof: [PROOF_MESSAGE] }],
			[{ ...PROOF, method: "cash" }, [png], { method: [METHOD_MESSAGE] }],
			// The studio doesn't show Khalti on its deposit page.
			[{ ...PROOF, method: "khalti" }, [png], { method: [METHOD_MESSAGE] }],
			[{ ...PROOF, expectedAmount: "abc" }, [png], { expectedAmount: [AMOUNT_MESSAGE] }],
			[
				PROOF,
				[{ field: "proof", name: "moving.gif", type: "image/gif", data: await testImages.gif() }],
				{ proof: [IMAGE_FORMAT_MESSAGE] },
			],
			[
				PROOF,
				[{ field: "proof", name: "receipt.png", type: "image/png", data: Buffer.from("<?php echo 'hi'; ?>") }],
				{ proof: [IMAGE_FORMAT_MESSAGE] },
			],
		];

		for (const [fields, parts, expected] of cases) {
			const response = await postProof(client, SLUG, token, fields, parts);
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(response.body().error.fields, expected, JSON.stringify(fields));
		}

		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
		assert.lengthOf(await storedProofs(tenant), 0);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a dead link's upload is the 404, before the body is read, with no temp upload left", async ({
		client,
		assert,
	}) => {
		await deposit();
		const before = await tempUploads();

		assertApiError(
			await postProof(client, SLUG, tokenFor(newTokenNonce()), PROOF, [
				await proofPart(),
			]),
			404,
			"not_found",
		);
		assert.deepEqual(await newTempUploads(before), []);
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=deposits.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: every valid request is TAT-32's 404 for a path no route has (the 404 tests pass for now).

- [ ] **Step 4: The transformer and the controller**

Create `apps/platform/app/transformers/public_deposit_transformer.ts`:

```ts
import { BaseTransformer } from "@adonisjs/core/transformers";
import type { DepositPage } from "#modules/payments/services/deposit_page_service";
import { formatDay, formatMoney, validUntil } from "#modules/projects/quotes";

/**
 * The public deposit page (openapi.yaml, DepositPage; TAT-65): what the
 * client's page shows, never notes, the client, sessions, the quote
 * history, the price or the proof image. Amounts in paisa with their text
 * (formatMoney writes NPR, the only currency so far); `payBy` is the
 * current quote's last valid day in the studio's timezone.
 */
export default class PublicDepositTransformer extends BaseTransformer<DepositPage> {
	toObject() {
		const page = this.resource;
		const payBy = validUntil(page.quote.expiresAt, page.timezone);
		return {
			studio: { name: page.studioName },
			project: { brief: page.brief, artistName: page.artistName },
			deposit: {
				amount: page.quote.depositAmount,
				amountText: formatMoney(page.quote.depositAmount),
				due: page.due,
				dueText: formatMoney(page.due),
				currency: page.quote.currency,
				payBy,
				payByText: formatDay(payBy),
			},
			referenceCode: page.referenceCode,
			state: page.state,
			lastProofRejected: page.lastProofRejected,
			proofSubmittedAt: page.proofSubmittedAt?.toUTC().toISO() ?? null,
			paymentMethods: page.methods.map((method) => ({
				kind: method.kind,
				label: method.label,
				qrImageUrl: method.qrImageUrl,
				accountName: method.accountName,
				accountNumber: method.accountNumber,
				bankName: method.bankName,
			})),
			depositPolicy: page.depositPolicy,
		};
	}
}
```

Create `apps/platform/app/controllers/public_deposits_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { InvalidImageError } from "#modules/media/errors";
import {
	DepositPageNotFoundError,
	DepositProofError,
} from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositPageService from "#modules/payments/services/deposit_page_service";
import {
	depositProofValidator,
	METHOD_MESSAGE,
} from "#modules/payments/validators/deposit_proof";
import { ApiException } from "#services/public_api_errors";
import { discardUploads, receiveUploads } from "#services/uploads";
import PublicDepositTransformer from "#transformers/public_deposit_transformer";

/**
 * The public deposit page (getDeposit and submitDepositProof in
 * openapi.yaml, TAT-65): a project's deposit through its link's token, and
 * the client's payment screenshot. Every link that doesn't work is the same
 * 404, before anything else is looked at; the upload's body is read only
 * after that (the route is in multipart.processManually).
 */
@inject()
export default class PublicDepositsController {
	constructor(private pages: DepositPageService) {}

	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		try {
			const page = await this.pages.show(tenant, ctx.params.token);
			return await ctx.serialize(PublicDepositTransformer.transform(page));
		} catch (error) {
			throw toApiError(error);
		}
	}

	async store(ctx: HttpContext) {
		const { request, response } = ctx;
		const { tenant } = publicTenantContext(ctx);
		try {
			// A dead link is the 404 whatever the body says.
			await this.pages.show(tenant, ctx.params.token);
			if (request.bodyType !== "multipart") {
				throw ApiException.of("unsupported_media_type");
			}
			// The tenant, the limits and the link are checked, so only now does
			// the body go to disk (413 or 400 if it can't be read).
			await receiveUploads(request);
			const submission = await request.validateUsing(depositProofValidator, {
				// Only the first `proof` part is read; discardUploads drops the rest.
				data: { ...request.all(), proof: request.file("proof") ?? undefined },
			});
			const page = await this.pages.submitProof(
				tenant,
				ctx.params.token,
				submission,
			);
			response.status(201);
			return await ctx.serialize(PublicDepositTransformer.transform(page));
		} catch (error) {
			throw toApiError(error);
		} finally {
			await discardUploads(request);
		}
	}
}

/** The deposit page's refusals as the API answers them; any other error as it is. */
function toApiError(error: unknown) {
	if (error instanceof DepositPageNotFoundError) return ApiException.notFound();
	if (error instanceof InvalidImageError) {
		return ApiException.of("validation_failed", { proof: [error.message] });
	}
	if (!(error instanceof DepositProofError)) return error;
	switch (error.reason) {
		case "not_due":
			return ApiException.of("deposit_not_due");
		case "amount_changed":
			return ApiException.of("deposit_changed");
		case "method_unavailable":
			return ApiException.of("validation_failed", { method: [METHOD_MESSAGE] });
		default:
			return error;
	}
}
```

(Use exactly the multipart check and the `receiveUploads` call `PublicInquiriesController.store` uses; if TAT-51's review renamed them, copy its version. If `ctx.serialize` rejects a plain object from `toObject`, mirror how `PublicStudioTransformer` returns its fields.)

In `apps/platform/config/bodyparser.ts`, add the upload route to `multipart.processManually` (after TAT-51's inquiries route):

```ts
		processManually: [
			"/api/v1/tenants/:tenant/inquiries",
			"/api/v1/tenants/:tenant/deposits/:token",
		],
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains `PublicDeposits`.

- [ ] **Step 5: The routes and the cache decision**

In `apps/platform/start/routes.ts`, add `import { DEPOSIT_TOKEN } from "#modules/payments/deposit_links";` to the imports, and inside the `/tenants/:tenant` group, after the `api.v1.inquiries.store` statement (TAT-51), add:

```ts
				// The deposit page through a link's token (TAT-65): 43 base64url
				// characters, anything else is the router's 404 without a query.
				// Rate-limited per address and per token; never cached.
				router
					.get("/deposits/:token", [controllers.PublicDeposits, "show"])
					.where("token", DEPOSIT_TOKEN)
					.use(middleware.depositThrottle())
					.as("api.v1.deposits.show");
				router
					.post("/deposits/:token", [controllers.PublicDeposits, "store"])
					.where("token", DEPOSIT_TOKEN)
					.use(middleware.depositThrottle())
					.as("api.v1.deposits.store");
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains both routes.

In `apps/platform/tests/functional/api/api_routes.spec.ts`, replace `const UNCACHED_GET_ROUTES: Record<string, string> = {};` with (keep any entry TAT-51 added):

```ts
const UNCACHED_GET_ROUTES: Record<string, string> = {
	"/api/v1/tenants/:tenant/deposits/:token":
		"A private deposit page behind a bearer link: never cached (TAT-65).",
};
```

If Task 11 used a local `new Set(["GET", "HEAD"])` in `deposit_throttle_middleware.ts`, switch it to `import { READ_METHODS } from "#services/public_api";` now.

- [ ] **Step 6: The isolation cases, with params and files**

In `apps/platform/tests/isolation/public_cases.ts`:

- Add the imports `import DepositLink from "#modules/payments/models/deposit_link";`, `import Payment from "#modules/payments/models/payment";` and `import { type ProofPart, proofPart } from "#tests/helpers/deposits";`.
- Add to `PublicIsolationCase`, after `body?` (and TAT-51's `encoding?`):

```ts
	/**
	 * Values for the pattern's parameters other than :tenant, built for one
	 * studio (TAT-65: a deposit link's token). With them, the harness also
	 * sends B's values under A's slug, which must be the 404 and leave B as
	 * it was.
	 */
	params?: (studio: Studio) => Record<string, string>;
	/** File parts of a multipart write, built for the studio sending it (TAT-65: the proof). */
	files?: (own: Studio) => Promise<ProofPart[]>;
```

- After `tenantRow`, add:

```ts
const depositRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		links: (await DepositLink.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		payments: (await Payment.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));
```

- Append to `publicIsolationCases`:

```ts
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/deposits/:token",
		params: (studio) => ({ token: studio.depositToken }),
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name, own.depositReferenceCode],
		snapshot: depositRows,
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/deposits/:token",
		params: (studio) => ({ token: studio.depositToken }),
		encoding: "multipart",
		body: () => ({ method: "esewa", expectedAmount: "300000" }),
		files: async () => [await proofPart()],
		ownStatus: 201,
		// The answer is the page in `submitted`, with A's reference code.
		ownMarkers: (own) => [own.depositReferenceCode],
		snapshot: depositRows,
	},
```

In `apps/platform/tests/helpers/public_isolation.ts`:

- In `publicMarkers`, after `studio.newInquiry.id,`, add `studio.depositProject.id,` and `studio.depositReferenceCode,`.
- Replace `urlFor` and the request-building lines of `assertPublicIsolation` (from `const request = client.request(` to `const response = await request.redirects(0);`, including TAT-51's multipart branch) with the following, so the whole function reads:

```ts
/** Whole path segments only: ":tokens" is not ":token". */
const segment = (name: string) => new RegExp(`:${name}(?=/|$)`);

/**
 * The case's URL under `slugOwner`'s slug, with `params` for the pattern's
 * other parameters. A parameter left without a value is a mistake in the
 * case table, so it fails loudly.
 */
function urlFor(
	{ pattern }: PublicIsolationCase,
	slugOwner: Studio,
	params: Record<string, string> = {},
) {
	let url = pattern.replace(segment("tenant"), slugOwner.tenant.slug);
	for (const [name, value] of Object.entries(params)) {
		url = url.replace(segment(name), encodeURIComponent(value));
	}
	if (/\/:/.test(url)) {
		throw new Error(
			`${pattern}: give the case \`params\` for every parameter but :tenant`,
		);
	}
	return url;
}

/** Sends the case's request to `url` with `own`'s body and files. */
async function send(
	client: ApiClient,
	isolationCase: PublicIsolationCase,
	url: string,
	own: Studio,
) {
	const request = client.request(url, isolationCase.method);
	const body = isolationCase.body?.(own);
	if (isolationCase.encoding === "multipart") {
		if (body) request.fields(body as Record<string, string>);
		for (const part of (await isolationCase.files?.(own)) ?? []) {
			request.file(part.field, part.data, {
				filename: part.name,
				contentType: part.type,
			});
		}
	} else if (body) {
		request.json(body);
	}
	return request.redirects(0);
}

/**
 * Proves a public route under studio A's path never reads or writes studio
 * B. A route with parameters besides :tenant first gets B's own values
 * under A's slug, which must be the 404 and leave B as it was. Then the
 * positive control: A's own request gives ownStatus and mentions A
 * (ownMarkers), so an empty or failing answer can't pass; it must mention
 * none of B's markers, and B's snapshot must be unchanged.
 */
export async function assertPublicIsolation(
	client: ApiClient,
	assert: Assert,
	{ a, b }: { a: Studio; b: Studio },
	isolationCase: PublicIsolationCase,
) {
	const before = await isolationCase.snapshot(b);

	if (isolationCase.params) {
		const attack = await send(
			client,
			isolationCase,
			urlFor(isolationCase, a, isolationCase.params(b)),
			a,
		);
		attack.assertStatus(404);
		assert.equal(attack.body().error?.code, "not_found");
		assert.deepEqual(
			await isolationCase.snapshot(b),
			before,
			`${isolationCase.method} ${isolationCase.pattern} with B's values under A's slug changed studio B`,
		);
	}

	const response = await send(
		client,
		isolationCase,
		urlFor(isolationCase, a, isolationCase.params?.(a)),
		a,
	);

	response.assertStatus(isolationCase.ownStatus);
	const text = JSON.stringify(response.body());
	for (const marker of isolationCase.ownMarkers(a)) {
		assert.include(
			text,
			marker,
			`the answer to A's path mentions A (${marker})`,
		);
	}
	for (const marker of publicMarkers(b)) {
		assert.notInclude(
			text,
			marker,
			`the answer to A's path mentions studio B (${marker})`,
		);
	}
	assert.deepEqual(
		await isolationCase.snapshot(b),
		before,
		`${isolationCase.method} ${isolationCase.pattern} changed studio B`,
	);
}
```

(Keep anything else TAT-32's or TAT-51's review added to this file, such as the self-test hooks, around these functions.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=deposits.spec.ts --files=public_api.spec.ts --files=api_routes.spec.ts --files=errors.spec.ts --files=stateless.spec.ts --files=inquiries.spec.ts`
Expected: PASS: the route guards find both routes' cases, the GET's cache reason and the POST in `processManually`, the public harness sends B's token under A's slug (404, B unchanged) and A's own requests (200, 201), and TAT-32's and TAT-51's tests still pass.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app/controllers/public_deposits_controller.ts apps/platform/app/transformers/public_deposit_transformer.ts apps/platform/app/middleware/deposit_throttle_middleware.ts apps/platform/start/routes.ts apps/platform/config/bodyparser.ts apps/platform/.adonisjs apps/platform/tests/helpers/deposits.ts apps/platform/tests/isolation/public_cases.ts apps/platform/tests/helpers/public_isolation.ts apps/platform/tests/functional/api/api_routes.spec.ts apps/platform/tests/functional/api/deposits.spec.ts
git -C <repo> commit -m "feat(platform): serve the deposit page and take proofs on the public API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15 (needs TAT-32/51): Refusals, limits, old slugs and the owner's link over HTTP

**Files:**
- Test: `apps/platform/tests/functional/api/deposit_refusals.spec.ts` (create)
- Modify only if a test fails for a real reason: the files of Tasks 8, 11 and 14

**Interfaces:**
- Consumes: `depositPath`, `postProof`, `proofPart`, `storedProofs`, `depositReady`, `depositServices`, `OWNER` (`#tests/helpers/deposits`), `DEPOSIT_LIMITS` (Task 11), `assertApiError`, `assertApiHeaders`, `tempUploads`, `newTempUploads`, `TenancyService.changeSlug`.

- [ ] **Step 1: Write the tests**

Create `apps/platform/tests/functional/api/deposit_refusals.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { newTokenNonce, tokenFor } from "#modules/payments/deposit_links";
import { DEPOSIT_LIMITS } from "#modules/payments/deposit_limits";
import Payment from "#modules/payments/models/payment";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { assertApiError, assertApiHeaders } from "#tests/helpers/api";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
	postProof,
	proofPart,
	storedProofs,
} from "#tests/helpers/deposits";
import { makePayment } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "deposit-refuse-65";
const PROOF = { method: "esewa", expectedAmount: "300000" };
const services = depositServices();

/** A studio with a deposit due and its link. */
async function deposit(slug = SLUG) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const ready = await inTenant(tenant, () => depositReady(tenant));
	const issued = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	return { owner, tenant, ...ready, ...issued };
}

const paymentCount = async (tenant: { id: string }) =>
	(await inTenant(tenant, () => Payment.query())).length;

test.group("Public API: deposit refusals", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a state that takes no screenshot is 409 deposit_not_due, with no row, file or temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG, "Black Needle");
		const tokens = await inTenant(tenant, async () => {
			const made = async () => {
				const ready = await depositReady(tenant);
				const { token } = await services.links.issue(tenant, OWNER, ready.project);
				return { ...ready, token };
			};
			const waiting = await made();
			await makePayment(tenant, waiting.project, { method: "esewa" });
			const paid = await made();
			await makePayment(tenant, paid.project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			const cancelled = await made();
			cancelled.project.status = "cancelled";
			await cancelled.project.save();
			const revising = await made();
			revising.project.status = "quoted";
			await revising.project.save();
			const expired = await made();
			expired.quote.expiresAt = DateTime.utc().minus({ minutes: 1 });
			await expired.quote.save();
			return [waiting, paid, cancelled, revising, expired].map(({ token }) => token);
		});
		const rows = await paymentCount(tenant);
		const before = await tempUploads();

		for (const token of tokens) {
			assertApiError(
				await postProof(client, SLUG, token, PROOF, [await proofPart()]),
				409,
				"deposit_not_due",
			);
		}

		assert.equal(await paymentCount(tenant), rows);
		assert.lengthOf(await storedProofs(tenant), 0);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a stale amount is 409 deposit_changed", async ({ client, assert }) => {
		const { tenant, token } = await deposit();

		assertApiError(
			await postProof(client, SLUG, token, { ...PROOF, expectedAmount: "250000" }, [
				await proofPart(),
			]),
			409,
			"deposit_changed",
		);
		assert.equal(await paymentCount(tenant), 0);
	});

	test("a second screenshot while one waits is 409, and one payment and one file stay", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();

		(await postProof(client, SLUG, token, PROOF, [await proofPart()])).assertStatus(201);
		assertApiError(
			await postProof(client, SLUG, token, PROOF, [await proofPart()]),
			409,
			"deposit_not_due",
		);

		assert.equal(await paymentCount(tenant), 1);
		assert.lengthOf(await storedProofs(tenant), 1);
		const page = (await client.get(depositPath(SLUG, token))).body().data;
		assert.equal(page.state, "submitted");
	});

	test("over 20 MB in all is 413 and leaves no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();
		const before = await tempUploads();

		const response = await postProof(client, SLUG, token, PROOF, [
			{
				field: "proof",
				name: "huge.png",
				type: "image/png",
				data: Buffer.alloc(21 * 1024 * 1024),
			},
		]);

		assertApiError(response, 413, "payload_too_large");
		assert.deepEqual(await newTempUploads(before), []);
		assert.equal(await paymentCount(tenant), 0);
	});
});

test.group("Public API: deposit rate limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test(`the read after ${DEPOSIT_LIMITS.read.perToken.requests} of one link in 10 minutes is 429 with Retry-After; uploads count apart`, async ({
		client,
		assert,
	}) => {
		const { token } = await deposit();
		const path = depositPath(SLUG, token);

		for (let i = 0; i < DEPOSIT_LIMITS.read.perToken.requests; i++) {
			(await client.get(path)).assertStatus(200);
		}
		const refused = await client.get(path);

		assertApiError(refused, 429, "rate_limited");
		assert.match(refused.header("retry-after") ?? "", /^\d+$/);
		// Reads used up; the upload has its own count.
		(await postProof(client, SLUG, token, PROOF, [await proofPart()])).assertStatus(201);
	});

	test(`the read after ${DEPOSIT_LIMITS.read.perAddress.requests} from one address is 429, across links and unknown tokens`, async ({
		client,
	}) => {
		const { token } = await deposit();

		for (let i = 0; i < DEPOSIT_LIMITS.read.perAddress.requests; i++) {
			assertApiError(
				await client.get(depositPath(SLUG, tokenFor(newTokenNonce()))),
				404,
				"not_found",
			);
		}

		assertApiError(await client.get(depositPath(SLUG, token)), 429, "rate_limited");
	});

	test(`the upload after ${DEPOSIT_LIMITS.submit.perToken.requests} for one link in an hour is 429, and leaves no temp upload`, async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();
		for (let i = 0; i < DEPOSIT_LIMITS.submit.perToken.requests; i++) {
			assertApiError(
				await client.post(depositPath(SLUG, token)).json(PROOF),
				415,
				"unsupported_media_type",
			);
		}
		const before = await tempUploads();

		const refused = await postProof(client, SLUG, token, PROOF, [await proofPart()]);

		assertApiError(refused, 429, "rate_limited");
		assert.deepEqual(await newTempUploads(before), []);
		assert.equal(await paymentCount(tenant), 0);
	});
});

test.group("Public API: deposits across slugs and studios", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under an old slug the page answers, and an upload is the 404 with no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "deposit-renamed-65"),
		);
		const before = await tempUploads();

		(await client.get(depositPath(SLUG, token))).assertStatus(200);
		assertApiError(
			await postProof(client, SLUG, token, PROOF, [await proofPart()]),
			404,
			"not_found",
		);
		assert.deepEqual(await newTempUploads(before), []);
		(await postProof(client, "deposit-renamed-65", token, PROOF, [await proofPart()])).assertStatus(201);
	});

	test("a link works only under its own studio's slug", async ({ client }) => {
		const mine = await deposit("deposit-mine-65");
		const theirs = await deposit("deposit-theirs-65");

		assertApiError(
			await client.get(depositPath("deposit-mine-65", theirs.token)),
			404,
			"not_found",
		);
		assertApiError(
			await client.get(depositPath("deposit-theirs-65", mine.token)),
			404,
			"not_found",
		);
		assertApiError(
			await postProof(client, "deposit-mine-65", theirs.token, PROOF, [await proofPart()]),
			404,
			"not_found",
		);
	});

	test("a browser on another origin gets the page and can upload, without credentials", async ({
		client,
	}) => {
		const { token } = await deposit();
		const origin = "http://deposit-refuse-65.localhost:3000";

		const read = await client.get(depositPath(SLUG, token)).header("origin", origin);
		read.assertStatus(200);
		assertApiHeaders(read);
		const upload = await postProof(client, SLUG, token, PROOF, [await proofPart()]).header(
			"origin",
			origin,
		);
		upload.assertStatus(201);
		assertApiHeaders(upload);
	});

	test("the link an owner copies from the project page opens its deposit page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		await client
			.post(`/t/${SLUG}/projects/${project.id}/deposit-link`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		const panel = (
			await client.get(`/t/${SLUG}/projects/${project.id}`).withInertia().loginAs(owner)
		).inertiaProps.deposit;
		const token = new URL(panel.link.url).hash.slice(1);
		const page = await client.get(depositPath(SLUG, token));

		page.assertStatus(200);
		assert.equal(page.body().data.referenceCode, panel.link.referenceCode);
	});
});
```

- [ ] **Step 2: Run them**

Run: `PORT=3402 timeout 400 pnpm -C <repo>/apps/platform test functional --files=deposit_refusals.spec.ts`
Expected: PASS. A failure here is a real gap: fix it in the task's file it points to (Task 8's order of checks, Task 11's keys or Task 14's controller), never by loosening the test. If the 413 test gets a 400 instead, read how TAT-51's "over 20 MB in all is 413" test builds its body and do the same.

- [ ] **Step 3: Commit**

```bash
git -C <repo> add apps/platform/tests/functional/api/deposit_refusals.spec.ts
git -C <repo> commit -m "test(platform): pin the deposit page's refusals, limits and slugs over HTTP

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Add any file a fix touched to the same commit, and say what it fixed in the body.)

---

### Task 16 (needs TAT-32/51's docs): Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/jobs-and-email.md`, `apps/platform/docs/testing.md`, `apps/platform/database/README.md`, `docs/sdk.md`, `docs/requirements.md`, `docs/architecture.md`, `README.md`

- [ ] **Step 1: Platform docs**

In `apps/platform/docs/backend.md`:

- In **Payments**, replace the sentence "The deposit page (TAT-65) shows `list(tenant)` filtered to `showOnDepositPage`, with the tenant's `defaultDepositPercent` and `depositPolicy`." with:

```markdown
The deposit page (TAT-65) shows `listForDepositPage(tenant)` (shown on the deposit page, never cash) and the tenant's `depositPolicy`.
```

- Append to **Payments** a bullet:

```markdown
- Deposit links and the deposit page (TAT-65): one `DepositLink` per project (`deposit_links`, tenant-owned, not soft-deleted: a credential replaced in place). The token (43 base64url characters) is `tokenFor(nonce)`, an HMAC of the row's random nonce with `APP_KEY`; the row keeps the nonce and `token_hash` (SHA-256), which a request is looked up by, never the token, so the owner's page can show the link again (`DepositLinkService.forProject`) and rotating `APP_KEY` kills every link. A link works for 30 days; "New link" replaces the token at once and keeps the 6-character reference code (`23456789ABCDEFGHJKMNPQRSTVWXYZ`, unique per tenant), which the client writes in the payment remark and which grants nothing. Owners make links (`DepositLinkService.issue`: deposit_pending, a live quote, a deposit not covered, a method on the deposit page). `DepositPageService.show` gives the page (`depositState` in `#modules/payments/deposit_page`: cancelled, paid, submitted, due or expired, updating) and `submitProof` takes one screenshot at a time: pre-check, `ImageService.store` with `payment_proof` and `afterRollback`, lock the project (`ProjectService.lockLive`), check again, then `DepositService.recordProof` inserts the `submitted` payment with its proof in one INSERT and `DepositProofAlertJob` is queued. Every dead link is `DepositPageNotFoundError` (the API's one 404). The link's URL is `STOREFRONT_URL` (`{tenant}` for the slug) plus `/deposit#<token>`: the token rides in the fragment. `DepositService` (this ticket's) also gives `remaining`, `pendingProof`, `lastDecisionRejected` and `countPendingProofs` (the Projects badge).
```

- In **Rate limits**, append a bullet:

```markdown
- The deposit endpoints (TAT-65) count every request per client address and per link token, reads and uploads apart (`DEPOSIT_LIMITS` in `#modules/payments/deposit_limits`: GET 120 per address and 60 per token per 10 minutes, POST 20 and 10 per hour), in the `depositThrottle` middleware after `publicTenant`, with `limiter.multi` (the address first). Keys are digests of `clientAddress(ip)` and of the token. The upload route is in `multipart.processManually` and reads its body with `receiveUploads` after the link check, so a refused or dead-link upload never reaches the disk; TAT-38 may move the per-address part ahead of the tenant lookup.
```

- In the **Public API** section (TAT-32's), add a sentence: "A route with parameters besides `:tenant` (the deposit page's `:token`) gives its isolation case `params`, and a multipart write with files gives `files` (TAT-65)."

In `apps/platform/docs/jobs-and-email.md`, after TAT-51's `NewInquiryAlertJob` bullet (or after the quote expiry bullet if it isn't there), add:

```markdown
- Deposit proofs (TAT-65): `DepositPageService.submitProof` queues `DepositProofAlertJob { tenantId, paymentId }` in the payment's transaction. It does nothing for a payment that is gone or decided and otherwise logs "Deposit proof received." with the tenant, project and payment ids (never the link, the token, a URL or the amount). TAT-52 sends the owners' email and in-app alert from it; until then the Projects badge (`proofCount`) is the owners' alert.
```

In `apps/platform/docs/testing.md`, **Tenant isolation tests**:

- In the `twoStudios()` bullet, after "a submitted payment)", add: ", a deposit_pending project with its deposit link (`depositProject`, `depositToken`, `depositReferenceCode`) and the eSewa method its page shows (`depositMethod`)".
- In the public isolation sentence (TAT-32's), add: "A route with parameters besides `:tenant` needs `params` (the harness also sends B's values under A's slug, which must be the 404); a multipart write sends `body` as fields and `files` as parts (TAT-65)."
- Add a bullet: "Deposit tests build their services with `depositServices()` and a studio ready for a link with `depositReady()` (`#tests/helpers/deposits`); `postProof`, `proofPart` and `storedProofs` drive the public endpoints. `.env.test` sets `STOREFRONT_URL` so link URLs never depend on a developer's `.env`."

In `apps/platform/database/README.md`, in the soft-delete bullet's "Not soft-deleted:" list, after "quotes (versioned history)," add "deposit links (a credential replaced in place; a deleted project's link is dead because the deposit page loads only live projects),".

- [ ] **Step 2: Product docs**

In `docs/sdk.md`:

- In the **Public API by stage** table, MVP row, add `deposits.get` and `deposits.submitProof` after `inquiries.create`.
- After the paragraph "Inquiries, clients, quotes and payments are never readable through the public API. The deposit page is the one exception: …", add:

```markdown
The deposit page reads `client.deposits.get(token)` and sends the screenshot with `client.deposits.submitProof(token, { proof, method, expectedAmount })`, where `expectedAmount` is the page's `deposit.due` (React: `useDeposit(token)`, `useSubmitDepositProof(token)`). The token is the fragment of the link the studio sent (`https://<studio>/deposit#<token>`): a bearer secret that must stay out of logs and analytics. Every link that doesn't work is a 404; a state that takes no screenshot is `deposit_not_due` and a stale amount `deposit_changed` (both 409: refetch the page). Both calls are never cached and rate-limited per address and per link.
```

- In the list of endpoint codes (TAT-51's), add `deposit_not_due` and `deposit_changed` (409, `submitDepositProof`).

In `docs/requirements.md`, under **Quotes and payments**, after the "Deposit page per project…" item (leave its box unticked: TAT-65b ticks it with the storefront page), add:

```markdown
- An owner makes a project's deposit link while its deposit is due; it works for 30 days and can be replaced at once (the old link stops working, the reference code stays). The page shows the studio, the project's brief, the deposit, the studio's deposit-page methods, a 6-character reference code for the payment remark and the deposit policy, and takes one screenshot at a time, which owners are alerted to.
```

In `docs/architecture.md`, **Request flows → Deposit (customer → studio)**: in step 1, replace "and a deposit page link goes out the same way." with "and an owner sends the deposit page link the same way (`https://<studio>/deposit#<token>`, 30 days)."; in step 2, replace "and uploads proof on the deposit page." with "and uploads proof on the deposit page, which records a `submitted` payment and alerts the owners."

In `README.md`, **Deployment**, add:

```markdown
- **Deposit links:** set `STOREFRONT_URL` on the platform to the studio pages' origin with `{tenant}` for the slug (e.g. `https://{tenant}.example.com`); deposit links are built from it (TAT-65).
```

`docs/README.md` needs no change (`sdk.md#public-api-by-stage` and the other anchors stay).

- [ ] **Step 3: Check and commit**

Run: `pnpm -C <repo> check`
Expected: no errors.

```bash
git -C <repo> add apps/platform/docs apps/platform/database/README.md docs/sdk.md docs/requirements.md docs/architecture.md README.md
git -C <repo> commit -m "docs(platform): document deposit links and the deposit page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Final verification

- [ ] **Step 1: Generated files are in step**

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate && pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> status --short`
Expected: no changes.

- [ ] **Step 2: The migration rolls back and re-applies**

Run: `pnpm -C <repo>/apps/platform exec node ace migration:rollback --connection=owner --step=1`, then `pnpm -C <repo>/apps/platform migrate`, then `git -C <repo> diff --exit-code apps/platform/database/schema.ts`.
Expected: `deposit_links` dropped and created again; no diff. (The dev database is shared with other checkouts: say in your report that it now has `deposit_links`, so another checkout's `pnpm migrate` would regenerate its `schema.ts` with `DepositLinkSchema`.)

- [ ] **Step 3: The whole suite and the gates**

Run in the background: `PORT=3402 timeout 600 pnpm -C <repo>/apps/platform test > <scratchpad>/suite.log 2>&1`
Expected: the log's `Tests` line shows every test passing (the TAT-51 tip's count plus this branch's).

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test && pnpm -C <repo> --filter @tattoo-drip/react test`
Expected: PASS.

Run: `pnpm -C <repo> check && pnpm -C <repo> typecheck && pnpm -C <repo> build`
Expected: all three pass.

- [ ] **Step 4: The token stays out of the code paths that log or store**

Run: `rg -n 'logger\.(info|warn|error)' <repo>/apps/platform/app/modules/payments <repo>/apps/platform/app/controllers/public_deposits_controller.ts <repo>/apps/platform/app/middleware/deposit_throttle_middleware.ts`
Expected: only `DepositProofAlertJob`'s two calls, which log ids.

- [ ] **Step 5: Report**

Write the PR text to `<scratchpad>/pr2-tat-65.md` (not committed): what and why in a few bullets per area, the rulings that depart from the ticket (the storefront page is TAT-65b; ruling 1), the carry-forwards to post (spec, "Carry-forwards"), the browser pass the user owes (the project page's deposit panel at 375 px: make, copy, send, replace, an expired link, a waiting screenshot; the Projects badge), and the "before any public deploy" list from the spec. Then the whole-branch review and the Codex code and security reviews.

