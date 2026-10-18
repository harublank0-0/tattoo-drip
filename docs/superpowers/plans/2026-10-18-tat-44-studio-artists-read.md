# Read endpoints (MVP): studio profile and artists (TAT-44) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `getStudio` returns the studio's whole public profile, and `listArtists` / `getArtist` return its visible artists, each a cached, tenant-scoped read whose fields are an explicit allow-list.

**Architecture:** The contract first (`openapi.yaml`: `Studio`, `Artist`, `Image`, `SocialLink` with every property required and no extra ones; `listArtists`, `getArtist` with cache headers), then the SDK and React tests against the generated types. On the platform, a pure rule (`studioTakesInquiries`, shared with intake), a slug lookup on `ArtistService`, and a `StudioPageService` in a new `storefront` module build typed sources that two transformers write out field by field. Routes join TAT-32's `/api/v1/tenants/:tenant` group with `publicCache()` and a public isolation case each.

**Tech Stack:** AdonisJS 7 (router, transformers, `@inject()`), Lucid, Japa (`@japa/api-client`, `@japa/assert`), OpenAPI 3.1 with `openapi-typescript`, `@tattoo-drip/sdk` and `@tattoo-drip/react` (`node:test` with `tsx`, TanStack Query 5), TypeScript 6, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-44-studio-artists-read-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- **No migration.** Never edit `apps/platform/database/schema.ts`, `packages/types/src/openapi.gen.ts` or `apps/platform/.adonisjs/` by hand: regenerate with `pnpm --filter @tattoo-drip/types generate` and `pnpm -C apps/platform exec node ace codegen`, and commit what they write.
- Public fields, verbatim. `Studio`: `slug`, `name`, `type`, `intro`, `timezone`, `contact` (`phone`, `email`, `address`), `socialLinks` (items `platform`, `url`), `acceptingInquiries`. `Artist`: `id`, `slug`, `name`, `bio`, `photo` (`url`, `width`, `height`, or null), `acceptingInquiries`, `closedMessage`. Nothing else, ever: no tenant id field, no `depositPolicy`, `defaultDepositPercent`, payment methods, QR codes, members, emails of members, user ids, `visible`, `photoKey`, timestamps, clients, inquiries, projects, quotes or payments.
- Social links: order `instagram`, `facebook`, `tiktok`, `website`; only set values that start with `https://` and parse as an `https:` URL; the stored string is sent as is.
- `closedMessage` is `null` whenever `acceptingInquiries` is true.
- The studio's `acceptingInquiries` is `studioTakesInquiries(visible)`: `visible.length === 0 || visible.some((artist) => artist.acceptingInquiries)`. Intake uses the same function.
- Route names: `api.v1.studio` (exists), `api.v1.artists.index`, `api.v1.artists.show`; `:artist` uses `.where("artist", ARTIST_SLUG)`; all three `.use(middleware.publicCache())`.
- `packages/sdk` imports no framework; `packages/*` never import `apps/*`; the storefront never imports the platform. Touch `apps/storefront` only in Task 1 Step 7 (test fixtures), never its `src/`.
- New test slugs end in `-44` (the dev database shares the slug registry). An "unknown studio" slug is one no dev studio has (`no-such-studio-td44`).
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26. Commands run from the repository root (this worktree). Platform tests use `PORT=3402` (3333 is taken). `<scratchpad>` is the session's scratchpad directory; logs go there, never `/tmp`. Never `sh -c`, never `pkill -f`.
- A spec that imports a missing module makes Japa hang: RED runs use `timeout 90` and a log file; exit 124 plus "Cannot find module" is that RED. Read the log's `Tests N passed` / `failed` line, not the wrapper's exit code.
- `@inject()` dependencies are value imports with the comment `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with an area scope (`types`, `sdk`, `react`, `platform`, `storefront`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line of your own session's reminder). Never push, never open a PR.

## Review Focus

1. A slug that differs only by case, a trailing character or a dot (`Zara`, `zara%20`, `zara.json`, `-zara`) must be the same 404 as an unknown one, never another artist and never a 500. Test: Task 7 "a hidden, deleted, unknown, malformed or differently cased slug is the same 404".
2. A social link stored outside the validator (`javascript:`, `http:`, a leading space, a bare host) must never reach `socialLinks`. Tests: Task 5 "leaves out anything that isn't an https URL", Task 6 "a link that isn't https is left out".
3. An artist who reopened but kept an old closed message must show `closedMessage: null`. Tests: Task 5 "a closed message only while closed", Task 7 "lists the visible artists by name".
4. A studio with no visible artist must list `[]` and still say `acceptingInquiries: true`, as intake takes its general inquiries. Tests: Task 3, Task 5 "takes inquiries with no visible artist…", Task 7 "a studio with no visible artist answers an empty list".
5. A renamed artist's old slug must be a 404, a reused slug must show the new profile, and a profile linked to a member must never show that member. Tests: Task 7 "a renamed artist's old slug is a 404…", Task 8 canary test.

---

## Task 0: Preconditions

- [ ] **Step 1: The base has the built public API chain.** This branch was designed on a2484f4 (designs only). Run:

```bash
rg -n "export function publicTenantContext" apps/platform/app/middleware/public_tenant_middleware.ts
rg -n "export default class PublicCacheMiddleware" apps/platform/app/middleware/public_cache_middleware.ts
rg -n "static notFound" apps/platform/app/services/public_api_errors.ts
rg -n "export function (assertApiData|assertApiError|assertApiHeaders|assertNoCookies)" apps/platform/tests/helpers/api.ts
rg -n "deposits/:token" apps/platform/tests/isolation/public_cases.ts
rg -n "export function publicMarkers" apps/platform/tests/helpers/public_isolation.ts
rg -n "async listVisible" apps/platform/app/modules/artists/services/artist_service.ts
rg -n "visible.every" apps/platform/app/modules/inquiries/services/intake_service.ts
rg -n "export type TenantProfile" apps/platform/app/modules/tenancy/services/tenancy_service.ts
rg -n "export const ARTIST_SLUG" apps/platform/app/modules/artists/validators/artist.ts
rg -n "closedPaidProject" apps/platform/tests/helpers/tenants.ts
rg -n "export function (uploadOf)|export const testImages" apps/platform/tests/helpers/images.ts
ls apps/platform/app/modules/payments/services/payment_service.ts packages/react/test/deposit.test.ts apps/platform/app/controllers/public_studio_controller.ts
rg -n "studio: \{|artists: \{" packages/sdk/src/client.ts
rg -n "artist: \(client: TattooClient, slug: string\)" packages/react/src/queries.ts
```

Expected: every pattern found and every file listed. If anything is missing, STOP: the branch must first be rebased onto the public API chain's built tip (TAT-24, 32, 51, 65, 66), or onto TAT-23's built tip, which sits on it; that is the coordinator's call, and only the spec and plan commit sits on top. If a review renamed one of these, use the real name everywhere below.

- [ ] **Step 2: Is TAT-12/23's storefront in the base?** Run `ls apps/storefront/test/tenancy/helpers.ts`. Note the answer: if the file exists, Task 1 Step 7 applies; otherwise skip that step.

- [ ] **Step 3: Clean tree and Node.** `git status -sb` shows no changes; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`. Note `git rev-parse HEAD` as `<base>` (Task 10 compares against it).

- [ ] **Step 4: Baselines.** Run the full platform suite in the background (about 2 to 3 minutes) and the package tests:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C apps/platform test > <scratchpad>/t44-baseline.log 2>&1
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test
```

Expected: the log ends with `Tests N passed` and no failures (note N); `# fail 0` in the SDK and React runs. If the storefront is in the base, also run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test` and expect `# fail 0`.

---

### Task 1: The contract describes the three reads; the SDK follows

**Files:**
- Modify: `packages/types/openapi.yaml`
- Regenerate: `packages/types/src/openapi.gen.ts`
- Modify: `packages/sdk/src/client.ts` (doc comments only)
- Test: `packages/sdk/test/client.test.ts`
- Maybe modify: `apps/storefront/test/tenancy/helpers.ts` and the storefront tests that type a partial `Studio` (Step 7)

**Interfaces:**
- Consumes: `createTattooClient`, `TattooApiError` and the test helpers `fakeFetch`, `json`, `client`, `rejection` already in `client.test.ts`.
- Produces: generated `components["schemas"]["Studio"]` = `{ slug: string; name: string; type: "studio" | "independent"; intro: string | null; timezone: string; contact: { phone: string | null; email: string | null; address: string | null }; socialLinks: SocialLink[]; acceptingInquiries: boolean }`; `Artist` = `{ id: string; slug: string; name: string; bio: string | null; photo: Image | null; acceptingInquiries: boolean; closedMessage: string | null }`; `Image` = `{ url: string; width: number; height: number; alt?: string | null }`; `SocialLink` = `{ platform: string; url: string }`. Re-exported unchanged by `@tattoo-drip/types` and `@tattoo-drip/sdk`.

- [ ] **Step 1: Write the failing test (typed fixtures)**

In `packages/sdk/test/client.test.ts`, add `type Artist` and `type Studio` to the import from `"../src/index.js"`, then append:

```ts
describe("studio and artists", () => {
	const STUDIO: Studio = {
		slug: "api-needle-32",
		name: "Black Needle",
		type: "studio",
		intro: "Fine line and blackwork.",
		timezone: "Asia/Kathmandu",
		contact: {
			phone: "+9779812345678",
			email: "hello@black-needle.example",
			address: "Thamel Marg\nKathmandu",
		},
		socialLinks: [
			{ platform: "instagram", url: "https://instagram.com/blackneedle" },
		],
		acceptingInquiries: true,
	};
	const ARTIST: Artist = {
		id: "0199f000-0000-7000-8000-000000000044",
		slug: "sita",
		name: "Sita Rai",
		bio: null,
		photo: {
			url: "https://api.example.com/uploads/tenants/t/artist_photo/p.png",
			width: 300,
			height: 200,
		},
		acceptingInquiries: false,
		closedMessage: "Books open in March.",
	};

	test("studio.get returns the whole profile", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));

		assert.deepEqual(await client(fetch).studio.get(), STUDIO);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32",
		);
	});

	test("artists.list reads the tenant's artists and unwraps the list", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [ARTIST] }));

		assert.deepEqual(await client(fetch).artists.list(), [ARTIST]);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32/artists",
		);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("artists.get reads one artist by its slug, encoded", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: ARTIST }));

		assert.deepEqual(await client(fetch).artists.get("sita"), ARTIST);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32/artists/sita",
		);
		await client(fetch).artists.get("a/b c");
		assert.match(calls[1].url, /\/artists\/a%2Fb%20c$/);
	});

	test("an artist that isn't there is a 404 TattooApiError", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		const error = await rejection(client(fetch).artists.get("nobody"));

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 404);
		assert.equal(error.code, "not_found");
	});
});
```

