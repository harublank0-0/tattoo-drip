/**
 * The words and small rules of the flash tray on the artist form (TAT-129).
 * Plain TypeScript with no imports, so a unit test loads it
 * (tests/unit/inertia/flash_copy.spec.ts); the components only lay them out.
 */

/** The most flash designs an artist offers. The server holds the same limit (FlashService counts under the artist's lock). */
export const MAX_FLASH_DESIGNS = 100;

/**
 * One flash design as the artist's edit page lists it: the price in whole
 * rupees for the form (`price`) and as words (`priceText`), and the picture's
 * 320 px copy.
 */
export type FlashDesignProps = {
	id: string;
	name: string;
	size: string;
	price: number | null;
	priceText: string | null;
	hidden: boolean;
	/** The studio will tattoo it only once (part 4b). */
	oneOfAKind: boolean;
	/** Someone has claimed it, by a project or by hand. */
	claimed: boolean;
	thumbnailUrl: string;
};

/**
 * The flash design a request or a project names, as the inquiry page and the
 * project page get it (the dashboard's copy of the server's FlashCardProps):
 * the 320 px picture and the widest copy a tap opens.
 */
export type FlashCardProps = {
	name: string;
	artistName: string | null;
	size: string;
	priceText: string | null;
	thumbnailUrl: string;
	imageUrl: string;
	hidden: boolean;
};

/** The line under a card's name: the artist, the size and the price, whichever it has. */
export function flashCardLine(card: {
	artistName: string | null;
	size: string;
	priceText: string | null;
}): string {
	return [
		card.artistName ? `By ${card.artistName}` : null,
		card.size,
		card.priceText,
	]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/** Shown on the card while the studio has taken the design off its page. */
export const FLASH_CARD_HIDDEN = "Hidden from the studio page.";

/** The inbox row's label for the design a request asks for. */
export function flashRowLabel(name: string): string {
	return `Flash: ${name}`;
}

/** How many designs the artist offers, out of the most there is room for. */
export function flashCount(count: number): string {
	return `${count} of ${MAX_FLASH_DESIGNS} designs`;
}

/** Under the Flash heading: an owner's page speaks about "this artist", an artist's about "you". */
export function flashIntro(owner: boolean): string {
	return `Flash designs ${owner ? "this artist offers" : "you offer"}. Clients see them on the studio page, newest first, and can ask for one.`;
}

export const FLASH_CREATE_NOTE =
	"Once the artist is saved, you can add their flash designs here.";

export const FLASH_FULL = `That's ${MAX_FLASH_DESIGNS} designs, the most an artist can show. Remove one to add another.`;

export const NO_FLASH = "No flash designs yet.";

export const REMOVE_FLASH_QUESTION =
	"Remove this design? Clients won't see it any more, and it can't be brought back.";

export const REMOVE_FLASH_CONFIRM = "Remove design";

export const REMOVE_FLASH_KEEP = "Keep the design";

/**
 * The line under a design's name: its size, its price if it has one, whether
 * it is one of a kind and claimed, and whether it is hidden. The one-of-a-kind
 * fields are optional so earlier calls stand.
 */
export function designNote(design: {
	size: string;
	priceText: string | null;
	hidden: boolean;
	oneOfAKind?: boolean;
	claimed?: boolean;
}): string {
	return [
		design.size,
		design.priceText,
		design.oneOfAKind ? "One of a kind" : null,
		design.claimed ? "Claimed" : null,
		design.hidden ? "Hidden" : null,
	]
		.filter((part): part is string => part !== null)
		.join(" · ");
}

/** A design's buttons share their words on the page, so each names its design for a screen reader. */
export function editDesignLabel(name: string): string {
	return `Edit ${name}`;
}

export function removeDesignLabel(name: string): string {
	return `Remove ${name}`;
}

/** The artist form's switch (next to "Accepting new inquiries"). */
export const FLASH_OPEN_LABEL = "Taking flash requests";

export const FLASH_OPEN_HELP =
	"Clients can ask for this artist's flash designs, even while the books are closed.";

export const PICTURE_LABEL = "Picture";

export const NAME_HELP = "Up to 80 characters.";

export const SIZE_HELP = "In words, as you'd say it to a client.";

export const PRICE_LABEL = "Price (optional)";

export const PRICE_HELP =
	"In whole rupees. Leave it empty to agree the price with each client.";

export const SHOWN_LABEL = "Show on the studio page";

export const SHOWN_HELP =
	"Uncheck to take it off the studio page for now. Requests already sent keep it.";

/** Under the edit sheet's title. */
export const FLASH_SHEET_HELP =
	"Change the words or the price, or take it off the studio page. The picture stays: add a new design for a new picture.";

/** The add form's and the sheet's box: a design the studio will tattoo only once. */
export const ONE_OF_A_KIND_LABEL = "One of a kind";

export const ONE_OF_A_KIND_HELP =
	"You'll tattoo it only once. It's marked Claimed when its client's deposit is verified or their project is booked. Leave it unchecked for a design that can be tattooed again.";

/** A one-of-a-kind row's one button: mark it claimed by hand, or make it available again. */
export const MARK_CLAIMED = "Mark claimed";

export const MAKE_AVAILABLE = "Make available";

/** The claim button names its design for a screen reader, like Edit and Remove. */
export function claimDesignLabel(name: string, claimed: boolean): string {
	return `${claimed ? MAKE_AVAILABLE : MARK_CLAIMED}: ${name}`;
}
