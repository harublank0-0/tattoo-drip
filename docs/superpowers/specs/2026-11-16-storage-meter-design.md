# Studio storage meter

Date: 2026-11-16. Status: design, agreed with the product owner in conversation; not built. Phase 5's second meter of [studio packages](2026-11-15-studio-packages-design.md) (Allowances, Storage, ruling 12, ruling 13). It **supersedes that spec's storage reserve** (see Rulings 4).

## Intent

A studio's stored files cost TattooDrip money every month, and a package should say how much it includes. Each studio gets a storage allowance by package, measured over the files it keeps now, shown where its people upload, and, once enforcement is on, held on the server for every upload path, so that no one is surprised and no existing work, payment or booking ever breaks because storage is full.

Success: a studio sees its usage and what counts toward it before it nears the limit. At the limit it knows what's blocked, how much space an upload needs and how to free it. A client can still send an inquiry, pay a deposit and post a review. Nothing is deleted or hidden because storage filled up.

## Rulings

1. **Allowances.** Solo 5 GB, Studio 25 GB (1 GB = 1024 MB), as launch defaults to validate against pilot usage. They're stored as new bundle versions, `solo-v2` and `studio-v2`, with the same 40 images a month and `storage_megabytes` 5120 and 25600; the packages' default bundles become v2. Bundles are immutable: a change is a new version.
2. **Pooled per studio**, across every member and every upload path. Logins don't multiply it (packages ruling 5).
3. **What counts: files the studio keeps now.** Usage doesn't reset with billing cycles. It counts:
   - each stored image's main file, but not its size copies (`variantsOfKey`)
   - each ready video's renditions and its poster's main file, but not the poster's copies (the uploaded original is deleted after processing)
   - Design Lab's stored concept images
   
   It doesn't count staging uploads (temporary), or the public copies of published Fresh ink (they duplicate private originals that already count).

   It also counts **only files a live record points to** (option A, chosen by the product owner). Two kinds don't count:
   - the files of a soft-deleted record (an artist's photo, a payment method's QR), which are kept on storage
   - orphans: files no record points to, left by a failed best-effort delete or a crash between upload and commit

   A studio pays only for what it can see and remove.
