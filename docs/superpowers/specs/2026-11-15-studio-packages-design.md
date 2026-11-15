# Studio packages: Solo and Studio

Date: 2026-11-15
Status: **design, agreed with the product owner in conversation; not built.** Prices, allowance quantities, the mid-month allowance increase, the storage reserve's size and the pilot transition terms are open business decisions ([Open decisions](#open-decisions)), to be set together before pricing goes public.
Builds on: SaaS billing ([payments](../../payments-paybridgenp.md)) with the November 2026 audit fixes (branch `fix/billing-mode-and-reversals`: billing reads one mode, each paid period records the plan its invoice billed, reversals end a period); the AI Design Lab's usage ledger ([design-lab](../../design-lab.md)); tenant types (`studio`, `independent`) and members and roles (TAT-30, TAT-33).
Replaces: the single "Studio" catalogue plan (`studio-monthly`, `studio-yearly`, placeholder prices) and the payments doc's "Enforcing a paid plan on the dashboard: … no route is gated yet".

## Goal

Charge for Tattoo Drip with packages that match the two kinds of business we expect in the first year: a working solo artist who runs their own books, and a busy single-location studio coordinating several artists. Both get the complete inquiry-to-deposit workflow; what separates them is how many artists work in the account and how big the shared allowances are. The packages are a hypothesis to validate with pilots, on the way to Gate 2 (20+ paying studios who stay past 3 months, [roadmap](../../roadmap.md)).

Customer-facing promise:

- "Solo: one artist, with help running the business. Studio: multiple artists working together."
- "Upgrade when you need another artist. Pay only for the remaining period. Downgrade at your next renewal."

## Rulings

1. **Two packages at launch, Solo and Studio.** A third comes only when we can name a distinct customer need, which may sit above Studio rather than between the two. Multi-location stays V2.
2. **The package is not the account type.** The tenant's type (`studio` or `independent`, chosen at signup, shown on Discover) describes the business; the package decides its allowances. The type only suggests a package at signup. A one-artist business branded as a studio may choose Solo; a solo artist may choose Studio for its larger allowances (Studio allows several artists, it doesn't require them).
3. **Solo is one active artist; Studio is any number.**

   | Included in Solo | Requires Studio |
   |---|---|
   | One active artist with their calendar and portfolio | A second active artist with a separate calendar and portfolio |
   | Additional members helping run that artist's business | Managing work for several practising artists |
   | The complete core workflow | Larger pooled allowances |

4. **Active artists are counted throughout the app**, not only those shown on the public page, so a studio can't hide profiles while still using their calendars. A hidden artist is active. **Archiving** is a new capability, distinct from hiding: an archived artist keeps all their history (projects, sessions, portfolio) but doesn't count, and gets no new work, sessions, assignments or bookings. Nothing is ever archived automatically.
5. **Logins are not capped.** A partner answering inquiries or a bookkeeper recording payments doesn't turn a solo practice into a studio. Each person has their own login; adding members never multiplies image, storage or SMS allowances. There is no helper role today (the inquiry inbox is owner-only, [requirements](../../requirements.md)), so a helper needs owner access for now; a restricted helper role is a separate product decision.
6. **Enforcement is reasonable, not exhaustive.** Several artists could share one profile. Separate calendars, portfolios and assignments are the practical reason to buy Studio; legitimate customers must not pay for extra restrictions.
7. **Access states.** Exactly one applies to a studio at any moment:

   | State | When | Access |
   |---|---|---|
   | Trial | 14 days from workspace creation, no payment needed to start | The package chosen at signup. One trial per business; switching packages doesn't restart it or replenish usage |
   | Paid | A paid period covers now | The paid package's access and allowances |
   | Grace | Up to 7 days after paid access expires through an ordinary renewal lapse | The previous package's access and normal limits: no bonus credits, no resets. Not after a refunded or reversed payment |
   | Paused | After grace; straight after trial expiry (no grace) | Finish existing commitments; pay to start new client work (ruling 8) |
   | Pilot | An explicit, temporary entitlement until its agreed transition date | The granted package and allowances. Pilots must never become paused by accident when enforcement ships |

   Payment restores access as soon as it is verified.
