import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Discover lists tattoos, not angles: `discovery.artworks` keeps only lead
 * photos (`lead_photo_id is null`, migration 1791900000000), so a tattoo
 * shown with several photos is one artwork there, its lead, as on the
 * studio's own gallery. Discover shows the lead only for now; its angles
 * reach nobody through the view.
 *
 * The view is replaced in place (`create or replace view`, with the same
 * columns in the same order), which keeps everything the original migration
 * (1791870000001_create_discovery_views) set on it: its owner stays
 * tattoo_drip_discovery, it stays neither security_invoker nor
 * security_barrier, the app role keeps SELECT and PUBLIC keeps nothing. Only
 * a superuser or the owner may replace a view, and migrations run as the
 * superuser (docs/discover/database-security.md, "Setup"). The view reads
 * the new column as its owner, so the role gets column-level SELECT on
 * `lead_photo_id` and nothing else: which photo leads a tattoo is as public
 * as the photos themselves. The policies are unchanged: they say which rows
 * may never leak, and an angle of a published tattoo is published.
 *
 * `down()` puts the original definition back and takes the column grant
 * away, in that order (the view must stop reading the column first).
 */
const ROLE = "tattoo_drip_discovery";

/** A listed tenant: opted in with the terms, not taken down, not deleted (the original's rule). */
const tenantListed = (t: string) =>
	`${t}.discovery_listed and ${t}.discovery_listed_at is not null and ${t}.discovery_suspended_at is null and ${t}.deleted_at is null`;

/** A shown artist's own flags (the original's rule). */
const artistShown = (a: string) =>
	`${a}.visible and ${a}.discovery_listed and ${a}.deleted_at is null`;

/** A shown photo's own flags (the original's rule). */
const photoShown = (p: string) =>
	`not ${p}.hidden and ${p}.discovery_suspended_at is null`;

/** The view, with or without the lead rule; the columns never change. */
const artworks = (
	leadsOnly: boolean,
) => `create or replace view discovery.artworks as
select p.id, p.tenant_id as studio_id, p.artist_id, p.image_key, p.width, p.height,
       p.alt, p.styles, p.healed, p.created_at
from public.artist_work_photos p
join public.artists a on a.id = p.artist_id and a.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
where ${photoShown("p")}${leadsOnly ? " and p.lead_photo_id is null" : ""} and ${artistShown("a")} and ${tenantListed("t")}`;

export default class extends BaseSchema {
	async up() {
		this.schema.raw(
			`grant select (lead_photo_id) on public.artist_work_photos to ${ROLE}`,
		);
		this.schema.raw(artworks(true));
	}

	async down() {
		this.schema.raw(artworks(false));
		this.schema.raw(
			`revoke select (lead_photo_id) on public.artist_work_photos from ${ROLE}`,
		);
	}
}
