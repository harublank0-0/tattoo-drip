# Linking a Client's Review and Fresh Ink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the studio's own page, a review whose client's Fresh ink post is public there shows that post's photos and opens its viewer, and the post's viewer shows the review.

**Architecture:**
- Each list entry carries its linked item: `listReviews` embeds the post (the `listFreshInk` shape), and `listFreshInk` embeds a short review summary.
- Both are computed in `PublicReviewService` by project, within the tenant, and only while the other section is on the studio's page.
- The storefront reads them into its view models and draws them in the shared `ReviewItem` and `FreshInkFacts`, which every theme uses; each theme styles them.

**Tech stack:** AdonisJS 7 + Lucid (platform), OpenAPI → `openapi-typescript` (`packages/types`), TanStack Start + React 19 (storefront), Japa and `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-19-review-fresh-ink-link-design.md`

## Global Constraints

- **When they link:** a review and a post of the same project and studio link only when:
  - the review shows in `listReviews` (`shownReviews`);
  - the post shows in `listFreshInk` (`shownPost` returns it);
  - the studio's sections hold the **other** item's key (`fresh_ink` for a review's post, `reviews` for a post's review; `sectionsOf(tenant.storefrontSections)`).
  Otherwise the field is `null`.
- **Contract:**
  - `StudioReview.freshInk`: required, a `FreshInkPost` or null. The embedded post's own `review` is null.
  - `FreshInkPost.review`: required, `{ id, rating, body, date }` or null.
  - Never a project or client id.
- **Order unchanged:** reviews `created_at desc, id desc`, posts `published_at desc, id desc`. Nothing is sorted or filtered by whether it links.
- **Copy (exact), in `studioCopy`:**
  - `reviews.photos: "See {name}'s Fresh ink"`
  - `reviews.more: "+{count}"`
  - `freshInk.review: "Review from {name}"`
  - `freshInk.readReview: "Read the review"`
- **Excerpt:** null when the body is 200 characters or fewer (`Array.from` length). Otherwise cut at the last whitespace before character 200, trimmed, with "…" appended.
- **Dialog prefix:** a review's embedded post uses `REVIEW_INK_PREFIX = "review-ink"`; the grid keeps `FRESH_INK_PREFIX`.
- **Text:** plain text, `dir="auto"`, line breaks kept (the existing `user-text` class).
- **Rollout:** no migration and no setting.

## Review Focus

1. **One post in two places:** a post shown in the Fresh ink grid and inside a review on the same page gets two viewers with different ids, and each button opens its own. *(Task 3 test `a post in the grid and in a review has two viewers with distinct ids`.)*
2. **A linked post whose main photo isn't public** (`shownPost` returns null) leaves the review alone, never half drawn. *(Task 1 test `a post whose lead has no public photo links to nothing`.)*
3. **Page 2 and later** (`/reviews?cursor=…`) carry links as page 1 does. *(Task 1 test `links survive paging`.)*
4. **Short and long post entries:** a post with only one photo shows one thumbnail and no "+N"; a post with a video among its first three items shows the video's poster. *(Task 3 test `the strip draws one to three thumbnails, a video's poster, and +N past three`.)*
5. **Messy review text:** line breaks and right-to-left text in the viewer's review stay text, in `dir="auto"`, and the disclosure shows the whole body. *(Task 2 test `the linked review keeps its text as text and cuts its excerpt at a word`.)*

---

### Task 1: The API links both ways

**Files:**
- Modify: `packages/types/openapi.yaml` (`StudioReview`: add `freshInk`; `FreshInkPost`: add `review`, a new `LinkedReview` schema; descriptions per the spec's "When two items link"), then `pnpm --filter @tattoo-drip/types generate` (`packages/types/src/openapi.gen.ts`)
- Modify: `apps/platform/app/modules/reviews/services/public_review_service.ts`
- Modify: `apps/platform/app/transformers/public_studio_review_transformer.ts`, `apps/platform/app/transformers/public_fresh_ink_post_transformer.ts`
- Modify: `docs/sdk.md` (the reviews and Fresh ink reads)
- Test: `apps/platform/tests/functional/reviews/studio_page_reviews_http.spec.ts`

**Interfaces:**
- Produces (platform):
  - `type ShownLinkedReview = { id: string; rating: number; body: string; date: string }`
  - `ShownStudioReview.freshInk: ShownFreshInkPost | null`
  - `ShownFreshInkPost.review: ShownLinkedReview | null`
- Produces (contract): the two JSON fields above. A Fresh ink post embedded in a review has `review: null`.

- [ ] **Step 1: Write the failing tests** in a new group `GET /reviews and /fresh-ink: a review and its Fresh ink linked`, with the file's existing helpers (`studio`, `anotherProject`, its post and review factories):
  - `a shown review and post of one project link both ways`:
    - the review's `freshInk.id` is the post's id, and `freshInk.review` is null;
    - the post's `review` deep-equals `{ id, rating, body, date }` of the review;
    - the field lists are `REVIEW_FIELDS + "freshInk"` and `POST_FIELDS + "review"`, with `LINKED_REVIEW_FIELDS = ["id", "rating", "body", "date"]`.
  - `no link when the post is waiting, declined, unpublished, without consent, taken down or deleted`: each case makes `freshInk` null, and the post (where it shows) has `review` null for a review without consent, taken down or deleted.
  - `no link when the other section is off the page`: sections without `fresh_ink` give `freshInk: null`; without `reviews`, `review: null`.
  - `a post whose lead has no public photo links to nothing`.
  - `links survive paging`: with `limit=1`, the second page's review carries its post.
  - `another studio's project never links`: two studios with a project each; neither links across.
  - Update the two existing exact-fields tests' constants (`REVIEW_FIELDS`, `POST_FIELDS`) to include the new keys, with null values for unlinked items.

