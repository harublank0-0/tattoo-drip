/**
 * One flash design as the artist's edit page lists it (TAT-129): the price
 * in whole rupees for the form (`price`) and as words (`priceText`), and the
 * picture's 320 px copy.
 */
export type FlashDesignProps = {
	id: string;
	name: string;
	size: string;
	price: number | null;
	priceText: string | null;
	hidden: boolean;
	thumbnailUrl: string;
};
