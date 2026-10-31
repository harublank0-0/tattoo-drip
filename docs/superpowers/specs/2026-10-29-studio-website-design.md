# Studio website: gallery, flash, artist portfolios, request page and "Good to know"

Date: 2026-10-29
Refs: no Linear tickets yet. Pulls the V1 "studio site with portfolio, flash and artist pages" (`docs/requirements.md:70`, `docs/roadmap.md:42`) forward into the pilot. Builds on TAT-48 (studio page), TAT-56 (look and sections), TAT-57 (intake form), TAT-105 ("How booking works"), TAT-112 (image sizes) and TAT-116 (cover and work photos).
Base: `main` at `ea048f5`.
Mockups: `.superpowers/brainstorm/399618-1793296889/content/site-v3.html` (the four pages) and `pages-v2.html` (the request page). They are local and not committed; this document is the source of truth.

## Why

A client taps the link in a studio's Instagram bio. Today they land on one page: the studio's cover photo, its intro, its artists with up to 6 photos each, and the request form. The owner wants that link to open what feels like a real tattoo studio website: a large cover photo with the studio's name, a gallery of work, each artist's own portfolio, flash designs a client can ask for, and the practical information a client looks for before getting in touch.

The goal behind it, in the owner's words: **make it easy for studio and client to contact each other and settle on a date.** This document covers the website. Settling on a date (the studio offers dates and the client picks one on the deposit page, plus a booking confirmation page) is a **second project, designed after this one**. Nothing here should make that project harder.

The pilot studio is the owner's friend's shop in Kathmandu; the product launches in Nepal only. Clients arrive on phones, often on mobile data, mostly from Instagram, and studios here run on WhatsApp and Viber (`docs/research.md` section 2).

## Goals

1. A client can browse the studio's work, by artist, by style and healed only, without leaving the site.
2. Each artist has a page that works as their portfolio: intro, styles, social links, status, all their photos and their flash.
3. A client can pick a flash design and ask for it in one tap, and the studio sees which design was asked for.
4. Contacting the studio is one tap from every page: the request form, or WhatsApp / Viber with a message that already says what the client was looking at.
5. The studio keeps the site fresh with little effort: a photo is uploaded once and shows everywhere it belongs; a one-of-a-kind flash design marks itself as taken.

## Non-goals (this project)

