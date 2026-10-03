# Product

> Start here, then read [requirements](requirements.md) → [architecture](architecture.md) → [data-model](data-model.md) → [sdk](sdk.md) → [roadmap](roadmap.md).

A multi-tenant SaaS for tattoo businesses. Each business is a **tenant** and gets three things:

- a **dashboard** to run the business
- a **public storefront** where customers browse work and request bookings
- a **public API + SDK**, so the storefront can be replaced with a custom one

## Users

| User | Needs |
|---|---|
| Studio owner | Run a multi-artist studio: profiles, portfolios, services, calendars, requests and a website |
| Independent artist | The same tools for a one-person business |
| Studio artist | Their own portfolio, availability and bookings |
| Customer | Browse work and request a tattoo without an account |
| Developer | Build a custom storefront or app on the platform |

## Problems it solves

- Requests arrive through DMs and email, often missing the idea, placement, size or references.
- Generic booking tools assume fixed prices and instant confirmation. Tattoo work needs a review first.
- Studios need a portfolio and a calendar for each artist.
- Studios want a good website without having to build one.

## Tenants

A tenant is either a **studio** (several artists) or an **independent artist** (one). Both use the same platform and the same features. One person can belong to several tenants, with a different role in each:

```text
John
  Owner  → Black Needle Studio
  Artist → Ink House
  Owner  → John's Independent Tattoo
```

A tenant (the business) and an artist (a person's public profile) are separate concepts.

## Product areas

- **Dashboard:** profile, team and artists, portfolio, services, calendar, availability, bookings, customers, storefront and branding, settings.
- **Storefront:** a public site for each tenant at `blackneedle.platform.com`, with artists (`/artists/john`), portfolio, services and booking requests.
- **Developer platform:** the REST API and the SDK are product features. The hosted storefront is built on them. Others will be able to build Next.js, Astro, Vue or mobile clients on the same API.

## Storefront customization levels

These are three separate levels, not stages of one feature:

| Level | What the tenant does | When |
|---|---|---|
| 1. Hosted theme | Picks a theme and sets the logo, colors, fonts, hero image, description, social links and visible sections | V1 |
| 2. Page builder | Arranges blocks visually | Future |
| 3. Custom storefront | Builds their own frontend on the API/SDK | API/SDK in V1; open to external developers later |

## Core journeys

**Set up a studio:**
1. Sign up, create the tenant and pick a subdomain.
2. Invite artists, or create their profiles first and let artists claim them when they join.
3. Add services and portfolio projects, then set availability.
4. Choose a theme. The storefront is live.

An independent artist follows the same steps as both owner and only artist.

**Request a tattoo:** the customer browses, then picks a service, an artist and an open time. They describe the idea, upload references, add contact details and submit without an account. Emails confirm that the request arrived and what the studio decided. Replies go straight to the studio.

**Review a request:** the studio gets an email about the request.
- If the requested time works, they approve and confirm in one step.
- If not, they approve and agree a time first, or reject the request.

A confirmed request becomes an appointment. After the session, it's marked completed or no-show. Bookings made by phone, walk-in or DM are added by hand, so online availability stays correct.

**Work across tenants:** a user switches tenants in the dashboard. Tenant data never mixes.

**Custom storefront (later):** a developer installs the SDK, points it at a tenant and builds their own site.
