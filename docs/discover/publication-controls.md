# Discover publication controls

Discover D04. How a studio or an independent artist controls their place on TattooDrip Discover from Studio OS, and how the platform takes something down. The public side is the [Discover API](api.md); the boundary underneath is [database security](database-security.md).

Discover is optional. A business can use Studio OS and publish its studio page without ever appearing on Discover, and nothing here changes the studio page, its gallery or bookings.

## Where it lives

| Who | Where | What |
|---|---|---|
| Owner | Settings → Discover (`/t/:tenant/settings/discover`) | Listing switch, consent, city, readiness checklist, artists' Discover state, link to the preview |
| Owner | Settings → Discover → Preview (`…/settings/discover/preview`) | What a Discover profile would show, from the business's own records, listed or not |
| Owner, or the artist on their own profile | Artist profile → Discover (`PUT /t/:tenant/artists/:id/discover`) | The artist's own Discover switch |
| Owner, artist | Portfolio → a photo's details | The photo's Discover state |
| Operator (server shell) | `node ace discover:suspend` / `discover:restore` / `discover:status` | Takedowns |

The settings routes are owners only (`TENANT_ROUTE_ROLES`); an artist and anyone outside the studio get the same 404 as an unknown URL. Each route has a cross-tenant isolation case (`tests/isolation/cases.ts`). Code: `PublicationService` (`#modules/discovery/services/publication_service`), the pure rules in `#modules/discovery/publication`, `DiscoverSettingsController`, `ArtistDiscoverController`.

## Listing and consent