- [ ] **Step 2: Run the typecheck to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk typecheck`
Expected: FAIL in `test/client.test.ts`: the draft `Studio` has no `intro` or `acceptingInquiries` and a non-null `contact.email`; the draft `Artist` has no `acceptingInquiries` and requires `acceptingRequests` and `serviceIds`.

- [ ] **Step 3: Edit the contract: the three paths**

In `packages/types/openapi.yaml`, replace everything from the line `  /tenants/{tenant}:` up to (not including) the line `  /tenants/{tenant}/services:` with:

```yaml
  /tenants/{tenant}:
    parameters:
      - $ref: "#/components/parameters/Tenant"
    get:
      operationId: getStudio
      tags: [MVP]
      summary: The studio's public profile
      description: |
        What the studio page shows about the studio: its name, intro,
        contact details, links, timezone and whether it takes inquiries
        (TAT-44). Never its deposit policy, payment details, members or
        anything about clients, inquiries or payments. Cacheable. Under an
        old slug it answers like under the current one, and `slug` is the
        current slug.
      responses:
        "200":
          description: Studio
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { $ref: "#/components/schemas/Studio" }
        "304": { $ref: "#/components/responses/NotModified" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }

  /tenants/{tenant}/artists:
    parameters:
      - $ref: "#/components/parameters/Tenant"
    get:
      operationId: listArtists
      tags: [MVP]
      summary: The studio's visible artists
      description: |
        Every visible artist, by name (ignoring case); hidden and deleted
        artists never appear, and a studio with no visible artist answers
        an empty list. Cacheable. Under an old slug it answers like under
        the current one.
      responses:
        "200":
          description: Artists
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { type: array, items: { $ref: "#/components/schemas/Artist" } }
        "304": { $ref: "#/components/responses/NotModified" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }

  /tenants/{tenant}/artists/{artist}:
    parameters:
      - $ref: "#/components/parameters/Tenant"
      - $ref: "#/components/parameters/ArtistSlug"
    get:
      operationId: getArtist
      tags: [MVP]
      summary: One visible artist, by slug
      description: |
        A hidden, deleted or unknown artist, another studio's, and an
        artist's old slug are the same 404 (`not_found`). Cacheable. Under
        an old studio slug it answers like under the current one.
      responses:
        "200":
          description: Artist
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { $ref: "#/components/schemas/Artist" }
        "304": { $ref: "#/components/responses/NotModified" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }

```

- [ ] **Step 4: Edit the contract: the artist slug parameter**

In `components.parameters`, after the `DepositToken` parameter (its last line is `        pattern: "^[A-Za-z0-9_-]{43}$"`) and before `  headers:`, add:

```yaml
    ArtistSlug:
      name: artist
      in: path
      required: true
      description: |
        The artist's slug, matched exactly: never case-folded. An artist's
        old slug is not kept: after a change it is a 404.
      schema:
        type: string
        minLength: 2
        maxLength: 63
        pattern: "^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$"
```

- [ ] **Step 5: Edit the contract: the schemas**

In `components.schemas`, replace everything from the line `    Image:` up to (not including) the line `    Service:` with:

```yaml
    Image:
      type: object
      required: [url, width, height]
      additionalProperties: false
      properties:
        url:
          type: string
          format: uri
          description: Public and absolute.
        width: { type: integer, minimum: 1 }
        height: { type: integer, minimum: 1 }
        alt: { type: [string, "null"] }

    Money:
      type: object
      required: [amount, currency]
      properties:
        amount: { type: integer, description: Minor units (cents) }
        currency: { type: string, description: ISO 4217 code, examples: [USD] }

    SocialLink:
      type: object
      required: [platform, url]
      additionalProperties: false
      properties:
        platform:
          type: string
          description: |
            `instagram`, `facebook`, `tiktok` or `website` today. Show any
            other value as a plain link.
          examples: [instagram]
        url:
          type: string
          format: uri
          description: An https URL.

    StorefrontSection:
      description: V1 (TAT-54). Not served yet.
      type: object
      required: [type, props]
      properties:
        type: { type: string, examples: [hero, portfolio, services] }
        props: { type: object, additionalProperties: true }

    StorefrontConfiguration:
      description: |
        V1 (TAT-54). Not served yet: `Studio` gains it as `storefront` with
        themes and branding.
      type: object
      required: [theme, branding, sections]
      properties:
        theme: { type: string, examples: [classic] }
        branding:
          type: object
          properties:
            logo: { oneOf: [{ $ref: "#/components/schemas/Image" }, { type: "null" }] }
            heroImage: { oneOf: [{ $ref: "#/components/schemas/Image" }, { type: "null" }] }
            colors:
              type: object
              additionalProperties: { type: string }
              examples: [{ primary: "#111111" }]
            font: { type: [string, "null"] }
        sections:
          type: array
          items: { $ref: "#/components/schemas/StorefrontSection" }

    Studio:
      type: object
      description: |
        A tenant's public profile (TAT-44): what its owners were told the
        studio page shows. Every property is always there; an empty one is
        `null` or `[]`. All text is plain text: render it as text, never as
        HTML.
      required: [slug, name, type, intro, timezone, contact, socialLinks, acceptingInquiries]
      additionalProperties: false
      properties:
        slug:
          type: string
          description: The current slug, also when the request used an old one
        name: { type: string, maxLength: 120 }
        type:
          type: string
          enum: [studio, independent]
          description: |
            `independent` is one artist working alone; their own profile is
            the studio's one artist.
        intro: { type: [string, "null"], maxLength: 1000 }
        timezone:
          type: string
          description: The IANA timezone of the studio's dates and times
          examples: [Asia/Kathmandu]
        contact:
          type: object
          required: [phone, email, address]
          additionalProperties: false
          properties:
            phone:
              type: [string, "null"]
              description: E.164
              examples: ["+9779812345678"]
            email:
              type: [string, "null"]
              format: email
              description: The studio's contact email
            address:
              type: [string, "null"]
              maxLength: 300
              description: Free text; keep its line breaks
        socialLinks:
          type: array
          description: |
            The links the studio set, in this order: instagram, facebook,
            tiktok, website. Only https links.
          items: { $ref: "#/components/schemas/SocialLink" }
        acceptingInquiries:
          type: boolean
          description: |
            Whether `createInquiry` takes an inquiry that names no artist.
            False only when every visible artist is closed (that inquiry
            would be the 409 `studio_not_accepting`); a studio with no
            visible artist takes general inquiries.

    Artist:
      type: object
      description: |
        A visible artist of the studio (TAT-44). Every property is always
        there. All text is plain text: render it as text.
      required: [id, slug, name, bio, photo, acceptingInquiries, closedMessage]
      additionalProperties: false
      properties:
        id:
          type: string
          format: uuid
          description: What `createInquiry` takes as `preferredArtistId`
        slug:
          type: string
          description: The artist's own link within the studio (`getArtist`)
        name: { type: string, maxLength: 120 }
        bio: { type: [string, "null"], maxLength: 1000 }
        photo:
          description: At most 2048 px on its longer side, or null
          oneOf: [{ $ref: "#/components/schemas/Image" }, { type: "null" }]
        acceptingInquiries:
          type: boolean
          description: |
            False while the artist's books are closed: an inquiry naming
            them is the 409 `artist_not_accepting`.
        closedMessage:
          type: [string, "null"]
          maxLength: 300
          description: The artist's words to show instead of the inquiry form; null while they accept inquiries

```

- [ ] **Step 6: Regenerate the types and see the SDK pass**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate
rg -n "acceptingInquiries|closedMessage|socialLinks|ArtistSlug" packages/types/src/openapi.gen.ts
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react typecheck
```

Expected: the `rg` finds the new properties; every typecheck passes; the SDK tests pass (`# fail 0`, 4 more than the baseline). `packages/types/src/index.ts` needs no change (it already exports `Studio`, `Artist`, `Image`, `SocialLink`).

- [ ] **Step 7: Storefront fixtures (only if Task 0 Step 2 found `apps/storefront/test/tenancy/helpers.ts`)**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
If it reports errors like "is missing the following properties from type … `type`, `intro`, `timezone`, `contact`…" on object literals typed as `Studio` (TAT-12/23 tests such as `const STUDIO_A: Studio = { slug: "studio-a", name: "Studio A" }`), append to `apps/storefront/test/tenancy/helpers.ts`:

```ts
import type { Studio } from "@tattoo-drip/sdk";

/** A whole Studio (TAT-44's contract) where only the slug and the name matter. */
export function studioOf(slug: string, name: string): Studio {
	return {
		slug,
		name,
		type: "studio",
		intro: null,
		timezone: "Asia/Kathmandu",
		contact: { phone: null, email: null, address: null },
		socialLinks: [],
		acceptingInquiries: true,
	};
}
```

