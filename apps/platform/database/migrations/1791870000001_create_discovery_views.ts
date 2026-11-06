import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * Discover's cross-tenant read boundary (Discover D02,
 * docs/discover/database-security.md). The app role sees one tenant at a
 * time; Discover needs the public rows of every listed studio, without a
 * tenant context. Three layers, each enough on its own for what it guards:
 *
 * 1. The views in schema `discovery` are owned by tattoo_drip_discovery
 *    (setup_roles.sql: NOLOGIN, no superuser, no BYPASSRLS, no memberships)
 *    and are not security_invoker, so their tables are read as that role:
 *    under row-level security, never as the table owner, who bypasses it.
 * 2. That role has column-level SELECT on the public columns only, and no
 *    other privilege on any table.
 * 3. Its own policies, TO that role only, so the app role's access is
 *    unchanged. The tables' own policies apply to every role (a tenant
 *    context would show that tenant's rows) and permissive policies are
 *    OR-ed, so the full rule is a restrictive policy, which is AND-ed with
 *    them; the permissive one only needs to let eligible rows through and
 *    checks the row's own columns (cheap: measured, the full rule in both
 *    made a page of the newest photos take 340 ms instead of 2 ms).
 *    The photo rule reads `artists`, whose own restrictive policy brings the
 *    studio's rule with it.
 *
 * Each view's WHERE repeats the rules. The views are not security_barrier:
 * RLS already filters every row before any condition of the caller's, and a
 * view shows only its own columns, so the barrier protected nothing while
 * it kept the planner from using the newest-first index (145 ms against
 * 2 ms). The app role gets SELECT on the views and nothing new on any table.
 *
 * The rules (who is on Discover) are SQL here and in the policies, written
 * once below; completeness thresholds (photos, city, logo) are the app's.
 */
const ROLE = "tattoo_drip_discovery";

/** A listed tenant: opted in with the terms, not taken down, not deleted. */
const tenantListed = (t: string) =>
	`${t}.discovery_listed and ${t}.discovery_listed_at is not null and ${t}.discovery_suspended_at is null and ${t}.deleted_at is null`;

/** A shown artist's own flags: on the studio page, not opted out, not deleted. */
const artistShown = (a: string) =>
	`${a}.visible and ${a}.discovery_listed and ${a}.deleted_at is null`;

/** A shown photo's own flags: published on the studio page, not taken down. */
const photoShown = (p: string) =>
	`not ${p}.hidden and ${p}.discovery_suspended_at is null`;

/** Per table: the permissive policy's own-row check and the restrictive full rule. */
const POLICIES: [table: string, own: string, rule: string][] = [
	["tenants", tenantListed("tenants"), tenantListed("tenants")],
	[
		"artists",
		artistShown("artists"),
		`${artistShown("artists")} and exists (select 1 from public.tenants t where t.id = artists.tenant_id and ${tenantListed("t")})`,
	],
	[
		"artist_work_photos",
		photoShown("artist_work_photos"),
		`${photoShown("artist_work_photos")} and exists (select 1 from public.artists a where a.id = artist_work_photos.artist_id and a.tenant_id = artist_work_photos.tenant_id and ${artistShown("a")})`,
	],
];

/**
 * What the role may read. Public columns, plus the ones the rules above
 * read. Never contact details, deposit settings, members, the artist's
 * login, the takedown note or anything about clients and money.
 */
const COLUMN_GRANTS: Record<string, string[]> = {
	tenants: [
		"id",
		"type",
		"name",
		"slug",
		"intro",
		"timezone",
		"place_id",
		"cover_image_key",
		"cover_image_width",
		"cover_image_height",
		"logo_image_key",
		"logo_image_width",
		"logo_image_height",
		"logo_tile",
		"logo_icon_key",
		"instagram_url",
		"facebook_url",
		"tiktok_url",
		"website_url",
		"discovery_listed",
		"discovery_listed_at",
		"discovery_suspended_at",
		"deleted_at",
	],
	artists: [
		"id",
		"tenant_id",
		"name",
		"slug",
		"bio",
		"photo_key",
		"photo_width",
		"photo_height",
		"styles",
		"accepting_inquiries",
		"accepting_flash",
		"instagram_url",
		"facebook_url",
		"tiktok_url",
		"visible",
		"discovery_listed",
		"deleted_at",
		"created_at",
	],
	artist_work_photos: [
		"id",
		"tenant_id",
		"artist_id",
		"image_key",
		"width",
		"height",
		"alt",
		"styles",
		"healed",
		"hidden",
		"discovery_suspended_at",
		"created_at",
	],
	// Only because tenants_select (a policy for every role) reads it; the
	// restrictive policy below lets the role see no membership at all.
	tenant_memberships: ["tenant_id", "user_id", "deleted_at"],
};

const VIEWS = ["studios", "artists", "artworks"];

