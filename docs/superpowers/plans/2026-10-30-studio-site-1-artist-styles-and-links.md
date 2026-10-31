# Studio site 1/5: artist styles and social links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An artist can pick up to 5 tattoo styles from a fixed list and add Instagram, Facebook and TikTok links in the dashboard; the public API and the storefront's artist card and artist page show them.

**Architecture:** The style list is a code constant in the artists module; an artist's styles are a `varchar(40)[]` column (no new table, so no new RLS policy or isolation case), and three URL columns sit beside them on `artists`. The public `Artist` gains `styles` (`TattooStyle[]`) and `socialLinks` (`SocialLink[]`), built by the same helper that builds the studio's links. The storefront reuses the studio's social-link sanitizing for the artist.

**Tech Stack:** AdonisJS 7, Lucid, VineJS, Inertia + React (dashboard), PostgreSQL 18, OpenAPI 3.1 + openapi-typescript, TanStack Start (storefront), Japa and `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-studio-website-design.md` (sections "Artist page", "Styles", "Artist profile additions", "My calls" 2 and 3). This is ticket 1 of the spec's suggested split; tickets 2 to 5 get their own plans.

## Global Constraints

- Base: `main` at `ea048f5`. Branch `harublank00/studio-site-1-artist-styles-and-links` in the worktree `/home/blank/Coding/tattoo-drip-wt/site-1`.
- **Never touch the user's database `tattoo_drip` or the servers on ports 3333 and 3000.** Every platform command runs with `DB_DATABASE=tattoo_drip_site` (an isolated database this plan creates) and `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform` (the worktree has no `.env`; never read any `.env`). Unset `TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS` for test runs. Tests use `PORT=3402`; a dev server for the browser pass uses 3401, the storefront 3404.
- Node 24: prefix commands with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`.
- A spec run that hits a missing import hangs Japa: run RED steps as `timeout 90 ... > log 2>&1` and expect exit 124 plus the "Cannot find module" line.
- The style list, exactly (slug: name), in this order: `blackwork`: Blackwork, `fine-line`: Fine line, `traditional`: Traditional, `neo-traditional`: Neo-traditional, `realism`: Realism, `black-and-grey`: Black and grey, `colour`: Colour, `watercolour`: Watercolour, `japanese`: Japanese, `tribal`: Tribal, `mandala`: Mandala, `geometric`: Geometric, `dotwork`: Dotwork, `lettering`: Lettering, `minimal`: Minimal, `portrait`: Portrait, `religious-and-spiritual`: Religious and spiritual, `cover-up`: Cover-up.
- Up to **5** styles per artist. Social links: Instagram, Facebook, TikTok, **https only**, up to 500 characters, shown in that order.
- Copy: the form's style error is "Pick up to 5 styles."; a bad link is "Enter a full link that starts with https://" (the studio profile's message).
- All text is plain text. The public API sends only what the contract lists (exact-fields tests).
- Never edit generated files: `packages/types/src/openapi.gen.ts` (`pnpm --filter @tattoo-drip/types generate`), `apps/platform/database/schema.ts` (`pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`), `apps/platform/.adonisjs/` (`node ace codegen`), `apps/storefront/src/routeTree.gen.ts`.
- Conventional Commits with area scopes (`platform`, `types`, `sdk`, `react`, `storefront`), subjects under 100 characters, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An artist saved before this ticket** (`styles` is `{}`, links null): the card and page show no empty style row and no empty links list. Pinned in Task 4 (`render.test.ts`).
2. **An older or cached API response without `styles` / `socialLinks`**: the storefront treats a missing or malformed value as none, like `workPhotos`. Pinned in Task 4 (`view-model.test.ts`).
3. **A stored style slug that later leaves the list**: the public API drops it; the dashboard form shows it unchecked, and saving drops it. Pinned in Task 3 (`public_artists.spec.ts`) and Task 2 (`artist_form.spec.ts`).
4. **Styles sent together with a photo in one multipart save**: the array survives multipart parsing. Pinned in Task 2 (`artist_form.spec.ts`).
5. **A 500-character Instagram link at 375 px**: it never widens the page. Checked in Task 5's browser pass.

---

### Task 1: Style list, columns and the service

**Files:**
- Create: `apps/platform/app/modules/artists/styles.ts`
- Create: `apps/platform/database/migrations/1791700000000_add_styles_and_social_links_to_artists.ts`
- Modify: `apps/platform/app/modules/artists/models/artist.ts`
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts` (`ArtistInput`, `profileFields`)
- Modify: `apps/platform/tests/helpers/artists.ts` (`artistInput` defaults)
- Test: `apps/platform/tests/unit/modules/artists/styles.spec.ts` (new), `apps/platform/tests/functional/artists/artist_service.spec.ts`

