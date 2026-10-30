# SDK

For now the SDK is an **internal** product: our studio page uses it against the public API, which keeps that API honest. It becomes a developer product (npm release, keys, docs) in V2, and only if agencies ask to build on Tattoo Drip. The [research](research.md) found very few studios with custom sites, and tattoo.dev already offers a headless tattoo API in beta.

The architecture doesn't change: anything our studio page can do, a custom storefront will be able to do too.

## Packages

```text
REST API /api/v1  →  @tattoo-drip/types  →  @tattoo-drip/sdk  →  @tattoo-drip/react  →  studio page
```

Dependencies only point toward the API.

| Package | Responsibility | Must not depend on |
|---|---|---|
| `@tattoo-drip/types` | `openapi.yaml` (the API contract) and the types generated from it | runtime code |
| `@tattoo-drip/sdk` | The API client. Works anywhere `fetch` exists (browser, Node, edge, React Native) | React, TanStack Query, AdonisJS |
| `@tattoo-drip/react` | Provider, hooks and query options. React and TanStack Query are peer dependencies | AdonisJS, app code |

## Public API by stage

| Stage | Resources |
|---|---|
| MVP | `studio.get` (profile, studio page config), `artists.list` and `artists.get`, `work.list` (the gallery), `styles.list`, `inquiries.create`, `deposits.get`, `deposits.submitProof` |
| V1 | `services`, `flash`, `availability` (slots for instant booking), `placements` |
| V2 | Keys for external developers, webhooks if agencies need them |

Inquiries, clients, quotes and payments are never readable through the public API. The deposit page is the one exception: it reads a single project's deposit details (and, once paid, its next session's start and artist) through an unguessable link token.

The studio page reads `client.studio.get()`: `slug` (the current one), `name`, `type`, `intro`, `timezone`, `contact` (`phone` in E.164, `email`, `address`, each possibly null), `socialLinks` (`{ platform, url }`, https only, in the order instagram, facebook, tiktok, website; show any other `platform` as a plain link) and `acceptingInquiries`, which is false only when every visible artist is closed, exactly when `inquiries.create` without an artist answers `studio_not_accepting`. `client.artists.list()` gives the visible artists by name and `client.artists.get(slug)` one of them (a hidden, deleted or unknown artist is a 404 `not_found`): `id` (the `preferredArtistId` to send), `slug`, `name`, `bio`, `photo` (`{ url, width, height, variants }` or null; `variants` are the photo's smaller copies, `{ url, width }`, narrowest first, on the photo's origin, for `srcset`, and `[]` when it has none), `acceptingInquiries` and `closedMessage` (null while they accept), `workPhotos` (the artist's six newest photos, `{ url, width, height, alt, variants }`, newest first, `[]` when none; the rest are in `work.list`), `styles` (`{ slug, name }`, up to five, in the fixed list's order, `[]` when none) and `socialLinks` (`{ platform, url }`, https only, in the order instagram, facebook, tiktok, `[]` when none). All three are cached for 60 seconds, and every string is plain text: render it as text. React: `useStudio()`, `useArtists()`, `useArtist(slug)`; their options set no `staleTime` or `retry`, so the app's defaults decide.

The gallery is `client.work.list({ artist?, style?, healed?, cursor?, limit? })`: it gives the whole body, `{ data, nextCursor, filters }`, with every photo of every visible artist (a closed artist's too) newest first, 24 a page (at most 48). Each photo is `{ url, width, height, alt, variants, styles, healed, artist: { slug, name } }`. `nextCursor` goes back as `cursor`, with the same filters, for the next page, and is null on the last. `healed` is `true` (only healed photos); `false` is the same as leaving it out. `filters` lists the styles at least one photo carries (only the `artist`'s when it is given) and whether one is `healed`: offer only those. It is cached for 60 seconds, and a malformed parameter or cursor is `validation_failed` (422). `client.styles.list()` is the fixed list of styles, in its order. React: `useWork(query)`; its options set no `staleTime`, like the artists'.

