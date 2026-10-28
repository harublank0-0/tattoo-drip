import { randomUUID } from "node:crypto";
import type Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService, {
	type ArtistInput,
	type Member,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { inTenant } from "#tests/helpers/tenants";

/** A valid ArtistService input: a visible profile named Sita Rai that takes inquiries. */
export const artistInput = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

/** Adds a profile to `tenant` through ArtistService, as its owner does in the dashboard. */
export function addArtist(
	tenant: Tenant,
	owner: Member,
	over: Partial<ArtistInput> = {},
) {
	return inTenant(tenant, () =>
		new ArtistService(new ImageService()).create(
			tenant,
			artistInput(over),
			owner,
		),
	);
}

/**
 * A work photo row for `artist` with a made-up key and no file (the drive
 * ignores a delete of a missing file), at `position` or the next free one
 * (TAT-116). Call it inside the tenant's context, as the model needs.
 */
export async function addWorkPhoto(
	tenant: Pick<Tenant, "id">,
	artist: Pick<Artist, "id">,
	over: Partial<{
		position: number;
		alt: string | null;
		key: string;
		width: number;
		height: number;
	}> = {},
) {
	const position =
		over.position ??
		Number(
			(
				await ArtistWorkPhoto.query()
					.where("tenant_id", tenant.id)
					.where("artist_id", artist.id)
					.count("* as total")
			)[0].$extras.total,
		);
	return ArtistWorkPhoto.create({
		tenantId: tenant.id,
		artistId: artist.id,
		imageKey:
			over.key ??
			`tenants/${tenant.id}/artist_work_photo/${randomUUID()}.320-640-1280.jpg`,
		width: over.width ?? 2048,
		height: over.height ?? 1536,
		position,
		alt: over.alt ?? null,
	});
}
