# Inquiry intake: POST /inquiries with references, client matched by phone (TAT-51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/v1/tenants/:tenant/inquiries` takes one multipart request (the inquiry's text fields and up to 5 reference images), matches the studio's client by phone or creates one, stores the images privately, saves a `new` inquiry and queues the staff alert job, all or nothing; the contract, SDK and React hook move from the booking draft to `createInquiry`.

**Architecture:** TAT-32's public tenant group resolves the studio and opens the request transaction; `PublicInquiriesController.store` refuses non-multipart bodies, validates with `intakeValidator` and calls `IntakeService.submit`, which runs the artist rules, `ClientService.matchByPhone` (row lock or unique index), the open-inquiry cap, `ImageService.store` per image (each with `afterRollback` cleanup), the inserts and `dispatchInTransaction(NewInquiryAlertJob…)`. `discardUploads` deletes every leftover temp upload, in the exception handler (failures) and the controller's `finally` (successes). Decoding goes through a 2-slot `limitConcurrency`.

**Tech Stack:** AdonisJS 7 (bodyparser 11.0.4 on `@poppinss/multiparty` 3.0.0), Lucid on PostgreSQL 18 with RLS, VineJS 4.4, `@adonisjs/queue` 0.6.2 (database driver), sharp, Japa; `openapi-typescript`; the SDK on `fetch`, tested with `node:test` and `tsx`; TanStack Query 5.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-51-inquiry-intake-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- `<repo>` is the checkout you build in (the coordinator names it; this branch's worktree is `/home/blank/Coding/tattoo-drip-worktrees/tat-51`). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls, so every command uses `-C <repo>` or absolute paths.
- **TAT-32 first.** This branch must contain TAT-32's final, reviewed tip before Task 1 (the coordinator rebases it). Tasks marked **(needs TAT-32)** use its code: `publicTenantContext`, `ApiException`, `API_ERRORS`, the exception handler's API branch, the `/api/v1/tenants/:tenant` route group, `#tests/helpers/api`, the public isolation harness, and the SDK's `request()`/`RequestOptions`/tests. Tasks 3 to 8 don't. The names below are those of TAT-32 at 332dafd; if its review renamed one, use the real name and note the deviation.
- **No migration.** `apps/platform/database/` must not change.
- Fixture slugs in new tests end in `-51` (`intake-needle-51`, …): the tests share the dev database, where a slug someone once used stays taken. "Unknown" slugs are ones no studio has (`no-such-studio-td51`).
- Wire format (ruling 2): `multipart/form-data`; text fields `idea`, `placement`, `approximateSize`, `preferredDates`, `preferredArtistId`, `budget`, `sourceChannel`, `contactName`, `contactPhone`, `contactEmail`, `challengeToken`; each image one `referenceImages` part. Anything else is 415 `unsupported_media_type`.
- Limits (ruling 3): idea 4000, placement 120, approximateSize 120, preferredDates 500, budget 120, contactName 120, contactPhone 40 (as typed; stored E.164), contactEmail 254, challengeToken 2048; at most 5 images (`MAX_REFERENCE_IMAGES`), 10 MB each, jpg/jpeg/png/webp; 20 MB of files and 2 MB of text per request (413). `OPEN_INQUIRY_LIMIT` = 3. `MAX_CONCURRENT_DECODES` = 2. SDK upload timeout 120 000 ms.
- Intake codes, statuses and messages, verbatim (one table: `API_ERRORS`): `artist_not_accepting` 409 "This artist isn't taking new requests right now. Choose another artist, or none."; `studio_not_accepting` 409 "This studio isn't taking new requests right now."; `too_many_open_inquiries` 409 "You already have requests waiting with this studio. They will reply on WhatsApp or Viber."
- Field messages, verbatim: required and blank "This field is required."; too long "Use at most {{ max }} characters." (VineJS fills in `max`); NUL "Remove the unsupported characters."; channel "Choose how you found the studio."; artist "Choose an artist from the list, or none." (`ARTIST_MESSAGE`); email "Enter a valid email address, or leave it empty."; phone `PHONE_MESSAGE` from `#validators/phone`; image count "Attach up to 5 images."; image size "Use images of 10 MB or less."; image type `IMAGE_FORMAT_MESSAGE` from `#modules/media/errors` ("Upload a JPEG, PNG or WebP image.").
- The response to a 201 is exactly `{ data: { id } }`. Never echo submitted data, the client, or image URLs.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- Contract first: edit `packages/types/openapi.yaml`, then `pnpm -C <repo> --filter @tattoo-drip/types generate`. Never hand-edit `openapi.gen.ts`, `database/schema.ts` or `.adonisjs/`. After route or controller changes run `pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- Tests: `PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module hangs Japa, so RED steps run as `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background). SDK tests: `pnpm -C <repo> --filter @tattoo-drip/sdk test`. `pnpm typecheck` is the authority over editor diagnostics. The pre-commit hook runs Biome and may rewrite staged files: re-read a file before editing it again.
- Commits: Conventional Commits with the area scope (`types`, `sdk`, `react`, `platform`), ending with your session's attribution line (e.g. `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Never push, never open a PR.

## Review Focus

1. **A phone typed another way is the same person.** "981-234-5678", "+977 981 234 5678" and "009779812345678" must find the client stored as "+9779812345678" and count toward the same cap. Tests: Task 6 "phone forms become E.164", Task 9 "a phone typed nationally is the returning client's".
2. **A blank optional input means none.** Browsers send `contactEmail=""` and `preferredArtistId=""` for untouched inputs; that must be a 201 with nulls, not a field error. Test: Task 9 "empty optional fields mean none".
3. **An upload refused before the controller leaves no temp file.** Over 20 MB (the body parser fails), an unknown slug and an old slug (`publicTenant` fails) never reach the controller's `finally`. Tests: Task 9 "an unknown studio's 404 leaves no temp upload", Task 10 "over 20 MB in all is 413", Task 11 "an old slug is a 404".
4. **One image part is a list of one.** The body parser gives a single `referenceImages` part as a file, not an array; `request.files()` must make it one reference. Test: Task 9 "takes an inquiry" (one image).
5. **JSON is a clear 415, not seven field errors.** A developer posting `application/json` must learn the encoding is wrong. Test: Task 9 "a JSON body is 415".

---

## Before Task 1: preconditions

- [ ] **Branch and base.** `git -C <repo> status -sb` shows `harublank00/tat-51-post-inquiries-intake-with-references-client-matched-by` and a clean tree. `git -C <repo> merge-base --is-ancestor 332dafd HEAD; echo $?` prints `0`, and so does the same check with the current tip of `harublank00/tat-32-api-foundation-apiv1-tenant-by-path-error-envelope-cors` (`git -C <repo> rev-parse harublank00/tat-32-api-foundation-apiv1-tenant-by-path-error-envelope-cors`), so TAT-32's review fixes are in. If not, stop and report.
- [ ] **TAT-32 names this plan uses.** Each prints a match (else find the real name, use it, and note the deviation):
  - `rg -n 'export class ApiException|static notFound|export const API_ERRORS|export type ApiErrorCode' <repo>/apps/platform/app/services/public_api_errors.ts`
  - `rg -n 'export function publicTenantContext' <repo>/apps/platform/app/middleware/public_tenant_middleware.ts`
  - `rg -n 'if \(isApiRequest\(ctx\)\) return renderApiError' <repo>/apps/platform/app/exceptions/handler.ts`
  - `rg -n 'as\("api.v1.studio"\)' <repo>/apps/platform/start/routes.ts`
  - `rg -n 'export function (assertApiData|assertApiError|assertApiHeaders|assertNoCookies)' <repo>/apps/platform/tests/helpers/api.ts`
  - `rg -n 'export type PublicIsolationCase|if \(body\) request.json\(body\)' <repo>/apps/platform/tests/isolation/public_cases.ts <repo>/apps/platform/tests/helpers/public_isolation.ts`
  - `rg -n 'export interface RequestOptions|bookings: \{|\{ signal \}: RequestOptions = \{\}' <repo>/packages/sdk/src/client.ts`
  - `rg -n '"test":' <repo>/packages/sdk/package.json`
- [ ] **Install and migrate.** `pnpm -C <repo> install`, then `pnpm -C <repo>/apps/platform migrate` (applies TAT-24's and TAT-32's migrations if they aren't yet; this ticket adds none).
- [ ] **Baseline.** `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=public_tenant.spec.ts --files=api_routes.spec.ts --files=public_api.spec.ts --files=client_service.spec.ts --files=artist_service.spec.ts` passes, and `pnpm -C <repo> --filter @tattoo-drip/sdk test` passes.

---

### Task 1 (needs TAT-32): Contract, types, SDK and React

**Files:**
- Modify: `packages/types/openapi.yaml`, `packages/types/src/index.ts`
- Regenerate: `packages/types/src/openapi.gen.ts`
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`, `packages/react/src/hooks.ts`, `packages/react/src/index.ts`
- Test: `packages/sdk/test/client.test.ts` (append)

**Interfaces:**
- Consumes: TAT-32's `request<T>(url, init, call)`, `RequestOptions`, `TattooApiError`, the test helpers `fakeFetch`, `json`, `client`, `hangUntilAborted`, `rejection` in `client.test.ts`.
- Produces: types `SourceChannel`, `InquiryInput`, `InquiryReceipt` from `@tattoo-drip/types` (no more `BookingRequestInput`/`BookingReceipt`); SDK `CreateInquiryInput`, `client.inquiries.create(input: CreateInquiryInput, call?: RequestOptions): Promise<InquiryReceipt>`, `RequestOptions.timeoutMs?: number` (no more `bookings`/`CreateBookingInput`); React `useCreateInquiry()` (no more `useCreateBooking`).

- [ ] **Step 1: Write the failing SDK tests**

Append to `packages/sdk/test/client.test.ts`, and add `type CreateInquiryInput` to its import from `"../src/index.js"`:

```ts
describe("inquiries.create", () => {
	const ID = "0195f3a0-0000-7000-8000-000000000051";
	const input = {
		idea: "Fine-line peony",
		placement: "Left forearm",
		approximateSize: "About 10 cm",
		preferredDates: "Any weekday in November",
		sourceChannel: "instagram",
		contactName: "Ana",
		contactPhone: "9812345678",
	} satisfies CreateInquiryInput;

	test("posts one multipart form to the tenant's inquiries, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: ID } }));
		const front = new File([new Uint8Array([0xff, 0xd8, 0xff])], "front.jpg", {
			type: "image/jpeg",
		});
		const side = new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" });

		const receipt = await client(fetch).inquiries.create({
			...input,
			preferredArtistId: "0195f3a0-0000-7000-8000-0000000000aa",
			budget: undefined,
			contactEmail: null,
			referenceImages: [front, side],
			challengeToken: "token-51",
		});

		assert.deepEqual(receipt, { id: ID });
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32/inquiries",
		);
		assert.equal(calls[0].init.method, "POST");
		assert.equal(calls[0].init.credentials, "omit");
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.get("accept"), "application/json");
		assert.equal(headers.has("content-type"), false, "fetch sets the multipart boundary");
		const form = calls[0].init.body as FormData;
		assert.deepEqual([...new Set(form.keys())].sort(), [
			"approximateSize",
			"challengeToken",
			"contactName",
			"contactPhone",
			"idea",
			"placement",
			"preferredArtistId",
			"preferredDates",
			"referenceImages",
			"sourceChannel",
		]);
		assert.equal(form.get("contactPhone"), "9812345678");
		assert.equal(form.get("challengeToken"), "token-51");
		const images = form.getAll("referenceImages") as File[];
		assert.deepEqual(
			images.map(({ name, type }) => [name, type]),
			[
				["front.jpg", "image/jpeg"],
				["blob", "image/png"],
			],
		);
	});

	test("without images or a token it sends only the fields", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: ID } }));

		await client(fetch).inquiries.create(input);

		const form = calls[0].init.body as FormData;
		assert.equal(form.has("referenceImages"), false);
		assert.equal(form.has("challengeToken"), false);
		assert.equal(form.get("idea"), "Fine-line peony");
	});

	test("a refusal is a TattooApiError with its code, and fields on validation_failed", async () => {
		const full = fakeFetch(() =>
			json(409, {
				error: {
					code: "too_many_open_inquiries",
					message:
						"You already have requests waiting with this studio. They will reply on WhatsApp or Viber.",
				},
			}),
		);
		const invalid = fakeFetch(() =>
			json(422, {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: { contactPhone: ["Enter a phone number, like 9812345678 or +977 1 4123456."] },
				},
			}),
		);

		const capped = await rejection(client(full.fetch).inquiries.create(input));
		const refused = await rejection(client(invalid.fetch).inquiries.create(input));

		assert.ok(capped instanceof TattooApiError);
		assert.equal(capped.status, 409);
		assert.equal(capped.code, "too_many_open_inquiries");
		assert.ok(refused instanceof TattooApiError);
		assert.deepEqual(Object.keys(refused.fields), ["contactPhone"]);
	});

	test("an upload waits longer than the client's timeout", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(
			() =>
				new Promise<Response>((resolve) =>
					setTimeout(() => resolve(json(201, { data: { id: ID } })), 60),
				),
		);

		const receipt = await client(fetch, { timeoutMs: 20 }).inquiries.create(input);

		assert.deepEqual(receipt, { id: ID });
	});

	test("a per-call timeoutMs still gives up", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);

		const error = await rejection(
			client(fetch).inquiries.create(input, { timeoutMs: 20 }),
		);

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "timeout");
	});

	test("a submission the caller cancels rejects with the AbortError", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();

		const call = client(fetch).inquiries.create(input, { signal: controller.signal });
		controller.abort();
		const error = await rejection(call);

		assert.ok(!(error instanceof TattooApiError));
		assert.equal((error as Error).name, "AbortError");
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: FAIL: every `inquiries.create` test (`Cannot read properties of undefined (reading 'create')`); TAT-32's tests still pass.

- [ ] **Step 3: The contract**

In `packages/types/openapi.yaml`:

(a) After the `security:` block (before `paths:`), insert:

```yaml
tags:
  - name: MVP
    description: What the pilot's studio page uses.
  - name: V1
    description: Planned for the paid launch (docs/requirements.md, V1). Not implemented; the shapes may still change.

```

(b) Under each `operationId:` line, at the same indentation, add one `tags:` line: `tags: [V1]` for `listStyles`, `listPlacements`, `listServices`, `listPortfolio` and `listAvailability`; `tags: [MVP]` for `getStudio`, `listArtists` and `getArtist`.

(c) Replace the whole `/tenants/{tenant}/bookings:` path item (from `  /tenants/{tenant}/bookings:` down to, not including, `components:`) with:

```yaml
  /tenants/{tenant}/inquiries:
    parameters:
      - $ref: "#/components/parameters/Tenant"
    post:
      operationId: createInquiry
      tags: [MVP]
      summary: Send the studio an inquiry, with reference images
      description: |
        No account needed. One `multipart/form-data` request with the fields
        and up to 5 reference images (JPEG, PNG or WebP, 10 MB each and
        20 MB for the whole request); any other body is a 415. The studio
        finds the person by phone; the answer is the same whether or not it
        knew the number, and says nothing but the new inquiry's id. Never
        cached. Under an old slug it is a 404: send it to the current slug,
        which `getStudio` names.

        Own codes (409): `artist_not_accepting` (the chosen artist takes no
        new inquiries), `studio_not_accepting` (no artist chosen, and every
        artist of the studio is closed), `too_many_open_inquiries` (this
        phone number already has 3 inquiries the studio hasn't answered).
        An unknown or hidden `preferredArtistId` is `validation_failed` on
        `preferredArtistId`; an image that isn't a JPEG, PNG or WebP is
        `validation_failed` on `referenceImages.<index>`.
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema: { $ref: "#/components/schemas/InquiryForm" }
            encoding:
              referenceImages:
                contentType: image/jpeg, image/png, image/webp
      responses:
        "201":
          description: Received. The studio replies on WhatsApp or Viber.
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { $ref: "#/components/schemas/InquiryReceipt" }
        "400": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409":
          description: The studio takes no such inquiry now (`artist_not_accepting`, `studio_not_accepting`, `too_many_open_inquiries`)
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "413": { $ref: "#/components/responses/Error" }
        "415": { $ref: "#/components/responses/Error" }
        "422": { $ref: "#/components/responses/ValidationError" }
        "429": { $ref: "#/components/responses/RateLimited" }
        default: { $ref: "#/components/responses/Error" }

```

(d) In `ErrorResponse`, replace the `code` property's `description` and `examples` with:

```yaml
              description: |
                Stable and machine-readable. Shared codes: `bad_request` (400,
                an unreadable body), `not_found` (404), `method_not_allowed`
                (405), `payload_too_large` (413), `unsupported_media_type`
                (415), `validation_failed` (422, with `fields`),
                `rate_limited` (429, with `Retry-After`), `internal_error`
                (500). Endpoint codes: `artist_not_accepting`,
                `studio_not_accepting`, `too_many_open_inquiries` (409,
                `createInquiry`). Treat an unknown code by its HTTP status.
              examples: [not_found, validation_failed, rate_limited, too_many_open_inquiries]
```

and in its `fields` description replace `` `client.phone` `` with `` `contactPhone` ``.

(e) Replace the `BookingRequestInput:` and `BookingReceipt:` schemas (from `    BookingRequestInput:` to the end of the file) with:

```yaml
    SourceChannel:
      type: string
      description: How the person found the studio
      enum: [instagram, facebook, tiktok, google, friend, other]

    InquiryInput:
      type: object
      description: |
        An inquiry's text fields, kept exactly as sent (trimmed). The
        lengths are the most the API takes. Leave an optional field out, or
        empty, for none.
      required: [idea, placement, approximateSize, preferredDates, sourceChannel, contactName, contactPhone]
      properties:
        idea: { type: string, minLength: 1, maxLength: 4000, examples: [A fine-line peony with two leaves] }
        placement: { type: string, minLength: 1, maxLength: 120, examples: [Left forearm] }
        approximateSize: { type: string, minLength: 1, maxLength: 120, examples: [About 10 cm] }
        preferredDates: { type: string, minLength: 1, maxLength: 500, examples: [Any weekday in November] }
        preferredArtistId:
          type: [string, "null"]
          format: uuid
          description: A visible artist of this studio who takes inquiries. Leave it out for any artist.
        budget: { type: [string, "null"], maxLength: 120, description: Free text, examples: [NPR 15000] }
        sourceChannel: { $ref: "#/components/schemas/SourceChannel" }
        contactName: { type: string, minLength: 1, maxLength: 120 }
        contactPhone:
          type: string
          minLength: 1
          maxLength: 40
          description: The person's WhatsApp or Viber number, as typed. A number without a country code is read as Nepali; it is stored in E.164.
          examples: ["9812345678", "+977 981-234-5678"]
        contactEmail: { type: [string, "null"], format: email, maxLength: 254 }

    InquiryForm:
      description: The multipart body of `createInquiry`
      allOf:
        - $ref: "#/components/schemas/InquiryInput"
        - type: object
          properties:
            referenceImages:
              type: array
              maxItems: 5
              description: Up to 5 JPEG, PNG or WebP images, 10 MB each and 20 MB together, each its own `referenceImages` part. Their metadata (EXIF, GPS) is removed, and only the studio sees them.
              items: { type: string, format: binary }
            challengeToken:
              type: string
              maxLength: 2048
              description: Bot-challenge token. The intake form will need it (TAT-55); the API ignores it until then.

    InquiryReceipt:
      type: object
      required: [id]
      additionalProperties: false
      properties:
        id: { type: string, format: uuid, description: The new inquiry. Nothing in the public API reads it back. }
```

- [ ] **Step 4: Regenerate and export the types**

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate`
Expected: `openapi.gen.ts` changes (`createInquiry`, the new schemas, no booking types).

In `packages/types/src/index.ts`, replace the two lines

```ts
export type BookingRequestInput = Schemas["BookingRequestInput"];
export type BookingReceipt = Schemas["BookingReceipt"];
```

with

```ts
export type SourceChannel = Schemas["SourceChannel"];
export type InquiryInput = Schemas["InquiryInput"];
export type InquiryReceipt = Schemas["InquiryReceipt"];
```

Run: `pnpm -C <repo> --filter @tattoo-drip/types typecheck`
Expected: no errors.

- [ ] **Step 5: The SDK**

In `packages/sdk/src/client.ts`:

- In the type import from `@tattoo-drip/types`, replace `BookingReceipt,` and `BookingRequestInput,` with `InquiryInput,` and `InquiryReceipt,`.
- After `const DEFAULT_TIMEOUT_MS = 10_000;` add:

```ts
/** Uploads on a slow mobile connection need longer than a read (TAT-51). */
const UPLOAD_TIMEOUT_MS = 120_000;
```

- Replace the `RequestOptions` interface and the `CreateBookingInput` interface with:

```ts
/** Options for one call. */
export interface RequestOptions {
	/** Cancels the call; it then rejects with the signal's reason (an `AbortError`). */
	signal?: AbortSignal;
	/**
	 * Milliseconds before this call gives up with `timeout`, instead of the
	 * client's `timeoutMs` (or the 2 minutes an upload gets).
	 */
	timeoutMs?: number;
}

/** An inquiry and its reference images, sent as one multipart request. */
export interface CreateInquiryInput extends InquiryInput {
	/** Up to 5 JPEG, PNG or WebP images, 10 MB each and 20 MB together. */
	referenceImages?: Blob[];
	/** Bot-challenge token (TAT-55); the API ignores it until then. */
	challengeToken?: string;
}
```

- In `request()`, replace the parameter `{ signal }: RequestOptions = {},` with `call: RequestOptions = {},`, add `const { signal } = call;` as the first line of the body, and replace `const timeout = AbortSignal.timeout(timeoutMs);` with `const timeout = AbortSignal.timeout(call.timeoutMs ?? timeoutMs);`.
- Replace the whole `bookings: { … },` entry with:

```ts
		inquiries: {
			/**
			 * Sends an inquiry with its reference images as one multipart
			 * request and returns the new inquiry's id. Waits up to 2 minutes
			 * (an upload) unless `call.timeoutMs` says otherwise. Fails with a
			 * TattooApiError such as `validation_failed` (with `fields` by
			 * input name), `artist_not_accepting`, `studio_not_accepting`,
			 * `too_many_open_inquiries` or `payload_too_large`.
			 */
			create: async (input: CreateInquiryInput, call: RequestOptions = {}) => {
				const { referenceImages = [], challengeToken, ...fields } = input;
				const form = new FormData();
				for (const [name, value] of Object.entries(fields)) {
					if (value !== undefined && value !== null) form.set(name, String(value));
				}
				for (const image of referenceImages) {
					form.append("referenceImages", image);
				}
				if (challengeToken) form.set("challengeToken", challengeToken);

				const body = await request<{ data: InquiryReceipt }>(
					`${tenantRoot}/inquiries`,
					// No Content-Type: fetch sets multipart's boundary itself.
					{ method: "POST", body: form },
					{ ...call, timeoutMs: call.timeoutMs ?? UPLOAD_TIMEOUT_MS },
				);
				return body.data;
			},
		},
```

In `packages/sdk/src/index.ts`, replace `type CreateBookingInput,` with `type CreateInquiryInput,`.

- [ ] **Step 6: Run the SDK tests and typecheck**

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: PASS (TAT-32's 11 tests plus these 6).

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk typecheck`
Expected: no errors.

- [ ] **Step 7: React**

In `packages/react/src/hooks.ts`, replace `CreateBookingInput,` in the type import with `CreateInquiryInput,`, and replace the `useCreateBooking` function and its comment with:

```ts
/**
 * Sends an inquiry with its reference images (`client.inquiries.create`).
 * Never retried: a retry after a timeout could send it twice. Nothing
 * cached changes, so nothing is invalidated.
 */
export function useCreateInquiry() {
	const client = useTattooClient();
	return useMutation({
		mutationFn: (input: CreateInquiryInput) => client.inquiries.create(input),
	});
}
```

In `packages/react/src/index.ts`, replace `useCreateBooking,` with `useCreateInquiry,`.

Run: `pnpm -C <repo> --filter @tattoo-drip/types typecheck && pnpm -C <repo> --filter @tattoo-drip/sdk typecheck && pnpm -C <repo> --filter @tattoo-drip/react typecheck`
Expected: no errors. `rg -n 'Booking|bookings' <repo>/packages --glob '!*.gen.ts'` prints nothing.

- [ ] **Step 8: Commit, one per package**

```bash
git -C <repo> add packages/types
git -C <repo> commit -m "feat(types): describe createInquiry and tag the V1 operations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git -C <repo> add packages/sdk
git -C <repo> commit -m "feat(sdk): send inquiries with reference images

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git -C <repo> add packages/react
git -C <repo> commit -m "feat(react): add useCreateInquiry in place of useCreateBooking

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2 (needs TAT-32): The intake codes in the public API's one list

**Files:**
- Modify: `apps/platform/app/services/public_api_errors.ts`
- Test: `apps/platform/tests/unit/services/public_api_errors.spec.ts` (append)

**Interfaces:**
- Consumes: TAT-32's `ApiErrorCode`, `API_ERRORS`, `ApiException`, `apiErrorFor`.
- Produces: `ApiErrorCode` gains `"artist_not_accepting" | "studio_not_accepting" | "too_many_open_inquiries"`; `API_ERRORS` entries for them; `ApiException.of(code: ApiErrorCode, fields?: Record<string, string[]>): ApiException`.

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/unit/services/public_api_errors.spec.ts`:

```ts
test.group("ApiException.of", () => {
	test("an endpoint's code comes with its status and its one message", ({ assert }) => {
		const cases = [
			[
				"artist_not_accepting",
				"This artist isn't taking new requests right now. Choose another artist, or none.",
			],
			["studio_not_accepting", "This studio isn't taking new requests right now."],
			[
				"too_many_open_inquiries",
				"You already have requests waiting with this studio. They will reply on WhatsApp or Viber.",
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

	test("a shared code works the same, with fields", ({ assert }) => {
		const error = ApiException.of("validation_failed", {
			preferredArtistId: ["Choose an artist from the list, or none."],
		});

		assert.deepEqual(apiErrorFor(error), {
			status: 422,
			body: {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: { preferredArtistId: ["Choose an artist from the list, or none."] },
				},
			},
			headers: {},
		});
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=public_api_errors.spec.ts`
Expected: FAIL: `ApiException.of is not a function` (TAT-32's tests pass).

- [ ] **Step 3: Add the codes and `of`**

In `apps/platform/app/services/public_api_errors.ts`:

- Replace the `ApiErrorCode` comment and type with:

```ts
/**
 * Every code the public API answers with (openapi.yaml, ErrorResponse): the
 * shared ones, then each endpoint's own.
 */
export type ApiErrorCode =
	| "bad_request"
	| "not_found"
	| "method_not_allowed"
	| "payload_too_large"
	| "unsupported_media_type"
	| "validation_failed"
	| "rate_limited"
	| "internal_error"
	// createInquiry (TAT-51)
	| "artist_not_accepting"
	| "studio_not_accepting"
	| "too_many_open_inquiries";
```

- Change the `API_ERRORS` comment to `/** Each code with its status and its one message for people. */` and add, after `internal_error`:

```ts
	artist_not_accepting: {
		status: 409,
		code: "artist_not_accepting",
		message:
			"This artist isn't taking new requests right now. Choose another artist, or none.",
	},
	studio_not_accepting: {
		status: 409,
		code: "studio_not_accepting",
		message: "This studio isn't taking new requests right now.",
	},
	too_many_open_inquiries: {
		status: 409,
		code: "too_many_open_inquiries",
		message:
			"You already have requests waiting with this studio. They will reply on WhatsApp or Viber.",
	},
```

- In `class ApiException`, after `static notFound()`, add:

```ts
	/** The error for one of the codes in API_ERRORS, with its status and message. */
	static of(code: ApiErrorCode, fields?: Record<string, string[]>) {
		const { status, message } = API_ERRORS[code];
		return new ApiException(status, code, message, fields);
	}
```

`CODE_BY_STATUS` stays as it is: no framework error maps to an endpoint's code.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=public_api_errors.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/services/public_api_errors.ts apps/platform/tests/unit/services/public_api_errors.spec.ts
git -C <repo> commit -m "feat(platform): add the intake's codes to the public API's error list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Decode at most two images at once

**Files:**
- Create: `apps/platform/app/modules/media/concurrency.ts`
- Modify: `apps/platform/app/modules/media/services/image_processor.ts`
- Test: `apps/platform/tests/unit/modules/media/concurrency.spec.ts` (create), `apps/platform/tests/unit/modules/media/image_processor.spec.ts` (append)

**Interfaces:**
- Produces: `limitConcurrency(max: number): <T>(task: () => Promise<T>) => Promise<T>` from `#modules/media/concurrency`; `MAX_CONCURRENT_DECODES = 2` from `#modules/media/services/image_processor`. `processImage(input)` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/media/concurrency.spec.ts`:

```ts
import { test } from "@japa/runner";
import { limitConcurrency } from "#modules/media/concurrency";

/** A task body that runs until `finish()` is called. */
function gate() {
	let finish = () => {};
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	return { done, finish: () => finish() };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test.group("limitConcurrency", () => {
	test("runs at most `max` tasks at once, the rest in arrival order", async ({ assert }) => {
		const run = limitConcurrency(2);
		const gates = [gate(), gate(), gate(), gate()];
		const started: number[] = [];
		let active = 0;
		let peak = 0;

		const results = gates.map((g, index) =>
			run(async () => {
				started.push(index);
				active += 1;
				peak = Math.max(peak, active);
				await g.done;
				active -= 1;
				return index;
			}),
		);
		await settle();
		assert.deepEqual(started, [0, 1]);

		gates[1].finish();
		await settle();
		assert.deepEqual(started, [0, 1, 2]);

		for (const g of gates) g.finish();
		assert.deepEqual(await Promise.all(results), [0, 1, 2, 3]);
		assert.deepEqual(started, [0, 1, 2, 3]);
		assert.equal(peak, 2);
	});

	test("a failing task frees its slot, and its caller gets the error", async ({ assert }) => {
		const run = limitConcurrency(1);

		const first = run(async () => {
			throw new Error("broken image");
		});
		const second = run(async () => "next");

		await assert.rejects(() => first, "broken image");
		assert.equal(await second, "next");
	});

	test("refuses a limit below 1", ({ assert }) => {
		assert.throws(() => limitConcurrency(0), /positive integer/);
	});
});
```

Append to `apps/platform/tests/unit/modules/media/image_processor.spec.ts` (inside the existing `test.group("processImage", …)` callback):

```ts
	test("keeps no decoded images in sharp's cache", ({ assert }) => {
		const { files, items, memory } = sharp.cache();

		assert.deepEqual([files.max, items.max, memory.max], [0, 0, 0]);
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=concurrency.spec.ts --files=image_processor.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/media/concurrency` in the log.

- [ ] **Step 3: Write the limiter and use it**

Create `apps/platform/app/modules/media/concurrency.ts`:

```ts
/**
 * Runs at most `max` tasks at once; the others wait their turn, first come
 * first served. A task that fails frees its slot like one that succeeds.
 * In-process only: each server process has its own slots.
 */
export function limitConcurrency(max: number) {
	if (!Number.isInteger(max) || max < 1) {
		throw new Error(`limitConcurrency needs a positive integer, got ${max}`);
	}
	let running = 0;
	const waiting: (() => void)[] = [];

	function release() {
		const next = waiting.shift();
		// Hand the slot straight to the next task, or give it back.
		if (next) next();
		else running -= 1;
	}

	return async function run<T>(task: () => Promise<T>): Promise<T> {
		if (running < max) running += 1;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await task();
		} finally {
			release();
		}
	};
}
```

In `apps/platform/app/modules/media/services/image_processor.ts`:

- Add `import { limitConcurrency } from "#modules/media/concurrency";` to the imports.
- After `export const MAX_DIMENSION = 2048;` add:

```ts
/**
 * Images decoded at once in this process. Each can hold about 160 MB (40 MP
 * at 4 bytes a pixel), and anyone can upload references (TAT-51), so the
 * rest wait their turn.
 */
export const MAX_CONCURRENT_DECODES = 2;

const decodeSlot = limitConcurrency(MAX_CONCURRENT_DECODES);

// Keep no decoded image between calls: an upload's memory goes back as soon
// as it is processed.
sharp.cache(false);
```

- Replace the `processImage` function (keep its doc comment, adding a last line "At most MAX_CONCURRENT_DECODES run at once; the format check comes before the wait.") with:

```ts
export async function processImage(input: Buffer): Promise<ProcessedImage> {
	const detected = sniff(input);
	if (!detected) throw new InvalidImageError(IMAGE_FORMAT_MESSAGE);
	return decodeSlot(() => decode(input, detected));
}

/** processImage's work once the format is known and a slot is free. */
async function decode(
	input: Buffer,
	detected: "jpeg" | "png" | "webp",
): Promise<ProcessedImage> {
	if ((await pixelCount(input)) > MAX_INPUT_PIXELS) {
		throw new InvalidImageError(IMAGE_SIZE_MESSAGE);
	}
```

followed by the old body's `try { … } catch (error) { … }` block unchanged, and a closing `}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=concurrency.spec.ts --files=image_processor.spec.ts`
Expected: PASS (the existing processImage tests too). If sharp's `cache()` reports the limits under other names, print `sharp.cache()` once in the test and assert the fields `cache(false)` zeroes.

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=image_service.spec.ts --files=artist_photo.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/media apps/platform/tests/unit/modules/media
git -C <repo> commit -m "feat(platform): decode at most two uploaded images at once

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Delete leftover temp uploads

**Files:**
- Create: `apps/platform/app/services/uploads.ts`, `apps/platform/tests/helpers/uploads.ts`
- Modify: `apps/platform/config/bodyparser.ts`, `apps/platform/tests/bootstrap.ts`
- Test: `apps/platform/tests/unit/services/uploads.spec.ts` (create)

**Interfaces:**
- Consumes: `uploadOf(bytes)` from `#tests/helpers/images`.
- Produces: `discardUploads(request: HttpContext["request"]): Promise<void>` from `#services/uploads`; from `#tests/helpers/uploads`: `tempUploads(): Promise<Set<string>>`, `newTempUploads(before: Set<string>): Promise<string[]>`, `storedReferenceImages(tenant: { id: string }): Promise<string[]>`. In tests the body parser writes uploads to `tmp/storage/uploads/<uuid>`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/services/uploads.spec.ts`:

```ts
import { existsSync } from "node:fs";
import { MultipartFile } from "@adonisjs/core/bodyparser";
import type { HttpContext } from "@adonisjs/core/http";
import { test } from "@japa/runner";
import { discardUploads } from "#services/uploads";
import { uploadOf } from "#tests/helpers/images";

/** A parsed upload whose temp file is `tmpPath`, or one already moved (none). */
function fileAt(tmpPath?: string) {
	const file = new MultipartFile(
		{ fieldName: "referenceImages", clientName: "reference.png", headers: {} },
		{},
	);
	if (tmpPath) file.tmpPath = tmpPath;
	return file;
}

const requestWith = (allFiles: () => unknown) =>
	({ allFiles }) as unknown as HttpContext["request"];

test.group("discardUploads", () => {
	test("deletes the temp file of every upload, nested or in lists", async ({ assert }) => {
		const paths: string[] = [];
		for (let i = 0; i < 4; i++) paths.push((await uploadOf(Buffer.from("x"))).tmpPath);

		await discardUploads(
			requestWith(() => ({
				one: fileAt(paths[0]),
				many: [fileAt(paths[1]), fileAt(paths[2])],
				nested: { deep: [fileAt(paths[3])] },
				moved: fileAt(),
			})),
		);

		for (const path of paths) assert.isFalse(existsSync(path), path);
	});

	test("a file already gone, or no body parser at all, is fine", async () => {
		await discardUploads(requestWith(() => ({ gone: fileAt("/nonexistent/td51-upload") })));
		await discardUploads(
			requestWith(() => {
				throw new Error("Cannot read files. Make sure the bodyparser middleware is registered");
			}),
		);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=uploads.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#services/uploads` in the log.

- [ ] **Step 3: Write `discardUploads`**

Create `apps/platform/app/services/uploads.ts`:

```ts
import { rm } from "node:fs/promises";
import { MultipartFile } from "@adonisjs/core/bodyparser";
import type { HttpContext } from "@adonisjs/core/http";
import logger from "@adonisjs/core/services/logger";

/**
 * Deletes the temp file of every upload in the request that nothing stored
 * (ImageService.store deletes the ones it reads). The body parser writes
 * each uploaded file to a temp file before any route code runs, and nothing
 * removes the others, so on the public API, where anyone can upload, every
 * request ends with this (TAT-51): in the exception handler for failures,
 * in the controller's `finally` for successes. Best effort: never throws.
 */
export async function discardUploads(
	request: HttpContext["request"],
): Promise<void> {
	let files: unknown;
	try {
		files = request.allFiles();
	} catch {
		// The body parser never ran (a URL no route matched): nothing uploaded.
		return;
	}
	await Promise.all(
		tmpPathsIn(files).map((path) =>
			rm(path, { force: true }).catch((err) =>
				logger.warn({ err }, "Could not delete an upload's temp file"),
			),
		),
	);
}

/** Every temp path in the body parser's files: a file, a list, or nested fields. */
function tmpPathsIn(value: unknown): string[] {
	if (value instanceof MultipartFile) return value.tmpPath ? [value.tmpPath] : [];
	if (Array.isArray(value)) return value.flatMap(tmpPathsIn);
	if (typeof value === "object" && value !== null) {
		return Object.values(value).flatMap(tmpPathsIn);
	}
	return [];
}
```

- [ ] **Step 4: Test uploads go to a folder the tests can read**

In `apps/platform/config/bodyparser.ts`, add the imports

```ts
import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
```

and inside `multipart: { … }`, after `limit: "20mb",`, add:

```ts
		/**
		 * Tests keep uploads in tmp/storage/uploads (made and cleared by
		 * tests/bootstrap.ts), so a test can check that a request left no temp
		 * file behind (TAT-51). Elsewhere they go to the OS temp folder.
		 */
		...(app.inTest
			? { tmpFileName: () => app.tmpPath("storage", "uploads", randomUUID()) }
			: {}),
```

In `apps/platform/tests/bootstrap.ts`, change `import { rm } from "node:fs/promises";` to `import { mkdir, rm } from "node:fs/promises";`, add after `clearTestStorage`:

```ts
/** Where the body parser writes uploads in tests (config/bodyparser.ts). */
const makeUploadsFolder = () =>
	mkdir(app.tmpPath("storage", "uploads"), { recursive: true });
```

and make the setup hooks `setup: [clearTestStorage, makeUploadsFolder, installDbTripwire],`.

Create `apps/platform/tests/helpers/uploads.ts`:

```ts
import { readdir } from "node:fs/promises";
import app from "@adonisjs/core/services/app";

const UPLOADS = app.tmpPath("storage", "uploads");

/** The temp files in tmp/storage/uploads now, where tests' uploads go (config/bodyparser.ts). */
export async function tempUploads(): Promise<Set<string>> {
	return new Set(await readdir(UPLOADS).catch(() => [] as string[]));
}

/** Temp files that appeared since `before`: what a request left behind. */
export async function newTempUploads(before: Set<string>): Promise<string[]> {
	return [...(await tempUploads())].filter((name) => !before.has(name));
}

/** The reference image files stored for `tenant` on the private test disk. */
export function storedReferenceImages(tenant: { id: string }): Promise<string[]> {
	return readdir(
		app.tmpPath("storage", "private", "tenants", tenant.id, "reference_image"),
	).catch(() => [] as string[]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=uploads.spec.ts`
Expected: PASS.

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=artist_form.spec.ts --files=payment_method_form.spec.ts --files=artist_photo.spec.ts`
Expected: PASS (dashboard uploads now land in `tmp/storage/uploads` in tests, and still work).

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/services/uploads.ts apps/platform/config/bodyparser.ts apps/platform/tests/bootstrap.ts apps/platform/tests/helpers/uploads.ts apps/platform/tests/unit/services/uploads.spec.ts
git -C <repo> commit -m "feat(platform): add discardUploads for temp files nothing stored

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Visible artists and matching a client by phone

**Files:**
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts`, `apps/platform/app/modules/clients/services/client_service.ts`
- Test: `apps/platform/tests/functional/artists/artist_service.spec.ts` (append), `apps/platform/tests/functional/clients/client_service.spec.ts` (append)

**Interfaces:**
- Produces: `ArtistService.listVisible(tenant: Pick<Tenant, "id">): Promise<Artist[]>`; `ClientService.matchByPhone(tenant: Pick<Tenant, "id">, contact: NewClient): Promise<Client>` (`NewClient` = `{ name: string; phone: string; email: string | null }`, phone in E.164); `protected ClientService.lockByPhone(tenant, phone): Promise<Client | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/platform/tests/functional/artists/artist_service.spec.ts`:

```ts
test.group("ArtistService.listVisible", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the live, visible profiles by name, closed ones included", async ({ assert }) => {
		const { tenant } = await studioWithOwner("visible-needle-51");

		const names = await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "zara", slug: "zara", acceptingInquiries: false });
			await Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" });
			await Artist.create({ tenantId: tenant.id, name: "Hidden", slug: "hidden", visible: false });
			const gone = await Artist.create({ tenantId: tenant.id, name: "Gone", slug: "gone" });
			await gone.softDelete();
			return (await artists.listVisible(tenant)).map(({ name }) => name);
		});

		assert.deepEqual(names, ["Bina", "zara"]);
	});

	test("another studio's context sees none of them", async ({ assert }) => {
		const { tenant } = await studioWithOwner("visible-a-51");
		const other = await studioWithOwner("visible-b-51");
		await inTenant(tenant, () => Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" }));

		assert.lengthOf(await inTenant(other.tenant, () => artists.listVisible(tenant)), 0);
	});
});
```

Append to `apps/platform/tests/functional/clients/client_service.spec.ts`:

```ts
/**
 * A ClientService whose first locked lookup misses, as if another request
 * inserted the phone right after it looked.
 */
class RacingClientService extends ClientService {
	misses = 1;

	protected override async lockByPhone(tenant: { id: string }, phone: string) {
		if (this.misses > 0) {
			this.misses -= 1;
			return null;
		}
		return super.lockByPhone(tenant, phone);
	}
}

test.group("ClientService.matchByPhone", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const contact = (phone: string) => ({ name: "Maya Gurung", phone, email: "maya@example.com" });

	test("a new phone gets a new client with the submitted name and email, no notes", async ({ assert }) => {
		const { tenant } = await studioWithOwner("match-new-51");

		const client = await inTenant(tenant, () => clients.matchByPhone(tenant, contact("+9779812345601")));

		assert.deepEqual(
			[client.tenantId, client.name, client.phone, client.email, client.notes],
			[tenant.id, "Maya Gurung", "+9779812345601", "maya@example.com", null],
		);
	});

	test("a found client comes back untouched, whatever was submitted", async ({ assert }) => {
		const { tenant } = await studioWithOwner("match-found-51");
		const existing = await inTenant(tenant, () =>
			makeClient(tenant, { name: "Maya G.", email: null, notes: "Prefers mornings" }),
		);
		const before = await inTenant(tenant, async () => (await Client.findOrFail(existing.id)).serialize());

		const found = await inTenant(tenant, () => clients.matchByPhone(tenant, contact(existing.phone ?? "")));

		assert.equal(found.id, existing.id);
		assert.deepEqual(await inTenant(tenant, async () => (await Client.findOrFail(existing.id)).serialize()), before);
	});

	test("a deleted client's phone gets a new client", async ({ assert }) => {
		const { tenant } = await studioWithOwner("match-deleted-51");
		const gone = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await client.softDelete();
			return client;
		});

		const fresh = await inTenant(tenant, () => clients.matchByPhone(tenant, contact(gone.phone ?? "")));

		assert.notEqual(fresh.id, gone.id);
		assert.equal(fresh.name, "Maya Gurung");
	});

	test("an anonymized client that still has the phone is reused untouched", async ({ assert }) => {
		const { tenant } = await studioWithOwner("match-anon-51");
		const anonymized = await inTenant(tenant, () =>
			makeClient(tenant, { name: "Deleted client", anonymizedAt: DateTime.now() }),
		);

		const found = await inTenant(tenant, () => clients.matchByPhone(tenant, contact(anonymized.phone ?? "")));

		assert.equal(found.id, anonymized.id);
		assert.equal(found.name, "Deleted client");
	});

	test("the same phone in another studio is another client", async ({ assert }) => {
		const { tenant } = await studioWithOwner("match-a-51");
		const other = await studioWithOwner("match-b-51");
		const theirs = await inTenant(other.tenant, () => makeClient(other.tenant));

		const ours = await inTenant(tenant, () => clients.matchByPhone(tenant, contact(theirs.phone ?? "")));

		assert.notEqual(ours.id, theirs.id);
		assert.equal(ours.tenantId, tenant.id);
	});

	test("losing the race for a new phone finds the winner's client", async ({ assert }) => {
		const { tenant } = await studioWithOwner("match-race-51");
		const winner = await inTenant(tenant, () => makeClient(tenant, { name: "First" }));

		const found = await inTenant(tenant, () =>
			new RacingClientService().matchByPhone(tenant, { name: "Second", phone: winner.phone ?? "", email: null }),
		);

		assert.equal(found.id, winner.id);
		assert.equal(found.name, "First");
		assert.lengthOf(await inTenant(tenant, () => Client.query()), 1);
	});
});
```

(`Artist`, `studioWithOwner`, `inTenant`, `testUtils` are already imported in the artist spec; `Client`, `DateTime`, `makeClient` in the client spec. Add any that a file lacks.)

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=artist_service.spec.ts --files=client_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: the new tests FAIL (`listVisible is not a function`, `matchByPhone is not a function`, or a type error on `lockByPhone`); the existing ones pass.

- [ ] **Step 3: Write the two methods**

In `apps/platform/app/modules/artists/services/artist_service.ts`, after `list`:

```ts
	/**
	 * The tenant's live, visible profiles, by name, ignoring case: the
	 * artists a studio page shows and an inquiry may name (TAT-51), open or
	 * closed for inquiries.
	 */
	async listVisible(tenant: TenantRef): Promise<Artist[]> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("visible", true)
			.orderByRaw("lower(name) asc")
			.orderBy("id", "asc");
	}
```

In `apps/platform/app/modules/clients/services/client_service.ts`, replace the class comment's sentence "Intake (TAT-51) matches by phone with `findByPhone` and never changes a client: only an owner's edit does." with "Intake (TAT-51) matches by phone with `matchByPhone` and never changes a client: only an owner's edit does.", and after `create` add:

```ts
	/**
	 * The client an inquiry from `contact.phone` (E.164) belongs to (intake,
	 * TAT-51): the tenant's live client with that phone, else a new one with
	 * the submitted name and email. A found client is never changed,
	 * whatever the form says (an anonymized one included). Its row stays
	 * locked until the transaction ends, so two submissions from one phone
	 * run one after the other; a new phone is serialized by the unique index
	 * instead, and the loser of that race gets the winner's client. Call it
	 * inside a transaction.
	 */
	async matchByPhone(tenant: TenantRef, contact: NewClient): Promise<Client> {
		const found = await this.lockByPhone(tenant, contact.phone);
		if (found) return found;
		try {
			return await this.create(tenant, contact);
		} catch (error) {
			if (!(error instanceof ClientRuleError && error.reason === "phone_taken")) {
				throw error;
			}
			const winner = await this.lockByPhone(tenant, contact.phone);
			if (!winner) throw error;
			return winner;
		}
	}

	/** `findByPhone`, with the row locked until the transaction ends. */
	protected async lockByPhone(
		tenant: TenantRef,
		phone: string,
	): Promise<Client | null> {
		return Client.query()
			.where("tenant_id", tenant.id)
			.where("phone", phone)
			.forUpdate()
			.first();
	}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=artist_service.spec.ts --files=client_service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/artists/services/artist_service.ts apps/platform/app/modules/clients/services/client_service.ts apps/platform/tests/functional/artists/artist_service.spec.ts apps/platform/tests/functional/clients/client_service.spec.ts
git -C <repo> commit -m "feat(platform): list visible artists and match intake clients by phone

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The intake validator

**Files:**
- Create: `apps/platform/app/modules/inquiries/validators/intake.ts`
- Test: `apps/platform/tests/unit/modules/inquiries/intake_validator.spec.ts` (create)

**Interfaces:**
- Consumes: `SOURCE_CHANNELS` (`#modules/inquiries/models/inquiry`), `imageFile()` (`#modules/media/validators/image_file`), `IMAGE_FORMAT_MESSAGE` (`#modules/media/errors`), `phoneNumber`, `PHONE_MESSAGE` (`#validators/phone`).
- Produces: `intakeValidator`, `IntakeSubmission = Infer<typeof intakeValidator>`, `MAX_REFERENCE_IMAGES = 5`, `ARTIST_MESSAGE` from `#modules/inquiries/validators/intake`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/inquiries/intake_validator.spec.ts`:

```ts
import { MultipartFile } from "@adonisjs/core/bodyparser";
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { ARTIST_MESSAGE, intakeValidator } from "#modules/inquiries/validators/intake";
import { PHONE_MESSAGE } from "#validators/phone";

const REQUIRED = "This field is required.";
const ARTIST_ID = "0195f3a0-0000-7000-8000-000000000051";

/** What the body parser hands over: strings, null for empty fields. */
const body = (over: Record<string, unknown> = {}) => ({
	idea: "A fine-line peony with two leaves",
	placement: "Left forearm",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	preferredArtistId: null,
	budget: null,
	sourceChannel: "instagram",
	contactName: "Maya Gurung",
	contactPhone: "9812345678",
	contactEmail: null,
	...over,
});

/** The body without these fields, as when a form leaves them out. */
const without = (...fields: string[]) =>
	Object.fromEntries(Object.entries(body()).filter(([key]) => !fields.includes(key)));

/** A parsed upload, as the validator sees it. */
function upload(clientName: string, size = 1000) {
	const file = new MultipartFile({ fieldName: "referenceImages", clientName, headers: {} }, {});
	file.size = size;
	file.extname = clientName.split(".").pop();
	file.state = "consumed";
	return file;
}

/** Field → message of a refused body, or {} when it passes. */
async function problems(data: Record<string, unknown>) {
	try {
		await intakeValidator.validate(data);
		return {};
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			return Object.fromEntries(
				(error.messages as { field: string; message: string }[]).map(({ field, message }) => [field, message]),
			);
		}
		throw error;
	}
}

test.group("intakeValidator", () => {
	test("a complete body passes, with the phone in E.164 and empty fields null", async ({ assert }) => {
		const output = await intakeValidator.validate(
			body({ preferredArtistId: ARTIST_ID, budget: "NPR 15000", contactEmail: "maya@example.com" }),
		);

		assert.equal(output.contactPhone, "+9779812345678");
		assert.equal(output.preferredArtistId, ARTIST_ID);
		assert.equal(output.budget, "NPR 15000");
		assert.equal(output.contactEmail, "maya@example.com");
		assert.equal(output.sourceChannel, "instagram");
		assert.isNull((await intakeValidator.validate(body())).contactEmail);
	});

	test("each required field is required, and blank counts as missing", async ({ assert }) => {
		const messages: Record<string, string> = {
			idea: REQUIRED,
			placement: REQUIRED,
			approximateSize: REQUIRED,
			preferredDates: REQUIRED,
			sourceChannel: "Choose how you found the studio.",
			contactName: REQUIRED,
			contactPhone: PHONE_MESSAGE,
		};
		for (const [field, message] of Object.entries(messages)) {
			assert.deepEqual(await problems(without(field)), { [field]: message }, `${field} missing`);
		}
		for (const field of ["idea", "placement", "approximateSize", "preferredDates", "contactName"]) {
			assert.deepEqual(await problems(body({ [field]: "   " })), { [field]: REQUIRED }, `${field} blank`);
		}
	});

	test("the optional fields may be left out", async ({ assert }) => {
		assert.deepEqual(await problems(without("preferredArtistId", "budget", "contactEmail")), {});
	});

	test("each text field takes its column's length and not one more", async ({ assert }) => {
		for (const [field, max] of [
			["idea", 4000],
			["placement", 120],
			["approximateSize", 120],
			["preferredDates", 500],
			["budget", 120],
			["contactName", 120],
		] as const) {
			assert.deepEqual(await problems(body({ [field]: "x".repeat(max) })), {}, `${field} at ${max}`);
			assert.deepEqual(
				await problems(body({ [field]: "x".repeat(max + 1) })),
				{ [field]: `Use at most ${max} characters.` },
				`${field} over ${max}`,
			);
		}
		assert.deepEqual(await problems(body({ contactPhone: "9".repeat(41) })), {
			contactPhone: "Use at most 40 characters.",
		});
		assert.deepEqual(await problems(body({ contactEmail: `${"m".repeat(250)}@example.com` })), {
			contactEmail: "Use at most 254 characters.",
		});
	});

	test("a NUL character is refused", async ({ assert }) => {
		assert.deepEqual(await problems(body({ idea: "A peony\u0000" })), {
			idea: "Remove the unsupported characters.",
		});
	});

	test("phone forms become E.164; a bad phone gets the phone message", async ({ assert }) => {
		for (const typed of ["981-234-5678", "+977 981 234 5678", "009779812345678", "9779812345678"]) {
			assert.equal((await intakeValidator.validate(body({ contactPhone: typed }))).contactPhone, "+9779812345678", typed);
		}
		assert.deepEqual(await problems(body({ contactPhone: "12345" })), { contactPhone: PHONE_MESSAGE });
	});

	test("a bad email, an unknown channel and a malformed artist id", async ({ assert }) => {
		assert.deepEqual(await problems(body({ contactEmail: "maya-at-example" })), {
			contactEmail: "Enter a valid email address, or leave it empty.",
		});
		assert.deepEqual(await problems(body({ sourceChannel: "tv" })), {
			sourceChannel: "Choose how you found the studio.",
		});
		assert.deepEqual(await problems(body({ preferredArtistId: "42" })), { preferredArtistId: ARTIST_MESSAGE });
	});

	test("up to 5 images of up to 10 MB with an image extension", async ({ assert }) => {
		const five = Array.from({ length: 5 }, (_, i) => upload(`ref-${i}.png`));
		assert.lengthOf((await intakeValidator.validate(body({ referenceImages: five }))).referenceImages ?? [], 5);

		assert.deepEqual(await problems(body({ referenceImages: [...five, upload("ref-5.jpg")] })), {
			referenceImages: "Attach up to 5 images.",
		});
		assert.deepEqual(await problems(body({ referenceImages: [upload("big.png", 10 * 1024 * 1024 + 1)] })), {
			"referenceImages.0": "Use images of 10 MB or less.",
		});
		assert.deepEqual(await problems(body({ referenceImages: [upload("ok.webp"), upload("moving.gif")] })), {
			"referenceImages.1": IMAGE_FORMAT_MESSAGE,
		});
	});

	test("a challenge token is taken up to 2048 characters", async ({ assert }) => {
		const token = "t".repeat(2048);
		assert.equal((await intakeValidator.validate(body({ challengeToken: token }))).challengeToken, token);
		assert.deepEqual(await problems(body({ challengeToken: `${token}t` })), {
			challengeToken: "Use at most 2048 characters.",
		});
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=intake_validator.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/inquiries/validators/intake` in the log.

- [ ] **Step 3: Write the validator**

Create `apps/platform/app/modules/inquiries/validators/intake.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { SOURCE_CHANNELS } from "#modules/inquiries/models/inquiry";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";
import { PHONE_MESSAGE, phoneNumber } from "#validators/phone";

/** Reference images per inquiry, at most (docs/requirements.md, Intake). */
export const MAX_REFERENCE_IMAGES = 5;

/** For a `preferredArtistId` that isn't one of the studio's visible artists. */
export const ARTIST_MESSAGE = "Choose an artist from the list, or none.";

/** PostgreSQL text can't hold NUL: refuse it as a field error, not a 500. */
const NO_NUL = /^[^\u0000]*$/;

/** Required free text, trimmed, within its column's length. */
const text = (max: number) =>
	vine.string().trim().minLength(1).maxLength(max).regex(NO_NUL);

/** Optional free text: empty or missing is none. */
const optionalText = (max: number) =>
	vine.string().trim().maxLength(max).regex(NO_NUL).nullable().optional();

/**
 * An inquiry from the public intake form (TAT-51), as the multipart body
 * gives it: strings, null for empty fields, and the `referenceImages` files
 * (the controller passes `request.files()`, always a list). Lengths are the
 * inquiry columns'; the phone becomes E.164. Images are only filtered here
 * (size, extension): ImageService checks what they really are. The
 * bot-challenge token is taken and ignored until TAT-55; any other field is
 * dropped.
 */
export const intakeValidator = vine.create({
	idea: text(4000),
	placement: text(120),
	approximateSize: text(120),
	preferredDates: text(500),
	preferredArtistId: vine.string().uuid().nullable().optional(),
	budget: optionalText(120),
	sourceChannel: vine.enum(SOURCE_CHANNELS),
	contactName: text(120),
	contactPhone: vine.string().trim().maxLength(40).use(phoneNumber()),
	contactEmail: vine.string().trim().maxLength(254).email().nullable().optional(),
	referenceImages: vine
		.array(imageFile())
		.maxLength(MAX_REFERENCE_IMAGES)
		.optional(),
	challengeToken: vine.string().maxLength(2048).optional(),
});

export type IntakeSubmission = Infer<typeof intakeValidator>;

const REQUIRED = "This field is required.";
const CHANNEL = "Choose how you found the studio.";
const COUNT = `Attach up to ${MAX_REFERENCE_IMAGES} images.`;

intakeValidator.messagesProvider = new SimpleMessagesProvider({
	required: REQUIRED,
	minLength: REQUIRED,
	maxLength: "Use at most {{ max }} characters.",
	regex: "Remove the unsupported characters.",
	"sourceChannel.required": CHANNEL,
	"sourceChannel.enum": CHANNEL,
	"preferredArtistId.uuid": ARTIST_MESSAGE,
	"contactEmail.email": "Enter a valid email address, or leave it empty.",
	"contactPhone.required": PHONE_MESSAGE,
	"referenceImages.maxLength": COUNT,
	"referenceImages.array.maxLength": COUNT,
	"referenceImages.*.file": IMAGE_FORMAT_MESSAGE,
	"referenceImages.*.file.extname": IMAGE_FORMAT_MESSAGE,
	"referenceImages.*.file.size": "Use images of 10 MB or less.",
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=intake_validator.spec.ts`
Expected: PASS. If a message test fails with VineJS's default text, the rule name differs from the key: print `error.messages` (it carries `rule`) and key the message by that rule (`"<field>.<rule>"`, or `"referenceImages.*.<rule>"` for a file); keep the messages verbatim. If `{{ max }}` prints literally, use the placeholder VineJS's own `maxLength` message uses.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/inquiries/validators/intake.ts apps/platform/tests/unit/modules/inquiries/intake_validator.spec.ts
git -C <repo> commit -m "feat(platform): validate public inquiries

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The staff alert job

**Files:**
- Create: `apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts`
- Test: `apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts` (create)

**Interfaces:**
- Consumes: `TenantJob` (`#services/tenant_job`), `Inquiry`.
- Produces: `NewInquiryAlertJob` (default export of `#modules/inquiries/jobs/new_inquiry_alert_job`), payload `{ tenantId: string; inquiryId: string }`; logs `logger.info({ tenantId, inquiryId }, "New inquiry received.")` for an inquiry still `new`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const MESSAGE = "New inquiry received.";

/** Runs the job the way the worker does and returns what it logged at info level. */
async function run(payload: { tenantId: string; inquiryId: string }) {
	const job = new NewInquiryAlertJob();
	job.$hydrate(payload, {
		jobId: "new-inquiry-alert-spec",
		name: "NewInquiryAlertJob",
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
	return info.mock.calls.map((call) => call.arguments).filter((args) => args[1] === MESSAGE);
}

test.group("NewInquiryAlertJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("logs a new inquiry's ids, and no contact details", async ({ assert }) => {
		const { tenant } = await studioWithOwner("alert-needle-51");
		const inquiry = await inTenant(tenant, async () => makeInquiry(tenant, await makeClient(tenant)));

		const logged = await run({ tenantId: tenant.id, inquiryId: inquiry.id });

		assert.deepEqual(logged, [[{ tenantId: tenant.id, inquiryId: inquiry.id }, MESSAGE]]);
	});

	test("a decided, missing or other studio's inquiry needs no alert", async ({ assert }) => {
		const { tenant } = await studioWithOwner("alert-a-51");
		const other = await studioWithOwner("alert-b-51");
		const declined = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant), { status: "declined", decidedAt: DateTime.now() }),
		);
		const theirs = await inTenant(other.tenant, async () => makeInquiry(other.tenant, await makeClient(other.tenant)));

		for (const inquiryId of [declined.id, randomUUID(), theirs.id]) {
			assert.deepEqual(await run({ tenantId: tenant.id, inquiryId }), [], inquiryId);
		}
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=new_inquiry_alert_job.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/inquiries/jobs/new_inquiry_alert_job` in the log.

- [ ] **Step 3: Write the job**

Create `apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts`:

```ts
import logger from "@adonisjs/core/services/logger";
import Inquiry from "#modules/inquiries/models/inquiry";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; inquiryId: string };

/**
 * Alerts a studio's staff to a new inquiry. IntakeService.submit (TAT-51)
 * queues it in the inquiry's transaction, so it exists exactly when the
 * inquiry does. For now it only logs the two ids: TAT-52 sends the owners'
 * and the preferred artist's email and in-app alerts from here. Safe to
 * repeat; an inquiry that is gone or already decided needs no alert.
 */
export default class NewInquiryAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, inquiryId } = this.payload;
		const inquiry = await Inquiry.query()
			.where("tenant_id", tenantId)
			.where("id", inquiryId)
			.first();
		if (!inquiry || inquiry.status !== "new") return;
		logger.info({ tenantId, inquiryId }, "New inquiry received.");
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, inquiryId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, inquiryId },
			"Alerting staff to a new inquiry failed.",
		);
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=new_inquiry_alert_job.spec.ts`
Expected: PASS.

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=job_classes.spec.ts`
Expected: PASS (it extends `TenantJob`, so the guard needs no allowlist entry).

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/modules/inquiries/jobs apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts
git -C <repo> commit -m "feat(platform): add the job that alerts staff to a new inquiry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `IntakeService.submit`

**Files:**
- Modify: `apps/platform/app/modules/inquiries/errors.ts`, `apps/platform/app/modules/inquiries/models/inquiry.ts` (comment)
- Create: `apps/platform/app/modules/inquiries/services/intake_service.ts`
- Test: `apps/platform/tests/functional/inquiries/intake_service.spec.ts` (create)

**Interfaces:**
- Consumes: `ArtistService.listVisible`, `ClientService.matchByPhone` (Task 5); `NewInquiryAlertJob` (Task 7); `ImageService.store`, `ImageService.delete`; `withTransaction`, `afterRollback` (`#services/db_context`); `dispatchInTransaction` (`#services/queue`); `InvalidImageError` (`#modules/media/errors`).
- Produces: `IntakeService` (default export of `#modules/inquiries/services/intake_service`, `@inject()` with `ArtistService`, `ClientService`, `ImageService`) with `submit(tenant: Pick<Tenant, "id">, submission: Submission): Promise<Inquiry>`; `type Submission`; `OPEN_INQUIRY_LIMIT = 3`; `InquiryRuleError` reasons `artist_not_accepting`, `studio_not_accepting`, `too_many_open_inquiries` (plus the existing `artist_unavailable`); `InvalidReferenceImageError(index: number, message: string)` with `readonly index`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/inquiries/intake_service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import Client from "#modules/clients/models/client";
import ClientService from "#modules/clients/services/client_service";
import { InquiryRuleError, InvalidReferenceImageError } from "#modules/inquiries/errors";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import IntakeService, { type Submission } from "#modules/inquiries/services/intake_service";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { withDbContext } from "#services/db_context";
import { RecordingImageService, testImages, uploadOf } from "#tests/helpers/images";
import { makeClient, makeInquiry, nextPhone } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

type TenantRef = { id: string };

/** An ImageService whose `failOn`-th store fails with a non-image error (a full disk). */
class FailingImageService extends RecordingImageService {
	stores = 0;

	constructor(private failOn: number) {
		super();
	}

	override async store(...args: Parameters<RecordingImageService["store"]>) {
		this.stores += 1;
		if (this.stores === this.failOn) throw new Error("disk full");
		return super.store(...args);
	}
}

function makeIntake(images: RecordingImageService = new RecordingImageService()) {
	return { images, intake: new IntakeService(new ArtistService(images), new ClientService(), images) };
}

const submission = (over: Partial<Submission> = {}): Submission => ({
	idea: "A fine-line peony with two leaves",
	placement: "Left forearm",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	sourceChannel: "instagram",
	contactName: "Maya Gurung",
	contactPhone: nextPhone(),
	contactEmail: "maya@example.com",
	...over,
});

const pngs = async (count: number) => {
	const uploads: { tmpPath: string }[] = [];
	for (let i = 0; i < count; i++) uploads.push(await uploadOf(await testImages.png()));
	return uploads;
};

/** The InquiryRuleError reason a refused submit gives, or null if it went through. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof InquiryRuleError) return error.reason;
		throw error;
	}
}

async function rejectionOf(work: () => Promise<unknown>): Promise<unknown> {
	try {
		await work();
	} catch (error) {
		return error;
	}
	throw new Error("expected the submit to fail");
}

/** What the studio holds: its clients, inquiries and reference rows. */
const rowsIn = (tenant: TenantRef) =>
	inTenant(tenant, async () => ({
		clients: await Client.query().orderBy("id"),
		inquiries: await Inquiry.query().orderBy("id"),
		images: await ReferenceImage.query().orderBy("position"),
	}));

const exists = (key: string) => drive.use("private").exists(key);

/** Rows in the queue table, committed or in the test's transaction. */
const queuedJobs = async () => Number((await db.from("queue_jobs").count("* as total"))[0].total);

test.group("IntakeService.submit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new phone: a new client, a `new` inquiry with what was sent, its images in order", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-svc-51");
		const { intake, images } = makeIntake();
		const sent = submission({ budget: "NPR 15000", referenceImages: await pngs(2) });

		const inquiry = await inTenant(tenant, () => intake.submit(tenant, sent));

		const rows = await rowsIn(tenant);
		assert.deepEqual(
			rows.clients.map((c) => [c.name, c.phone, c.email, c.notes]),
			[["Maya Gurung", sent.contactPhone, "maya@example.com", null]],
		);
		assert.deepEqual(
			rows.inquiries.map((row) => [
				row.id, row.clientId, row.status, row.idea, row.placement, row.approximateSize,
				row.preferredDates, row.preferredArtistId, row.budget, row.sourceChannel,
				row.contactName, row.contactPhone, row.contactEmail,
			]),
			[[
				inquiry.id, rows.clients[0].id, "new", sent.idea, sent.placement, sent.approximateSize,
				sent.preferredDates, null, "NPR 15000", "instagram",
				"Maya Gurung", sent.contactPhone, "maya@example.com",
			]],
		);
		assert.deepEqual(
			rows.images.map((r) => [r.inquiryId, r.projectId, r.position, r.width, r.height]),
			[[inquiry.id, null, 0, 300, 200], [inquiry.id, null, 1, 300, 200]],
		);
		assert.deepEqual(rows.images.map((r) => r.imageKey), images.keys);
		for (const key of images.keys) {
			assert.match(key, new RegExp(`^tenants/${tenant.id}/reference_image/`));
			assert.isTrue(await exists(key), key);
		}
	});

	test("a returning client keeps their details; the inquiry keeps what was sent", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-return-51");
		const { intake } = makeIntake();
		const client = await inTenant(tenant, () =>
			makeClient(tenant, { name: "Maya G.", email: null, notes: "Prefers mornings" }),
		);
		const before = await inTenant(tenant, async () => (await Client.findOrFail(client.id)).serialize());

		const inquiry = await inTenant(tenant, () =>
			intake.submit(tenant, submission({ contactPhone: client.phone ?? "" })),
		);

		assert.deepEqual(await inTenant(tenant, async () => (await Client.findOrFail(client.id)).serialize()), before);
		assert.equal(inquiry.clientId, client.id);
		assert.deepEqual(
			[inquiry.contactName, inquiry.contactPhone, inquiry.contactEmail],
			["Maya Gurung", client.phone, "maya@example.com"],
		);
	});

	test("a chosen artist must be a live, visible artist of the studio who accepts inquiries", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-artist-51");
		const other = await studioWithOwner("intake-artist-b-51");
		const { intake, images } = makeIntake();
		const { hidden, gone, closed } = await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" });
			const gone = await Artist.create({ tenantId: tenant.id, name: "Gone", slug: "gone" });
			await gone.softDelete();
			return {
				hidden: await Artist.create({ tenantId: tenant.id, name: "Hidden", slug: "hidden", visible: false }),
				gone,
				closed: await Artist.create({ tenantId: tenant.id, name: "Sita", slug: "sita", acceptingInquiries: false }),
			};
		});
		const foreign = await inTenant(other.tenant, () =>
			Artist.create({ tenantId: other.tenant.id, name: "Ram", slug: "ram" }),
		);

		for (const [label, artistId, reason] of [
			["unknown", randomUUID(), "artist_unavailable"],
			["hidden", hidden.id, "artist_unavailable"],
			["deleted", gone.id, "artist_unavailable"],
			["another studio's", foreign.id, "artist_unavailable"],
			["not accepting", closed.id, "artist_not_accepting"],
		] as const) {
			const refused = await reasonOf(async () =>
				inTenant(tenant, async () =>
					intake.submit(tenant, submission({ preferredArtistId: artistId, referenceImages: await pngs(1) })),
				),
			);
			assert.equal(refused, reason, label);
		}

		assert.deepEqual(images.keys, [], "no image was decoded");
		const rows = await rowsIn(tenant);
		assert.deepEqual([rows.clients.length, rows.inquiries.length], [0, 0]);
	});

	test("an open artist can be chosen, and no artist is fine while one is open", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-open-51");
		const { intake } = makeIntake();
		const bina = await inTenant(tenant, () => Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" }));

		const chosen = await inTenant(tenant, () => intake.submit(tenant, submission({ preferredArtistId: bina.id })));
		const any = await inTenant(tenant, () => intake.submit(tenant, submission({ preferredArtistId: null })));

		assert.equal(chosen.preferredArtistId, bina.id);
		assert.isNull(any.preferredArtistId);
	});

	test("with no artist chosen, a studio whose visible artists are all closed takes none", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-closed-51");
		const { intake } = makeIntake();
		await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Sita", slug: "sita", acceptingInquiries: false });
			// A hidden artist doesn't keep the studio open.
			await Artist.create({ tenantId: tenant.id, name: "Ram", slug: "ram", visible: false });
		});

		assert.equal(await reasonOf(() => inTenant(tenant, () => intake.submit(tenant, submission()))), "studio_not_accepting");
	});

	test("a studio with no visible artists takes general inquiries", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-none-51");
		const { intake } = makeIntake();

		assert.isNull(await reasonOf(() => inTenant(tenant, () => intake.submit(tenant, submission()))));
	});

	test("a phone with 3 open inquiries is refused; decided, deleted and other studios' don't count", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-cap-51");
		const other = await studioWithOwner("intake-cap-b-51");
		const { intake, images } = makeIntake();
		const phone = nextPhone();
		await inTenant(tenant, async () => {
			// A deleted client's open inquiry still counts: the cap is per phone.
			const earlier = await makeClient(tenant, { phone });
			await makeInquiry(tenant, earlier);
			await earlier.softDelete();
			const client = await makeClient(tenant, { phone });
			await makeInquiry(tenant, client);
			await makeInquiry(tenant, client, { status: "declined", decidedAt: DateTime.now() });
			await makeInquiry(tenant, client, { status: "accepted", decidedAt: DateTime.now() });
			const gone = await makeInquiry(tenant, client);
			await gone.softDelete();
		});
		await inTenant(other.tenant, async () => makeInquiry(other.tenant, await makeClient(other.tenant, { phone })));

		// Two open: the third is taken.
		assert.isNull(await reasonOf(() => inTenant(tenant, () => intake.submit(tenant, submission({ contactPhone: phone })))));
		// Three open: the fourth is refused, before any image is decoded.
		const refused = await reasonOf(async () =>
			inTenant(tenant, async () =>
				intake.submit(tenant, submission({ contactPhone: phone, referenceImages: await pngs(1) })),
			),
		);

		assert.equal(refused, "too_many_open_inquiries");
		assert.deepEqual(images.keys, []);
		const open = (await rowsIn(tenant)).inquiries.filter((row) => row.status === "new");
		assert.lengthOf(open, 3, "the two from before plus the one taken");
	});

	test("queues the staff alert with the inquiry, and none for a refusal", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-alert-51");
		const { intake } = makeIntake();
		const fake = queue.fake();

		const inquiry = await inTenant(tenant, () => intake.submit(tenant, submission()));
		fake.assertPushed(NewInquiryAlertJob, { payload: { tenantId: tenant.id, inquiryId: inquiry.id } });
		fake.assertPushedCount(1);

		await inTenant(tenant, () =>
			Artist.create({ tenantId: tenant.id, name: "Sita", slug: "sita", acceptingInquiries: false }),
		);
		assert.equal(await reasonOf(() => inTenant(tenant, () => intake.submit(tenant, submission()))), "studio_not_accepting");
		fake.assertPushedCount(1);
	});

	test("a bad image 3 of 4 refuses the whole inquiry and deletes the images already stored", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-atomic-51");
		const { intake, images } = makeIntake();
		const uploads = [...(await pngs(2)), await uploadOf(Buffer.from("<?php echo 'hi'; ?>")), ...(await pngs(1))];

		const error = await rejectionOf(() =>
			inTenant(tenant, () => intake.submit(tenant, submission({ referenceImages: uploads }))),
		);

		assert.instanceOf(error, InvalidReferenceImageError);
		assert.equal((error as InvalidReferenceImageError).index, 2);
		assert.equal((error as InvalidReferenceImageError).message, IMAGE_FORMAT_MESSAGE);
		assert.lengthOf(images.keys, 2);
		for (const key of images.keys) assert.isFalse(await exists(key), key);
		const rows = await rowsIn(tenant);
		assert.deepEqual([rows.clients.length, rows.inquiries.length, rows.images.length], [0, 0, 0]);
	});

	test("a storage failure after two images leaves no row and no file", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-disk-51");
		const { intake, images } = makeIntake(new FailingImageService(3));

		await assert.rejects(
			async () => inTenant(tenant, async () => intake.submit(tenant, submission({ referenceImages: await pngs(3) }))),
			"disk full",
		);

		assert.lengthOf(images.keys, 2);
		for (const key of images.keys) assert.isFalse(await exists(key), key);
		const rows = await rowsIn(tenant);
		assert.deepEqual([rows.clients.length, rows.inquiries.length, rows.images.length], [0, 0, 0]);
	});

	test("a failure later in the same transaction deletes the files and drops the alert", async ({ assert }) => {
		const { tenant } = await studioWithOwner("intake-later-51");
		const { intake, images } = makeIntake();
		const before = await queuedJobs();

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await intake.submit(tenant, submission({ referenceImages: await pngs(1) }));
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.lengthOf(images.keys, 1);
		assert.isFalse(await exists(images.keys[0]));
		assert.lengthOf((await rowsIn(tenant)).inquiries, 0);
		assert.equal(await queuedJobs(), before);

		// The positive control: a submit that commits leaves its job.
		await inTenant(tenant, () => intake.submit(tenant, submission()));
		assert.equal(await queuedJobs(), before + 1);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=intake_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#modules/inquiries/services/intake_service` (or "does not provide an export named 'InvalidReferenceImageError'") in the log.

- [ ] **Step 3: The errors**

Replace `apps/platform/app/modules/inquiries/errors.ts` with:

```ts
export const INQUIRY_RULE_REASONS = [
	"already_decided",
	"artist_unavailable",
	"artist_not_accepting",
	"studio_not_accepting",
	"too_many_open_inquiries",
] as const;
export type InquiryRuleReason = (typeof INQUIRY_RULE_REASONS)[number];

const MESSAGES: Record<InquiryRuleReason, string> = {
	already_decided: "The inquiry was already accepted or declined",
	artist_unavailable:
		"The artist is not one of the tenant's live artists (for intake: live and visible)",
	artist_not_accepting: "The chosen artist is not accepting inquiries",
	studio_not_accepting:
		"No artist was chosen and none of the tenant's visible artists accepts inquiries",
	too_many_open_inquiries:
		"The phone already has as many open inquiries as the tenant takes",
};

/**
 * An inbox or intake rule was broken; `reason` says which. Thrown after the
 * failed savepoint has rolled back. The message is for developers; show your
 * own to the user.
 */
export class InquiryRuleError extends Error {
	constructor(readonly reason: InquiryRuleReason) {
		super(MESSAGES[reason]);
		this.name = "InquiryRuleError";
	}
}

/**
 * An upload in an inquiry that isn't an image we accept (TAT-51). `index` is
 * its place among the reference images; the message is the user's, like
 * InvalidImageError's.
 */
export class InvalidReferenceImageError extends Error {
	constructor(
		readonly index: number,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "InvalidReferenceImageError";
	}
}
```

- [ ] **Step 4: The service**

Create `apps/platform/app/modules/inquiries/services/intake_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import {
	InquiryRuleError,
	InvalidReferenceImageError,
} from "#modules/inquiries/errors";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry, { type SourceChannel } from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	type StoredImage,
} from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";

type TenantRef = Pick<Tenant, "id">;
type Upload = Pick<MultipartFile, "tmpPath">;

/**
 * Open inquiries (live, `new`) one phone number may have with a studio
 * (docs/requirements.md, abuse protection).
 */
export const OPEN_INQUIRY_LIMIT = 3;

const PURPOSE = "reference_image";

/** A validated submission: the phone in E.164, empty fields null or left out. */
export type Submission = {
	idea: string;
	placement: string;
	approximateSize: string;
	preferredDates: string;
	preferredArtistId?: string | null;
	budget?: string | null;
	sourceChannel: SourceChannel;
	contactName: string;
	contactPhone: string;
	contactEmail?: string | null;
	referenceImages?: Upload[];
};

/**
 * Turns a submission from the public intake form into a `new` inquiry
 * (TAT-51), all or nothing, in one transaction: the artist rules, the
 * client (matched by phone, never changed), the open-inquiry cap, the
 * images, the inquiry with what was sent, its reference rows, and the staff
 * alert job. Every refusal comes before any image is decoded. Refusals are
 * InquiryRuleError (`artist_unavailable`, `artist_not_accepting`,
 * `studio_not_accepting`, `too_many_open_inquiries`) or
 * InvalidReferenceImageError, thrown after the savepoint rolled back.
 */
@inject()
export default class IntakeService {
	constructor(
		private artists: ArtistService,
		private clients: ClientService,
		private images: ImageService,
	) {}

	async submit(tenant: TenantRef, submission: Submission): Promise<Inquiry> {
		return withTransaction(async (trx) => {
			await this.checkArtist(tenant, submission.preferredArtistId ?? null);
			// Locks the client (or, for a new phone, its index entry) until the
			// transaction ends, so the count below can't be overtaken.
			const client = await this.clients.matchByPhone(tenant, {
				name: submission.contactName,
				phone: submission.contactPhone,
				email: submission.contactEmail ?? null,
			});
			await this.checkOpenLimit(tenant, submission.contactPhone);
			const images = await this.storeImages(
				tenant,
				submission.referenceImages ?? [],
			);

			const inquiry = await Inquiry.create(
				{
					tenantId: tenant.id,
					clientId: client.id,
					idea: submission.idea,
					placement: submission.placement,
					approximateSize: submission.approximateSize,
					preferredDates: submission.preferredDates,
					preferredArtistId: submission.preferredArtistId ?? null,
					budget: submission.budget ?? null,
					sourceChannel: submission.sourceChannel,
					// What was sent, frozen: never the client's stored details.
					contactName: submission.contactName,
					contactPhone: submission.contactPhone,
					contactEmail: submission.contactEmail ?? null,
					status: "new",
				},
				{ client: trx },
			);
			for (const [position, image] of images.entries()) {
				await ReferenceImage.create(
					{
						tenantId: tenant.id,
						inquiryId: inquiry.id,
						imageKey: image.key,
						width: image.width,
						height: image.height,
						position,
					},
					{ client: trx },
				);
			}
			await queueAlert(trx, tenant, inquiry);
			return inquiry;
		});
	}

	/**
	 * A chosen artist must be one of the studio's visible artists
	 * ("artist_unavailable" otherwise, the same for unknown, hidden, deleted
	 * and another studio's) and accept inquiries ("artist_not_accepting").
	 * With none chosen, a studio whose visible artists are all closed takes
	 * none ("studio_not_accepting"); one with no visible artists takes
	 * general inquiries. Compared in memory, so no id reaches a query.
	 */
	private async checkArtist(tenant: TenantRef, artistId: string | null) {
		const visible = await this.artists.listVisible(tenant);
		if (artistId !== null) {
			const artist = visible.find(({ id }) => id === artistId);
			if (!artist) throw new InquiryRuleError("artist_unavailable");
			if (!artist.acceptingInquiries) {
				throw new InquiryRuleError("artist_not_accepting");
			}
			return;
		}
		if (visible.length > 0 && visible.every((a) => !a.acceptingInquiries)) {
			throw new InquiryRuleError("studio_not_accepting");
		}
	}

	/**
	 * Refuses the phone's next inquiry once it has OPEN_INQUIRY_LIMIT open
	 * ones: live, `new`, with this frozen `contact_phone` (so a deleted
	 * client's open inquiries count too). Runs under matchByPhone's lock.
	 */
	private async checkOpenLimit(tenant: TenantRef, phone: string) {
		const [row] = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("status", "new")
			.where("contact_phone", phone)
			// The soft-delete scope is a fetch hook; say it here too, for the aggregate.
			.whereNull("deleted_at")
			.count("* as total");
		if (Number(row.$extras.total) >= OPEN_INQUIRY_LIMIT) {
			throw new InquiryRuleError("too_many_open_inquiries");
		}
	}

	/**
	 * Stores each upload in order (one at a time, so one inquiry holds one
	 * decode slot) and registers each file's deletion the moment it is
	 * stored: if a later image or anything after it fails, or the commit
	 * does, no file is left behind.
	 */
	private async storeImages(
		tenant: TenantRef,
		uploads: Upload[],
	): Promise<StoredImage[]> {
		const stored: StoredImage[] = [];
		for (const [index, upload] of uploads.entries()) {
			let image: StoredImage;
			try {
				image = await this.images.store(upload, { tenant, purpose: PURPOSE });
			} catch (error) {
				if (error instanceof InvalidImageError) {
					throw new InvalidReferenceImageError(index, error.message, {
						cause: error,
					});
				}
				throw error;
			}
			afterRollback(() => this.images.delete(PURPOSE, image.key));
			stored.push(image);
		}
		return stored;
	}
}

/**
 * The staff alert, queued in the inquiry's transaction so it exists exactly
 * when the inquiry does (TAT-52 sends the alerts from the job).
 */
function queueAlert(
	trx: TransactionClientContract,
	tenant: TenantRef,
	inquiry: Inquiry,
) {
	return dispatchInTransaction(
		NewInquiryAlertJob.dispatch({ tenantId: tenant.id, inquiryId: inquiry.id }),
		trx,
	);
}
```

In `apps/platform/app/modules/inquiries/models/inquiry.ts`, replace "InquiryService (TAT-46) reads and decides them; intake (TAT-51) will create them." with "InquiryService (TAT-46) reads and decides them; IntakeService (TAT-51) creates them."

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 240 pnpm -C <repo>/apps/platform test functional --files=intake_service.spec.ts --files=inquiry_service.spec.ts --files=inbox.spec.ts`
Expected: PASS (the inbox's `InquiryRuleError` uses are unchanged).

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors. (If `row.$extras.total` is typed loosely, keep `Number(...)` as `InquiryService.countNew` does.)

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/inquiries apps/platform/tests/functional/inquiries/intake_service.spec.ts
git -C <repo> commit -m "feat(platform): take inquiries with reference images in one transaction

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9 (needs TAT-32): The endpoint, its isolation case and temp cleanup on failures

**Files:**
- Create: `apps/platform/app/controllers/public_inquiries_controller.ts`, `apps/platform/app/transformers/inquiry_receipt_transformer.ts`, `apps/platform/tests/helpers/intake.ts`
- Modify: `apps/platform/start/routes.ts`, `apps/platform/app/exceptions/handler.ts`, `apps/platform/tests/isolation/public_cases.ts`, `apps/platform/tests/helpers/public_isolation.ts`, `.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/api/inquiries.spec.ts` (create)

**Interfaces:**
- Consumes: `IntakeService` (Task 8), `intakeValidator`, `ARTIST_MESSAGE` (Task 6), `ApiException.of` (Task 2), `discardUploads`, the test upload helpers (Task 4), `NewInquiryAlertJob` (Task 7); TAT-32's `publicTenantContext`, `ctx.serialize`, `assertApiData`, `assertApiError`, `assertApiHeaders`, `PublicIsolationCase`.
- Produces: route `POST /api/v1/tenants/:tenant/inquiries` named `api.v1.inquiries.store`; from `#tests/helpers/intake`: `intakeFields(over?: Record<string, string>): Record<string, string>`, `type Upload = { name: string; type: string; data: Buffer }`, `png(name?, width?, height?): Promise<Upload>`, `postInquiry(client: ApiClient, slug: string, fields: Record<string, string>, uploads?: Upload[])` (returns the unsent `ApiRequest`, so a test can chain), `intakeRows(target: { tenant: { id: string } })`; `PublicIsolationCase.encoding?: "json" | "multipart"`.

- [ ] **Step 1: Write the helpers and the failing tests**

Create `apps/platform/tests/helpers/intake.ts`:

```ts
import type { ApiClient } from "@japa/api-client";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { testImages } from "#tests/helpers/images";
import { inTenant } from "#tests/helpers/tenants";

/**
 * A complete intake form's text fields as a browser sends them: strings,
 * with the phone typed nationally ("9812345678" is stored +9779812345678).
 */
export function intakeFields(over: Record<string, string> = {}): Record<string, string> {
	return {
		idea: "A fine-line peony with two leaves",
		placement: "Left forearm",
		approximateSize: "About 10 cm",
		preferredDates: "Any weekday in November",
		sourceChannel: "instagram",
		contactName: "Maya Gurung",
		contactPhone: "9812345678",
		...over,
	};
}

export type Upload = { name: string; type: string; data: Buffer };

/** A small PNG reference image. */
export async function png(name = "reference.png", width = 300, height = 200): Promise<Upload> {
	return { name, type: "image/png", data: await testImages.png(width, height) };
}

/**
 * POST /api/v1/tenants/:slug/inquiries as multipart: the fields, then each
 * upload as its own `referenceImages` part. Not sent yet, so a test can add
 * more (`.file(...)`, `.header(...)`) before awaiting it.
 */
export function postInquiry(
	client: ApiClient,
	slug: string,
	fields: Record<string, string>,
	uploads: Upload[] = [],
) {
	const request = client.post(`/api/v1/tenants/${slug}/inquiries`).fields(fields);
	for (const upload of uploads) {
		request.file("referenceImages", upload.data, { filename: upload.name, contentType: upload.type });
	}
	return request;
}

/** What an intake can change in a studio: its clients (every column), inquiries and reference images. */
export function intakeRows(target: { tenant: { id: string } }) {
	return inTenant(target.tenant, async () => ({
		clients: (await Client.query().orderBy("id")).map((row) => row.serialize()),
		inquiries: (await Inquiry.query().orderBy("id")).map((row) => row.id),
		referenceImages: (await ReferenceImage.query().orderBy("id")).map((row) => row.id),
	}));
}
```

Create `apps/platform/tests/functional/api/inquiries.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import Client from "#modules/clients/models/client";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { assertApiData, assertApiError, assertApiHeaders } from "#tests/helpers/api";
import { intakeFields, png, postInquiry } from "#tests/helpers/intake";
import { makeClient } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "intake-needle-51";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The studio's inquiries and reference images, read in its context. */
const saved = (tenant: { id: string }) =>
	inTenant(tenant, async () => ({
		inquiries: await Inquiry.query().orderBy("created_at"),
		images: await ReferenceImage.query().orderBy("position"),
	}));

test.group("Public API: POST /inquiries", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("takes an inquiry: 201 with only the new id, no-store, no cookie, the alert queued", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = queue.fake();

		const response = await postInquiry(client, SLUG, intakeFields(), [await png()]);

		const { id } = response.body().data;
		assert.match(id, UUID);
		assertApiData(response, { id }, 201);
		response.assertHeader("cache-control", "no-store");
		assertApiHeaders(response);
		const { inquiries, images } = await saved(tenant);
		assert.deepEqual(
			inquiries.map((row) => [row.id, row.status, row.contactName, row.contactPhone]),
			[[id, "new", "Maya Gurung", "+9779812345678"]],
		);
		assert.deepEqual(images.map((row) => [row.inquiryId, row.position]), [[id, 0]]);
		assert.isTrue(await drive.use("private").exists(images[0].imageKey));
		fake.assertPushed(NewInquiryAlertJob, { payload: { tenantId: tenant.id, inquiryId: id } });
	});

	test("several image parts are references in their order", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, intakeFields(), [
			await png("wide.png", 300, 200),
			await png("tall.png", 200, 300),
		]);

		response.assertStatus(201);
		const { images } = await saved(tenant);
		assert.deepEqual(images.map((row) => [row.position, row.width, row.height]), [[0, 300, 200], [1, 200, 300]]);
	});

	test("a phone typed nationally is the returning client's, whose details stay", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const existing = await inTenant(tenant, () =>
			makeClient(tenant, { name: "Maya G.", phone: "+9779812345678", email: null, notes: "Prefers mornings" }),
		);
		const before = await inTenant(tenant, async () => (await Client.findOrFail(existing.id)).serialize());

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ contactPhone: "981-234-5678", contactEmail: "maya@example.com" }),
		);

		response.assertStatus(201);
		// The same answer as for a new phone: nothing says the number was known.
		assert.deepEqual(Object.keys(response.body().data), ["id"]);
		const { inquiries } = await saved(tenant);
		assert.equal(inquiries[0].clientId, existing.id);
		assert.equal(inquiries[0].contactEmail, "maya@example.com");
		assert.deepEqual(await inTenant(tenant, async () => (await Client.findOrFail(existing.id)).serialize()), before);
	});

	test("empty optional fields mean none", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ preferredArtistId: "", budget: "", contactEmail: "" }),
		);

		response.assertStatus(201);
		const { inquiries, images } = await saved(tenant);
		assert.deepEqual(
			[inquiries[0].preferredArtistId, inquiries[0].budget, inquiries[0].contactEmail, images.length],
			[null, null, null, 0],
		);
	});

	test("a JSON body is 415, not a list of field errors", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client.post(`/api/v1/tenants/${SLUG}/inquiries`).json(intakeFields());

		assertApiError(response, 415, "unsupported_media_type");
	});

	test("GET is a 405 that allows POST", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client.get(`/api/v1/tenants/${SLUG}/inquiries`);

		assertApiError(response, 405, "method_not_allowed");
		response.assertHeader("allow", "POST");
	});

	test("a success leaves no temp upload, not even a stray file field", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();

		const response = await postInquiry(client, SLUG, intakeFields(), [await png()]).file(
			"junk",
			Buffer.from("not an image"),
			{ filename: "junk.bin", contentType: "application/octet-stream" },
		);

		response.assertStatus(201);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("an unknown studio's 404 leaves no temp upload", async ({ client, assert }) => {
		const before = await tempUploads();

		const response = await postInquiry(client, "no-such-studio-td51", intakeFields(), [await png()]);

		assertApiError(response, 404, "not_found");
		assert.deepEqual(await newTempUploads(before), []);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=inquiries.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: FAIL: every request is TAT-32's 404 for a path no route has (the GET too, so no 405 yet). "An unknown studio's 404 leaves no temp upload" passes for now only because a router miss parses no body; Step 4 makes it fail.

- [ ] **Step 3: The controller and transformer**

Create `apps/platform/app/transformers/inquiry_receipt_transformer.ts`:

```ts
import { BaseTransformer } from "@adonisjs/core/transformers";
import type Inquiry from "#modules/inquiries/models/inquiry";

/**
 * What the public API says about an inquiry it just took (InquiryReceipt):
 * its id and nothing else, never what was sent, the client or the images.
 */
export default class InquiryReceiptTransformer extends BaseTransformer<Inquiry> {
	toObject() {
		return this.pick(this.resource, ["id"]);
	}
}
```

Create `apps/platform/app/controllers/public_inquiries_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import {
	InquiryRuleError,
	InvalidReferenceImageError,
} from "#modules/inquiries/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import IntakeService from "#modules/inquiries/services/intake_service";
import {
	ARTIST_MESSAGE,
	intakeValidator,
} from "#modules/inquiries/validators/intake";
import { ApiException } from "#services/public_api_errors";
import { discardUploads } from "#services/uploads";
import InquiryReceiptTransformer from "#transformers/inquiry_receipt_transformer";

/**
 * The public intake (createInquiry in openapi.yaml, TAT-51): one multipart
 * request with the fields and up to 5 reference images. The answer is only
 * the new inquiry's id, whether or not the phone was known.
 */
@inject()
export default class PublicInquiriesController {
	constructor(private intake: IntakeService) {}

	async store(ctx: HttpContext) {
		const { request, response } = ctx;
		const { tenant } = publicTenantContext(ctx);
		try {
			if (request.bodyType !== "multipart") {
				throw ApiException.of("unsupported_media_type");
			}
			const submission = await request.validateUsing(intakeValidator, {
				// request.files() is always a list, also for a single part.
				data: {
					...request.all(),
					referenceImages: request.files("referenceImages"),
				},
			});
			// TAT-55: the per-phone rate limit goes here (it needs the E.164
			// phone), before anything is stored.
			const inquiry = await this.intake.submit(tenant, submission);
			response.status(201);
			return await ctx.serialize(InquiryReceiptTransformer.transform(inquiry));
		} catch (error) {
			throw toApiError(error);
		} finally {
			await discardUploads(request);
		}
	}
}

/** The intake's refusals as the API answers them; any other error as it is. */
function toApiError(error: unknown) {
	if (error instanceof InvalidReferenceImageError) {
		return ApiException.of("validation_failed", {
			[`referenceImages.${error.index}`]: [error.message],
		});
	}
	if (!(error instanceof InquiryRuleError)) return error;
	switch (error.reason) {
		case "artist_unavailable":
			return ApiException.of("validation_failed", {
				preferredArtistId: [ARTIST_MESSAGE],
			});
		case "artist_not_accepting":
		case "studio_not_accepting":
		case "too_many_open_inquiries":
			return ApiException.of(error.reason);
		default:
			return error;
	}
}
```

- [ ] **Step 4: The route**

In `apps/platform/start/routes.ts`, inside TAT-32's `/tenants/:tenant` group, after the `.as("api.v1.studio");` statement, add:

```ts
				// TAT-55 adds its bot-challenge and honeypot middleware here
				// (.use(...), after publicTenant). POST stays no-store.
				router
					.post("/inquiries", [controllers.PublicInquiries, "store"])
					.as("api.v1.inquiries.store");
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` gains `PublicInquiries` and the `api.v1.inquiries.store` route.

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=inquiries.spec.ts`
Expected: everything passes except "an unknown studio's 404 leaves no temp upload": the route matches, so the body parser writes the file, `publicTenant` refuses the slug, and nothing deletes it. (`api_routes.spec.ts` would also fail now, on the route's missing isolation case: Step 6.)

- [ ] **Step 5: Failures before the controller drop their uploads too**

In `apps/platform/app/exceptions/handler.ts`, add `import { discardUploads } from "#services/uploads";` and replace

```ts
		if (isApiRequest(ctx)) return renderApiError(error, ctx);
```

with

```ts
		if (isApiRequest(ctx)) {
			// Anyone can upload to the API: a request that fails before its
			// controller (the body parser, an unknown or old slug) leaves temp
			// files no one else deletes (TAT-51).
			await discardUploads(ctx.request);
			return renderApiError(error, ctx);
		}
```

- [ ] **Step 6: The public isolation case, sent as multipart**

In `apps/platform/tests/isolation/public_cases.ts`, add to `PublicIsolationCase` after `body?`:

```ts
	/** How `body` is sent: JSON (the default) or multipart form fields. */
	encoding?: "json" | "multipart";
```

add the imports `import { intakeFields, intakeRows } from "#tests/helpers/intake";`, and append to `publicIsolationCases`:

```ts
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/inquiries",
		encoding: "multipart",
		// A's own artist and a returning client of A's: B must stay as it was.
		body: (own) =>
			intakeFields({
				preferredArtistId: own.artistProfile.id,
				contactPhone: own.client.phone ?? "",
			}),
		ownStatus: 201,
		// The answer is only the new inquiry's id; inquiries.spec.ts checks it landed in A.
		ownMarkers: () => [],
		snapshot: intakeRows,
	},
```

In `apps/platform/tests/helpers/public_isolation.ts`, replace `if (body) request.json(body);` with:

```ts
	if (body && isolationCase.encoding === "multipart") {
		request.fields(body as Record<string, string>);
	} else if (body) {
		request.json(body);
	}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=inquiries.spec.ts --files=public_api.spec.ts --files=api_routes.spec.ts --files=errors.spec.ts --files=public_tenant.spec.ts`
Expected: PASS: the route guard finds the new route's case, the isolation harness posts it as multipart under studio A and B stays unchanged, and TAT-32's error tests still pass.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors. (If `ctx.serialize` isn't awaitable or `request.bodyType` is untyped, match how TAT-32's `PublicStudioController` returns and read the bodyparser's type for `bodyType`.)

- [ ] **Step 8: Commit**

```bash
git -C <repo> add apps/platform/app/controllers/public_inquiries_controller.ts apps/platform/app/transformers/inquiry_receipt_transformer.ts apps/platform/start/routes.ts apps/platform/app/exceptions/handler.ts apps/platform/.adonisjs apps/platform/tests/helpers/intake.ts apps/platform/tests/isolation/public_cases.ts apps/platform/tests/helpers/public_isolation.ts apps/platform/tests/functional/api/inquiries.spec.ts
git -C <repo> commit -m "feat(platform): serve POST /api/v1/tenants/:tenant/inquiries

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10 (needs TAT-32): Refusals and upload limits over HTTP

**Files:**
- Test: `apps/platform/tests/functional/api/inquiry_refusals.spec.ts` (create)
- Modify only if a test fails for a real reason: the files of Tasks 6, 8 and 9

**Interfaces:**
- Consumes: `intakeFields`, `png`, `postInquiry` (Task 9), `tempUploads`, `newTempUploads`, `storedReferenceImages` (Task 4), `API_ERRORS` (Task 2), `ARTIST_MESSAGE` (Task 6), `IMAGE_FORMAT_MESSAGE`, `testImages`, `assertApiError`.

- [ ] **Step 1: Write the tests**

Create `apps/platform/tests/functional/api/inquiry_refusals.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import { ARTIST_MESSAGE } from "#modules/inquiries/validators/intake";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { API_ERRORS } from "#services/public_api_errors";
import { assertApiError } from "#tests/helpers/api";
import { testImages } from "#tests/helpers/images";
import { intakeFields, png, postInquiry, type Upload } from "#tests/helpers/intake";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, storedReferenceImages, tempUploads } from "#tests/helpers/uploads";

const SLUG = "intake-refuse-51";
const MB = 1024 * 1024;

const file = (name: string, type: string, data: Buffer): Upload => ({ name, type, data });

/** The studio got nothing: no client, no inquiry, no stored image. */
async function assertNothingSaved(assert: Assert, tenant: { id: string }) {
	const counts = await inTenant(tenant, async () => [
		(await Client.query()).length,
		(await Inquiry.query()).length,
	]);
	assert.deepEqual(counts, [0, 0], "no client or inquiry");
	assert.deepEqual(await storedReferenceImages(tenant), [], "no stored image");
}

test.group("Public API: POST /inquiries refusals", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("missing fields are each named", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, { note: "only this" });

		assertApiError(response, 422, "validation_failed");
		assert.sameMembers(Object.keys(response.body().error.fields), [
			"idea", "placement", "approximateSize", "preferredDates", "sourceChannel", "contactName", "contactPhone",
		]);
		await assertNothingSaved(assert, tenant);
	});

	test("a 4001-character idea and a NUL are field errors", async ({ client, assert }) => {
		await studioWithOwner(SLUG);

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ idea: "x".repeat(4001), placement: "Arm\u0000" }),
		);

		assertApiError(response, 422, "validation_failed");
		assert.deepEqual(response.body().error.fields, {
			idea: ["Use at most 4000 characters."],
			placement: ["Remove the unsupported characters."],
		});
	});

	test("an unknown or hidden artist is a field error on preferredArtistId", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const hidden = await inTenant(tenant, () =>
			Artist.create({ tenantId: tenant.id, name: "Hidden", slug: "hidden", visible: false }),
		);

		for (const artistId of ["0195f3a0-0000-7000-8000-000000000051", hidden.id]) {
			const response = await postInquiry(client, SLUG, intakeFields({ preferredArtistId: artistId }));
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(response.body().error.fields, { preferredArtistId: [ARTIST_MESSAGE] });
		}
		await assertNothingSaved(assert, tenant);
	});

	test("a closed artist, a closed studio and a full phone are 409s with their codes", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const sita = await inTenant(tenant, () =>
			Artist.create({ tenantId: tenant.id, name: "Sita", slug: "sita", acceptingInquiries: false }),
		);

		const closedArtist = await postInquiry(client, SLUG, intakeFields({ preferredArtistId: sita.id }));
		const closedStudio = await postInquiry(client, SLUG, intakeFields());
		await inTenant(tenant, () => Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" }));
		await inTenant(tenant, async () => {
			const maya = await makeClient(tenant, { phone: "+9779812345678" });
			for (let i = 0; i < 3; i++) await makeInquiry(tenant, maya);
		});
		const fullPhone = await postInquiry(client, SLUG, intakeFields(), [await png()]);

		for (const [response, code] of [
			[closedArtist, "artist_not_accepting"],
			[closedStudio, "studio_not_accepting"],
			[fullPhone, "too_many_open_inquiries"],
		] as const) {
			assertApiError(response, 409, code);
			assert.equal(response.body().error.message, API_ERRORS[code].message, code);
		}
		assert.deepEqual(await storedReferenceImages(tenant), []);
	});

	test("six images are too many", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();
		const six: Upload[] = [];
		for (let i = 0; i < 6; i++) six.push(await png(`ref-${i}.png`));

		const response = await postInquiry(client, SLUG, intakeFields(), six);

		assertApiError(response, 422, "validation_failed");
		assert.deepEqual(response.body().error.fields, { referenceImages: ["Attach up to 5 images."] });
		await assertNothingSaved(assert, tenant);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("an image over 10 MB is a field error; over 20 MB in all is 413", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		const big = await postInquiry(client, SLUG, intakeFields(), [
			file("big.png", "image/png", Buffer.alloc(10 * MB + 1)),
		]);
		const huge = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
			file("huge.png", "image/png", Buffer.alloc(21 * MB)),
		]);

		assertApiError(big, 422, "validation_failed");
		assert.deepEqual(big.body().error.fields, { "referenceImages.0": ["Use images of 10 MB or less."] });
		assertApiError(huge, 413, "payload_too_large");
		await assertNothingSaved(assert, tenant);
		assert.deepEqual(await newTempUploads(before), [], "the parser's temp files are gone too");
	});

	test("a GIF, a HEIF file and a text file sent as image/png are field errors, and nothing is stored", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		const gif = await postInquiry(client, SLUG, intakeFields(), [file("moving.gif", "image/gif", await testImages.gif())]);
		const heif = await postInquiry(client, SLUG, intakeFields(), [file("photo.heic", "image/heic", await testImages.heif())]);
		const disguised = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
			file("innocent.png", "image/png", Buffer.from("<?php echo 'hi'; ?>")),
		]);

		for (const response of [gif, heif]) {
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(response.body().error.fields, { "referenceImages.0": [IMAGE_FORMAT_MESSAGE] });
		}
		assertApiError(disguised, 422, "validation_failed");
		assert.deepEqual(disguised.body().error.fields, { "referenceImages.1": [IMAGE_FORMAT_MESSAGE] });
		await assertNothingSaved(assert, tenant);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a truncated body is bad_request", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client
			.post(`/api/v1/tenants/${SLUG}/inquiries`)
			.unsafeJson('--td51\r\nContent-Disposition: form-data; name="idea"\r\n\r\nA peony')
			.type("multipart/form-data; boundary=td51");

		assertApiError(response, 400, "bad_request");
	});

	test("more than 2 MB of text is 413", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, intakeFields({ idea: "x".repeat(2_200_000) }));

		assertApiError(response, 413, "payload_too_large");
	});
});
```

- [ ] **Step 2: Run them**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=inquiry_refusals.spec.ts`
Expected: PASS. These pin behavior Tasks 6, 8 and 9 built; a failure is a real gap, so fix the code, not the test, except in these known cases:
- "a truncated body": if `.type(...)` doesn't override the JSON content type, set it with `.header("content-type", "multipart/form-data; boundary=td51")` after `unsafeJson`; if Japa still sends JSON, send the raw body with Node's `fetch` to `http://${process.env.HOST}:${process.env.PORT}/api/v1/tenants/${SLUG}/inquiries` and assert the status and `error.code` from its JSON.
- "a HEIF file": if the parser can't tell the type, the message still comes from `ImageService` (the same `IMAGE_FORMAT_MESSAGE`); only the path differs. Keep the assertion.
- "the parser's temp files are gone too" after a 413: if a temp file remains, it is the half-written part; the parser deletes it after the response. Wait for it with a short poll (up to 1 s via `setImmediate` loops), and say so in a comment; do not drop the assertion.

