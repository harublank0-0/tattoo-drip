# Studio themes driven by the storefront configuration (TAT-54)

> Instructions for the coding agent (opencode, deepseek-v4.1-flash-free). Read `docs/agent-environment.md` first. Do the tasks in order. In every task, write the test first, run it, check that it fails for the reason given, and only then write the code. Copy every code block exactly: the code uses tabs, like the files.

**Ticket:** TAT-54, "Theme system driven by StorefrontConfiguration" (V1, moved into the launch list on 2026-10-22). Storefront only.

**Branch:** `harublank00/tat-54-theme-system-driven-by-storefrontconfiguration`, cut from `96fb901` (the TAT-105 tip); this plan is the one commit on top of it.

**Goal:** a theme registry in the storefront. A theme is a set of React components of this app; a studio never stores markup. A studio's configuration picks a theme, orders and hides the sections that theme supports, and sets its branding (logo, accent colour, display face, cover image), which reaches the page as CSS variables and `<img>` elements built only from checked values. There is one theme, `stencil-and-ink`: the page TAT-97 and TAT-105 built. The API sends no configuration yet, so every studio gets that theme with its defaults and its pages render exactly as they do today, byte for byte.

**Scope fence: storefront only.** You create or change only these files:

- New: `apps/storefront/src/studio/theme/color.ts`, `config.ts`, `branding.ts`, `source.ts`, `registry.tsx`, `head.ts` (all in `src/studio/theme/`), and `apps/storefront/src/studio/components/brand.tsx`.
- New tests: `apps/storefront/test/studio/snapshot.ts`, `default-theme.test.ts`, `default-theme.snapshot.json` (written by a test in Task 0), `theme-color.test.ts`, `theme-config.test.ts`, `theme-branding.test.ts`, `theme-fixtures.ts`, `theme-loaders.test.ts`, `theme-render.test.ts`, `theme-head.test.ts` (all in `test/studio/`).
- Changed: `apps/storefront/src/studio/loaders.ts`, `apps/storefront/src/studio/components/pages.tsx`, `apps/storefront/src/routes/index.tsx`, `apps/storefront/src/routes/artists/$slug.tsx`, `apps/storefront/src/styles.css`, `apps/storefront/docs/development.md`.

## NOT in this plan

- Anything in `apps/platform`, any migration, `packages/types/openapi.yaml`, `packages/sdk`, `packages/react`. The dashboard settings where an owner picks a theme, logo, colours, font, cover and sections, the preview link, uploads and storage are TAT-56 (see "What TAT-56 must add").
- The intake form (`src/intake/`), `InquirySection` (`src/studio/components/inquiry.tsx`), the deposit page (`src/deposit/`, `src/routes/deposit.tsx`) and the link rules (`src/studio/links.ts`): not themable, not edited.
- Any new dependency, font file, script, stylesheet or request to another origin. Any `package.json` or lockfile change.
- A Content-Security-Policy header (none is sent yet).
- Generated files: never edit `apps/storefront/src/routeTree.gen.ts` or `packages/types/src/openapi.gen.ts`. No route is added or renamed, so the route tree does not change.
- Existing tests: you change none of them. Every new test is in a new file.

**STOP rule:** if a command's output differs from what a step says (a different count, a different error, a different failing test), or a "Find" text below is not in the file exactly once, stop. Do not improvise, do not change any other file, never weaken, skip or delete a test. Write what you saw under "Findings" at the bottom of this file (the command, the test name, expected and actual) and report it. The full list of reasons to stop is in "STOP and tell the human" near the end.

## Facts already verified on this branch (do not redo them)

1. **What the contract says.** `packages/types/openapi.yaml` lines 635 to 663 define `StorefrontSection` (`{ type: string, props: object }`, examples `hero`, `portfolio`, `services`, "V1 (TAT-54). Not served yet.") and `StorefrontConfiguration` ("V1 (TAT-54). Not served yet: `Studio` gains it as `storefront` with themes and branding."): `theme` (a string, example `classic`), `branding` (`logo` and `heroImage`, each an `Image` `{ url, width, height, alt }` or null; `colors`, a map of strings, example `{ primary: "#111111" }`; `font`, a string or null) and `sections` (a list of `StorefrontSection`). `Studio` (line 665) has `additionalProperties: false` and no `storefront`, so the generated `Studio` type has none either. `packages/types/src/index.ts` exports a `StorefrontConfiguration` type and the SDK re-exports it, but nothing uses it.
2. **What the platform serves today.** `apps/platform/app/transformers/public_studio_transformer.ts` sends exactly the `Studio` fields: no `storefront`. The SDK's `client.studio.get()` (`packages/sdk/src/client.ts`) returns the response's `data` as it is, with no field filter, so a `storefront` the platform adds later reaches the storefront unchanged.
3. **How the storefront reads the studio.** Every request's studio comes from its host: `tenantMiddleware` (`src/tenancy/middleware.ts`) asks `client.studio.get()` (`src/tenancy/lookup.ts`), `seedStudio` (`src/api/context.ts`) puts the answer in the query cache, and the root loader (`loadStudio`, `src/api/loaders.ts`) and the page loaders (`loadStudioPage`, `loadArtistPage`, `src/studio/loaders.ts`) read it from there. The page loaders turn it into view models (`studioPageData`, `artistPageData`), which the router serializes into the page: only public, checked data may go in. The API's origin is `context.tattoo.connection.apiUrl` (checked by `parseConnection`, on the server and in the browser). The studio read is cached 60 s and the page `s-maxage=60`.
4. **Where images live.** The platform's public images are absolute URLs under `APP_URL` + `/uploads` (`apps/platform/config/drive.ts`), the same origin as the API; the fixtures' artist photo is `https://api.example.com/uploads/tenants/t/artist_photo/sita.jpg`. Production storage moves to R2 later (TAT-27); whether public images then stay on the API's origin is an open question for the user, not for this plan.
5. **The page after TAT-105.** `StudioPage` (`src/studio/components/pages.tsx`): `<main class="page">` holds `<header class="profile">` (the `h1` and the location line, the two buttons, the "How booking works" strip, the intro, the contact groups), then `ArtistRoster` (`id="artists"`), then `InquirySection` (`id="inquiry"`: the intake form's mount and the sticky "How booking works" panel); after `main`, `SiteFooter`. `ArtistPage`: `<header class="site-bar">` (a link home with the studio's name), then `main` (the artist's profile, `InquirySection` with the strip above, the studio's contacts), then `SiteFooter`. The only in-page links are `#inquiry` (the hero's and the artist page's "Send your idea", and `/#inquiry`); nothing links to `#artists`.
6. **What a theme owns and what stays fixed** (decided):

| Part | In this plan |
|---|---|
| Hero: name (`h1`), location, "Send your idea" and WhatsApp, the steps strip, intro, contacts | Fixed, always first. Gets the logo (above the name), the cover image (above the hero), the accent and the display face. |
| Artists roster (`artists`) | A section: the config can move it after the inquiry or hide it. |
| Inquiry (`inquiry`: the intake form and the "How booking works" panel) | A section: the config can move it, never hide it (a client can always send an idea, and the hero's `#inquiry` link always has its target). Its markup is never themed. |
| Footer ("Studio page by Tattoo Drip") | Fixed, always last. |
| Artist page | Fixed layout; gets the logo in its bar, the accent and the display face. |
| Deposit page, status pages, intake form, link rules | Not themable at all. |

7. **Tokens, fonts, bundle check.** `src/styles.css` defines the palette on `:root` (`--paper #f7f3ee`, `--ink #1c1917`, `--ink-muted #5e5650`, `--stencil #43389a`, `--stencil-strong #362c80`, `--on-stencil #f7f3ee`, `--stencil-wash #e7e4f4`, ...) and again for `@media (prefers-color-scheme: dark)` (`--paper #14110f`, `--ink #efe9e2`, `--ink-muted #a89f96`, `--stencil #a99cff`, `--on-stencil #14110f`, ...), plus `--body-face` and `--display-face` (Eczar first). shadcn's names (`--primary`, `--ring`, `--accent`, `--muted`, ...) point at these tokens. The only vendored font is Eczar 700 (`src/assets/fonts/eczar/`); `@fontsource/manrope` and `@fontsource/cormorant-garamond` are prototype leftovers without Devanagari and are not used. `pnpm build` ends with `scripts/check-client-bundle.mjs`, which fails when the browser bundle holds server-only text; its list includes `parseStorefrontConfig` and `storefrontConfig` (the server settings in `src/tenancy/config.ts`). So nothing in this plan is called that: the theme's parser is `parseThemeConfig`.
8. **Tests that pin things this plan touches.** `test/studio/render.test.ts`'s `assertSafePage` forbids any ` style=` attribute and requires a non-empty `alt` on every `<img>`: the default page has neither, so it keeps passing; branded pages are checked by `theme-render.test.ts`'s own `assertSafeBrandedPage` (brand images have `alt=""`). `test/studio/assets.test.ts` expects exactly two `--body-face`/`--display-face` declarations in `styles.css`: never add one there. `test/studio/prototype-removed.test.ts` fails if any file in `src/` contains `features/`, `posthog`, `booking-form`, `components/layout` or `data/mock`, or if a route file is added. React 19 puts a `<link rel="preload" as="image">` in front of a static render for every image that is not lazy (the artist page's snapshot starts with one).
9. **Baseline on this branch:** 629 tests, 629 pass; storefront typecheck clean; `pnpm check` exits 0 with `Found 2 warnings.` and `Found 1 info.` (platform files: `apps/platform/inertia/ssr.tsx`, `apps/platform/inertia/types.ts`, `apps/platform/tests/unit/validators/account_messages.spec.ts`); leave them. The storefront build ends with `Client bundle check: 10 files in .output/public, no server-only text.`
10. **Test command.** The storefront suite runs as one command (about 10 seconds), and it is the only test command you run:
    `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
    Extra arguments do not narrow it. Read the `ℹ tests`, `ℹ pass` and `ℹ fail` lines at the end, and the `✖ failing tests:` list above them. When a test fails, pnpm also prints `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`; that is normal in a red step. A test file that imports a file or a name that does not exist yet fails as a whole: it counts as 1 failed test and its other tests don't run. The red counts below include that.
    Typecheck: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck` (no output after `$ tsc --noEmit` means no error).
11. **Commits.** The pre-commit hook runs Biome on the staged files and may rewrite them; the code below is already formatted as Biome wants, so it should change nothing. Read a file again before editing it after a commit. `git add` and `git commit` ask the human each time: write each as one plain command, exactly as given. The route file's name has a `$` in it: always write it in single quotes (`'apps/storefront/src/routes/artists/$slug.tsx'`), or the shell drops `$slug`. Every commit message ends with the line `Assisted-by: opencode (deepseek-v4.1-flash-free)`.

## Decisions (made by the planner; do not reopen them)

1. **The seam: `storefrontInput(studio)` in `src/studio/theme/source.ts` reads the API studio's `storefront` property.** It is exactly where TAT-56's contract field will arrive, so TAT-56 only adds the field to the contract and deletes one cast; until then the platform never sends it, so every real page takes the default path. Tests put a configuration on a fixture studio (`withStorefront` in `test/studio/theme-fixtures.ts`) and so drive the non-default path through the real loaders and components.
2. **Branding is one `<style>` in the head, not a `style` attribute.** The routes' `head` returns it as `styles: [{ children: css }]`; the router writes it in the server-rendered head (no flash, it updates on client navigation, and it carries the router's CSP nonce once one is set). A `style` attribute cannot hold the dark-scheme media query, would need `'unsafe-inline'` (or hashes) in a future `style-src`, and the studio page's own rule and test forbid it. Our code never uses `dangerouslySetInnerHTML`; the router inserts the text as it is, which is why the CSS is built only from checked `#rrggbb` values and fixed text and `isSafeCss` refuses anything else before it leaves (no quote, slash, backslash, `<`, `>`, `&` or control character can be in it). Rules sit on `html:root`, which outranks `styles.css`'s `:root` wherever the tag lands. The default theme writes no `<style>`.
3. **Colours: `branding.colors.accent` (light scheme) and `branding.colors.accentDark` (dark scheme, optional), `#rrggbb` only.** An accent sets `--stencil`, `--stencil-strong` and `--stencil-wash` for a scheme only when it reads at 4.5:1 on that scheme's paper; otherwise that scheme keeps the theme's violet (all three tokens: the code writes nothing for it). The hover colour is a quarter of the way to the ink, kept only while the paper still reads on it at 4.5:1; the wash is a tint of the paper on which the accent, the ink and the muted ink all read at 4.5:1, else the paper. `--on-stencil` stays the paper: paper on the accent has the same contrast as the accent on the paper. The dark scheme uses `accentDark` when it reads there, else the accent lightened toward white until it does. Other colour keys (`primary`, `background`) are ignored; paper and ink are not brandable.
4. **Fonts: a key, never a name.** `eczar` (the default, vendored), `serif` (Georgia and Noto Serif Devanagari) or `sans` (the body stack). Nothing new is downloaded.
5. **Images: `<img>` only, from the API's origin only.** The URL passes `safeImageUrl` (`src/studio/links.ts`, unchanged), has no space or control character, is on exactly the API's origin and is https (plain http only when the API runs on this machine, for development); width and height are whole pixels from 1 to 10000. Logo and cover are decoration beside the studio's name: `alt=""`, and the `Image`'s `alt` is not read. Never a CSS `url()`. The cover is the hero image, and the same field will carry TAT-116's cover photo.
6. **Sections: `artists` and `inquiry`, on the studio page only.** Read from the contract's `{ type, props }` items in order, unknown and repeated types dropped, `props` not read; anything but a list is the default order; `inquiry` is added at the end when missing. An empty or all-unknown list therefore shows the hero, the inquiry and the footer.
7. **Unknown theme key: the default theme.** The contract's example `classic` is unknown.
8. **No attribute is added to the default markup.** The default theme's HTML is byte for byte what the pages render today; Task 0 records it from the pre-change code and later tests compare against that recording.

## What TAT-56 must add (platform and contract; not in this plan, for the human)

This plan's types and checks are what TAT-56 feeds. It needs, in this order:

1. **The contract** (`packages/types/openapi.yaml`, then `pnpm --filter @tattoo-drip/types generate`): `storefront: { $ref: "#/components/schemas/StorefrontConfiguration" }` on `Studio`, required like every `Studio` property, and `StorefrontConfiguration` narrowed to what the storefront reads: `theme` enum `[stencil-and-ink]`; `branding.colors` with only `accent` and `accentDark`, each `^#[0-9a-fA-F]{6}$` or null; `branding.font` enum `[eczar, serif, sans]` or null; `branding.logo` and `branding.heroImage` an `Image` or null; `sections` items `{ type: enum [artists, inquiry], props: {} }`. Replace the examples `classic`, `primary`, `hero`, `portfolio` and `services`. Then, in the storefront, `storefrontInput` reads `studio.storefront` without the cast; nothing else there changes (`parseThemeConfig` keeps checking whatever arrives).
2. **Storage and validation**: structured values only, never HTML or CSS, with the same allow-lists; refuse an accent under 4.5:1 on `#f7f3ee` and an `accentDark` under 4.5:1 on `#14110f` (the Stencil & Ink spec: "the platform refuses an accent below 4.5:1 against paper"), so an owner sees the problem when saving instead of the violet coming back.
3. **Images**: the logo through `ImageService` with a new public purpose; `heroImage` is TAT-116's cover photo (one stored image and one upload, sent as `branding.heroImage`), not a second upload. Public URLs must be on the API's origin, as `APP_URL` + `/uploads` is today.
4. **The public read**: `public_studio_transformer.ts` sends `storefront`. The studio read and the page are each cached up to 60 s, so a saved change can take about a minute to show.
5. **The preview link**: the storefront has no draft preview (it shows only what the API serves); TAT-56 has to decide what its preview opens.

## Task 0: Preconditions and the recorded default markup

The snapshot is recorded here from the code as it is now, BEFORE any change: that is what makes it the proof that the default theme looks the same later. Do not change any file in `src/` in this task.

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`. Use that PATH prefix for every `pnpm` command below.
- [ ] `git branch --show-current` prints `harublank00/tat-54-theme-system-driven-by-storefrontconfiguration`; `git status --short` prints nothing; `git log --oneline -5` shows this plan's commit on top of `96fb901`.
- [ ] Run the storefront tests: `ℹ tests 629`, `ℹ pass 629`, `ℹ fail 0`. Anything else: STOP.
- [ ] Run the storefront typecheck: no error.
- [ ] Read these files once, whole: `apps/storefront/src/studio/components/pages.tsx`, `apps/storefront/src/studio/loaders.ts`, `apps/storefront/src/routes/index.tsx`, `apps/storefront/src/routes/artists/$slug.tsx`, `apps/storefront/test/studio/fixtures.ts`, `apps/storefront/test/studio/render.test.ts`.

**New file** `apps/storefront/test/studio/snapshot.ts` (create it with exactly this content):

```ts
/** The default theme's recorded markup (TAT-54), shared by the tests that compare against it. */
export const SNAPSHOT_FILE = new URL(
	"./default-theme.snapshot.json",
	import.meta.url,
);

/** Where two renders first differ, with a little of each around it. */
export function firstDifference(actual: string, expected = ""): string {
	let index = 0;
	while (
		index < actual.length &&
		index < expected.length &&
		actual[index] === expected[index]
	) {
		index += 1;
	}
	const from = Math.max(0, index - 40);
	return `first difference at ${index}: expected "${expected.slice(from, index + 80)}", got "${actual.slice(from, index + 80)}"`;
}
```

**New file** `apps/storefront/test/studio/default-theme.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtistPage, StudioPage } from "../../src/studio/components/pages.tsx";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { firstDifference, SNAPSHOT_FILE } from "./snapshot.ts";

