import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Discover never shows video (video angles, 1791910000000). `discovery.artworks`
 * already lists leads only, and a video is always an angle, so it is never an
 * artwork. `discovery.artwork_angles` maps a tattoo's other photos to it for
 * the artwork lookup: it now maps photos only (`kind = 'photo'`), so a
 * video's id never resolves on Discover either.
 *
 * Like 1791900000001: `create or replace view` with the same columns, so the
 * view keeps its owner (tattoo_drip_discovery), its options and its grants;
 * the role reads the new column as the view's owner, so it gets column-level
 * SELECT on `kind` and nothing else. Only a superuser or the owner may
 * replace the view (docs/discover/database-security.md, "Setup").
 *
 * `down()` puts the previous definition back, then takes the grant away.
 */
const ROLE = "tattoo_drip_discovery";

/** The original's rules (1791870000001), repeated in each view's WHERE. */
const tenantListed = (t: string) =>
	`${t}.discovery_listed and ${t}.discovery_listed_at is not null and ${t}.discovery_suspended_at is null and ${t}.deleted_at is null`;
const artistShown = (a: string) =>
	`${a}.visible and ${a}.discovery_listed and ${a}.deleted_at is null`;
const photoShown = (p: string) =>
	`not ${p}.hidden and ${p}.discovery_suspended_at is null`;

const artworkAngles = (
	photosOnly: boolean,
) => `create or replace view discovery.artwork_angles as
select p.id, p.lead_photo_id as artwork_id
from public.artist_work_photos p
join public.artists a on a.id = p.artist_id and a.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
where p.lead_photo_id is not null${photosOnly ? " and p.kind = 'photo'" : ""} and ${photoShown("p")} and ${artistShown("a")} and ${tenantListed("t")}`;

export default class extends BaseSchema {
	async up() {
		this.schema.raw(
			`grant select (kind) on public.artist_work_photos to ${ROLE}`,
		);
		this.schema.raw(artworkAngles(true));
	}

	async down() {
		this.schema.raw(artworkAngles(false));
		this.schema.raw(
			`revoke select (kind) on public.artist_work_photos from ${ROLE}`,
		);
	}
}