The deposit page reads `client.deposits.get(token)` and sends the screenshot with `client.deposits.submitProof(token, { proof, method, expectedAmount })`, where `expectedAmount` is the page's `deposit.due` (React: `useDeposit(token)`, `useSubmitDepositProof(token)`). The token is the fragment of the link the studio sent (`https://<studio>/deposit#<token>`): a bearer secret that must stay out of logs and analytics. Every link that doesn't work is a 404; a state that takes no screenshot is `deposit_not_due` and a stale amount `deposit_changed` (both 409: refetch the page). Both calls are never cached and rate-limited per address and per link.

The storefront's deposit page is `apps/storefront/src/deposit/` ([deposit page](../apps/storefront/docs/development.md#deposit-page)): it reads the token from the fragment in the browser only, re-encodes the screenshot as a JPEG before the upload, and never polls.

The intake form sends `client.inquiries.create(input)` (React: `useCreateInquiry()`) straight from the browser. `challengeToken` is the token of the studio page's Cloudflare Turnstile widget, rendered with action `INQUIRY_CHALLENGE_ACTION` (`inquiry`); the SDK sends it as the `X-Challenge-Token` header, which the API checks before it reads the upload (so the request preflights). A token is single-use: reset the widget after every answer, success or error. `honeypot` is the value of a hidden text input named `INQUIRY_HONEYPOT_FIELD` (`website`) that people never fill; the SDK sends it only when it isn't empty. `challenge_failed` (403: a bad, expired or reused token, or a filled honeypot) means get a new token and try again; `challenge_unavailable` (503) means the API couldn't check it; `rate_limited` (429) carries `retryAfter` in seconds (limits per address, studio and phone; up to a day for one phone number). Nothing retries by itself.

The studio page's form is `apps/storefront/src/intake/` ([intake form](../apps/storefront/docs/development.md#intake-form)): it shrinks photos to JPEG in the browser before the upload, renders the widget in execute mode at Send, and never retries on its own.

## Core SDK

The core SDK targets one API version (`v1`) and one tenant per client. It has typed inputs and outputs, typed errors (`TattooApiError` with `status`, `code`, `message`, `fields` and `retryAfter`), no caching or UI state, and no business rules. Every call sends `Accept: application/json` and no cookies (`credentials: "omit"`), gives up after `timeoutMs` (10 seconds by default) with code `timeout`, and takes `{ signal }` to cancel, after which it rejects with the signal's `AbortError`. A response that never arrived is status 0 with `timeout` or `network_error`; a 2xx whose body is not a JSON object with `data` (empty, not JSON, or a bare string, number, boolean, null or array) is `invalid_response` with the HTTP status, never a raw `TypeError` and never carrying the body's text; an error response with such a body is `unknown_error`. `inquiries.create` uploads, so it waits up to 2 minutes unless its own `{ timeoutMs }` says otherwise.

```ts
import { createTattooClient, isTattooApiError } from "@tattoo-drip/sdk";

const client = createTattooClient({ baseUrl: "https://api.example.com", tenant: "blackneedle" });

const studio = await client.studio.get();
const artists = await client.artists.list();

try {
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
    challengeToken,                                     // the Turnstile widget's token; sent as X-Challenge-Token
    honeypot: websiteInput.value,                       // the hidden "website" input; empty for people
  });
} catch (error) {
  if (isTattooApiError(error) && error.code === "too_many_open_inquiries") {
    // Tell the customer the studio already has their request
  }
}
```

## React adapter

The app owns the `QueryClientProvider`, and `TattooProvider` goes inside it. Query keys always include the tenant, so cached data can't leak between tenants on a shared server.

```tsx
<TattooProvider client={client}>
  <App />
</TattooProvider>

const { data: artists } = useArtists();
const createInquiry = useCreateInquiry();
```

`useCreateInquiry()` never retries, even when the app's `QueryClient` retries mutations by default: its options (`tattooMutations.createInquiry(client)`) set `retry: false`, because a retry after a timeout could send the inquiry twice.

