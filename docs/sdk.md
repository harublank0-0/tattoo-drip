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
| MVP | `studio.get` (profile, studio page config), `artists.list` and `artists.get`, `inquiries.create` |
| V1 | `portfolio`, `services`, `flash`, `availability` (slots for instant booking), `styles`, `placements` |
| V2 | Keys for external developers, webhooks if agencies need them |

Inquiries, clients, quotes and payments are never readable through the public API. The deposit page is the one exception: it reads a single project's deposit details through an unguessable link token.

## Core SDK

The core SDK targets one API version (`v1`) and one tenant per client. It has typed inputs and outputs, typed errors (`TattooApiError` with `status`, `code`, `message`, `fields` and `retryAfter`), no caching or UI state, and no business rules. Every call sends `Accept: application/json` and no cookies (`credentials: "omit"`), gives up after `timeoutMs` (10 seconds by default) with code `timeout`, and takes `{ signal }` to cancel, after which it rejects with the signal's `AbortError`. A response that never arrived is status 0 with `timeout` or `network_error`; a 2xx without `{ data }` is `invalid_response`. `inquiries.create` uploads, so it waits up to 2 minutes unless its own `{ timeoutMs }` says otherwise.

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
    challengeToken,                                     // TAT-55; ignored until then
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

For SSR prefetching in route loaders, use `tattooQueries.*` with `queryClient.ensureQueryData(tattooQueries.artists(client))`. The query options forward TanStack Query's `signal`, so a query nobody needs any more cancels its request.

## Studio page = external storefront

The studio page gets **no special access**. It uses the same endpoints and packages. If it needs something the API doesn't expose, the fix is to add it to the API. The only differences:

- The tenant comes from the subdomain on each request.
- Server-side rendering sends a secret server key, used only for rate limiting.
- Inquiries go from the browser straight to the API.

```ts
// apps/storefront, server side
const tenant = new URL(request.url).hostname.split(".")[0];
const client = createTattooClient({ baseUrl: API_URL, tenant, key: env.STOREFRONT_SERVER_KEY });
```

The SDK throws if it is given a key in a browser.

## Contract, keys, stability

- **Contract:** `packages/types/openapi.yaml` is the source of truth. After editing it, run `pnpm --filter @tattoo-drip/types generate`. Contract tests (V1) check that real responses match it.
- **Envelopes and codes:** `{ data }` on success; `{ error: { code, message, fields? } }` on failure. Shared codes: `bad_request`, `not_found`, `method_not_allowed`, `payload_too_large`, `unsupported_media_type`, `validation_failed` (with `fields`), `rate_limited` (with `Retry-After`), `internal_error`; `createInquiry` adds `artist_not_accepting`, `studio_not_accepting` and `too_many_open_inquiries` (409); every code is listed in `openapi.yaml`. Branch on `code`, never on `message`.
- **Tenants and old slugs:** the path slug is matched exactly. An old slug answers reads like the current one, and `studio.get()` returns the current `slug` (the studio page redirects with it); a write under an old slug is a 404.
- **Stateless, CORS, caching:** no cookies or sessions; CORS allows any origin without credentials. Cacheable reads send `Cache-Control: public, max-age=60, stale-while-revalidate=600` and an `ETag`; everything else is `no-store`.
- **Versioning:** within `/api/v1`, changes are additive only. Breaking changes mean `/api/v2` and a new SDK major version. Until V2 opens the SDK to others, the draft may still change freely.
- **Lists:** responses are wrapped in `{ data }`, so pagination metadata can be added without breaking clients.
- **Keys:** anonymous public endpoints plus the studio page's server key. Publishable and secret keys come with V2.
- **Distribution:** packages stay `private` and `0.x` until V2. They're already built to publish (`pnpm build` writes `dist/`, and `publishConfig` switches `exports` to it).
