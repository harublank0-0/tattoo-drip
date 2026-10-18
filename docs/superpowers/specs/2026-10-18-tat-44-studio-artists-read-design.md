# Read endpoints (MVP): studio profile and artists (TAT-44)

Date: 2026-10-18
Refs: TAT-44. Builds on TAT-32 (`/api/v1/tenants/:tenant`, `publicTenant`, `publicCache`, `ApiException`, the public isolation harness), TAT-51 (`ArtistService.listVisible`, intake's artist rule), TAT-65 (the harness's `params` and mirror, the React test runner), TAT-26 (the tenant profile, `TenantProfile`), TAT-31 (artist profiles, the public `artist_photo` purpose) and TAT-21 (`ImageService`). Blocks TAT-48 (studio page) and TAT-47 (contract tests). Linear has no comments on TAT-44, TAT-31, TAT-32, TAT-26 or TAT-21 (checked 2026-10-18); the TAT-31 privacy questions it left "for TAT-44" (its PR notes) are ruled on in 11.

## Goal

The studio page reads everything it shows about a studio through three cacheable, tenant-scoped GETs: `getStudio` (the full public profile, filling TAT-32's `{ slug, name }`), `listArtists` (visible artists) and `getArtist` (one visible artist by slug). Every field is an explicit allow-list; nothing about clients, inquiries, projects, payments, members or hidden artists can appear.

Written without the user (unattended run): every open question is a ruling below. **No migration.**

## Base

This branch starts at a2484f4 (TAT-23's design commit), which holds only designs. The build needs the built public API chain (TAT-24, 32, 51, 65, 66, reviewed and fixed): rebase onto its tip first (or onto TAT-23's built tip, which sits on it). Only this spec and plan sit on top. The plan's Task 0 checks the names it uses and stops otherwise. If the base holds TAT-12/23's built storefront, its test fixtures typed as a partial `Studio` stop compiling once the fields are required; the contract task fixes them.

## Rulings

1. **Scope: platform, contract, SDK and React tests; no migration, no page.** The SDK's `studio.get`, `artists.list`, `artists.get` and React's `tattooQueries.studio/artists/artist` already exist (TAT-32's draft); they get tests and doc comments. TAT-48 builds the page. Rejected: new columns (artist links, a studio "closed" message, an order column): each is a migration plus dashboard UI for a 2-point read ticket.
2. **The studio is what the dashboard promises to show.** TAT-26's settings page labels intro and contact "Shown on your booking page"; its `TenantProfile` type is "the studio's public profile". `Studio` = that profile plus `slug` (current, also under an old slug) and `type`, plus a computed `acceptingInquiries`. Never: the tenant id (no API takes it), `depositPolicy` and `defaultDepositPercent` (the settings page says "Shown to clients on the deposit page"), payment methods, QR codes and account details (the deposit page's, TAT-65), members, their emails or user ids, anything of clients, inquiries, projects, quotes or payments, timestamps. Rejected: the draft's `id` and `description` (renamed `intro`, the dashboard's word).
3. **Contact is public, as plain text.** `contact: { phone, email, address }`, each `string | null`: the phone in E.164 (as stored; the page builds `tel:` and chat links), the studio's own contact email (never an owner's login email, never a fallback to one), the address with its line breaks. The page renders all text as text, never HTML. Rejected: formatted phones or prebuilt chat links (presentation, TAT-48's).
4. **Social links are a list.** `socialLinks: [{ platform, url }]` in a fixed order (instagram, facebook, tiktok, website), only the ones set, and only an `https:` URL (re-checked on the way out, so a row written outside the validator can never put `javascript:` in a link). `platform` is an open string with those four documented values. Rejected: four nullable fields (each new platform a new field); a closed enum (adding a value would break strict clients).
5. **"Studio page config" is the profile and each artist's `visible` switch.** No `StorefrontConfiguration` exists (data model: "In the MVP: which artists show and the intro text"). `Studio` gets no `storefront` property now; TAT-54 adds it with themes (the V1 schema stays in the contract, unreferenced). Rejected: an empty placeholder (contract surface with nothing behind it).
6. **The studio's `acceptingInquiries` is intake's own rule.** True when it has no visible artist (intake takes general inquiries) or at least one visible artist accepts; false only when every visible artist is closed (intake's `studio_not_accepting`). One pure function, `studioTakesInquiries(visible)`, now used by `IntakeService` and by the read, so the page can't offer a form the API refuses. Rejected: "at least one visible artist accepting" (false for a studio with no artists, which intake accepts).
7. **An artist is `id`, `slug`, `name`, `bio`, `photo`, `acceptingInquiries`, `closedMessage`.** `id` because intake's `preferredArtistId` takes it (a UUIDv7 that grants nothing). `closedMessage` is null while the artist accepts (the form says "Shown instead of the request form while inquiries are off"), so an old message never leaks. Never the linked user, the `visible` flag, timestamps or the photo key. The draft's `acceptingRequests` becomes `acceptingInquiries` (the column and the 409 codes); `serviceIds` leaves with services (TAT-77). Rejected: per-artist links (no column).
8. **The photo is the one stored image.** `photo: { url, width, height } | null`: `ImageService.url("artist_photo", key, tenant)`, the public disk's absolute URL (`APP_URL`), the image as stored (at most 2048 px, re-encoded, no metadata). Its path holds the tenant id and a random file name, as the deposit page's QR does; no API takes either. Rejected: resized variants now (none exist; the architecture's worker variants or TAT-27's CDN add them as new fields); signed URLs (the purpose is public and the answer is cached).
9. **Visible artists, by name.** `listArtists` is `ArtistService.listVisible`: live and visible, by name ignoring case, then id (what intake and the dashboard use). No pagination: a studio has a handful, and `{ data }` leaves room. Rejected: an owner-chosen order (a column and UI; TAT-54's sections).
10. **`getArtist` is by the artist's slug, matched exactly.** The route matcher is `ARTIST_SLUG` (the validator's shape, which every stored slug has: an owner profile takes the tenant slug, a subset), so an uppercase or malformed slug is the router's 404 without a query; then `ArtistService.findVisibleBySlug(tenant, slug)`. Hidden, deleted, unknown, another studio's and a renamed-away slug are one `not_found`. Artist slugs have no aliases (TAT-31 warns owners that a change breaks the old link). Rejected: by id (the slug is the link the owner chose); case-folding.
11. **TAT-31's privacy questions.** The API never names a hidden or deleted artist's photo; the file stays on the public disk at its unguessable URL for anyone who already had it; an owner who wants it gone uses Remove photo (deleted after commit), and purging files of deleted records is TAT-42's. A deleted profile frees its slug, and a new profile may take it: the studio's own page, the owner's choice. A deleted account's profile stays public until an owner hides it (TAT-33/TAT-42). Nothing here changes those.
12. **One read layer, no models in answers.** `StudioPageService` (new `storefront` module, the architecture's "Storefront: studio page configuration") reads through `ArtistService` (gaining `findVisibleBySlug`) and `ImageService`; the tenant row is the one `publicTenant` loaded. It hands transformers typed sources (`TenantProfile` plus slug and type; a `ShownArtist`), and the transformers write each field as a literal. Queries: one per endpoint (`listVisible` or the slug lookup); photo URLs are built without I/O. Rejected: serializing models; artists embedded in `getStudio` (two cacheable reads, as the contract has them).
13. **Caching: all three use `publicCache()`.** 60 s plus stale-while-revalidate 600 s, a strong ETag and 304s; every 404 is `no-store`. Under an old slug they answer as the alias (TAT-32 ruling 6) with the same body and ETag; a CDN keys each URL apart, and only `getStudio` names the current slug (TAT-12 redirects with it). An owner's edit, a hidden artist or a slug change shows within about a minute plus one stale answer. Rejected: a longer max-age for artists; cache purging (no CDN yet, TAT-27).
14. **The contract and the tests are the allow-list.** `Studio`, `Artist` and the artist's `Photo` get `additionalProperties: false`, every property required (`null` when empty). `Photo` is `Image` without the optional `alt` (the page builds it from the name); `Image` stays for V1's branding and portfolio, which may have an `alt`. Platform tests compare the whole `{ data }` with `assertApiData` (TAT-47 adds its schema check there, so these tests get it), a test lists the exact field names, and a canary test seeds every private value (deposit policy, account numbers, member emails and ids, client, inquiry, project, payment, hidden and deleted artists) and finds none in any answer. SDK and React fixtures are typed as the generated `Studio` and `Artist`, so typecheck catches drift. Rejected: `@tattoo-drip/types` in the platform (its `.ts` sources would join the platform's compile) or a YAML validator now (TAT-47 chooses one).
15. **React options set no `staleTime` or `retry`.** Keys stay tenant-first (`artist` under `artists`); the app's defaults rule, which in our storefront are TAT-23's (60 s, the API's max-age; never a 4xx retry; never on the server). Rejected: 60 s in the factories (overrides the app; TAT-23's docs say options set none unless a resource needs one, as the deposit page does).
16. **The isolation fixture gets a studio-specific artist slug.** `twoStudios()` gives each studio a `closedArtist` (visible, closed, slug `<studio slug>-mira`), because both studios' `sita` would let "B's artist under A's path" answer A's own artist. Its id and name join `publicMarkers`. Rejected: changing `sita` (it pins per-tenant uniqueness).

## Shapes

| Field | Source |
|---|---|
| `Studio.slug`, `name`, `type`, `intro`, `timezone` | tenant row (`slug` current) |
| `Studio.contact.phone`, `.email`, `.address` | `contact_phone`, `contact_email`, `address` |
| `Studio.socialLinks[]` | `instagram_url`, `facebook_url`, `tiktok_url`, `website_url` (set, https) |
| `Studio.acceptingInquiries` | `studioTakesInquiries(listVisible)` |
| `Artist.id`, `slug`, `name`, `bio`, `acceptingInquiries` | artist row |
| `Artist.closedMessage` | `closed_message`, null while accepting |
| `Artist.photo` | `{ url, width, height }` from `photo_key`/`photo_width`/`photo_height`, or null |

Routes: `GET /api/v1/tenants/:tenant` (`api.v1.studio`), `GET …/artists` (`api.v1.artists.index`), `GET …/artists/:artist` (`api.v1.artists.show`), all `publicCache()`, each with a case in `public_cases.ts`.

## Tests

Unit: `studioTakesInquiries`, `socialLinks`. Service: `findVisibleBySlug` (exact case, hidden, deleted, other tenant), `StudioPageService` (each field, closed message, photo URL, zero artists, the artists read once per call). HTTP: the exact `{ data }` of each endpoint and its field list, hidden and deleted artists, zero visible artists, an independent studio, the photo, old slugs, cache headers, ETag and 304, HEAD, 404s (`no-store`), 405, the matcher, no cookies, the canary test. Isolation: three public cases (B's artist slug under A's path and A's under B's are 404s). SDK and React: URLs, encoding, unwrapping, 404 errors, keys, no `staleTime`/`retry`.

## Docs

`apps/platform/docs/backend.md` (Public API: the studio page reads; Artists: `findVisibleBySlug`), `apps/platform/docs/testing.md` (`closedArtist`, the artist cases), `docs/sdk.md` (what the three reads return), `docs/data-model.md` (`StorefrontConfiguration` is V1; the MVP's configuration), `docs/architecture.md` (the Storefront module row), `docs/requirements.md` (tick "Tenant profile"; a studio-page rule). `docs/README.md` anchors don't change (no heading moves).

## For later tickets

- **TAT-48:** render every string as text; `socialLinks` by `platform` (unknown ones as plain links); show the form when `acceptingInquiries`, else each closed artist's `closedMessage`; `photo` with its `width`/`height` and `alt` from the name; `getArtist`'s 404 is the router's not-found (TAT-23's `rethrowAsNotFound`).
- **TAT-47:** hook the schema check into `assertApiData`; `Studio`, `Artist` and `Photo` already forbid extra properties.
- **TAT-77:** `serviceIds` (or a services list) returns to `Artist` as an addition.
- **TAT-54:** `Studio.storefront` (`StorefrontConfiguration`) as an addition.
- **TAT-38:** these reads are cacheable: no per-caller headers on them (TAT-32 ruling 16).
- **TAT-27 / media:** resized photo variants as new `photo` fields; keep the URL free of anything but the tenant id and a random name.
- **TAT-42:** purge files of deleted artists; decide whether a deleted account's profile stays public.

## Not in this ticket

Portfolio, services, flash, styles, placements (TAT-77), availability (TAT-49), the page (TAT-48), themes and branding (TAT-54, TAT-56), rate limits and the server key (TAT-38), the contract-test suite (TAT-47). **Before any public deploy:** TAT-38, TAT-55, TAT-27 (the local disks, and the photo URLs on them, must never deploy).

## Verification

`pnpm --filter @tattoo-drip/types generate` and `node ace codegen` leave no diff; the full platform suite, the SDK, React (and storefront, if present) tests, `pnpm check`, `pnpm typecheck` and `pnpm build` pass on Node 24.3.0. Then the whole-branch review and the Codex code and security reviews.