- Clients picking their own date or time slot. Flash is requested like custom work: the studio replies with a date (owner's decision). Self-booking and the slot engine stay in V1.
- The scheduling project: offered dates, the booking confirmation page, "Add to calendar". Next design.
- A site with a menu and separate About / Artists / Contact pages (layout B in the mockups, rejected).
- A "notify me when books open" waitlist, reviews, consultation booking.
- A custom domain, more themes, a page builder.
- `og:image` / JSON-LD for the new pages, beyond titles and descriptions that each page already gets the way today's pages do.

## Anti-goals (would make it a failure even if it works)

- **A site that looks unmanaged.** A taken flash design shown as available, empty sections with headings over nothing, "Open now" when the studio is closed.
- **Slower to reach the studio than Instagram is today.** Any page where the client has to hunt for how to get in touch.
- **Double work for the studio.** Uploading the same photo twice, or keeping flash status by hand when the system already knows.
- **Heavy pages on mobile data.** A gallery that loads every photo at once, or full-size images in grids.

## The pages (decided with the owner)

Layout A from the mockups: one long home page with "see all" pages, plus a header that stays at the top while scrolling with the studio's name and a **Request** button.

### Home (`/`)

In this default order: cover photo with the studio name, its city and today's opening state ("Open now · till 8 pm"); the intro; **Recent work** (the newest photos across all artists, a few rows, "All work →"); **Artists** (each with styles and status); **Flash** (a few available designs, "All flash →"); **Good to know**; a short **"Got an idea?"** invitation with a button to the request page; contact and social links at the bottom.

The request form is no longer on the home page. The studio still orders and hides sections from the dashboard (TAT-56's Look settings); the new sections join that list.

### Artist page (`/artists/<slug>`, exists today)

The artist's photo, name and status ("Taking new work", or their closed message, e.g. "Books closed till March"); their styles; their intro (the existing bio); their Instagram, Facebook and TikTok links; their full portfolio with an "All / Healed" filter and the existing large-photo viewer; their flash; a "Request a tattoo from <name>" button. The header's button also says "Request <name>". The form moves off this page too.

### All work (`/work`, new)

Every photo of every visible artist, newest first, with filters for artist, style and "Healed only", loaded a page at a time ("Show more"). Tapping a photo opens it large with the artist's name, its styles and a link to that artist's page.

### Flash (`/flash`, new) and one design (`/flash/<id>`, new)

All flash designs, filterable by artist. One design's page: a large picture, the artist, the size, the price if set, its status, and **Request this design**, which opens the request page with the design and its artist filled in.

### Request page (`/request`, new)

Today's form (TAT-57) and "How booking works" (TAT-105), unchanged, on their own page. Every Request button on the site leads here.

- From an artist's page (`/request?artist=<slug>`): that artist is already picked.
- From a flash design (`/request?flash=<id>`): the design's picture, name, artist and price show above the form; the artist is picked; the idea and size start filled in from the design and stay editable; placement and the rest are still the client's.
- If the artist is closed (for custom work, or for flash too), or the design was taken meanwhile, the page says so and offers what is still possible (another artist, or "ask for something similar" as a custom idea). See "Flash while an artist's books are closed" below.

### Chat button (every page, new)

A button that floats over every page and opens WhatsApp or Viber with the studio's contact number (the links the studio page already builds). Where the app allows a prefilled message, it names what the client was looking at: "Hi, I'm asking about Rabin", "Hi, I'm asking about the Moth flash". With no contact number set, there is no button.

### Good to know (home section, new)

Opening hours (so the cover can say "Open now"), walk-ins, the age rule, the deposit policy (already stored), "Before your session" and "Aftercare". Each part shows only when the studio filled it in; with none filled in, the section does not appear.

## The content behind the pages

### Photos (extends TAT-116's work photos)

- Each photo belongs to one artist and is uploaded once; it appears on that artist's page, in Recent work and in All work.
- The 6-photo cap goes: **up to 100 photos per artist** (owner agreed to "about 100").
- Each photo can carry **styles** from the fixed list below (up to 3) and a **healed** mark.
- Order is **newest first** everywhere. No manual reordering in this project.
- The dashboard's artist form takes **several photos in one go**; today it takes one at a time.
- An artist with books closed still shows their photos (as today).

### Styles

- A **fixed, platform-wide list** that studios pick from, so the filters stay tidy (owner agreed). The contract already sketches it: `listStyles` / `TattooStyle`, tagged V1.
- An artist has up to 5 styles; a photo up to 3.

### Flash designs (new)

- Each design belongs to one artist and has a picture, a name, a size in words ("About 3 in"), an optional price (Nepali studios rarely publish prices, so the studio decides per design), and whether it **can be tattooed again** or is **one of a kind**.
- **"Can be tattooed again" is the default**: many clients can get the same design, as with classic wall flash. **One of a kind** is the artist's opt-in for a design they will tattoo only once, so its client's tattoo stays unique.
- Status: **available**, **claimed** (one of a kind and taken), or **hidden** by the studio.
- **Claiming is automatic** for a one-of-a-kind design, at whichever comes first for a project made from a request for it: its **first verified deposit**, or the project becoming **booked** (a quote with no deposit books without one). The studio can also mark a design claimed, or available again, by hand. A design that can be tattooed again is never claimed.
- Desk bookings (walk-ins, phone) don't pick a flash design in this project; the studio marks a one-of-a-kind design claimed by hand, one tap in the flash list.
- Several clients may ask for the same available design; the first whose deposit is verified, or whose project is booked, gets it. The order the studio checks payments in decides; the warnings below make that safe.
- The studio chooses whether claimed designs stay on the site greyed out ("Claimed") or disappear (one studio-wide setting, shown in the mockup).
- Artists manage their own flash; owners manage everyone's (the same rule as artist profiles and work photos today).

### Flash while an artist's books are closed (owner's decision)

- Each artist gets a **"Flash open"** switch next to today's "taking new work" (books open) switch. Books closed with flash open is a normal tattoo-studio state: custom work is full, quick fixed-price flash still fits.
- **Books closed, flash open:** custom requests naming the artist are refused as today (409 `artist_not_accepting`); requests for their flash designs are taken. Their page shows the closed message for custom work and their flash as requestable.
- **Both closed:** their flash shows greyed out with their closed message, and a request for it is refused.
- The server enforces both rules; the page only mirrors them.

### Requests for a flash design

- The request (inquiry) records which design it was for, and the project made from it carries that along.
- The dashboard's inbox and project page show the design's picture and name, so the studio sees at a glance which design was asked for.
- **When a one-of-a-kind design is claimed, the studio is warned; nothing is cancelled for it** (owner's decision). The other open requests and projects for that design get a "Design taken: offer something similar" label. Sending a deposit link (a quote) or verifying a payment for a project whose design is already claimed shows a warning first. The studio talks to each client; no request or project changes status on its own, and the client's deposit page is unchanged (the scheduling project redesigns it).
- A new request for a claimed design is refused; the request page offers "ask for something similar" as a custom idea.

### Artist profile additions

- Styles (above) and Instagram, Facebook and TikTok links, https only, shown in that order, like the studio's `socialLinks`.

### Good to know

- **Opening hours**: per weekday, one open and one close time, or closed, in the studio's timezone (already stored, `Asia/Kathmandu` by default). No split hours and no closing after midnight in this project.
- **Closed days**: dated closures with a short note ("Closed for Dashain, back on 28 October"). During one, the cover says closed and the note shows; "Open now" never shows on a closed day.
- These hours are **for display** in this project. Shape them so scheduling can reuse them later as studio-wide hours and closures (`docs/data-model.md` already plans `AvailabilityException`), rather than building them twice.
- **Walk-ins**, **age rule**, **Before your session** and **Aftercare**: plain text the studio writes, with sensible length limits, rendered as text (never HTML), like every other studio text.
- **Deposit policy**: already stored (`deposit_policy`), now also shown here.

## Constraints

- **Boundaries** (root `AGENTS.md`): the platform owns all data; the storefront reads it only through `@tattoo-drip/sdk` / `@tattoo-drip/react`. Contract first, then SDK, then hooks (`packages/AGENTS.md`). V1-tagged operations that become real lose their V1 tag; check `docs/sdk.md#public-api-by-stage`.
- **Tenant isolation**: every new table carries `tenant_id` with the row-level security policy, and joins the isolation harness and the RLS catalog guard like TAT-116's `artist_work_photos` did. Public reads only ever show visible artists' content.
- **Images**: public images with the existing sizes and `srcset` (TAT-112), so grids never load full-size photos. Private disk rules are unchanged.
- **Caching**: the public pages keep today's short shared cache (`s-maxage=60, stale-while-revalidate=600`). Whatever says "Open now" must still be right when the cached page is up to 10 minutes old.
- **Links already shared must keep working.** Studios may have put `/#inquiry` or `/artists/<slug>#inquiry` in their bios; those must still get the client to the form in one tap.
- **Plain text everywhere**, as the contract already says for studio and artist text.
- **Storage before launch**: more photos per studio make object storage (TAT-27, Cloudflare R2) more pressing; it is still on the owner's launch list.
- **Generated files** are regenerated, never edited: `openapi.gen.ts`, `routeTree.gen.ts`, `database/schema.ts`, `.adonisjs/`.

## My calls (made while writing this; the owner can overrule)

1. Photos and flash are **ordered newest first**, with no manual reordering. Existing work photos keep their current order by being given matching dates.
2. **Up to 3 styles per photo, up to 5 per artist.**
3. **The style list**, to be confirmed with the pilot studio: blackwork, fine line, traditional, neo-traditional, realism, black and grey, colour, watercolour, Japanese, tribal, mandala, geometric, dotwork, lettering, minimal, portrait, religious and spiritual, cover-up.
4. **Claim moment = first verified deposit, or the project booked, whichever comes first** (research: "the spot goes to whoever pays first"; booking covers a quote with no deposit). Desk bookings don't pick a design; the studio marks it by hand.
5. **Paths**: `/work`, `/flash`, `/flash/<id>`, `/request`.
6. **The contract's V1 `listPortfolio` / `PortfolioProject` sketch is replaced** by a photo-based read, since a portfolio here is photos, not projects. `listStyles` is implemented. `listPlacements`, `listServices` and `listAvailability` are left alone.
7. **Empty sections hide** on the public site (no photos, no Recent work; no flash, no Flash; nothing in Good to know, no section).
8. **Flash defaults to "can be tattooed again"**; one of a kind is opt-in per design.
9. **Opening hours**: one range per weekday plus dated closures with a note; no split hours, no closing after midnight.

## Left to the builder

- The data model: new tables or columns, migrating the 6 fixed positions of `artist_work_photos`, where flash and hours live.
- The exact API shapes: endpoint names, paging (the contract's cursor style is a good fit), the filter parameters, and how much of the photos and flash the studio and artist reads include for the home page versus the paged reads.
- Where the claim happens (deposit verification in `apps/platform/app/modules/payments/`, and the move to booked), and what happens when a claimed design's project is later cancelled (the studio can always release it by hand).
- How the "Open now" state stays right under the page cache (computed in the browser, or a short-lived value).
- Viber's link may not take a prefilled message; check it, and fall back to a plain chat link.
- How an `independent` studio (one artist working alone) presents the home page and that artist's page without saying everything twice.
- Dashboard layout for flash, the photo tray with up to 100 photos, style pickers, hours and the Good to know fields.
- How the work splits into tickets. A suggested split, smallest risk first: (1) artist profile: styles and social links; (2) photos: no cap, styles, healed, multi-upload, All work; (3) request page, sticky header and chat button; (4) flash designs, flash pages, flash requests and claiming; (5) Good to know and opening hours.

## Docs to update when it ships

`docs/product.md` and `docs/roadmap.md` (the studio site moves from V1 into the pilot), `docs/requirements.md`, `docs/data-model.md` (Flash already has a row), `docs/sdk.md` (public API by stage), `apps/storefront/docs/development.md` (studio page), and the platform's `apps/platform/docs/backend.md` and `ui.md`.