(move the `import type` line to the file's import block), and replace each failing literal `{ slug: "<s>", name: "<n>" }` with `studioOf("<s>", "<n>")`. Where such a fixture is also the body a fake API answers with (`json(200, { data: … })`) or the value a `deepEqual` expects, use the same `studioOf(...)` object on both sides, so the runtime assertions still compare like with like. Change only test files, never `apps/storefront/src`. Then run:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test
```

Expected: typecheck passes; `# fail 0` with the baseline count. If the typecheck reported nothing, change nothing.

- [ ] **Step 8: Document the three SDK calls**

In `packages/sdk/src/client.ts`, replace the `studio` and `artists` entries of the returned object with:

```ts
		studio: {
			/**
			 * The studio's public profile (TAT-44). Under an old slug it answers
			 * like under the current one, and `slug` is the current slug.
			 */
			get: (call?: RequestOptions) => getData<Studio>(tenantRoot, call),
		},
		artists: {
			/** The studio's visible artists, by name. */
			list: (call?: RequestOptions) =>
				getData<Artist[]>(`${tenantRoot}/artists`, call),
			/**
			 * One visible artist by slug, matched exactly. A hidden, deleted or
			 * unknown artist is a 404 TattooApiError (`not_found`).
			 */
			get: (slug: string, call?: RequestOptions) =>
				getData<Artist>(
					`${tenantRoot}/artists/${encodeURIComponent(slug)}`,
					call,
				),
		},
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/types/openapi.yaml packages/types/src/openapi.gen.ts packages/sdk/src/client.ts packages/sdk/test/client.test.ts
git add apps/storefront/test   # only if Step 7 changed something
git commit -m "feat(types): describe the studio profile, listArtists and getArtist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: React options for the three reads, pinned

**Files:**
- Test: `packages/react/test/studio.test.ts` (new)
- Modify: `packages/react/src/queries.ts` (one comment line)

**Interfaces:**
- Consumes: `tattooKeys.studio/artists/artist`, `tattooQueries.studio/artists/artist` (unchanged), the generated `Studio` and `Artist` (Task 1).
- Produces: nothing new; tests pin that the three options set no `staleTime` or `retry` (spec ruling 15).

- [ ] **Step 1: Write the tests**

Create `packages/react/test/studio.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { createTattooClient, isTattooApiError } from "@tattoo-drip/sdk";
import type { Artist, Studio } from "@tattoo-drip/types";
import { tattooKeys, tattooQueries } from "../src/queries.js";

const TENANT = "studio-needle-44";
const STUDIO: Studio = {
	slug: TENANT,
	name: "Studio Needle",
	type: "studio",
	intro: null,
	timezone: "Asia/Kathmandu",
	contact: { phone: null, email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
};
const ARTIST: Artist = {
	id: "0199f000-0000-7000-8000-000000000044",
	slug: "sita",
	name: "Sita Rai",
	bio: null,
	photo: null,
	acceptingInquiries: true,
	closedMessage: null,
};

/** A client whose fetch answers every call with `status` and `body`. */
function clientAnswering(status: number, body: unknown) {
	const calls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
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

const noRetries = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("tattooQueries.studio, artists and artist", () => {
	test("their keys start with the tenant, and an artist's sits under the list's", () => {
		const { client } = clientAnswering(200, { data: STUDIO });
		const tenant = ["tattoo-drip", "tenant", TENANT];

		assert.deepEqual(tattooQueries.studio(client).queryKey, [
			...tenant,
			"studio",
		]);
		assert.deepEqual(tattooQueries.artists(client).queryKey, [
			...tenant,
			"artists",
		]);
		assert.deepEqual(tattooQueries.artist(client, "sita").queryKey, [
			...tenant,
			"artists",
			"sita",
		]);
		assert.deepEqual(
			tattooKeys.artist(TENANT, "sita").slice(0, 4),
			tattooKeys.artists(TENANT),
		);
	});

	test("they load through the SDK", async () => {
		const studio = clientAnswering(200, { data: STUDIO });
		const list = clientAnswering(200, { data: [ARTIST] });
		const one = clientAnswering(200, { data: ARTIST });
		const base = `https://api.example.com/api/v1/tenants/${TENANT}`;

		assert.deepEqual(
			await noRetries().fetchQuery(tattooQueries.studio(studio.client)),
			STUDIO,
		);
		assert.deepEqual(
			await noRetries().fetchQuery(tattooQueries.artists(list.client)),
			[ARTIST],
		);
		assert.deepEqual(
			await noRetries().fetchQuery(tattooQueries.artist(one.client, "sita")),
			ARTIST,
		);
		assert.deepEqual(
			[...studio.calls, ...list.calls, ...one.calls],
			[base, `${base}/artists`, `${base}/artists/sita`],
		);
	});

	test("they set no staleTime or retry, so the app's defaults decide", () => {
		const { client } = clientAnswering(200, { data: STUDIO });

		for (const options of [
			tattooQueries.studio(client),
			tattooQueries.artists(client),
			tattooQueries.artist(client, "sita"),
		]) {
			assert.equal(options.staleTime, undefined);
			assert.equal(options.retry, undefined);
		}
	});

	test("an artist that isn't there rejects with the API's not_found", async () => {
		const { client } = clientAnswering(404, {
			error: { code: "not_found", message: "Not found." },
		});

		await assert.rejects(
			noRetries().fetchQuery(tattooQueries.artist(client, "nobody")),
			(error: unknown) =>
				isTattooApiError(error) &&
				error.status === 404 &&
				error.code === "not_found",
		);
	});
});
```

- [ ] **Step 2: Run them**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test
```

Expected: PASS (these pin existing behaviour; 4 more tests than the baseline). If "they set no staleTime or retry" fails, an option factory sets one: remove it from `studio`, `artists` or `artist` (spec ruling 15), never from `deposit`.

- [ ] **Step 3: Say so in the options' comment**

In `packages/react/src/queries.ts`, in the comment above `export const tattooQueries = {`, add this sentence as the comment's last line (keep the rest, including any TAT-23 wording):

```ts
 * `studio`, `artists` and `artist` set no `staleTime` or `retry`: the app's defaults decide (TAT-44).
```

- [ ] **Step 4: Commit**

```bash
git add packages/react/test/studio.test.ts packages/react/src/queries.ts
git commit -m "test(react): pin the studio and artist query options

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One rule for "the studio takes inquiries", shared with intake

**Files:**
- Create: `apps/platform/app/modules/artists/accepting.ts`
- Modify: `apps/platform/app/modules/inquiries/services/intake_service.ts` (`checkArtist`)
- Test: `apps/platform/tests/unit/modules/artists/studio_takes_inquiries.spec.ts` (new)

**Interfaces:**
- Produces: `studioTakesInquiries(visible: readonly Pick<Artist, "acceptingInquiries">[]): boolean` from `#modules/artists/accepting`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/artists/studio_takes_inquiries.spec.ts`:

```ts
import { test } from "@japa/runner";
import { studioTakesInquiries } from "#modules/artists/accepting";

const open = { acceptingInquiries: true };
const closed = { acceptingInquiries: false };

test.group("studioTakesInquiries", () => {
	test("a studio with no visible artist takes general inquiries", ({
		assert,
	}) => {
		assert.isTrue(studioTakesInquiries([]));
	});

	test("one open artist is enough", ({ assert }) => {
		assert.isTrue(studioTakesInquiries([open]));
		assert.isTrue(studioTakesInquiries([closed, open, closed]));
	});

	test("a studio whose visible artists are all closed takes none", ({
		assert,
	}) => {
		assert.isFalse(studioTakesInquiries([closed]));
		assert.isFalse(studioTakesInquiries([closed, closed]));
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=studio_takes_inquiries.spec.ts > <scratchpad>/t44-3-red.log 2>&1; echo "exit $?"`
Expected: exit 124 and "Cannot find module" for `#modules/artists/accepting` in the log.

- [ ] **Step 3: Write the rule**

Create `apps/platform/app/modules/artists/accepting.ts`:

```ts
import type Artist from "#modules/artists/models/artist";

/**
 * Whether a studio takes an inquiry that names no artist (TAT-51): yes when
 * it has no visible artist (general inquiries) or while at least one
 * visible artist accepts; no when every visible artist is closed. Intake's
 * `studio_not_accepting` and the public Studio's `acceptingInquiries`
 * (TAT-44) both come from here, so the studio page never offers a form the
 * API refuses. Pass the studio's visible artists (ArtistService.listVisible).
 */
export function studioTakesInquiries(
	visible: readonly Pick<Artist, "acceptingInquiries">[],
): boolean {
	return (
		visible.length === 0 || visible.some((artist) => artist.acceptingInquiries)
	);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test unit --files=studio_takes_inquiries.spec.ts > <scratchpad>/t44-3-green.log 2>&1; echo "exit $?"`
Expected: `Tests 3 passed` in the log.

- [ ] **Step 5: Intake uses it**

In `apps/platform/app/modules/inquiries/services/intake_service.ts`, add `import { studioTakesInquiries } from "#modules/artists/accepting";` to the imports and, in `checkArtist`, replace:

```ts
		if (visible.length > 0 && visible.every((a) => !a.acceptingInquiries)) {
			throw new InquiryRuleError("studio_not_accepting");
		}
```

with:

```ts
		if (!studioTakesInquiries(visible)) {
			throw new InquiryRuleError("studio_not_accepting");
		}
```

- [ ] **Step 6: Intake's tests still pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=intake_service.spec.ts --files=inquiry_refusals.spec.ts > <scratchpad>/t44-3-intake.log 2>&1; echo "exit $?"`
Expected: all pass, including "with no artist chosen, a studio whose visible artists are all closed takes none" and "a studio with no visible artists takes general inquiries".

- [ ] **Step 7: Commit**

```bash
git add apps/platform/app/modules/artists/accepting.ts apps/platform/app/modules/inquiries/services/intake_service.ts apps/platform/tests/unit/modules/artists/studio_takes_inquiries.spec.ts
git commit -m "refactor(platform): share intake's rule for when a studio takes inquiries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Find a visible artist by exact slug

**Files:**
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts`
- Test: `apps/platform/tests/functional/artists/artist_service.spec.ts` (new group at the end)

**Interfaces:**
- Produces: `ArtistService.findVisibleBySlug(tenant: Pick<Tenant, "id">, slug: string): Promise<Artist | null>`.

- [ ] **Step 1: Write the failing test**

Append to `apps/platform/tests/functional/artists/artist_service.spec.ts` (it already imports `testUtils`, `test`, `Artist`, `ArtistService`, `inTenant`, `studioWithOwner` and has `const artists`):

```ts
test.group("ArtistService.findVisibleBySlug", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("finds a live, visible profile by its exact slug, open or closed", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("slug-needle-44");

		const found = await inTenant(tenant, async () => {
			await Artist.create({
				tenantId: tenant.id,
				name: "Zara",
				slug: "zara",
				acceptingInquiries: false,
			});
			return artists.findVisibleBySlug(tenant, "zara");
		});

		assert.equal(found?.name, "Zara");
	});

	test("a hidden, deleted, unknown or differently cased slug is null", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("slug-missing-44");

		const results = await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" });
			await Artist.create({
				tenantId: tenant.id,
				name: "Hidden",
				slug: "hidden",
				visible: false,
			});
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			const found: (Artist | null)[] = [];
			for (const slug of ["hidden", "gone", "nobody", "Bina", "bina "]) {
				found.push(await artists.findVisibleBySlug(tenant, slug));
			}
			return found;
		});

		assert.deepEqual(results, [null, null, null, null, null]);
	});

	test("filters by the tenant it is given, not only by row-level security", async ({
		assert,
	}) => {
		const a = await studioWithOwner("slug-a-44");
		const b = await studioWithOwner("slug-b-44");
		await inTenant(b.tenant, () =>
			Artist.create({ tenantId: b.tenant.id, name: "Only B", slug: "only-b" }),
		);

		// In B's context RLS would show B's row: only the tenant filter hides it.
		assert.isNull(
			await inTenant(b.tenant, () =>
				artists.findVisibleBySlug(a.tenant, "only-b"),
			),
		);
		assert.isNull(
			await inTenant(a.tenant, () =>
				artists.findVisibleBySlug(a.tenant, "only-b"),
			),
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=artist_service.spec.ts > <scratchpad>/t44-4-red.log 2>&1; echo "exit $?"`
Expected: the three new tests FAIL with "artists.findVisibleBySlug is not a function"; the others pass.

- [ ] **Step 3: Add the lookup**

In `apps/platform/app/modules/artists/services/artist_service.ts`, after `listVisible`, add:

```ts
	/**
	 * The tenant's live, visible profile with exactly this slug (the public
	 * artist page, TAT-44), or null: a hidden, deleted, unknown or other
	 * tenant's slug all give null. Never case-folded.
	 */
	async findVisibleBySlug(
		tenant: TenantRef,
		slug: string,
	): Promise<Artist | null> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("visible", true)
			.where("slug", slug)
			.first();
	}
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=artist_service.spec.ts > <scratchpad>/t44-4-green.log 2>&1; echo "exit $?"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/platform/app/modules/artists/services/artist_service.ts apps/platform/tests/functional/artists/artist_service.spec.ts
git commit -m "feat(platform): find a visible artist by exact slug

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The studio page's read layer

**Files:**
- Create: `apps/platform/app/modules/storefront/studio_page.ts`
- Create: `apps/platform/app/modules/storefront/services/studio_page_service.ts`
- Create: `apps/platform/tests/helpers/artists.ts`
- Test: `apps/platform/tests/unit/modules/storefront/social_links.spec.ts` (new)
- Test: `apps/platform/tests/functional/storefront/studio_page_service.spec.ts` (new)

**Interfaces:**
- Consumes: `studioTakesInquiries` (Task 3), `ArtistService.listVisible` and `findVisibleBySlug` (Task 4), `ImageService.url(purpose, key, tenant)`, `type TenantProfile` from `#modules/tenancy/services/tenancy_service`.
- Produces:
  - `#modules/storefront/studio_page`: `SOCIAL_PLATFORMS`, `type PublicSocialLink = { platform: "instagram" | "facebook" | "tiktok" | "website"; url: string }`, `socialLinks(profile: Pick<TenantProfile, "instagramUrl" | "facebookUrl" | "tiktokUrl" | "websiteUrl">): PublicSocialLink[]`.
  - `#modules/storefront/services/studio_page_service` (default export `StudioPageService`, `@inject()`, constructor `(artists: ArtistService, images: ImageService)`): `type StudioProfile = TenantProfile & Pick<Tenant, "slug" | "type">`, `type StudioPage = { profile: StudioProfile; acceptingInquiries: boolean }`, `type ShownPhoto = { url: string; width: number; height: number }`, `type ShownArtist = Pick<Artist, "id" | "slug" | "name" | "bio" | "acceptingInquiries" | "closedMessage"> & { photo: ShownPhoto | null }`; methods `studio(tenant: Tenant): Promise<StudioPage>`, `visibleArtists(tenant: Tenant): Promise<ShownArtist[]>`, `visibleArtist(tenant: Tenant, slug: string): Promise<ShownArtist | null>`.
  - `#tests/helpers/artists`: `artistInput(over?: Partial<ArtistInput>): ArtistInput` (defaults: name "Sita Rai", slug "sita", bio null, visible true, acceptingInquiries true, closedMessage null, linkToMe false) and `addArtist(tenant: Tenant, owner: Member, over?: Partial<ArtistInput>): Promise<Artist>` (through `ArtistService.create`, in the tenant's context).

- [ ] **Step 1: Write the failing unit test**

Create `apps/platform/tests/unit/modules/storefront/social_links.spec.ts`:

```ts
import { test } from "@japa/runner";
import { socialLinks } from "#modules/storefront/studio_page";

const none = {
	instagramUrl: null,
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: null,
};

test.group("socialLinks", () => {
	test("lists the set links in a fixed order: instagram, facebook, tiktok, website", ({
		assert,
	}) => {
		assert.deepEqual(
			socialLinks({
				websiteUrl: "https://needle.example",
				tiktokUrl: "https://www.tiktok.com/@needle",
				facebookUrl: "https://facebook.com/needle",
				instagramUrl: "https://instagram.com/needle",
			}),
			[
				{ platform: "instagram", url: "https://instagram.com/needle" },
				{ platform: "facebook", url: "https://facebook.com/needle" },
				{ platform: "tiktok", url: "https://www.tiktok.com/@needle" },
				{ platform: "website", url: "https://needle.example" },
			],
		);
	});

	test("leaves out the links that aren't set", ({ assert }) => {
		assert.deepEqual(socialLinks(none), []);
		assert.deepEqual(
			socialLinks({ ...none, tiktokUrl: "https://www.tiktok.com/@needle" }),
			[{ platform: "tiktok", url: "https://www.tiktok.com/@needle" }],
		);
	});

	test("leaves out anything that isn't an https URL, whatever the row holds", ({
		assert,
	}) => {
		for (const url of [
			"javascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"http://needle.example",
			"data:text/html,hi",
			"//needle.example",
			"needle.example",
			"not a link",
			"https://",
			" https://needle.example",
			"",
		]) {
			assert.deepEqual(socialLinks({ ...none, websiteUrl: url }), [], url);
		}
	});

	test("keeps an https URL exactly as stored", ({ assert }) => {
		const url = "https://Instagram.com/Needle?hl=en";

		assert.deepEqual(socialLinks({ ...none, instagramUrl: url }), [
			{ platform: "instagram", url },
		]);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=social_links.spec.ts > <scratchpad>/t44-5-red1.log 2>&1; echo "exit $?"`
Expected: exit 124 and "Cannot find module" for `#modules/storefront/studio_page`.

- [ ] **Step 3: Write `socialLinks`**

Create `apps/platform/app/modules/storefront/studio_page.ts`:

```ts
import type { TenantProfile } from "#modules/tenancy/services/tenancy_service";

/**
 * The links a studio page shows (TAT-44), in this order, with the tenant
 * column each comes from.
 */
export const SOCIAL_PLATFORMS = [
	["instagram", "instagramUrl"],
	["facebook", "facebookUrl"],
	["tiktok", "tiktokUrl"],
	["website", "websiteUrl"],
] as const;

export type PublicSocialLink = {
	platform: (typeof SOCIAL_PLATFORMS)[number][0];
	url: string;
};

/**
 * The studio's links for the public Studio: the set ones, in a fixed order,
 * and only https URLs. The settings form already refuses anything else;
 * checking again here means a row written another way can never put a
 * `javascript:` or plain-http link on the page. The URL is sent as stored.
 */
export function socialLinks(
	profile: Pick<
		TenantProfile,
		"instagramUrl" | "facebookUrl" | "tiktokUrl" | "websiteUrl"
	>,
): PublicSocialLink[] {
	return SOCIAL_PLATFORMS.flatMap(([platform, field]) => {
		const url = profile[field];
		return url && isHttpsUrl(url) ? [{ platform, url }] : [];
	});
}

/** Starts with https:// (no leading space or other scheme) and parses as an https URL. */
function isHttpsUrl(value: string): boolean {
	if (!/^https:\/\//i.test(value)) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test unit --files=social_links.spec.ts > <scratchpad>/t44-5-green1.log 2>&1; echo "exit $?"`
Expected: `Tests 4 passed`.

- [ ] **Step 5: Add the artist test helper**

Create `apps/platform/tests/helpers/artists.ts`:

```ts
import ArtistService, {
	type ArtistInput,
	type Member,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { inTenant } from "#tests/helpers/tenants";

/** A valid ArtistService input: a visible profile named Sita Rai that takes inquiries. */
export const artistInput = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

/** Adds a profile to `tenant` through ArtistService, as its owner does in the dashboard. */
export function addArtist(
	tenant: Tenant,
	owner: Member,
	over: Partial<ArtistInput> = {},
) {
	return inTenant(tenant, () =>
		new ArtistService(new ImageService()).create(
			tenant,
			artistInput(over),
			owner,
		),
	);
}
```

- [ ] **Step 6: Write the failing service test**

Create `apps/platform/tests/functional/storefront/studio_page_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import StudioPageService from "#modules/storefront/services/studio_page_service";
import TenancyService, {
	type TenantProfile,
} from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { testImages, uploadOf } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** Counts listVisible calls, so a test sees the artists read once per call. */
class CountingArtists extends ArtistService {
	reads = 0;

	override async listVisible(...args: Parameters<ArtistService["listVisible"]>) {
		this.reads++;
		return super.listVisible(...args);
	}
}

const images = new ImageService();
const pagesWith = (artists: ArtistService = new ArtistService(images)) =>
	new StudioPageService(artists, images);

const PROFILE: TenantProfile = {
	name: "Page Needle",
	timezone: "Asia/Kathmandu",
	intro: "Fine line and blackwork.",
	contactPhone: "+9779812345678",
	contactEmail: "hello@page-needle.example",
	address: "Thamel Marg\nKathmandu",
	instagramUrl: "https://instagram.com/pageneedle",
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: "https://page-needle.example",
};

test.group("StudioPageService.studio", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives the public profile, the current slug and the type", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("page-needle-44");
		await inTenant(tenant, () =>
			new TenancyService().updateProfile(tenant, PROFILE),
		);

		const page = await inTenant(tenant, () => pagesWith().studio(tenant));

		assert.deepEqual(page, {
			profile: { ...PROFILE, slug: "page-needle-44", type: "studio" },
			acceptingInquiries: true,
		});
	});

	test("takes inquiries with no visible artist, not when every visible one is closed, again once one opens", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-open-44");
		const accepting = () =>
			inTenant(
				tenant,
				async () => (await pagesWith().studio(tenant)).acceptingInquiries,
			);

		assert.isTrue(await accepting());
		await addArtist(tenant, owner, { acceptingInquiries: false });
		assert.isFalse(await accepting());
		// A hidden artist doesn't open the studio, even one who accepts.
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		assert.isFalse(await accepting());
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		assert.isTrue(await accepting());
	});

	test("reads the artists once per call", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("page-once-44");
		await addArtist(tenant, owner);
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const counting = new CountingArtists(images);

		await inTenant(tenant, () => pagesWith(counting).studio(tenant));
		await inTenant(tenant, () => pagesWith(counting).visibleArtists(tenant));

		assert.equal(counting.reads, 2);
	});
});

test.group("StudioPageService.visibleArtists", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists visible artists by name with only their public fields; a closed message only while closed", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-artists-44");
		const zara = await addArtist(tenant, owner, {
			name: "zara",
			slug: "zara",
			bio: "Dotwork.",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		// Open again, still holding the message of an earlier closing, and
		// linked to the owner: neither may show.
		const bina = await addArtist(tenant, owner, {
			name: "Bina",
			slug: "bina",
			closedMessage: "Back next week.",
			linkToMe: true,
		});
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});

		const list = await inTenant(tenant, () =>
			pagesWith().visibleArtists(tenant),
		);

		assert.deepEqual(list, [
			{
				id: bina.id,
				slug: "bina",
				name: "Bina",
				bio: null,
				photo: null,
				acceptingInquiries: true,
				closedMessage: null,
			},
			{
				id: zara.id,
				slug: "zara",
				name: "zara",
				bio: "Dotwork.",
				photo: null,
				acceptingInquiries: false,
				closedMessage: "Books open in March.",
			},
		]);
	});

	test("a photo is its public URL and its size", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("page-photo-44");
		const sita = await addArtist(tenant, owner, {
			photo: await uploadOf(await testImages.png(300, 200)),
		});

		const [shown] = await inTenant(tenant, () =>
			pagesWith().visibleArtists(tenant),
		);

		assert.deepEqual(shown.photo, {
			url: await images.url("artist_photo", sita.photoKey ?? "", tenant),
			width: 300,
			height: 200,
		});
	});

	test("a studio with no visible artist has none", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("page-none-44");
		await addArtist(tenant, owner, { visible: false });

		assert.deepEqual(
			await inTenant(tenant, () => pagesWith().visibleArtists(tenant)),
			[],
		);
	});
});

test.group("StudioPageService.visibleArtist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("finds a visible artist by exact slug; hidden, deleted and unknown are null", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-one-44");
		const zara = await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		await inTenant(tenant, () =>
			new ArtistService(images).delete(tenant, gone),
		);
		const pages = pagesWith();

		const found = await inTenant(tenant, async () => ({
			zara: await pages.visibleArtist(tenant, "zara"),
			hidden: await pages.visibleArtist(tenant, "hidden"),
			gone: await pages.visibleArtist(tenant, "gone"),
			nobody: await pages.visibleArtist(tenant, "nobody"),
			cased: await pages.visibleArtist(tenant, "Zara"),
		}));

		assert.equal(found.zara?.id, zara.id);
		assert.isNull(found.hidden);
		assert.isNull(found.gone);
		assert.isNull(found.nobody);
		assert.isNull(found.cased);
	});
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=studio_page_service.spec.ts > <scratchpad>/t44-5-red2.log 2>&1; echo "exit $?"`
Expected: exit 124 and "Cannot find module" for `#modules/storefront/services/studio_page_service`.

- [ ] **Step 8: Write the service**

Create `apps/platform/app/modules/storefront/services/studio_page_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { studioTakesInquiries } from "#modules/artists/accepting";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import type { TenantProfile } from "#modules/tenancy/services/tenancy_service";

/**
 * What getStudio may read of a tenant: the profile its owners were told is
 * shown on the studio page (TenantProfile), its current slug and its type.
 * Never the deposit settings, which the settings page says the deposit page
 * shows.
 */
export type StudioProfile = TenantProfile & Pick<Tenant, "slug" | "type">;

/** The public Studio before formatting (openapi.yaml, Studio). */
export type StudioPage = {
	profile: StudioProfile;
	/** studioTakesInquiries over the visible artists: intake's own rule. */
	acceptingInquiries: boolean;
};

export type ShownPhoto = { url: string; width: number; height: number };

/** A visible artist as the public API shows it (openapi.yaml, Artist). */
export type ShownArtist = Pick<
	Artist,
	"id" | "slug" | "name" | "bio" | "acceptingInquiries" | "closedMessage"
> & { photo: ShownPhoto | null };

const PHOTO = "artist_photo";

/**
 * The studio page's public reads (TAT-44): the studio's profile and its
 * visible artists, for the tenant the publicTenant middleware resolved (its
 * row is already loaded, so the profile costs no query). Each read is one
 * query (ArtistService.listVisible or findVisibleBySlug); photo URLs are
 * built without I/O. Only the fields the contract lists leave here.
 */
@inject()
export default class StudioPageService {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
	) {}

	async studio(tenant: Tenant): Promise<StudioPage> {
		const visible = await this.artists.listVisible(tenant);
		return {
			profile: profileOf(tenant),
			acceptingInquiries: studioTakesInquiries(visible),
		};
	}

	/** The visible artists, by name (ArtistService.listVisible's order). */
	async visibleArtists(tenant: Tenant): Promise<ShownArtist[]> {
		const visible = await this.artists.listVisible(tenant);
		return Promise.all(visible.map((artist) => this.shown(tenant, artist)));
	}

	/** One visible artist by exact slug; null for a hidden, deleted or unknown one (the API's 404). */
	async visibleArtist(
		tenant: Tenant,
		slug: string,
	): Promise<ShownArtist | null> {
		const artist = await this.artists.findVisibleBySlug(tenant, slug);
		return artist ? this.shown(tenant, artist) : null;
	}

	private async shown(tenant: Tenant, artist: Artist): Promise<ShownArtist> {
		return {
			id: artist.id,
			slug: artist.slug,
			name: artist.name,
			bio: artist.bio,
			acceptingInquiries: artist.acceptingInquiries,
			// The form says the message shows while inquiries are off: an old
			// one kept after reopening never leaks.
			closedMessage: artist.acceptingInquiries ? null : artist.closedMessage,
			photo: await this.photoOf(tenant, artist),
		};
	}

	private async photoOf(
		tenant: Tenant,
		artist: Artist,
	): Promise<ShownPhoto | null> {
		const { photoKey, photoWidth, photoHeight } = artist;
		if (!photoKey || photoWidth === null || photoHeight === null) return null;
		return {
			url: await this.images.url(PHOTO, photoKey, tenant),
			width: photoWidth,
			height: photoHeight,
		};
	}
}

/** The tenant's public profile, field by field: nothing else of the row. */
function profileOf(tenant: Tenant): StudioProfile {
	return {
		slug: tenant.slug,
		type: tenant.type,
		name: tenant.name,
		timezone: tenant.timezone,
		intro: tenant.intro,
		contactPhone: tenant.contactPhone,
		contactEmail: tenant.contactEmail,
		address: tenant.address,
		instagramUrl: tenant.instagramUrl,
		facebookUrl: tenant.facebookUrl,
		tiktokUrl: tenant.tiktokUrl,
		websiteUrl: tenant.websiteUrl,
	};
}
```

- [ ] **Step 9: Run it to see it pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=studio_page_service.spec.ts > <scratchpad>/t44-5-green2.log 2>&1; echo "exit $?"`
Expected: `Tests 7 passed`.

- [ ] **Step 10: Typecheck and commit**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck`
Expected: PASS.

```bash
git add apps/platform/app/modules/storefront apps/platform/tests/helpers/artists.ts apps/platform/tests/unit/modules/storefront/social_links.spec.ts apps/platform/tests/functional/storefront/studio_page_service.spec.ts
git commit -m "feat(platform): read the studio page's profile and visible artists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: getStudio serves the whole public profile

**Files:**
- Modify: `apps/platform/app/transformers/public_studio_transformer.ts`
- Modify: `apps/platform/app/controllers/public_studio_controller.ts`
- Test: `apps/platform/tests/functional/api/public_studio.spec.ts` (replace the whole file)

**Interfaces:**
- Consumes: `StudioPageService.studio`, `type StudioPage` (Task 5), `socialLinks` (Task 5), `addArtist`, `artistInput` (Task 5).
- Produces: `PublicStudioTransformer extends BaseTransformer<StudioPage>`; `PublicStudioController` with `@inject()` and `constructor(private pages: StudioPageService)`.

- [ ] **Step 1: Write the failing test**

Replace `apps/platform/tests/functional/api/public_studio.spec.ts` with:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService, {
	type TenantProfile,
} from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { addArtist, artistInput } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const tenancy = new TenancyService();
const artists = new ArtistService(new ImageService());

/** The documented fields (openapi.yaml, Studio). A new one needs the contract and a ruling first. */
const STUDIO_FIELDS = [
	"acceptingInquiries",
	"contact",
	"intro",
	"name",
	"slug",
	"socialLinks",
	"timezone",
	"type",
];
const CONTACT_FIELDS = ["address", "email", "phone"];
const LINK_FIELDS = ["platform", "url"];

const PROFILE: TenantProfile = {
	name: "Black Needle",
	timezone: "Asia/Kathmandu",
	intro: "Fine line and blackwork.\nWalk-ins on Saturdays.",
	contactPhone: "+9779812345678",
	contactEmail: "hello@black-needle.example",
	address: "Thamel Marg\nKathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: null,
	tiktokUrl: "https://www.tiktok.com/@blackneedle",
	websiteUrl: "https://black-needle.example",
};

/** The public Studio of a studioWithOwner() studio: no profile filled in, no artists. */
const bareStudio = (slug: string, name: string) => ({
	slug,
	name,
	type: "studio",
	intro: null,
	timezone: "Asia/Kathmandu",
	contact: { phone: null, email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
});

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("GET /api/v1/tenants/:tenant (getStudio)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers the studio's whole public profile", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner(
			"api-needle-32",
			"Black Needle",
		);
		await inTenant(tenant, () => tenancy.updateProfile(tenant, PROFILE));
		await addArtist(tenant, owner, { acceptingInquiries: false });
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });

		const response = await client.get("/api/v1/tenants/api-needle-32");

		assertApiData(response, {
			slug: "api-needle-32",
			name: "Black Needle",
			type: "studio",
			intro: "Fine line and blackwork.\nWalk-ins on Saturdays.",
			timezone: "Asia/Kathmandu",
			contact: {
				phone: "+9779812345678",
				email: "hello@black-needle.example",
				address: "Thamel Marg\nKathmandu",
			},
			socialLinks: [
				{ platform: "instagram", url: "https://instagram.com/blackneedle" },
				{ platform: "tiktok", url: "https://www.tiktok.com/@blackneedle" },
				{ platform: "website", url: "https://black-needle.example" },
			],
			acceptingInquiries: true,
		});
		assertApiHeaders(response);
	});

	test("has exactly the documented fields", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("api-fields-44");
		await inTenant(tenant, () => tenancy.updateProfile(tenant, PROFILE));

		const { data } = (await client.get("/api/v1/tenants/api-fields-44")).body();

		assert.deepEqual(Object.keys(data).sort(), STUDIO_FIELDS);
		assert.deepEqual(Object.keys(data.contact).sort(), CONTACT_FIELDS);
		assert.isNotEmpty(data.socialLinks);
		for (const link of data.socialLinks) {
			assert.deepEqual(Object.keys(link).sort(), LINK_FIELDS);
		}
	});

	test("takes inquiries with no visible artist, not when every visible one is closed, again once one opens", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-open-44");
		const accepting = async () =>
			(await client.get("/api/v1/tenants/api-open-44")).body().data
				.acceptingInquiries;

		assert.isTrue(await accepting());
		await addArtist(tenant, owner, { acceptingInquiries: false });
		assert.isFalse(await accepting());
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		assert.isFalse(await accepting());
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		assert.isTrue(await accepting());
	});

	test("closing the last open artist changes the answer and its ETag", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-etag-44");
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const before =
			(await client.get("/api/v1/tenants/api-etag-44")).header("etag") ?? "";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			artists.update(
				tenant,
				bina,
				artistInput({ name: "Bina", slug: "bina", acceptingInquiries: false }),
				owner,
			),
		);
		const after = await client
			.get("/api/v1/tenants/api-etag-44")
			.header("if-none-match", before);

		after.assertStatus(200);
		assert.isFalse(after.body().data.acceptingInquiries);
		assert.notEqual(after.header("etag"), before);
	});

	test("an independent artist's studio says so", async ({ client }) => {
		const owner = await User.create({
			email: "owner@api-solo-44.example",
			password: "secret-password",
		});
		await tenancy.createTenant(owner, {
			type: "independent",
			name: "Solo Ink",
			slug: "api-solo-44",
			timezone: "Asia/Kathmandu",
		});

		assertApiData(await client.get("/api/v1/tenants/api-solo-44"), {
			...bareStudio("api-solo-44", "Solo Ink"),
			type: "independent",
		});
	});

	test("a link that isn't https is left out", async ({ client }) => {
		const { tenant } = await studioWithOwner("api-links-44");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set instagram_url = ?, facebook_url = ?, tiktok_url = ?, website_url = ? where id = ?",
				[
					"javascript:alert(1)",
					"http://facebook.com/needle",
					"not a link",
					"https://needle.example",
					tenant.id,
				],
			),
		);

		assertApiData(await client.get("/api/v1/tenants/api-links-44"), {
			...bareStudio("api-links-44", "Black Needle"),
			socialLinks: [{ platform: "website", url: "https://needle.example" }],
		});
	});

	test("under an old slug, answers with the current slug", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		await changeSlug(tenant, "api-red-32");

		assertApiData(
			await client.get("/api/v1/tenants/api-needle-32"),
			bareStudio("api-red-32", "Black Needle"),
		);
	});

	test("is cacheable: public, stale-while-revalidate, an ETag, and a 304 for a matching If-None-Match", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-needle-32");

		const first = await client.get("/api/v1/tenants/api-needle-32");
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client
			.get("/api/v1/tenants/api-needle-32")
			.header("if-none-match", etag);
		again.assertStatus(304);
		again.assertHeader("cache-control", CACHED);
		again.assertHeader("etag", etag);
		assertNoCookies(again);
	});

	test("a changed studio gets a new ETag, and the old tag a full answer", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		const before =
			(await client.get("/api/v1/tenants/api-needle-32")).header("etag") ?? "";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set name = 'Red Needle' where id = ?",
				[tenant.id],
			),
		);
		const after = await client
			.get("/api/v1/tenants/api-needle-32")
			.header("if-none-match", before);

		assertApiData(after, bareStudio("api-needle-32", "Red Needle"));
		assert.notEqual(after.header("etag"), before);
	});

	test("HEAD has the same cache headers and no body", async ({ client }) => {
		await studioWithOwner("api-needle-32");
		const etag = (await client.get("/api/v1/tenants/api-needle-32")).header(
			"etag",
		);

		const head = await client.head("/api/v1/tenants/api-needle-32");

		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
		assertNoCookies(head);
	});

	test("an unknown tenant is a 404 and a POST a 405, both no-store", async ({
		client,
	}) => {
		await studioWithOwner("api-needle-32");

		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td32"),
			404,
			"not_found",
		);
		const post = await client.post("/api/v1/tenants/api-needle-32").json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=public_studio.spec.ts > <scratchpad>/t44-6-red.log 2>&1; echo "exit $?"`
Expected: FAIL in every test that reads the body (it is still `{ slug, name }`); the cache, HEAD and 404/405 tests pass.

- [ ] **Step 3: The transformer**

Replace `apps/platform/app/transformers/public_studio_transformer.ts` with:

```ts
import { BaseTransformer } from "@adonisjs/core/transformers";
import type { StudioPage } from "#modules/storefront/services/studio_page_service";
import { socialLinks } from "#modules/storefront/studio_page";

/**
 * A studio as the public API shows it (openapi.yaml, Studio; TAT-44): the
 * profile its owners were told the studio page shows, the current slug
 * (also for a request made under an old one), the type and whether it
 * takes inquiries. Every field is written out here: a new one needs the
 * contract, a ruling and the exact-fields test. Never the tenant id, the
 * deposit settings, payment methods or members.
 */
export default class PublicStudioTransformer extends BaseTransformer<StudioPage> {
	toObject() {
		const { profile, acceptingInquiries } = this.resource;
		return {
			slug: profile.slug,
			name: profile.name,
			type: profile.type,
			intro: profile.intro,
			timezone: profile.timezone,
			contact: {
				phone: profile.contactPhone,
				email: profile.contactEmail,
				address: profile.address,
			},
			socialLinks: socialLinks(profile),
			acceptingInquiries,
		};
	}
}
```

- [ ] **Step 4: The controller**

Replace `apps/platform/app/controllers/public_studio_controller.ts` with:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioPageService from "#modules/storefront/services/studio_page_service";
import PublicStudioTransformer from "#transformers/public_studio_transformer";

/** The public API's tenant resource (getStudio in openapi.yaml, TAT-44). */
@inject()
export default class PublicStudioController {
	constructor(private pages: StudioPageService) {}

	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const studio = await this.pages.studio(tenant);
		return ctx.serialize(PublicStudioTransformer.transform(studio));
	}
}
```

- [ ] **Step 5: Run it to see it pass, with the isolation case**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=public_studio.spec.ts --files=public_api.spec.ts --files=api_routes.spec.ts > <scratchpad>/t44-6-green.log 2>&1; echo "exit $?"`
Expected: all pass (`public_api.spec.ts`'s `GET /api/v1/tenants/:tenant` case still finds A's slug and name and none of B's markers).

- [ ] **Step 6: Codegen, typecheck, commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck
git status --short apps/platform/.adonisjs
```

Expected: typecheck passes; codegen may or may not change `.adonisjs/` (the controller's constructor changed). Then:

```bash
git add apps/platform/app/transformers/public_studio_transformer.ts apps/platform/app/controllers/public_studio_controller.ts apps/platform/tests/functional/api/public_studio.spec.ts apps/platform/.adonisjs
git commit -m "feat(platform): serve the studio's whole public profile on getStudio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: listArtists and getArtist

**Files:**
- Modify: `apps/platform/tests/helpers/tenants.ts` (`closedArtist` in `studio()`, the `twoStudios` comment)
- Modify: `apps/platform/tests/helpers/public_isolation.ts` (`publicMarkers`)
- Create: `apps/platform/app/transformers/public_artist_transformer.ts`
- Create: `apps/platform/app/controllers/public_artists_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/isolation/public_cases.ts`
- Regenerate: `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/api/public_artists.spec.ts` (new)

**Interfaces:**
- Consumes: `StudioPageService.visibleArtists`, `visibleArtist`, `type ShownArtist` (Task 5); `addArtist`, `artistInput` (Task 5); `ApiException.notFound()`; `ARTIST_SLUG` from `#modules/artists/validators/artist`.
- Produces: `Studio.closedArtist` in the test fixture (an `Artist`: name `<studio name> Mira`, slug `<studio slug>-mira`, visible, not accepting, closed message `<studio name> Mira is booked until March.`); `PublicArtistTransformer extends BaseTransformer<ShownArtist>`; `PublicArtistsController.index` / `.show`; routes `api.v1.artists.index`, `api.v1.artists.show`.

- [ ] **Step 1: The isolation fixture gets an artist slug of its own**

In `apps/platform/tests/helpers/tenants.ts`, in `studio()`, right after the `artistProfile` block, add:

```ts
	// A visible artist who takes no inquiries, with a slug only this studio
	// has, for the public artist route (TAT-44): with both studios' "sita",
	// B's slug under A's path would answer A's own artist.
	const closedArtist = await inTenant(tenant, () =>
		artists.create(
			tenant,
			{
				name: `${name} Mira`,
				slug: `${slug}-mira`,
				bio: null,
				visible: true,
				acceptingInquiries: false,
				closedMessage: `${name} Mira is booked until March.`,
				linkToMe: false,
			},
			owner,
		),
	);
```

add `closedArtist,` to the returned object right after `artistProfile,`, and in the `twoStudios()` comment replace ``an artist profile (`artistProfile`)`` with ``an artist profile (`artistProfile`), a visible artist who takes no inquiries with a slug only that studio has (`closedArtist`, `<slug>-mira`)``.

In `apps/platform/tests/helpers/public_isolation.ts`, in `publicMarkers`, after `studio.artistProfile.name,` add:

```ts
		studio.closedArtist.id,
		studio.closedArtist.name,
```

- [ ] **Step 2: The isolation suites still pass with it**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 600 pnpm -C apps/platform test functional --files=harness.spec.ts --files=public_api.spec.ts --files=cross_tenant.spec.ts --files=inquiry_isolation.spec.ts > <scratchpad>/t44-7-fixture.log 2>&1; echo "exit $?"`
Expected: all pass. If a test counted a studio's artists, update its expectation to include `closedArtist` and say so in the commit message (as TAT-65 did for its third payment method).

- [ ] **Step 3: Commit the fixture**

```bash
git add apps/platform/tests/helpers/tenants.ts apps/platform/tests/helpers/public_isolation.ts
git commit -m "test(platform): give each isolation studio an artist slug of its own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing HTTP test**

Create `apps/platform/tests/functional/api/public_artists.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { addArtist, artistInput } from "#tests/helpers/artists";
import { testImages, uploadOf } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const images = new ImageService();
const artists = new ArtistService(images);
const tenancy = new TenancyService();

/** The documented fields (openapi.yaml, Artist and Image). A new one needs the contract and a ruling first. */
const ARTIST_FIELDS = [
	"acceptingInquiries",
	"bio",
	"closedMessage",
	"id",
	"name",
	"photo",
	"slug",
];
const PHOTO_FIELDS = ["height", "url", "width"];

/** The public Artist of a profile without a photo. */
const shown = (artist: Artist) => ({
	id: artist.id,
	slug: artist.slug,
	name: artist.name,
	bio: artist.bio,
	photo: null,
	acceptingInquiries: artist.acceptingInquiries,
	closedMessage: artist.acceptingInquiries ? null : artist.closedMessage,
});

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

function remove(tenant: Tenant, artist: Artist) {
	return inTenant(tenant, () => artists.delete(tenant, artist));
}

test.group("GET /api/v1/tenants/:tenant/artists (listArtists)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the visible artists by name, a closed one with its message", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-artists-44");
		const zara = await addArtist(tenant, owner, {
			name: "zara",
			slug: "zara",
			bio: "Blackwork and dotwork.",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		// Open, linked to the owner, holding a message from an earlier closing.
		const bina = await addArtist(tenant, owner, {
			name: "Bina",
			slug: "bina",
			closedMessage: "Back next week.",
			linkToMe: true,
		});
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		await remove(
			tenant,
			await addArtist(tenant, owner, { name: "Gone", slug: "gone" }),
		);

		const response = await client.get("/api/v1/tenants/api-artists-44/artists");

		assertApiData(response, [shown(bina), shown(zara)]);
		assertApiHeaders(response);
	});

	test("each artist has exactly the documented fields, and a photo its public URL and size", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-photo-44");
		const sita = await addArtist(tenant, owner, {
			photo: await uploadOf(await testImages.png(300, 200)),
		});
		const url = await images.url("artist_photo", sita.photoKey ?? "", tenant);

		const { data } = (
			await client.get("/api/v1/tenants/api-photo-44/artists")
		).body();

		assert.lengthOf(data, 1);
		assert.deepEqual(Object.keys(data[0]).sort(), ARTIST_FIELDS);
		assert.deepEqual(Object.keys(data[0].photo).sort(), PHOTO_FIELDS);
		assert.deepEqual(data[0].photo, { url, width: 300, height: 200 });
		// The studio's own public folder, nothing else.
		assert.match(
			new URL(url).pathname,
			new RegExp(`^/uploads/tenants/${tenant.id}/artist_photo/`),
		);
	});

	test("a studio with no visible artist answers an empty list", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-empty-44");
		await addArtist(tenant, owner, { visible: false });

		assertApiData(await client.get("/api/v1/tenants/api-empty-44/artists"), []);
	});

	test("an independent artist's studio lists their own profile, at the studio's slug", async ({
		client,
		assert,
	}) => {
		const owner = await User.create({
			email: "owner@api-solo-artists-44.example",
			password: "secret-password",
		});
		await tenancy.createTenant(owner, {
			type: "independent",
			name: "Solo Ink",
			slug: "api-solo-artists-44",
			timezone: "Asia/Kathmandu",
		});

		const list = await client.get("/api/v1/tenants/api-solo-artists-44/artists");
		const one = await client.get(
			"/api/v1/tenants/api-solo-artists-44/artists/api-solo-artists-44",
		);

		list.assertStatus(200);
		assert.lengthOf(list.body().data, 1);
		assert.equal(list.body().data[0].name, "Solo Ink");
		assertApiData(one, list.body().data[0]);
	});

	test("is cacheable: public, an ETag and a 304; HEAD the same", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-cache-44");
		await addArtist(tenant, owner);
		const url = "/api/v1/tenants/api-cache-44/artists";

		const first = await client.get(url);
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client.get(url).header("if-none-match", etag);
		again.assertStatus(304);
		assertNoCookies(again);
		const head = await client.head(url);
		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
	});

	test("under an old studio slug, answers like under the current one", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-old-44");
		const sita = await addArtist(tenant, owner);
		await changeSlug(tenant, "api-new-44");

		assertApiData(await client.get("/api/v1/tenants/api-old-44/artists"), [
			shown(sita),
		]);
		assertApiData(await client.get("/api/v1/tenants/api-new-44/artists"), [
			shown(sita),
		]);
	});

	test("an unknown studio is a 404 and a POST a 405, both no-store", async ({
		client,
	}) => {
		await studioWithOwner("api-405-44");

		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td44/artists"),
			404,
			"not_found",
		);
		const post = await client
			.post("/api/v1/tenants/api-405-44/artists")
			.json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});

test.group("GET /api/v1/tenants/:tenant/artists/:artist (getArtist)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers one visible artist by slug, a closed one with its message", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-one-44");
		const zara = await addArtist(tenant, owner, {
			name: "Zara",
			slug: "zara",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});

		const response = await client.get("/api/v1/tenants/api-one-44/artists/zara");

		assertApiData(response, shown(zara));
		assertApiHeaders(response);
		response.assertHeader("cache-control", CACHED);
	});

	test("a hidden, deleted, unknown, malformed or differently cased slug is the same 404", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-missing-44");
		await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		await remove(
			tenant,
			await addArtist(tenant, owner, { name: "Gone", slug: "gone" }),
		);

		for (const slug of [
			"hidden",
			"gone",
			"nobody",
			"Zara",
			"ZARA",
			"-zara",
			"zara-",
			"z",
			"x".repeat(64),
			"zara%20",
			"zara.json",
		]) {
			assertApiError(
				await client.get(`/api/v1/tenants/api-missing-44/artists/${slug}`),
				404,
				"not_found",
			);
		}
	});

	test("another studio's artist is a 404 under this studio's slug", async ({
		client,
	}) => {
		await studioWithOwner("api-mine-44");
		const theirs = await studioWithOwner("api-theirs-44");
		await addArtist(theirs.tenant, theirs.owner, {
			name: "Only B",
			slug: "only-b",
		});

		assertApiError(
			await client.get("/api/v1/tenants/api-mine-44/artists/only-b"),
			404,
			"not_found",
		);
		(
			await client.get("/api/v1/tenants/api-theirs-44/artists/only-b")
		).assertStatus(200);
	});

	test("a renamed artist's old slug is a 404, and a deleted artist's slug shows whoever takes it next", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-renamed-44");
		const sita = await addArtist(tenant, owner, { name: "Sita", slug: "sita" });
		const renamed = await inTenant(tenant, () =>
			artists.update(
				tenant,
				sita,
				artistInput({ name: "Sita", slug: "sita-rai" }),
				owner,
			),
		);

		assertApiError(
			await client.get("/api/v1/tenants/api-renamed-44/artists/sita"),
			404,
			"not_found",
		);
		assertApiData(
			await client.get("/api/v1/tenants/api-renamed-44/artists/sita-rai"),
			shown(renamed),
		);

		await remove(tenant, renamed);
		const next = await addArtist(tenant, owner, {
			name: "Sita Gurung",
			slug: "sita-rai",
		});

		assertApiData(
			await client.get("/api/v1/tenants/api-renamed-44/artists/sita-rai"),
			shown(next),
		);
	});

	test("under an old studio slug, answers like under the current one, with the same ETag; HEAD works", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-alias-44");
		const sita = await addArtist(tenant, owner);
		await changeSlug(tenant, "api-alias-new-44");

		const old = await client.get("/api/v1/tenants/api-alias-44/artists/sita");
		assertApiData(old, shown(sita));
		const etag = old.header("etag") ?? "";
		assert.isNotEmpty(etag);
		(
			await client
				.get("/api/v1/tenants/api-alias-new-44/artists/sita")
				.header("if-none-match", etag)
		).assertStatus(304);
		const head = await client.head("/api/v1/tenants/api-alias-44/artists/sita");
		head.assertStatus(200);
		head.assertHeader("etag", etag);
	});

	test("a POST is a 405 with Allow: GET, HEAD", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner("api-post-44");
		await addArtist(tenant, owner);

		const post = await client
			.post("/api/v1/tenants/api-post-44/artists/sita")
			.json({});

		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=public_artists.spec.ts > <scratchpad>/t44-7-red.log 2>&1; echo "exit $?"`
Expected: FAIL: every request that expects a 200 gets the 404 of a route that doesn't exist; the 404 tests pass, and the 405 tests fail with a 404.

- [ ] **Step 6: The transformer**

Create `apps/platform/app/transformers/public_artist_transformer.ts`:

```ts
import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownArtist } from "#modules/storefront/services/studio_page_service";

/**
 * A visible artist as the public API shows it (openapi.yaml, Artist;
 * TAT-44). Every field is written out here: a new one needs the contract, a
 * ruling and the exact-fields test. Never the linked user, the visible
 * flag, the photo key or timestamps.
 */
export default class PublicArtistTransformer extends BaseTransformer<ShownArtist> {
	toObject() {
		const artist = this.resource;
		return {
			id: artist.id,
			slug: artist.slug,
			name: artist.name,
			bio: artist.bio,
			photo: artist.photo
				? {
						url: artist.photo.url,
						width: artist.photo.width,
						height: artist.photo.height,
					}
				: null,
			acceptingInquiries: artist.acceptingInquiries,
			closedMessage: artist.closedMessage,
		};
	}
}
```

- [ ] **Step 7: The controller, then codegen**

Create `apps/platform/app/controllers/public_artists_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioPageService from "#modules/storefront/services/studio_page_service";
import { ApiException } from "#services/public_api_errors";
import PublicArtistTransformer from "#transformers/public_artist_transformer";

/**
 * The studio's visible artists on the public API (listArtists and
 * getArtist in openapi.yaml, TAT-44). A hidden, deleted or unknown artist
 * is the one 404; the route's matcher already turned away a slug of the
 * wrong shape.
 */
@inject()
export default class PublicArtistsController {
	constructor(private pages: StudioPageService) {}

	async index(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const artists = await this.pages.visibleArtists(tenant);
		return ctx.serialize(PublicArtistTransformer.transform(artists));
	}

	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const artist = await this.pages.visibleArtist(tenant, ctx.params.artist);
		if (!artist) throw ApiException.notFound();
		return ctx.serialize(PublicArtistTransformer.transform(artist));
	}
}
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen`
Expected: `apps/platform/.adonisjs/server/controllers.ts` now has `PublicArtists`.

- [ ] **Step 8: The routes, then codegen again**

In `apps/platform/start/routes.ts`, add `import { ARTIST_SLUG } from "#modules/artists/validators/artist";` next to the `DEPOSIT_TOKEN` import, and in the `/tenants/:tenant` group, right after the `api.v1.studio` route, add:

```ts
				// The studio's visible artists (TAT-44). A slug of the wrong shape
				// (uppercase, a dot, one character) is the router's 404 without a
				// query; hidden and deleted artists are the handler's 404.
				router
					.get("/artists", [controllers.PublicArtists, "index"])
					.use(middleware.publicCache())
					.as("api.v1.artists.index");
				router
					.get("/artists/:artist", [controllers.PublicArtists, "show"])
					.where("artist", ARTIST_SLUG)
					.use(middleware.publicCache())
					.as("api.v1.artists.show");
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen`
Expected: the route registry under `apps/platform/.adonisjs/` gains the two route names.

- [ ] **Step 9: Run it to see it pass; the guard now wants the cases**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=public_artists.spec.ts --files=api_routes.spec.ts > <scratchpad>/t44-7-green1.log 2>&1; echo "exit $?"`
Expected: `public_artists.spec.ts` all pass; `api_routes.spec.ts` FAILS only in "every /api/v1/tenants/:tenant route has a public isolation case" (the two new routes); "every API GET route is cacheable or says why not" passes.

- [ ] **Step 10: The isolation cases**

In `apps/platform/tests/isolation/public_cases.ts`, add `import Artist from "#modules/artists/models/artist";` to the imports, add after `tenantRow`:

```ts
const artistRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Artist.query().orderBy("id")).map((row) => row.serialize()),
	);
```

and add to `publicIsolationCases`, after the `GET /api/v1/tenants/:tenant` case:

```ts
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/artists",
		ownStatus: 200,
		ownMarkers: (own) => [own.artistProfile.id, own.closedArtist.id],
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/artists/:artist",
		// Each studio's own slug (`<slug>-mira`): B's under A's path, and A's
		// under B's, must be the 404.
		params: (studio) => ({ artist: studio.closedArtist.slug }),
		ownStatus: 200,
		ownMarkers: (own) => [own.closedArtist.id, own.closedArtist.name],
		snapshot: artistRows,
	},
```

- [ ] **Step 11: Run the isolation and guard suites**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 600 pnpm -C apps/platform test functional --files=public_api.spec.ts --files=api_routes.spec.ts --files=public_artists.spec.ts --files=public_studio.spec.ts > <scratchpad>/t44-7-green2.log 2>&1; echo "exit $?"`
Expected: all pass, including `GET /api/v1/tenants/:tenant/artists` and `GET /api/v1/tenants/:tenant/artists/:artist` in "Public API isolation".

- [ ] **Step 12: Typecheck and commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck
git add apps/platform/app/transformers/public_artist_transformer.ts apps/platform/app/controllers/public_artists_controller.ts apps/platform/start/routes.ts apps/platform/tests/isolation/public_cases.ts apps/platform/tests/functional/api/public_artists.spec.ts apps/platform/.adonisjs
git commit -m "feat(platform): serve the studio's visible artists on the public API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Nothing private in any studio page read

**Files:**
- Test: `apps/platform/tests/functional/api/studio_page_privacy.spec.ts` (new)

**Interfaces:**
- Consumes: the three routes (Tasks 6, 7), `addArtist` (Task 5), `seedPipeline` (`#tests/helpers/pipeline`), `artistIn`, `inTenant`, `studioWithOwner` (`#tests/helpers/tenants`), `TenancyService.updateDepositSettings`, `PaymentMethodService.create`.

- [ ] **Step 1: Write the test**

Create `apps/platform/tests/functional/api/studio_page_privacy.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { seedPipeline } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

test.group("Studio page reads: nothing private", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("getStudio, listArtists and getArtist name nothing but the studio page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"api-private-44",
			"Private Needle",
		);
		const member = await artistIn(tenant, "member@api-private-44.example");
		await inTenant(tenant, () =>
			new TenancyService().updateDepositSettings(tenant, {
				defaultDepositPercent: 37,
				depositPolicy: "canary-policy-44",
			}),
		);
		const method = await inTenant(tenant, () =>
			new PaymentMethodService(new ImageService()).create(tenant, {
				kind: "esewa",
				label: "canary-method-44",
				accountName: "canary-holder-44",
				accountNumber: "9800000044",
				showOnDepositPage: true,
			}),
		);
		// Linked to the owner: the link must not show.
		const shown = await addArtist(tenant, owner, {
			name: "Shown Artist",
			slug: "shown",
			linkToMe: true,
		});
		const hidden = await addArtist(tenant, owner, {
			name: "canary-hidden-44",
			slug: "canary-hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, {
			name: "canary-deleted-44",
			slug: "canary-deleted",
		});
		await inTenant(tenant, () =>
			new ArtistService(new ImageService()).delete(tenant, gone),
		);
		const pipeline = await inTenant(tenant, () => seedPipeline(tenant));

		const canaries = [
			// No photo here, so the tenant id has no reason to appear anywhere.
			tenant.id,
			owner.id,
			owner.email,
			member.id,
			member.email,
			"canary-policy-44",
			method.id,
			"canary-method-44",
			"canary-holder-44",
			"9800000044",
			hidden.id,
			"canary-hidden",
			gone.id,
			"canary-deleted",
			pipeline.client.id,
			pipeline.client.name,
			pipeline.client.phone ?? "",
			pipeline.inquiry.id,
			pipeline.inquiry.idea,
			pipeline.project.id,
			pipeline.project.brief,
			pipeline.quote.id,
			pipeline.payment.id,
			pipeline.referenceImage.id,
			pipeline.referenceImage.imageKey,
		].filter((canary) => canary !== "");

		for (const path of ["", "/artists", "/artists/shown"]) {
			const response = await client.get(`/api/v1/tenants/api-private-44${path}`);
			response.assertStatus(200);
			const text = JSON.stringify(response.body());
			// Positive control: the answer is this studio's page.
			assert.include(text, path === "" ? "Private Needle" : shown.id);
			for (const canary of canaries) {
				assert.notInclude(text, canary, `${path || "/"} names ${canary}`);
			}
		}
	});
});
```

- [ ] **Step 2: Run it**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=studio_page_privacy.spec.ts > <scratchpad>/t44-8.log 2>&1; echo "exit $?"`
Expected: `Tests 1 passed`.

- [ ] **Step 3: Prove it can fail**

In `apps/platform/app/modules/storefront/services/studio_page_service.ts`, temporarily change `this.artists.listVisible(tenant)` in `visibleArtists` to `this.artists.list(tenant)` (which includes hidden artists) and rerun the Step 2 command. Expected: FAIL with "/artists names <the hidden artist's id>". Revert the change (`git diff --stat` shows only the new spec as untracked) and rerun: `Tests 1 passed`.

- [ ] **Step 4: Commit**

```bash
git add apps/platform/tests/functional/api/studio_page_privacy.spec.ts
git commit -m "test(platform): prove the studio page reads name nothing private

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `docs/sdk.md`, `docs/data-model.md`, `docs/architecture.md`, `docs/requirements.md`

- [ ] **Step 1: `apps/platform/docs/backend.md`**

In the Public API section, after the bullet that starts `- **A new endpoint.**`, add:

```markdown
- **Studio page reads (TAT-44).** `GET /api/v1/tenants/:tenant` (`api.v1.studio`), `…/artists` (`api.v1.artists.index`) and `…/artists/:artist` (`api.v1.artists.show`; the `ARTIST_SLUG` matcher makes a malformed or uppercase slug the router's 404 without a query) are cached with `publicCache()`. `StudioPageService` (`#modules/storefront/services/studio_page_service`) builds them from the tenant row `publicTenant` loaded and from `ArtistService`, one query per request: `studio(tenant)` (the `TenantProfile` that the settings page says is shown on the booking page, the current slug, the type, and `acceptingInquiries` from `studioTakesInquiries` in `#modules/artists/accepting`, which intake's `studio_not_accepting` uses too), `visibleArtists(tenant)` and `visibleArtist(tenant, slug)` (null for a hidden, deleted or unknown artist: the 404). `socialLinks` (`#modules/storefront/studio_page`) keeps only https links, in a fixed order. A closed message shows only while the artist is closed; a photo is `ImageService.url` of the public `artist_photo` key with its size. The transformers write each field out: a new public field needs the contract, a ruling and the exact-fields tests. Never in these answers: the tenant id (except inside a photo URL's path), the deposit policy or percentage, payment methods, members, clients, inquiries, projects, quotes, payments, hidden or deleted artists.
```

In the Artists bullet, replace the sentence `Public reads (visible profiles only) are TAT-44.` with:

```markdown
Public reads (TAT-44) use `listVisible` and `findVisibleBySlug(tenant, slug)` (live, visible, the exact slug; null otherwise), through `StudioPageService` (Public API section). Artist slugs have no aliases: a renamed artist's old slug is a 404, and a deleted profile's slug can be taken by a new one.
```

- [ ] **Step 2: `apps/platform/docs/testing.md`**

In the `twoStudios()` bullet, replace ``an artist profile (`artistProfile`)`` with ``an artist profile (`artistProfile`), a visible artist who takes no inquiries with a slug only that studio has (`closedArtist`, `<slug>-mira`: the public artist route's isolation case needs a slug B has and A hasn't)``. At the end of the "Public API routes (TAT-32)" bullet, add: ``Artist fixtures for public tests: `artistInput` and `addArtist` from `#tests/helpers/artists` (TAT-44).``

- [ ] **Step 3: `docs/sdk.md`**

After the paragraph that starts `Inquiries, clients, quotes and payments are never readable through the public API.`, add:

```markdown
The studio page reads `client.studio.get()`: `slug` (the current one), `name`, `type`, `intro`, `timezone`, `contact` (`phone` in E.164, `email`, `address`, each possibly null), `socialLinks` (`{ platform, url }`, https only, in the order instagram, facebook, tiktok, website; show any other `platform` as a plain link) and `acceptingInquiries`, which is false only when every visible artist is closed, exactly when `inquiries.create` without an artist answers `studio_not_accepting`. `client.artists.list()` gives the visible artists by name and `client.artists.get(slug)` one of them (a hidden, deleted or unknown artist is a 404 `not_found`): `id` (the `preferredArtistId` to send), `slug`, `name`, `bio`, `photo` (`{ url, width, height }` or null), `acceptingInquiries` and `closedMessage` (null while they accept). All three are cached for 60 seconds, and every string is plain text: render it as text. React: `useStudio()`, `useArtists()`, `useArtist(slug)`; their options set no `staleTime` or `retry`, so the app's defaults decide.
```

- [ ] **Step 4: `docs/data-model.md`, `docs/architecture.md`, `docs/requirements.md`**

In `docs/data-model.md`, replace the row

`| **StorefrontConfiguration** | One per tenant. In the MVP: which artists show and the intro text. Theme and branding come in V1 |`

with

`| **StorefrontConfiguration** | V1 (TAT-54): one per tenant, a theme and its options (branding, sections). Not a table yet: in the MVP the studio page shows the tenant's profile (intro, contact, links) and the artists whose visible switch is on |`

In `docs/architecture.md`, replace the row `| Storefront | Studio page configuration. Themes in V1 | MVP |` with `| Storefront | The studio page's public reads: the profile and the visible artists (TAT-44). Configuration and themes in V1 | MVP |`.

In `docs/requirements.md`, change `- [ ] Tenant profile: name, contact phone and email, address, social links, timezone` to `- [x] Tenant profile: name, contact phone and email, address, social links, timezone`, and replace the Studio page rule `- Hidden artists don't appear.` with:

```markdown
- Hidden artists don't appear, and a hidden or deleted artist's page is a not-found page. The page shows what the dashboard says it shows (the profile, the visible artists with their photos and closed messages), never deposit policies, payment details, members or anything about clients, inquiries or payments.
```

- [ ] **Step 5: Links still resolve**

Run: `rg -n "backend.md#|testing.md#|sdk.md#|requirements.md#" docs apps/platform/docs README.md`
Expected: every anchor it prints names a heading that still exists (no heading was added, renamed or removed, so `docs/README.md` needs no change).

- [ ] **Step 6: Commit**

```bash
git add apps/platform/docs/backend.md apps/platform/docs/testing.md docs/sdk.md docs/data-model.md docs/architecture.md docs/requirements.md
git commit -m "docs(platform): document the studio profile and artist reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verification

- [ ] **Step 1: Generated files are current**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen
git status --short
```

Expected: no changes.

- [ ] **Step 2: The full platform suite**

Run in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C apps/platform test > <scratchpad>/t44-full.log 2>&1`
Expected: `Tests N passed` with N above the Task 0 baseline and no failures.

- [ ] **Step 3: Package tests and the root gates**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build
```

Expected: `# fail 0` in both package runs (SDK +4, React +4 over the baseline); check, typecheck and build pass. If the storefront is in the base, also `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test` with `# fail 0`.

- [ ] **Step 4: No migration, nothing outside the plan**

Run: `git diff --stat <base>..HEAD -- apps/platform/database apps/storefront/src` (where `<base>` is the commit Task 0 started from)
Expected: nothing.

- [ ] **Step 5: PR text (not committed)**

Write `<scratchpad>/pr3-tat-44.md`: a few what-and-why bullets per change (mentor mode), the spec's rulings in one line each, the deviations from this plan, the test counts, "Before any public deploy: TAT-38, TAT-55, TAT-27", the "For later tickets" list from the spec, and a manual check for the user with the dev server (`PORT=3401`): `curl -si http://localhost:3401/api/v1/tenants/<slug>`, `…/artists`, `…/artists/<artist slug>` (200, `Cache-Control: public, max-age=60, stale-while-revalidate=600`, an `ETag`, no `Set-Cookie`), the same with `-H 'If-None-Match: <etag>'` (304), a hidden artist's slug (404, `no-store`), and an old studio slug (same body). Then the whole-branch review and the Codex code and security reviews (the coordinator runs them).