4. **When storage is full (option B, chosen by the product owner).** New uploads stop, except four kinds that are always accepted (and still counted): payment proofs (a client's deposit screenshot), payment-method QR images, and a client's review and Fresh ink photos and videos. Inquiry reference images are refused, and the client can send the inquiry without them. This replaces the packages spec's reserve: `storage_reserve_megabytes` stays null and unused. Per-file size limits and the existing rate limits already bound the always-accepted kinds.
5. **Existing work never breaks (ruling 13).** At or over the limit, every stored file stays viewable and downloadable, the published portfolio and studio page stay live, and bookings, deposits and text-only inquiries keep working. No automatic overage charges.
6. **Storage has its own switch** (chosen by the product owner): `STORAGE_ENFORCEMENT`, `observe` by default, separate from `PACKAGE_ENFORCEMENT`, so storage limits are switched on only after the backfill and a look at real usage, whatever the other package rules do.
   - With `observe`, nothing is refused. A refusal that would have happened is logged as "Package rule would refuse" (`storage_limit`), like the other package rules.
   - "Once enforcement is on" in this document means `STORAGE_ENFORCEMENT=enforce`.
7. **How a full studio frees space** (option A):
   - deleting portfolio items, artist photos, flash designs and studio images, as today
   - deleting a Design Lab project, which is new: it deletes its concept images, where today projects can only be archived
   - a soft delete of an artist or a payment method, which stops their files counting at once
   
   Inquiry reference images and payment proofs stay undeletable: they're the studio's record of client work and payments. They count, and the breakdown says why they can't be removed. A bundle with no storage number (`storage_megabytes` null) is unmetered, except the v1 bundles, which read their package's launch default (see Existing subscriptions and grants).

## Design

### The ledger

A tenant-owned table, `stored_files` (row-level security, isolation tests, `EXPECTED_POLICIES`), holds one row per counted file:
- `tenant_id`, `key` (unique), `purpose` (an `ImagePurpose` or video purpose), `category`, `bytes` (bigint)
- `status`: `reserved` or `stored`
- `reserved_at`, `expires_at` (reservations only), `stored_at`

Categories, for the breakdown:
- **Portfolio and studio page:** work photos and videos, artist photos, flash designs, cover, logo, icon
- **Clients and projects:** inquiry reference images, payment proofs, payment-method QR images, review and Fresh ink posts
- **Design Lab:** concepts

**Usage** is stored bytes plus the bytes of reservations that haven't expired.

### Reserving, reconciling, releasing

Every in-scope write reserves before it stores. The reservation is a short transaction of its own, on its own connection: never the request's, which runs until the request commits through image processing and the upload to R2. It's taken under a per-studio advisory lock (`storage:<tenant>`, the pattern `DesignUsageService` uses), so two concurrent uploads can't both take the last space, and the lock is held only for the check and the insert. Always-accepted purposes skip the check and the lock and record their size when stored, so a client's deposit proof never waits on a studio's uploads.
- **The check:** usage + requested ≤ limit, when enforced, the bundle is metered and the purpose isn't always-accepted. If it fails, the upload is refused before anything is written.
- **Requested bytes:**
  - an image: its upload's size (an upper bound; processing usually shrinks it)
  - a video: the exact size `signUpload` already binds, reserved at signing, before the browser's PUT
  - a Design Lab generation: a fixed per-image estimate, 8 MB, reserved with its usage units
- **Reconciling:** once the file is stored, its row becomes `stored`, with the stored main file's actual size (a video: renditions plus poster, summed per item). A video's renditions can come out larger than its upload. The stored size is recorded even when that puts usage over the limit: the space was already granted.
- **Releasing:** a reservation lives outside the request's transaction, so release is explicit: the write's failure path deletes its row, the request's rollback deletes it through `afterRollback`, and a failed processing job deletes it too. A reservation left behind by a crash expires:
  - an image's after 15 minutes
  - a video's after 75 minutes: the 15-minute signed upload plus the 60-minute stuck-video deadline
  - a Design Lab generation's after 1 hour
  
  Expired reservations stop counting at once, and a daily sweep deletes them.
- **Soft deletes:** when an artist or a payment method is soft-deleted, its files' rows are removed (the files stay on storage), and reconcile re-records them if the record comes back.
- **Deleting** a file deletes its row, after the storage delete succeeded (`deleteOrThrow`), or for each file the best-effort `delete` really removed.

Uploads resume as soon as there's room. The check reads usage live on every upload, so freeing space, an upgrade or a higher allowance lifts the block at once.

### Hooks (the normal entry points)

`ImageService.store`, `storeLogo`, `storeOriginal` and `storeBytes` take the reservation from their caller and reconcile it. `VideoService.signUpload` reserves, and `process` reconciles or releases. Every caller passes the purpose it already passes, so the always-accepted rule lives in one map next to `IMAGE_PURPOSES`. `copyTo` (Fresh ink publishing) writes nothing to the ledger. The call sites today:
- intake (reference images)
- artists (photos), work photos and videos, flash
- settings (cover, logo, icon)
- payment methods (QR), deposit page (proofs)
- client posts (photos, videos)
- Design Lab (concepts)

### Backfill and reconcile

The ace command `storage:reconcile [slug]` makes the ledger match storage, and is safe to run again.
- It reads every key a live record points to (each table that stores an image or video key, read in the studio's context, excluding soft-deleted records).
- It lists the studio's prefix (`tenants/<id>/`) on both disks for the sizes, classifying each key by purpose and naming: a main file, a size copy, a rendition, a staging upload, or a public Fresh ink copy.
- It upserts `stored` rows for the counted files of live records, with the listed sizes. It deletes `stored` rows whose file is gone or whose record isn't live.
- It reports orphans (listed files no live record points to) without counting them. The orphan sweep (TAT-140) is a separate job.
- It reports per studio what it changed.

It's run once before enforcement is switched on, and whenever drift is suspected. A nightly run is left to the rollout.

### What people see

- **Owner's Billing page:** a **Storage** section with:
  - "1.2 GB of 5 GB used" and a bar
  - the three categories with their sizes, each linking to where those files are managed (Portfolio and the artist pages; Clients and projects; Design Lab), which is the "file management" a refusal points to
  - in observe mode, a line saying limits aren't applied yet
- **Staff upload flows** (portfolio, flash, artists, cover, logo and icon, Design Lab): a compact usage line next to the upload control, from a shared prop computed once per request.
- **Dashboard warning at 80%** (every member; owners also get a link to Billing): "Your studio has used 82% of its 5 GB storage." Shown only once enforcement is on. In observe mode the Billing section shows the state instead (packages spec: notices only once enforced).
- **Staff refusal:** "This upload needs 12.4 MB, but your studio has 3.1 MB of storage left." It links to file management, and to Studio's 25 GB when a Solo studio would fit there. The upgrade itself comes in phase 4; until then it says to contact TattooDrip.
- **Client inquiry:** if the reference images can't be stored because storage is full, the API answers a new 409 `attachments_unavailable` before anything is created. The intake form explains ("This studio can't take photos right now") and offers **Send without photos**, which resends the same inquiry without files. The studio gets the inquiry without them.

### Email at 95%

One email to the studio's owners when usage first reaches 95%. It's sent once per crossing: an atomic marker on the studio (`storage_alerted_at`), set by `update … where storage_alerted_at is null returning`, so retries and concurrent uploads send one email. The marker clears when usage falls below 90%, so a later crossing sends again. It's queued after commit as a mail job. Sent only once enforcement is on and mail is on (`ALERT_EMAILS`); otherwise it's logged.

### Downgrades (with phase 4)

Studio to Solo takes effect at renewal (packages ruling 11). Before the owner confirms, the downgrade screen shows current usage against Solo's 5 GB, and what happens if it's over: files are kept, and new uploads pause until there's room. At renewal the lower limit simply applies; nothing is deleted or archived.

## Rollout

1. **Measure:** the ledger, the hooks recording stored sizes, `storage:reconcile` with the backfill, and the Billing section and upload lines in observe mode. Nothing is blocked.
2. **Enforce:** reservations on every path, the refusals, the client inquiry fallback (contract, SDK, storefront), deleting a Design Lab project, and the dashboard warning.
3. **The 95% email.**
4. **The downgrade preview,** with phase 4.

Before switching `STORAGE_ENFORCEMENT=enforce`:
- run `storage:reconcile` for every studio
- compare usage with 5 GB and 25 GB

## Goals, non-goals, anti-goals

- **Non-goals:** automatic overage charges, buying extra storage, a separate file manager page, per-member quotas, and counting size copies, staging or public copies.
- **Anti-goals:**
  - a client's deposit or review refused because storage is full
  - an existing file hidden or deleted
  - two uploads both taking the last space
  - duplicate 95% emails
  - a studio blocked by a ledger that missed its deletions (reconcile fixes it, and deletes decrement the ledger)

## Existing subscriptions and grants (decided by the product owner, 2026-11-16)

Existing paid plans, pilot grants and trials point at the v1 bundles, which have no storage number. They get their package's launch default: a v1 bundle's missing storage number reads as `studio-v2`'s 25 GB for Studio and `solo-v2`'s 5 GB for Solo. Every existing paid plan maps to Studio (packages spec), so they get 25 GB. Production today has only the owner's test studio. So no new plan codes are needed: both catalogue plans keep `studio-v1` (`billing:sync-plans` refuses a bundle change on an existing code), which reads 25 GB, the same as a trial on `studio-v2`. This is the one place a null storage number isn't "unmetered": the v1 bundles predate storage metering, and the read happens where the meter resolves a studio's storage limit.

## Calls made (the product owner may change them)

- Payment-method QR images are always accepted, like payment proofs.
- Design Lab generation stops when storage is full.
- What isn't counted: size copies, staging, and public Fresh ink copies. For videos, renditions and the poster's main file count.
- The inquiry fallback is an explicit "Send without photos", not a silent drop.
- The dashboard warning and the email wait for enforcement, as other package notices do.
- The categories and their link targets.
- Reservation lifetimes: an image 15 minutes, a video 75 minutes, a Design Lab generation 1 hour.
- Design Lab's per-image estimate is 8 MB.
- Reserving is a short transaction of its own, released explicitly. Always-accepted uploads skip the lock.
- No new paid plan codes: v1 bundles read the launch default.

## Left to the builder

Table and column names beyond those above, the advisory lock's key, how the reservation is threaded through `ImageService`'s signatures, the copy beyond the quoted lines, the meter's markup, whether the sweep is a job or part of reconcile, test structure. Tests needed:
- the ledger's isolation
- concurrent reservations near the limit
- failed uploads releasing
- expiry
- deletions decrementing
- reconcile's classification
- each always-accepted purpose under a full studio
- the inquiry fallback end to end
- the 95% marker under concurrency
