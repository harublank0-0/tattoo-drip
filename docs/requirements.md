# Requirements

What the MVP (pilot with a design-partner studio) and V1 (paid launch) must do, and the rules they follow. The gates between them are in the [roadmap](roadmap.md); the how is in [architecture](architecture.md).

## MVP: the inquiry-to-deposit loop

**Accounts and tenants**
- [x] Sign up with email and password, verify the email, log in and out, reset the password
- Signup always answers "Check your email": a new address gets a confirmation link (24 hours), a registered one an email saying it already has an account; the page never tells which. Email addresses are case-insensitive. A reset link works once, for an hour, signs every device out and emails the account that its password changed; asking for one never tells whether an address has an account.
- [x] Change the password while signed in, and sign out of every other device
- Passwords are 8 to 128 characters. Changing one asks for the current password (wrong tries are limited per account and per address, like sign-in) and a new one that differs from it; every other device is signed out, this one stays signed in, a pending reset link stops working, and the account is emailed that its password changed. "Sign out of other devices" asks on the page first and keeps this device signed in.
- [x] Create a `studio` or `independent` tenant (needs a verified email), with a unique slug that is also its subdomain
- Accounts that existed before email confirmation keep every studio they belong to; any account confirms its address before it creates a tenant (or, with invitations, joins one).
- [x] Invite members as `owner` or `artist`; revoke invites; remove members; switch between tenants
- The owner sends the invitation link themselves (copied, or shared on WhatsApp); no email. It works once, for 7 days, for an account with that confirmed address; a new invitation or a new link for the address replaces the old one. An invitation can offer an unlinked artist profile, which the new member gets if it is still free. Owners make members owners or artists and remove them (access ends at once; their profile stays, unlinked, and the invitations that could bring them back, or that a departing owner sent for owners, are deleted); nobody changes or removes themselves, and a studio always keeps an owner.
- [x] Tenant profile: name, contact phone and email, address, social links, timezone
- [ ] Payment settings: upload the studio's QR codes (Fonepay, eSewa, Khalti, bank) and a default deposit percentage

**Artists**
- [ ] Artist profiles: name, slug, bio, photo, visible or hidden, and an "accepting inquiries" switch with an optional message (the intake form shows the message and hides that artist)

**Intake**
- [x] A public intake form on the studio page, plus a per-artist link
- [x] The form asks for: idea, up to 5 reference images (JPEG, PNG or WebP, 10 MB each and 20 MB together; phones convert HEIC photos when the form asks for these), placement, approximate size, preferred dates, preferred artist (optional), name, phone (required; used for WhatsApp or Viber), email (optional), budget (optional), and how they found the studio
- [x] After submitting, the customer is told the studio will reply on WhatsApp or Viber
- An inquiry finds the studio's client by phone, or creates one; a returning client's details never change, and the inquiry keeps what was sent. A phone number has at most 3 open (unanswered) inquiries per studio. An artist who isn't accepting inquiries can't be chosen, and a studio whose visible artists are all closed takes none.

