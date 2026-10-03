# Roadmap

There are no dates here. Order and scope only. Scope and rules are in [requirements](requirements.md).

## MVP / V1

Each milestone is an epic in the tracker. The order is rough, and some milestones overlap.

| # | Milestone | Scope |
|---|---|---|
| 0 | Monorepo & tooling | Workspace, Biome, CI. *Workspace done.* |
| 1 | Foundation | Auth hardening, tenants, memberships, invites, roles, tenant context, row-level security, slugs |
| 2 | Business content | Artists, portfolio, services, style and placement lists, image uploads |
| 3 | Public API & SDK | `/api/v1` endpoints from `openapi.yaml`, contract tests, SDK and React adapter |
| 4 | Hosted storefront | Prototype moved onto the SDK, subdomain tenants, themes and customization |
| 5 | Scheduling | Availability, exceptions, slots, calendar, manual appointments |
| 6 | Bookings & emails | Guest requests, approval flow, customers, emails, abuse protection, data deletion |
| 7 | Launch readiness | Hosting, deploys, monitoring, backups, security review |

V1 is done when a studio and an independent artist can each sign up, publish a storefront, receive requests and confirm appointments, with no way to reach another tenant's data.

## Post-MVP

These are ordered by V1 feedback:

- **Notifications:** reminders, SMS, editable templates
- **Custom domains:** `blackneedle.com`
- **Customer accounts:** self-service cancel and reschedule
- **Payments and deposits:** a deposit between `approved` and `confirmed`
- **Integrations:** Google Calendar sync
- **Themes:** more themes and options
- **Analytics**
- **Staff:** roles and finer permissions
- **Booking:** "any available artist" bookings, multi-session pieces
- **Flash designs:** fixed-price, directly bookable
- **Billing:** one paid plan per tenant, then tiers
- **Security:** two-factor auth

## Future

- **Page builder:** customization level 2, extending `StorefrontConfiguration.sections`
- **Developer portal:** publishable and secret keys, API docs from the spec, npm release, official support for custom storefronts (level 3)
- **Webhooks**
- **SDK adapters:** more frameworks
- **Plugins:** integrations, maybe a marketplace
- **Mobile clients:** built on `@tattoo-drip/sdk`
- **Direct messaging**
- **Reviews**

## Not planned

- **GraphQL:** REST covers current needs.