export default class extends BaseSchema {
	async up() {
		// The app role (DB_USER, created by setup_roles.sql) as an SQL identifier.
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;

		// setup_roles.sql makes the role (roles are infrastructure, not
		// migrations). Refuse to go on without it, or with powers it must not
		// have: the views would then read as a role RLS does not bind.
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
		this.schema.raw(
			`create policy discovery_none on public.tenant_memberships as restrictive for select to ${ROLE} using (false)`,
		);

		this.schema.raw("create schema discovery");
		this.schema.raw("revoke all on schema discovery from public");

		// A listed business: a studio or an independent artist (`type`).
		this.schema.raw(`create view discovery.studios as
select t.id, t.slug, t.type, t.name, t.intro, t.timezone, t.place_id,
       t.cover_image_key, t.cover_image_width, t.cover_image_height,
       t.logo_image_key, t.logo_image_width, t.logo_image_height,
       t.logo_tile, t.logo_icon_key,
       t.instagram_url, t.facebook_url, t.tiktok_url, t.website_url,
       t.discovery_listed_at as listed_at
from public.tenants t
where ${tenantListed("t")}`);

		// One artist's profile at one listed business (an affiliation; slugs are
		// unique per studio only).
		this.schema.raw(`create view discovery.artists as
select a.id, a.tenant_id as studio_id, a.slug, a.name, a.bio,
       a.photo_key, a.photo_width, a.photo_height, a.styles,
       a.accepting_inquiries, a.accepting_flash,
       a.instagram_url, a.facebook_url, a.tiktok_url, a.created_at
from public.artists a
join public.tenants t on t.id = a.tenant_id
where ${artistShown("a")} and ${tenantListed("t")}`);

		// A published photo of a shown artist at a listed business.
		this.schema.raw(`create view discovery.artworks as
select p.id, p.tenant_id as studio_id, p.artist_id, p.image_key, p.width, p.height,
       p.alt, p.styles, p.healed, p.created_at
from public.artist_work_photos p
join public.artists a on a.id = p.artist_id and a.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
where ${photoShown("p")} and ${artistShown("a")} and ${tenantListed("t")}`);

		// The new owner needs CREATE on the schema to take a view over; it is
		// taken back at once, so the role creates nothing later.
		this.schema.raw(`grant create on schema discovery to ${ROLE}`);
		for (const view of VIEWS) {
			this.schema.raw(`alter view discovery.${view} owner to ${ROLE}`);
		}
		this.schema.raw(`revoke create on schema discovery from ${ROLE}`);

		this.schema.raw(`grant usage on schema discovery to ${appRole}`);
		for (const view of VIEWS) {
			this.schema.raw(`revoke all on discovery.${view} from public`);
			this.schema.raw(`grant select on discovery.${view} to ${appRole}`);
		}

		// Places are platform data: the app reads them; only migrations change
		// them (the default privileges granted it writes too).
		this.schema.raw(
			`revoke insert, update, delete, truncate on public.places from ${appRole}`,
		);

		// The orders Discover pages by, newest first or by name, each with the id
		// as tie-breaker, and the city filter (docs/discover/database-security.md,
		// "Search"). Partial: only rows Discover can show.
		this.schema.raw(
			"create index tenants_discovery_place on tenants (place_id) where discovery_listed and discovery_suspended_at is null and deleted_at is null",
		);
		this.schema.raw(
			"create index tenants_discovery_listed on tenants (discovery_listed_at desc, id desc) where discovery_listed and discovery_suspended_at is null and deleted_at is null",
		);
		this.schema.raw(
			"create index artists_discovery_name on artists (lower(name), id) where visible and discovery_listed and deleted_at is null",
		);
		this.schema.raw(
			"create index artist_work_photos_discovery_newest on artist_work_photos (created_at desc, id desc) where not hidden and discovery_suspended_at is null",
		);
	}

	async down() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		for (const index of [
			"artist_work_photos_discovery_newest",
			"artists_discovery_name",
			"tenants_discovery_listed",
			"tenants_discovery_place",
		]) {
			this.schema.raw(`drop index ${index}`);
		}
		this.schema.raw(
			`grant insert, update, delete on public.places to ${appRole}`,
		);
		for (const view of [...VIEWS].reverse()) {
			this.schema.raw(`drop view discovery.${view}`);
		}
		this.schema.raw("drop schema discovery");
		this.schema.raw("drop policy discovery_none on public.tenant_memberships");
		for (const table of ["artist_work_photos", "artists", "tenants"]) {
			this.schema.raw(`drop policy discovery_only on public.${table}`);
			this.schema.raw(`drop policy discovery_select on public.${table}`);
		}
		for (const table of Object.keys(COLUMN_GRANTS)) {
			this.schema.raw(`revoke all on public.${table} from ${ROLE}`);
		}
		// The role itself stays (setup_roles.sql made it; it is cluster-wide and
		// now holds nothing in this database).
	}
}