- **Off by default.** `tenants.discovery_listed` is false for every business until its owner turns it on. No migration turns it on.
- **Turning it on** needs, on the server: the owner's request, a ticked consent box (`consent`), the consent version the page showed (`consentVersion`, which must be the current `LISTING_CONSENT_VERSION`), and a city. It then sets `discovery_listed`, `discovery_listed_at` (when), `discovery_consent_version` (which wording) and `discovery_consented_by_user_id` (who), in one locked update. A refusal is a field error and changes nothing.
- **Turning it off** sets `discovery_listed` false and nothing else. The business, its artists and photos leave Discover at the API at once (caches: up to 2 minutes). The studio page, Studio OS and bookings are unchanged. The last consent stays on record; turning the listing on again asks for consent again.
- **Consent versions.** `LISTING_CONSENT_VERSION` names one exact wording (now `2026-11-14.draft-2`; D04's was `2026-11-07.draft-1`). A change of meaning is a new version, never an edit of the old one. A listing accepted under an older version stays listed under it; the page says newer terms exist, and turning the listing off and on accepts them. Requiring re-acceptance of a new version is a product decision for when that happens.
- **`2026-11-14.draft-2` (Reviews and Fresh ink, slice 4)** adds the studio's clients' reviews and rating and the Fresh ink photos and videos its clients post (each only with that client's consent) to the text and to `shows`. What the bump does today, by the mechanism above: nothing is forced. A studio listed under `draft-1` stays listed, and its clients' Discover-consented reviews and Fresh ink show on Discover under that older acceptance (the views don't read the version); its Discover settings page says "Terms accepted on <day>. Newer listing terms exist: turning the listing off and on again accepts them." (`acceptedLine`, `consent.accepted.current` false); a turn-on from a page loaded before the bump is refused ("The listing terms changed while this page was open…") and asks again. **Decided (2026-11-14, product owner): no forced re-acceptance.** Studios listed under `draft-1` stay listed and their clients' consented reviews and Fresh ink show, with the existing "Newer listing terms exist" line; a gate (a banner and a check on the version, or hiding reviews while `discovery_consent_version` is older) would be a new rule if this is revisited, for example after the legal review of the wording.
- **Draft wording.** The consent text and the list of what becomes public are in `listingConsent()`. They are marked **Draft: not legally reviewed** on the page (`draft: true`) until the product owner has them reviewed. Neither is legal advice.

## City

Discover lists every business under a city from the platform's `places` (the picker on the settings page, `PUT …/settings/discover/place`). It is the one required item: the listing can't be turned on without it, and it can't be removed while the listing is on.

## Status

Derived on every read, never stored (`publicationStatus`). In order:

| Status | When |
|---|---|
| `taken_down` | A platform takedown (`discovery_suspended_at`), whatever the owner chose |
| `listed` | The owner's listing is on, every required item holds, **and the public view returns the business now** |
| `needs_attention` | The owner's listing is on but one of those fails |
| `eligible` | The listing is off and could be turned on |
| `not_listed` | The listing is off and a required item is missing |

"Returns the business now" is a query of the D02 views with no context (`readDiscovery`): `discovery.studios` for a studio, `discovery.artists` for an independent artist, whose public page is their artist profile. So the page never says "Listed" for something the API wouldn't show. The page re-reads everything after each write; nothing is optimistic.

## Readiness checklist

`readiness()`: required items (the city; for an independent artist also their profile) and recommendations, each with what is missing and a link to where it is fixed. No percentages.

| Item | Rule | Required |
|---|---|---|
| City | A place is set | Yes |
| Logo or cover photo | Either is set | No |
| Description | `intro` is not empty | No |
| Published portfolio | Published photos (not hidden, not taken down) of the artists shown on Discover: 6 for a studio, 3 for an independent artist | No |
| Artists (studios) | At least one artist shown on Discover, each with 3 published photos | No |
| Your profile (independent artists) | Their artist profile is shown on their page (before listing, an opted-out profile counts: listing turns its switch on) | Yes |

The thresholds are `DISCOVER_RECOMMENDED` in `#modules/discovery/publication`. They describe a strong profile; they don't block a listing, so a studio with fewer photos can list (the blueprint's "shown only when complete" rule is not applied: the D03 API shows every listed business).

## Artists

- An artist shows on Discover while the studio is listed and visible, the artist is shown on the studio page (`visible`) and their own switch (`artists.discovery_listed`, on by default) is on. A takedown of the studio hides every artist.
- **Who may change the switch:** whoever may edit the profile (`ArtistService.lockEditable`: an owner any profile, an artist only their own linked one) may turn it off. Turning it back on is the artist's own choice: an owner may do it only for a profile no login manages, or their own. Anything else is a field error.
- Turning it off removes the artist and their photos from Discover only: the profile, its photos, the studio link and the studio page are unchanged.
- **Independent artists** have one switch: the listing's. Turning it on also turns their own profile's switch on (their profile page shows no switch of its own and points to Settings → Discover). A profile another login manages keeps its own choice, and the checklist counts an opted-out profile as ready only when listing would turn it on. The artist switch route refuses an independent artist's profiles. The words say "your artist profile", never "studio".

## Photos

A photo shows on Discover while its artist shows, it is published (not `hidden`) and not taken down (`artworkDiscoverState`). The portfolio's details panel says which of these keeps it off: removed by TattooDrip, unpublished, artist hidden, artist's switch off, studio not listed. Publishing stays the portfolio's one workflow; Discover adds no second one.

## Takedowns (operators)

Operators work from the server shell, as for `account:verify`; there is no admin UI and no tenant route can set or clear a takedown.

```sh
node ace discover:suspend black-needle --reason "Copyright complaint #12"
node ace discover:suspend black-needle --photo <photo id> --reason "…"
node ace discover:status black-needle
node ace discover:restore black-needle [--photo <photo id>]
```

- A slug may be current or old (`tenant_for_slug()`); the action runs in that business's own context.
- `--reason` (1–500 characters) is stored in `discovery_suspension_note` on the tenant or the photo, for operators only: no dashboard page or API sends it. The owner sees only "Removed by TattooDrip" and that their studio page is unaffected.
- A takedown overrides the owner's switch; the owner can still change their switch, which takes effect when the takedown is lifted. Restoring never lists anything: a business whose owner turned the listing off stays off.
- A photo takedown removes that photo from Discover only. It stays on the studio page and in the portfolio.
- Each action is logged with the tenant and photo ids (no names or reasons in the log).

## Preview

Owners only. Built from the business's own records in its own context, by Discover's rules: shown artists, published photos not taken down (the 12 newest), name, description, city, logo, cover, styles, booking and studio page links, and the future Discover address (`DISCOVER_URL` + `/studios/:slug` or `/artists/:slug`; "set when Discover launches" while unset). It works before the listing is on, says it is a preview and never claims a live page. No contact detail is sent.

## Tests

- `tests/unit/modules/discovery/publication.spec.ts`: status precedence, readiness for studios and independents, artist and photo states, consent version and wording.
- `tests/functional/discover/publication_controls.spec.ts` (PostgreSQL, through the dashboard routes, checked at the public Discover API): off by default; listing with consent and city; refusals; turning off; the city rule; artist and other-studio 404s; studio and photo takedowns, the operator commands; the artist switch rules and cross-tenant ids; an independent's one switch; the preview's data and privacy.
- `tests/isolation/cases.ts`, `cross_tenant.spec.ts`, `role_access.spec.ts`: every new route against another studio and as an artist.
- `tests/unit/inertia/discover_copy.spec.ts`: the page's words and small rules.

## Limitations

- **No setup-checklist step.** Discover is optional, so it is not one of the required setup steps; Settings → Discover is the entry point.
- **Consent re-acceptance** after a new version is not forced; see Consent versions.
- **Hiding an artist removes their reviews and Fresh ink from Discover** (Reviews and Fresh ink, ruling 11: a review or post shows only while its artist is shown on Discover). An artist who opts out of Discover, or whom the studio hides on its page, takes their clients' reviews out of the studio's Discover list and rating as well, and back when shown again. A known trade-off: a studio could lower its visible reviews by hiding an artist, at the cost of that artist's whole Discover presence; the studio's own page (`listReviews`) is not affected. **Decided (2026-11-14, product owner): kept as the spec says**, because showing a hidden artist's reviews would show that artist on Discover against the studio's or the artist's choice.
- **Cache latency.** A change reaches the API at once, but public caches can serve the old answer for up to 2 minutes; there is no CDN purge.
- **No moderation UI** beyond the three commands, by design.
