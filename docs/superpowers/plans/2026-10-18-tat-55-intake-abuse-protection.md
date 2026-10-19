# Abuse protection on the intake form (TAT-55) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/v1/tenants/:tenant/inquiries` refuses scripted and flooded submissions cheaply (a Cloudflare Turnstile token checked before the body is read, a `website` honeypot, limits per address, studio and phone), and the contract and SDK say exactly what a browser form must send.

**Architecture:** The token moves from a form field to an `X-Challenge-Token` header. A new `intakeGuard` route middleware, after `publicTenant`, counts the client address, asks Cloudflare through an injectable `BotChallenge` service, then counts the studio, all before the controller reads the multipart body. The controller refuses a filled honeypot right after `receiveUploads` and counts the E.164 phone after validation. Limits use TAT-8's limiter (`limiter.use`, digest keys, its own `limiter` pool); the secret is a boot-checked `TURNSTILE_SECRET_KEY`.

**Tech Stack:** AdonisJS 7 (router, named middleware, `@inject()`, container `swap`), `@adonisjs/limiter`, VineJS, Japa (`@japa/api-client`, `@japa/assert`, `node:test` `mock`), OpenAPI 3.1 with `openapi-typescript`, `@tattoo-drip/sdk` and `@tattoo-drip/react` (`node:test` with `tsx`, TanStack Query 5), TypeScript 6, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-55-intake-abuse-protection-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- **No migration.** Never edit `apps/platform/database/schema.ts`, `packages/types/src/openapi.gen.ts` or `apps/platform/.adonisjs/` by hand: regenerate with `pnpm --filter @tattoo-drip/types generate` and `pnpm -C apps/platform exec node ace codegen`, and commit what they write. Never touch `apps/storefront`.
- Wire names, verbatim: header `X-Challenge-Token` (Node gives it as `x-challenge-token`); widget action `inquiry`; honeypot field `website`; SDK input names `challengeToken` and `honeypot`; SDK constants `INQUIRY_CHALLENGE_ACTION = "inquiry"`, `INQUIRY_HONEYPOT_FIELD = "website"`.
- Verifier: `SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"`, one form-encoded POST with `secret` and `response` only (no `remoteip`, no `idempotency_key`, no retry), `CHALLENGE_TIMEOUT_MS = 3000`, `MAX_CHALLENGE_TOKEN_LENGTH = 2048`. Host and action are checked in production only (`strict`), and in the tests that turn them on.
- Codes and messages, verbatim: `challenge_failed` 403 "We couldn't confirm this request came from a person. Please try again."; `challenge_unavailable` 503 "We couldn't run the security check. Try again in a minute."
- Limits, verbatim: `perAddress: { requests: 20, duration: "1 hour" }`, `perTenant: { requests: 60, duration: "1 hour" }`, `perPhone: { requests: 10, duration: "24 hours" }`. Keys: `inquiry_ip_${digest(`${tenantId}:${clientAddress(ip)}`)}`, `inquiry_tenant_${tenantId}`, `inquiry_phone_${digest(`${tenantId}:${phone}`)}`.
- Order on the route: `publicApi`, `publicTenant`, `intakeGuard` (address count, challenge, studio count), then the controller (415, `receiveUploads`, honeypot, validation, phone count, `submit`).
- `TURNSTILE_SECRET_KEY`: a `Secret`, required when `NODE_ENV=production`, optional elsewhere (unset or empty: the check is off). `.env.test` sets it empty. Never log the token, the secret or Cloudflare's body; log only the fixed messages in Task 4.
- New test slugs end in `-55` (the dev database shares the slug registry). The unknown-studio slug is `no-such-studio-td55`.
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26, where the multipart parser stalls. Commands run from the repository root (this worktree). Platform tests use `PORT=3402` (3333 is taken). `<scratchpad>` is the session's scratchpad directory; logs go there, never `/tmp`. Never `sh -c`, never `pkill -f`.
- A spec that imports a missing module makes Japa hang: RED runs use `timeout 90` and a log file; exit 124 plus "Cannot find module" is that RED. Read the log's `Tests N passed` / `failed` line, not the wrapper's exit code.
- `@inject()` dependencies are value imports with the comment `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with an area scope (`types`, `sdk`, `react`, `platform`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line of your own session's reminder). Never push, never open a PR.
- If the rebase changed a line this plan quotes (TAT-23, 44 and 48 touch `packages/sdk`, `packages/react` and `openapi.yaml`), make the same change to the line as it is now; never restore the old text.

## Review Focus

1. A blank token (`"   "`), an empty header or one over 2048 characters must fail without asking Cloudflare, never pass and never 500. Test: Task 4 "no token, a blank one or one over 2048 characters fails without a call".
2. Cloudflare answering 200 with something that isn't a verdict (`{ "success": "true" }`, an array, `error-codes` that isn't a list) must be `unavailable`, never `passed`. Test: Task 4 "an answer that isn't a verdict, an error status, a timeout or a network error is unavailable".
3. A hostname in other letter case must pass, and one that only starts with the studio's host (`intake-guard-55.localhost.evil.example`) must fail. Tests: Task 4 "a good token for this studio page passes" and "a token from another page or for another form fails".
4. The same phone typed nationally and internationally must share one count. Test: Task 9 "the try after 10 with one phone … however the number is typed".
5. A request refused by the address limit must not reach Cloudflare, and a write under an old or unknown slug must count nothing. Tests: Task 8 "the try after 20 from one address …" and "an old or unknown slug is TAT-32's 404 first …".

---

## Task 0: Preconditions

- [ ] **Step 1: The base has the built public API chain.** This branch was designed on 715b827 (designs only). Run:

```bash
rg -n "export function publicTenantContext" apps/platform/app/middleware/public_tenant_middleware.ts
rg -n "export async function (receiveUploads|discardUploads)" apps/platform/app/services/uploads.ts
rg -n "TAT-55" apps/platform/start/routes.ts apps/platform/app/controllers/public_inquiries_controller.ts
rg -n "challengeToken: vine.string\(\).maxLength\(2048\).optional\(\)" apps/platform/app/modules/inquiries/validators/intake.ts
rg -n "export const OPEN_INQUIRY_LIMIT = 3" apps/platform/app/modules/inquiries/services/intake_service.ts
rg -n "too_many_open_inquiries: \{" apps/platform/app/services/public_api.ts
rg -n "^\t\tlimiter: \{" apps/platform/config/database.ts
rg -n "connectionName: \"limiter\"" apps/platform/config/limiter.ts
rg -n "export function (digest|clientAddress)" apps/platform/app/services/rate_limits.ts
rg -n "export function checkStorefrontUrl|^function originOf" apps/platform/app/services/storefront_url.ts
rg -n "export function storefrontTemplate" apps/platform/app/modules/payments/deposit_links.ts
rg -n "\"/api/v1/tenants/:tenant/inquiries\"" apps/platform/config/bodyparser.ts
rg -n "headers: \[\"accept\", \"content-type\"\]" apps/platform/config/cors.ts
rg -n "export (async )?function (postInquiry|intakeFields|png|intakeRows)" apps/platform/tests/helpers/intake.ts
rg -n "export (async )?function (tempUploads|newTempUploads|storedReferenceImages)" apps/platform/tests/helpers/uploads.ts
rg -n "const PUBLIC_ONLY" apps/platform/tests/functional/api/api_routes.spec.ts
rg -n "if \(challengeToken\) form.set" packages/sdk/src/client.ts
rg -n "createInquiry: \(client: TattooClient\)" packages/react/src/queries.ts
rg -n "challengeToken:" packages/types/openapi.yaml
rg -n "Secret" apps/platform/node_modules/@adonisjs/core/build/src/helpers/main.d.ts
```

Expected: every pattern found. If anything is missing, STOP: the branch must first be rebased onto the newest built tip of the stack (TAT-48's, else TAT-44's or TAT-23's; at least the public API chain's 1b535f1, TAT-24, 32, 51, 65, 66); that is the coordinator's call, and only the spec and plan commit sits on top. If a review renamed one of these, use the real name everywhere below.

- [ ] **Step 2: Nothing of TAT-55 exists yet.** Run `rg -n "TURNSTILE|challenge_failed|intakeGuard|X-Challenge-Token" apps/platform packages --glob '!**/node_modules/**'`.
Expected: nothing (the TAT-55 comments found in Step 1 don't contain these words).

- [ ] **Step 3: Clean tree, Node and the platform's `.env`.** `git status -sb` shows no changes; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`; `ls apps/platform/.env` lists the file (tests boot with it; the harness blocks reading it, so never copy it by reading it: if it is missing, STOP and ask the coordinator). Note `git rev-parse HEAD` as `<base>` (Task 11 compares against it).

- [ ] **Step 4: Baselines.** Run the full platform suite in the background (about 2 to 3 minutes) and the package tests:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C apps/platform test > <scratchpad>/t55-baseline.log 2>&1
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test
```

Expected: the log ends with `Tests N passed` and no failures (note N); `# fail 0` in the SDK and React runs (note their pass counts).

---

### Task 1: The contract, the SDK and the React options carry the token in a header

**Files:**
- Modify: `packages/types/openapi.yaml` (info, `createInquiry`, `components.parameters`, `ErrorResponse`, `InquiryForm`)
- Regenerate: `packages/types/src/openapi.gen.ts`
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Modify: `packages/react/src/queries.ts` (comment only)
- Test: `packages/sdk/test/client.test.ts`, `packages/react/test/mutations.test.ts`

**Interfaces:**
- Consumes: the SDK's `request(url, init, call)` (merges `init.headers` into `new Headers(...)`), `CreateInquiryInput`, `tattooMutations.createInquiry` (`retry: false`).
- Produces: `CreateInquiryInput.challengeToken?: string` (sent as `X-Challenge-Token`), `CreateInquiryInput.honeypot?: string` (sent as `website` when non-empty), exported `INQUIRY_CHALLENGE_ACTION` and `INQUIRY_HONEYPOT_FIELD`; contract parameter `ChallengeToken`, responses 403 and 503 on `createInquiry`, `InquiryForm.website`.

- [ ] **Step 1: Edit the contract**

In `packages/types/openapi.yaml`, `info.description`, replace:

```yaml
      `Access-Control-Allow-Origin: *` on every response, for GET, HEAD and
      POST with the `Accept` and `Content-Type` request headers. `Retry-After`
      is readable.
```

with:

```yaml
      `Access-Control-Allow-Origin: *` on every response, for GET, HEAD and
      POST with the `Accept`, `Content-Type` and `X-Challenge-Token` request
      headers. `Retry-After` is readable.
```

In `/tenants/{tenant}/inquiries` → `post`, add right after `summary: Send the studio an inquiry, with reference images`:

```yaml
      parameters:
        - $ref: "#/components/parameters/ChallengeToken"
```

and append to its `description` (after the paragraph that ends "`validation_failed` on `referenceImages.<index>`."):

```yaml

        Abuse protection (TAT-55): send the bot-challenge token in
        `X-Challenge-Token` and leave the honeypot field `website` out. A
        missing, invalid, expired or reused token, or a filled `website`, is
        403 `challenge_failed`; when the API can't check the token it is 503
        `challenge_unavailable`. Requests are rate-limited per address, per
        studio and per phone number (429 `rate_limited` with `Retry-After`,
        up to a day for one phone number).
```

In its `responses`, add after `"400": { $ref: "#/components/responses/Error" }`:

```yaml
        "403":
          description: The bot challenge failed (`challenge_failed`). Get a new token and send again.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
```

and after `"429": { $ref: "#/components/responses/RateLimited" }`:

```yaml
        "503":
          description: The bot challenge could not be checked (`challenge_unavailable`). Try again in a minute.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
```

In `components.parameters`, add after the `DepositToken` parameter:

```yaml
    ChallengeToken:
      name: X-Challenge-Token
      in: header
      required: true
      description: |
        The bot-challenge token the studio page's Cloudflare Turnstile widget
        made for this submission, rendered with action `inquiry`. Single-use:
        get a new one for every request, also after a refusal. Missing,
        invalid, expired, already used, or made on another page or for
        another form: 403 `challenge_failed`. A local development server
        without the challenge set up ignores it.
      schema: { type: string, minLength: 1, maxLength: 2048 }
```

In `ErrorResponse.properties.error.properties.code`, replace:

```yaml
                (500). Endpoint codes: `artist_not_accepting`,
                `studio_not_accepting`, `too_many_open_inquiries` (409,
                `createInquiry`), `deposit_not_due`, `deposit_changed` (409,
                `submitDepositProof`). Treat an unknown code by its HTTP status.
              examples: [not_found, validation_failed, rate_limited, too_many_open_inquiries, deposit_changed]
```

