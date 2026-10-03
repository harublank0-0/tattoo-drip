export type AvailabilityStatus = "available" | "limited" | "packed" | "closed";

export interface Artist {
	id: string;
	name: string;
	studio: string;
	location: string;
	instagram: string;
	instagramUrl: string;
	email: string;
	portrait: string;
	heroImage: string;
	availability: AvailabilityStatus;
	availabilityDetails: string;
	bookingWindow: {
		opensAt: string;
		closesAt: string | null;
	};
	statement: string;
	biography: string[];
}

export const artist: Artist = {
	id: "suraj-rana",
	name: "Suraj Rana",
	studio: "SANGI TATTOO STUDIO",
	location: "Kathmandu, Nepal",
	instagram: "@surajtattoo",
	instagramUrl: "https://www.instagram.com/surajtattoo/",
	email: "hello@surajtattoo.example",
	portrait: "/images/tattoos/tattoo-header.jpg",
	heroImage: "/images/tattoos/hero.jpg",
	availability: "limited",
	availabilityDetails: "3 slots left for October",
	bookingWindow: { opensAt: "2026-10-01", closesAt: "2026-12-31" },
	statement:
		"Custom tattoo work rooted in bold linework, detail, and personal storytelling.",
	biography: [
		"My work focuses on strong composition, expressive linework, and designs that feel personal to the person wearing them.",
		"Whether you arrive with a fully formed idea or only the beginning of one, we'll build the piece together.",
		"I grew up sketching the carved windows, temple details, and everyday rhythms of Kathmandu. Those early studies still shape the way I think about balance, pattern, and the space a line leaves behind.",
		"Today, I work from a quiet, appointment-only studio. Every session starts with time to talk, refine the drawing, and find a placement that moves naturally with your body. Thoughtful work takes time, and I'm happy to give it that.",
	],
};

export const specialties = [
	{
		name: "Blackwork",
		description:
			"Confident lines, considered negative space, and rich black ink. Graphic pieces designed to hold their presence as they age.",
	},
	{
		name: "Fine Line",
		description:
			"Delicate botanical studies, small symbols, and precise details. Quiet work with a considered approach to scale and placement.",
	},
	{
		name: "Ornamental",
		description:
			"Rhythmic patterns and flowing symmetry, drawn to follow the body. Inspired by the architectural details of Kathmandu.",
	},
	{
		name: "Custom",
		description:
			"An original piece built around your story. Bring sketches, references, or simply a feeling, and we’ll find its form together.",
	},
	{
		name: "Japanese",
		description:
			"Tigers, serpents, and botanicals with a focus on movement. Traditional visual themes interpreted through my own linework.",
	},
] as const;

export function bookingEmailHref(subject = "Custom tattoo enquiry") {
	const body =
		"Hi Suraj,\n\nI’d like to discuss a tattoo.\n\nMy idea:\nPlacement and approximate size:\nPreferred dates:\nBudget:\n\nI’ll attach any reference images.\n\nThank you!";
	return `mailto:${artist.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
