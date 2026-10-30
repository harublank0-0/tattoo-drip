# Roadmap

There are no dates here. Each phase starts only after the previous gate is passed. The evidence is in the [market research](research.md), and the scope is in [requirements](requirements.md).

Tattoo Drip is built by one person. The first real user is a friend's tattoo studio, which is both the design partner and the pilot. Wider validation happens when a chance comes up; it never blocks the build.

```text
Design partner ──► MVP pilot ──gate 1──► V1 paid launch ──gate 2──► V2 expand
```

## 0. Design partner (before and alongside the MVP build)

- Learn how the friend's studio handles inquiries, quotes, deposits and sessions today
- Show them each part of the app as it lands, and use their feedback to cut or reorder MVP scope

### Optional validation

Done only when an opportunity comes up:

- Interviews with studio owners and artists (the original plan: 8 in Kathmandu, 2 in Lalitpur, 2 in Pokhara)
- A NEXSalon demo and price, a day shadowing a studio, and a click-through prototype of the intake link and deposit page
- More pilot studios beyond the design partner

### Before handling money (V1)

- Talks with Khalti and a Fonepay aggregator
- Legal checks on Nepal Rastra Bank rules and the Individual Privacy Act 2075

## MVP: prove the inquiry-to-deposit loop

The loop: intake link, inquiry inbox and project board, quote with deposit and QR proof, sessions with the balance due, clients matched by phone, studio website (gallery, artist portfolios, flash designs clients can ask for, Good to know with opening hours), installable mobile web app. It runs on the foundation already planned: auth, tenancy, row-level security, the API and hosting.

**Gate 1:** for 6 weeks, the design-partner studio receives most new custom inquiries through the link, records every deposit in Tattoo Drip, and would pay the planned price for it. Any other pilot studios that join count the same way. If the studio keeps quoting in chat, narrow the wedge to a deposit-and-schedule tool.

The numbers come from `node build/ace.js metrics:pilot --days=42` (TAT-70): each studio's share of new work through the link, median time from inquiry to verified deposit and no-show rate. Requests that never reached the platform (quoted in chat, never booked) only show up in the check-ins.

## V1: solid enough to pay for

- Automatic deposit confirmation (Khalti, or Fonepay through an aggregator)
- Flash with instant booking, and bookable consultation and piercing slots (availability and slot engine)
- SMS reminders, aftercare and healing-check messages
- More studio site themes and a custom domain
- Tourist mode, reports, client data deletion, security review

**Gate 2:** 20+ paying studios who stay past 3 months.

## V2: expand beyond the desk

Only where studios show the pain:

- Guest artists and payouts, and multi-location
- Consent forms (after legal review)
- Chat-app integrations, if the links prove insufficient
- Public API and SDK for agencies
- A second market that Stripe doesn't serve (for example Sri Lanka or Bangladesh)

## Later, maybe never

Page builder, marketplace, AI design tools, customer accounts, POS and inventory, native apps, loyalty and reviews, GraphQL.

## In Linear

The team is `tattoo-drip` (TAT). Every issue carries a **Stage** label (`MVP`, `V1` or `V2`); filter by it to see what's in scope now. Validation work lives in the project **R · Validation & pilot**. Those tickets are optional and never block engineering work.