with:

```yaml
                (500). Endpoint codes: `artist_not_accepting`,
                `studio_not_accepting`, `too_many_open_inquiries` (409),
                `challenge_failed` (403) and `challenge_unavailable` (503),
                all `createInquiry`; `deposit_not_due`, `deposit_changed`
                (409, `submitDepositProof`). Treat an unknown code by its HTTP
                status.
              examples: [not_found, validation_failed, rate_limited, too_many_open_inquiries, challenge_failed, deposit_changed]
```

In `InquiryForm`, replace:

```yaml
            challengeToken:
              type: string
              maxLength: 2048
              description: Bot-challenge token. The intake form will need it (TAT-55); the API ignores it until then.
```

with:

```yaml
            website:
              type: string
              maxLength: 0
              description: A honeypot that people never see. Leave it out or empty; any other value is refused as `challenge_failed`. (The bot-challenge token goes in the `X-Challenge-Token` header; a `challengeToken` field is ignored.)
```

- [ ] **Step 2: Regenerate and check**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate
rg -n "X-Challenge-Token|website\?|challengeToken" packages/types/src/openapi.gen.ts
```

Expected: `X-Challenge-Token` and `website?` appear; `challengeToken` does not.

- [ ] **Step 3: Write the failing SDK tests**

In `packages/sdk/test/client.test.ts`, extend the import from `"../src/index.js"`:

```ts
import {
	type CreateInquiryInput,
	createTattooClient,
	INQUIRY_CHALLENGE_ACTION,
	INQUIRY_HONEYPOT_FIELD,
	TattooApiError,
} from "../src/index.js";
```

In `describe("inquiries.create")`, test "posts one multipart form to the tenant's inquiries, without cookies": rename it to `"posts one multipart form to the tenant's inquiries, the token in a header, without cookies"`, remove the line `"challengeToken",` from the expected `form.keys()` list, and replace `assert.equal(form.get("challengeToken"), "token-51");` with:

```ts
		assert.equal(headers.get("x-challenge-token"), "token-51");
		assert.equal(form.has("challengeToken"), false);
```

In test "without images or a token it sends only the fields", replace `assert.equal(form.has("challengeToken"), false);` with:

```ts
		assert.equal(form.has("challengeToken"), false);
		assert.equal(form.has(INQUIRY_HONEYPOT_FIELD), false);
		assert.equal(
			new Headers(calls[0].init.headers).has("x-challenge-token"),
			false,
		);
```

Add these tests at the end of `describe("inquiries.create")`:

```ts
	test("the honeypot goes as the website field, only when it holds something", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: ID } }));

		await client(fetch).inquiries.create({ ...input, honeypot: "" });
		await client(fetch).inquiries.create({
			...input,
			honeypot: "https://spam.example",
		});

		const [empty, filled] = calls.map((call) => call.init.body as FormData);
		assert.equal(empty.has(INQUIRY_HONEYPOT_FIELD), false);
		assert.equal(filled.get(INQUIRY_HONEYPOT_FIELD), "https://spam.example");
		assert.equal(filled.has("honeypot"), false);
	});

	test("a refused or unchecked challenge is a TattooApiError with its code, never retried", async () => {
		const failed = fakeFetch(() =>
			json(403, {
				error: {
					code: "challenge_failed",
					message:
						"We couldn't confirm this request came from a person. Please try again.",
				},
			}),
		);
		const unavailable = fakeFetch(() =>
			json(503, {
				error: {
					code: "challenge_unavailable",
					message: "We couldn't run the security check. Try again in a minute.",
				},
			}),
		);

		const refused = await rejection(
			client(failed.fetch).inquiries.create({ ...input, challengeToken: "spent" }),
		);
		const unchecked = await rejection(
			client(unavailable.fetch).inquiries.create({ ...input, challengeToken: "t" }),
		);

		assert.ok(refused instanceof TattooApiError);
		assert.equal(refused.status, 403);
		assert.equal(refused.code, "challenge_failed");
		assert.ok(unchecked instanceof TattooApiError);
		assert.equal(unchecked.status, 503);
		assert.equal(unchecked.code, "challenge_unavailable");
		assert.equal(failed.calls.length, 1);
		assert.equal(unavailable.calls.length, 1);
	});

	test("names the widget's action and the honeypot field for the form", () => {
		assert.equal(INQUIRY_CHALLENGE_ACTION, "inquiry");
		assert.equal(INQUIRY_HONEYPOT_FIELD, "website");
	});
```

- [ ] **Step 4: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test`
Expected: FAIL: the import of `INQUIRY_CHALLENGE_ACTION` / `INQUIRY_HONEYPOT_FIELD` is undefined, the header assertions fail (the token is still a form field).

- [ ] **Step 5: Implement in the SDK**

In `packages/sdk/src/client.ts`, add after `const UPLOAD_TIMEOUT_MS = 120_000;`:

```ts
/** The action the studio page's Turnstile widget is rendered with for an inquiry (TAT-55). */
export const INQUIRY_CHALLENGE_ACTION = "inquiry";
/** The intake form's honeypot field: people never see it, so they leave it empty (TAT-55). */
export const INQUIRY_HONEYPOT_FIELD = "website";
```

Replace the `challengeToken` member of `CreateInquiryInput`:

```ts
	/** Bot-challenge token (TAT-55); the API ignores it until then. */
	challengeToken?: string;
```

with:

```ts
	/**
	 * The bot-challenge token the studio page's Turnstile widget made for
	 * this submission (rendered with action `INQUIRY_CHALLENGE_ACTION`).
	 * Sent as the `X-Challenge-Token` header, which the API checks before it
	 * reads the upload. Single-use: get a new one for every call, also after
	 * a refusal. The deployed API refuses a call without one
	 * (`challenge_failed`).
	 */
	challengeToken?: string;
	/**
	 * What the form's hidden honeypot input (`INQUIRY_HONEYPOT_FIELD`) holds.
	 * Sent as that field only when it isn't empty; a filled one is refused
	 * as `challenge_failed`.
	 */
	honeypot?: string;
```

In `inquiries.create`, extend the doc comment's list of codes: replace

```ts
			 * TattooApiError such as `validation_failed` (with `fields` by
			 * input name), `artist_not_accepting`, `studio_not_accepting`,
			 * `too_many_open_inquiries` or `payload_too_large`.
```

with:

```ts
			 * TattooApiError such as `validation_failed` (with `fields` by
			 * input name), `artist_not_accepting`, `studio_not_accepting`,
			 * `too_many_open_inquiries`, `payload_too_large`,
			 * `challenge_failed` (403: get a new token), `challenge_unavailable`
			 * (503) or `rate_limited` (429, with `retryAfter`). Never retried.
```

and replace its body from the destructuring to the `request` call:

```ts
				const { referenceImages = [], challengeToken, ...fields } = input;
```

with:

```ts
				const {
					referenceImages = [],
					challengeToken,
					honeypot,
					...fields
				} = input;
```

replace `if (challengeToken) form.set("challengeToken", challengeToken);` with:

```ts
				if (honeypot) form.set(INQUIRY_HONEYPOT_FIELD, honeypot);
```

and replace

```ts
					// No Content-Type: fetch sets multipart's boundary itself.
					{ method: "POST", body: form },
```

with:

```ts
					// No Content-Type: fetch sets multipart's boundary itself. The
					// token goes in a header, so the API checks it before it reads
					// the upload (TAT-55); the request then preflights.
					{
						method: "POST",
						body: form,
						headers: challengeToken
							? { "X-Challenge-Token": challengeToken }
							: undefined,
					},
```

In `packages/sdk/src/index.ts`, change the `./client.js` export to:

```ts
export {
	type CreateInquiryInput,
	createTattooClient,
	INQUIRY_CHALLENGE_ACTION,
	INQUIRY_HONEYPOT_FIELD,
	type RequestOptions,
	type SubmitDepositProofInput,
	type TattooClient,
	type TattooClientOptions,
} from "./client.js";
```

- [ ] **Step 6: Run the SDK tests and typecheck**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk typecheck
```

Expected: `# fail 0` with 3 more passing tests than the Task 0 baseline; typecheck clean.

- [ ] **Step 7: Pin the React options (passes at once: React's code doesn't change)**

In `packages/react/test/mutations.test.ts`, change the SDK import to `import { type CreateInquiryInput, type TattooClient, TattooApiError } from "@tattoo-drip/sdk";` and add at the end of `describe("tattooMutations.createInquiry")`:

```ts
	test("passes the token and the honeypot through, and never retries a refused challenge", async () => {
		const { client, calls } = fakeClient(async () => {
			throw new TattooApiError(403, {
				code: "challenge_failed",
				message: "We couldn't confirm this request came from a person. Please try again.",
			});
		});
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: 3, retryDelay: 0 } },
		});
		const observer = new MutationObserver(
			queryClient,
			tattooMutations.createInquiry(client),
		);
		const sent = { ...input, challengeToken: "tok-55", honeypot: "" };

		await assert.rejects(
			observer.mutate(sent),
			(error) =>
				error instanceof TattooApiError && error.code === "challenge_failed",
		);

		assert.deepEqual(calls, [sent]);
	});
```

In `packages/react/src/queries.ts`, replace the comment above `export const tattooMutations`:

```ts
 * `createInquiry` never retries, whatever the app's `QueryClient` defaults
 * say: a retry after a timeout could send the inquiry (and its images) twice,
 * and each copy uses one of the phone's three open-inquiry slots.
```

with:

```ts
 * `createInquiry` never retries, whatever the app's `QueryClient` defaults
 * say: a retry after a timeout could send the inquiry (and its images) twice,
 * and each copy uses one of the phone's three open-inquiry slots; and its
 * bot-challenge token is single-use, so a retry would send a spent one.
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react typecheck`
Expected: `# fail 0`, one more passing test than the baseline; typecheck clean. (This test pins existing behaviour; to see it can fail, temporarily set `retry: 3` in `createInquiry`, watch it fail with 4 calls, and revert.)

- [ ] **Step 8: Commit**

```bash
git add packages/types/openapi.yaml packages/types/src/openapi.gen.ts
git commit -m "feat(types): send the intake's bot-challenge token in a header and add the challenge codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/test/client.test.ts
git commit -m "feat(sdk): send the challenge token as X-Challenge-Token and the honeypot as website

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add packages/react/src/queries.ts packages/react/test/mutations.test.ts
git commit -m "test(react): pin that a refused challenge is never retried

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The two challenge codes in the error catalog

**Files:**
- Modify: `apps/platform/app/services/public_api.ts` (`ApiErrorCode`, `API_ERRORS`)
- Test: `apps/platform/tests/unit/services/public_api_errors.spec.ts`

**Interfaces:**
- Consumes: `ApiException.of(code)`, `apiErrorFor(error)`.
- Produces: `ApiException.of("challenge_failed")` (403) and `ApiException.of("challenge_unavailable")` (503), used by Tasks 8 and 9.

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/unit/services/public_api_errors.spec.ts`:

```ts
test.group("The challenge codes", () => {
	test("challenge_failed is a 403 and challenge_unavailable a 503, each with its one message", ({
		assert,
	}) => {
		const cases = [
			[
				403,
				"challenge_failed",
				"We couldn't confirm this request came from a person. Please try again.",
			],
			[
				503,
				"challenge_unavailable",
				"We couldn't run the security check. Try again in a minute.",
			],
		] as const;

		for (const [status, code, message] of cases) {
			assert.deepEqual(
				apiErrorFor(ApiException.of(code)),
				{ status, body: { error: { code, message } }, headers: {} },
				code,
			);
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=public_api_errors.spec.ts > <scratchpad>/t55-t2-red.log 2>&1`
Expected: the new test fails (a TypeError: `API_ERRORS.challenge_failed` is undefined).

- [ ] **Step 3: Add the codes**

In `apps/platform/app/services/public_api.ts`, extend `ApiErrorCode` after `| "too_many_open_inquiries"`:

```ts
	| "challenge_failed"
	| "challenge_unavailable"
```

and add to `API_ERRORS` after the `too_many_open_inquiries` entry:

```ts
	// The intake's bot challenge and honeypot (TAT-55): one message, never why.
	challenge_failed: {
		status: 403,
		code: "challenge_failed",
		message:
			"We couldn't confirm this request came from a person. Please try again.",
	},
	challenge_unavailable: {
		status: 503,
		code: "challenge_unavailable",
		message: "We couldn't run the security check. Try again in a minute.",
	},
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=public_api_errors.spec.ts > <scratchpad>/t55-t2-green.log 2>&1`
Expected: `Tests N passed`, no failures.

- [ ] **Step 5: Commit**

