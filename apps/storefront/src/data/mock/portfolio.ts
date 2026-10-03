export interface TattooProject {
	id: string;
	title: string;
	style: string;
	image: string;
	alt: string;
	placement: string;
	description: string;
	aspectRatio: string;
}

export const portfolio: TattooProject[] = [
	{
		id: "botanical-study",
		title: "Botanical Study",
		style: "Fine Line",
		image: "/images/tattoos/work-01.jpg",
		alt: "Fine-line flowers and leaves extending across an upper arm",
		placement: "Upper arm",
		description:
			"Open petals, slender stems, and delicate leaves. A botanical composition that follows the upper arm, with generous space between each line.",
		aspectRatio: "4 / 5",
	},
	{
		id: "ink-and-motion",
		title: "Ink & Motion",
		style: "Custom",
		image: "/images/tattoos/work-02.jpg",
		alt: "Abstract black and red tattoo spanning the shoulders and flowing down the back",
		placement: "Back",
		description:
			"Sweeping black lines and restrained red accents create a full-back composition. Fine details give way to expressive marks, balancing movement with open skin.",
		aspectRatio: "3 / 4",
	},
	{
		id: "abstract-figure",
		title: "Abstract Figure",
		style: "Blackwork",
		image: "/images/tattoos/work-03.jpg",
		alt: "Black-and-white close-up of a stylized figure tattoo with bold outlines and striped hair",
		placement: "Arm",
		description:
			"A small study of the human form, reduced to curved outlines and rhythmic stripes. Confident black lines give the figure its quiet, graphic presence.",
		aspectRatio: "1 / 1",
	},
	{
		id: "tiger-study",
		title: "Tiger Study",
		style: "Blackwork",
		image: "/images/tattoos/work-04.jpg",
		alt: "Close-up of a small tiger-head tattoo above another blackwork design on a leg",
		placement: "Leg",
		description:
			"A compact tiger portrait with expressive stripes and a watchful eye. An individual motif that sits naturally alongside a growing collection of tattoos.",
		aspectRatio: "1 / 1",
	},
	{
		id: "pattern-and-rhythm",
		title: "Pattern & Rhythm",
		style: "Ornamental",
		image: "/images/tattoos/work-05.jpg",
		alt: "Geometric and tribal-inspired patterns covering an arm in warm, low light",
		placement: "Arm sleeve",
		description:
			"Repeating shapes, curved bands, and layered linework form a continuous sleeve. An exploration of rhythm and contrast across the arm.",
		aspectRatio: "4 / 5",
	},
	{
		id: "serpent-and-blossom",
		title: "Serpent & Blossom",
		style: "Japanese",
		image: "/images/tattoos/work-06.jpg",
		alt: "Japanese-style arm sleeve with a teal serpent, pale blossoms, and a stylized face",
		placement: "Arm sleeve",
		description:
			"A scaled serpent winds between pale blossoms and a stylized face. Rich outlines and considered color bring movement to this Japanese-inspired sleeve.",
		aspectRatio: "3 / 4",
	},
];