**Interfaces:**
- Produces (in `#modules/artists/styles`):
  - `export const TATTOO_STYLES: readonly { readonly slug: StyleSlug; readonly name: string }[]` (the 18 entries above, frozen)
  - `export type StyleSlug` (union of the 18 slugs) and `export const STYLE_SLUGS: readonly StyleSlug[]`
  - `export const MAX_ARTIST_STYLES = 5`
  - `export type TattooStyleRef = { slug: StyleSlug; name: string }`
  - `export function knownStyles(slugs: readonly string[]): TattooStyleRef[]` (list order, unknown and repeated slugs dropped)
- Produces (model `Artist`): `styles: string[]`, `instagramUrl: string | null`, `facebookUrl: string | null`, `tiktokUrl: string | null`.
- Produces (`ArtistInput`, so also `OwnProfileInput`): `styles: StyleSlug[]`, `instagramUrl: string | null`, `facebookUrl: string | null`, `tiktokUrl: string | null`.

- [ ] **Step 1: Set up the worktree and the isolated database**

The worktree and branch already exist (the coordinator created them; the spec and this plan are its first commit).

```bash
cd /home/blank/Coding/tattoo-drip-wt/site-1 && PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install --frozen-lockfile
podman exec tattoo-drip_postgres_1 psql -U postgres -c 'CREATE DATABASE tattoo_drip_site'
```

Then pipe `apps/platform/database/setup_roles.sql` **without its `ALTER ROLE :"app_user" LOGIN ... PASSWORD` line** into `podman exec -i tattoo-drip_postgres_1 psql -U postgres -d tattoo_drip_site -v ON_ERROR_STOP=1 -v app_user=tattoo_drip_app -v owner_user=postgres` (the full script would reset the cluster-wide app role's password the user's dev server uses). Run `pnpm migrate` in `apps/platform` with the Global Constraints' environment.
Expected: migrations complete; `git status` clean.

- [ ] **Step 2: Write the failing unit tests** in `tests/unit/modules/artists/styles.spec.ts`