```bash
git add apps/platform/app/services/public_api.ts apps/platform/tests/unit/services/public_api_errors.spec.ts
git commit -m "feat(platform): add the challenge_failed and challenge_unavailable codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `TURNSTILE_SECRET_KEY`, required in production

**Files:**
- Create: `apps/platform/app/services/challenge_secret.ts`
- Modify: `apps/platform/start/env.ts`, `apps/platform/.env.example`, `apps/platform/.env.test`
- Test: `apps/platform/tests/unit/services/challenge_secret.spec.ts`

**Interfaces:**
- Consumes: `Secret` from `@adonisjs/core/helpers`.
- Produces: `checkChallengeSecret(key: string, value: string | undefined, production: boolean): Secret<string> | undefined`; `env.get("TURNSTILE_SECRET_KEY"): Secret<string> | undefined` (Task 4 reads it).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/services/challenge_secret.spec.ts`:

```ts
import { test } from "@japa/runner";
import { checkChallengeSecret } from "#services/challenge_secret";
import env from "#start/env";

const KEY = "TURNSTILE_SECRET_KEY";
const VALUE = "0x4AAAAAAAtest-secret-55";

test.group("TURNSTILE_SECRET_KEY at boot", () => {
	test("a set value is a Secret, in production too, and never prints", ({
		assert,
	}) => {
		for (const production of [false, true]) {
			const secret = checkChallengeSecret(KEY, VALUE, production);
			assert.equal(secret?.release(), VALUE);
			assert.notInclude(String(secret), VALUE);
			assert.notInclude(JSON.stringify({ secret }), VALUE);
		}
	});

	test("it is optional outside production: unset or empty turns the check off", ({
		assert,
	}) => {
		assert.isUndefined(checkChallengeSecret(KEY, undefined, false));
		assert.isUndefined(checkChallengeSecret(KEY, "", false));
	});

	test("in production it is required, with a message that says where to find it", ({
		assert,
	}) => {
		for (const value of [undefined, ""]) {
			assert.throws(
				() => checkChallengeSecret(KEY, value, true),
				/TURNSTILE_SECRET_KEY is required in production.*Turnstile/,
			);
		}
	});

	test("a value with spaces or line breaks is refused without showing it", ({
		assert,
	}) => {
		for (const value of [` ${VALUE}`, `${VALUE}\n`, "two words"]) {
			for (const production of [false, true]) {
				try {
					checkChallengeSecret(KEY, value, production);
					assert.fail(`accepted ${JSON.stringify(value)}`);
				} catch (error) {
					assert.match(String(error), /must not contain spaces/);
					assert.notInclude(String(error), value.trim());
				}
			}
		}
	});

	test("tests run with the check off (.env.test sets it empty)", ({
		assert,
	}) => {
		assert.isUndefined(env.get("TURNSTILE_SECRET_KEY"));
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=challenge_secret.spec.ts > <scratchpad>/t55-t3-red.log 2>&1`
Expected: exit 124 and "Cannot find module" for `#services/challenge_secret` in the log.

- [ ] **Step 3: Write the check**

Create `apps/platform/app/services/challenge_secret.ts`:

```ts
import { Secret } from "@adonisjs/core/helpers";

/**
 * Checks TURNSTILE_SECRET_KEY as start/env.ts reads it (TAT-55): the secret
 * key of the studio pages' Cloudflare Turnstile widget, which the API sends
 * to Cloudflare to check each intake's bot-challenge token. Required in
 * production; unset or empty elsewhere, the check is off and any request
 * passes it. Returned as a Secret, so it never prints in a log. This file
 * imports nothing from the app, because start/env.ts runs it while the
 * environment is still being read; its messages never contain the value.
 */
export function checkChallengeSecret(
	key: string,
	value: string | undefined,
	production: boolean,
): Secret<string> | undefined {
	if (!value) {
		if (production) {
			throw new Error(
				`${key} is required in production: the secret key of the studio pages' Cloudflare Turnstile widget (Cloudflare dashboard, Turnstile, the widget's settings)`,
			);
		}
		return undefined;
	}
	if (/\s/.test(value)) {
		throw new Error(
			`${key} must not contain spaces or line breaks: copy the secret key again`,
		);
	}
	return new Secret(value);
}
```

In `apps/platform/start/env.ts`, add `import { checkChallengeSecret } from "#services/challenge_secret";` next to the `checkStorefrontUrl` import, and after the `STOREFRONT_URL` entry:

```ts
	// The secret key of the studio pages' Cloudflare Turnstile widget: the
	// intake's bot challenge (TAT-55). Required in production; unset in
	// development and tests, the check is off.
	TURNSTILE_SECRET_KEY: (key: string, value?: string) =>
		checkChallengeSecret(key, value, process.env.NODE_ENV === "production"),
```

In `apps/platform/.env.example`, after the `# STOREFRONT_URL=https://{tenant}.example.com` line:

```
# The secret key of the studio pages' Cloudflare Turnstile widget (the
# intake form's bot challenge, TAT-55): Cloudflare dashboard, Turnstile, the
# widget's settings. REQUIRED when NODE_ENV=production (the app refuses to
# start without it). Unset in development, the check is off and any inquiry
# passes it.
# TURNSTILE_SECRET_KEY=
```

In `apps/platform/.env.test`, append:

```
# Never inherit a developer's Turnstile secret: the bot challenge stays off
# in tests unless a test turns it on (tests/helpers/challenge.ts).
TURNSTILE_SECRET_KEY=
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=challenge_secret.spec.ts > <scratchpad>/t55-t3-green.log 2>&1`
Expected: `Tests 5 passed`.

- [ ] **Step 5: Production refuses to boot without it.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH NODE_ENV=production STOREFRONT_URL='https://{tenant}.example.com' TURNSTILE_SECRET_KEY= timeout 60 pnpm -C apps/platform exec node ace list > <scratchpad>/t55-t3-boot.log 2>&1`
Expected: a non-zero exit and `TURNSTILE_SECRET_KEY is required in production` in the log (the environment loader prints each failing key). Then the same command with `TURNSTILE_SECRET_KEY=boot-check-55`: the command list prints (exit 0). (The loader takes `process.env[key] || <.env value>`, so an empty variable on the command line does not hide a secret set in `apps/platform/.env`: if the first run boots, check whether that file sets it, without printing the file.)

- [ ] **Step 6: Commit**

```bash
git add apps/platform/app/services/challenge_secret.ts apps/platform/start/env.ts apps/platform/.env.example apps/platform/.env.test apps/platform/tests/unit/services/challenge_secret.spec.ts
git commit -m "feat(platform): require TURNSTILE_SECRET_KEY in production

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `BotChallenge` asks Cloudflare once, and `studioHostname`

**Files:**
- Create: `apps/platform/app/services/bot_challenge.ts`
- Modify: `apps/platform/app/services/storefront_url.ts` (add `studioHostname`)
- Test: `apps/platform/tests/unit/services/bot_challenge.spec.ts`, `apps/platform/tests/unit/services/storefront_url.spec.ts`

**Interfaces:**
- Consumes: `env.get("TURNSTILE_SECRET_KEY")` (Task 3), `app.inProduction`, `logger`.
- Produces: `export default class BotChallenge` with `constructor(options?: BotChallengeOptions)` and `verify(token: string | undefined, expected: ChallengeExpectation): Promise<ChallengeOutcome>`; `type ChallengeOutcome = "passed" | "failed" | "unavailable"`; `type ChallengeExpectation = { hostname: string; action: string }`; `type BotChallengeOptions = { secret?: Secret<string>; fetch?: typeof globalThis.fetch; timeoutMs?: number; strict?: boolean }`; constants `SITEVERIFY_URL`, `CHALLENGE_TOKEN_HEADER = "x-challenge-token"`, `MAX_CHALLENGE_TOKEN_LENGTH = 2048`, `CHALLENGE_TIMEOUT_MS = 3000`, `CHALLENGE_ACTIONS = { inquiry: "inquiry" } as const`; `studioHostname(template: string, slug: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/services/bot_challenge.spec.ts`:

```ts
import { mock } from "node:test";
import { Secret } from "@adonisjs/core/helpers";
import logger from "@adonisjs/core/services/logger";
import { test } from "@japa/runner";
import BotChallenge, {
	CHALLENGE_ACTIONS,
	SITEVERIFY_URL,
} from "#services/bot_challenge";

const SECRET = "0x4AAAAAAAunit-secret-55";
const TOKEN = "0.unit-token-55";
const HOST = "intake-guard-55.localhost";
const EXPECTED = { hostname: HOST, action: CHALLENGE_ACTIONS.inquiry };

type Call = { url: string; init: RequestInit; form: URLSearchParams };

/** A fetch that records each call (with its form) and answers with `answer`. */
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = {
			url: String(input),
			init,
			form: new URLSearchParams(String(init.body)),
		};
		calls.push(call);
		return answer(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

/** Cloudflare's verdict for a good token made on HOST's page, with changes. */
function verdict(over: Record<string, unknown> = {}) {
	return Response.json({
		success: true,
		"error-codes": [],
		challenge_ts: "2026-10-18T10:00:00.000Z",
		hostname: HOST,
		action: CHALLENGE_ACTIONS.inquiry,
		...over,
	});
}

function challenge(
	fetch: typeof globalThis.fetch,
	options: { strict?: boolean; timeoutMs?: number } = {},
) {
	return new BotChallenge({
		secret: new Secret(SECRET),
		fetch,
		strict: true,
		timeoutMs: 50,
		...options,
	});
}

/** Rejects with the signal's reason once it aborts, as fetch does. */
function hangUntilAborted({ init }: Call): Promise<Response> {
	const signal = init.signal as AbortSignal;
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

/** Silences warn and error and keeps what they were given. */
function captureLogs() {
	const warn = mock.method(logger, "warn", () => {});
	const error = mock.method(logger, "error", () => {});
	return {
		warnings: () => warn.mock.calls.map((call) => call.arguments),
		errors: () => error.mock.calls.map((call) => call.arguments),
		restore: () => {
			warn.mock.restore();
			error.mock.restore();
		},
	};
}

test.group("BotChallenge", () => {
	test("off without a secret: everything passes and Cloudflare is never asked", async ({
		assert,
	}) => {
		const { calls, fetch } = fakeFetch(() => verdict());
		const off = new BotChallenge({ secret: undefined, fetch });

		assert.equal(await off.verify(undefined, EXPECTED), "passed");
		assert.equal(await off.verify("anything", EXPECTED), "passed");
		assert.lengthOf(calls, 0);
		// The default instance in tests reads .env.test's empty secret.
		assert.equal(await new BotChallenge().verify(undefined, EXPECTED), "passed");
	});

	test("sends the secret and the token, form-encoded, to siteverify, and nothing else", async ({
		assert,
	}) => {
		const { calls, fetch } = fakeFetch(() => verdict());

		await challenge(fetch).verify(TOKEN, EXPECTED);

		assert.lengthOf(calls, 1);
		assert.equal(calls[0].url, SITEVERIFY_URL);
		assert.equal(calls[0].init.method, "POST");
		assert.instanceOf(calls[0].init.body, URLSearchParams);
		assert.deepEqual([...calls[0].form.keys()].sort(), ["response", "secret"]);
		assert.equal(calls[0].form.get("secret"), SECRET);
		assert.equal(calls[0].form.get("response"), TOKEN);
		assert.instanceOf(calls[0].init.signal, AbortSignal);
	});

	test("a good token for this studio page passes, whatever the host's letter case", async ({
		assert,
	}) => {
		for (const hostname of [HOST, "Intake-Guard-55.LOCALHOST"]) {
			const { fetch } = fakeFetch(() => verdict({ hostname }));
			assert.equal(await challenge(fetch).verify(TOKEN, EXPECTED), "passed");
		}
	});

	test("Cloudflare's refusals fail: invalid, expired or used twice, missing, malformed", async ({
		assert,
	}) => {
		for (const codes of [
			["invalid-input-response"],
			["timeout-or-duplicate"],
			["missing-input-response"],
			["bad-request"],
			[],
		]) {
			const { fetch } = fakeFetch(() =>
				verdict({ success: false, "error-codes": codes }),
			);
			assert.equal(
				await challenge(fetch).verify(TOKEN, EXPECTED),
				"failed",
				codes.join(),
			);
		}
	});

	test("a token from another page or for another form fails", async ({
		assert,
	}) => {
		for (const over of [
			{ hostname: "intake-other-55.localhost" },
			{ hostname: `${HOST}.evil.example` },
			{ hostname: undefined },
			{ hostname: null },
			{ action: "signup" },
			{ action: undefined },
		]) {
			const { fetch } = fakeFetch(() => verdict(over));
			assert.equal(
				await challenge(fetch).verify(TOKEN, EXPECTED),
				"failed",
				JSON.stringify(over),
			);
		}
	});

	test("outside production only success counts, so Cloudflare's test keys work locally", async ({
		assert,
	}) => {
		const other = fakeFetch(() =>
			verdict({ hostname: "example.com", action: "" }),
		);
		const refused = fakeFetch(() =>
			verdict({ success: false, "error-codes": ["invalid-input-response"] }),
		);

		assert.equal(
			await challenge(other.fetch, { strict: false }).verify(TOKEN, EXPECTED),
			"passed",
		);
		assert.equal(
			await challenge(refused.fetch, { strict: false }).verify(
				TOKEN,
				EXPECTED,
			),
			"failed",
		);
	});

	test("no token, a blank one or one over 2048 characters fails without a call", async ({
		assert,
	}) => {
		const { calls, fetch } = fakeFetch(() => verdict());

		for (const token of [undefined, "", "   ", "t".repeat(2049)]) {
			assert.equal(
				await challenge(fetch).verify(token, EXPECTED),
				"failed",
				String(token?.length),
			);
		}
		assert.lengthOf(calls, 0);
		assert.equal(
			await challenge(fetch).verify("t".repeat(2048), EXPECTED),
			"passed",
		);
		assert.lengthOf(calls, 1);
	});

	test("an answer that isn't a verdict, an error status, a timeout or a network error is unavailable", async ({
		assert,
	}) => {
		const logs = captureLogs();
		try {
			const answers: Record<string, (call: Call) => Response | Promise<Response>> = {
				"a 500": () => Response.json({ success: true }, { status: 500 }),
				"a 502 page": () => new Response("<html>", { status: 502 }),
				"not JSON": () => new Response("<html>", { status: 200 }),
				"success as a string": () => Response.json({ success: "true" }),
				"an array": () => Response.json([]),
				"error-codes not a list": () =>
					Response.json({ success: false, "error-codes": "bad" }),
				"a hostname that isn't a string": () => verdict({ hostname: 5 }),
				"no answer in time": hangUntilAborted,
				"a network error": () => Promise.reject(new TypeError("fetch failed")),
			};
			for (const [why, answer] of Object.entries(answers)) {
				const { fetch } = fakeFetch(answer);
				const started = Date.now();
				assert.equal(
					await challenge(fetch).verify(TOKEN, EXPECTED),
					"unavailable",
					why,
				);
				assert.isBelow(Date.now() - started, 1000, why);
			}
			assert.lengthOf(logs.warnings(), Object.keys(answers).length);
		} finally {
			logs.restore();
		}
	});

	test("Cloudflare's own error is unavailable, and a refused secret is logged as an error", async ({
		assert,
	}) => {
		const logs = captureLogs();
		try {
			for (const [codes, outcome] of [
				[["internal-error"], "unavailable"],
				[["invalid-input-secret"], "unavailable"],
				[["missing-input-secret"], "unavailable"],
			] as const) {
				const { fetch } = fakeFetch(() =>
					verdict({ success: false, "error-codes": codes }),
				);
				assert.equal(
					await challenge(fetch).verify(TOKEN, EXPECTED),
					outcome,
					codes.join(),
				);
			}
			assert.deepEqual(logs.errors(), [
				["Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY"],
				["Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY"],
			]);
			assert.lengthOf(logs.warnings(), 1);
		} finally {
			logs.restore();
		}
	});

	test("no log line holds the token, the secret or Cloudflare's body", async ({
		assert,
	}) => {
		const logs = captureLogs();
		const BODY = "cloudflare-body-55";
		try {
			for (const answer of [
				() => new Response(BODY, { status: 500 }),
				() => new Response(BODY, { status: 200 }),
				() => verdict({ success: false, "error-codes": ["internal-error"], messages: [BODY] }),
				() => verdict({ success: false, "error-codes": ["invalid-input-secret"] }),
				() => Promise.reject(new TypeError(`fetch failed ${BODY}`)),
			]) {
				await challenge(fakeFetch(answer).fetch).verify(TOKEN, EXPECTED);
			}
			const logged = JSON.stringify([...logs.warnings(), ...logs.errors()]);
			assert.notInclude(logged, TOKEN);
			assert.notInclude(logged, SECRET);
			assert.notInclude(logged, BODY);
			for (const [, message] of logs.warnings()) {
				assert.equal(message, "Bot challenge check unavailable");
			}
		} finally {
			logs.restore();
		}
	});
});
```