**Inquiries and projects**
- [ ] An inbox of new inquiries; accept one (creating a project) or decline it
- [ ] A project board following the [project lifecycle](#project-rules), with notes and a "last contacted" time
- [x] One tap opens the client's WhatsApp or Viber with a prefilled message: received, quote, deposit link, booking confirmation, reminder, aftercare
- Each studio writes its six messages once (Settings, Messages), with placeholders such as `{client_name}` and `{session_time}`, or keeps the defaults; nothing is sent automatically. The links open the client's stored number; Viber can't carry text, so the message is copied and pasted. Every tap records when the client was last contacted, on which channel and with which message, on the inquiry or the project; an accepted inquiry's last contact carries to its project.

**Quotes and payments**
- [ ] Quote: a fixed price, or an hourly rate with estimated hours, plus a deposit amount (which may be zero) and an expiry; quotes can be revised
- [x] Deposit page per project: amount, the studio's QR codes and a reference code; the client uploads proof of payment
- An owner makes a project's deposit link while its deposit is due; it works for 30 days and can be replaced at once (the old link stops working, the reference code stays). The page shows the studio, the project's brief, the deposit, the studio's deposit-page methods, a 6-character reference code for the payment remark and the deposit policy, and takes one screenshot at a time, which the owners and the project's artist are alerted to, once per screenshot, by email and under the bell.
- [x] Staff verify or reject the proof; cash and bank payments can be recorded at the desk
- [x] Payments are deposits, session payments, balance payments or refunds; the balance due is computed
- Owners verify or reject a screenshot next to the amount the deposit page asked for and the reference code; a different amount is rejected and recorded at the desk. A mistaken verification or entry is reversed, never edited. When a project closes holding a deposit, the owner records whether the studio kept or refunded it. The assigned artist sees the balance and the payments, never a screenshot.

**Sessions**
- [x] Sessions of kind consultation, tattoo or touch-up, each for one artist and inside a project
- [ ] A day and week calendar per artist; overlapping sessions are impossible
- [x] Mark a session completed, no-show or cancelled, or move it to another time
- [ ] Walk-ins and phone or DM bookings: create the project and the session directly
- A direct booking looks the client up by phone first and never changes a returning client's details. The project starts Booked with its tattoo session, an optional price and no deposit step; the price can't be changed after booking. Owners book for any artist, artists only for themselves.
- An artist's phone lookup says only that a client with the number exists, not their name (the client list is the owners'); they can still book that client, and then see them on the project that is theirs.
- The calendar shows active sessions (scheduled or completed) by the studio's local day, a day or a Sunday-to-Saturday week at a time, each opening its project. Owners see the whole studio or one artist; artists see their own sessions, and one on a project that isn't theirs shows only its time and kind.
- On the project page staff mark a scheduled session done or a no-show once it has started (also days later) and cancel it any time; an outcome is final. Moving a session changes its time, from today to a year ahead with the same artist, and an overlap is refused. Owners change any session, artists their own sessions on their own projects.
- Staff schedule more sessions on an open project from its page (from review to in progress, and touch-ups during the healing check; not on a completed or closed one), from today to a year ahead. A tattoo session books a project waiting for its deposit as soon as the deposit is settled, so the deposit and the session can come in either order; before the quote is accepted it holds the date. Owners schedule any artist, artists only themselves on their own projects.

**Clients**
- [x] One client per phone number per tenant, with the history of their projects, references and payments
- The client list and profiles are for owners. Owners can edit a client's name, phone, email and notes; what a client submits through the form never changes their record.

