# Roadmap

There are no dates here. Each phase starts only after the previous gate is passed. The evidence is in the [market research](research.md), and the scope is in [requirements](requirements.md).

```text
Validation ──► MVP pilot ──gate 1──► V1 paid launch ──gate 2──► V2 expand
```

## 0. Validation (runs before and alongside the MVP build)

- 12 interviews with studio owners and artists: 8 in Kathmandu, 2 in Lalitpur, 2 in Pokhara
- A NEXSalon demo and price, a day shadowing two studios, and a click-through prototype of the intake link and deposit page
- Talks with Khalti and a Fonepay aggregator; legal checks on Nepal Rastra Bank rules and the Individual Privacy Act 2075
- Recruit 5 pilot studios for a concierge setup

## MVP: prove the inquiry-to-deposit loop

The loop: intake link, inquiry inbox and project board, quote with deposit and QR proof, sessions with the balance due, clients matched by phone, studio page, installable mobile web app. It runs on the foundation already planned: auth, tenancy, row-level security, the API and hosting.

**Gate 1:** within 6 weeks, at least 3 of the 5 pilot studios receive most new custom inquiries through the link and record every deposit in Tattoo Drip, and 3 prepay. If studios keep quoting in chat, narrow the wedge to a deposit-and-schedule tool.

## V1: solid enough to pay for

- Automatic deposit confirmation (Khalti, or Fonepay through an aggregator)
- Flash and bookable consultation and piercing slots (availability and slot engine)
- SMS reminders, aftercare and healing-check messages
- Studio site with portfolio, flash, themes and a custom domain
- Tourist mode, reports, client data deletion, security review

**Gate 2:** 20+ paying studios who stay past 3 months.

## V2: expand beyond the desk

Only where interviews show pain:

- Guest artists and payouts, and multi-location
- Consent forms (after legal review)
- Chat-app integrations, if the links prove insufficient
- Public API and SDK for agencies
- A second market that Stripe doesn't serve (for example Sri Lanka or Bangladesh)

## Later, maybe never

Page builder, marketplace, AI design tools, customer accounts, POS and inventory, native apps, loyalty and reviews, GraphQL.

## In Linear

The team is `tattoo-drip` (TAT). Every issue carries a **Stage** label (`MVP`, `V1` or `V2`); filter by it to see what's in scope now. Validation work lives in the project **R · Validation & pilot**.