Append to `apps/platform/tests/unit/services/storefront_url.spec.ts` (add `studioHostname` to its import from `#services/storefront_url`):

```ts
test.group("studioHostname", () => {
	test("is the studio page's host, lower case, without port or path", ({
		assert,
	}) => {
		assert.equal(
			studioHostname("https://{tenant}.example.com", "black-needle"),
			"black-needle.example.com",
		);
		assert.equal(
			studioHostname("http://{tenant}.localhost:3000", "intake-guard-55"),
			"intake-guard-55.localhost",
		);
		assert.equal(
			studioHostname(
				"https://{tenant}.Studios.Example.com:8443/ignored",
				"intake-guard-55",
			),
			"intake-guard-55.studios.example.com",
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=bot_challenge.spec.ts --files=storefront_url.spec.ts > <scratchpad>/t55-t4-red.log 2>&1`
Expected: exit 124 and "Cannot find module" for `#services/bot_challenge`.

- [ ] **Step 3: Write `studioHostname`**

In `apps/platform/app/services/storefront_url.ts`, add after `checkStorefrontUrl`:

```ts
/**
 * The host of `slug`'s studio page under `template` (STOREFRONT_URL), lower
 * case, without port: where its intake form's bot-challenge token must have
 * been made (TAT-55).
 */
export function studioHostname(template: string, slug: string): string {
	return originOf(template, slug).hostname;
}
```

- [ ] **Step 4: Write `BotChallenge`**

First confirm the wire against Cloudflare's Turnstile server-side validation page (spec ruling 4): the URL, the `secret` and `response` form fields, and the `success`, `error-codes`, `hostname` and `action` answer fields, and the codes `invalid-input-response`, `timeout-or-duplicate`, `internal-error`, `missing-input-secret`, `invalid-input-secret`. If one differs, use Cloudflare's and change the tests in Step 1 to match. If the page can't be reached, keep these and say so in the PR text.

Create `apps/platform/app/services/bot_challenge.ts`:

```ts
import type { Secret } from "@adonisjs/core/helpers";
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import env from "#start/env";

/** Cloudflare Turnstile's server-side check (TAT-55). */
export const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The request header that carries the token (lower case, as Node gives it). */
export const CHALLENGE_TOKEN_HEADER = "x-challenge-token";

/** Turnstile tokens are at most this long; a longer one fails without a call. */
export const MAX_CHALLENGE_TOKEN_LENGTH = 2048;

/** How long the API waits for Cloudflare: the request holds its pooled connection meanwhile. */
export const CHALLENGE_TIMEOUT_MS = 3000;

/** The widget's `action` for each form that has a challenge. */
export const CHALLENGE_ACTIONS = { inquiry: "inquiry" } as const;

export type ChallengeOutcome = "passed" | "failed" | "unavailable";

/** Where a good token was made: the studio page's host and the form's action. */
export type ChallengeExpectation = { hostname: string; action: string };

export type BotChallengeOptions = {
	/** Unset: the check is off (development and tests; production requires it). */
	secret?: Secret<string>;
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	/**
	 * Also check the token's hostname and action. Default: in production
	 * only, so Cloudflare's test keys work locally.
	 */
	strict?: boolean;
};

/** Codes for a secret Cloudflare refuses: our misconfiguration, not the visitor's. */
const SECRET_REFUSED = new Set(["missing-input-secret", "invalid-input-secret"]);

type Verdict = {
	success: boolean;
	"error-codes"?: string[];
	hostname?: string | null;
	action?: string | null;
};

/**
 * The intake's bot challenge (TAT-55): asks Cloudflare once, within
 * CHALLENGE_TIMEOUT_MS, whether a Turnstile token is good. `failed` is the
 * visitor's (no token, a bad, expired or reused one, made on another page
 * or for another form); `unavailable` is ours or Cloudflare's (no answer in
 * time, an answer that isn't a verdict, Cloudflare's own error, a refused
 * secret), and the API refuses on both. Logs a fixed cause only: never the
 * token, the secret or Cloudflare's body. Tests swap it in the container
 * (tests/helpers/challenge.ts).
 */
export default class BotChallenge {
	readonly #secret: Secret<string> | undefined;
	readonly #fetch: typeof globalThis.fetch;
	readonly #timeoutMs: number;
	readonly #strict: boolean;

	constructor(
		options: BotChallengeOptions = { secret: env.get("TURNSTILE_SECRET_KEY") },
	) {
		this.#secret = options.secret;
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#timeoutMs = options.timeoutMs ?? CHALLENGE_TIMEOUT_MS;
		this.#strict = options.strict ?? app.inProduction;
	}

	async verify(
		token: string | undefined,
		expected: ChallengeExpectation,
	): Promise<ChallengeOutcome> {
		if (!this.#secret) return "passed";
		if (!token?.trim() || token.length > MAX_CHALLENGE_TOKEN_LENGTH) {
			return "failed";
		}

		let response: Response;
		try {
			response = await this.#fetch(SITEVERIFY_URL, {
				method: "POST",
				body: new URLSearchParams({
					secret: this.#secret.release(),
					response: token,
				}),
				signal: AbortSignal.timeout(this.#timeoutMs),
			});
		} catch (error) {
			return unavailable(isTimeout(error) ? "timeout" : "network error");
		}
		if (!response.ok) return unavailable(`status ${response.status}`);

		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			return unavailable(isTimeout(error) ? "timeout" : "not JSON");
		}
		if (!isVerdict(body)) return unavailable("not a verdict");

		if (!body.success) {
			const codes = body["error-codes"] ?? [];
			if (codes.some((code) => SECRET_REFUSED.has(code))) {
				logger.error("Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY");
				return "unavailable";
			}
			if (codes.includes("internal-error")) {
				return unavailable("Cloudflare error");
			}
			return "failed";
		}
		if (
			this.#strict &&
			(body.hostname?.toLowerCase() !== expected.hostname ||
				body.action !== expected.action)
		) {
			return "failed";
		}
		return "passed";
	}
}

function unavailable(cause: string): ChallengeOutcome {
	logger.warn({ cause }, "Bot challenge check unavailable");
	return "unavailable";
}

function isTimeout(error: unknown) {
	return error instanceof DOMException && error.name === "TimeoutError";
}

function isText(value: unknown) {
	return value === undefined || value === null || typeof value === "string";
}

/** Cloudflare's answer, as far as we read it; anything else is no answer. */
function isVerdict(body: unknown): body is Verdict {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return false;
	}
	const fields = body as Record<string, unknown>;
	const codes = fields["error-codes"];
	return (
		typeof fields.success === "boolean" &&
		(codes === undefined ||
			(Array.isArray(codes) &&
				codes.every((code) => typeof code === "string"))) &&
		isText(fields.hostname) &&
		isText(fields.action)
	);
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=bot_challenge.spec.ts --files=storefront_url.spec.ts > <scratchpad>/t55-t4-green.log 2>&1`
Expected: `Tests N passed`, no failures. If "a refused secret" counts one warning too many or too few, read `verify`'s order again: a refused secret logs one error and no warning; `internal-error` logs one warning.

- [ ] **Step 6: Commit**