```ts
test("the list has the 18 styles, unique slugs in path-safe form", ({ assert }) => {
	assert.lengthOf(TATTOO_STYLES, 18);
	assert.lengthOf(new Set(STYLE_SLUGS), 18);
	for (const slug of STYLE_SLUGS) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
	assert.deepEqual(TATTOO_STYLES[1], { slug: "fine-line", name: "Fine line" });
});
test("knownStyles keeps the list's order and drops unknown and repeated slugs", ({ assert }) => {
	assert.deepEqual(knownStyles(["realism", "nope", "blackwork", "realism"]), [
		{ slug: "blackwork", name: "Blackwork" },
		{ slug: "realism", name: "Realism" },
	]);
	assert.deepEqual(knownStyles([]), []);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=styles.spec.ts > /tmp/site1-red.log 2>&1` (from `apps/platform`, with the Global Constraints' environment)
Expected: exit 124, "Cannot find module '#modules/artists/styles'".

- [ ] **Step 4: Implement `styles.ts`** with the exports above.

- [ ] **Step 5: Write the failing service tests** in `artist_service.spec.ts`

- "create stores styles and links": `create(tenant, artistInput({ styles: ["realism", "blackwork"], instagramUrl: "https://instagram.com/sita" }), member)` then a fresh read has `styles` `["realism", "blackwork"]` (as given) and `instagramUrl` as given, `facebookUrl` null.
- "update with no styles and no links clears them": after the above, `update(..., artistInput({ styles: [], instagramUrl: null }))` reads back `styles` `[]` and `instagramUrl` null.
- "the database refuses a sixth style": a raw `Artist.query()` update setting 6 slugs throws (the check constraint `artists_styles_max`).

- [ ] **Step 6: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=artist_service.spec.ts`
Expected: FAIL on the new tests (unknown column / property).

- [ ] **Step 7: Write the migration, model columns and service fields**

Migration (`up`): on `artists` add `styles` `varchar(40)[]` not null default `'{}'`, check `artists_styles_max` `cardinality(styles) <= 5`; `instagram_url`, `facebook_url`, `tiktok_url` `varchar(500)` nullable. `down` drops them. `profileFields` copies the four new fields; `artistInput` in the test helper defaults to `styles: []` and three nulls. Run `pnpm migrate`, then `pnpm exec biome check --write database/schema.ts`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `PORT=3402 pnpm test unit --files=styles.spec.ts` and `PORT=3402 pnpm test functional --files=artist_service.spec.ts`
Expected: PASS; `pnpm typecheck` clean.

- [ ] **Step 9: Commit**

```bash
git add apps/platform/app/modules/artists apps/platform/database apps/platform/tests
git commit -m "feat(platform): artist styles from a fixed list and social link columns"
```

### Task 2: The dashboard's artist form

**Files:**
- Modify: `apps/platform/app/modules/tenancy/validators/tenant.ts` (export `httpsUrl`)
- Modify: `apps/platform/app/modules/artists/validators/artist.ts`
- Modify: `apps/platform/app/controllers/artists_controller.ts` (`toInput`, `toProps`, the create and edit pages' props)
- Modify: `apps/platform/inertia/pages/artists/form.tsx` (`ArtistFields`)
- Regenerate: `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/artists/artist_form.spec.ts`, `apps/platform/tests/functional/artists/own_profile.spec.ts`

**Interfaces:**
- Consumes: `STYLE_SLUGS`, `MAX_ARTIST_STYLES`, `TATTOO_STYLES` (Task 1); `ArtistInput` fields (Task 1).
- Produces: form field names `styles[]` (one checkbox per style, value = slug), `instagramUrl`, `facebookUrl`, `tiktokUrl`; page prop `styleOptions: { slug: string; name: string }[]` (the list, in order) on the create and edit pages; `ArtistProps` gains `styles: string[]`, `instagramUrl`, `facebookUrl`, `tiktokUrl` (`string | null`).

- [ ] **Step 1: Write the failing HTTP tests** in `artist_form.spec.ts`, in the existing groups' style (`client.post(base).fields(...)` / `.field(...)`):

- "an owner saves two styles and an Instagram link": fields `styles[]` = `blackwork`, `styles[]` = `fine-line`, `instagramUrl` = `https://instagram.com/sita`; the stored artist has `styles` `["blackwork", "fine-line"]` and the link.
- "no style boxes sent means none": editing an artist that had styles, with no `styles[]` field, stores `[]`.
- "a sixth style is a field error on styles": six `styles[]` values, flash error on `styles` is "Pick up to 5 styles.", nothing changed.
- "an unknown style is a field error": `styles[]` = `nope`, error on `styles`, nothing changed.
- "a plain-http link is a field error": `facebookUrl` = `http://facebook.com/sita`, error on `facebookUrl` is "Enter a full link that starts with https://".
- "styles survive a save that also uploads a photo": one multipart request with `photo` (from `testImages`) and two `styles[]`; both stored. (Review Focus 4)
- "the edit form offers every style and shows a dropped one unchecked": an artist whose stored `styles` is `["blackwork", "retired-style"]` (raw update) renders `styleOptions` with 18 entries and `artist.styles` containing `blackwork`; saving with only `styles[]` = `blackwork` stores `["blackwork"]`. (Review Focus 3)

In `own_profile.spec.ts`: "an artist sets their own styles and TikTok link" through the own-profile save.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=artist_form.spec.ts --files=own_profile.spec.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the validator**

In the artists validator's `fields()`: `styles: vine.array(vine.enum(STYLE_SLUGS)).distinct().maxLength(MAX_ARTIST_STYLES).optional()`, and `instagramUrl` / `facebookUrl` / `tiktokUrl`: `httpsUrl().nullable().optional()` (imported from the tenancy validator, now exported). Messages: `"styles.maxLength": "Pick up to 5 styles."`, `url: "Enter a full link that starts with https://"`, field names "styles", "Instagram link", "Facebook link", "TikTok link". `toInput` maps a missing `styles` to `[]` and missing links to null.

- [ ] **Step 4: Implement the controller props and the form**

`toProps` adds the four fields; both pages get `styleOptions` from `TATTOO_STYLES`. In `ArtistFields`, after Bio: a "Styles" `FieldSet` with a legend, the description "Pick up to 5.", and one checkbox per option (`name="styles[]"`, `defaultChecked` when the artist has it), wrapping in two columns from the `sm` breakpoint; then three URL inputs ("Instagram link", "Facebook link", "TikTok link", `type="url"`, `inputMode="url"`, placeholder `https://`), each with its `FieldError`. Follow `inertia/` conventions in `apps/platform/docs/ui.md`. Run `node ace codegen`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=artist_form.spec.ts --files=own_profile.spec.ts --files=artists_page.spec.ts`
Expected: PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): pick an artist's styles and social links in the artist form"
```

### Task 3: The public contract and API

**Files:**
- Modify: `packages/types/openapi.yaml` (`Artist`)
- Regenerate: `packages/types/src/openapi.gen.ts`
- Modify: `apps/platform/app/modules/storefront/studio_page.ts` (`socialLinks` parameter type)
- Modify: `apps/platform/app/modules/storefront/services/studio_page_service.ts` (`ShownArtist`, `shown`)
- Modify: `apps/platform/app/transformers/public_artist_transformer.ts`
- Modify (fixtures only, as typecheck asks): `packages/sdk/test/client.test.ts`, `packages/react/test/studio.test.ts`, `apps/storefront/test/studio/fixtures.ts`, `apps/storefront/scripts/check-page.mjs`
- Test: `apps/platform/tests/functional/api/public_artists.spec.ts`, `apps/platform/tests/unit/modules/storefront/social_links.spec.ts`

**Interfaces:**
- Consumes: `knownStyles`, `TattooStyleRef` (Task 1).
- Produces: contract `Artist.required` adds `styles` and `socialLinks`; `styles`: array, `maxItems: 5`, items `TattooStyle`, description "The artist's styles from the platform's list, in the list's order; [] when none."; `socialLinks`: array of `SocialLink`, description "The links the artist set, in this order: instagram, facebook, tiktok. Only https links." `ShownArtist` gains `styles: TattooStyleRef[]` and `socialLinks: PublicSocialLink[]`. `socialLinks(profile: Partial<Pick<TenantProfile, "instagramUrl" | "facebookUrl" | "tiktokUrl" | "websiteUrl">>): PublicSocialLink[]` (a missing field is unset).

- [ ] **Step 1: Write the failing tests**

- `public_artists.spec.ts`: add `"socialLinks"` and `"styles"` to `ARTIST_FIELDS`; new "styles come in the list's order as slug and name, an unknown one dropped": stored `["realism", "retired-style", "blackwork"]` gives `[{ slug: "blackwork", name: "Blackwork" }, { slug: "realism", name: "Realism" }]`, each with exactly `["name", "slug"]`; new "social links are the set https ones, in order": stored TikTok and Instagram (and a raw-written `http://` Facebook) give `[{ platform: "instagram", ... }, { platform: "tiktok", ... }]`; an artist with none gives `styles: []` and `socialLinks: []`.
- `social_links.spec.ts`: "an artist's links have no website entry": `socialLinks({ instagramUrl: "https://a.example", tiktokUrl: null })` is `[{ platform: "instagram", url: "https://a.example" }]`.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=public_artists.spec.ts` and `PORT=3402 pnpm test unit --files=social_links.spec.ts`
Expected: FAIL (missing keys; type error on the partial argument).

- [ ] **Step 3: Change the contract, regenerate, implement**

Edit `Artist` in `openapi.yaml` as in Interfaces; `pnpm --filter @tattoo-drip/types generate`. Widen `socialLinks`' parameter; in `shown`, `styles: knownStyles(artist.styles)` and `socialLinks: socialLinks(artist)`; the transformer writes both out field by field (`{ slug, name }`, `{ platform, url }`). Update the fixtures typecheck names with `styles: []` and `socialLinks: []` (one storefront fixture, `SITA`, gets `styles: [{ slug: "fine-line", name: "Fine line" }]` and an Instagram link for Task 4).

- [ ] **Step 4: Run the tests to verify they pass**

Run: the two commands above, plus `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm typecheck` (root)
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add packages apps/platform apps/storefront/test apps/storefront/scripts
git commit -m "feat(types): the public artist's styles and social links"
```

### Task 4: The storefront's artist card and artist page

**Files:**
- Modify: `apps/storefront/src/studio/view-model.ts` (extract `socialContactLinks`, extend `ArtistView`)
- Modify: `apps/storefront/src/studio/components/artists.tsx` (the card in `ArtistRoster`, `ArtistProfile`)
- Modify: `apps/storefront/src/styles.css`
- Test: `apps/storefront/test/studio/view-model.test.ts`, `apps/storefront/test/studio/render.test.ts`

**Interfaces:**
- Consumes: the regenerated `Artist` type and fixtures (Task 3).
- Produces: `export function socialContactLinks(value: unknown): ContactLink[]` (the studio's existing social loop moved out unchanged: `safeHttpsUrl`, known platforms named, an unknown one labelled by host; anything but an array is `[]`); `ArtistView.styles: readonly string[]` (names, one line each via `cleanLine`, at most 5, anything malformed dropped) and `ArtistView.links: readonly ContactLink[]`.

- [ ] **Step 1: Write the failing tests**

`view-model.test.ts`:
- "an artist's styles are their names, in the API's order": `SITA` gives `styles` `["Fine line"]`.
- "an artist's links are the safe ones, labelled like the studio's": `SITA` gives one link `{ kind: "instagram", label: "Instagram", href: <SITA's URL> }`; a `javascript:` URL is dropped.
- "an older API without styles or socialLinks means none": an `Artist` with both keys deleted gives `styles: []` and `links: []`; `styles: "x"` and `socialLinks: {}` likewise; a style item without a string `name` is dropped. (Review Focus 2)
- The existing `studioViewModel` link tests stay green untouched (the extraction changes no behaviour).

`render.test.ts`:
- "the card shows the artist's styles on one line": the studio page HTML for `SITA` contains `Fine line` inside an element with class `artist-styles`.
- "the artist page shows styles and links": the artist page for `SITA` contains a list with class `style-list` holding `Fine line` and a link with `href` = SITA's Instagram URL and the rel `linkRel` gives external links.
- "an artist with no styles or links shows neither": `ARJUN` (empty both) renders no `artist-styles`, `style-list` or `artist-links` element. (Review Focus 1)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`artistViewModel` sets `styles` and `links`; the card renders `<p className="artist-styles">` with the names joined by " · " under the name; `ArtistProfile` renders `<ul className="style-list">` (one `<li>` per name, styled as small outlined chips) under the title and `<ul className="artist-links">` of links (`rel={linkRel(...)}`, the label as text) after the bio. CSS uses the theme's tokens only (`--line-strong`, `--ink`, `--radius`), wraps chips, and gives long link text `overflow-wrap: anywhere` (Review Focus 5).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/storefront test` and `pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): show an artist's styles and social links"
```

### Task 5: Docs, whole-branch checks and the browser pass

**Files:**
- Modify: `docs/data-model.md` (Artist: styles, three social links), `apps/storefront/docs/development.md` (studio page: the card's styles line, the artist page's styles and links), `apps/platform/docs/backend.md` only if it lists artist fields.

- [ ] **Step 1: Update the docs** in the files above, one or two sentences each, in the existing voice.

- [ ] **Step 2: Run the root gates**

Run (worktree root, Node 24, the Global Constraints' environment): `pnpm check`, `pnpm typecheck`, `pnpm build`, then the full platform suite with `PORT=3402 pnpm -C apps/platform exec node ace test` in the background (empty `queue_jobs` in `tattoo_drip_site` first; never two platform suites at once), and `pnpm test` for the packages and storefront.
Expected: all clean; the platform log ends with `Tests N passed` and no failures.

- [ ] **Step 3: Browser pass**

Start the platform on 3401 against `tattoo_drip_site` and the storefront on 3404 with `API_URL=http://localhost:3401`. Through the dashboard, give an artist 3 styles, an Instagram link of 500 characters, a TikTok link, and a Devanagari name (e.g. "सीता राई"). With Playwright (`playwright-core` at `/home/blank/Coding/tattoo-drip/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core`, `executablePath` `/home/blank/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`), check at 375 × 812 and 1280 × 800, light and dark: the form's style grid, the error for a sixth style, the studio page card's styles line, the artist page's chips and links; no horizontal scroll at 375 px (Review Focus 5). Stop both servers by their exact PIDs.

- [ ] **Step 4: Commit**

```bash
git add docs apps/storefront/docs apps/platform/docs
git commit -m "docs: artist styles and social links"
```

- [ ] **Step 5: Tear down**

Leave `tattoo_drip_site` in place for tickets 2 to 5 (they stack on this branch); stop every process this plan started; `git status` clean.
