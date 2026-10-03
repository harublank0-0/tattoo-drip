export interface FlashPiece {
	id: string;
	title: string;
	price: number;
	currency: "USD";
	available: boolean;
	image: string;
	size: string;
	description: string;
}

export const flash: FlashPiece[] = [
	{
		id: "moon-serpent",
		title: "Moon Serpent",
		price: 180,
		currency: "USD",
		available: true,
		image: "/images/flash/moon-serpent.svg",
		size: "12–15 cm",
		description:
			"A winding serpent beneath a crescent moon. Suited to a forearm or calf, with room for its curves to breathe.",
	},
	{
		id: "moth",
		title: "Moth",
		price: 150,
		currency: "USD",
		available: true,
		image: "/images/flash/moth.svg",
		size: "10–12 cm",
		description:
			"A nocturnal study in symmetry. Fine wing details and dark accents, designed for an upper arm or just below the collarbone.",
	},
	{
		id: "sacred-heart",
		title: "Sacred Heart",
		price: 200,
		currency: "USD",
		available: true,
		image: "/images/flash/sacred-heart.svg",
		size: "12–16 cm",
		description:
			"An enduring symbol, drawn with a thorned stem and a small flame. Bold enough to stand alone on the arm or thigh.",
	},
	{
		id: "black-swan",
		title: "Black Swan",
		price: 175,
		currency: "USD",
		available: true,
		image: "/images/flash/black-swan.svg",
		size: "10–14 cm",
		description:
			"A curved neck and layered black feathers. A quiet, flowing design for the arm, ankle, or side of the leg.",
	},
];

export function formatFlashPrice(piece: FlashPiece) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: piece.currency,
		maximumFractionDigits: 0,
	}).format(piece.price);
}
