import { randomUUID } from "node:crypto";
import type { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService, {
	type ArtistInput,
	type Member,
} from "#modules/artists/services/artist_service";
import FlashDesign from "#modules/flash/models/flash_design";
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
	acceptingFlash: true,
	closedMessage: null,
	linkToMe: false,
	styles: [],
	instagramUrl: null,
	facebookUrl: null,
	tiktokUrl: null,
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
 * ignores a delete of a missing file). It is dated now unless `createdAt`
 * says otherwise: photos are listed newest first (TAT-126). Call it inside
 * the tenant's context, as the model needs.
 */
export async function addWorkPhoto(
	tenant: Pick<Tenant, "id">,
	artist: Pick<Artist, "id">,
	over: Partial<{
		alt: string | null;
		key: string;
		width: number;
		height: number;
		styles: string[];
		healed: boolean;
		createdAt: DateTime;
	}> = {},
) {
	return ArtistWorkPhoto.create({
		tenantId: tenant.id,
		artistId: artist.id,
		imageKey:
			over.key ??
			`tenants/${tenant.id}/artist_work_photo/${randomUUID()}.320-640-1280.jpg`,
		width: over.width ?? 2048,
		height: over.height ?? 1536,
		alt: over.alt ?? null,
		styles: over.styles ?? [],
		healed: over.healed ?? false,
		// Left out, the model dates it now.
		...(over.createdAt ? { createdAt: over.createdAt } : {}),
	});
}

/**
 * A flash design row for `artist` with a made-up key and no file (the drive
 * ignores a delete of a missing file), shown, 1200 x 1200, dated now unless
 * `createdAt` says otherwise: designs are listed newest first (TAT-129).
 * `price` is in paisa. Call it inside the tenant's context, as the model needs.
 */
export async function addFlashDesign(
	tenant: Pick<Tenant, "id">,
	artist: Pick<Artist, "id">,
	over: Partial<{
		name: string;
		size: string;
		price: number | null;
		hidden: boolean;
		key: string;
		createdAt: DateTime;
	}> = {},
) {
	return FlashDesign.create({
		tenantId: tenant.id,
		artistId: artist.id,
		imageKey:
			over.key ??
			`tenants/${tenant.id}/flash_design/${randomUUID()}.320-640-1280.png`,
		width: 1200,
		height: 1200,
		name: over.name ?? "Moth",
		size: over.size ?? "About 3 in",
		price: over.price ?? null,
		hidden: over.hidden ?? false,
		// Left out, the model dates it now.
		...(over.createdAt ? { createdAt: over.createdAt } : {}),
	});
}