8. **Paused: finish existing commitments, pay to start new client work.**

   | Still works | Paused until payment |
   |---|---|
   | The public page and inquiry submission | Converting an inquiry into a project |
   | Reading, organising and declining inquiries | Creating projects directly |
   | Finishing existing projects, recording payments, completing healing checks | New standalone bookings |
   | Keeping, rescheduling or cancelling existing appointments | Design Lab generation and automated SMS |
   | Records, exports, account and billing settings | Adding active artists |

   - **Everything on an existing project continues**: quotes and their revisions, deposits, accepting a quote, resuming a project on hold, and the sessions it needs, its first one included (a client midway through a tattoo may need another session or a touch-up). The paywall sits only at starting new client work: a new project, from an inquiry or directly, and a standalone booking. Some imperfect enforcement is accepted here, as with shared profiles.
   - **Deposit links stay usable and payment confirmations are always processed**: subscription status must never leave a client's payment unrecorded.
   - **Intake stays open, with its obligations**: owners still see new inquiries and get the normal email and in-app alerts, and the form promises an inquiry, never a confirmed appointment. A permanently abandoned account must not collect inquiries forever: a separate inactivity and retention policy is required before launch.
   - A useful page and inbox remain without payment. It isn't marketed as a free package, but some people will use it that way; the commercial bet is that running projects and bookings inside Tattoo Drip is worth paying for.
9. **Notices** before the trial ends, before paid access expires and during grace, so no studio is paused by surprise.
10. **Upgrade (Solo → Studio) happens now, with a prorated charge.** PayBridgeNP supports it (`changePlan` with `prorationBehavior: "create_prorations"`, `previewProration`); renewal-only plan changes were Tattoo Drip's implementation, not the provider's limit.
    1. The Solo owner tries to add a second active artist.
    2. Tattoo Drip shows the prorated amount, the dates it covers and Studio's price at the next renewal.
    3. They confirm and receive the upgrade invoice. While it is unpaid, Solo keeps working.
    4. Once payment is verified, Studio unlocks and they finish adding the artist; the profile becomes active only then.

    Rules:
    - **Paid entitlement controls access.** PayBridgeNP changing the subscription's plan does not, by itself, unlock Studio.
    - **Overlapping periods**: Studio overrides Solo only for the upgrade's paid coverage window, beginning no earlier than its payment. It doesn't rewrite the earlier part of the period or move the renewal date. A reversed upgrade stops granting Studio; an independently valid Solo period remains.
    - **Allowances don't refill.** Usage already consumed counts against Studio's allowance for the current window. How much a mid-month upgrade raises the allowance is decided with prices: a small late-month charge must not buy a fresh month of costly consumables.
    - **An unpaid upgrade is recoverable**: retrying shows the outstanding invoice, never a second charge.
