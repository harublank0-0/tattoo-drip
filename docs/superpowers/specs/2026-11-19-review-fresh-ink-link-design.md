# Linking a Client's Review and Fresh Ink on the Studio Page: Design

Date: 2026-11-19. Status: draft for approval.

Amends the "unlinked" part of [Reviews and Fresh ink](2026-11-12-reviews-and-fresh-ink-design.md): rulings 5 to 7 kept a project's review and its Fresh ink post apart on public pages. This design links them on the studio's own page. Discover keeps them apart for now; see Later.

## Intent

Someone reading a studio's reviews wants to see the tattoo the review is about. A review with photos of the healed tattoo is the most convincing thing on the page. Today the same shown name ("Sita R.") appears twice, once under Reviews and once under Fresh ink, with nothing connecting them.

**Agreed with the owner (2026-11-16 and 2026-11-19):**
- Link a client's review and their Fresh ink post of the same project when both are public on the studio's page. Keep the two sections separate; don't merge them.
- **A review card** shows a strip of the post's photos: the main photo and up to two more, then "+N". The strip opens the existing Fresh ink viewer.
- **The Fresh ink viewer** shows the client's stars and the start of their review, with "Read the review".
- **Where:** the studio page in every theme, on the home page and on `/reviews` and `/fresh-ink`.
- **Order:** reviews stay newest first; never "with photos first".
- **Discover later:** the studio page comes first, and Discover is a separate follow-up.

## Goals

- **Both ways:** each review whose post is public on the studio's page shows that post's photos and opens its viewer; each post whose review is public there shows the review in its viewer.
- **No new requests:** the link arrives with the data each section already loads. The home page shows 6 reviews and 6 posts, so a review's post is often not on the page.
- **Every theme:** the default, Atelier, Flash Parlour, Irezumi and Ink Noir, in each theme's own look.

## Non-goals

- Discover: the studio and artist profiles, and the global `/fresh-ink` feed.
- Merging Reviews and Fresh ink into one section, or a "reviews with photos" filter, badge or sort.
- Any change to the dashboard, the client's review page or the consents.

## Anti-goals (a failure even if it works)

- **No photo-led ordering:** reviews shown in an order that favours ones with photos. The studio decides which posts go public, so it could make its best reviews look richer.
- **No consent leak:** a link that shows something the client or studio didn't allow on that page. That includes a post the studio hasn't approved, a post or review taken down, a choice withdrawn, and a section the studio removed from its page.
- **No new identifiers:** a project id, client id or anything new about the client in the public API. The link exposes only what each item already shows.

## Constraints

- **One per project:** a review and a post belong to a project, and a project has at most one live review (`client_reviews_one_per_project`) and one live post (`client_posts_one_per_project`). The pairing is by project, within one studio.
- **Shared consent:** the client's "Show on the studio's page" choice is set on each item separately but through one pair of boxes. What differs between the two is the studio's approval (posts only), takedowns, and deletion.
- **Sections:** a studio chooses its page's sections (`tenants.storefront_sections`, keys `reviews` and `fresh_ink`), and each renders nothing until something is shown there.
- **Live:** Reviews and Fresh ink have been live since 2026-11-14, when the owner removed the feature's on/off setting. This change ships the same way, with no setting of its own.
- **Caching:** `listReviews` and `listFreshInk` are cacheable, with an ETag computed from the body (`publicCache`). A link that appears or goes changes the body, so the caches refresh within their existing 60 s and 60 s windows.
- **Text rules:** every string is plain text, shown as text and never as markup, as today.

## Approaches considered

1. **Embed the linked item in each list entry (chosen).** A review carries its post (the same shape `listFreshInk` gives), and a post carries a small summary of its review (stars, text, date). One response has everything the page needs, so it works on the home page's 6 and across paging with no new endpoint. Costs: larger responses (up to 8 public photo entries per linked review, all cacheable URLs) and two or three more queries per page.
2. **Ids only, resolved by the page.** A review carries its post's id; the page finds the post among those it loaded, or fetches it. It needs a new single-post endpoint and a request per unresolved link, and the strip can't be drawn until that request returns. Rejected.
3. **Merge the sections into one "clients" list.** Rejected by the owner (keep them separate) and against the ordering anti-goal.

**Discover's scope** was decided on 2026-11-19: the studio page first. Discover reads only from security-boundary views that never expose a project. Linking there means changing those views in a migration that must run as the Postgres superuser, which doubles the work and the review.

## The design

### When two items link

On the studio's page, a review and a post link when they share a project, both belong to the studio, and all of these hold:

- **The review shows in `listReviews`:** studio-page consent, not taken down, not deleted, rated (`shownReviews`).
- **The post shows in `listFreshInk`:** approved, submitted, published, studio-page consent, not taken down, not deleted, and its main photo public (`shownPost` returns it).
- **The section is on:** the studio's page shows the **other** item's section. A review carries its post only while `fresh_ink` is among the sections; a post carries its review only while `reviews` is.