```bash
git add apps/platform/app/services/bot_challenge.ts apps/platform/app/services/storefront_url.ts apps/platform/tests/unit/services/bot_challenge.spec.ts apps/platform/tests/unit/services/storefront_url.spec.ts
git commit -m "feat(platform): check a Turnstile token with Cloudflare once, failing closed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The intake's three limits

**Files:**
- Create: `apps/platform/app/modules/inquiries/intake_limits.ts`
- Test: `apps/platform/tests/unit/modules/inquiries/intake_limits.spec.ts`

**Interfaces:**
- Consumes: `digest`, `clientAddress` (`#services/rate_limits`), `limiter` (`@adonisjs/limiter/services/main`).
- Produces: `INTAKE_LIMITS`, `type IntakeLimit = "perAddress" | "perTenant" | "perPhone"`, `intakeLimitKeys(tenantId: string, ip: string): { perAddress: string; perTenant: string }`, `intakePhoneKey(tenantId: string, phone: string): string`, `countIntake(limit: IntakeLimit, key: string): Promise<void>` (throws the limiter's `E_TOO_MANY_REQUESTS`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/inquiries/intake_limits.spec.ts`:

```ts
import { mock } from "node:test";
import { errors as limiterErrors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import {
	countIntake,
	INTAKE_LIMITS,
	intakeLimitKeys,
	intakePhoneKey,
} from "#modules/inquiries/intake_limits";
import { clientAddress, digest } from "#services/rate_limits";

const A = "0195f3a0-0000-7000-8000-0000000000a5";
const B = "0195f3a0-0000-7000-8000-0000000000b5";
const IP = "203.0.113.55";
const PHONE = "+9779812345678";

test.group("Intake rate limits", () => {
	test("20 per address and 60 per studio an hour, 10 per phone a day", ({
		assert,
	}) => {
		assert.deepEqual(INTAKE_LIMITS, {
			perAddress: { requests: 20, duration: "1 hour" },
			perTenant: { requests: 60, duration: "1 hour" },
			perPhone: { requests: 10, duration: "24 hours" },
		});
	});

	test("the keys are per studio and hold no address and no phone", ({
		assert,
	}) => {
		const keys = intakeLimitKeys(A, IP);
		const phone = intakePhoneKey(A, PHONE);

		assert.deepEqual(keys, {
			perAddress: `inquiry_ip_${digest(`${A}:${IP}`)}`,
			perTenant: `inquiry_tenant_${A}`,
		});
		assert.equal(phone, `inquiry_phone_${digest(`${A}:${PHONE}`)}`);
		for (const key of [...Object.values(keys), phone]) {
			assert.notInclude(key, IP);
			assert.notInclude(key, PHONE);
			assert.notInclude(key, PHONE.slice(1));
			assert.isAtMost(key.length, 255);
		}
		assert.notEqual(intakeLimitKeys(B, IP).perAddress, keys.perAddress);
		assert.notEqual(intakeLimitKeys(B, IP).perTenant, keys.perTenant);
		assert.notEqual(intakePhoneKey(B, PHONE), phone);
	});

	test("one IPv6 /64 is one address", ({ assert }) => {
		assert.equal(
			intakeLimitKeys(A, "2001:db8:1:2::1").perAddress,
			intakeLimitKeys(A, "2001:db8:1:2:ffff::9").perAddress,
		);
		assert.equal(
			intakeLimitKeys(A, "2001:db8:1:2::1").perAddress,
			`inquiry_ip_${digest(`${A}:${clientAddress("2001:db8:1:2::1")}`)}`,
		);
	});
});

test.group("Intake rate limits: windows", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));
	group.each.teardown(() => mock.timers.reset());

	for (const [limit, seconds] of [
		["perAddress", 3600],
		["perTenant", 3600],
		["perPhone", 86_400],
	] as const) {
		test(`${limit}: the try after ${INTAKE_LIMITS[limit].requests} is refused until its window ends`, async ({
			assert,
		}) => {
			mock.timers.enable({ apis: ["Date"], now: Date.now() });
			const key = `${limit}_window_spec_55`;
			for (let i = 0; i < INTAKE_LIMITS[limit].requests; i++) {
				await countIntake(limit, key);
			}

			await assert.rejects(
				() => countIntake(limit, key),
				limiterErrors.E_TOO_MANY_REQUESTS,
			);
			mock.timers.tick((seconds - 60) * 1000);
			await assert.rejects(
				() => countIntake(limit, key),
				limiterErrors.E_TOO_MANY_REQUESTS,
			);
			mock.timers.tick(61 * 1000);
			await countIntake(limit, key);
		});
	}
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=intake_limits.spec.ts > <scratchpad>/t55-t5-red.log 2>&1`
Expected: exit 124 and "Cannot find module" for `#modules/inquiries/intake_limits`.

- [ ] **Step 3: Write the limits**

Create `apps/platform/app/modules/inquiries/intake_limits.ts`:

```ts
import limiter from "@adonisjs/limiter/services/main";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The intake's rate limits (TAT-55), each per studio, in fixed windows like
 * AUTH_LIMITS. Every attempt that reaches a count counts, later refusals
 * included. The address is counted first, before Cloudflare is asked (20:
 * many customers share one carrier-NAT address); the studio only after a
 * passed challenge, so nobody can close a studio's form without solving
 * challenges (60: above any pilot studio's busiest hour); the phone after
 * validation, as E.164, before IntakeService.submit (10 a day: the 3-open
 * cap already answers a real person's 4th). TAT-38's generic limits come on
 * top.
 */
export const INTAKE_LIMITS = {
	perAddress: { requests: 20, duration: "1 hour" },
	perTenant: { requests: 60, duration: "1 hour" },
	perPhone: { requests: 10, duration: "24 hours" },
} as const;

export type IntakeLimit = keyof typeof INTAKE_LIMITS;

/**
 * The address and studio keys of one request. The address is a digest
 * (HMAC with APP_KEY) together with the tenant id, so `rate_limits` holds no
 * address and one studio's counts never touch another's.
 */
export function intakeLimitKeys(tenantId: string, ip: string) {
	return {
		perAddress: `inquiry_ip_${digest(`${tenantId}:${clientAddress(ip)}`)}`,
		perTenant: `inquiry_tenant_${tenantId}`,
	};
}

/** The key of one E.164 phone in one studio: a digest, no number in it. */
export function intakePhoneKey(tenantId: string, phone: string) {
	return `inquiry_phone_${digest(`${tenantId}:${phone}`)}`;
}

/**
 * Counts one attempt. Over the limit it throws E_TOO_MANY_REQUESTS, which
 * the API answers as 429 `rate_limited` with Retry-After. The count lives on
 * the limiter's own connection, so it survives the request's rollback.
 */
export async function countIntake(
	limit: IntakeLimit,
	key: string,
): Promise<void> {
	// use() parses the durations in the object it gets, so give it a copy.
	await limiter.use({ ...INTAKE_LIMITS[limit] }).consume(key);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=intake_limits.spec.ts > <scratchpad>/t55-t5-green.log 2>&1`
Expected: `Tests 6 passed`. If the `perPhone` window test fails at the last `countIntake`, the limiter did not read `"24 hours"`: check `@adonisjs/limiter`'s duration parsing and use the form it reads (for example `"1 day"`), in both the code and the first test.

- [ ] **Step 5: Commit**

```bash
git add apps/platform/app/modules/inquiries/intake_limits.ts apps/platform/tests/unit/modules/inquiries/intake_limits.spec.ts
git commit -m "feat(platform): add the intake's limits per address, studio and phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The honeypot rule

**Files:**
- Create: `apps/platform/app/modules/inquiries/honeypot.ts`
- Test: `apps/platform/tests/unit/modules/inquiries/honeypot.spec.ts`

**Interfaces:**
- Produces: `HONEYPOT_FIELD = "website"`, `honeypotFilled(value: unknown): boolean` (Task 9 calls it with `request.input(HONEYPOT_FIELD)`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/inquiries/honeypot.spec.ts`:

```ts
import { test } from "@japa/runner";
import { HONEYPOT_FIELD, honeypotFilled } from "#modules/inquiries/honeypot";

test.group("The intake honeypot", () => {
	test("is the website field", ({ assert }) => {
		assert.equal(HONEYPOT_FIELD, "website");
	});

	test("missing, empty or blank is a person's", ({ assert }) => {
		for (const value of [undefined, null, "", "   ", "\t\n", [], ["", " "], [null]]) {
			assert.isFalse(honeypotFilled(value), JSON.stringify(value));
		}
	});

	test("anything else is filled, also in one of several parts", ({ assert }) => {
		for (const value of [
			"x",
			" https://spam.example ",
			["", "https://spam.example"],
			[null, "y"],
			{ nested: "spam" },
		]) {
			assert.isTrue(honeypotFilled(value), JSON.stringify(value));
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=honeypot.spec.ts > <scratchpad>/t55-t6-red.log 2>&1`
Expected: exit 124 and "Cannot find module" for `#modules/inquiries/honeypot`.

- [ ] **Step 3: Write the rule**

Create `apps/platform/app/modules/inquiries/honeypot.ts`:

```ts
/**
 * The intake form's honeypot (TAT-55): a text field people never see (the
 * form hides it off-screen, out of the tab order and from screen readers),
 * so a person leaves it empty and a form-filling bot doesn't.
 */
export const HONEYPOT_FIELD = "website";

/**
 * Whether the honeypot was filled: a string with something besides
 * whitespace, any part of several sent under that name, or any other value
 * (a nested field). Missing, empty or blank is a person's.
 */
export function honeypotFilled(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim() !== "";
	if (Array.isArray(value)) return value.some(honeypotFilled);
	return true;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=honeypot.spec.ts > <scratchpad>/t55-t6-green.log 2>&1`
Expected: `Tests 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/platform/app/modules/inquiries/honeypot.ts apps/platform/tests/unit/modules/inquiries/honeypot.spec.ts
git commit -m "feat(platform): add the intake's honeypot rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CORS lets a browser send `X-Challenge-Token`

**Files:**
- Modify: `apps/platform/config/cors.ts`
- Test: `apps/platform/tests/functional/api/cors.spec.ts`, `apps/platform/tests/functional/api/inquiry_isolation.spec.ts`

**Interfaces:**
- Produces: preflights naming `x-challenge-token` are allowed on every API route; `Access-Control-Allow-Headers: accept,content-type,x-challenge-token`.

- [ ] **Step 1: Write the failing test and update the two pinned values**

In `apps/platform/tests/functional/api/cors.spec.ts`, in test "a JSON write's preflight is allowed for 10 minutes, without credentials", change the expected `"accept,content-type"` to `"accept,content-type,x-challenge-token"`, and add after that test:

```ts
	test("a write's preflight may name the bot-challenge token header (TAT-55)", async ({
		client,
		assert,
	}) => {
		const response = await client
			.options("/api/v1/__test/echo")
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST")
			.header("access-control-request-headers", "content-type,x-challenge-token");

		response.assertStatus(204);
		response.assertHeader("access-control-allow-origin", "*");
		response.assertHeader(
			"access-control-allow-headers",
			"accept,content-type,x-challenge-token",
		);
		assert.isUndefined(response.header("access-control-allow-credentials"));
		assertNoCookies(response);
	});
```

In `apps/platform/tests/functional/api/inquiry_isolation.spec.ts`, test "CORS: a multipart POST from another origin is readable, and its preflight passes": change the preflight's `.header("access-control-request-headers", "content-type")` to `.header("access-control-request-headers", "content-type,x-challenge-token")` and its expected `"accept,content-type"` to `"accept,content-type,x-challenge-token"`.

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C apps/platform test functional --files=cors.spec.ts --files=inquiry_isolation.spec.ts > <scratchpad>/t55-t7-red.log 2>&1`
Expected: the new test and the two changed ones fail (no `access-control-allow-origin` on the preflight naming the header; `accept,content-type` where three are expected).

- [ ] **Step 3: Allow the header**

In `apps/platform/config/cors.ts`, replace:

```ts
	/**
	 * JSON writes preflight for Content-Type. Authorization (the server key,
	 * TAT-38) is server-side only, so browsers may not send it.
	 */
	headers: ["accept", "content-type"],
```

with:

```ts
	/**
	 * JSON writes preflight for Content-Type, and the intake for its
	 * bot-challenge token (TAT-55), which rides in a header so the API checks
	 * it before it reads the upload. Authorization (the server key, TAT-38)
	 * is server-side only, so browsers may not send it.
	 */
	headers: ["accept", "content-type", "x-challenge-token"],
```

and change the `maxAge` comment `/** Only JSON writes preflight; a CORS fix reaches browsers in 10 minutes. */` to `/** JSON writes and the intake preflight; a CORS fix reaches browsers in 10 minutes. */`.

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C apps/platform test functional --files=cors.spec.ts --files=inquiry_isolation.spec.ts > <scratchpad>/t55-t7-green.log 2>&1`
Expected: `Tests N passed`, no failures (the Authorization preflight is still refused).

- [ ] **Step 5: Commit**

```bash
git add apps/platform/config/cors.ts apps/platform/tests/functional/api/cors.spec.ts apps/platform/tests/functional/api/inquiry_isolation.spec.ts
git commit -m "feat(platform): let browsers send X-Challenge-Token to the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `intakeGuard` checks the address, the token and the studio before the body

**Files:**
- Create: `apps/platform/app/middleware/intake_guard_middleware.ts`, `apps/platform/tests/helpers/challenge.ts`
- Modify: `apps/platform/start/kernel.ts`, `apps/platform/start/routes.ts`
- Regenerate: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/api/intake_guard.spec.ts`, `apps/platform/tests/functional/api/api_routes.spec.ts`

**Interfaces:**
- Consumes: `publicTenantContext(ctx)`, `countIntake`, `intakeLimitKeys` (Task 5), `BotChallenge`, `CHALLENGE_ACTIONS`, `CHALLENGE_TOKEN_HEADER` (Task 4), `studioHostname` (Task 4), `storefrontTemplate()` (`#modules/payments/deposit_links`), `ApiException.of("challenge_failed" | "challenge_unavailable")` (Task 2).
- Produces: named middleware `intakeGuard` on `api.v1.inquiries.store`; test helper `#tests/helpers/challenge` with `TEST_SECRET`, `siteverify(answer)`, `verdict(slug, over?)`, `useChallenge(fake, options?)` (Task 9 uses it).

- [ ] **Step 1: Write the test helper**

Create `apps/platform/tests/helpers/challenge.ts`:

```ts
import { Secret } from "@adonisjs/core/helpers";
import app from "@adonisjs/core/services/app";
import BotChallenge, { CHALLENGE_ACTIONS } from "#services/bot_challenge";

/** The secret the swapped verifier sends to the fake siteverify. */
export const TEST_SECRET = "test-turnstile-secret-55";

export type SiteverifyCall = { form: URLSearchParams };
export type Siteverify = {
	calls: SiteverifyCall[];
	fetch: typeof globalThis.fetch;
};

/**
 * A fake Cloudflare siteverify: records each call's form and answers with
 * `answer` (which gets the call's abort signal, to hang until a timeout).
 */
export function siteverify(
	answer: (
		form: URLSearchParams,
		signal: AbortSignal,
	) => Response | Promise<Response>,
): Siteverify {
	const calls: SiteverifyCall[] = [];
	const fetch = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
		const form = new URLSearchParams(String(init.body));
		calls.push({ form });
		return answer(form, init.signal as AbortSignal);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

/**
 * Cloudflare's verdict for a good token made on `slug`'s studio page
 * (`<slug>.localhost`, from .env.test's STOREFRONT_URL), with changes.
 */
export function verdict(slug: string, over: Record<string, unknown> = {}) {
	return Response.json({
		success: true,
		"error-codes": [],
		challenge_ts: new Date().toISOString(),
		hostname: `${slug}.localhost`,
		action: CHALLENGE_ACTIONS.inquiry,
		...over,
	});
}

/**
 * Turns the intake's bot challenge on for the test's requests: the real
 * verifier with TEST_SECRET, `fake` for Cloudflare, and the host and action
 * checked as in production. Undo it in teardown with
 * `app.container.restore(BotChallenge)`.
 */
export function useChallenge(
	fake: Siteverify,
	options: { timeoutMs?: number } = {},
) {
	app.container.swap(
		BotChallenge,
		() =>
			new BotChallenge({
				secret: new Secret(TEST_SECRET),
				fetch: fake.fetch,
				strict: true,
				...options,
			}),
	);
}
```

- [ ] **Step 2: Write the failing tests**

In `apps/platform/tests/functional/api/api_routes.spec.ts`, change `const PUBLIC_ONLY = ["publicApi", "publicTenant", "publicCache"];` to `const PUBLIC_ONLY = ["publicApi", "publicTenant", "publicCache", "intakeGuard"];`, and add in `test.group("Public API routes", ...)`:

```ts
	test("the intake checks its challenge and limits after resolving the tenant (TAT-55)", ({
		assert,
	}) => {
		const intake = allRoutes().find(
			({ pattern, methods }) =>
				pattern === "/api/v1/tenants/:tenant/inquiries" &&
				methods.includes("POST"),
		);

		assert.exists(intake);
		assert.include(intake?.named ?? [], "intakeGuard");
		assert.isAbove(
			intake?.named.indexOf("intakeGuard") ?? -1,
			intake?.named.indexOf("publicTenant") ?? -1,
		);
	});
```

Create `apps/platform/tests/functional/api/intake_guard.spec.ts`:

```ts
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { INTAKE_LIMITS } from "#modules/inquiries/intake_limits";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import BotChallenge from "#services/bot_challenge";
import { API_ERRORS } from "#services/public_api_errors";
import { assertApiError } from "#tests/helpers/api";
import {
	siteverify,
	TEST_SECRET,
	useChallenge,
	verdict,
} from "#tests/helpers/challenge";
import {
	intakeFields,
	intakeRows,
	png,
	postInquiry,
	type Upload,
} from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const SLUG = "intake-guard-55";
const OTHER = "intake-guard-b-55";
const IP = "203.0.113.55";
const TOKEN = "good-token-55";

type Send = {
	token?: string;
	ip?: string;
	fields?: Record<string, string>;
	uploads?: Upload[];
};

/** An intake from `ip`, with the token header when `token` is given. */
function send(
	client: ApiClient,
	slug: string,
	{ token, ip = IP, fields = intakeFields(), uploads = [] }: Send = {},
) {
	const request = postInquiry(client, slug, fields, uploads).header(
		"x-forwarded-for",
		ip,
	);
	return token === undefined
		? request
		: request.header("x-challenge-token", token);
}

/** A JSON write with a token: it passes the guard, so it counts, and stops at the controller's 415. */
function jsonTry(client: ApiClient, slug: string, ip: string) {
	return client
		.post(`/api/v1/tenants/${slug}/inquiries`)
		.header("x-forwarded-for", ip)
		.header("x-challenge-token", TOKEN)
		.json({ idea: "A peony" });
}

test.group("Public API: the intake's bot challenge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test("a good token made on the studio's page is taken; Cloudflare saw the secret and the token", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		useChallenge(fake);

		const response = await send(client, SLUG, {
			token: TOKEN,
			uploads: [await png()],
		});

		response.assertStatus(201);
		assert.lengthOf(fake.calls, 1);
		assert.equal(fake.calls[0].form.get("secret"), TEST_SECRET);
		assert.equal(fake.calls[0].form.get("response"), TOKEN);
		assert.lengthOf((await intakeRows({ tenant })).inquiries, 1);
	});

	test("no token is 403 challenge_failed before the body is read: no Cloudflare call, no temp file, nothing stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		useChallenge(fake);
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const response = await send(client, SLUG, { uploads: [await png()] });

		assertApiError(response, 403, "challenge_failed");
		assert.equal(
			response.body().error.message,
			API_ERRORS.challenge_failed.message,
		);
		assert.lengthOf(fake.calls, 0);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("a token only in a challengeToken form field doesn't count", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		useChallenge(fake);

		const response = await send(client, SLUG, {
			fields: { ...intakeFields(), challengeToken: TOKEN },
		});

		assertApiError(response, 403, "challenge_failed");
		assert.lengthOf(fake.calls, 0);
	});

	test("every refusal by Cloudflare, another studio's page or another form is the same 403, and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const rows = await intakeRows({ tenant });
		const answers: Record<string, () => Response> = {
			invalid: () =>
				verdict(SLUG, {
					success: false,
					"error-codes": ["invalid-input-response"],
				}),
			"expired or used twice": () =>
				verdict(SLUG, {
					success: false,
					"error-codes": ["timeout-or-duplicate"],
				}),
			"another studio's page": () => verdict(OTHER),
			"another form": () => verdict(SLUG, { action: "signup" }),
		};

		for (const [why, answer] of Object.entries(answers)) {
			useChallenge(siteverify(answer));
			const response = await send(client, SLUG, {
				token: TOKEN,
				uploads: [await png()],
			});
			assertApiError(response, 403, "challenge_failed");
			assert.equal(
				response.body().error.message,
				API_ERRORS.challenge_failed.message,
				why,
			);
		}
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("when Cloudflare can't answer it is 503 challenge_unavailable, and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const rows = await intakeRows({ tenant });
		const answers: Record<
			string,
			(form: URLSearchParams, signal: AbortSignal) => Response | Promise<Response>
		> = {
			"a 500": () => new Response("oops", { status: 500 }),
			"not JSON": () => new Response("<html>", { status: 200 }),
			"Cloudflare's own error": () =>
				verdict(SLUG, { success: false, "error-codes": ["internal-error"] }),
			"no answer in time": (_form, signal) =>
				new Promise((_, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
			"a network error": () => Promise.reject(new TypeError("fetch failed")),
		};

		for (const [why, answer] of Object.entries(answers)) {
			useChallenge(siteverify(answer), { timeoutMs: 50 });
			const response = await send(client, SLUG, { token: TOKEN });
			assertApiError(response, 503, "challenge_unavailable");
			assert.equal(
				response.body().error.message,
				API_ERRORS.challenge_unavailable.message,
				why,
			);
		}
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("an old or unknown slug is TAT-32's 404 first: no Cloudflare call, nothing counted", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "intake-new-55"),
		);
		const fake = siteverify(() => verdict("intake-new-55"));
		useChallenge(fake);

		for (let i = 0; i < INTAKE_LIMITS.perAddress.requests; i++) {
			assertApiError(
				await send(client, SLUG, { token: TOKEN }),
				404,
				"not_found",
			);
		}
		assertApiError(
			await send(client, "no-such-studio-td55", { token: TOKEN }),
			404,
			"not_found",
		);

		assert.lengthOf(fake.calls, 0);
		// The address has no count yet: the current slug still takes it.
		(await send(client, "intake-new-55", { token: TOKEN })).assertStatus(201);
	});
});

test.group("Public API: the intake's address and studio limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test(`the try after ${INTAKE_LIMITS.perAddress.requests} from one address in an hour is 429 with Retry-After, refused tries included, before Cloudflare is asked`, async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		useChallenge(fake);
		for (let i = 0; i < INTAKE_LIMITS.perAddress.requests; i++) {
			assertApiError(await send(client, SLUG), 403, "challenge_failed");
		}
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const refused = await send(client, SLUG, {
			token: TOKEN,
			uploads: [await png()],
		});

		assertApiError(refused, 429, "rate_limited");
		assert.match(refused.header("retry-after") ?? "", /^\d+$/);
		assert.lengthOf(fake.calls, 0);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
		// Another address is still heard.
		(
			await send(client, SLUG, { token: TOKEN, ip: "198.51.100.55" })
		).assertStatus(201);
	});

	test("one address's count at one studio leaves another studio alone", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);
		await studioWithOwner(OTHER);
		useChallenge(siteverify(() => verdict(SLUG)));
		for (let i = 0; i < INTAKE_LIMITS.perAddress.requests; i++) {
			assertApiError(await send(client, SLUG), 403, "challenge_failed");
		}
		assertApiError(
			await send(client, SLUG, { token: TOKEN }),
			429,
			"rate_limited",
		);

		useChallenge(siteverify(() => verdict(OTHER)));
		(await send(client, OTHER, { token: TOKEN })).assertStatus(201);
	});

	test(`the try after ${INTAKE_LIMITS.perTenant.requests} passed challenges at one studio in an hour is 429; failed ones don't count`, async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await studioWithOwner(OTHER);
		useChallenge(siteverify(() => verdict(SLUG)));
		for (let i = 0; i < 5; i++) {
			assertApiError(
				await send(client, SLUG, { ip: `192.0.2.${i}` }),
				403,
				"challenge_failed",
			);
		}
		for (let i = 0; i < INTAKE_LIMITS.perTenant.requests; i++) {
			assertApiError(
				await jsonTry(client, SLUG, `198.51.100.${i}`),
				415,
				"unsupported_media_type",
			);
		}
		const rows = await intakeRows({ tenant });

		const refused = await send(client, SLUG, {
			token: TOKEN,
			ip: "203.0.113.200",
		});

		assertApiError(refused, 429, "rate_limited");
		assert.match(refused.header("retry-after") ?? "", /^\d+$/);
		assert.deepEqual(await intakeRows({ tenant }), rows);
		useChallenge(siteverify(() => verdict(OTHER)));
		(
			await send(client, OTHER, { token: TOKEN, ip: "203.0.113.200" })
		).assertStatus(201);
	});
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=intake_guard.spec.ts --files=api_routes.spec.ts > <scratchpad>/t55-t8-red.log 2>&1`
Expected: every intake_guard test fails (201 where 403, 503 or 429 is expected, no Cloudflare call where one is expected) and the new route test fails (no `intakeGuard`); the other route tests pass.

- [ ] **Step 4: Write the middleware**

Create `apps/platform/app/middleware/intake_guard_middleware.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { countIntake, intakeLimitKeys } from "#modules/inquiries/intake_limits";
import { storefrontTemplate } from "#modules/payments/deposit_links";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BotChallenge, {
	CHALLENGE_ACTIONS,
	CHALLENGE_TOKEN_HEADER,
} from "#services/bot_challenge";
import { ApiException } from "#services/public_api_errors";
import { studioHostname } from "#services/storefront_url";

