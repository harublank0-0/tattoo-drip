import { type ClaimState, claimStateOf } from "#modules/flash/claims";
import type FlashDesign from "#modules/flash/models/flash_design";
import type ImageService from "#modules/media/services/image_service";
import { THUMBNAIL_WIDTH } from "#modules/media/services/image_service";
import { formatMoney } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";

/** The widest copy a design card opens: what a tap shows. */
const LARGE_WIDTH = 1280;

/**
 * A flash design as the inquiry page and the project page show it (TAT-129):
 * the design a client asked for, with its picture, its words and whether the
 * studio has hidden it since. Never the row.
 */
export type FlashCardProps = {
	name: string;
	/** The design's artist, if still on the list of artists. */
	artistName: string | null;
	size: string;
	priceText: string | null;
	/** The 320 px copy. */
	thumbnailUrl: string;
	/** The widest copy (up to 1280 px), which a tap opens. */
	imageUrl: string;
	/** The studio took it off its page since; a request that names it still shows it. */
	hidden: boolean;
	/** One of a kind: the studio will tattoo it only once. */
	oneOfAKind: boolean;
	/**
	 * What the claim means for this request or project (claimStateOf): `here`
	 * when this project claimed the design, `taken` when anything else did
	 * and this record is still open ("Design taken: offer something
	 * similar"), else `none`.
	 */
	claim: ClaimState;
};

/**
 * The card for `design`: the picture's two addresses and the price as words.
 * `at` is the record the card is for: an inquiry (`projectId` null, `open`
 * while it is `new`) or a project (its id, `open` while it is not closed).
 */
export async function flashCard(
	images: ImageService,
	tenant: Pick<Tenant, "id">,
	design: FlashDesign,
	artistName: string | null,
	at: { projectId: string | null; open: boolean },
): Promise<FlashCardProps> {
	return {
		name: design.name,
		artistName,
		size: design.size,
		priceText: design.price === null ? null : formatMoney(design.price),
		thumbnailUrl: await images.urlFor(
			"flash_design",
			design.imageKey,
			tenant,
			THUMBNAIL_WIDTH,
		),
		imageUrl: await images.urlFor(
			"flash_design",
			design.imageKey,
			tenant,
			LARGE_WIDTH,
		),
		hidden: design.hidden,
		oneOfAKind: design.oneOfAKind,
		claim: claimStateOf(design, at),
	};
}
