# Requirements (V1)

What V1 must do and the rules it follows. For the how, see [architecture](architecture.md).

## Functional requirements

**Accounts and tenants**
- [ ] Sign up with email and password, verify the email, log in and out, reset the password
- [ ] Create a `studio` or `independent` tenant. This needs a verified email.
- [ ] A unique slug per tenant, which is also its subdomain
- [ ] Invite members as `owner` or `artist`, revoke invites and remove members
- [ ] Belong to several tenants and switch between them
- [ ] Tenant profile: name, description, contact email (required), phone, address, social links, timezone
- [ ] Booking settings: minimum notice (default 24 h) and booking horizon (default 12 weeks)

**Artists, portfolio and services**
- [ ] Artist profiles with public pages (`/artists/:slug`). Each has an "accepting requests" switch with an optional message, and can be hidden.
- [ ] Portfolio projects: title, description, style, placement and ordered images
- [ ] Services: name, description, estimated duration and optional starting price, with a choice of which artists offer each one (all by default)

**Scheduling**
- [ ] Weekly availability per artist
- [ ] Per-artist exceptions (time off, blocked dates, extra hours) and studio-wide closures
- [ ] Bookable slots computed from availability, exceptions, appointments, duration, notice and horizon
- [ ] Calendar of appointments and availability, with pending requests shown as tentative
- [ ] Manual appointments for bookings made by phone, walk-in or DM

**Booking requests**
- [ ] Guest requests with no account. A request holds:
  - name, email and phone
  - service and artist
  - idea, style, placement, size and optional budget
  - references and the requested time, plus notes
- [ ] Reference images: up to 5 per request, 10 MB each, in JPEG, PNG, WebP or HEIC
- [ ] Request list and status changes (see [Booking rules](#booking-rules))
- [ ] Customers list with each customer's booking history

**Emails**
- [ ] To the customer when a request is received, approved, confirmed (with time and address), rescheduled, rejected or cancelled
- [ ] To the artist and owners when a new request arrives
- [ ] Sent by the platform on the tenant's behalf, with reply-to set to the tenant's contact email

**Storefront, API and SDK**
- [ ] A hosted storefront at `{slug}.platform.com` showing the profile, artists, portfolio and services, plus a booking form
- [ ] Theme choice plus logo, colors, fonts, hero image, description, social links and visible sections
- [ ] REST API `/api/v1`, core SDK and React adapter (see [sdk](sdk.md))

## Tenant isolation

This is the most important rule in the system.

1. Every tenant-owned record belongs to exactly one tenant.
2. Every dashboard action checks **both** the user **and** the tenant: the user needs a membership whose role allows the action. The check runs on every request, so removing a member takes effect immediately.
3. Access to one tenant never grants access to another.
4. Records looked up by ID are looked up inside the current tenant. Another tenant's record behaves as if it doesn't exist.
5. Related records share a tenant. For example, a booking's artist and service belong to the booking's tenant.
6. The public API returns only storefront-visible data. Bookings, customers, budgets and reference images are never public.

| Role | Can do |
|---|---|
| `owner` | Everything in the tenant |
| `artist` | Their own profile, portfolio, availability and bookings |

- **Invites** are tied to one email, are single-use and expire in 7 days. Only a signed-in user with that verified email can accept one. An invite can be linked to an existing artist profile, which the new member then claims.
- **Owners:** a tenant always has at least one. When a member is removed, their artist profile stays with the tenant, unlinked.
- **Slugs** are unique and can't use reserved names (`www`, `api`, `app`, `admin`…). An old slug stays with its tenant as a redirect.
- Staff roles and fine-grained permissions come after V1.

## Booking rules

A booking is a request for **service + artist + time**. It is never confirmed automatically.

```text
requested ──► approved ──► confirmed ──► completed
    │             │             │
    ▼             ▼             ▼
 rejected     cancelled    cancelled / no_show
```

| Status | Meaning |
|---|---|
| `requested` | Waiting for review |
| `approved` | The work is accepted, but the time is still being agreed |
| `confirmed` | The time is fixed and the appointment is on the calendar |
| `completed` / `no_show` | After the session |
| `rejected` / `cancelled` | Declined, or called off before the session |

- **Approve and confirm** is one step when the requested time works. Deposits will later sit between `approved` and `confirmed`.
- **Only confirmed bookings block time.** Pending requests never hold a slot, so anonymous requests can't fill a calendar.
- **Overlaps:** the requested time must be bookable when submitted. On confirmation, the database rejects any overlapping appointment.
- **Rescheduling** changes the appointment time and emails the customer. It isn't a separate status.
- **Manual appointments** are bookings created in `confirmed` with source `dashboard`.
- **Customer changes:** customers cancel or reschedule by replying to an email, and the studio updates the booking.
- **Refused requests:** artists who aren't accepting requests, and services an artist doesn't offer, can't be booked.
- **Abuse protection:** an invisible bot challenge, a honeypot, and rate limits per IP, email and tenant. Each email can have at most 3 open requests per tenant.
- **Privacy:** an owner can delete a customer's personal data on request. This anonymizes their bookings and deletes their images.

## Storefront rules

- The tenant comes from the subdomain. An unknown subdomain returns a not-found page.
- The storefront reads and writes **only** through the API/SDK. It never touches the database or imports from the platform.
- An artist who isn't accepting requests shows their message instead of the booking form. Hidden artists don't appear at all.

## V1 non-goals

These are planned in the [roadmap](roadmap.md):

- page builder
- custom domains
- payments and deposits
- Google Calendar sync
- customer accounts and self-service
- reminders and SMS
- direct messaging
- reviews
- advanced analytics
- GraphQL
- webhooks
- plugin marketplace
- mobile apps
- billing (V1 is a free pilot)
- advanced staff permissions
- flash designs
