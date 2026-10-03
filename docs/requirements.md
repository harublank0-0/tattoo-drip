# Requirements

What the MVP (pilot with a design-partner studio) and V1 (paid launch) must do, and the rules they follow. The gates between them are in the [roadmap](roadmap.md); the how is in [architecture](architecture.md).

## MVP: the inquiry-to-deposit loop

**Accounts and tenants**
- [ ] Sign up with email and password, verify the email, log in and out, reset the password
- [ ] Create a `studio` or `independent` tenant (needs a verified email), with a unique slug that is also its subdomain
- [ ] Invite members as `owner` or `artist`; revoke invites; remove members; switch between tenants
- [ ] Tenant profile: name, contact phone and email, address, social links, timezone
- [ ] Payment settings: upload the studio's QR codes (Fonepay, eSewa, Khalti, bank) and a default deposit percentage

**Artists**
- [ ] Artist profiles: name, slug, bio, photo, visible or hidden, and an "accepting inquiries" switch with an optional message (the intake form shows the message and hides that artist)

**Intake**
- [ ] A public intake form on the studio page, plus a per-artist link
- [ ] The form asks for: idea, up to 5 reference images (10 MB each; JPEG, PNG, WebP or HEIC), placement, approximate size, preferred dates, preferred artist (optional), name, phone (required; used for WhatsApp or Viber), email (optional), budget (optional), and how they found the studio
- [ ] After submitting, the customer is told the studio will reply on WhatsApp or Viber

**Inquiries and projects**
- [ ] An inbox of new inquiries; accept one (creating a project) or decline it
- [ ] A project board following the [project lifecycle](#project-rules), with notes and a "last contacted" time
- [ ] One tap opens the client's WhatsApp or Viber with a prefilled message: received, quote, deposit link, booking confirmation, reminder, aftercare

**Quotes and payments**
- [ ] Quote: a fixed price, or an hourly rate with estimated hours, plus a deposit amount (which may be zero) and an expiry; quotes can be revised
- [ ] Deposit page per project: amount, the studio's QR codes and a reference code; the client uploads proof of payment
- [ ] Staff verify or reject the proof; cash and bank payments can be recorded at the desk
- [ ] Payments are deposits, session payments, balance payments or refunds; the balance due is computed

**Sessions**
- [ ] Sessions of kind consultation, tattoo or touch-up, each for one artist and inside a project
- [ ] A day and week calendar per artist; overlapping sessions are impossible
- [ ] Mark a session completed, no-show or cancelled, or move it to another time
- [ ] Walk-ins and phone or DM bookings: create the project and the session directly

**Clients**
- [ ] One client per phone number per tenant, with the history of their projects, references and payments

**Notifications, page and app**
- [ ] Staff are alerted to new inquiries by email and in the app. No automatic customer messages in the MVP; replies go through the one-tap chat links
- [ ] Studio page at `{slug}.platform.com`: profile, artists, Instagram link, intake form
- [ ] The dashboard is mobile-first and installable as a web app
- [ ] Pilot metrics: share of inquiries arriving through the link, time from inquiry to verified deposit, session no-shows

## V1: what paid launch adds

- Automatic deposit confirmation: Khalti ePayment, or a dynamic Fonepay QR through an aggregator
- Flash with instant booking, and bookable consultation and piercing slots. This brings services, weekly availability, exceptions, the slot engine, minimum notice and booking horizon
- SMS reminders, plus aftercare and healing-check messages
- Studio site: portfolio, flash, artist pages, themes, branding, custom domain
- English-first tourist mode, with NPR shown alongside approximate USD
- Reports: deposits collected, no-show rate
- Tattoo style and body placement lists
- Deleting a client's personal data on request

## Tenant isolation

This is the most important rule in the system.

1. Every tenant-owned record belongs to exactly one tenant.
2. Every dashboard action checks **both** the user **and** the tenant: the user needs a membership whose role allows the action. The check runs on every request, so removing a member takes effect immediately.
3. Access to one tenant never grants access to another.
4. A record looked up by ID is looked up inside the current tenant; another tenant's record behaves as if it doesn't exist.
5. Related records share a tenant. A project's client, artist and sessions belong to the project's tenant.
6. The public API returns only studio-page data. Inquiries, clients, quotes, payments, payment proofs and reference images are never public.

| Role | Can do |
|---|---|
| `owner` | Everything in the tenant, including verifying payments |
| `artist` | Their own profile, plus the projects and sessions assigned to them |

- Invites are tied to one email, single-use, and expire in 7 days. Only a signed-in user with that verified email can accept one, and an invite can be linked to an existing artist profile for the new member to claim.
- A tenant always has at least one owner. A removed member's artist profile stays with the tenant, unlinked.
- Slugs are unique and avoid reserved names (`www`, `api`, `app`, `admin`…). An old slug stays with its tenant as a redirect.

## Project rules

A project is the sale of one tattoo (or one piercing). Custom work is never booked until its deposit is verified, unless the quote sets the deposit to zero.

```text
inquiry → reviewing → quoted → deposit_pending → booked → in_progress → completed → healing_check

side exits:  reviewing → declined     quoted ⇄ on_hold     deposit_pending → cancelled
shortcuts:   flash or walk-in → booked     in_progress → booked (next session)
```

| Status | Meaning |
|---|---|
| `inquiry` | Submitted, not yet looked at |
| `reviewing` | The studio is checking fit; a consultation session may happen here |
| `declined` | The studio turned it down |
| `quoted` | A quote has been sent |
| `on_hold` | Waiting on the client; returns to `quoted` when they reply |
| `deposit_pending` | Waiting for the deposit, or for proof to be verified |
| `cancelled` | The quote expired, or the client withdrew |
| `booked` | Deposit verified and a session is scheduled |
| `in_progress` | At least one tattoo session done, more to come |
| `completed` | The last session is done and the balance is paid |
| `healing_check` | Follow-up for a touch-up or healed photo |

- A quote's expiry moves an unpaid project to `cancelled`.
- Sessions block the artist's time, and the database rejects overlaps. Each session is `scheduled`, `completed`, `no_show` or `cancelled`; rescheduling changes its time.
- Each studio writes its own deposit policy, which the deposit page shows. Tattoo Drip records what happened to a deposit (kept, moved to a new date, refunded) but doesn't impose a rule.
- Payments are never edited or deleted. A refund is a new payment with a negative amount.
- Balance due = quoted total (or hours × rate) − verified payments.
- Payment proofs and reference images are private. Only owners, and the artist assigned to the project, can see them.
- **Abuse protection on the intake form:** an invisible bot challenge, a honeypot, rate limits per IP, phone and tenant, and at most 3 open inquiries per phone number per tenant.

## Studio page rules

- The tenant comes from the subdomain. An unknown subdomain shows a not-found page.
- The studio page reads and writes **only** through the API/SDK. It never touches the database or imports platform code.
- Hidden artists don't appear.

## Not yet

Each of these waits for a gate or for evidence. The [roadmap](roadmap.md) says when, and the [research](research.md) says why.

- Page builder
- Public SDK and developer portal
- WhatsApp, Instagram or Viber API inboxes (one-tap chat links instead)
- Customer accounts
- Marketplace
- AI design tools
- POS, inventory and VAT invoicing
- Commissions and payouts, and multi-location (V2)
- Consent forms (V2, after legal review)
- Native apps
- Loyalty, gift cards and reviews
- Webhooks
- GraphQL