- [ ] **Step 2: Run them, expect FAIL**

Run: `node ace test functional --files=tests/functional/reviews/studio_page_reviews_http.spec.ts` (from `apps/platform`)
Expected: the new group fails on the missing fields.

- [ ] **Step 3: Implement the contract, then the service**
  - Edit `openapi.yaml` and regenerate the types.
  - In `reviews()`, select `project_id`. While `sectionsOf(tenant.storefrontSections).includes("fresh_ink")`, read the page's projects' posts with the `freshInk()` rules (one query, `whereIn("project_id", …)`), their media (one query), build each with `shownPost`, and attach by project.
  - In `freshInk()`, select `project_id`. While `includes("reviews")`, read `shownReviews(tenant).whereIn("project_id", …)` and attach `{ id, rating, body, date: dayOf(createdAt, tenant.timezone) }`.
  - Extract the post visibility rule from `freshInk()` into `function shownPosts(tenant)` (mirroring `shownReviews`), so both reads use one rule.

- [ ] **Step 4: Transformers.** `PublicStudioReviewTransformer` writes `freshInk: review.freshInk ? <the post transformer's object> : null`, sharing the post's object-building with `PublicFreshInkPostTransformer` (extract a plain `freshInkPostObject(post)` function both use). `PublicFreshInkPostTransformer` writes `review: post.review ? { id, rating, body, date } : null`.

- [ ] **Step 5: Run the spec, expect PASS;** then `tsc --noEmit` (platform) and `pnpm --filter @tattoo-drip/sdk typecheck`.

- [ ] **Step 6: Note both fields in `docs/sdk.md`.**

- [ ] **Step 7: Commit** `feat: link a client's review and Fresh ink in the studio page's reads`.

### Task 2: The storefront reads the links

**Files:**
- Create: `apps/storefront/src/studio/client-words.ts`. Move `DayView`, `dayView`, `readArtistTag` and `readShownName` here from `reviews.ts`, and re-export them from `reviews.ts` so current importers keep working. `fresh-ink.ts` imports them from here, so `reviews.ts` can import from `fresh-ink.ts` with no cycle.
- Modify: `apps/storefront/src/studio/fresh-ink.ts`, `apps/storefront/src/studio/reviews.ts`, `apps/storefront/src/studio/loaders.ts` (the two `reviewsView` callers pass `imageOrigin`), `apps/storefront/src/studio/copy.ts`
- Test: `apps/storefront/test/studio/reviews.test.ts`

**Interfaces:**
- Consumes: Task 1's JSON fields.
- Produces:
  - `readFreshInkPost(item: unknown, imageOrigin: string | null, n: number, prefix: string): FreshInkPostView | null` in `fresh-ink.ts` (the per-item body of `freshInkView`, which now calls it).
  - `export const REVIEW_INK_PREFIX = "review-ink"`.
  - `interface LinkedReviewView { readonly id: string; readonly rating: number; readonly ratingText: string; readonly body: string; readonly excerpt: string | null; readonly date: DayView | null }`.
  - `FreshInkPostView.review: LinkedReviewView | null`.
  - `ReviewView.freshInk: FreshInkPostView | null`, read with `readFreshInkPost(item.freshInk, imageOrigin, <the review's position, from 1>, REVIEW_INK_PREFIX)`.
  - `reviewsView(page: unknown, imageOrigin: string | null): ReviewsView`.
  - `excerptOf(body: string): string | null` in `client-words.ts`, per Global Constraints.

- [ ] **Step 1: Write the failing tests** in `reviews.test.ts`:
  - `reviewsView keeps a review's linked Fresh ink with its own dialog ids`: `freshInk.dialogId` starts with `review-ink`, and the photo is on the image origin.
  - `a garbled or off-origin linked post is dropped and the review kept`.
  - `freshInkView keeps a post's linked review: stars in words, the date, the excerpt`.
  - `the linked review keeps its text as text and cuts its excerpt at a word`: line breaks kept; a 250-character body gives an excerpt ending in "…" at a word boundary, at most 201 characters; a 200-character body gives `excerpt: null`.
  - `an invalid linked review (rating 0, no id) is null and the post kept`.

