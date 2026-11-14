import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * Reviews and Fresh ink on Discover (slice 4, docs/superpowers/specs/
 * 2026-11-12-reviews-and-fresh-ink-design.md, rulings 8 to 11): three views
 * in schema `discovery`, made exactly as D02's (1791870000001,
 * docs/discover/database-security.md):
 *
 * - `discovery.reviews`: a client's review the client allowed on Discover
 *   (`consent_discover`), not taken down, not deleted, whose artist is shown
 *   at a listed business. Its reply is null when TattooDrip took the reply
 *   down (the view's rule: the review stays).
 * - `discovery.fresh_ink`: a client's post the studio approved, published
 *   (`published_at`: its public copies exist), allowed on Discover, not
 *   taken down, not deleted, whose artist is shown at a listed business.
 * - `discovery.fresh_ink_media`: such a post's photos and ready videos, with
 *   their PUBLIC keys only: the private originals' names
 *   (`tenants/<id>/client_post_photo/<file>`, `client_post_video`) mapped
 *   in the view to their public copies' (`fresh_ink_photo`,
 *   `fresh_ink_video`, the same file names, PostPublicationService), and a
 *   row whose key is not of that shape (another tenant's folder, `..`) is
 *   left out (a video's every rendition key too: a NULL in `video_keys`
 *   would slip through a regex, so `array_position(…, null)` refuses it). A
 *   video still processing or failed is never a row.
 *
 * The boundary is D02's, unchanged in kind: owned by tattoo_drip_discovery
 * (the CREATE dance below; a superuser must run it, as D02's), not
 * security_invoker and not security_barrier (D02's reasons), explicit
 * columns, each WHERE repeating the rules; the role gets column-level SELECT
 * on the columns the views and policies read and nothing else (never a
 * client id, a project id, the consent to the studio's page, the report,
 * the takedown reasons or notes, a submitter digest, a staging key or a
 * failure text), and its own policies on the three tables, TO the role
 * only: a restrictive `discovery_only` with the full rule and a permissive
 * `discovery_select` on the row's own columns. The reviews' and posts' full
 * rule reads `artists`, whose restrictive policy brings the studio's rule
 * with it; the media's reads `client_posts`, whose policy brings the rest.
 * The app role gets SELECT on the views and nothing new on any table.
 *
 * A studio that unlists (or is taken down, or deleted) takes every review
 * and post off at once, and they return when it lists again while the
 * client's consent stands: the views are live queries.
 *
 * Two partial indexes for Discover's reads: a studio's reviews newest first
 * and the global Fresh ink feed newest first, each holding exactly the rows
 * the views can show of its table.
 */
const ROLE = "tattoo_drip_discovery";

/** D02's rules (1791870000001), repeated in each view's WHERE. */
const tenantListed = (t: string) =>
	`${t}.discovery_listed and ${t}.discovery_listed_at is not null and ${t}.discovery_suspended_at is null and ${t}.deleted_at is null`;
const artistShown = (a: string) =>
	`${a}.visible and ${a}.discovery_listed and ${a}.deleted_at is null`;

/** A review's own flags: Discover allowed by the client, not taken down, not deleted (nor scrubbed). */
const reviewShown = (r: string) =>
	`${r}.consent_discover and ${r}.taken_down_at is null and ${r}.deleted_at is null and ${r}.rating is not null`;
/** A post's own flags: approved, published, Discover allowed, not taken down, not deleted. */
const postShown = (p: string) =>
	`${p}.status = 'approved' and ${p}.published_at is not null and ${p}.consent_discover and ${p}.taken_down_at is null and ${p}.deleted_at is null`;
/** A media row's own flags: a photo, or a ready video (its poster and renditions exist). */
const mediaShown = (m: string) =>
	`(${m}.kind = 'photo' or (${m}.kind = 'video' and ${m}.video_state = 'ready'))`;

/** The artist of a review or post is shown at a listed business (artists' own policy adds the studio). */
const artistOf = (table: string) =>
	`exists (select 1 from public.artists a where a.id = ${table}.artist_id and a.tenant_id = ${table}.tenant_id and ${artistShown("a")})`;

/** Per table: the permissive policy's own-row check and the restrictive full rule. */
const POLICIES: [table: string, own: string, rule: string][] = [
	[
		"client_reviews",
		reviewShown("client_reviews"),
		`${reviewShown("client_reviews")} and ${artistOf("client_reviews")}`,
	],
	[
		"client_posts",
		postShown("client_posts"),
		`${postShown("client_posts")} and ${artistOf("client_posts")}`,
	],
	[
		"client_post_media",
		mediaShown("client_post_media"),
		`${mediaShown("client_post_media")} and exists (select 1 from public.client_posts p where p.id = client_post_media.post_id and p.tenant_id = client_post_media.tenant_id and ${postShown("p")})`,
	],
];

/**
 * What the role may read: the public columns and the ones the rules read.
 * Never `client_id`, `project_id`, `consent_studio_page`, the report and
 * takedown reasons and notes, `submitter_digest`, a video's staging key or
 * failure.
 */
const COLUMN_GRANTS: Record<string, string[]> = {
	client_reviews: [
		"id",
		"tenant_id",
		"artist_id",
		"rating",
		"body",
		"shown_name",
		"consent_discover",
		"reply",
		"replied_at",
		"reply_taken_down_at",
		"taken_down_at",
		"deleted_at",
		"created_at",
	],
	client_posts: [
		"id",
		"tenant_id",
		"artist_id",
		"shown_name",
		"caption",
		"styles",
		"placement",
		"status",
		"published_at",
		"consent_discover",
		"taken_down_at",
		"deleted_at",
	],
	client_post_media: [
		"id",
		"tenant_id",
		"post_id",
		"kind",
		"position",
		"image_key",
		"width",
		"height",
		"alt",
		"video_state",
		"video_keys",
		"video_duration_ms",
	],
};

/** A stored private key of `m`'s tenant under `purpose`: `tenants/<tenant>/<purpose>/<file>`, no `..`. */
const privateKey = (key: string, m: string, purpose: string) =>
	`(${key} ~ ('^tenants/' || ${m}.tenant_id::text || '/${purpose}/[^/]+$') and strpos(${key}, '..') = 0)`;
/** The public copy's key: the same tenant and file name in the public purpose's folder. */
const publicKey = (key: string, m: string, purpose: string) =>
	`'tenants/' || ${m}.tenant_id::text || '/${purpose}/' || substring(${key} from '[^/]+$')`;

const VIEWS = ["reviews", "fresh_ink", "fresh_ink_media"];

const REVIEWS_INDEX = `create index client_reviews_discover_newest on client_reviews (tenant_id, created_at desc, id desc) where consent_discover and taken_down_at is null and deleted_at is null and rating is not null`;
const POSTS_INDEX = `create index client_posts_discover_newest on client_posts (published_at desc, id desc) where status = 'approved' and published_at is not null and consent_discover and taken_down_at is null and deleted_at is null`;

export default class extends BaseSchema {
	async up() {
		// The app role (DB_USER, created by setup_roles.sql) as an SQL identifier.
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;

		// D02's guard: refuse without the role, or with powers it must not have.
		this.schema.raw(`do $$
begin
  if not exists (
    select 1 from pg_roles
    where rolname = '${ROLE}' and not rolcanlogin and not rolsuper
      and not rolbypassrls and not rolinherit
  ) or exists (
    select 1 from pg_auth_members m join pg_roles r on r.oid in (m.roleid, m.member)
    where r.rolname = '${ROLE}'
  ) then
    raise exception 'the role ${ROLE} is missing, or can log in, bypass RLS or belongs to a role: run database/setup_roles.sql again (docs/discover/database-security.md)';
  end if;
end $$`);

		for (const [table, columns] of Object.entries(COLUMN_GRANTS)) {
			this.schema.raw(
				`grant select (${columns.join(", ")}) on public.${table} to ${ROLE}`,
			);
		}
		for (const [table, own, rule] of POLICIES) {
			this.schema.raw(
				`create policy discovery_select on public.${table} as permissive for select to ${ROLE} using (${own})`,
			);
			this.schema.raw(
				`create policy discovery_only on public.${table} as restrictive for select to ${ROLE} using (${rule})`,
			);
		}

		// A review on Discover: its reply only while TattooDrip has not taken the reply down.
		this.schema.raw(`create view discovery.reviews as
select r.id, r.tenant_id as studio_id, r.artist_id, r.rating, r.body, r.shown_name,
       case when r.reply_taken_down_at is null then r.reply end as reply,
       case when r.reply_taken_down_at is null and r.reply is not null then r.replied_at end as replied_at,
       r.created_at
from public.client_reviews r
join public.artists a on a.id = r.artist_id and a.tenant_id = r.tenant_id
join public.tenants t on t.id = r.tenant_id
where ${reviewShown("r")} and ${artistShown("a")} and ${tenantListed("t")}`);

		// A Fresh ink post on Discover.
		this.schema.raw(`create view discovery.fresh_ink as
select p.id, p.tenant_id as studio_id, p.artist_id, p.shown_name, p.caption,
       p.styles, p.placement, p.published_at
from public.client_posts p
join public.artists a on a.id = p.artist_id and a.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
where ${postShown("p")} and ${artistShown("a")} and ${tenantListed("t")}`);

		// Its photos and ready videos, public keys only (the lead is position 0, always a photo).
		this.schema.raw(`create view discovery.fresh_ink_media as
select m.id, m.post_id, m.position, m.kind,
       case when m.kind = 'photo'
            then ${publicKey("m.image_key", "m", "fresh_ink_photo")}
            else ${publicKey("m.image_key", "m", "fresh_ink_video")} end as image_key,
       m.width, m.height, m.alt,
       case when m.kind = 'video' then array(
         select ${publicKey("v.key", "m", "fresh_ink_video")}
         from unnest(m.video_keys) with ordinality as v(key, n) order by v.n
       ) end as video_keys,
       m.video_duration_ms
from public.client_post_media m
join public.client_posts p on p.id = m.post_id and p.tenant_id = m.tenant_id
join public.artists a on a.id = p.artist_id and a.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
where m.image_key is not null and m.width is not null and m.height is not null
  and ((m.kind = 'photo' and ${privateKey("m.image_key", "m", "client_post_photo")})
    or (m.kind = 'video' and m.video_state = 'ready' and ${privateKey("m.image_key", "m", "client_post_video")}
        and cardinality(m.video_keys) > 0
        and array_position(m.video_keys, null) is null
        and not exists (select 1 from unnest(m.video_keys) as v(key)
                        where not ${privateKey("v.key", "m", "client_post_video")})))
  and ${postShown("p")} and ${artistShown("a")} and ${tenantListed("t")}`);

		// D02's dance: CREATE for the new owner to take the views over, taken back at once.
		this.schema.raw(`grant create on schema discovery to ${ROLE}`);
		for (const view of VIEWS) {
			this.schema.raw(`alter view discovery.${view} owner to ${ROLE}`);
		}
		this.schema.raw(`revoke create on schema discovery from ${ROLE}`);
		for (const view of VIEWS) {
			this.schema.raw(`revoke all on discovery.${view} from public`);
			this.schema.raw(`grant select on discovery.${view} to ${appRole}`);
		}

		this.schema.raw(REVIEWS_INDEX);
		this.schema.raw(POSTS_INDEX);
	}

	async down() {
		this.schema.raw("drop index client_posts_discover_newest");
		this.schema.raw("drop index client_reviews_discover_newest");
		for (const view of [...VIEWS].reverse()) {
			this.schema.raw(`drop view discovery.${view}`);
		}
		for (const [table] of [...POLICIES].reverse()) {
			this.schema.raw(`drop policy discovery_only on public.${table}`);
			this.schema.raw(`drop policy discovery_select on public.${table}`);
		}
		for (const table of Object.keys(COLUMN_GRANTS)) {
			this.schema.raw(`revoke all on public.${table} from ${ROLE}`);
		}
	}
}
