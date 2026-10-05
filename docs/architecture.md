# Architecture

A **modular monolith**: one AdonisJS app owns the data, the business rules and the API, and runs as a web process plus a worker. The dashboard (Inertia + React) lives inside it. The storefront is a separate TanStack Start app that talks to the platform only through the API. There are no microservices.

```mermaid
flowchart TB
  subgraph platform["apps/platform (AdonisJS)"]
    dash["Inertia dashboard"]
    api["REST API /api/v1"]
    worker["Worker: emails, images"]
    domain["Domain modules (tenant-scoped)"]
    dash --> domain
    api --> domain
    worker --> domain
  end
  members(["Tenant members"]) --> dash
  customers(["Customers"]) --> store["apps/storefront (TanStack Start)<br/>@tattoo-drip/react → @tattoo-drip/sdk"]
  devs(["External developers (later)"]) --> custom["Custom storefront<br/>@tattoo-drip/sdk"]
  store -->|HTTPS| api
  custom -->|HTTPS| api
  domain --> db[(PostgreSQL)]
  domain --> files[(Object storage)]
```

## Monorepo

The monorepo uses pnpm workspaces, with Biome for formatting and linting.

```text
apps/platform      AdonisJS 7 + Inertia + React: dashboard, REST API, worker
apps/storefront    TanStack Start: hosted storefront
packages/types     @tattoo-drip/types: openapi.yaml + generated types
packages/sdk       @tattoo-drip/sdk: framework-independent API client
packages/react     @tattoo-drip/react: TanStack Query hooks
```

- The storefront never imports from `apps/platform`, and `packages/*` never import from `apps/*`.
- Packages are consumed from source inside the workspace.
- A `packages/ui` package is added when the first component is actually shared.

## Backend modules

Each module owns its models and services. Other modules call its services instead of querying its tables. Inertia controllers, API controllers and jobs stay thin and call the **same** services, so every rule lives in one place. In `apps/platform`, each module is a folder in `app/modules/<module>/` (see `apps/platform/AGENTS.md`).

| Module | Owns | Stage |
|---|---|---|
| Identity | Users, auth, email verification | MVP |
| Tenancy | Tenants, memberships, invites, roles, tenant context | MVP |
| Artists | Artist profiles | MVP |
| Clients | Clients matched by phone, history | MVP |
| Inquiries | Intake, reference images, abuse protection | MVP |
| Projects | Projects, lifecycle, quotes, notes | MVP |
| Payments | Payment methods (studio QR codes), deposit pages, proofs, verification, balance. Gateways in V1 | MVP |
| Scheduling | Sessions, artist calendar, no-overlap. Availability, exceptions and slots in V1 | MVP |
| Notifications | Staff alerts (MVP), click-to-chat templates (MVP), SMS reminders (V1) | MVP |
| Storefront | Studio page configuration. Themes in V1 | MVP |
| Catalog | Services, flash, style and placement lists | V1 |
| Portfolio | Portfolio items and images | V1 |

## Tenant context

The tenant is always in the URL.

| Entry point | Tenant comes from | Checked |
|---|---|---|
| Dashboard | `/t/blackneedle/projects` | Membership and role, on every request |
| REST API | `/api/v1/tenants/blackneedle/…` | The tenant exists (old slugs resolve as aliases) |

The URL works better than a session or a header:
- Tabs open on different tenants each act on the tenant on screen.
- A path works for any client on any domain.
- The URL is a correct CDN cache key.

The hosted storefront maps its subdomain to the slug.

Isolation has several layers:

1. Middleware resolves the tenant and checks the membership.
2. Services scope every query by tenant. Never trust a tenant ID sent in a request body.
3. **PostgreSQL row-level security** on tenant-owned tables. The app connects as a role that doesn't own the tables, and sets the tenant per transaction with `SET LOCAL`. If no tenant is set, queries return no rows.
4. Composite foreign keys block links between tenants (see [data-model](data-model.md)).
5. Every tenant-owned endpoint has a test proving that tenant A can't reach tenant B's data.

## Domains, sessions, auth

- Storefronts run on `{slug}.platform.com`. The dashboard (`app.`) and the API (`api.`) run on a **separate** registrable domain, so tenant subdomains can never read or set dashboard cookies.
- The dashboard session cookie is host-only (`__Host-`), `HttpOnly`, `Secure` and `SameSite=Lax`, with CSRF protection on.
- The public API is stateless and cookieless. CORS is open on its public endpoints, without credentials.
- Auth uses AdonisJS's session guard: email and password, email verification, password reset and rate-limited login.

