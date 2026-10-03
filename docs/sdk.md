# SDK

The SDK is an official developer product. Every storefront, including ours, uses it against the same public API. So anything the hosted storefront can do, a custom storefront can do too. And the backend can change internally without breaking clients.

## Packages

```text
REST API /api/v1  →  @tattoo-drip/types  →  @tattoo-drip/sdk  →  @tattoo-drip/react  →  React storefront
```

Dependencies only point toward the API.

| Package | Responsibility | Must not depend on |
|---|---|---|
| `@tattoo-drip/types` | `openapi.yaml` (the API contract) and the types generated from it | runtime code |
| `@tattoo-drip/sdk` | The API client. Works anywhere `fetch` exists (browser, Node, edge, React Native). | React, TanStack Query, AdonisJS |
| `@tattoo-drip/react` | Provider, hooks and query options. React and TanStack Query are peer dependencies. | AdonisJS, app code |

Who uses what:
- **Our storefront:** `react` + `sdk`
- **Other React apps:** `react`
- **Everything else** (Astro, Vue, mobile, scripts): `sdk`

## Core SDK

The core SDK covers one API version (`v1`), one tenant per client, typed inputs and outputs, and typed errors (`TattooApiError` with `status`, `code` and `fields`). It has no caching or UI state, and business rules stay in the backend.

```ts
import { createTattooClient, isTattooApiError } from "@tattoo-drip/sdk";

const client = createTattooClient({ baseUrl: "https://api.example.com", tenant: "blackneedle" });

const studio = await client.studio.get();               // profile + storefront config
const artists = await client.artists.list();
const { data, nextCursor } = await client.portfolio.list({ style: "fine-line" });
const slots = await client.availability.list({ artistId, serviceId, from: "2026-11-01" });

try {
  await client.bookings.create({
    artistId,
    serviceId,
    startsAt: slots[0].startsAt,
    customer: { name: "Ana", email: "ana@example.com" },
    tattoo: { idea: "Fine line peony on the forearm", style: "fine-line", placement: "forearm" },
    referenceImages: [file],                             // sent as one multipart request
    challengeToken,
  });
} catch (error) {
  if (isTattooApiError(error) && error.code === "slot_unavailable") {
    // Ask the customer to pick another time
  }
}
```

The other namespaces are `artists.get(slug)`, `services.list({ artistId })`, `styles.list()` and `placements.list()`.

## React adapter

The app owns the `QueryClientProvider`, and `TattooProvider` goes inside it. Query keys always include the tenant, so cached data can't leak between tenants on a shared server.

```tsx
<TattooProvider client={client}>
  <App />
</TattooProvider>

const { data: artists } = useArtists();
const slots = useAvailability(artistId && serviceId ? { artistId, serviceId } : null);
const createBooking = useCreateBooking();
```

Hooks: `useStudio`, `useArtists`, `useArtist`, `useServices`, `usePortfolio`, `useAvailability`, `useStyles`, `usePlacements`, `useCreateBooking`.

For SSR prefetching in route loaders, use `tattooQueries.*` with `queryClient.ensureQueryData(tattooQueries.artists(client))`.

## Hosted storefront = external storefront

The hosted storefront gets **no special access**. It uses the same endpoints and packages. If it needs something the API doesn't expose, the fix is to add it to the API. The only differences:

- The tenant comes from the subdomain on each request.
- Server-side rendering sends a secret server key, which is used only for rate limiting.
- Bookings go from the browser straight to the API.

```ts
// apps/storefront, server side
const tenant = new URL(request.url).hostname.split(".")[0];
const client = createTattooClient({ baseUrl: API_URL, tenant, key: env.STOREFRONT_SERVER_KEY });
```

The SDK throws if it is given a key in a browser.

## Contract, keys, stability

- **Contract:** `packages/types/openapi.yaml` is the source of truth. After editing it, run `pnpm --filter @tattoo-drip/types generate`. Backend contract tests check that real responses match the spec, and the spec will also generate the developer portal docs. A contract-test ticket is planned.
- **Versioning:** within `/api/v1`, changes are additive only. Breaking changes mean `/api/v2` and a new SDK major version.
- **Lists:** responses are wrapped in `{ data }`, so pagination metadata can be added without breaking clients.
- **Keys:** V1 has anonymous public endpoints plus the storefront's server key. Publishable keys (browser, origin-restricted) and secret keys (servers only) come with the developer portal.
- **Distribution:** packages are `private` and `0.x` until the developer platform opens. They're already built to publish (`pnpm build` writes `dist/`, and `publishConfig` switches `exports` to it), so the public API isn't frozen before our own storefront has proved it.
