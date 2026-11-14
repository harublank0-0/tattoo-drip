import type { DesignLabProvider } from "#services/design_lab_settings";

/**
 * What the Design Lab tells a member before their first generation
 * (docs/design-lab.md, Privacy and provider terms). One place, so the words
 * change together. The BFL wording follows BFL's FLUX API Service Terms and
 * FLUX Usage Policy as revised on 4 August 2026, checked against
 * https://bfl.ai/legal/flux-api-service-terms and
 * https://bfl.ai/legal/usage-policy: BFL takes a perpetual licence to inputs
 * and outputs, including to train its models (section 2b); developers must
 * screen inputs (section 5) and give end users rules at least as strict as
 * the usage policy (section 7). Review it whenever those pages change.
 */
export type ProviderNotice = {
	title: string;
	points: string[];
	acknowledgement: string;
	/** The provider's usage policy, which members agree to follow; null for the local preview. */
	policyUrl: string | null;
};

export const BFL_USAGE_POLICY_URL = "https://bfl.ai/legal/usage-policy";

const ALWAYS = [
	"Results are AI concepts for you to review and redraw, not finished stencils or designs ready to tattoo. They may not be unique: a concept can resemble existing work.",
	"TattooDrip sends only your concept text and the options you pick. Client names, contact details, booking notes and photos are never sent.",
	"Don't describe a real, identifiable person without their consent, never describe a minor in a sexual or harmful way, and leave out personal details.",
	"Don't ask for another artist's design, a brand's logo or a copyrighted character: concepts must not infringe anyone's rights.",
	"Concepts stay private to your studio unless you share them yourself.",
];

export function providerNotice(provider: DesignLabProvider): ProviderNotice {
	if (provider === "bfl") {
		return {
			title: "How generation works",
			points: [
				"Requests are processed by Black Forest Labs (BFL), the company behind FLUX, which makes the image from your description.",
				"Under BFL's terms, BFL may keep and use what you send and the images it returns, including to train and improve its models. Don't send anything you aren't willing to share with BFL.",
				"BFL's safety filters refuse requests and images that break its usage policy; TattooDrip also refuses clearly prohibited requests before sending them.",
				...ALWAYS,
			],
			acknowledgement:
				"I understand BFL processes and may use my requests and results, and I'll follow BFL's usage policy: no personal details, no real people without consent, nothing harmful involving minors, and no copied designs.",
			policyUrl: BFL_USAGE_POLICY_URL,
		};
	}
	return {
		title: "How generation works",
		points: [
			"Local preview: this server draws a placeholder image instead of calling an image service, so nothing leaves TattooDrip.",
			...ALWAYS,
		],
		acknowledgement:
			"I understand results are AI concepts for my review, and I won't include personal details, real people without consent, harmful content involving minors, or copied designs.",
		policyUrl: null,
	};
}