/**
 * The intake's checks before its body is read (TAT-55), on
 * api.v1.inquiries.store after publicTenant: an unknown or old slug was
 * already the 404, so nothing here counts it or asks Cloudflare. Counts the
 * client address at this studio (429), asks Cloudflare about the
 * X-Challenge-Token header's token (403 challenge_failed, 503
 * challenge_unavailable; no call for a missing one), then counts the studio,
 * only for a passed challenge (429). The route reads its body itself
 * (multipart.processManually), so a refusal here writes nothing to disk.
 * The honeypot and the phone count need the body: the controller does them.
 */
@inject()
export default class IntakeGuardMiddleware {
	constructor(private challenge: BotChallenge) {}

	async handle(ctx: HttpContext, next: NextFn) {
		const { tenant } = publicTenantContext(ctx);
		const keys = intakeLimitKeys(tenant.id, ctx.request.ip());
		await countIntake("perAddress", keys.perAddress);

		const outcome = await this.challenge.verify(
			ctx.request.header(CHALLENGE_TOKEN_HEADER),
			{
				hostname: studioHostname(storefrontTemplate(), tenant.slug),
				action: CHALLENGE_ACTIONS.inquiry,
			},
		);
		if (outcome === "failed") throw ApiException.of("challenge_failed");
		if (outcome === "unavailable") {
			throw ApiException.of("challenge_unavailable");
		}

		await countIntake("perTenant", keys.perTenant);
		return next();
	}
}
```

In `apps/platform/start/kernel.ts`, add to `router.named({ ... })` after `depositThrottle`:

```ts
	intakeGuard: () => import("#middleware/intake_guard_middleware"),
