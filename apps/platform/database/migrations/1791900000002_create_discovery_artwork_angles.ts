import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * Discover's fourth view (angles): `discovery.artwork_angles`, from one of a
 * tattoo's other photos to the tattoo it belongs to (`id`, the angle's own id;
 * `artwork_id`, its lead's, a `discovery.artworks` id). Discover lists a
 * tattoo once, as its lead (1791900000001), but a photo can be made an angle
 * after Discover linked to it, or a lead can hand its place to another
 * photo: the artwork lookup resolves such an id to the tattoo, so old
 * Discover links and sitemap entries keep landing (the Discover app then
 * redirects, temporarily, since the relation can change again).
 *
 * The boundary of 1791870000001 unchanged in kind: owned by
 * tattoo_drip_discovery, not security_invoker and not security_barrier (the
 * original's reasons), so its table is read as that role under its RLS and
 * its column grants (it reads only columns the role already has: `id`,
 * `tenant_id`, `artist_id`, `lead_photo_id`, `hidden`,
 * `discovery_suspended_at`); explicit columns; its WHERE repeats the rules
 * (a published, not taken-down angle of a shown artist at a listed
 * business); the app role may SELECT it and PUBLIC nothing. It shows ids
 * only, which the public pages already carry. Like the original, taking the
 * view over for the role needs a superuser (docs/discover/database-security.md,
 * "Setup").
 */
const ROLE = "tattoo_drip_discovery";

/** The original's rules (1791870000001), repeated in each view's WHERE. */
const tenantListed = (t: string) =>
	`${t}.discovery_listed and ${t}.discovery_listed_at is not null and ${t}.discovery_suspended_at is null and ${t}.deleted_at is null`;
const artistShown = (a: string) =>
	`${a}.visible and ${a}.discovery_listed and ${a}.deleted_at is null`;
const photoShown = (p: string) =>
	`not ${p}.hidden and ${p}.discovery_suspended_at is null`;

export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		this.schema.raw(`create view discovery.artwork_angles as
select p.id, p.lead_photo_id as artwork_id
from public.artist_work_photos p
join public.artists a on a.id = p.artist_id and a.tenant_id = p.tenant_id
join public.tenants t on t.id = p.tenant_id
where p.lead_photo_id is not null and ${photoShown("p")} and ${artistShown("a")} and ${tenantListed("t")}`);
		// The original's dance: CREATE for the new owner to take the view over,
		// taken back at once.
		this.schema.raw(`grant create on schema discovery to ${ROLE}`);
		this.schema.raw(`alter view discovery.artwork_angles owner to ${ROLE}`);
		this.schema.raw(`revoke create on schema discovery from ${ROLE}`);
		this.schema.raw("revoke all on discovery.artwork_angles from public");
		this.schema.raw(`grant select on discovery.artwork_angles to ${appRole}`);
	}

	async down() {
		this.schema.raw("drop view discovery.artwork_angles");
	}
}