For SSR prefetching in route loaders, use `tattooQueries.*` with `queryClient.query({ ...tattooQueries.artists(client), staleTime: "static" })`: cached data, else one fetch (TanStack Query 5.104 deprecates `ensureQueryData` for this). The query options forward TanStack Query's `signal`, so a query nobody needs any more cancels its request. The options set no `staleTime` except where a resource needs one: the deposit page is always stale (`staleTime: 0`), so a focus refetches it whatever the app's default.

## Studio page = external storefront

The studio page gets **no special access**. It uses the same endpoints and packages. If it needs something the API doesn't expose, the fix is to add it to the API. The only differences:

- The tenant comes from the host on each request: the storefront's tenant middleware confirms it with `studio.get()` and redirects old slugs ([tenants and hosts](../apps/storefront/docs/development.md#tenants-and-hosts)).
- Server-side rendering sends a secret server key (`STOREFRONT_SERVER_KEY`, as `Authorization: Bearer`), used only for rate limiting (TAT-38): with a valid key the platform counts the call by the visitor's address the storefront sends as `X-Visitor-IP` (added with the SDK's `fetch` option, `src/tenancy/visitor.ts`); without one, every call counts against the storefront server's own address.
- Inquiries go from the browser straight to the API.

```ts
// apps/storefront (TAT-23, src/api/): a QueryClient and a client per server request and per tab
// Server: the studio the tenant middleware confirmed, and the server key when set
const serverClient = createTattooClient({ baseUrl: API_URL, tenant: requestStudio().slug, key: STOREFRONT_SERVER_KEY, timeoutMs: 5_000 });
// Browser: only { apiUrl, tenant } crosses, in the router's dehydrated state; no key
const browserClient = createTattooClient({ baseUrl: connection.apiUrl, tenant: connection.tenant });
```

The SDK throws if it is given a key in a browser.

## Contract, keys, stability

- **Contract:** `packages/types/openapi.yaml` is the source of truth. After editing it, run `pnpm --filter @tattoo-drip/types generate`. Contract tests (V1) check that real responses match it.
- **Envelopes and codes:** `{ data }` on success; `{ error: { code, message, fields? } }` on failure. Shared codes: `bad_request`, `not_found`, `method_not_allowed`, `payload_too_large`, `unsupported_media_type`, `validation_failed` (with `fields`), `rate_limited` (with `Retry-After`), `request_timeout` (408, an upload that took longer than 90 s), `service_busy` (503 with `Retry-After`: too many uploads in progress), `internal_error`; every endpoint can answer 429 `rate_limited` (per caller and, for reads, per studio); `createInquiry` adds `artist_not_accepting`, `studio_not_accepting` and `too_many_open_inquiries` (409), `challenge_failed` (403) and `challenge_unavailable` (503); `submitDepositProof` adds `deposit_not_due` and `deposit_changed` (409); every code is listed in `openapi.yaml`. Branch on `code`, never on `message`.
- **Tenants and old slugs:** the path slug is matched exactly. An old slug answers reads like the current one, and `studio.get()` returns the current `slug` (the studio page redirects with it); a write under an old slug is a 404.
- **Stateless, CORS, caching:** no cookies or sessions; CORS allows any origin without credentials. Cacheable reads send `Cache-Control: public, max-age=60, stale-while-revalidate=600` and an `ETag`; everything else is `no-store`.
- **Versioning:** within `/api/v1`, changes are additive only. Breaking changes mean `/api/v2` and a new SDK major version. Until V2 opens the SDK to others, the draft may still change freely.
- **Lists:** responses are wrapped in `{ data }`, so pagination metadata can be added without breaking clients.
- **Keys:** anonymous public endpoints plus the studio page's server key. Publishable and secret keys come with V2.
- **Distribution:** packages stay `private` and `0.x` until V2. They're already built to publish (`pnpm build` writes `dist/`, and `publishConfig` switches `exports` to it).