- [ ] **Step 3: Commit**

```bash
git -C <repo> add apps/platform/tests/functional/api/inquiry_refusals.spec.ts
git -C <repo> commit -m "test(platform): pin the intake's refusals and upload limits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(If a code fix was needed, commit it first as `fix(platform): …` with the test that found it.)

---

### Task 11 (needs TAT-32): Isolation, old slugs and CORS

**Files:**
- Test: `apps/platform/tests/functional/api/inquiry_isolation.spec.ts` (create)

**Interfaces:**
- Consumes: `twoStudios()` (`#tests/helpers/tenants`), `intakeFields`, `png`, `postInquiry`, `intakeRows` (Task 9), `tempUploads`, `newTempUploads`, `storedReferenceImages` (Task 4), `TenancyService.changeSlug`, `assertApiError`, `assertNoCookies`.

- [ ] **Step 1: Write the tests**

Create `apps/platform/tests/functional/api/inquiry_isolation.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import { ARTIST_MESSAGE } from "#modules/inquiries/validators/intake";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { assertApiError, assertNoCookies } from "#tests/helpers/api";
import { intakeFields, intakeRows, png, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner, twoStudios } from "#tests/helpers/tenants";
import { newTempUploads, storedReferenceImages, tempUploads } from "#tests/helpers/uploads";

const ORIGIN = "https://intake-needle-51.tattoodrip.com";

test.group("Public API: POST /inquiries across studios", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under A, B's artist is a field error and nothing is written in either studio", async ({ client, assert }) => {
		const { a, b } = await twoStudios();
		const [beforeA, beforeB] = [await intakeRows(a), await intakeRows(b)];

		const response = await postInquiry(
			client,
			a.tenant.slug,
			intakeFields({ preferredArtistId: b.artistProfile.id }),
			[await png()],
		);

		assertApiError(response, 422, "validation_failed");
		assert.deepEqual(response.body().error.fields, { preferredArtistId: [ARTIST_MESSAGE] });
		assert.deepEqual(await intakeRows(a), beforeA);
		assert.deepEqual(await intakeRows(b), beforeB);
		assert.deepEqual(await storedReferenceImages(a.tenant), []);
	});

	test("B's client's phone makes a new client in A and leaves B unchanged", async ({ client, assert }) => {
		const { a, b } = await twoStudios();
		const beforeB = await intakeRows(b);
		const phone = b.client.phone ?? "";

		const response = await postInquiry(client, a.tenant.slug, intakeFields({ contactPhone: phone }));

		response.assertStatus(201);
		const ours = await inTenant(a.tenant, () => Client.query().where("phone", phone));
		assert.lengthOf(ours, 1);
		assert.notEqual(ours[0].id, b.client.id);
		assert.equal(ours[0].tenantId, a.tenant.id);
		assert.deepEqual(await intakeRows(b), beforeB);
	});

	test("a signed-in owner of B posting to A runs as no one, sets no cookie, and the inquiry lands in A", async ({ client, assert }) => {
		const { a, b } = await twoStudios();
		const beforeB = await intakeRows(b);
		const countIn = (studio: typeof a) => inTenant(studio.tenant, async () => (await Inquiry.query()).length);
		const beforeA = await countIn(a);

		const response = await postInquiry(client, a.tenant.slug, intakeFields()).loginAs(b.owner);

		response.assertStatus(201);
		assertNoCookies(response);
		assert.equal(await countIn(a), beforeA + 1);
		assert.deepEqual(await intakeRows(b), beforeB);
	});

	test("an old slug is a 404, even with an invalid body, with nothing written and no temp upload", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("intake-needle-51");
		await inTenant(tenant, () => new TenancyService().changeSlug(tenant, "intake-red-51"));
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const valid = await postInquiry(client, "intake-needle-51", intakeFields(), [await png()]);
		const invalid = await postInquiry(client, "intake-needle-51", { idea: "" }, [await png()]);

		for (const response of [valid, invalid]) {
			assertApiError(response, 404, "not_found");
			assert.deepEqual(response.body(), { error: { code: "not_found", message: "Not found." } });
		}
		assert.deepEqual(await intakeRows({ tenant }), rows);
		assert.deepEqual(await newTempUploads(before), []);
		// The current slug takes it.
		(await postInquiry(client, "intake-red-51", intakeFields())).assertStatus(201);
	});

	test("CORS: a multipart POST from another origin is readable, and its preflight passes", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("intake-needle-51");

		const post = await postInquiry(client, tenant.slug, intakeFields()).header("origin", ORIGIN);
		const preflight = await client
			.options(`/api/v1/tenants/${tenant.slug}/inquiries`)
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST")
			.header("access-control-request-headers", "content-type");

		post.assertStatus(201);
		post.assertHeader("access-control-allow-origin", "*");
		assert.isUndefined(post.header("access-control-allow-credentials"));
		preflight.assertStatus(204);
		preflight.assertHeader("access-control-allow-origin", "*");
		preflight.assertHeader("access-control-allow-methods", "GET,HEAD,POST");
		preflight.assertHeader("access-control-allow-headers", "accept,content-type");
		assert.isUndefined(preflight.header("access-control-allow-credentials"));
		assertNoCookies(preflight);
	});
});
```

