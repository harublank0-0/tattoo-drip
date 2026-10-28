import type ReferenceImage from "#modules/inquiries/models/reference_image";
import type ImageService from "#modules/media/services/image_service";
import { THUMBNAIL_WIDTH } from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * A reference image as the dashboard's grids get it (TAT-112): `url` opens
 * the full image, `thumbnailUrl` is what the grid shows, the 320 px copy (or
 * the image itself when it has none). Both are signed for 5 minutes and
 * `no-store`. Load the image tenant- and member-scoped first: that load is
 * the access check. The inquiry, project and client pages share this, so
 * they cannot drift.
 */
export async function referenceView(
	images: ImageService,
	tenant: Pick<Tenant, "id">,
	image: Pick<ReferenceImage, "id" | "imageKey" | "width" | "height">,
) {
	return {
		id: image.id,
		url: await images.url("reference_image", image.imageKey, tenant),
		thumbnailUrl: await images.urlFor(
			"reference_image",
			image.imageKey,
			tenant,
			THUMBNAIL_WIDTH,
		),
		width: image.width,
		height: image.height,
	};
}
