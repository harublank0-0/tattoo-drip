import type { DesignLabProvider } from "#services/design_lab_settings";

/**
 * What the Design Lab tells a member before their first generation
 * (docs/design-lab.md, Privacy). One place, so the words change together.
 * The BFL wording summarises BFL's API terms and usage policy as TattooDrip
 * understood them when this was written; review it against the current
 * terms (https://bfl.ai/legal/flux-api-service-terms) before launch and
 * whenever they change.
 */
export type ProviderNotice = {
	title: string;
	points: string[];
	acknowledgement: string;
};

const ALWAYS = [
	"Results are AI concepts for you to review and redraw, not finished stencils or designs ready to tattoo.",
	"TattooDrip sends only your concept text and the options you pick. Client names, contact details, booking notes and photos are never sent.",
	"Don't describe a real, identifiable person without their consent, never describe a minor, and leave out personal details.",
	"Concepts stay private to your studio unless you share them yourself.",
];

export function providerNotice(provider: DesignLabProvider): ProviderNotice {
	if (provider === "bfl") {
		return {
			title: "How generation works",
			points: [
				"Requests are processed by Black Forest Labs (BFL), the company behind FLUX, which makes the image from your description.",
				"BFL handles what you send and the images it returns under its API terms and usage policy, and may keep them for a limited time to run and safeguard its service. Requests that break its usage policy are refused by its safety filters.",
				...ALWAYS,
			],
			acknowledgement:
				"I understand my requests are processed by BFL, and I won't include personal details, real people without consent, or minors.",
		};
	}
	return {
		title: "How generation works",
		points: [
			"Local preview: this server draws a placeholder image instead of calling an image service, so nothing leaves TattooDrip.",
			...ALWAYS,
		],
		acknowledgement:
			"I understand results are AI concepts for my review, and I won't include personal details, real people without consent, or minors.",
	};
}