- [ ] **Step 2: Run them**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=inquiry_isolation.spec.ts`
Expected: PASS. A failure here is a tenant-isolation or TAT-32 contract bug: fix the code, never weaken the test. (`changeSlug`'s real signature is TAT-24's `changeSlug(tenant, slug)`; if the preconditions showed another, follow it.)

- [ ] **Step 3: Commit**

```bash
git -C <repo> add apps/platform/tests/functional/api/inquiry_isolation.spec.ts
git -C <repo> commit -m "test(platform): prove intake isolation, old slugs and CORS

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12 (needs TAT-32's docs): Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/jobs-and-email.md`, `apps/platform/docs/testing.md`, `docs/sdk.md`, `docs/requirements.md`, `docs/architecture.md`, `packages/AGENTS.md`

- [ ] **Step 1: Backend conventions** (`apps/platform/docs/backend.md`)

- In the Images bullet, append: "Decoding is the costly part: at most `MAX_CONCURRENT_DECODES` (2) images decode at once per process (`limitConcurrency` in `#modules/media/concurrency`; the format sniff runs before the wait), and sharp's cache is off (TAT-51: the first anonymous uploads). The body parser writes every upload to a temp file before route code runs, and nothing else removes one that isn't stored: public API requests end with `discardUploads(request)` (`#services/uploads`), in the exception handler for failures and in the controller's `finally` for successes."
- In the Artists bullet, replace "`list(tenant)` (by name), `findFor(tenant, id)`" with "`list(tenant)` (by name), `listVisible(tenant)` (live and visible, by name: what an inquiry may name, TAT-51), `findFor(tenant, id)`".
- In the "Clients, inquiries and projects (TAT-37 …)" bullet, replace "(the Inquiries bullet below; intake is TAT-51)" with "(the Inquiries and Intake bullets below)".
- In the Clients (TAT-41) bullet, after "`create` (a booking's new client, TAT-43; `ClientRuleError` `phone_taken` from the same index)," insert "`matchByPhone(tenant, contact)` (intake, TAT-51: the live client with that phone, locked until the transaction ends, else a new one; never changes a found client, an anonymized one included; the loser of a race for a new phone gets the winner's client),". Replace "Only an owner's edit changes a client: intake records what was submitted on the inquiry's frozen copy." with "Only an owner's edit changes a client: intake records what was submitted on the inquiry's frozen copy. TAT-42 must null an anonymized client's phone, or intake keeps attaching new inquiries to it."
- After the "Inquiries (TAT-46)" bullet, add:

```markdown
- Intake (TAT-51): `POST /api/v1/tenants/:tenant/inquiries` (`PublicInquiriesController.store`, `api.v1.inquiries.store`) takes `multipart/form-data` only (anything else is 415), validates with `intakeValidator` (`#modules/inquiries/validators/intake`: the inquiry columns' lengths, NUL refused, the phone to E.164, up to `MAX_REFERENCE_IMAGES` (5) `imageFile()` uploads from `request.files("referenceImages")`; `challengeToken` is taken and ignored until TAT-55) and calls `IntakeService.submit(tenant, submission)` (`#modules/inquiries/services/intake_service`). In one transaction it checks the artist (one of `listVisible`, else `InquiryRuleError` `artist_unavailable`, answered as a `preferredArtistId` field error; closed: `artist_not_accepting`; no artist chosen while every visible one is closed: `studio_not_accepting`), matches the client (`ClientService.matchByPhone`), refuses a phone that already has `OPEN_INQUIRY_LIMIT` (3) open inquiries (live, `new`, that `contact_phone`) with `too_many_open_inquiries`, counted under the client's lock, stores each image (`reference_image`, its `afterRollback` cleanup right after; a bad one is `InvalidReferenceImageError` with its index, answered on `referenceImages.<index>`), inserts the inquiry with the submitted contact copy and its reference rows by `position`, and queues `NewInquiryAlertJob` ([jobs](jobs-and-email.md)). Every refusal comes before any image is decoded. The answer is `{ data: { id } }` whatever the phone, so it never tells whether the phone was known; only the cap's 409 depends on it. TAT-55's per-phone limit goes in the controller where its comment says; its challenge and honeypot are route middleware on `api.v1.inquiries.store`.
```

- In the Public API section's "A new endpoint" bullet, append: "An endpoint's own codes go in `API_ERRORS` (`#services/public_api_errors`, status and message) and are thrown with `ApiException.of(code)`; list them in the operation and in `ErrorResponse`. An upload endpoint is multipart only, validates files with `imageFile()`, stores them through `ImageService` and ends with `discardUploads(request)` in a `finally`; its public isolation case sets `encoding: \"multipart\"`."

- [ ] **Step 2: Jobs** (`apps/platform/docs/jobs-and-email.md`)

After the "Quote expiry (TAT-64, TAT-83)" bullet, add:

```markdown
- New-inquiry alerts (TAT-51): `IntakeService.submit` queues `NewInquiryAlertJob { tenantId, inquiryId }` (`#modules/inquiries/jobs/new_inquiry_alert_job`) in the inquiry's transaction, so it exists exactly when the inquiry does. For now it only logs "New inquiry received." with the two ids for an inquiry that is still `new` (nothing for one that is gone or decided); no email, SMS or in-app notification goes out yet. TAT-52 sends the owners' and the preferred artist's alerts from its `handle()`.
```

- [ ] **Step 3: Testing** (`apps/platform/docs/testing.md`)

- In the bullet about `tests/isolation/public_cases.ts` (TAT-32's), append: "A write case that takes multipart sets `encoding: \"multipart\"`, and its body is sent as form fields."
- Append to the list under `## Environment and test conventions`:

```markdown
- Uploads in tests: the body parser writes them to `tmp/storage/uploads` (`config/bodyparser.ts`; `tests/bootstrap.ts` makes and clears it). `tempUploads()` / `newTempUploads(before)` from `#tests/helpers/uploads` check that a request left no temp file, and `storedReferenceImages(tenant)` lists a studio's stored reference files. `#tests/helpers/intake` builds intake requests (`intakeFields`, `png`, `postInquiry`) and reads what an intake can change (`intakeRows`).
```

- [ ] **Step 4: SDK** (`docs/sdk.md`)

- Delete the note paragraph that starts "> The current `openapi.yaml` and SDK code still use the earlier booking draft".
- At the end of the Core SDK paragraph (after "a 2xx without `{ data }` is `invalid_response`."), add: " `inquiries.create` uploads, so it waits up to 2 minutes unless its own `{ timeoutMs }` says otherwise."
- Replace the `client.inquiries.create({ … })` call in the example with:

```ts
  await client.inquiries.create({
    idea: "Fine line peony on the forearm",
    placement: "Left forearm",
    approximateSize: "About 10 cm",
    preferredDates: "Any weekday in November",
    preferredArtistId: artists[0]?.id,                  // optional; a visible artist who takes inquiries
    sourceChannel: "instagram",
    contactName: "Ana",
    contactPhone: "9812345678",                         // stored as +9779812345678
    referenceImages: [file],                            // up to 5; sent as one multipart request
    challengeToken,                                     // TAT-55; ignored until then
  });
```

- In the React section, after `const createInquiry = useCreateInquiry();` and its code block, add: "`useCreateInquiry()` never retries: a retry after a timeout could send the inquiry twice."
- In the "Envelopes and codes" bullet, replace "; an endpoint may add its own, listed in `openapi.yaml`." with "; `createInquiry` adds `artist_not_accepting`, `studio_not_accepting` and `too_many_open_inquiries` (409); every code is listed in `openapi.yaml`."

- [ ] **Step 5: Requirements, architecture, packages**

In `docs/requirements.md`, Intake:
- replace "up to 5 reference images (10 MB each; JPEG, PNG, WebP or HEIC)" with "up to 5 reference images (JPEG, PNG or WebP, 10 MB each and 20 MB together; phones convert HEIC photos when the form asks for these)";
- after the line "- [ ] After submitting, the customer is told the studio will reply on WhatsApp or Viber", add: "- An inquiry finds the studio's client by phone, or creates one; a returning client's details never change, and the inquiry keeps what was sent. A phone number has at most 3 open (unanswered) inquiries per studio. An artist who isn't accepting inquiries can't be chosen, and a studio whose visible artists are all closed takes none."

(No box is ticked: the form is TAT-57's and the alerts TAT-52's.)

In `docs/architecture.md`:
- replace "  - HEIC is rejected for now: sharp's prebuilt binaries can't decode it, and iPhone browsers usually upload JPEG. TAT-51 adds a decoder if reference images need one." with "  - HEIC is not decoded (TAT-51): the intake form asks for JPEG, PNG or WebP, which iPhones convert their photos to, and a HEVC decoder would mean a custom libvips build or a WASM decoder running on hostile input.";
- in the Intake request flow, replace "4. A job alerts the studio's staff by email and in the app." with "4. A job alerts the studio's staff by email and in the app (queued with the inquiry since TAT-51; the alerts themselves are TAT-52).";
- replace "The contract's booking-to-inquiry transition is documented in [SDK: Public API by stage](sdk.md#public-api-by-stage)." with "What each stage of the contract exposes is in [SDK: Public API by stage](sdk.md#public-api-by-stage); V1 operations are tagged `V1` in `openapi.yaml`."

In `packages/AGENTS.md`, replace "Before API changes, read [SDK guidance](../docs/sdk.md#public-api-by-stage): the booking draft must move to inquiries." with "Before API changes, read [SDK guidance](../docs/sdk.md#public-api-by-stage) (what each stage exposes; V1 operations are tagged `V1` in the contract)."

`docs/README.md` needs no change: `rg -n '^## Public API by stage' <repo>/docs/sdk.md` still prints the heading the links point to.

- [ ] **Step 6: Check and commit**

Run: `rg -n 'booking draft|or HEIC|useCreateBooking|createBooking' <repo>/docs <repo>/apps/platform/docs <repo>/packages --glob '!**/superpowers/**' --glob '!*.gen.ts'`
Expected: nothing.

Run: `pnpm -C <repo> exec biome check docs apps/platform/docs packages/AGENTS.md`
Expected: no errors.

```bash
git -C <repo> add apps/platform/docs docs/sdk.md docs/requirements.md docs/architecture.md packages/AGENTS.md
git -C <repo> commit -m "docs(platform): document public intake and its alert job

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Final verification

- [ ] **Step 1: Generated files are current, no migration**

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate && git -C <repo> diff --exit-code packages/types/src/openapi.gen.ts`
Run: `pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> diff --exit-code apps/platform/.adonisjs`
Run: `git -C <repo> diff --stat $(git -C <repo> rev-parse harublank00/tat-32-api-foundation-apiv1-tenant-by-path-error-envelope-cors)..HEAD -- apps/platform/database`
Expected: no diff, no diff, and nothing listed.

- [ ] **Step 2: All suites**

Run in the background: `PORT=3402 timeout 600 pnpm -C <repo>/apps/platform test > <scratchpad>/full.log 2>&1`
Expected: the log's `Tests` line shows every test passed (TAT-32 ended at 989; this adds about 75).

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: PASS, 17 tests (TAT-32's 11 plus 6).

- [ ] **Step 3: Root gates**

Run: `pnpm -C <repo> check`, `pnpm -C <repo> typecheck`, `pnpm -C <repo> build`
Expected: all clean.

- [ ] **Step 4 (optional): See it**

Start a dev server on 3401 (`PORT=3401 pnpm -C <repo>/apps/platform dev`, in the background) and, with a dev studio's current slug and any PNG on disk:
`curl -si -F idea='A peony' -F placement=Forearm -F approximateSize='10 cm' -F preferredDates=November -F sourceChannel=instagram -F contactName=Ana -F contactPhone=9812345678 -F referenceImages=@<a png> http://localhost:3401/api/v1/tenants/<slug>/inquiries`
Expected: `201`, `{"data":{"id":"…"}}`, `cache-control: no-store`, `access-control-allow-origin: *`, no `set-cookie`; the inquiry shows in that studio's Inbox; `pnpm -C <repo>/apps/platform worker` (if started) logs "New inquiry received." Stop each process by its exact PID (`pgrep -af "ace serve"`, `pgrep -af "queue:work"`, then `kill <pid>`).

- [ ] **Step 5: PR text**

Write `<scratchpad>/pr2-tat-51.md` (not committed): a few "what and why" bullets per change (contract and SDK, the endpoint, matching and the cap, images and temp cleanup, decode limit, the alert job, isolation tests, docs); the rulings the user may want to overrule (spec rulings 2, 4, 8, 13 and 16); deviations from this plan; "Closes TAT-68 (the deposit endpoints move to TAT-65)"; the carry-forward comments to post (spec, "Carry-forwards"); and: "Before any public deploy: TAT-38 (rate limits; each request holds a pooled connection, also while it waits for a decode slot), TAT-55 (bot challenge, honeypot, per-phone limit) and TAT-27 (R2; the local disks must never deploy)."