```

In `apps/platform/start/routes.ts`, replace:

```ts
				// TAT-55 adds its bot-challenge and honeypot middleware here
				// (.use(...), after publicTenant). POST stays no-store.
				router
					.post("/inquiries", [controllers.PublicInquiries, "store"])
					.as("api.v1.inquiries.store");
```

with:

```ts
				// The intake (TAT-51). intakeGuard counts the address, checks the
				// bot challenge and counts the studio before the body is read
				// (TAT-55); the controller does the honeypot and the phone count.
				// POST stays no-store.
				router
					.post("/inquiries", [controllers.PublicInquiries, "store"])
					.use(middleware.intakeGuard())
					.as("api.v1.inquiries.store");
```

- [ ] **Step 5: Regenerate**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen` then `git status --short apps/platform/.adonisjs`
Expected: codegen succeeds; note whatever it changed (possibly nothing) and keep it with this commit.

- [ ] **Step 6: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=intake_guard.spec.ts --files=api_routes.spec.ts > <scratchpad>/t55-t8-green.log 2>&1`
Expected: `Tests N passed`, no failures.

- [ ] **Step 7: The intake's other suites still pass (the check is off in them)**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=inquiries.spec.ts --files=inquiry_refusals.spec.ts --files=inquiry_isolation.spec.ts --files=public_api.spec.ts --files=cors.spec.ts > <scratchpad>/t55-t8-intake.log 2>&1`
Expected: `Tests N passed`, no failures. A 429 here means a test sends more than 20 intakes from one address or 60 to one studio: give its requests distinct `x-forwarded-for` values, never raise the limits.

- [ ] **Step 8: Commit**

```bash
git add apps/platform/app/middleware/intake_guard_middleware.ts apps/platform/start/kernel.ts apps/platform/start/routes.ts apps/platform/tests/helpers/challenge.ts apps/platform/tests/functional/api/intake_guard.spec.ts apps/platform/tests/functional/api/api_routes.spec.ts apps/platform/.adonisjs
git commit -m "feat(platform): check the intake's challenge and limits before reading its body

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The controller refuses a filled honeypot and counts the phone

**Files:**
- Modify: `apps/platform/app/controllers/public_inquiries_controller.ts`, `apps/platform/app/modules/inquiries/validators/intake.ts`
- Test: `apps/platform/tests/unit/modules/inquiries/intake_validator.spec.ts`, `apps/platform/tests/functional/api/intake_honeypot_and_phone.spec.ts`

**Interfaces:**
- Consumes: `HONEYPOT_FIELD`, `honeypotFilled` (Task 6), `countIntake`, `intakePhoneKey`, `INTAKE_LIMITS` (Task 5), `ApiException.of("challenge_failed")` (Task 2), `siteverify`, `useChallenge`, `verdict` (Task 8).
- Produces: `intakeValidator` without `challengeToken`; the controller order `415 → receiveUploads → honeypot → validation → phone count → submit`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/unit/modules/inquiries/intake_validator.spec.ts`, replace the test "a challenge token is taken up to 2048 characters" (the whole `test(...)` block) with:

```ts
	test("a challengeToken field is dropped: the token travels in a header (TAT-55)", async ({
		assert,
	}) => {
		const submission = await intakeValidator.validate(
			body({ challengeToken: "t".repeat(5000) }),
		);

		assert.notProperty(submission, "challengeToken");
	});
```

Create `apps/platform/tests/functional/api/intake_honeypot_and_phone.spec.ts`:

```ts
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { INTAKE_LIMITS } from "#modules/inquiries/intake_limits";
import BotChallenge from "#services/bot_challenge";
import { API_ERRORS } from "#services/public_api_errors";
import { assertApiError } from "#tests/helpers/api";
import { siteverify, useChallenge, verdict } from "#tests/helpers/challenge";
import {
	intakeFields,
	intakeRows,
	png,
	postInquiry,
} from "#tests/helpers/intake";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const SLUG = "intake-trap-55";
const OTHER = "intake-trap-b-55";
const TOKEN = "good-token-55";

/** A moment for a write stream that is still closing when the response is out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * A studio whose only visible artist is closed: an intake without an artist
 * is a cheap 409 studio_not_accepting, decided after the phone count.
 */
async function closedStudio(slug: string) {
	const { tenant } = await studioWithOwner(slug);
	await inTenant(tenant, () =>
		Artist.create({
			tenantId: tenant.id,
			name: "Sita",
			slug: "sita",
			acceptingInquiries: false,
		}),
	);
	return tenant;
}

test.group("Public API: the intake's honeypot", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test("a filled honeypot is 403 challenge_failed after the body: no field named, temp files removed, nothing stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		useChallenge(siteverify(() => verdict(SLUG)));
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ website: "https://spam.example" }),
			[await png()],
		).header("x-challenge-token", TOKEN);
		await settle();

		assertApiError(response, 403, "challenge_failed");
		assert.equal(
			response.body().error.message,
			API_ERRORS.challenge_failed.message,
		);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("an empty or blank honeypot is a person's", async ({ client }) => {
		await studioWithOwner(SLUG);
		useChallenge(siteverify(() => verdict(SLUG)));

		for (const website of ["", "   "]) {
			(
				await postInquiry(client, SLUG, intakeFields({ website })).header(
					"x-challenge-token",
					TOKEN,
				)
			).assertStatus(201);
		}
	});

	test("a honeypot sent twice is filled when either part is", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, intakeFields()).field(
			"website",
			["", "https://spam.example"],
		);

		assertApiError(response, 403, "challenge_failed");
	});

	test("with the challenge off the honeypot still refuses, and a challengeToken field is dropped", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);

		assertApiError(
			await postInquiry(client, SLUG, intakeFields({ website: "spam" })),
			403,
			"challenge_failed",
		);
		(
			await postInquiry(
				client,
				SLUG,
				intakeFields({ challengeToken: "t".repeat(3000) }),
			)
		).assertStatus(201);
	});
});

test.group("Public API: the intake's phone limit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test(`the try after ${INTAKE_LIMITS.perPhone.requests} with one phone at one studio in a day is 429, refusals included, however the number is typed`, async ({
		client,
		assert,
	}) => {
		const tenant = await closedStudio(SLUG);
		for (let i = 0; i < INTAKE_LIMITS.perPhone.requests; i++) {
			const contactPhone = i % 2 === 0 ? "9812345678" : "+977 981-234-5678";
			assertApiError(
				await postInquiry(client, SLUG, intakeFields({ contactPhone })),
				409,
				"studio_not_accepting",
			);
		}
		const rows = await intakeRows({ tenant });

		const refused = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
		]);

		assertApiError(refused, 429, "rate_limited");
		assert.isAbove(Number(refused.header("retry-after")), 3600);
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
		// Another number at the same studio is still heard.
		assertApiError(
			await postInquiry(
				client,
				SLUG,
				intakeFields({ contactPhone: "9812345679" }),
			),
			409,
			"studio_not_accepting",
		);
	});

	test("one phone's count at one studio leaves another studio alone", async ({
		client,
	}) => {
		await closedStudio(SLUG);
		await studioWithOwner(OTHER);
		for (let i = 0; i < INTAKE_LIMITS.perPhone.requests; i++) {
			assertApiError(
				await postInquiry(client, SLUG, intakeFields()),
				409,
				"studio_not_accepting",
			);
		}
		assertApiError(
			await postInquiry(client, SLUG, intakeFields()),
			429,
			"rate_limited",
		);

		(await postInquiry(client, OTHER, intakeFields())).assertStatus(201);
	});

	test("the 3-open cap is unchanged: with the challenge on, a full phone is 409 too_many_open_inquiries", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await inTenant(tenant, async () => {
			const maya = await makeClient(tenant, { phone: "+9779812345678" });
			for (let i = 0; i < 3; i++) await makeInquiry(tenant, maya);
		});
		useChallenge(siteverify(() => verdict(SLUG)));

		assertApiError(
			await postInquiry(client, SLUG, intakeFields()).header(
				"x-challenge-token",
				TOKEN,
			),
			409,
			"too_many_open_inquiries",
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=intake_validator.spec.ts > <scratchpad>/t55-t9-red-unit.log 2>&1
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=intake_honeypot_and_phone.spec.ts > <scratchpad>/t55-t9-red.log 2>&1
```

Expected: the validator test fails (a 5000-character `challengeToken` is a validation error); the honeypot tests that expect 403 get 201, the phone tests that expect 429 get 409, and the 3000-character `challengeToken` intake is a 422; the cap test passes already.

- [ ] **Step 3: Drop the field from the validator**

In `apps/platform/app/modules/inquiries/validators/intake.ts`, delete the line `challengeToken: vine.string().maxLength(2048).optional(),` and, in the comment above `intakeValidator`, replace

```ts
 * (size, extension): ImageService checks what they really are. The
 * bot-challenge token is taken and ignored until TAT-55; any other field is
 * dropped.
```

with:

```ts
 * (size, extension): ImageService checks what they really are. Any other
 * field is dropped, `challengeToken` included: the bot-challenge token
 * travels in the X-Challenge-Token header (TAT-55).
```

- [ ] **Step 4: Add the honeypot and the phone count to the controller**

In `apps/platform/app/controllers/public_inquiries_controller.ts`, add the imports:

```ts
import { HONEYPOT_FIELD, honeypotFilled } from "#modules/inquiries/honeypot";
import { countIntake, intakePhoneKey } from "#modules/inquiries/intake_limits";
```

and replace, inside `store`'s `try`:

```ts
			await receiveUploads(request);
			const submission = await request.validateUsing(intakeValidator, {
```

with:

```ts
			await receiveUploads(request);
			// A filled honeypot is refused like a failed challenge (TAT-55),
			// before validation, so no field error names the trap.
			if (honeypotFilled(request.input(HONEYPOT_FIELD))) {
				throw ApiException.of("challenge_failed");
			}
			const submission = await request.validateUsing(intakeValidator, {
```

and replace:

```ts
			// TAT-55: the per-phone rate limit goes here (it needs the E.164
			// phone), before anything is stored.
			const inquiry = await this.intake.submit(tenant, submission);
```

with:

```ts
			// Every validated try counts against its E.164 phone at this studio
			// (TAT-55), whatever submit answers; the 3-open cap is submit's.
			await countIntake(
				"perPhone",
				intakePhoneKey(tenant.id, submission.contactPhone),
			);
			const inquiry = await this.intake.submit(tenant, submission);
```

Update the class comment: replace

```ts
 * request with the fields and up to 5 reference images. The answer is only
 * the new inquiry's id, whether or not the phone was known.
```

with:

```ts
 * request with the fields and up to 5 reference images. The answer is only
 * the new inquiry's id, whether or not the phone was known. The intakeGuard
 * middleware already counted the address, checked the bot challenge and
 * counted the studio (TAT-55); here come the honeypot, after the body, and
 * the phone count, after validation.
```