11. **Downgrade (Studio → Solo) takes effect at renewal and requires Solo eligibility.** Before scheduling it, the owner reduces to one active artist; until renewal, further additions respect the pending limit. Nothing is archived or deleted at renewal.
12. **Allowances: stop the costly action, keep existing work, explain how to continue.**
    - **Meters differ.** Images and SMS have a reset window; storage measures what is currently kept and doesn't reset monthly.
    - **Images**: a hard stop at the limit; existing images stay available. Show usage and the exact reset date. Offer Studio only when it gives more usable allowance, and extra credits only once buying them works. Failed generations don't consume allowance.
    - **Storage**: new discretionary uploads stop (portfolio photos, videos, Design Lab uploads), but a bounded path stays open for payment proofs and files needed to finish existing projects; that reserve is defined explicitly ([Storage](#storage)).
    - **SMS** (built in V1): when exhausted, automated sends stop, each unsent message is recorded as such and the studio sees why. Appointments, in-app reminders and records stay intact. Stale reminders are never sent later when credits return.
    - **Warn before the limit** with the remaining capacity. **At the limit**, name the blocked action, say what still works, and give a real next step.
    - **Allowance bundles are versioned.** Pilot allowances can be tuned explicitly; editing a default never reduces an allowance already bought for a paid period.
    - **Extra credits** are a proposed capability: their purchase and expiry rules are still to define, and buying them never bypasses the paused rules.
13. **Retention promise**: nothing is deleted or hidden because an allowance was exceeded. (Not "nothing is ever deleted": account deletion and the abandoned-account policy still apply.)
14. **Monthly only at launch.** Annual packages return once the upgrade flow is verified in the PayBridgeNP sandbox: proration removes the reason to exclude them.
15. **Pilots land in the package that matches their actual operation**, with a separately defined transition benefit. Their participation deserves recognition, but doesn't decide the permanent structure.

## Approach

Three ways to decide what a studio may do were weighed:

- **A. Compute access when needed (chosen as the source of truth).** One service answers "what can this studio do now" from records that already exist (paid periods with their plan, the workspace's creation date, pilot grants, versioned allowance bundles). Nothing to keep in sync; trial and grace ends are date comparisons, so "paid entitlement controls access" holds literally. Cost: every gated action must call it, with a test.
- **B. Store each studio's access in a row, updated by billing events and scheduled jobs.** Fast reads and easy to show, but a second copy of the truth that can drift from the paid periods: a missed job pauses a paying studio or keeps a lapsed one open. Rejected.
- **C. Gate by route, like the role checks.** A map from each tenant route to what it needs, with a test that fails for an unclassified route (the `TENANT_ROUTE_ROLES` and route-registry pattern), so nothing ships ungated. On its own it can't express the nuanced rules (a session for an existing project vs a new booking; a payment proof vs a portfolio photo; the active-artist count).

**Chosen: A as the single source of truth, with C's route map on top for the coarse gates** (Design Lab, new-work routes); the nuanced rules are explicit checks in the services, all asking A.

## Design

### Packages, plans and allowance bundles

- **Packages** (`solo`, `studio`) are defined in code: name, customer line, active-artist limit (Solo 1, Studio none).
- **Allowance bundles** are versioned, immutable records (platform reference data, like `billing_plans`): images per month, storage bytes, storage reserve, SMS per month (null until SMS exists). A change is a new version; nothing edits a bundle a paid period or a pilot grant already uses.
- **Plans** (`billing_plans`) gain their package and allowance bundle. Plan codes are versioned (`solo-monthly-v1`, `studio-monthly-v1`): PayBridgeNP plans can't change price, so a new price is a new code. A paid period's package and allowances are its plan's, fixed at purchase (the audit fix records each period's plan).
- **The existing Studio plans** (`studio-monthly`, `studio-yearly`) map explicitly to the Studio package before any restriction is enabled.

### Entitlement service

`EntitlementService.for(tenant, at = now)` returns the state (ruling 7), the package, the allowance bundle, until when, and the artist limit, in the active billing mode (`accessMode`). Resolution, first match wins:

1. An active **pilot grant** → Pilot, with the grant's package and bundle; if paid periods also cover `at`, the higher package of the two applies.
2. **Paid periods** covering `at` (not revoked) → Paid. Where several cover it (an upgrade inside a Solo period), the highest package wins for the time it covers.
3. **Grace**: the latest paid coverage ended in an ordinary lapse (not revoked, not refunded) less than 7 days before `at` → Grace with the highest package of the periods that ended then.
4. **Trial**: within 14 days of the workspace's creation and never paid → Trial with the package chosen at signup.
5. Otherwise → **Paused**. A paused studio keeps the allowance bundle of its last state (paid, grace, pilot or trial) for what still works, such as storage for the uploads it may still make.

It is pure computation over rows, so it is unit-testable with fixed dates, and every check (route map, services, the Billing page) asks it.

### Gating

- **Route capability map** next to `TENANT_ROUTE_ROLES`: every tenant route is classified (always open, new work, Design Lab, …), a guard test fails for an unclassified route, and middleware after the role check refuses what the current state doesn't allow.
- **Service checks** (authoritative, also asking the entitlement service):
  - converting an inquiry into a project, creating a project directly, a standalone booking: refused when paused;
  - everything on an existing project (quotes, deposits, its sessions, its healing check): allowed when paused (ruling 8);
  - activating or adding an artist: refused when paused, and refused above the package's artist limit (offering the upgrade on Solo);
  - Design Lab: refused when paused and at the image allowance;
  - uploads: discretionary ones refused at the storage limit; required ones use the reserve.
- **Always allowed, whatever the state**: the public studio page, inquiry submission and its alerts, deposit links and deposit pages, payment webhooks and syncs, exports, and the Billing and account settings.
- A refusal names the blocked action, says what still works, and links to the next step (pay, upgrade, archive an artist, wait for the reset date).

### Archiving artists

A new artist state, separate from hidden and deleted: archived artists keep their projects, sessions and portfolio, don't count toward the limit, can't be assigned new projects, sessions or bookings, and aren't bookable. Unarchiving counts against the limit. The downgrade's eligibility check (ruling 11) counts active artists.

### Upgrade and downgrade

- **Upgrade** follows ruling 10: preview with `previewProration`, then `changePlan` with `create_prorations`. PayBridgeNP ignores `Idempotency-Key` on plan changes (payments doc), so Tattoo Drip records the outstanding upgrade (subscription, target plan, invoice) before calling, under the studio's billing lock, and a retry finds that record and shows its invoice instead of charging again. The upgrade's period is granted from its payment to the end of the current period, with the Studio plan.
- **Downgrade** follows ruling 11 with today's next-renewal `changePlan` (`prorationBehavior: "none"`), after the eligibility check.
- **Sandbox check before shipping the upgrade**: how previews, immediate plan changes, unpaid upgrade invoices, their coverage dates (and how a proration invoice is told apart), payment events and reversals actually behave; in particular, that an unpaid upgrade doesn't disturb the Solo period already bought.

### Allowances

- **Images**: the package bundle's monthly allowance replaces `DESIGN_LAB_MONTHLY_LIMIT` as each studio's cap once enforcement is on (until then the setting stays in force), on the existing reservation ledger (reserve, settle, release: failed generations are released). The window stays the calendar month (UTC), so the reset date is the first of the next month.
- **Storage**: retained bytes per studio. Stored files don't record their size today, so sizes are recorded when files are stored and backfilled for existing files. Discretionary uploads stop at the bundle's storage limit; required uploads continue into the reserve ([Storage](#storage)).
- **SMS**: specified now (ruling 12), built with SMS in V1.
- **Warnings** before a limit; **refusals** at it (ruling 12).

### Storage

Discretionary uploads stop at the limit: portfolio photos and videos, the studio's cover and logo, Design Lab uploads (none exist yet). Required uploads are never stopped by the limit itself: payment proofs (a client's deposit screenshot), clients' inquiry reference images and their review and Fresh ink posts (the public intake and client links keep working), and the photos needed to finish an existing project, such as a healed photo for its healing check. Required uploads count toward retained storage and are bounded by the bundle's reserve; per-file sizes and rate limits already bound each one.

### Notices

In-app (a banner on the dashboard) and by email to the studio's owners: 3 days and 1 day before the trial ends; 3 days before a paid period ends when its renewal invoice is unpaid; when grace starts and 1 day before it ends. A pilot gets the same notices before its transition date.

### Pilots

Staff-managed pilot grants: the studio, the package, the allowance bundle, start and end dates, a note, and who granted it. Existing pilot studios get theirs before any enforcement is switched on. When a grant ends, the studio is Paid if it pays, otherwise Paused (its trial was long ago).

### Enforcement switch

Enforcement ships off. In observe mode the service computes every decision and logs what it would refuse, so pilots and pricing can be checked against real use. It is switched on only once every pilot has its grant, prices and quantities are set, **and the upgrade (phase 4) has shipped**: refusing a Solo studio's second artist with nothing to upgrade to would break the promise "Upgrade when you need another artist".

### Data (summary)

- `allowance_bundles` (platform reference, immutable once used); `billing_plans.package` and its allowance bundle
- `tenants`: the package chosen at signup (for the trial)
- `pilot_grants` (tenant-owned: row-level security, isolation tests)
- `artists`: the archived state
- stored file sizes, with a backfill, for the storage meter
- the upgrade's paid coverage on `billing_access_periods` (starting at payment), and the outstanding upgrade per subscription

## Phases

1. **Catalogue and entitlement core, observe mode**: packages, bundles, versioned plans with the existing Studio plans mapped, the entitlement service, the package chosen at signup, pilot grants, the state on the Billing page and the admin Billing page. Nothing is refused.
2. **Archiving artists and the active-artist limit** (refusing only once enforcement is on).
3. **Paused rules and the route capability map, with notices**, still in observe mode.
4. **Sandbox check of proration, then upgrade and downgrade.** Enforcement can be switched on after this phase, once every pilot has a grant and prices and quantities are set.
5. **Allowance meters**: images per package, then storage (sizes, backfill, reserve).

Later: extra credits, the SMS allowance (with SMS), annual packages, a restricted helper role, the inactivity and retention policy.

## Goals, non-goals, anti-goals

- **Goals**: two packages a studio can understand in one line; access always derived from verified payments; existing work and client payments never held hostage; upgrades without waiting.
- **Non-goals now**: a third package, multi-location, a restricted helper role, buying extra credits, SMS, annual billing, the inactivity and retention policy (required before launch, designed separately).
- **Anti-goals** (failures even if it technically works): a client lands on a dead studio page, or a client's payment goes unrecorded; work is deleted or hidden because a limit was reached; a pilot is paused by accident; a retry charges twice; a plan change unlocks access before payment; a member's login multiplies allowances; honest customers pay for restrictions aimed at the dishonest.

## Open decisions

For the product owner, together, before pricing goes public:

- Prices: Solo and Studio, monthly (annual later).
- Allowance quantities per bundle: images per month, storage, the storage reserve (SMS later).
- The mid-month allowance increase on upgrade.
- Pilot transition terms: dates and the transition benefit.
- Extra credits: purchase and expiry rules.
- The inactivity and retention policy for abandoned accounts.
- Whether to build a restricted helper role.

## Calls made in writing this up

Not discussed explicitly; the product owner should check them:

- Pre-existing paid periods with no plan on record count as **Studio**: the only plans that ever existed were Studio's.
- **One trial per business** means one per workspace at launch; repeat trials through new workspaces are a known gap, watched rather than prevented.
- Trial and grace live in Tattoo Drip (catalogue plans keep `trialDays: 0`), not in PayBridgeNP's subscription trial, so a trial needs no subscription.
- The **storage split** between discretionary and required uploads ([Storage](#storage)), including the cover and logo as discretionary and client posts as required.
- **Notice timing**: 3 and 1 days before the trial ends, 3 days before an unpaid renewal, at grace start and 1 day before it ends.
- **Enforcement ships off**, in observe mode, until pilots have grants and prices are set.
- The image window stays the **calendar month (UTC)**.
- `DESIGN_LAB_MONTHLY_LIMIT` gives way to the bundle's allowance as each studio's cap.

## Left to the builder

Table and column names; the shape of the route capability map and its classes; refusal and notice copy; the Billing page layout; how the admin manages pilot grants (a page or an `ace` command); test structure (fixed-date unit tests for the entitlement service, a guard test for the route map, isolation tests for `pilot_grants`, functional tests for each paused rule, the upgrade's idempotency, the downgrade's eligibility, the storage reserve, and pilots never being paused).