- [ ] **Step 2: Run them, expect FAIL.** Run: `pnpm test` (from `apps/storefront`). Expected: the new tests fail.

- [ ] **Step 3: Implement** the move to `client-words.ts`, `readFreshInkPost` and `REVIEW_INK_PREFIX`, the `review` read in it (stars validated 1 to 5 whole, a UUID id, body with `readText` at 2,000 characters, `excerptOf`), `ReviewView.freshInk`, the `reviewsView` signature and its callers, and the four copy entries.

- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck` (storefront), expect PASS.**

- [ ] **Step 5: Commit** `feat(storefront): read a review's Fresh ink and a post's review`.

### Task 3: The strip, the viewer's review, every theme

**Files:**
- Modify: `apps/storefront/src/studio/components/reviews.tsx` (`ReviewItem` draws `ReviewPhotos` and the post's `FreshInkDialog`)
- Modify: `apps/storefront/src/studio/components/fresh-ink.tsx` (`FreshInkFacts` draws `FreshInkReview` when `post.review`)
- Modify: `apps/storefront/src/styles.css` (base styles for `.client-review-photos` and `.fresh-ink-review`), `src/studio/theme/atelier/pages.css`, `src/studio/theme/flash-parlour/pages.css`, `src/studio/theme/irezumi/pages.css`, `src/studio/theme/ink-noir/home.css` (each theme's look)
- Modify: `apps/storefront/docs/development.md` (studio page), `docs/superpowers/specs/2026-11-12-reviews-and-fresh-ink-design.md` (one note under rulings 5–7 pointing at the new design), `docs/legal/client-content-terms.md` (the one line from the spec's Rollout)
- Test: `apps/storefront/test/studio/reviews.test.ts`

**Interfaces:**
- Consumes: Task 2's `ReviewView.freshInk`, `FreshInkPostView.review`, `LinkedReviewView`, copy keys.
- Produces:
  - `ReviewPhotos({ post, name }: { post: FreshInkPostView; name: string })`: one `<button type="button">` with `aria-haspopup="dialog"`, `aria-controls={post.dialogId}`, `aria-label` from `reviews.photos`, `onClick={() => showPhoto(post.dialogId)}`. It holds up to 3 `<img>`s (the main photo, then the first two angles: a photo's thumb, or a video's poster) with empty `alt`, plus a `+{count}` mark on the third when more than 3 items exist (count = items − 3).
  - `FreshInkReview({ review, name }: { review: LinkedReviewView; name: string })`: a heading from `freshInk.review`, `ReviewStars`, the date, and the text. When `excerpt` is set, the excerpt shows with `<details><summary>{readReview}</summary>` holding the full body; otherwise the full body shows.

- [ ] **Step 1: Write the failing render tests** in `reviews.test.ts` (the file's existing `render` helpers and theme loop), with a fixture review whose `freshInk` has 4 items, the third a video:
  - `${theme}: a linked review draws its strip and its post's viewer`: one button named "See Sita R.'s Fresh ink", three images, "+1", and a `<dialog>` whose id starts `review-ink`.
  - `the strip draws one to three thumbnails, a video's poster, and +N past three`: a 1-item post gives 1 image and no "+"; the video's thumbnail `src` is its poster.
  - `a post in the grid and in a review has two viewers with distinct ids`: a page with the same post in both renders two `<dialog>`s with different ids, each referenced by its own button's `aria-controls`.
  - `${theme}: a post's viewer shows its linked review`: "Review from Sita R.", the stars' words, and for a long body a `<details>` with summary "Read the review" holding the full text.
  - `the reviews' order is the API's, linked or not`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `ReviewPhotos` and `FreshInkReview` and wire them in, then add the base styles and each theme's adjustments. Thumbnails are square, `object-fit: cover`, and sit in a row that wraps on phones. The stars and disclosure use each theme's existing review colours.

- [ ] **Step 4: Run `pnpm test`, `pnpm typecheck` and `pnpm build` (storefront), expect PASS** (the build ends with its secret check).

- [ ] **Step 5: Browser-check** each of the five themes (default, Atelier, Flash Parlour, Irezumi, Ink Noir) on the home page, `/reviews` and `/fresh-ink`, at phone and desktop width, light and dark where the theme has both, against a local platform with a linked review and post. The strip opens the viewer, the review shows in the viewer, "Read the review" expands it, and the order is unchanged.

- [ ] **Step 6: Docs:** the storefront studio-page section, the 2026-11-12 spec note, the terms line.

- [ ] **Step 7: Commit** `feat(storefront): show a review's Fresh ink and a post's review on the studio page`.