- [ ] **Step 5: Run them to see them pass**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=intake_validator.spec.ts > <scratchpad>/t55-t9-green-unit.log 2>&1
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=intake_honeypot_and_phone.spec.ts --files=intake_guard.spec.ts --files=inquiries.spec.ts --files=inquiry_refusals.spec.ts --files=inquiry_isolation.spec.ts --files=public_api.spec.ts > <scratchpad>/t55-t9-green.log 2>&1
```

Expected: `Tests N passed`, no failures, in both logs. If the "sent twice" test gets a 201, read how the parser stores a repeated field (`request.input("website")`) and keep `honeypotFilled` covering that shape; never drop the test.

- [ ] **Step 6: Typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck`
Expected: clean. (`IntakeSubmission` no longer has `challengeToken`; nothing reads it.)

- [ ] **Step 7: Commit**

```bash
git add apps/platform/app/controllers/public_inquiries_controller.ts apps/platform/app/modules/inquiries/validators/intake.ts apps/platform/tests/unit/modules/inquiries/intake_validator.spec.ts apps/platform/tests/functional/api/intake_honeypot_and_phone.spec.ts
git commit -m "feat(platform): refuse a filled honeypot and count the intake's phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/database/README.md`, `README.md`, `docs/sdk.md`, `docs/architecture.md`

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`:

(a) In the "CORS and caching" bullet, replace `the \`Accept\` and \`Content-Type\` request headers` with ``the `Accept`, `Content-Type` and `X-Challenge-Token` request headers``.

(b) Add a bullet to the Public API section, after the "A new endpoint." bullet:

```markdown
- **Bot challenge (TAT-55).** `BotChallenge` (`#services/bot_challenge`) asks Cloudflare Turnstile's siteverify whether the token in the `X-Challenge-Token` header is good: one form-encoded POST with the secret and the token, at most `CHALLENGE_TIMEOUT_MS` (3 s), no retry. `passed` needs `success: true`, and in production also the studio page's host (`studioHostname(storefrontTemplate(), slug)`, `#services/storefront_url`) and the form's action (`CHALLENGE_ACTIONS.inquiry`); a missing, blank or over-2048-character token fails without a call. `failed` is 403 `challenge_failed`; no answer in time, an answer that isn't a verdict, Cloudflare's `internal-error` or a refused secret is `unavailable`, 503 `challenge_unavailable` (it fails closed: the widget needs Cloudflare too). It logs a fixed cause, never the token, the secret or Cloudflare's body. `TURNSTILE_SECRET_KEY` (a `Secret`, checked at boot by `checkChallengeSecret` in `#services/challenge_secret`) is required in production; unset elsewhere the check is off. The `intakeGuard` middleware runs it on `api.v1.inquiries.store`, after `publicTenant`, between the address and the studio counts. Another form that needs a challenge gets its own entry in `CHALLENGE_ACTIONS` and the same middleware shape.
```

(c) In the "Clients, inquiries and projects" Intake bullet, replace `; \`challengeToken\` is taken and ignored until TAT-55)` with ``; a `challengeToken` field is dropped: the token travels in a header)``, and replace the sentence `TAT-55's per-phone limit goes in the controller where its comment says; its challenge and honeypot are route middleware on \`api.v1.inquiries.store\`.` with:

```markdown
Abuse protection (TAT-55): before the body is read, the `intakeGuard` route middleware counts the address, checks the bot challenge and counts the studio; after `receiveUploads` the controller refuses a filled honeypot (`website`; `honeypotFilled` in `#modules/inquiries/honeypot`) as `challenge_failed` before validation, and counts the E.164 phone after it ([rate limits](#rate-limits)).
```

(d) Add a bullet at the end of the "Rate limits" section:

```markdown
- The intake (TAT-55) counts per studio, in `INTAKE_LIMITS` (`#modules/inquiries/intake_limits`) with `countIntake`: 20 tries per client address and 60 passed challenges per studio an hour (the `intakeGuard` middleware, before the body is read; the address first, so a refused address never reaches Cloudflare, and the studio only after a passed challenge, so no one can close a studio's form without solving challenges), and 10 validated tries per phone a day (the controller, before `IntakeService.submit`). Keys come from `intakeLimitKeys(tenantId, ip)` and `intakePhoneKey(tenantId, phone)`: digests of the tenant id with `clientAddress(ip)` or the E.164 phone, and the tenant id for the studio, so one studio's counts never touch another's and the table holds no address or number. Every attempt that reaches a count counts, later refusals included. The 3-open cap (`OPEN_INQUIRY_LIMIT`) is separate and checked in `submit` under the lock. An unknown or old slug is the 404 before any count; TAT-38's generic limits come on top.
```

- [ ] **Step 2: Testing guide**

In `apps/platform/docs/testing.md`, append to the paragraph that starts "Rate limits (TAT-8) use the memory store under test":

```markdown
The intake's bot challenge is off in tests: `.env.test` sets `TURNSTILE_SECRET_KEY` empty, so a developer's `.env` never turns it on. A test turns it on with `useChallenge(siteverify(answer))` from `#tests/helpers/challenge` (the real `BotChallenge` with `TEST_SECRET`, a fake `fetch` and the host and action checks) and undoes it in teardown with `app.container.restore(BotChallenge)`; `verdict(slug, over?)` is Cloudflare's answer for a good token made on that studio's page (`<slug>.localhost`, from `.env.test`'s `STOREFRONT_URL`). The intake's limits (20 per address and 60 per studio an hour, 10 per phone a day) apply in every test: a test that sends more than 20 intakes to one studio gives them different `x-forwarded-for` values.
```

- [ ] **Step 3: Production checklist**

In `apps/platform/database/README.md`, "Production checklist":

(a) Add after the `STOREFRONT_URL` bullet:

```markdown
  - Set `TURNSTILE_SECRET_KEY` (required: with `NODE_ENV=production` the platform, the worker and every `ace` command refuse to start without it): the secret key of the studio pages' Cloudflare Turnstile widget, whose public site key goes to the storefront (TAT-57). Register the studio pages' domain under the widget's hostnames in Cloudflare (check there whether its subdomains are covered), and allow outbound HTTPS from the web process to `challenges.cloudflare.com`: when Cloudflare can't be reached in 3 s, every inquiry is refused with `challenge_unavailable` (the check fails closed, TAT-55).
```

(b) In the bullet that starts "Uploads hold a pooled database connection and an open transaction", replace `(the intake reads its body after \`publicTenant\` opens the transaction)` with ``(the intake reads its body after `publicTenant` opens the transaction, and checks its bot challenge first, for up to 3 s)``.

(c) In the `trustProxy` bullet, replace `blocks every deposit upload on the platform for an hour (TAT-65).` with ``blocks every deposit upload on the platform for an hour (TAT-65), and the intake's 20 tries an hour per address (TAT-55) are shared by every customer of a studio.``

- [ ] **Step 4: Root README**

In `README.md`, "Deployment", add after the "Deposit links" bullet:

```markdown
- **Bot challenge:** the intake form uses Cloudflare Turnstile (TAT-55). In the Cloudflare dashboard (a free account is enough), add a Turnstile widget for the studio pages' domain in Managed mode; its site key is public and goes to the storefront (TAT-57), its secret key to the platform as `TURNSTILE_SECRET_KEY`, which production requires (the platform, its worker and every `ace` command refuse to start without it). Leave it unset in development: the check is off. The platform must reach `challenges.cloudflare.com` over HTTPS; when it can't, inquiries are refused with `challenge_unavailable`.
```

- [ ] **Step 5: SDK guide and architecture**

In `docs/sdk.md`:

(a) After the paragraph that starts "The deposit page reads `client.deposits.get(token)`", add:

```markdown
The intake form sends `client.inquiries.create(input)` (React: `useCreateInquiry()`) straight from the browser. `challengeToken` is the token of the studio page's Cloudflare Turnstile widget, rendered with action `INQUIRY_CHALLENGE_ACTION` (`inquiry`); the SDK sends it as the `X-Challenge-Token` header, which the API checks before it reads the upload (so the request preflights). A token is single-use: reset the widget after every answer, success or error. `honeypot` is the value of a hidden text input named `INQUIRY_HONEYPOT_FIELD` (`website`) that people never fill; the SDK sends it only when it isn't empty. `challenge_failed` (403: a bad, expired or reused token, or a filled honeypot) means get a new token and try again; `challenge_unavailable` (503) means the API couldn't check it; `rate_limited` (429) carries `retryAfter` in seconds (limits per address, studio and phone; up to a day for one phone number). Nothing retries by itself.
```

(b) In the example, replace the line `    challengeToken,                                     // TAT-55; ignored until then` with:

```ts
    challengeToken,                                     // the Turnstile widget's token; sent as X-Challenge-Token
    honeypot: websiteInput.value,                       // the hidden "website" input; empty for people
```

(c) In "Envelopes and codes", replace `` `createInquiry` adds `artist_not_accepting`, `studio_not_accepting` and `too_many_open_inquiries` (409); `` with `` `createInquiry` adds `artist_not_accepting`, `studio_not_accepting` and `too_many_open_inquiries` (409), `challenge_failed` (403) and `challenge_unavailable` (503); ``.

In `docs/architecture.md`, "Intake (customer → API)": replace step 2's first sentence `The browser sends the inquiry, reference images and bot-challenge token **directly to the API** as one multipart request.` with `The browser sends the inquiry and reference images **directly to the API** as one multipart request, with the bot-challenge token in a header.`, and replace step 3's first sentence `The API checks the challenge and limits and processes the images.` with `Before it reads the body, the API counts the address, checks the challenge and counts the studio; then it refuses a filled honeypot, validates, counts the phone and processes the images.`

- [ ] **Step 6: Requirements and anchors**

Run: `rg -n "Abuse protection on the intake form" docs/requirements.md` and `rg -n "backend.md#|testing.md#|sdk.md#|requirements.md#" docs apps/platform/docs README.md packages/AGENTS.md`
Expected: the abuse line is a rule (no checkbox), already true: leave it; the intake-form box stays open for TAT-57. Every anchor printed names a heading that still exists (no heading was added, renamed or removed, so `docs/README.md` needs no change).

- [ ] **Step 7: Commit**

```bash
git add apps/platform/docs/backend.md apps/platform/docs/testing.md apps/platform/database/README.md README.md docs/sdk.md docs/architecture.md
git commit -m "docs(platform): document the intake's bot challenge, honeypot and limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verification

- [ ] **Step 1: Generated files are current**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen
git status --short
```

Expected: no changes.

- [ ] **Step 2: The full platform suite**

Run in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C apps/platform test > <scratchpad>/t55-full.log 2>&1`
Expected: `Tests N passed` with N above the Task 0 baseline and no failures.

- [ ] **Step 3: Package tests and the root gates**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build
```

Expected: `# fail 0` in both package runs (SDK +3, React +1 over the baseline); check, typecheck and build pass. If the storefront is in the base, also `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test` with `# fail 0` (it uses the SDK, which changed).

- [ ] **Step 4: Nothing outside the plan, nothing leaks**

```bash
git diff --stat <base>..HEAD -- apps/platform/database/migrations apps/platform/database/schema.ts apps/storefront
rg -n "logger\.(warn|error|info|debug)" apps/platform/app/services/bot_challenge.ts apps/platform/app/middleware/intake_guard_middleware.ts apps/platform/app/controllers/public_inquiries_controller.ts
rg -n "release\(\)" apps/platform/app/services/bot_challenge.ts
```

Expected: the diff prints nothing (no migration, no storefront change); the logger calls are exactly `logger.error("Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY")` and `logger.warn({ cause }, "Bot challenge check unavailable")` in `bot_challenge.ts`; `release()` appears once, inside the `URLSearchParams` sent to Cloudflare.

- [ ] **Step 5: PR text (not committed)**

Write `<scratchpad>/pr3-tat-55.md`: a few what-and-why bullets per change (mentor mode: token in a header, fail closed, honeypot refused not faked, the three limits and why those numbers, the `challengeToken` field removed), the spec's rulings in one line each, deviations from this plan, the test counts, the new setting (`TURNSTILE_SECRET_KEY`: required in production; how to get the keys from the Cloudflare dashboard; the site key is TAT-57's), "Before any public deploy" from the spec, the carry-forwards to post (TAT-57, TAT-38, TAT-13, TAT-79), and a manual check for the user: start the dev server with `PORT=3401` (the check is off without a secret): `curl -si -F idea=x -F placement=x -F approximateSize=x -F preferredDates=x -F sourceChannel=instagram -F contactName=x -F contactPhone=9812345678 http://localhost:3401/api/v1/tenants/<slug>/inquiries` is a 201; with `-F website=spam` it is a 403 `challenge_failed`; a preflight `curl -si -X OPTIONS -H 'Origin: https://x.example' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: x-challenge-token' http://localhost:3401/api/v1/tenants/<slug>/inquiries` answers `Access-Control-Allow-Headers: accept,content-type,x-challenge-token`. Then the whole-branch review and the Codex code and security reviews (the coordinator runs them).
