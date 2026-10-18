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