**Notifications, page and app**
- [x] Staff are alerted to new inquiries by email and in the app. No automatic customer messages in the MVP; replies go through the one-tap chat links
- A new inquiry alerts each owner, and the artist the client asked for when that profile is linked to a member, once each: an email (the client's first name and the start of the idea, never the phone; owners get a link to the inquiry) and an alert under the dashboard's bell. Email can be switched off for the whole platform until its sending domain exists. A deposit screenshot alerts the owners and the project's artist the same way (the client's first name, never the amount; the link opens the project's Payments card).
- [x] Studio page at `{slug}.platform.com`: profile, artists, Instagram link, intake form
- [x] Studio website: the gallery and each artist's portfolio, and Good to know with the studio's opening hours (one open and one close time per weekday, in its timezone), dated closed days with a note, walk-ins, age rule, deposit policy, what to do before a session and aftercare, plus "Open now" on the cover, and flash designs: each artist keeps designs (a picture, a name, a size, an optional price; up to 100, newest first) and a "Taking flash requests" switch; the studio page shows them in a Flash section, on each artist's page, on `/flash` and on `/flash/<id>`, and "Request this design" opens the request form filled in, the inquiry and its project record the design, and the inbox and project page show it. Each part shows only when filled in; the owner sets them in Settings, Good to know
- [ ] The dashboard is mobile-first and installable as a web app
- [x] Pilot metrics: share of inquiries arriving through the link, time from inquiry to verified deposit, session no-shows
- All three come from what the platform already stores, over a rolling window. Through the link: the inquiries that arrived (any outcome) out of those plus the projects booked at the desk. Inquiry to deposit: the median time from an inquiry to its project's first verified deposit that wasn't reversed (from the deposit page or the desk), counted when it was verified. No-shows: no-shows out of the sessions that were done or missed, by start time; past sessions without an outcome are named, not counted. Owners see their last 30 days at the bottom of the inbox; the team runs `metrics:pilot` for every studio (42 days by default, gate 1's six weeks).

## V1: what paid launch adds

- Automatic deposit confirmation: Khalti ePayment, or a dynamic Fonepay QR through an aggregator
- Flash with instant booking, and bookable consultation and piercing slots. This brings services, weekly availability, exceptions, the slot engine, minimum notice and booking horizon
- SMS reminders, plus aftercare and healing-check messages
- Studio site: more themes, custom domain
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
| `artist` | Their own profile (everything on it but the link to their login), plus the projects and sessions assigned to them (with those projects' payments and balance, read-only); they quote their projects, with a deposit no lower than the studio's default (a studio default of 0% lets them offer none) |

- Invites are tied to one email, single-use, and expire in 7 days. Only a signed-in user with that verified email can accept one, and an invite can be linked to an existing artist profile for the new member to claim.
- A tenant always has at least one owner. A removed member's artist profile stays with the tenant, unlinked.
- Slugs are lowercase DNS labels (3 to 63 letters, digits and single hyphens, with at least one letter), unique across the platform, and avoid reserved names (`www`, `api`, `app`, `admin`…) and the platform's own name. Owners can change the slug in Settings, up to 5 slugs per tenant in total. An old slug stays with its tenant for good and redirects to the current one; no other tenant can ever take it.
- A studio's page, or a domain a studio brings, can never read or set the dashboard's cookies: the dashboard and the API have a domain of their own, and the session cookie is host-only.

## Project rules

A project is the sale of one tattoo (or one piercing). Custom work is never booked until its deposit is verified, unless the quote sets the deposit to zero.

```text
Inquiry (a record, not a status) → reviewing → quoted → deposit_pending → booked → in_progress → healing_check → completed

side exits:  reviewing → declined     quoted ⇄ on_hold     deposit_pending → cancelled
shortcuts:   flash or walk-in → booked     in_progress → booked (next session)
```

| Status | Meaning |
|---|---|
| `inquiry` | Not a project status: the submitted Inquiry (status `new`) before it is accepted; accepting it creates a project in `reviewing` |
| `reviewing` | The studio is checking fit; a consultation session may happen here |
| `declined` | The studio turned it down |
| `quoted` | A quote has been sent |
| `on_hold` | Waiting on the client; returns to `quoted` when they reply |
| `deposit_pending` | Waiting for the deposit, or for proof to be verified |
| `cancelled` | The quote expired, or the client withdrew |
| `booked` | Deposit verified and a session is scheduled |
| `in_progress` | At least one tattoo session done, more to come |
| `healing_check` | The tattoo is finished; the studio waits for a photo of the healed tattoo or does a touch-up (due four weeks after the last tattoo session) |
| `completed` | The healing check is done: the project is closed (a balance still due stays on it) |

- Issuing a quote moves the project to `quoted`; staff mark it accepted when the client agrees, which moves it to `deposit_pending`. A quote can be revised (a new version) until the project is `booked`, and a revision moves a `deposit_pending` project back to `quoted`.
- An artist's quote, and a revision of it, needs a deposit of at least the studio's default deposit percentage of the total (in whole rupees, as the quote form fills it in, and at least NPR 1), so only an owner can quote a smaller deposit or none. If the studio has set its default deposit to 0%, that is the owner's own policy and an artist may quote no deposit too; if the studio has set no default, a quote without a deposit is an owner's. Marking a quote accepted follows the same rule: an artist can do it only when the quote's deposit meets it, otherwise an owner confirms the client's answer. Quotes issued before this rule stay as they are.
- Staff move a project by hand only along the side exits: put a quoted project on hold and resume it, decline a project under review, or record that the client withdrew (from `reviewing`, `quoted`, `on_hold`, `deposit_pending`, `booked` or `in_progress`). Declining and withdrawing cancel the project's scheduled sessions. A client can be recorded as withdrawn until the work is done (up to `in_progress`); when the project holds deposit money, the owner records whether the studio keeps it or refunds it (moving it to a new date comes with per-session deposit outcomes, a follow-up to session outcomes).
- The inquiry inbox is for owners. Accepting an inquiry creates a project under review, with the artist the owner picks, and its reference images follow the project (its assigned artist can then see them). Declining is final.
- A quote's expiry moves a project that was never accepted (`quoted`, `on_hold`) or never paid (`deposit_pending` with the deposit not settled) to `cancelled`, and cancels its scheduled sessions. It spares a project while a deposit screenshot waits for the studio, and once the studio rejects a screenshot or reverses a deposit after the quote expired: the studio decides what happens next. A deposit that was already paid is never cancelled by expiry, even when staff revised the quote afterwards.
- Sessions block the artist's time, and the database rejects overlaps. Each session is `scheduled`, `completed`, `no_show` or `cancelled`; rescheduling changes its time. A tattoo session is marked completed only once its project is booked. A booked project moves to `in_progress` once a tattoo session is completed and none is still scheduled, and back to `booked` when the next one is scheduled.
- An owner marks the tattoo finished once no session is left (from `in_progress`), which starts the healing check, and closes the check when the healed photo came or the touch-up is done (any time; nothing closes it automatically). Each step names a balance still due and asks to confirm it rather than blocking; the money can be recorded afterwards, and the projects list flags a finished fixed-price project that still owes. A healing check takes touch-up sessions only; there is no way back from either step. The assigned artist sees the healing check but can't take either step.
- Each studio writes its own deposit policy, which the deposit page shows. Tattoo Drip records what happened to a deposit (kept, moved to a new date, refunded) but doesn't impose a rule.
- Payments are never edited or deleted. A refund is a new payment with a negative amount.
- Balance due = quoted total (or hours × rate) − verified payments.
- Payment proofs and reference images are private. Only owners see payment proofs; owners and the artist assigned to the project see reference images.
- **Abuse protection on the intake form:** an invisible bot challenge, a honeypot, rate limits per IP, phone and tenant, and at most 3 open inquiries per phone number per tenant.

## Studio page rules

- The tenant comes from the subdomain (`<slug>.localhost:3000` in development). An unknown subdomain shows a not-found page (404); an old slug redirects (302) to the current subdomain with the same path and query; the bare domain and `www.` show a landing page.
- The studio page reads and writes **only** through the API/SDK. It never touches the database or imports platform code.
- Hidden artists don't appear, and a hidden or deleted artist's page is a not-found page. The page shows what the dashboard says it shows (the profile, the visible artists with their photos and closed messages), its deposit policy in Good to know (TAT-128) and nothing else about money: never the default deposit percentage, payment details, members or anything about clients, inquiries or payments. "Open now" is worked out in the visitor's browser from the hours (the page is cached for minutes), so it is right when the cached page is not.
- Each visible artist has a link of their own, `/artists/<slug>`, that asks for them by name; a hidden, unknown or renamed artist shows the not-found page.
- Owners set the page's look in Settings, Page look: a theme from the platform's list, a logo, a colour (and optionally a dark-mode colour) that reads at 4.5:1 on the page, a heading font from a fixed list, and the order of the page's sections (Recent work, Artists, Good to know, and the "Got an idea?" invitation with its button to the request page), each hideable except the invitation, which is always there. The look is stored as these values only, never markup or CSS; a value the page can't use falls back to the default alone.
- The page shows only what the public API returns, always as text, and loads no analytics or third-party scripts (the intake form's bot challenge, Cloudflare Turnstile, is the one exception, loaded only once someone starts filling the form in).
- The deposit page (`/deposit#<token>`) is the one page that shows a project's deposit, the studio's deposit-page payment methods and its deposit policy and, once the deposit is paid, the date, time and artist of the project's next session (TAT-110), to whoever holds the link: never cached or indexed, sending no Referer, and the token, in the link's fragment, never reaches the studio page's server or anything but the API.

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
