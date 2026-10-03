# Product

> Start here, then read [requirements](requirements.md) → [architecture](architecture.md) → [data-model](data-model.md) → [sdk](sdk.md) → [roadmap](roadmap.md). The evidence behind these decisions is in the [market research](https://claude.ai/code/artifact/aa122abc-254a-4204-a5eb-0b4aaa463cab) (October 2026).

Tattoo Drip is **the booking desk for custom tattoo studios**, starting in Nepal, where global tattoo tools can't take local payments. It turns a WhatsApp or Instagram message into a quoted, deposit-paid tattoo project, and keeps the studio's public page up to date.

The long-term goal is still to be the studio's operating system and digital platform. We earn that one gate at a time (see [roadmap](roadmap.md)).

## Why this, why Nepal first

- Every Nepali studio we checked books request-first: the customer sends an idea, the studio replies, and the slot is confirmed by hand.
- Foreign tattoo tools (InkDesk, Venue, InkQuarters, Tattoo Studio Pro…) already run inquiry → quote → deposit → sessions. But their deposits run on Stripe, which doesn't operate in Nepal. Nepal pays by Fonepay QR, eSewa and Khalti.
- The local option, NEXSalon, is generic salon software. Our edge is the tattoo workflow **plus** local money, local channels and a Nepal-sized price.
- Nepal alone is small. It is the lab; other markets that Stripe doesn't serve come next.

## Users

| User | Needs |
|---|---|
| Studio owner | One place for every inquiry, quotes, deposits that are actually tracked, a schedule per artist |
| Independent artist | The same, for a one-person business |
| Studio artist | See their own projects and sessions on the phone |
| Customer, local or tourist | Send an idea and references easily, know the price and deposit, get a confirmed slot |
| Agency or developer | Build a custom site on Tattoo Drip (later, V2) |

## Problems it solves

- Inquiry details are scattered across WhatsApp, Instagram, Viber and phone, and often incomplete.
- Deposits are paid by QR and proven with a screenshot, then matched by hand.
- Quotes happen in conversation, and customers drift away while waiting.
- Multi-session pieces are tracked from memory: sessions, hours, what's still owed.
- Customer history lives in apps the studio doesn't control. The September 2025 social media ban cut it off overnight.
- Studio websites are stale and disconnected from bookings.

## How a tattoo is sold

A tattoo is a **project**, not an appointment:

```text
inquiry → review → quote → deposit → session(s) → completed → healing check
```

Flash, piercing and walk-ins skip the quote. Details are in [requirements](requirements.md#project-rules) and [data-model](data-model.md).

## Tenants

A tenant is either a **studio** (several artists) or an **independent artist** (one). Both use the same model; a solo artist simply gets a shorter onboarding. One person can belong to several tenants, with a different role in each:

```text
John
  Owner  → Black Needle Studio
  Artist → Ink House
  Owner  → John's Independent Tattoo
```

## Product areas

- **Dashboard:** a mobile-first, installable web app. It holds the inquiry inbox, projects, clients, the artist calendar, artists and settings, including the studio's payment QR codes.
- **Studio page:** `{slug}.platform.com`. In the MVP: the profile, artists, an Instagram link and the intake form. In V1: a full site with portfolio, flash and themes.
- **Developer platform:** the API is used by our own studio page first. The public SDK opens in V2, and only if agencies ask for it.

## Storefront customization levels

| Level | What the studio does | When |
|---|---|---|
| 1. Hosted page | Nothing: the page is generated from data already in the dashboard. Themes and branding arrive in V1 | MVP, V1 |
| 2. Page builder | Arranges blocks visually | Not planned until paying studios ask for it |
| 3. Custom storefront | An agency builds a site on the API and SDK | V2, for agencies |

## Core journeys

**Set up a studio**
1. Sign up, create the tenant, pick a subdomain.
2. Add artists and upload the studio's Fonepay, eSewa or Khalti QR codes.
3. Put the intake link in the Instagram bio and send it in WhatsApp replies.

**Request a tattoo (customer):** open the link from Instagram or a chat, then send the idea, references, placement, size, preferred dates, preferred artist and a phone number. The studio replies on WhatsApp or Viber.

**Quote and deposit (studio)**
1. Review the inquiry and accept it, which creates a project, or decline it.
2. Send a quote with a deposit. The client gets a deposit page with the studio's QR code.
3. The client pays and uploads proof, and staff mark it verified.
4. Book the first session. Further sessions are booked one at a time, and the balance due is tracked.

**Walk-in, phone or DM booking:** staff create the project and session directly at the desk.

**After the session:** mark it completed or no-show. When the last session is done, the project moves to a healing check (touch-up, healed photo).

**Work across tenants:** a user switches tenants in the dashboard. Tenant data never mixes.