If any of these fails, each item shows alone, as today. A withdrawn consent, a takedown, a decline, a deletion or a removed section ends the link at once (within the caches' minute).

### The contract (`packages/types/openapi.yaml`, then `pnpm --filter @tattoo-drip/types generate`)

- **`StudioReview.freshInk`** (required, nullable): the linked post, a `FreshInkPost` exactly as `listFreshInk` gives it, except that its own `review` is null (it sits inside that review). Null when there's no link.
- **`FreshInkPost.review`** (required, nullable): `{ id, rating, body, date }`, the linked review's own id, whole stars, text and day (the same values as its `StudioReview`). It has no reply, shown name or artist: the post already shows the client and the artist, and the reply belongs to the review card. Null when there's no link.
- Both descriptions say when the link is present (the rules above) and that the client's and project's ids are never part of it.
- `docs/sdk.md` notes both fields under the reviews and Fresh ink reads.

### The server (`PublicReviewService`, transformers)

- **`reviews()`** selects each row's `project_id` (never sent). While `fresh_ink` is in the studio's sections, it reads the linkable posts for the page's projects in one query and their media in one more, builds each with `shownPost` (so the post is exactly what `listFreshInk` would show), and attaches it by project. Two more queries per page; none with the section off.
- **`freshInk()`** selects `project_id` too. While `reviews` is in the sections, it reads the page's projects' shown reviews (`shownReviews(tenant)`, `whereIn project_id`) in one query and attaches `{ id, rating, body, date }`.
- **Transformers:** `PublicStudioReviewTransformer` and `PublicFreshInkPostTransformer` write the new fields out field by field, as they do today. The embedded post goes through the post transformer with `review: null`. The exact-fields tests list them.
- **Isolation:** every query stays filtered by the tenant's id under its RLS context, so another studio's project can never link.

### The storefront (`apps/storefront/src/studio/`)

**View models**
- `ReviewView.freshInk: FreshInkPostView | null`, read by the same per-item code `freshInkView` uses. It uses its own dialog prefix (`review-ink`), so its viewer's ids never clash with the Fresh ink grid's when the same post is in both. An entry that doesn't read cleanly is null, and the review shows alone.
- `FreshInkPostView.review: { id, rating, ratingText, body, excerpt, date } | null`. `excerpt` is the body cut at a word boundary to about 200 characters, with "…"; null when the whole body fits.

**The review card (`ReviewItem`)**
- Under the review's text, a strip: one button holding the post's main photo and up to two more thumbnails (photos, or a video's poster). When the post has more than three items, a "+N" mark sits on the last thumbnail.
- The button opens the post's viewer (`FreshInkDialog`, rendered with the review). Its accessible name says what it opens: "See Sita R.'s Fresh ink, 4 photos and videos".

```
★★★★★  Sita R. · 12 Oct 2026
"Healed perfectly, the linework is so clean…"
[photo][photo][photo +2]
Tattoo by Ram K.
```

**The Fresh ink viewer (`FreshInkFacts`)**
- The review, under the post's facts: the stars (with their words for screen readers) and the review's date.
- The text: the excerpt with a "Read the review" disclosure that shows the whole text in place, or the whole text when it's short. It never navigates; the review may be pages back on `/reviews`.

**Order, copy and styling**
- The order is unchanged: reviews newest first and posts newest published first, in the API's order. Nothing is sorted or filtered by whether it links.
- **Copy:** the strip's label, "+N", "Read the review" and the viewer's review heading go in `copy.ts` (`studioCopy.reviews` / `studioCopy.freshInk`).
- **Styling:** the shared classes (`client-review-photos`, `fresh-ink-review`) get base styles. Each theme adjusts them in its own stylesheet so the strip and the review read as part of that theme: thumbnail shape and border, the stars' colour, and the disclosure's look. The four themed home pages and `components/pages.tsx` all use `ReviewList` and `FreshInkDialog`, so the markup is shared.

### Tests

- **Platform (`PublicReviewService`, the two reads over HTTP):**
  - Linked both ways for a shown pair.
  - Not linked when the post is waiting, declined, unpublished, without consent, taken down or deleted; when the review is without consent, taken down or deleted; when the other section is off the page.
  - Another studio's project never links.
  - The exact-fields tests, with the embedded post's `review` null.
  - The reviews' order unchanged with and without links.
- **Storefront:**
  - The view models read both fields, drop a garbled one and keep the item.
  - The excerpt cuts at a word.
  - The strip shows one to three thumbnails and "+N" correctly.
  - The dialog ids are unique when a post is both in the grid and in a review.
  - The disclosure shows the whole text.
  - Render tests for one theme's home page, and the source tests the studio page already has.
- **Browser check:** each of the five themes on the home page, `/reviews` and `/fresh-ink`, light and dark where a theme has both, at phone and desktop width.

### Rollout

No migration and no setting: it goes live when both apps deploy (the API first, though the order doesn't matter: the storefront ignores fields it doesn't get, and an older storefront ignores the new ones). Docs: `apps/storefront/docs/development.md` (studio page), `docs/sdk.md`, a note in the 2026-11-12 spec pointing at this design, and one line in the draft [client content terms](../../legal/client-content-terms.md) (for the lawyer): a review and the Fresh ink post of the same project may be shown together on a page where both are allowed.

## Left to the builder

- Each theme's exact styling within its look.
- The excerpt's exact cut (about 200 characters, at a word boundary).
- How the two reads batch their extra queries.

## Later

- **Discover:** link on the studio and artist profiles; the global feed stays photos only. It needs a link column on the `discovery.reviews` and `discovery.fresh_ink` views, computed inside the boundary, plus the superuser-window migration (`docs/discover/database-security.md`, §6). That needs its own design.
