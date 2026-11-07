# Discover: database security and publication data

How Discover reads public data across studios without loosening tenant isolation (Discover D02).
- **Migrations:** `apps/platform/database/migrations/1791870000000_add_discovery_publication.ts` (data) and `1791870000001_create_discovery_views.ts` (boundary).
- **Role setup:** `apps/platform/database/setup_roles.sql`.
- **Proof:** `apps/platform/tests/functional/rls/discovery.spec.ts`.
- **Plan:** [implementation blueprint](implementation-blueprint.md).
- **Reader:** the public Discover API (D03) reads these views, with no context and read-only: [Discover API](api.md).

## 1. The boundary

The app role (`DB_USER`) sees one tenant at a time: every tenant table has row-level security keyed by `app.tenant_id`. Discover needs the public rows of every listed studio, with no tenant context. It gets them only through three views:

```text
app role ──SELECT──► discovery.studios / artists / artworks   (views, owned by tattoo_drip_discovery,
                         │                                     not security_invoker, no security_barrier)
                         ▼ read AS tattoo_drip_discovery
                     public.tenants, artists, artist_work_photos   (RLS on; owned by the migration owner)
```

| Layer | What it is | What it stops |
|---|---|---|
| **Role** | `tattoo_drip_discovery`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB/ROLE, NOREPLICATION; member of no role and no role is its member. Created and normalised by `setup_roles.sql`. The migration refuses to run if it is missing or has any of those powers | Nobody can log in as it or act as it; the app role cannot `SET ROLE` to it (tested on a real app-role session) |
| **View ownership** | The views belong to the role, not to the table owner. Views that are not `security_invoker` read their tables with the *owner's* privileges and RLS, so they read as the role, which RLS binds. The role has no USAGE (and, after the migration, no CREATE) on schema `discovery`, so even as owner it cannot rename, alter or replace its views | The classic hole: a view owned by the table owner bypasses RLS and leaves only its WHERE |
| **Column grants** | The role has column-level SELECT on public columns of `tenants`, `artists` and `artist_work_photos`, plus three `tenant_memberships` columns that a policy reads (§3). Nothing else on any table, no write privilege anywhere, no CREATE on the schema after the migration | Contact details, deposit settings, members, the artist's login, the takedown note, clients, inquiries, money: "permission denied" even through a new view or a mistaken `select *` |
| **Policies** | `discovery_only` (RESTRICTIVE, the full rule) and `discovery_select` (PERMISSIVE, the row's own flags) on the three tables, `TO tattoo_drip_discovery` only; `discovery_none` (RESTRICTIVE, `false`) on `tenant_memberships` | Unlisted, taken-down, deleted, hidden, opted-out or unpublished rows, whatever tenant or user context a session sets |
| **View WHERE** | Each view repeats the rules and selects explicit columns | Defence in depth; the views' columns are the public contract |

The app role gets `USAGE` on schema `discovery` and `SELECT` on the three views. It gets nothing new on any table.
- `PUBLIC` has no access to the schema or the views.
- `places` is readable by the app role; its write privileges are revoked, by the migration and again by `setup_roles.sql`, whose broad table grant would otherwise give them back on a re-run (tested).

**Why restrictive.** The existing tenant policies apply to every role (`TO public`), and permissive policies are OR-ed. So with only a permissive discovery policy, a session that sets `app.tenant_id` of an unlisted studio would let the role see that studio's rows. The restrictive `discovery_only` is AND-ed with all of them: the role sees a row only if it passes the full rule. The permissive `discovery_select` exists because a row also needs one permissive policy to pass. It checks only the row's own columns, which is cheap (see §6).

`tenants_select` (every role) reads `tenant_memberships`, so the role needs SELECT on three of its columns for the policy to plan. `discovery_none` then shows it no membership at all.

**Why no `security_barrier`.**
- RLS already filters every row before any non-leakproof condition of the caller's.
- A view exposes only its own columns.
- The barrier added no protection and blocked the newest-first index plan (145 ms against 2 ms at 50,000 photos).

**Why not `security_invoker`.** It would apply the *app role's* RLS. With no tenant context that shows nothing, and with one it shows that tenant's private rows. Making it work would mean widening the app role's policies, which would weaken Studio OS isolation.

**Trust boundary and residual risk.**
- The app role is trusted code that already sets its own tenant context, as before. D02 gives it no new way to read private data:
  - the views show only eligible rows and public columns, whatever context it sets;
  - its table access is unchanged.
- Anyone able to change the views or the role must be the migration owner or a superuser, which is already the trust root.
- The policies, grants and view columns are pinned by `discovery.spec.ts` and the catalog guard. A change to any of them fails a test until it is made consciously.

## 2. Publication rules

**In the database:** what may never leak.

| Row | On Discover when |
|---|---|
| Studio or independent artist (`tenants`) | `discovery_listed` and `discovery_listed_at is not null` and `discovery_suspended_at is null` and `deleted_at is null` |
| Artist (`artists`) | its business is listed and `visible` and `discovery_listed` and `deleted_at is null` |
| Photo (`artist_work_photos`) | its artist is shown (above) and `not hidden` (published on the studio page) and `discovery_suspended_at is null` |

- **Defaults:** every existing and new tenant starts unlisted (`discovery_listed false`). Artists default to `discovery_listed true`: they follow their studio, and an artist can opt out. Seeders opt no one in.
- **Constraints:**
  - `tenants_discovery_listed_at`: a listing must record when the owner accepted the listing terms.
  - `tenants_discovery_suspension_note`: a takedown note only comes with a takedown.
- **Visibility changes are immediate.** The views are live queries with no copy and no cache in the database. A studio that stops listing, or is taken down or deleted, takes its artists and photos with it. An opted-out, hidden or deleted artist takes their photos. An unpublished or taken-down photo disappears alone. Tests cover each case and the way back.
- **Not visible means absent.** D03 must answer 404 for any id the views don't return.
- **Independent artists** are tenants of type `independent`. They follow the same opt-in and takedown rules, appear in `discovery.studios` with `type = 'independent'`, and their artist profile appears in `discovery.artists`. Their URL is `/artists/:tenantSlug`.
- **Artist identity:** a `discovery.artists` row is one artist's profile at one business. Its `id` is the stable public id. Slugs are unique per studio only: `/studios/:studioSlug/artists/:artistSlug`.

**In the application (D03/D04):** completeness and display. The suggested defaults are:
- the studio has a city (`place_id`);
- a logo or a cover;
- six or more published photos;
- shown artists have three or more.

These decide ranking or whether a profile is "complete", not safety. They are tunable in code, so they are not in policies.

## 3. Columns the views expose

| View | Columns |
|---|---|
| `discovery.studios` | `id`, `slug`, `type`, `name`, `intro`, `timezone`, `place_id`, `cover_image_key/_width/_height`, `logo_image_key/_width/_height`, `logo_tile`, `logo_icon_key`, `instagram_url`, `facebook_url`, `tiktok_url`, `website_url`, `listed_at` |
| `discovery.artists` | `id`, `studio_id`, `slug`, `name`, `bio`, `photo_key/_width/_height`, `styles`, `accepting_inquiries`, `accepting_flash`, `instagram_url`, `facebook_url`, `tiktok_url`, `created_at` |
| `discovery.artworks` | `id`, `studio_id`, `artist_id`, `image_key`, `width`, `height`, `alt`, `styles`, `healed`, `created_at` |

- **Image keys:** stored keys of *public* images (R2's public bucket). D03 turns them into URLs and variants with `ImageService`, as the storefront API does.
- **Deliberately absent** (unlike the storefront API, which shows some of them on the studio's own page):
  - contact phone, email and free-text address. Discover sends people to the studio page for those. An independent artist's contact details may be personal;
  - closed messages;
  - FAQ, policies and deposit text;
  - the artist's login;
  - every moderation field.

## 4. Locations and styles

**`places`.** This is platform reference data, not tenant-owned, so it has no RLS (catalog guard exemption).
- **Columns:** `country_code` (ISO 3166-1, `^[A-Z]{2}$`), `region` (first-level subdivision), `slug` (unique per country), `name`.
- **Seeded:** 14 curated Nepal cities (`kathmandu` … `dhangadhi`, with provinces). Janakpur keeps its common name; its municipality is officially Janakpurdham.
- **On tenants:** `tenants.place_id` is optional, with `ON DELETE RESTRICT` (a place in use is never deleted). The free-text `address` is untouched and nothing is inferred from it.
- **International:** a new country is a migration that inserts places. City names need not be unique; slugs are unique per country.

**Styles reuse the existing taxonomy.** It is the fixed code list `TATTOO_STYLES` (`app/modules/artists/styles.ts`), stored as slug arrays on `artists.styles` (≤5) and `artist_work_photos.styles` (≤3).
- No second table: a database copy would compete with the code list.
- The views expose the arrays. D03 validates filter slugs against the list and shows names from it.
- A studio's styles are its shown artists' styles: `exists (select 1 from discovery.artists a where a.studio_id = s.id and a.styles && $1)`.

## 5. Indexes and query shapes

Every order has the id as tie-breaker, for keyset paging. All four indexes are partial: they cover only rows Discover can show.

| Index | Serves |
|---|---|
| `tenants_discovery_place (place_id)` | Studios in a city |
| `tenants_discovery_listed (discovery_listed_at desc, id desc)` | Studios newest-listed first |
| `artists_discovery_name (lower(name), id)` | Artists by name |
| `artist_work_photos_discovery_newest (created_at desc, id desc)` | The newest-photos feed and its cursor pages |

Existing indexes also serve Discover: `artists_tenant_id_index` for a studio's artists, and `artist_work_photos_artist_newest` for a studio's or artist's photos.

**No trigram or GIN index.**
- Under RLS, PostgreSQL uses a caller's condition as an index condition only if its operator is leakproof. `uuid_eq` and text ordering are; pg_trgm's `%`, `LIKE`, `lower()` and array `&&` are not (checked in `pg_proc`).
- Trial trigram and GIN indexes were ignored in `EXPLAIN`, so they were not kept.
- Name search is a sequential scan of *listed* studios or artists: hundreds of rows, under 1 ms.
- The style filter is a scan as well (below).

**Measured as the app role through the views** (PostgreSQL 18.6; 500 businesses, 400 listed; 2,000 artists; 50,000 photos; `EXPLAIN ANALYZE`, warm cache):

| Query | Time |
|---|---|
| Studios in a city, newest first, 24 | 0.24 ms |
| Studios newest first / name contains | 0.12 / 0.35 ms |
| Artists by name, 24 / one studio's artists | 0.45 / 0.22 ms |
| Newest photos, first page / cursor page | 2.1 / 1.5 ms |
| One studio's photos, 12 | 0.6 ms |
| Photos with a style (common or rare), 24 | ~117 ms |

The style filter is the one slow shape. D03 should measure its real query and may reshape it, for example by walking the newest index for common styles. If volumes grow, the options are:
- a materialized public projection with its own indexes, refreshed by a job (denormalisation, so it waits for evidence);
- an external search engine fed from these views.

## 6. Setup, prerequisites, rollback

1. **Before migrating**, run `setup_roles.sql` again on each database, as a superuser. It is safe to run again. It creates `tattoo_drip_discovery` and strips any power or membership it must not have. The migration stops with a clear error until then.
   - Dev Compose volumes, CI and new servers run it already.
   - An existing production database needs it once.
2. **Migrations run as the owner** (`pnpm migrate`; production `node build/ace.js migration:run --connection=owner --force`), and **for D02 the owner must be a superuser**.
   - Giving the views to the role (`ALTER VIEW … OWNER TO`) needs a caller who can `SET ROLE tattoo_drip_discovery`.
   - `setup_roles.sql` strips every membership of the role, and the migration refuses to run while it has one, so only a superuser can do that.
   - `setup_roles.sql` itself needs a superuser too, because its `ALTER ROLE`s set attributes only a superuser may change.
   - Dev, CI and the single-server deploy all migrate as the Postgres superuser.
   - On a managed Postgres without one, the migration cannot be applied as written. Options: grant the owner membership for the one migration and revoke it afterwards (then re-run `setup_roles.sql`), or create the views with `SET ROLE` in that window.
3. **Rollback** (`migration:rollback --connection=owner`):
   - It drops the views, schema, policies, grants and indexes, then the new columns and `places`.
   - Studios' listing state, takedowns and places are lost. Everything else is untouched; checksums of existing tenants, artists and photos were identical before and after a rollback and re-migration.
   - The role is left in place: it is cluster-wide and holds nothing in that database.
   - Never roll back a database you cannot afford to lose this state on.

**Tests:**

```bash
cd apps/platform
node ace test functional --files=discovery.spec.ts      # the boundary, rules and publication changes (25 tests)
node ace test functional --files=catalog_guard.spec.ts --files=setup_roles.spec.ts --files=policies.spec.ts
```

They use a real PostgreSQL. One test plants a volatile, near-free function (it records every row it is given) in a view's WHERE, as the app role with an unlisted studio's context forged. It sees only rows the view shows. That is the proof that the views need no `security_barrier`. Each test writes fixtures as the owner in a transaction that is rolled back, and reads with `SET LOCAL ROLE` as the app role or the discovery role. A savepoint that is always rolled back keeps a role or context from outliving its statement. Impersonation is tested on a real app-role session, because `SET ROLE` is checked against the session user.

## 7. Known limitations

- **Text search and style filters can't use indexes under RLS** (§5). Fine at MVP volume; revisit with measurements.
- **Completeness is not enforced in the database:** an opted-in studio with no photos is listed. D03/D04 decide what to show.
- **One person in two studios** has two artist rows. There is no global identity (blueprint §D.2).
- **Takedowns are per studio and per photo, not per artist.** A studio can hide an artist itself.
- **The role name is fixed** (`tattoo_drip_discovery`). One cluster serving several app databases shares it, which is harmless: it holds privileges per database.