/**
 * The studio page's markup as it was before themes (TAT-54), recorded from
 * that code: the default theme must render exactly this. When the snapshot
 * file is missing, this test writes it and fails once; run the tests again.
 * To accept a deliberate change to the default look, delete the file, run
 * the tests twice and review its diff.
 */
function renderPages(): Record<string, string> {
	const artistHtml = (slug: string) => {
		const data = artistPageData(STUDIO, [SITA, ARJUN], slug, ORIGIN);
		assert.ok(data, slug);
		return renderToStaticMarkup(createElement(ArtistPage, { data }));
	};
	return {
		studio: renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(STUDIO, [SITA, ARJUN], ORIGIN),
			}),
		),
		empty: renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(EMPTY_STUDIO, [], ORIGIN),
			}),
		),
		closed: renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(CLOSED_STUDIO, [ARJUN], ORIGIN),
			}),
		),
		"artist-sita": artistHtml("sita"),
		"artist-arjun": artistHtml("arjun"),
	};
}

test("the studio and artist pages render as they did before themes (TAT-54)", () => {
	const pages = renderPages();
	if (!existsSync(SNAPSHOT_FILE)) {
		writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(pages, null, "\t")}\n`);
		assert.fail(
			"Recorded test/studio/default-theme.snapshot.json. Run the tests again.",
		);
	}
	const expected = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Record<
		string,
		string
	>;
	assert.deepEqual(Object.keys(pages), Object.keys(expected));
	for (const [name, html] of Object.entries(pages)) {
		assert.ok(
			html === expected[name],
			`${name}: ${firstDifference(html, expected[name])}`,
		);
	}
});
```

- [ ] Run the storefront tests. Expected red (this first run records the snapshot): `ℹ tests 630`, `ℹ pass 629`, `ℹ fail 1`. The one failing test is "the studio and artist pages render as they did before themes (TAT-54)" with `AssertionError [ERR_ASSERTION]: Recorded test/studio/default-theme.snapshot.json. Run the tests again.` The file `apps/storefront/test/studio/default-theme.snapshot.json` now exists (about 20 KB). Any other failure: STOP.
- [ ] Run the storefront tests again. Expected: `ℹ tests 630`, `ℹ pass 630`, `ℹ fail 0`.
- [ ] `git status --short` lists exactly the three new files in `apps/storefront/test/studio/`: `default-theme.snapshot.json`, `default-theme.test.ts`, `snapshot.ts`. Do not open or edit the snapshot file.
- [ ] Commit:

```bash
git add apps/storefront/test/studio/snapshot.ts apps/storefront/test/studio/default-theme.test.ts apps/storefront/test/studio/default-theme.snapshot.json
git commit -m "test(storefront): record the studio pages' markup before themes (TAT-54)" -m "The snapshot is what StudioPage and ArtistPage render before any theme code; the default theme must match it." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 1: Colour contrast helpers

`color.ts` computes WCAG 2.x contrast between `#rrggbb` colours and mixes two colours. Everything else in this plan that decides about contrast uses it.

**New file** `apps/storefront/test/studio/theme-color.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	contrastRatio,
	MIN_TEXT_CONTRAST,
	mixColors,
	relativeLuminance,
} from "../../src/studio/theme/color.ts";

/** A ratio as the stylesheet's comment writes it: one decimal. */
const rounded = (ratio: number) => Math.round(ratio * 10) / 10;

describe("contrastRatio (TAT-54)", () => {
	test("black on white is 21, a colour on itself 1, in either order", () => {
		assert.equal(contrastRatio("#000000", "#ffffff"), 21);
		assert.equal(contrastRatio("#ffffff", "#000000"), 21);
		assert.equal(contrastRatio("#777777", "#777777"), 1);
		assert.equal(relativeLuminance("#000000"), 0);
		assert.equal(relativeLuminance("#ffffff"), 1);
		assert.equal(MIN_TEXT_CONTRAST, 4.5);
	});

	test("matches the contrast src/styles.css measured for its palette", () => {
		const light = [
			["#1c1917", 15.8],
			["#5e5650", 6.5],
			["#43389a", 8.4],
			["#8c8279", 3.4],
		] as const;
		for (const [color, ratio] of light) {
			assert.equal(rounded(contrastRatio(color, "#f7f3ee")), ratio, color);
		}
		const dark = [
			["#efe9e2", 15.6],
			["#a89f96", 7.2],
			["#a99cff", 8.0],
			["#6d645c", 3.2],
		] as const;
		for (const [color, ratio] of dark) {
			assert.equal(rounded(contrastRatio(color, "#14110f")), ratio, color);
		}
	});

	test("refuses anything but #rrggbb in lowercase", () => {
		for (const color of [
			"red",
			"#fff",
			"#FFFFFF",
			"#ffffff ",
			"ffffff",
			"#ffffff;color:red",
			"",
		]) {
			assert.throws(() => contrastRatio(color, "#ffffff"), color);
		}
	});
});

describe("mixColors (TAT-54)", () => {
	test("moves one colour toward another, channel by channel", () => {
		assert.equal(mixColors("#000000", "#ffffff", 0.5), "#808080");
		assert.equal(mixColors("#43389a", "#f7f3ee", 0), "#43389a");
		assert.equal(mixColors("#43389a", "#f7f3ee", 1), "#f7f3ee");
		assert.equal(mixColors("#ff0000", "#0000ff", 0.25), "#bf0040");
	});

	test("refuses anything but #rrggbb in lowercase", () => {
		assert.throws(() => mixColors("blue", "#ffffff", 0.5));
		assert.throws(() => mixColors("#000000", "url(x)", 0.5));
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 631`, `ℹ pass 630`, `ℹ fail 1`. The `✖ failing tests:` list names only `✖ test/studio/theme-color.test.ts`, and higher up the output says `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` with a path ending in `src/studio/theme/color.ts`. Any other failure: STOP.

**New file** `apps/storefront/src/studio/theme/color.ts` (create it with exactly this content):

```ts
/**
 * Colour arithmetic for a studio's brand colours (TAT-54). Pure. Every
 * colour here is "#rrggbb" in lowercase: readHexColor (config.ts) is the only
 * way a studio's value gets in, and anything else throws.
 */

/** WCAG 2.x AA: the least contrast for text of body size. */
export const MIN_TEXT_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/;

function channels(color: string): number[] {
	if (!HEX.test(color)) throw new Error("Not a #rrggbb colour.");
	return [1, 3, 5].map((start) =>
		Number.parseInt(color.slice(start, start + 2), 16),
	);
}

/** WCAG 2.x relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(color: string): number {
	const [r, g, b] = channels(color).map((value) => {
		const c = value / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 (the same) to 21 (black on white), in either order. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `from` moved `amount` (0 to 1) of the way to `to`, channel by channel. */
export function mixColors(from: string, to: string, amount: number): string {
	const target = channels(to);
	const mixed = channels(from).map((value, index) =>
		Math.round(value + (target[index] - value) * amount),
	);
	return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 635`, `ℹ pass 635`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/color.ts apps/storefront/test/studio/theme-color.test.ts
git commit -m "feat(storefront): add colour contrast helpers for studio themes (TAT-54)" -m "WCAG 2.x luminance and contrast ratio, and channel mixing, for #rrggbb colours only." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 2: Theme keys, font keys and the section rules

`config.ts` starts with the lists of known keys, the `ThemeConfig` type, the default and three readers. Each reader takes `unknown` and returns a known key, else the default.

**New file** `apps/storefront/test/studio/theme-config.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	FONT_KEYS,
	readFontKey,
	readSections,
	readThemeKey,
	SECTION_KEYS,
	THEME_KEYS,
	THEME_SECTIONS,
} from "../../src/studio/theme/config.ts";

/** Strings no allow-list may let through (TAT-54). */
const HOSTILE_STRINGS = [
	"red;background:url(//evil.example/x.png)",
	"}</style><script>alert(1)</script>",
	"url(https://evil.example/x.png)",
	"expression(alert(1))",
	"javascript:alert(1)",
	"x".repeat(100_000),
	"कलाकार",
	"\u0000",
	"stencil-and-ink\u0000",
	"__proto__",
	"constructor",
	"toString",
	"",
];

/** Values of the wrong type. */
const WRONG_TYPES = [
	undefined,
	null,
	0,
	1,
	true,
	["stencil-and-ink"],
	{ toString: () => "stencil-and-ink" },
	() => "stencil-and-ink",
];

describe("readThemeKey (TAT-54)", () => {
	test("a theme this app has is kept", () => {
		assert.deepEqual(THEME_KEYS, ["stencil-and-ink"]);
		assert.equal(readThemeKey("stencil-and-ink"), "stencil-and-ink");
	});

	test("anything else is the default theme", () => {
		for (const value of [
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
			// The contract's example, and near misses.
			"classic",
			"Stencil-and-ink",
			" stencil-and-ink",
			"stencil-and-ink ",
		]) {
			assert.equal(readThemeKey(value), "stencil-and-ink", String(value));
		}
	});
});

describe("readFontKey (TAT-54)", () => {
	test("a key from the fixed list is kept", () => {
		assert.deepEqual(FONT_KEYS, ["eczar", "serif", "sans"]);
		for (const key of FONT_KEYS) assert.equal(readFontKey(key), key);
	});

	test("anything else is Eczar: a font name never reaches the page", () => {
		for (const value of [
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
			"Comic Sans MS",
			"ECZAR",
			" eczar",
			"eczar;}",
			"serif, url(//evil.example/font.woff2)",
		]) {
			assert.equal(readFontKey(value), "eczar", String(value));
		}
	});
});

describe("readSections (TAT-54)", () => {
	const items = (...types: unknown[]) =>
		types.map((type) => ({ type, props: {} }));

	test("the default theme orders and hides the artists; the inquiry section is required", () => {
		assert.deepEqual(SECTION_KEYS, ["artists", "inquiry"]);
		assert.deepEqual(THEME_SECTIONS["stencil-and-ink"], {
			order: ["artists", "inquiry"],
			required: ["inquiry"],
		});
	});

	test("not a list: the theme's default order", () => {
		for (const value of [
			undefined,
			null,
			"artists,inquiry",
			{ 0: { type: "inquiry" } },
			42,
		]) {
			assert.deepEqual(
				readSections(value, "stencil-and-ink"),
				["artists", "inquiry"],
				String(value),
			);
		}
	});

	test("keeps the config's order", () => {
		assert.deepEqual(
			readSections(items("inquiry", "artists"), "stencil-and-ink"),
			["inquiry", "artists"],
		);
		assert.deepEqual(
			readSections(items("artists", "inquiry"), "stencil-and-ink"),
			["artists", "inquiry"],
		);
	});

	test("hides a section the config leaves out, but never the inquiry section", () => {
		assert.deepEqual(readSections(items("inquiry"), "stencil-and-ink"), [
			"inquiry",
		]);
		// Clients can always send an idea: a list without it gets it at the end.
		assert.deepEqual(readSections(items("artists"), "stencil-and-ink"), [
			"artists",
			"inquiry",
		]);
		assert.deepEqual(readSections([], "stencil-and-ink"), ["inquiry"]);
	});

	test("drops unknown and repeated keys, keeping the first of each", () => {
		assert.deepEqual(
			readSections(
				items("hero", "inquiry", "portfolio", "inquiry", "artists", "artists"),
				"stencil-and-ink",
			),
			["inquiry", "artists"],
		);
	});

	test("drops items that aren't { type } objects with a known key", () => {
		assert.deepEqual(
			readSections(
				[
					"artists",
					null,
					7,
					["artists"],
					{ type: 1 },
					{ type: "ARTISTS" },
					{ type: "artists " },
					{ kind: "artists" },
					Object.create({ type: "artists" }),
					...items(...HOSTILE_STRINGS),
				],
				"stencil-and-ink",
			),
			["inquiry"],
		);
	});

	test("reads at most 32 items of a long list", () => {
		const filler = items(...Array.from({ length: 32 }, () => "hero"));
		assert.deepEqual(
			readSections([...filler, ...items("artists")], "stencil-and-ink"),
			["inquiry"],
		);
		assert.deepEqual(
			readSections(
				[...items("artists"), ...items(...Array(100_000).fill("hero"))],
				"stencil-and-ink",
			),
			["artists", "inquiry"],
		);
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 636`, `ℹ pass 635`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-config.test.ts`, and higher up the output says `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` with a path ending in `src/studio/theme/config.ts`. Any other failure: STOP.

**New file** `apps/storefront/src/studio/theme/config.ts` (create it with exactly this content):

```ts
/**
 * A studio's theme (TAT-54): the API's StorefrontConfiguration as the page
 * uses it, after every value has passed an allow-list. Pure. A studio never
 * sends markup, CSS or scripts: its theme is one of this app's React
 * components, picked by key; colours are "#rrggbb"; the font is a key into a
 * fixed list; images are URLs on the API's own origin; sections are known
 * keys. A value that is missing, of the wrong type or not on its list falls
 * back to the default for that value alone.
 */

/** The themes this app has, by key. */
export const THEME_KEYS = ["stencil-and-ink"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export const DEFAULT_THEME_KEY: ThemeKey = "stencil-and-ink";

/** The studio page's sections that a theme can order and hide. */
export const SECTION_KEYS = ["artists", "inquiry"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface ThemeSections {
	/** Every section the theme shows, in its default order. */
	readonly order: readonly SectionKey[];
	/** Always shown: added at the end when the config leaves one out. */
	readonly required: readonly SectionKey[];
}

/** What each theme supports. The inquiry section is required: a client can always send an idea. */
export const THEME_SECTIONS: Record<ThemeKey, ThemeSections> = {
	"stencil-and-ink": { order: ["artists", "inquiry"], required: ["inquiry"] },
};

/** The display faces a studio can pick (branding.ts maps each to a fixed stack). */
export const FONT_KEYS = ["eczar", "serif", "sans"] as const;
export type FontKey = (typeof FONT_KEYS)[number];
export const DEFAULT_FONT: FontKey = "eczar";

/** A logo or cover image: a checked URL and its stored size. */
export interface BrandImage {
	readonly src: string;
	readonly width: number;
	readonly height: number;
}

export interface ThemeConfig {
	readonly key: ThemeKey;
	/** The sections to show, in order. */
	readonly sections: readonly SectionKey[];
	/** The light scheme's accent, "#rrggbb", or null for the theme's own. */
	readonly accent: string | null;
	/** The dark scheme's accent, "#rrggbb", or null: then it comes from `accent` (branding.ts). */
	readonly accentDark: string | null;
	readonly font: FontKey;
	readonly logo: BrandImage | null;
	/** The cover image above the hero: TAT-116's cover photo, once the platform serves it here. */
	readonly heroImage: BrandImage | null;
}

/** What every studio gets today: the Stencil & Ink page as TAT-97 and TAT-105 built it. */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
	key: DEFAULT_THEME_KEY,
	sections: THEME_SECTIONS[DEFAULT_THEME_KEY].order,
	accent: null,
	accentDark: null,
	font: DEFAULT_FONT,
	logo: null,
	heroImage: null,
};

/** At most this many section items are read; a longer list is cut. */
const MAX_SECTION_ITEMS = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function isOneOf<T extends string>(
	list: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (list as readonly string[]).includes(value)
	);
}

/** A theme this app has, else the default. */
export function readThemeKey(value: unknown): ThemeKey {
	return isOneOf(THEME_KEYS, value) ? value : DEFAULT_THEME_KEY;
}

/** A font key from FONT_KEYS, else the default (Eczar). */
export function readFontKey(value: unknown): FontKey {
	return isOneOf(FONT_KEYS, value) ? value : DEFAULT_FONT;
}

/**
 * The sections to show, in the config's order: the API's `{ type, props }`
 * items whose `type` the theme supports, each once (the first one wins),
 * then each required section the list left out. Anything but a list is the
 * theme's default order. `props` is not read.
 */
export function readSections(value: unknown, theme: ThemeKey): SectionKey[] {
	const { order, required } = THEME_SECTIONS[theme];
	if (!Array.isArray(value)) return [...order];
	const sections: SectionKey[] = [];
	for (const item of value.slice(0, MAX_SECTION_ITEMS)) {
		const type = own(item, "type");
		if (isOneOf(order, type) && !sections.includes(type)) {
			sections.push(type);
		}
	}
	for (const key of required) {
		if (!sections.includes(key)) sections.push(key);
	}
	return sections;
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 646`, `ℹ pass 646`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/config.ts apps/storefront/test/studio/theme-config.test.ts
git commit -m "feat(storefront): add theme keys, font keys and the section rules (TAT-54)" -m "readThemeKey, readFontKey and readSections accept known keys only; the inquiry section is always shown." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 3: Brand colours are `#rrggbb` only

### 3a. The failing test

**Edit 3.1** `apps/storefront/test/studio/theme-config.test.ts`. Find:

```ts
	readFontKey,
	readSections,
```

Replace with:

```ts
	readFontKey,
	readHexColor,
	readSections,
```

**Append to** `apps/storefront/test/studio/theme-config.test.ts` (at the very end of the file, after the last line `});`, with one empty line between):

```ts
describe("readHexColor (TAT-54)", () => {
	test("#rrggbb is kept, lowercased", () => {
		assert.equal(readHexColor("#b91c1c"), "#b91c1c");
		assert.equal(readHexColor("#B91C1C"), "#b91c1c");
		assert.equal(readHexColor("#000000"), "#000000");
	});

	test("anything else is null: nothing but a colour reaches a CSS variable", () => {
		for (const value of [
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
			"red",
			"#fff",
			"#b91c1c80",
			"#b91c1",
			"#b91c1g",
			"b91c1c",
			" #b91c1c",
			"#b91c1c ",
			"#b91c1c\n",
			"#b91c1c;",
			"#b91c1c;color:red",
			"#b91c1c}html{color:red",
			"#b91c1c\u0000",
			"rgb(185, 28, 28)",
			"var(--ink)",
			"#ｂ９１ｃ１ｃ",
			"#१२३४५६",
			`#${"a".repeat(100_000)}`,
			0xb91c1c,
		]) {
			assert.equal(readHexColor(value), null, JSON.stringify(value));
		}
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 636`, `ℹ pass 635`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-config.test.ts`, and higher up the output says `SyntaxError: The requested module '../../src/studio/theme/config.ts' does not provide an export named 'readHexColor'`. Any other failure: STOP.

### 3b. The code

**Append to** `apps/storefront/src/studio/theme/config.ts` (at the very end of the file, with one empty line between):

```ts
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** "#rrggbb", lowercased, or null: nothing else can reach a CSS variable. */
export function readHexColor(value: unknown): string | null {
	return typeof value === "string" && HEX_COLOR.test(value)
		? value.toLowerCase()
		: null;
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 648`, `ℹ pass 648`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/config.ts apps/storefront/test/studio/theme-config.test.ts
git commit -m "feat(storefront): accept brand colours as #rrggbb only (TAT-54)" -m "readHexColor lowercases a #rrggbb value and refuses everything else, hostile CSS included." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 4: Brand images come from the API's origin only

### 4a. The failing test

**Edit 4.1** `apps/storefront/test/studio/theme-config.test.ts`. Find:

```ts
	FONT_KEYS,
	readFontKey,
```

Replace with:

```ts
	FONT_KEYS,
	readBrandImage,
	readFontKey,
```

**Append to** `apps/storefront/test/studio/theme-config.test.ts` (at the very end of the file, with one empty line between):

```ts
describe("readBrandImage (TAT-54)", () => {
	const API = "https://api.example.com";
	const LOGO = "https://api.example.com/uploads/tenants/t/brand_logo/logo.png";
	const image = (
		url: unknown,
		width: unknown = 600,
		height: unknown = 200,
	) => ({
		url,
		width,
		height,
		alt: "Black Needle",
	});

	test("an image on the API's origin is kept: its URL and its size", () => {
		assert.deepEqual(readBrandImage(image(LOGO), API), {
			src: LOGO,
			width: 600,
			height: 200,
		});
		assert.deepEqual(
			readBrandImage(image("https://API.example.com/uploads/a.png"), API),
			{ src: "https://api.example.com/uploads/a.png", width: 600, height: 200 },
		);
	});

	test("a URL from anywhere else, or not https, is no image", () => {
		for (const url of [
			"javascript:alert(1)",
			"data:image/svg+xml,<svg onload=alert(1)>",
			"data:image/png;base64,iVBORw0KGgo=",
			"blob:https://api.example.com/0f0e",
			"http://api.example.com/uploads/a.png",
			"https://evil.example/uploads/a.png",
			"https://api.example.com.evil.example/a.png",
			"https://api.example.com@evil.example/a.png",
			"https://user:secret@api.example.com/a.png",
			"https://api.example.com:8443/a.png",
			"https://аpi.example.com/a.png",
			"//evil.example/a.png",
			"/uploads/a.png",
			"uploads/a.png",
			"url(https://api.example.com/a.png)",
			" https://api.example.com/a.png",
			"https://api.example.com/a.png\n",
			"https://api.example.com/a b.png",
			"https://api.example.com/a\tb.png",
			"https://api.example.com/a\u0000.png",
			`https://api.example.com/${"a".repeat(3000)}.png`,
			...HOSTILE_STRINGS,
			...WRONG_TYPES,
		]) {
			assert.equal(readBrandImage(image(url), API), null, JSON.stringify(url));
		}
	});

	test("a URL that would break out of CSS is harmless: it is only ever an <img> src, percent-encoded", () => {
		const breakout = readBrandImage(
			image('https://api.example.com/a.png");background:url(//evil.example'),
			API,
		);
		assert.ok(breakout);
		assert.doesNotMatch(breakout.src, /"/);
		assert.match(breakout.src, /^https:\/\/api\.example\.com\/a\.png%22\)/);
		const devanagari = readBrandImage(
			image("https://api.example.com/uploads/लोगो.png"),
			API,
		);
		assert.equal(
			devanagari?.src,
			"https://api.example.com/uploads/%E0%A4%B2%E0%A5%8B%E0%A4%97%E0%A5%8B.png",
		);
	});

	test("its size must be whole pixels from 1 to 10000", () => {
		for (const [width, height] of [
			[0, 200],
			[600, -1],
			[1.5, 200],
			["600", 200],
			[600, Number.NaN],
			[Number.POSITIVE_INFINITY, 200],
			[10_001, 200],
			[null, 200],
		]) {
			assert.equal(
				readBrandImage(image(LOGO, width, height), API),
				null,
				`${width} x ${height}`,
			);
		}
		assert.equal(readBrandImage({ url: LOGO }, API), null, "no size");
		assert.ok(readBrandImage(image(LOGO, 10_000, 1), API));
	});

	test("not an Image object, or no origin to check against, is no image", () => {
		for (const value of [LOGO, null, undefined, [], [LOGO], 42]) {
			assert.equal(readBrandImage(value, API), null, String(value));
		}
		assert.equal(readBrandImage(Object.create(image(LOGO)), API), null);
		assert.equal(readBrandImage(image(LOGO), null), null);
		assert.equal(readBrandImage(image(LOGO), "not an origin"), null);
	});

	test("plain http only from an API on this machine (development)", () => {
		const local = "http://localhost:3333";
		assert.deepEqual(
			readBrandImage(image("http://localhost:3333/uploads/a.png"), local),
			{ src: "http://localhost:3333/uploads/a.png", width: 600, height: 200 },
		);
		assert.equal(
			readBrandImage(image("http://api.test/uploads/a.png"), "http://api.test"),
			null,
		);
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 636`, `ℹ pass 635`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-config.test.ts`, and higher up the output says `SyntaxError: The requested module '../../src/studio/theme/config.ts' does not provide an export named 'readBrandImage'`. Any other failure: STOP.

### 4b. The code

**Edit 4.2** `apps/storefront/src/studio/theme/config.ts` (the first two lines of the file). Find:

```ts
/**
 * A studio's theme (TAT-54): the API's StorefrontConfiguration as the page
```

Replace with:

```ts
import { safeImageUrl } from "../links.ts";

/**
 * A studio's theme (TAT-54): the API's StorefrontConfiguration as the page
```

**Append to** `apps/storefront/src/studio/theme/config.ts` (at the very end of the file, with one empty line between):

```ts
/** Stored images are at most 2048 px (TAT-44); anything outside this is no image. */
const MAX_IMAGE_SIDE = 10_000;

/** Hosts on this machine, where the API may be plain http (development). */
const LOCAL_HOST =
	/^(?:localhost|127\.0\.0\.1|\[::1\]|[a-z0-9.-]+\.localhost)$/;

/**
 * A logo or cover image from the API's `Image` (url, width, height; `alt` is
 * not read: both are decoration beside the studio's name), or null. The URL
 * has no space or control character, passes safeImageUrl (http or https, no
 * credentials, at most 2048 characters) and is on exactly `imageOrigin`, the
 * API's origin; it is https unless the API runs on this machine. Without an
 * origin no image is accepted.
 */
export function readBrandImage(
	value: unknown,
	imageOrigin: string | null,
): BrandImage | null {
	const url = own(value, "url");
	const width = own(value, "width");
	const height = own(value, "height");
	if (imageOrigin === null || typeof url !== "string") return null;
	if (/[\s\p{Cc}]/u.test(url)) return null;
	const src = safeImageUrl(url);
	if (src === null) return null;
	const parsed = new URL(src);
	if (parsed.origin !== originOf(imageOrigin)) return null;
	if (parsed.protocol !== "https:" && !LOCAL_HOST.test(parsed.hostname)) {
		return null;
	}
	if (!isImageSide(width) || !isImageSide(height)) return null;
	return { src, width, height };
}

function originOf(value: string): string | null {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function isImageSide(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= MAX_IMAGE_SIDE
	);
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 654`, `ℹ pass 654`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/config.ts apps/storefront/test/studio/theme-config.test.ts
git commit -m "feat(storefront): accept brand images from the API's origin only (TAT-54)" -m "readBrandImage keeps an https URL on exactly the API's origin and its stored size; anything else is no image." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 5: The whole configuration, value by value

### 5a. The failing test

**Edit 5.1** `apps/storefront/test/studio/theme-config.test.ts`. Find:

```ts
import {
	FONT_KEYS,
	readBrandImage,
```

Replace with:

```ts
import {
	DEFAULT_THEME_CONFIG,
	FONT_KEYS,
	parseThemeConfig,
	readBrandImage,
```

**Append to** `apps/storefront/test/studio/theme-config.test.ts` (at the very end of the file, with one empty line between):

```ts
describe("parseThemeConfig (TAT-54)", () => {
	const API = "https://api.example.com";
	const LOGO = {
		url: "https://api.example.com/uploads/tenants/t/brand_logo/logo.png",
		width: 600,
		height: 200,
		alt: null,
	};
	const COVER = {
		url: "https://api.example.com/uploads/tenants/t/cover_photo/cover.jpg",
		width: 2048,
		height: 1024,
		alt: null,
	};
	const BRANDED = {
		theme: "stencil-and-ink",
		branding: {
			logo: LOGO,
			heroImage: COVER,
			colors: { accent: "#B91C1C", accentDark: "#fca5a5" },
			font: "serif",
		},
		sections: [
			{ type: "inquiry", props: {} },
			{ type: "artists", props: {} },
		],
	};

	test("nothing sent (every studio today) is the default theme", () => {
		assert.deepEqual(DEFAULT_THEME_CONFIG, {
			key: "stencil-and-ink",
			sections: ["artists", "inquiry"],
			accent: null,
			accentDark: null,
			font: "eczar",
			logo: null,
			heroImage: null,
		});
		for (const value of [
			undefined,
			null,
			"stencil-and-ink",
			42,
			true,
			[],
			[BRANDED],
		]) {
			assert.deepEqual(
				parseThemeConfig(value, API),
				DEFAULT_THEME_CONFIG,
				String(value),
			);
		}
	});

	test("a whole config, every value checked", () => {
		assert.deepEqual(parseThemeConfig(BRANDED, API), {
			key: "stencil-and-ink",
			sections: ["inquiry", "artists"],
			accent: "#b91c1c",
			accentDark: "#fca5a5",
			font: "serif",
			logo: { src: LOGO.url, width: 600, height: 200 },
			heroImage: { src: COVER.url, width: 2048, height: 1024 },
		});
	});

	test("one bad value falls back alone", () => {
		const parsed = parseThemeConfig(
			{
				...BRANDED,
				branding: {
					...BRANDED.branding,
					logo: { ...LOGO, url: "https://evil.example/logo.png" },
					colors: {
						accent: "red;background:url(//evil)",
						accentDark: "#fca5a5",
					},
				},
			},
			API,
		);
		assert.equal(parsed.logo, null);
		assert.equal(parsed.accent, null);
		assert.equal(parsed.accentDark, "#fca5a5");
		assert.equal(parsed.font, "serif");
		assert.deepEqual(parsed.heroImage, {
			src: COVER.url,
			width: 2048,
			height: 1024,
		});
		assert.deepEqual(parsed.sections, ["inquiry", "artists"]);
	});

	test("every value hostile or of the wrong type is the default theme", () => {
		const hostile = {
			theme: "}</style><script>alert(1)</script>",
			branding: {
				logo: { url: "javascript:alert(1)", width: 1, height: 1 },
				heroImage: {
					url: "data:image/svg+xml,<svg onload=alert(1)>",
					width: 1,
					height: 1,
				},
				colors: {
					accent: "expression(alert(1))",
					accentDark: "url(//evil.example/x.png)",
					primary: "#111111",
				},
				font: "Comic Sans MS; src: url(//evil.example/font.woff2)",
			},
			sections: "artists;inquiry",
		};
		assert.deepEqual(parseThemeConfig(hostile, API), DEFAULT_THEME_CONFIG);
		for (const branding of WRONG_TYPES) {
			assert.deepEqual(
				parseThemeConfig({ branding }, API),
				DEFAULT_THEME_CONFIG,
				String(branding),
			);
		}
	});

	test("reads own properties only, never inherited ones", () => {
		assert.deepEqual(
			parseThemeConfig(
				Object.create({ sections: [], branding: BRANDED.branding }),
				API,
			),
			DEFAULT_THEME_CONFIG,
		);
		assert.deepEqual(
			parseThemeConfig(
				JSON.parse(
					'{"__proto__": {"sections": []}, "branding": {"__proto__": {"font": "sans"}}}',
				),
				API,
			),
			DEFAULT_THEME_CONFIG,
		);
	});

	test("the contract's own example (theme classic, a primary colour, hero and portfolio sections)", () => {
		assert.deepEqual(
			parseThemeConfig(
				{
					theme: "classic",
					branding: { colors: { primary: "#111111" }, font: null },
					sections: [
						{ type: "hero", props: {} },
						{ type: "portfolio", props: {} },
					],
				},
				API,
			),
			{ ...DEFAULT_THEME_CONFIG, sections: ["inquiry"] },
		);
	});

	test("without the API's origin, images are dropped and the rest is kept", () => {
		const parsed = parseThemeConfig(BRANDED, null);
		assert.equal(parsed.logo, null);
		assert.equal(parsed.heroImage, null);
		assert.equal(parsed.accent, "#b91c1c");
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 636`, `ℹ pass 635`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-config.test.ts`, and higher up the output says `SyntaxError: The requested module '../../src/studio/theme/config.ts' does not provide an export named 'parseThemeConfig'`. Any other failure: STOP.

### 5b. The code

**Append to** `apps/storefront/src/studio/theme/config.ts` (at the very end of the file, with one empty line between):

```ts
/**
 * The studio's theme from whatever the API sent as `Studio.storefront`
 * (source.ts): `{ theme, branding: { logo, heroImage, colors: { accent,
 * accentDark }, font }, sections }`. Not an object (today: the API sends
 * nothing) is the default theme; each value is checked on its own, and one
 * that fails is that value's default. Images are accepted only from
 * `imageOrigin` (the API's origin; null accepts none).
 */
export function parseThemeConfig(
	input: unknown,
	imageOrigin: string | null,
): ThemeConfig {
	if (!isRecord(input)) return DEFAULT_THEME_CONFIG;
	const key = readThemeKey(own(input, "theme"));
	const branding = own(input, "branding");
	const colors = own(branding, "colors");
	return {
		key,
		sections: readSections(own(input, "sections"), key),
		accent: readHexColor(own(colors, "accent")),
		accentDark: readHexColor(own(colors, "accentDark")),
		font: readFontKey(own(branding, "font")),
		logo: readBrandImage(own(branding, "logo"), imageOrigin),
		heroImage: readBrandImage(own(branding, "heroImage"), imageOrigin),
	};
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 661`, `ℹ pass 661`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/config.ts apps/storefront/test/studio/theme-config.test.ts
git commit -m "feat(storefront): check a studio's theme configuration value by value (TAT-54)" -m "parseThemeConfig reads own properties only; each bad value falls back alone, anything but an object is the default." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 6: The brand's CSS, with a contrast guard per colour scheme

`branding.ts` turns a checked `ThemeConfig` into CSS text, or `null` for the default look. Decision 3 above says what it does with a colour that can't be read.

**New file** `apps/storefront/test/studio/theme-branding.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	accentTokens,
	brandingCss,
	DARK,
	DISPLAY_FACES,
	darkAccent,
	isSafeCss,
	LIGHT,
} from "../../src/studio/theme/branding.ts";
import { contrastRatio } from "../../src/studio/theme/color.ts";
import {
	DEFAULT_THEME_CONFIG,
	FONT_KEYS,
	type ThemeConfig,
} from "../../src/studio/theme/config.ts";

const theme = (values: Partial<ThemeConfig>): ThemeConfig => ({
	...DEFAULT_THEME_CONFIG,
	...values,
});

/** 64 colours across the whole cube: every channel 00, 55, aa or ff. */
const GRID = ["00", "55", "aa", "ff"].flatMap((r) =>
	["00", "55", "aa", "ff"].flatMap((g) =>
		["00", "55", "aa", "ff"].map((b) => `#${r}${g}${b}`),
	),
);

describe("the schemes' fixed colours (TAT-54)", () => {
	const css = readFileSync(
		new URL("../../src/styles.css", import.meta.url),
		"utf8",
	);
	/** The declarations from `start` to the next "}". */
	const block = (start: string) => {
		const from = css.indexOf(start);
		assert.ok(from >= 0, start);
		return css.slice(from, css.indexOf("}", from));
	};
	const light = block(":root {");
	const dark = block("@media (prefers-color-scheme: dark) {");

	test("are src/styles.css's paper, ink and muted ink", () => {
		assert.match(light, new RegExp(`--paper: ${LIGHT.paper};`));
		assert.match(light, new RegExp(`--ink: ${LIGHT.ink};`));
		assert.match(light, new RegExp(`--ink-muted: ${LIGHT.inkMuted};`));
		assert.match(dark, new RegExp(`--paper: ${DARK.paper};`));
		assert.match(dark, new RegExp(`--ink: ${DARK.ink};`));
		assert.match(dark, new RegExp(`--ink-muted: ${DARK.inkMuted};`));
	});

	test("--on-stencil is each scheme's paper, so text on any accent that passes still passes", () => {
		assert.match(light, new RegExp(`--on-stencil: ${LIGHT.paper};`));
		assert.match(dark, new RegExp(`--on-stencil: ${DARK.paper};`));
	});
});

describe("accentTokens (TAT-54)", () => {
	test("a readable accent gets a darker hover and a light wash", () => {
		assert.deepEqual(accentTokens("#b91c1c", LIGHT), {
			stencil: "#b91c1c",
			stencilStrong: "#921b1b",
			stencilWash: "#f0d9d5",
		});
	});

	test("an accent under 4.5:1 on the paper is refused: the scheme keeps the theme's violet", () => {
		assert.equal(accentTokens("#facc15", LIGHT), null);
		assert.equal(accentTokens("#ffffff", LIGHT), null);
		assert.equal(accentTokens("#b91c1c", DARK), null);
	});

	test("whatever it keeps, every text on it passes 4.5:1, in both schemes", () => {
		for (const scheme of [LIGHT, DARK]) {
			for (const accent of GRID) {
				const tokens = accentTokens(accent, scheme);
				if (!tokens) {
					assert.ok(contrastRatio(accent, scheme.paper) < 4.5, accent);
					continue;
				}
				// Accent text on paper, and paper text (--on-stencil) on the accent and its hover.
				assert.ok(contrastRatio(tokens.stencil, scheme.paper) >= 4.5, accent);
				assert.ok(
					contrastRatio(tokens.stencilStrong, scheme.paper) >= 4.5,
					accent,
				);
				// The accent, the ink and the muted ink on the wash.
				for (const text of [tokens.stencil, scheme.ink, scheme.inkMuted]) {
					assert.ok(
						contrastRatio(text, tokens.stencilWash) >= 4.5,
						`${accent} ${text}`,
					);
				}
			}
		}
	});
});

describe("darkAccent (TAT-54)", () => {
	test("a readable accentDark is used as it is", () => {
		assert.equal(
			darkAccent({ accent: "#b91c1c", accentDark: "#fca5a5" }),
			"#fca5a5",
		);
	});

	test("else the accent, lightened until it reads on the dark paper", () => {
		assert.equal(
			darkAccent({ accent: "#b91c1c", accentDark: null }),
			"#ce6060",
		);
		assert.equal(
			darkAccent({ accent: "#b91c1c", accentDark: "#1c1917" }),
			"#ce6060",
		);
		// Already readable on the dark paper: unchanged.
		assert.equal(
			darkAccent({ accent: "#facc15", accentDark: null }),
			"#facc15",
		);
		for (const accent of GRID) {
			const dark = darkAccent({ accent, accentDark: null });
			assert.ok(dark, accent);
			assert.ok(contrastRatio(dark, DARK.paper) >= 4.5, accent);
		}
	});

	test("neither: null, the theme's own", () => {
		assert.equal(darkAccent({ accent: null, accentDark: null }), null);
		assert.equal(darkAccent({ accent: null, accentDark: "#1c1917" }), null);
	});
});

describe("DISPLAY_FACES (TAT-54)", () => {
	test("Eczar is the stylesheet's own; the others are on the phone already", () => {
		assert.deepEqual(Object.keys(DISPLAY_FACES), [...FONT_KEYS]);
		assert.equal(DISPLAY_FACES.eczar, null);
		assert.equal(DISPLAY_FACES.sans, "var(--body-face)");
		const serif = DISPLAY_FACES.serif ?? "";
		assert.match(serif, /Devanagari/);
		assert.match(serif, /, serif$/);
		assert.doesNotMatch(serif, /url\(|['"]/);
	});
});

describe("isSafeCss (TAT-54)", () => {
	test("refuses anything that could end the <style> or reach outside it", () => {
		for (const css of [
			"}</style><script>alert(1)</script>",
			"html{background:url(//evil.example/x.png)}",
			'html{font-family:"x"}',
			"html{font-family:'x'}",
			"html{color:red}/*",
			"html{content:\\3c}",
			"a&b",
			"html{color:red}\u0000",
			"html{color:red}\n",
			"<!--",
		]) {
			assert.equal(isSafeCss(css), false, css);
		}
		assert.equal(isSafeCss(""), true);
	});
});

describe("brandingCss (TAT-54)", () => {
	test("the default theme adds no CSS", () => {
		assert.equal(brandingCss(DEFAULT_THEME_CONFIG), null);
	});

	test("an accent sets the stencil tokens in each scheme's media query", () => {
		assert.equal(
			brandingCss(theme({ accent: "#b91c1c" })),
			"@media (prefers-color-scheme: light){html:root{--stencil:#b91c1c;--stencil-strong:#921b1b;--stencil-wash:#f0d9d5}}" +
				"@media (prefers-color-scheme: dark){html:root{--stencil:#ce6060;--stencil-strong:#d68281;--stencil-wash:#231715}}",
		);
		assert.equal(
			brandingCss(theme({ accent: "#b91c1c", accentDark: "#fca5a5" })),
			"@media (prefers-color-scheme: light){html:root{--stencil:#b91c1c;--stencil-strong:#921b1b;--stencil-wash:#f0d9d5}}" +
				"@media (prefers-color-scheme: dark){html:root{--stencil:#fca5a5;--stencil-strong:#f9b6b4;--stencil-wash:#302321}}",
		);
	});

	test("a scheme the accent can't be read in keeps the theme's violet", () => {
		// Yellow fails on the light paper and passes on the dark one.
		assert.equal(
			brandingCss(theme({ accent: "#facc15" })),
			"@media (prefers-color-scheme: dark){html:root{--stencil:#facc15;--stencil-strong:#f7d348;--stencil-wash:#302710}}",
		);
		assert.equal(brandingCss(theme({ accentDark: "#1c1917" })), null);
	});

	test("a font other than Eczar sets the display face", () => {
		assert.equal(
			brandingCss(theme({ font: "serif" })),
			"html:root{--display-face:Georgia, Noto Serif, Noto Serif Devanagari, Times New Roman, serif}",
		);
		assert.equal(
			brandingCss(theme({ font: "sans" })),
			"html:root{--display-face:var(--body-face)}",
		);
	});

	test("never writes anything isSafeCss refuses, whatever the accent", () => {
		for (const accent of GRID) {
			for (const font of FONT_KEYS) {
				const css = brandingCss(theme({ accent, accentDark: accent, font }));
				if (css !== null) assert.ok(isSafeCss(css), css);
			}
		}
	});

	test("a value that slipped past the checks is never written", () => {
		// Only possible if config.ts were bypassed: brandingCss still refuses it.
		assert.throws(() =>
			brandingCss(theme({ accent: "#fff}</style><script>" })),
		);
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 662`, `ℹ pass 661`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-branding.test.ts`, and higher up the output says `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` with a path ending in `src/studio/theme/branding.ts`. Any other failure: STOP.

**New file** `apps/storefront/src/studio/theme/branding.ts` (create it with exactly this content):

```ts
import { contrastRatio, MIN_TEXT_CONTRAST, mixColors } from "./color.ts";
import type { FontKey, ThemeConfig } from "./config.ts";

/**
 * The CSS a studio's brand adds to its two pages (TAT-54): src/styles.css's
 * stencil tokens for each colour scheme, and the display face. It is built
 * only from ThemeConfig's checked values and the fixed text in this file,
 * and checked once more (isSafeCss) before it leaves, because the router
 * writes it into a <style> in the head as it is. null means the theme's own
 * look: no <style> at all.
 */

/** A colour scheme's fixed colours: src/styles.css's values (test/studio/theme-branding.test.ts pins them). */
export interface Scheme {
	readonly paper: string;
	readonly ink: string;
	readonly inkMuted: string;
}

export const LIGHT: Scheme = {
	paper: "#f7f3ee",
	ink: "#1c1917",
	inkMuted: "#5e5650",
};

export const DARK: Scheme = {
	paper: "#14110f",
	ink: "#efe9e2",
	inkMuted: "#a89f96",
};

/** What an accent sets: --stencil (actions, links, focus, the frame), its hover and its wash. */
export interface AccentTokens {
	readonly stencil: string;
	readonly stencilStrong: string;
	readonly stencilWash: string;
}

/** The wash is the paper with this much of the accent, the first that text on it can still be read on. */
const WASH_SHARES = [0.12, 0.08, 0.04];

/**
 * The stencil tokens for `accent` on `scheme`'s paper, or null when text in
 * the accent can't be read on that paper (under 4.5:1): the scheme then keeps
 * the theme's own violet, all three tokens. --on-stencil (text on the
 * accent) stays the paper colour, which reads as well on the accent as the
 * accent does on the paper. The hover colour is a quarter of the way to the
 * ink, if text on it still passes; the wash is a tint of the paper on which
 * the accent, the ink and the muted ink all pass, else the paper itself.
 */
export function accentTokens(
	accent: string,
	scheme: Scheme,
): AccentTokens | null {
	if (contrastRatio(accent, scheme.paper) < MIN_TEXT_CONTRAST) return null;
	const strong = mixColors(accent, scheme.ink, 0.25);
	return {
		stencil: accent,
		stencilStrong:
			contrastRatio(strong, scheme.paper) >= MIN_TEXT_CONTRAST
				? strong
				: accent,
		stencilWash: washFor(accent, scheme),
	};
}

function washFor(accent: string, scheme: Scheme): string {
	for (const share of WASH_SHARES) {
		const wash = mixColors(scheme.paper, accent, share);
		const readable = [accent, scheme.ink, scheme.inkMuted].every(
			(text) => contrastRatio(text, wash) >= MIN_TEXT_CONTRAST,
		);
		if (readable) return wash;
	}
	return scheme.paper;
}

/**
 * The dark scheme's accent: `accentDark` when it can be read on the dark
 * paper; else `accent`, lightened toward white a tenth at a time until it
 * can (white always can); else null, the theme's own.
 */
export function darkAccent(
	config: Pick<ThemeConfig, "accent" | "accentDark">,
): string | null {
	if (
		config.accentDark !== null &&
		contrastRatio(config.accentDark, DARK.paper) >= MIN_TEXT_CONTRAST
	) {
		return config.accentDark;
	}
	if (config.accent === null) return null;
	for (let step = 0; step <= 10; step += 1) {
		const lighter = mixColors(config.accent, "#ffffff", step / 10);
		if (contrastRatio(lighter, DARK.paper) >= MIN_TEXT_CONTRAST) return lighter;
	}
	return null;
}

/**
 * The display face's stack for each font key; null keeps src/styles.css's
 * (Eczar, vendored). Only faces already on the phone or in this app: a
 * studio's font never downloads anything. Each stack has a Devanagari face
 * and ends in a generic family; no quotes, so isSafeCss can refuse them.
 */
export const DISPLAY_FACES: Record<FontKey, string | null> = {
	eczar: null,
	serif: "Georgia, Noto Serif, Noto Serif Devanagari, Times New Roman, serif",
	sans: "var(--body-face)",
};

/** Only what brandingCss writes: letters, digits, spaces and # : ; , . ( ) { } @ - */
const SAFE_CSS = /^[a-zA-Z0-9 #:;,.(){}@-]*$/;

/** Whether `css` holds nothing brandingCss would not write: no quote, slash, backslash, angle bracket, ampersand or control character. */
export function isSafeCss(css: string): boolean {
	return SAFE_CSS.test(css);
}

function tokenRule(tokens: AccentTokens): string {
	return `html:root{--stencil:${tokens.stencil};--stencil-strong:${tokens.stencilStrong};--stencil-wash:${tokens.stencilWash}}`;
}

/**
 * The brand's CSS, or null for none. Each scheme's tokens sit in that
 * scheme's media query and the face in a plain rule, all on `html:root`,
 * which outranks src/styles.css's `:root` wherever the router puts the tag.
 */
export function brandingCss(config: ThemeConfig): string | null {
	const rules: string[] = [];
	const light =
		config.accent === null ? null : accentTokens(config.accent, LIGHT);
	if (light) {
		rules.push(`@media (prefers-color-scheme: light){${tokenRule(light)}}`);
	}
	const darkColor = darkAccent(config);
	const dark = darkColor === null ? null : accentTokens(darkColor, DARK);
	if (dark) {
		rules.push(`@media (prefers-color-scheme: dark){${tokenRule(dark)}}`);
	}
	const face = DISPLAY_FACES[config.font];
	if (face !== null) rules.push(`html:root{--display-face:${face}}`);
	const css = rules.join("");
	return css !== "" && isSafeCss(css) ? css : null;
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 677`, `ℹ pass 677`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/branding.ts apps/storefront/test/studio/theme-branding.test.ts
git commit -m "feat(storefront): build brand CSS with a contrast guard per colour scheme (TAT-54)" -m "An accent that reads under 4.5:1 on a scheme's paper leaves that scheme's violet; isSafeCss guards the text." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 7: The seam, and the theme in the pages' data

`source.ts` is the seam (Decision 1). The loaders put the checked theme in both pages' data, with the API's origin for the images. Nothing renders it yet.

### 7a. The failing test

**New file** `apps/storefront/test/studio/theme-fixtures.ts` (create it with exactly this content):

```ts
import type { Studio } from "@tattoo-drip/sdk";
import { STUDIO } from "./fixtures.ts";

/**
 * Shared by the theme tests (TAT-54). The contract has no `Studio.storefront`
 * yet (src/studio/theme/source.ts), so a config goes on a fixture studio
 * through this cast.
 */
export function withStorefront(storefront: unknown, studio = STUDIO): Studio {
	return { ...studio, storefront } as Studio;
}

/** The origin of the fixtures' photos: the API's, the only one images may come from. */
export const IMAGE_ORIGIN = "https://api.example.com";

export const LOGO = {
	url: "https://api.example.com/uploads/tenants/t/brand_logo/logo.png",
	width: 600,
	height: 200,
	alt: null,
};

export const COVER = {
	url: "https://api.example.com/uploads/tenants/t/cover_photo/cover.jpg",
	width: 2048,
	height: 1024,
	alt: null,
};

/** A studio that set everything: logo, cover, a red accent, the serif face, the inquiry first. */
export const BRANDED = {
	theme: "stencil-and-ink",
	branding: {
		logo: LOGO,
		heroImage: COVER,
		colors: { accent: "#b91c1c" },
		font: "serif",
	},
	sections: [
		{ type: "inquiry", props: {} },
		{ type: "artists", props: {} },
	],
};

/** Every value hostile, and `sections` not a list: this must render as the default theme does. */
export const HOSTILE = {
	theme: "}</style><script>alert(1)</script>",
	branding: {
		logo: { url: "javascript:alert(1)", width: 1, height: 1 },
		heroImage: {
			url: "https://evil.example/cover.jpg",
			width: 2048,
			height: 1024,
		},
		colors: {
			accent: "red;background:url(//evil.example/x.png)",
			accentDark: "}</style><script>alert(1)</script>",
		},
		font: "Comic Sans MS; src: url(//evil.example/font.woff2)",
	},
	sections: "artists;inquiry",
};
```

**New file** `apps/storefront/test/studio/theme-loaders.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Studio } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import {
	artistPageData,
	loadArtistPage,
	loadStudioPage,
	studioPageData,
} from "../../src/studio/loaders.ts";
import { DEFAULT_THEME_CONFIG } from "../../src/studio/theme/config.ts";
import { storefrontInput } from "../../src/studio/theme/source.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import { ARJUN, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import {
	BRANDED,
	COVER,
	IMAGE_ORIGIN,
	LOGO,
	withStorefront,
} from "./theme-fixtures.ts";

/** A server render's context against an API at `apiUrl`, the studio seeded. */
function pageContext(studio: Studio, apiUrl: string) {
	const { fetch } = fakeFetch(({ url }) =>
		url.endsWith("/artists")
			? json(200, { data: [SITA, ARJUN] })
			: json(404, { error: { code: "not_found", message: "Not found." } }),
	);
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl }, studio, fetch });
	seedStudio(api, studio);
	const site = new SiteRef();
	site.connect(ORIGIN);
	return { ...api, site };
}

const BRANDED_THEME = {
	key: "stencil-and-ink",
	sections: ["inquiry", "artists"],
	accent: "#b91c1c",
	accentDark: null,
	font: "serif",
	logo: { src: LOGO.url, width: 600, height: 200 },
	heroImage: { src: COVER.url, width: 2048, height: 1024 },
};

describe("the seam: storefrontInput (TAT-54)", () => {
	test("today's studio has no storefront: nothing", () => {
		assert.equal(storefrontInput(STUDIO), undefined);
		assert.equal(Object.hasOwn(STUDIO, "storefront"), false);
	});

	test("hands on whatever the API sent, unchecked", () => {
		assert.equal(storefrontInput(withStorefront(BRANDED)), BRANDED);
		assert.equal(storefrontInput(withStorefront("nonsense")), "nonsense");
	});
});

describe("the page data's theme (TAT-54)", () => {
	test("a studio without a storefront gets the default theme, on both pages", () => {
		assert.deepEqual(
			studioPageData(STUDIO, [SITA, ARJUN], ORIGIN).theme,
			DEFAULT_THEME_CONFIG,
		);
		assert.deepEqual(
			artistPageData(STUDIO, [SITA, ARJUN], "sita", ORIGIN)?.theme,
			DEFAULT_THEME_CONFIG,
		);
	});

	test("a studio's config is checked into its theme; images only with the API's origin", () => {
		const studio = withStorefront(BRANDED);
		assert.deepEqual(
			studioPageData(studio, [SITA], ORIGIN, IMAGE_ORIGIN).theme,
			BRANDED_THEME,
		);
		assert.deepEqual(
			artistPageData(studio, [SITA], "sita", ORIGIN, IMAGE_ORIGIN)?.theme,
			BRANDED_THEME,
		);
		const noOrigin = studioPageData(studio, [SITA], ORIGIN).theme;
		assert.equal(noOrigin.logo, null);
		assert.equal(noOrigin.heroImage, null);
	});

	test("the theme changes nothing else in the data", () => {
		const plain = studioPageData(STUDIO, [SITA, ARJUN], ORIGIN);
		const branded = studioPageData(
			withStorefront({ sections: [{ type: "inquiry", props: {} }] }),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.deepEqual(branded.theme.sections, ["inquiry"]);
		// Hiding the roster leaves the form's choice of artists as it was.
		assert.deepEqual({ ...branded, theme: null }, { ...plain, theme: null });
	});

	test("the loaders check images against the API's own origin", async () => {
		const studio = withStorefront(BRANDED);
		const onApi = await loadStudioPage(pageContext(studio, IMAGE_ORIGIN));
		assert.deepEqual(onApi.theme.logo, BRANDED_THEME.logo);
		const artist = await loadArtistPage(
			pageContext(studio, IMAGE_ORIGIN),
			"sita",
		);
		assert.deepEqual(artist.theme.heroImage, BRANDED_THEME.heroImage);
		// The same images, served from an API somewhere else: refused.
		const elsewhere = await loadStudioPage(
			pageContext(studio, "https://other-api.example.com"),
		);
		assert.equal(elsewhere.theme.logo, null);
		assert.equal(elsewhere.theme.heroImage, null);
		assert.equal(elsewhere.theme.accent, "#b91c1c");
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 678`, `ℹ pass 677`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-loaders.test.ts`, and higher up the output says `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` with a path ending in `src/studio/theme/source.ts`. Any other failure: STOP.

### 7b. The code

**New file** `apps/storefront/src/studio/theme/source.ts` (create it with exactly this content):

```ts
import type { Studio } from "@tattoo-drip/sdk";

/**
 * THE SEAM between this ticket (TAT-54) and TAT-56: where a studio's theme
 * config comes from. It is the API's studio's `storefront` property, which
 * the contract (packages/types/openapi.yaml, `Studio`) does not have yet and
 * the platform never sends: on every real page this is `undefined`, and the
 * page shows the default theme. Tests put a config on a fixture studio.
 * When TAT-56 adds `storefront` to `Studio`, read `studio.storefront` here
 * without the cast; parseThemeConfig checks whatever arrives either way.
 */
export function storefrontInput(studio: Studio): unknown {
	return (studio as Studio & { readonly storefront?: unknown }).storefront;
}
```

**Edit 7.1** `apps/storefront/src/studio/loaders.ts`. Find:

```ts
import { artistPageSeo, type PageSeo, studioPageSeo } from "./seo.ts";
```

Replace with:

```ts
import { artistPageSeo, type PageSeo, studioPageSeo } from "./seo.ts";
import { parseThemeConfig, type ThemeConfig } from "./theme/config.ts";
import { storefrontInput } from "./theme/source.ts";
```

**Edit 7.2** `apps/storefront/src/studio/loaders.ts` (the end of `StudioPageData`). Find:

```ts
	readonly seo: PageSeo;
}

export interface ArtistPageData {
```

Replace with:

```ts
	readonly seo: PageSeo;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
}

export interface ArtistPageData {
```

**Edit 7.3** `apps/storefront/src/studio/loaders.ts` (the end of `ArtistPageData` and the start of `studioPageData`). Find:

```ts
	readonly seo: PageSeo;
}

export function studioPageData(
	studio: Studio,
	artists: readonly Artist[],
	origin: string,
): StudioPageData {
```

Replace with:

```ts
	readonly seo: PageSeo;
	/** The studio's theme (TAT-54): its key, sections and checked branding. */
	readonly theme: ThemeConfig;
}

/**
 * The studio page's data. `imageOrigin` is the API's origin, the only one a
 * logo or cover image may come from (TAT-54); null accepts none.
 */
export function studioPageData(
	studio: Studio,
	artists: readonly Artist[],
	origin: string,
	imageOrigin: string | null = null,
): StudioPageData {
```

**Edit 7.4** `apps/storefront/src/studio/loaders.ts`. Find:

```ts
		seo: studioPageSeo(studioView, artistViews, origin),
	};
```

Replace with:

```ts
		seo: studioPageSeo(studioView, artistViews, origin),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
	};
```

**Edit 7.5** `apps/storefront/src/studio/loaders.ts`. Find:

```ts
	slug: string,
	origin: string,
): ArtistPageData | null {
```

Replace with:

```ts
	slug: string,
	origin: string,
	imageOrigin: string | null = null,
): ArtistPageData | null {
```

**Edit 7.6** `apps/storefront/src/studio/loaders.ts`. Find:

```ts
		seo: artistPageSeo(studioView, artist, origin),
	};
```

Replace with:

```ts
		seo: artistPageSeo(studioView, artist, origin),
		theme: parseThemeConfig(storefrontInput(studio), imageOrigin),
	};
```

**Edit 7.7** `apps/storefront/src/studio/loaders.ts`. Find:

```ts
	return studioPageData(studio, artists, context.site.origin);
```

Replace with:

```ts
	return studioPageData(
		studio,
		artists,
		context.site.origin,
		context.tattoo.connection.apiUrl,
	);
```

**Edit 7.8** `apps/storefront/src/studio/loaders.ts`. Find:

```ts
	const data = artistPageData(studio, artists, slug, context.site.origin);
```

Replace with:

```ts
	const data = artistPageData(
		studio,
		artists,
		slug,
		context.site.origin,
		context.tattoo.connection.apiUrl,
	);
```

- [ ] Run the storefront tests. Expected: `ℹ tests 683`, `ℹ pass 683`, `ℹ fail 0`. `test/studio/loaders.test.ts` and `test/studio/default-theme.test.ts` must still pass unchanged.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/source.ts apps/storefront/src/studio/loaders.ts apps/storefront/test/studio/theme-fixtures.ts apps/storefront/test/studio/theme-loaders.test.ts
git commit -m "feat(storefront): carry the checked theme in the studio pages' data (TAT-54)" -m "storefrontInput is the seam TAT-56 replaces; images are checked against the API's own origin." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 8: The theme registry and the sections

The registry maps each theme key to its two page components; the routes render the studio's theme through it. `StudioPage` renders its sections in the theme's order. With no configuration the markup must stay exactly the recorded one.

### 8a. The failing test

**New file** `apps/storefront/test/studio/theme-render.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtistPage, StudioPage } from "../../src/studio/components/pages.tsx";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
import { THEME_KEYS } from "../../src/studio/theme/config.ts";
import {
	THEMES,
	ThemedArtistPage,
	ThemedStudioPage,
	themeFor,
} from "../../src/studio/theme/registry.tsx";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { firstDifference, SNAPSHOT_FILE } from "./snapshot.ts";
import { HOSTILE, IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Record<
	string,
	string
>;

function studioHtml(
	studio: Studio = STUDIO,
	artists: Artist[] = [SITA, ARJUN],
) {
	return renderToStaticMarkup(
		createElement(ThemedStudioPage, {
			data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN),
		}),
	);
}

function artistHtml(slug: string, studio: Studio = STUDIO) {
	const data = artistPageData(
		studio,
		[SITA, ARJUN],
		slug,
		ORIGIN,
		IMAGE_ORIGIN,
	);
	assert.ok(data, slug);
	return renderToStaticMarkup(createElement(ThemedArtistPage, { data }));
}

function assertSame(actual: string, name: string) {
	assert.ok(
		actual === SNAPSHOT[name],
		`${name}: ${firstDifference(actual, SNAPSHOT[name])}`,
	);
}

const sections = (...types: string[]) =>
	types.map((type) => ({ type, props: {} }));
const headings = (html: string) =>
	Array.from(html.matchAll(/<h([1-6])[\s>]/g), (match) => Number(match[1]));
const hrefs = (html: string) =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) =>
		match[1].replaceAll("&amp;", "&"),
	);
const ids = (html: string) =>
	Array.from(html.matchAll(/ id="([^"]*)"/g), (match) => match[1]);

describe("the theme registry (TAT-54)", () => {
	test("has a theme for every key, and Stencil & Ink is today's page", () => {
		assert.deepEqual(Object.keys(THEMES), [...THEME_KEYS]);
		assert.equal(THEMES["stencil-and-ink"].StudioPage, StudioPage);
		assert.equal(THEMES["stencil-and-ink"].ArtistPage, ArtistPage);
	});

	test("an unknown key is the default theme", () => {
		for (const key of ["classic", "", "__proto__", "constructor", "toString"]) {
			assert.equal(themeFor(key), THEMES["stencil-and-ink"], key);
		}
	});
});

describe("the default theme (TAT-54)", () => {
	test("renders exactly what the pages rendered before themes", () => {
		assertSame(studioHtml(), "studio");
		assertSame(studioHtml(EMPTY_STUDIO, []), "empty");
		assertSame(studioHtml(CLOSED_STUDIO, [ARJUN]), "closed");
		assertSame(artistHtml("sita"), "artist-sita");
		assertSame(artistHtml("arjun"), "artist-arjun");
	});

	test("a config whose every value is hostile renders the default theme, byte for byte", () => {
		assertSame(studioHtml(withStorefront(HOSTILE)), "studio");
		assertSame(artistHtml("sita", withStorefront(HOSTILE)), "artist-sita");
	});
});

describe("the studio page's sections (TAT-54)", () => {
	test("follow the config's order", () => {
		const html = studioHtml(
			withStorefront({ sections: sections("inquiry", "artists") }),
		);
		assert.ok(html.indexOf(' id="inquiry"') < html.indexOf(' id="artists"'));
		// h1; the strip; the inquiry and its panel; Artists and its two artists.
		assert.deepEqual(headings(html), [1, 2, 2, 2, 2, 3, 3]);
	});

	test("a hidden roster is gone; the hero, the inquiry and the footer stay", () => {
		const html = studioHtml(withStorefront({ sections: sections("inquiry") }));
		assert.doesNotMatch(html, / id="artists"|Ask for/);
		assert.deepEqual(headings(html), [1, 2, 2, 2]);
		assert.match(
			html,
			/<h1 class="profile-name" dir="auto">Black Needle<\/h1>/,
		);
		assert.match(html, /<section id="inquiry"/);
		assert.match(html, /Studio page by Tattoo Drip/);
	});

	test("the inquiry section can't be hidden, so no link points at nothing", () => {
		for (const config of [
			sections(),
			sections("artists"),
			sections("inquiry"),
			sections("hero", "portfolio"),
			sections("inquiry", "artists"),
		]) {
			const html = studioHtml(withStorefront({ sections: config }));
			assert.equal(html.match(/ id="inquiry"/g)?.length, 1);
			for (const href of hrefs(html).filter((href) => href.startsWith("#"))) {
				assert.ok(ids(html).includes(href.slice(1)), href);
			}
		}
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 684`, `ℹ pass 683`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-render.test.ts`, and higher up the output says `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` with a path ending in `src/studio/theme/registry.tsx`. Any other failure: STOP.

### 8b. The code

**New file** `apps/storefront/src/studio/theme/registry.tsx` (create it with exactly this content):

```tsx
import type { ComponentType } from "react";
import { ArtistPage, StudioPage } from "../components/pages.tsx";
import type { ArtistPageData, StudioPageData } from "../loaders.ts";
import { DEFAULT_THEME_KEY, type ThemeKey } from "./config.ts";

/** What a theme's pages take: the loader's data and the intake form's site key. */
export interface ThemePageProps<Data> {
	data: Data;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
}

/**
 * A theme (TAT-54): the studio page's two pages as React components of this
 * app. A studio picks one by key and fills in its options; it never sends
 * markup. Every theme renders the inquiry section (InquirySection, with the
 * intake form) as it is, and never the deposit page.
 */
export interface Theme {
	readonly StudioPage: ComponentType<ThemePageProps<StudioPageData>>;
	readonly ArtistPage: ComponentType<ThemePageProps<ArtistPageData>>;
}

/** Every theme, by key. Stencil & Ink is the page TAT-97 and TAT-105 built. */
export const THEMES: Record<ThemeKey, Theme> = {
	"stencil-and-ink": { StudioPage, ArtistPage },
};

/** The theme with this key, else the default. */
export function themeFor(key: string): Theme {
	return Object.hasOwn(THEMES, key)
		? THEMES[key as ThemeKey]
		: THEMES[DEFAULT_THEME_KEY];
}

/** `/` in the studio's theme. */
export function ThemedStudioPage(props: ThemePageProps<StudioPageData>) {
	const Page = themeFor(props.data.theme.key).StudioPage;
	return <Page {...props} />;
}

/** `/artists/$slug` in the studio's theme. */
export function ThemedArtistPage(props: ThemePageProps<ArtistPageData>) {
	const Page = themeFor(props.data.theme.key).ArtistPage;
	return <Page {...props} />;
}
```

**Edit 8.1** `apps/storefront/src/studio/components/pages.tsx`. Find:

```ts
import type { ArtistPageData, StudioPageData } from "../loaders.ts";
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
```

Replace with:

```ts
import type { ArtistPageData, StudioPageData } from "../loaders.ts";
import type { SectionKey } from "../theme/config.ts";
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
```

**Edit 8.2** `apps/storefront/src/studio/components/pages.tsx` (in `StudioPage`). Find:

```tsx
	const { studio, artists, inquiry, channels } = data;
	// The hero's WhatsApp button is the plain chat link the Chat group lists.
```

Replace with:

```tsx
	const { studio, theme } = data;
	// The hero's WhatsApp button is the plain chat link the Chat group lists.
```

**Edit 8.3** `apps/storefront/src/studio/components/pages.tsx` (the end of `StudioPage`). Find:

```tsx
				<ArtistRoster artists={artists} />
				<InquirySection
					state={inquiry}
					channels={channels}
					challengeSiteKey={challengeSiteKey}
				/>
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}
```

Replace with:

```tsx
				{theme.sections.map((section) => (
					<StudioSection
						key={section}
						section={section}
						data={data}
						challengeSiteKey={challengeSiteKey}
					/>
				))}
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}

/**
 * One of the studio page's sections, in the order the theme's config gives
 * (TAT-54). The inquiry section is always one of them (readSections).
 */
function StudioSection({
	section,
	data,
	challengeSiteKey,
}: {
	section: SectionKey;
	data: StudioPageData;
	challengeSiteKey: string | null;
}) {
	switch (section) {
		case "artists":
			return <ArtistRoster artists={data.artists} />;
		case "inquiry":
			return (
				<InquirySection
					state={data.inquiry}
					channels={data.channels}
					challengeSiteKey={challengeSiteKey}
				/>
			);
	}
}
```

**Edit 8.4** `apps/storefront/src/routes/index.tsx`. Find:

```tsx
import { StudioPage } from "../studio/components/pages.tsx";
import { loadStudioPage } from "../studio/loaders.ts";
import { headTags, statusHead } from "../studio/seo.ts";
```

Replace with:

```tsx
import { loadStudioPage } from "../studio/loaders.ts";
import { headTags, statusHead } from "../studio/seo.ts";
import { ThemedStudioPage } from "../studio/theme/registry.tsx";
```

**Edit 8.5** `apps/storefront/src/routes/index.tsx`. Find:

```tsx
		<StudioPage
```

Replace with:

```tsx
		<ThemedStudioPage
```

**Edit 8.6** `apps/storefront/src/routes/artists/$slug.tsx`. Find:

```tsx
import { ArtistPage } from "../../studio/components/pages.tsx";
import { loadArtistPage } from "../../studio/loaders.ts";
import { headTags, statusHead } from "../../studio/seo.ts";
```

Replace with:

```tsx
import { loadArtistPage } from "../../studio/loaders.ts";
import { headTags, statusHead } from "../../studio/seo.ts";
import { ThemedArtistPage } from "../../studio/theme/registry.tsx";
```

**Edit 8.7** `apps/storefront/src/routes/artists/$slug.tsx`. Find:

```tsx
		<ArtistPage
```

Replace with:

```tsx
		<ThemedArtistPage
```

- [ ] Run the storefront tests. Expected: `ℹ tests 690`, `ℹ pass 690`, `ℹ fail 0`. `test/studio/render.test.ts` and `test/studio/default-theme.test.ts` must still pass unchanged: they prove the default markup did not move.
- [ ] Run the storefront typecheck: no error.
- [ ] `git status --short` shows no change to `apps/storefront/src/routeTree.gen.ts`.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/registry.tsx apps/storefront/src/studio/components/pages.tsx apps/storefront/src/routes/index.tsx 'apps/storefront/src/routes/artists/$slug.tsx' apps/storefront/test/studio/theme-render.test.ts
git commit -m "feat(storefront): render the studio pages through a theme registry (TAT-54)" -m "Stencil & Ink is the one theme; its studio page orders and hides sections, and the inquiry is always there." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 9: The logo and the cover image

`brand.tsx` renders the checked images as `<img>`; the stylesheet sizes them. Only a configuration with images changes the markup.

### 9a. The failing test

**Edit 9.1** `apps/storefront/test/studio/theme-render.test.ts`. Find:

```ts
import { ArtistPage, StudioPage } from "../../src/studio/components/pages.tsx";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
```

Replace with:

```ts
import { ArtistPage, StudioPage } from "../../src/studio/components/pages.tsx";
import { isAllowedHref } from "../../src/studio/links.ts";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
```

**Edit 9.2** `apps/storefront/test/studio/theme-render.test.ts`. Find:

```ts
import { HOSTILE, IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";
```

Replace with:

```ts
import {
	BRANDED,
	COVER,
	HOSTILE,
	IMAGE_ORIGIN,
	LOGO,
	withStorefront,
} from "./theme-fixtures.ts";
```

**Edit 9.3** `apps/storefront/test/studio/theme-render.test.ts`. Find:

```ts
describe("the theme registry (TAT-54)", () => {
```

Replace with:

```ts
/** What a branded page holds to, as every studio page does (test/studio/render.test.ts). */
function assertSafeBrandedPage(html: string) {
	assert.equal(html.match(/<h1[\s>]/g)?.length, 1, "exactly one h1");
	for (const href of hrefs(html)) assert.ok(isAllowedHref(href), href);
	assert.doesNotMatch(html, / style=/);
	assert.doesNotMatch(html, /<style|<script|javascript:|url\(/i);
	for (const image of html.match(/<img [^>]*>/g) ?? []) {
		assert.match(image, / width="\d+"/, image);
		assert.match(image, / height="\d+"/, image);
		// Brand images are decoration (alt=""); every other image says what it shows.
		if (/class="(profile-logo|site-bar-logo)"/.test(image)) {
			assert.match(image, / alt=""/, image);
		} else if (!image.includes(COVER.url)) {
			assert.match(image, / alt="[^"]+"/, image);
		}
	}
}

describe("the theme registry (TAT-54)", () => {
```

**Append to** `apps/storefront/test/studio/theme-render.test.ts` (at the very end of the file, with one empty line between):

```ts
describe("a studio's logo and cover (TAT-54)", () => {
	test("the logo sits above the name, the cover above the hero, both from the API's origin", () => {
		const html = studioHtml(withStorefront(BRANDED));
		assertSafeBrandedPage(html);
		assert.ok(
			html.includes(
				`<div class="profile-heading"><img class="profile-logo" src="${LOGO.url}" width="600" height="200" alt="" decoding="async"/><h1 class="profile-name" dir="auto">Black Needle</h1>`,
			),
		);
		assert.ok(
			html.includes(
				`<main class="page"><div class="profile-cover"><img src="${COVER.url}" width="2048" height="1024" alt="" loading="eager" decoding="async" fetchPriority="high"/></div><header class="profile">`,
			),
		);
	});

	test("the artist page shows the logo beside the studio's name in its bar, and no cover", () => {
		const html = artistHtml("sita", withStorefront(BRANDED));
		assertSafeBrandedPage(html);
		assert.ok(
			html.includes(
				`<header class="site-bar"><a href="/" dir="auto"><img class="site-bar-logo" src="${LOGO.url}" width="600" height="200" alt="" decoding="async"/><span>Black Needle</span></a></header>`,
			),
		);
		assert.doesNotMatch(html, /profile-cover/);
	});

	test("a logo or cover from anywhere else is not shown", () => {
		const html = studioHtml(
			withStorefront({
				branding: {
					logo: { ...LOGO, url: "https://evil.example/logo.png" },
					heroImage: { ...COVER, url: "http://api.example.com/cover.jpg" },
				},
			}),
		);
		assertSame(html, "studio");
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 693`, `ℹ pass 691`, `ℹ fail 2`. The two failing tests are "the logo sits above the name, the cover above the hero, both from the API's origin" and "the artist page shows the logo beside the studio's name in its bar, and no cover", each with `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value`: nothing renders the images yet. Any other failure: STOP.

### 9b. The code

**New file** `apps/storefront/src/studio/components/brand.tsx` (create it with exactly this content):

```tsx
import type { BrandImage } from "../theme/config.ts";

/**
 * A studio's logo and cover image (TAT-54), from parseThemeConfig's checked
 * values only. Both are decoration beside the studio's name, so their alt
 * text is empty; width and height are always set, so nothing shifts while
 * they load. Never a CSS url(): a URL inside CSS would need CSS escaping and
 * could carry no size or alt text.
 */
export function BrandLogo({
	image,
	className,
}: {
	image: BrandImage;
	className: string;
}) {
	return (
		<img
			className={className}
			src={image.src}
			width={image.width}
			height={image.height}
			alt=""
			decoding="async"
		/>
	);
}

/** The cover above the hero: the page's first image, so it loads first. */
export function BrandCover({ image }: { image: BrandImage }) {
	return (
		<div className="profile-cover">
			<img
				src={image.src}
				width={image.width}
				height={image.height}
				alt=""
				loading="eager"
				decoding="async"
				fetchPriority="high"
			/>
		</div>
	);
}
```

**Edit 9.4** `apps/storefront/src/studio/components/pages.tsx`. Find:

```ts
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
import { ContactBlock } from "./contact.tsx";
```

Replace with:

```ts
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
import { BrandCover, BrandLogo } from "./brand.tsx";
import { ContactBlock } from "./contact.tsx";
```

**Edit 9.5** `apps/storefront/src/studio/components/pages.tsx` (in `StudioPage`). Find:

```tsx
			<main className="page">
				<header className="profile">
					<div className="profile-heading">
						<h1 className="profile-name" dir="auto">
```

Replace with:

```tsx
			<main className="page">
				{theme.heroImage ? <BrandCover image={theme.heroImage} /> : null}
				<header className="profile">
					<div className="profile-heading">
						{theme.logo ? (
							<BrandLogo image={theme.logo} className="profile-logo" />
						) : null}
						<h1 className="profile-name" dir="auto">
```

**Edit 9.6** `apps/storefront/src/studio/components/pages.tsx` (in `ArtistPage`). Find:

```tsx
	const { studio, artist, inquiry, channels } = data;
	return (
		<>
			<header className="site-bar">
				<a href="/" dir="auto">
					{studio.name}
				</a>
			</header>
```

Replace with:

```tsx
	const { studio, artist, inquiry, channels, theme } = data;
	return (
		<>
			<header className="site-bar">
				<a href="/" dir="auto">
					{theme.logo ? (
						<>
							<BrandLogo image={theme.logo} className="site-bar-logo" />
							<span>{studio.name}</span>
						</>
					) : (
						studio.name
					)}
				</a>
			</header>
```

**Edit 9.7** `apps/storefront/src/styles.css`. Find (the whole line, once in the file):

```css
  .profile-actions { display: grid; gap: 1.5rem; align-content: start; }
```

Replace with:

```css
  /*
   * A studio's own logo and cover image (TAT-54, src/studio/components/brand.tsx):
   * decoration beside its name. The cover takes the photos' stencil frame and
   * stays short, so the buttons still fit on a phone's first screen.
   */
  .profile-logo { display: block; inline-size: auto; max-inline-size: min(12rem, 100%); block-size: 4rem; object-fit: contain; object-position: left center; }
  .profile-cover { position: relative; isolation: isolate; margin: 0 0.375rem 1.875rem 0; }
  .profile-cover img { display: block; inline-size: 100%; block-size: auto; aspect-ratio: 3 / 1; max-block-size: 16rem; object-fit: cover; background: var(--stencil-wash); }
  .profile-cover::after { content: ''; position: absolute; inset: 0; z-index: -1; translate: 0.375rem 0.375rem; border: 1.5px solid var(--stencil); }
  .site-bar-logo { display: block; inline-size: auto; max-inline-size: 6rem; block-size: 2rem; margin-inline-end: 0.75rem; object-fit: contain; }
  .profile-actions { display: grid; gap: 1.5rem; align-content: start; }
```

- [ ] Run the storefront tests. Expected: `ℹ tests 693`, `ℹ pass 693`, `ℹ fail 0`. `test/studio/render.test.ts`, `test/studio/assets.test.ts` and `test/studio/default-theme.test.ts` must still pass unchanged.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/studio/components/brand.tsx apps/storefront/src/studio/components/pages.tsx apps/storefront/src/styles.css apps/storefront/test/studio/theme-render.test.ts
git commit -m "feat(storefront): show a studio's logo and cover image (TAT-54)" -m "Both are img elements with their stored size and an empty alt, from checked URLs on the API's origin only." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 10: The brand's `<style>` in the head

`themedHeadTags` is the pages' head: `headTags` as before, plus one `<style>` when the studio is branded. The routes use it.

### 10a. The failing test

**New file** `apps/storefront/test/studio/theme-head.test.ts` (create it with exactly this content):

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { studioPageData } from "../../src/studio/loaders.ts";
import { headTags } from "../../src/studio/seo.ts";
import { brandingCss } from "../../src/studio/theme/branding.ts";
import { themedHeadTags } from "../../src/studio/theme/head.ts";
import { ARJUN, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import {
	BRANDED,
	HOSTILE,
	IMAGE_ORIGIN,
	withStorefront,
} from "./theme-fixtures.ts";

describe("themedHeadTags (TAT-54)", () => {
	test("the default theme's head is the page's head as it was: no <style>", () => {
		const data = studioPageData(STUDIO, [SITA, ARJUN], ORIGIN, IMAGE_ORIGIN);
		assert.deepEqual(themedHeadTags(data.seo, data.theme), headTags(data.seo));
	});

	test("a hostile config adds nothing either", () => {
		const data = studioPageData(
			withStorefront(HOSTILE),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.deepEqual(themedHeadTags(data.seo, data.theme), headTags(data.seo));
	});

	test("a branded studio's head adds one <style> with its brand's CSS", () => {
		const data = studioPageData(
			withStorefront(BRANDED),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const css = brandingCss(data.theme);
		assert.ok(css);
		assert.deepEqual(themedHeadTags(data.seo, data.theme), {
			...headTags(data.seo),
			styles: [{ children: css }],
		});
		assert.doesNotMatch(css, /[<>"'&\\]|url\(/);
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 694`, `ℹ pass 693`, `ℹ fail 1`. The failing entry is `✖ test/studio/theme-head.test.ts`, and higher up the output says `Error [ERR_MODULE_NOT_FOUND]: Cannot find module` with a path ending in `src/studio/theme/head.ts`. Any other failure: STOP.

### 10b. The code

**New file** `apps/storefront/src/studio/theme/head.ts` (create it with exactly this content):

```ts
import { type HeadTags, headTags, type PageSeo } from "../seo.ts";
import { brandingCss } from "./branding.ts";
import type { ThemeConfig } from "./config.ts";

/** A route's head with the studio's brand: HeadTags and, when branded, one <style>. */
export interface ThemedHeadTags extends HeadTags {
	styles?: { children: string }[];
}

/**
 * The head of the studio page and the artist page (TAT-54): headTags, and for
 * a branded studio one <style> holding brandingCss (the router writes it as
 * it is, with the CSP nonce once one is set). The default theme's head is
 * exactly headTags: no <style>.
 */
export function themedHeadTags(
	seo: PageSeo,
	theme: ThemeConfig,
): ThemedHeadTags {
	const tags = headTags(seo);
	const css = brandingCss(theme);
	return css === null ? tags : { ...tags, styles: [{ children: css }] };
}
```

**Edit 10.1** `apps/storefront/src/routes/index.tsx`. Find:

```tsx
import { headTags, statusHead } from "../studio/seo.ts";
import { ThemedStudioPage } from "../studio/theme/registry.tsx";
```

Replace with:

```tsx
import { statusHead } from "../studio/seo.ts";
import { themedHeadTags } from "../studio/theme/head.ts";
import { ThemedStudioPage } from "../studio/theme/registry.tsx";
```

**Edit 10.2** `apps/storefront/src/routes/index.tsx`. Find:

```tsx
		loaderData ? headTags(loaderData.seo) : statusHead(match.status),
```

Replace with:

```tsx
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
```

**Edit 10.3** `apps/storefront/src/routes/artists/$slug.tsx`. Find:

```tsx
import { headTags, statusHead } from "../../studio/seo.ts";
import { ThemedArtistPage } from "../../studio/theme/registry.tsx";
```

Replace with:

```tsx
import { statusHead } from "../../studio/seo.ts";
import { themedHeadTags } from "../../studio/theme/head.ts";
import { ThemedArtistPage } from "../../studio/theme/registry.tsx";
```

**Edit 10.4** `apps/storefront/src/routes/artists/$slug.tsx`. Find:

```tsx
		loaderData ? headTags(loaderData.seo) : statusHead(match.status),
```

Replace with:

```tsx
		loaderData
			? themedHeadTags(loaderData.seo, loaderData.theme)
			: statusHead(match.status),
```

- [ ] Run the storefront tests. Expected: `ℹ tests 696`, `ℹ pass 696`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error. (The routes' `head` is checked only by the typecheck and the build.)
- [ ] Commit:

```bash
git add apps/storefront/src/studio/theme/head.ts apps/storefront/src/routes/index.tsx 'apps/storefront/src/routes/artists/$slug.tsx' apps/storefront/test/studio/theme-head.test.ts
git commit -m "feat(storefront): put the brand's style in the studio pages' head (TAT-54)" -m "themedHeadTags is headTags plus one style element for a branded studio; the default head is unchanged." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 11: The documentation

**Edit 11.1** `apps/storefront/docs/development.md`. Find (the heading line, once in the file):

```md
## Intake form
```

Replace with (the new section, then the same heading):

```md
### Themes and branding

TAT-54 (`src/studio/theme/`). A theme is a set of React components of this app; a studio picks one by key and fills in its options, and never sends markup, CSS or scripts. There is one theme, `stencil-and-ink`, the page TAT-97 and TAT-105 built, and the API sends no configuration yet, so every studio gets it with its defaults.

- The seam: `storefrontInput(studio)` (`theme/source.ts`) reads the API studio's `storefront` property, which the contract does not have yet (`Studio` in `packages/types/openapi.yaml`) and the platform never sends, so it is `undefined` on every real page. TAT-56 adds `Studio.storefront` (shaped like `StorefrontConfiguration`) and then reads it there without the cast; nothing else changes. Tests put a configuration on a fixture studio (`withStorefront`, `test/studio/theme-fixtures.ts`).
- Checks (`theme/config.ts`, `parseThemeConfig(input, imageOrigin)`, called by the loaders): each value on its own, own properties only; a value that is missing, of the wrong type or not on its list falls back to its default alone, and anything but an object is the default theme. `theme`: a key of `THEME_KEYS` (an unknown one, like the contract's example `classic`, is the default). `branding.colors.accent` and `branding.colors.accentDark`: `#rrggbb`, lowercased (`readHexColor`); other colour keys are ignored. `branding.font`: `eczar`, `serif` or `sans` (`FONT_KEYS`), never a family name. `branding.logo` and `branding.heroImage`: the contract's `Image`; the URL passes `safeImageUrl`, has no space or control character, is on exactly the API's origin (`context.tattoo.connection.apiUrl`) and is https unless the API runs on this machine; width and height are whole pixels from 1 to 10000; `alt` is not read. `sections`: the `{ type, props }` items whose `type` the theme supports, in order, each once; `props` is not read; anything but a list is the default order.
- Sections (`THEME_SECTIONS`, rendered by `StudioSection` in `components/pages.tsx`): the studio page's `artists` and `inquiry`, in that order by default. A configuration can reorder them and hide the roster. `inquiry` is required (a client can always send an idea): a list without it gets it at the end, so the hero's `#inquiry` link always has its target. The first screen (name, location, buttons, steps strip, intro, contacts), the footer and the artist page's layout are fixed. Hiding the roster changes nothing else: the form still offers every open artist, the artist pages and the JSON-LD stay.
- Branding (`theme/branding.ts`, `brandingCss`): the accent and the display face become CSS variables in one `<style>` in the head (`themedHeadTags` in `theme/head.ts`, the two routes' `head`), never a `style` attribute: a `<style>` can hold the dark scheme's media query and can be allowed by nonce in a future `style-src` (the router adds its nonce once one is set; no CSP is sent yet). Our code never uses `dangerouslySetInnerHTML`; the router writes the text as it is, so it holds only checked `#rrggbb` values and fixed text, and `isSafeCss` refuses anything else before it leaves. Rules sit on `html:root`, which outranks `styles.css`'s `:root` wherever the tag lands, colours inside `@media (prefers-color-scheme: light)` and `(prefers-color-scheme: dark)`. The default theme writes no `<style>`.
- Contrast: an accent sets `--stencil`, `--stencil-strong` (a quarter of the way to the ink) and `--stencil-wash` (a tint of the paper) for a scheme only when it reads at 4.5:1 on that scheme's paper; otherwise that scheme keeps the theme's violet, all three tokens. The hover colour is kept only while the paper still reads on it at 4.5:1, the wash only while the accent, the ink and the muted ink read on it at 4.5:1 (else the paper itself). `--on-stencil` stays the paper. The dark scheme uses `accentDark` when it reads there, else the accent lightened toward white until it does. `LIGHT` and `DARK` in `theme/branding.ts` copy `styles.css`'s paper and ink values (`test/studio/theme-branding.test.ts` pins them): change both together.
- Fonts: `eczar` keeps the stack in [Fonts](#fonts); `serif` is Georgia with Noto Serif Devanagari, `sans` the body stack. Nothing is downloaded for a studio's choice; the Eczar Latin file stays preloaded either way.
- Images (`components/brand.tsx`): the logo sits above the name in the hero and before the name in the artist page's bar; the cover sits above the hero, about 3:1 and at most 16rem tall, with the photos' stencil frame. Both are `<img>` with their width and height and `alt=""` (decoration beside the studio's name), never a CSS `url()`. The cover is the hero image: the platform should send TAT-116's cover photo as `branding.heroImage`, one image for both.
- Not themable: the intake form and `InquirySection` (every theme renders them as they are; the accent reaches them only through the page's variables), the deposit page (its route adds no brand `<style>`), the status pages, and the link rules (`src/studio/links.ts`).
- The default look is pinned: `test/studio/default-theme.snapshot.json` holds what the pages rendered before themes, recorded from that code; `default-theme.test.ts` and `theme-render.test.ts` compare against it, and a configuration whose every value is hostile must render it too. To accept a deliberate change to the default look, delete the file, run the tests twice (the first run records it and fails) and review its diff.
- Adding a theme: its key in `THEME_KEYS`, its sections in `THEME_SECTIONS`, its components in `THEMES` (`theme/registry.tsx`), and tests. Adding a section: its key in `SECTION_KEYS` and the theme's `order`, a case in `StudioSection`. Never name anything `parseStorefrontConfig` or `storefrontConfig`: those are the server settings (`src/tenancy/config.ts`), and `scripts/check-client-bundle.mjs` fails the build when either name reaches the browser.

## Intake form
```

- [ ] Run the storefront tests (nothing should change): `ℹ tests 696`, `ℹ pass 696`, `ℹ fail 0`.
- [ ] Commit:

```bash
git add apps/storefront/docs/development.md
git commit -m "docs(storefront): document themes, branding and the TAT-56 seam (TAT-54)" -m "How the registry, the sections, the checks and the brand style work, and what TAT-56 replaces." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Final gates

Run each from the repository root, in this order. If one fails, do not fix anything outside this plan's files: STOP and report the command and its output.

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`: `ℹ tests 696`, `ℹ pass 696`, `ℹ fail 0` (629 before, plus 67 new: 1 snapshot, 5 colour, 26 configuration, 16 branding, 6 loader, 10 render, 3 head).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check`: exit 0, `Found 2 warnings.` and `Found 1 info.` (the same platform files as before; nothing in `apps/storefront`). If it reports a formatting error in one of this plan's files, the file differs from the plan's text: STOP (do not run `--write` on other files).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck`: exit 0 in every package.
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build`: exit 0; the storefront's part ends with `Client bundle check: 11 files in .output/public, no server-only text.` (10 before this plan; one file more or less is fine, `no server-only text.` is what matters). A "contains server-only text" line means a name from `scripts/check-client-bundle.mjs` reached the browser: STOP. The build output is gitignored; `git status --short` must still print nothing (if `apps/storefront/src/routeTree.gen.ts` shows as changed, STOP).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront check:page` (after the build; it asks the human, and starts the built server on two free local ports for about ten seconds, then stops it). Expected: it ends with `Page check passed: the key is in no page, header or log line; ...`. Its stand-in API sends no `storefront`, so the pages it checks are the default theme. If the human declines to run it, write that in the report.
- [ ] `git log --oneline -13` shows your twelve commits (Tasks 0 to 11) on top of the plan commit. `git diff --stat HEAD~12` lists only the files in "Scope fence" above.
- [ ] Do NOT push and do NOT open a pull request.

## STOP and tell the human

Stop, write a line under "Findings" and report, when any of these happens:

- A baseline in Task 0 is not what it says (not 629 tests, a typecheck error, a dirty tree, a different branch).
- A red or green count, a failing test's name or an error text differs from the step.
- A "Find" text is not in its file exactly once.
- A change seems to need a file outside "Scope fence" (anything in `apps/platform`, `packages/`, a route that isn't one of the two, `routeTree.gen.ts`, `package.json`, the lockfile, `src/studio/links.ts`, `src/intake/`, `src/deposit/`).
- You would need to edit, skip or weaken a test you did not write in this plan (all existing tests must pass unchanged), or edit `default-theme.snapshot.json` by hand.
- You would need a dependency, a database, a running dev server, or network access.
- A permission prompt you do not understand, or a command this plan does not list.
- The pre-commit hook rewrites a file in a way that changes more than spacing, or a commit is refused.

## Report format

Write this as your final message:

1. The test counts: 629 before, and the final `ℹ tests`, `ℹ pass`, `ℹ fail`.
2. The red output you saw in each task (the counts and the error line).
3. The twelve commit hashes with their subjects (`git log --oneline -13`).
4. The files changed (`git diff --stat HEAD~12`).
5. Each final gate and its result (`pnpm check` warnings, the build's bundle-check line, whether `check:page` ran and passed).
6. Every deviation from this plan, and anything you could not do. "None" if none.

## Browser check (for the human or the coordinator, after the gates; the coding agent cannot do this)

Run the platform and the storefront as usual (`docs/agent-environment.md` and `apps/storefront/AGENTS.md`), open a studio, and check at **375 x 812** and **1280 x 800**, each in **light and dark** (DevTools, Rendering, `prefers-color-scheme`):

1. **Default theme.** The studio page and an artist page look exactly as before this branch: violet actions, Eczar headings, the hero's buttons on a phone's first screen, the steps strip on a phone and the sticky panel from 60rem. View the source: no `<style>` with `html:root` in the head, no `style=` attribute anywhere.
2. **A branded studio.** The API cannot send a configuration yet, so for this check only make a local, uncommitted edit: in `apps/storefront/src/studio/theme/source.ts`, make `storefrontInput` return the object below (copy an `http://localhost:3333/uploads/...` artist photo URL from the page's source for both images, and their real width and height), then reload. Revert the edit afterwards (`git checkout -- apps/storefront/src/studio/theme/source.ts`).

```ts
return {
	theme: "stencil-and-ink",
	branding: {
		logo: { url: "<an artist photo URL>", width: 1200, height: 1500 },
		heroImage: { url: "<the same URL>", width: 1200, height: 1500 },
		colors: { accent: "#b91c1c" },
		font: "serif",
	},
	sections: [
		{ type: "inquiry", props: {} },
		{ type: "artists", props: {} },
	],
};
```

   Expected: red actions, links, focus rings, step numerals and stencil frames in light mode, a lighter red (`#ce6060`) in dark mode, readable hover states and chips (measure the primary button, a link and the "Ask for" button with the DevTools contrast picker: at least 4.5:1); Georgia (or Noto Serif Devanagari for a Nepali name) for the headings; the cover above the hero at most about a third as tall as wide, the buttons still on the phone's first screen; the logo above the name, at most 4rem tall, and beside the name in the artist page's bar, which stays at least 44 px tall; the inquiry section before the artists; the hero's "Send your idea" still jumps to the form. The intake form works as before (open it, pick a photo, see the error summary) and the deposit page (`/deposit#...`) stays violet. No horizontal scroll at 375 px. Keyboard: tab order is unchanged and the focus ring shows on every link and button.
3. **A hidden roster.** `sections: [{ type: "inquiry", props: {} }]`: no Artists section, nothing on the page links to it, the form still lets the client choose an artist, and `/artists/<slug>` still opens.
4. **A hostile studio.** Return this instead: `{ theme: "}</style><script>alert(1)</script>", branding: { logo: { url: "javascript:alert(1)", width: 1, height: 1 }, heroImage: { url: "https://evil.example/x.jpg", width: 10, height: 10 }, colors: { accent: "red;background:url(//evil.example/x.png)", accentDark: "expression(alert(1))" }, font: "Comic Sans MS" }, sections: "artists" }`. Expected: the page is the default theme exactly (as in check 1, no `<style>` in the head), no alert, and the network panel shows no request to `evil.example`.
5. **A colour that fails in one scheme.** `branding: { colors: { accent: "#facc15" } }` (yellow): light mode stays violet (yellow reads at 1.4:1 on the paper), dark mode turns yellow (12:1 on the dark paper).
6. `pnpm --filter @tattoo-drip/storefront check:page` after `pnpm --filter @tattoo-drip/storefront build`, if the coding agent could not run it.

## Findings

Planner's notes, verified before writing this plan (for the coordinator; the coding agent leaves them as they are):

- The planner followed this plan once in this worktree from the clean tree (a script applied every "New file", "Edit" and "Append to" block in order and ran each step's command), then threw the result away. Every red and green count, failing test name and error line in the tasks is what that run printed; every "Find" text was in its file exactly once; Biome changed nothing in the files of each commit. At the end: 696 tests pass, `pnpm check` reports only the two platform warnings and one info, `pnpm typecheck` and `pnpm build` exit 0, and the storefront build ends with `Client bundle check: 11 files in .output/public, no server-only text.` `check:page` was not run (no servers in the planning session).
- The default theme renders byte for byte what the pages rendered before (the snapshot test, through the registry too), and a configuration whose every value is hostile renders the same bytes.
- Every accent from a 64-colour grid either is refused for a scheme or gives tokens on which every text pairs at 4.5:1 or more (`theme-branding.test.ts`).
- The stylesheet comment's measured contrasts (ink 15.8:1, stencil 8.4:1, ...) match `contrastRatio`.
- Left as they were, outside the ticket: artist photos still accept any http(s) URL (`safeImageUrl`), the Eczar Latin preload stays when a studio picks `serif` or `sans` (a wasted 15 KB download for those studios; the root route would need the theme to skip it), and the JSON-LD and the form's artist choice ignore a hidden roster on purpose.

Coding agent:

(none yet)