## Request flows

**Intake (customer → API)**
1. The studio page maps `blackneedle.platform.com` to the `blackneedle` slug and loads the profile and artists through the SDK.
2. The browser sends the inquiry, reference images and bot-challenge token **directly to the API** as one multipart request. Going direct avoids storefront body-size limits, lets rate limits see the real IP, and leaves no orphaned uploads.
3. The API checks the challenge and limits and processes the images. The Inquiries module matches or creates the client by phone and saves the inquiry as `new`.
4. A job alerts the studio's staff by email and in the app.

**Deposit (customer → studio)**
1. Staff accept the inquiry, which creates a project, and send a quote. The project moves to `deposit_pending`, and a deposit page link goes out through a one-tap WhatsApp or Viber message.
2. The client pays with the studio's own QR code and uploads proof on the deposit page.
3. An owner verifies the proof in the dashboard, and the project moves to `booked` when a session is scheduled. **No money passes through Tattoo Drip in the MVP**, so no payment licence is needed.

**Dashboard action**
1. "Verify payment" or "Schedule session" runs auth, tenant and role middleware.
2. The Payments or Scheduling service writes in one transaction. The no-overlap constraint settles any race between two sessions.
3. Inertia returns new props.

## Files, scale, hosting

- **Uploads** always go through the API. Images are re-encoded, which strips EXIF data and GPS location, converts HEIC and rejects disguised files. The worker resizes them.
- **Image visibility:** portfolio images are public behind a CDN. Reference images are private and served through short-lived signed URLs, issued only after a membership check.
- **Caching:** public reads and storefront pages use short `Cache-Control` TTLs with `stale-while-revalidate` behind a CDN. Slots have the shortest TTL.
- **Rate limits** apply per IP and per tenant. The storefront's server-side rendering calls the API with a secret **server key**. The key only stops the storefront server from counting as one client, and grants no extra data.
- **Jobs** use a PostgreSQL-backed queue, with no Redis. Every job carries its tenant.
- **Email** is sent from the platform domain, with SPF, DKIM and DMARC set up. It is never sent from a tenant's domain.

| Part | Where |
|---|---|
| Storefront | Vercel, root directory `apps/storefront`, wildcard domain |
| Platform web + worker | Containers on a managed host, in the same region as the database |
| PostgreSQL | Managed, with backups and point-in-time recovery |
| Files | Cloudflare R2 (S3 API, no egress fees) + CDN |

## Payments and messaging

- **MVP:** studios upload their own Fonepay, eSewa and Khalti QR codes. Customers pay the studio directly and upload proof, and staff verify it. Tattoo Drip never holds money.
- **V1:** automatic confirmation through Khalti ePayment (start the payment on the server, then confirm it with a lookup), or a dynamic Fonepay QR through an aggregator. A direct Fonepay integration costs each merchant NPR 25,000; aggregators charge per transaction. Decide after the partner talks, and get legal advice on Nepal Rastra Bank rules before collecting money on a studio's behalf.
- **Messaging:** one-tap `wa.me` and `viber://` links with prefilled text. There is no WhatsApp Business, Instagram or Viber Business API: each needs approval and costs money per message or per month, and the [research](research.md) found no evidence that the links aren't enough.
- **Dashboard:** an installable, mobile-first web app (PWA) built with Inertia and React. Native apps are not planned.

## Storefront themes

In the MVP the studio page has one layout, generated from the profile and artists. In V1, themes are React components in the storefront. Tenants never store markup or scripts: their `StorefrontConfiguration` picks a theme and fills in its options.

## Current state

- **`apps/platform`** is the AdonisJS 7 React starter, switched to PostgreSQL, with its pages rebuilt on Tailwind CSS v4 and shadcn/ui (stock zinc theme, light and dark). It has session auth with signup, login and dashboard pages. The users migration has not been run yet.
- **`apps/storefront`** is the single-artist prototype. It still uses mock data. Booking is an in-dialog inquiry form (TanStack Form with a Zod schema) that only simulates sending until the inquiries API exists. The prototype's Prisma, better-auth and Supabase code has been removed.
- **UI:** both apps use Tailwind CSS v4 and shadcn/ui with the same `components.json` settings, each with its own theme. A shared design system for both is planned and will replace the per-app themes.
- **`packages/*`** hold a working SDK against a draft `openapi.yaml`. That draft still describes the old booking flow (`bookings.create`, `availability`) and must move to inquiries (tracked in Linear). The API endpoints themselves are not built yet.
