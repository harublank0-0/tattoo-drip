/**
 * AI Design Lab's prompt (docs/design-lab.md): the server builds every
 * provider prompt from validated structured inputs and the versioned
 * template below. The browser sends choices and short texts, never a prompt.
 * Pure, so the unit tests pin the template.
 *
 * Changing the template's words: add a new version (keep the old builder so
 * stored rows still explain themselves) and bump PROMPT_VERSION.
 */

export const PROMPT_VERSION = "tattoo-concept-v1";

export const STYLE_PRESETS = {
	fine_line: {
		label: "Fine line",
		phrase: "fine line tattoo style, delicate single-needle linework",
	},
	blackwork: {
		label: "Blackwork",
		phrase:
			"blackwork tattoo style, bold solid black fills and strong contrast",
	},
	traditional: {
		label: "Traditional",
		phrase:
			"American traditional tattoo style, bold outlines and a limited classic palette",
	},
	japanese: {
		label: "Japanese",
		phrase:
			"Japanese irezumi-inspired tattoo style, flowing composition and bold outlines",
	},
	realism: {
		label: "Realism",
		phrase: "realism tattoo style, smooth shading and soft gradients",
	},
	geometric: {
		label: "Geometric",
		phrase: "geometric tattoo style, precise lines, symmetry and shapes",
	},
	watercolor: {
		label: "Watercolor",
		phrase:
			"watercolor tattoo style, soft washes with a defined line structure",
	},
	lettering: {
		label: "Lettering",
		phrase: "tattoo lettering design, custom hand-drawn script",
	},
	custom: { label: "Custom", phrase: "" },
} as const;
export type StyleKey = keyof typeof STYLE_PRESETS;
export const STYLE_KEYS = Object.keys(STYLE_PRESETS) as StyleKey[];

export const PALETTES = {
	black_grey: { label: "Black and grey", phrase: "black and grey ink only" },
	color: { label: "Color", phrase: "full color ink" },
} as const;
export type PaletteKey = keyof typeof PALETTES;
export const PALETTE_KEYS = Object.keys(PALETTES) as PaletteKey[];

/**
 * Orientation picks the image size. Both sides are multiples of 32 and at
 * most 1440, which the hosted FLUX text-to-image models accept; about one
 * megapixel each, so the provider's per-image price stays at its base tier.
 */
export const ORIENTATIONS = {
	portrait: {
		label: "Portrait",
		phrase: "vertical composition",
		width: 832,
		height: 1216,
		aspectRatio: "2:3",
	},
	landscape: {
		label: "Landscape",
		phrase: "horizontal composition",
		width: 1216,
		height: 832,
		aspectRatio: "3:2",
	},
	square: {
		label: "Square",
		phrase: "balanced square composition",
		width: 1024,
		height: 1024,
		aspectRatio: "1:1",
	},
	round: {
		label: "Round",
		phrase: "circular composition that fits inside a round frame",
		width: 1024,
		height: 1024,
		aspectRatio: "1:1",
	},
} as const;
export type OrientationKey = keyof typeof ORIENTATIONS;
export const ORIENTATION_KEYS = Object.keys(ORIENTATIONS) as OrientationKey[];

export const DETAIL_LEVELS = {
	minimal: { label: "Minimal", phrase: "minimal detail, few clean lines" },
	balanced: { label: "Balanced", phrase: "moderate detail" },
	intricate: {
		label: "Intricate",
		phrase: "intricate detail that stays readable at tattoo size",
	},
} as const;
export type DetailKey = keyof typeof DETAIL_LEVELS;
export const DETAIL_KEYS = Object.keys(DETAIL_LEVELS) as DetailKey[];

/**
 * The intended placement shapes the proportions only: the prompt never asks
 * for a body, skin or a mockup.
 */
export const BODY_AREAS = {
	any: { label: "Not decided", phrase: "" },
	forearm: { label: "Forearm", phrase: "a long, narrow forearm placement" },
	upper_arm: { label: "Upper arm", phrase: "an upper arm placement" },
	shoulder: { label: "Shoulder", phrase: "a rounded shoulder placement" },
	chest: { label: "Chest", phrase: "a wide chest placement" },
	back: { label: "Back", phrase: "a large back placement" },
	ribs: { label: "Ribs", phrase: "a tall rib placement" },
	thigh: { label: "Thigh", phrase: "a thigh placement" },
	calf: { label: "Calf", phrase: "a calf placement" },
	hand: { label: "Hand", phrase: "a small hand placement" },
	neck: { label: "Neck", phrase: "a small neck placement" },
	ankle: { label: "Ankle", phrase: "a small ankle placement" },
	wrist: { label: "Wrist", phrase: "a small wrist placement" },
} as const;
export type BodyAreaKey = keyof typeof BODY_AREAS;
export const BODY_AREA_KEYS = Object.keys(BODY_AREAS) as BodyAreaKey[];

/** Length limits of the artist's own words. */
export const LIMITS = {
	concept: { min: 3, max: 400 },
	subject: { max: 80 },
	customStyle: { max: 80 },
	lettering: { max: 40 },
} as const;

/** The validated structured inputs: stored on the generation as they are. */
export type GenerationInputs = {
	concept: string;
	style: StyleKey;
	customStyle: string | null;
	subject: string | null;
	lettering: string | null;
	palette: PaletteKey;
	orientation: OrientationKey;
	detail: DetailKey;
	bodyArea: BodyAreaKey;
};

/**
 * Patterns refused in the artist's texts: contact details and links never
 * belong in a design prompt, and refusing them keeps a client's email,
 * phone or social handle from being pasted into a request to the provider.
 */
const PERSONAL_DATA: { pattern: RegExp; message: string }[] = [
	{
		pattern: /[^\s@]+@[^\s@]+\.[^\s@]+/,
		message:
			"Remove the email address: contact details are never sent to the image service.",
	},
	{
		pattern: /(?:https?:\/\/|www\.)\S+/i,
		message: "Remove the link: describe the idea in words instead.",
	},
	{
		// Nine or more digits: a phone number (Nepal's mobiles have ten), not a
		// date such as 12.05.2019 or a span of years such as 1990-2024.
		pattern: /(?:\+?\d[\s().-]*){9,}/,
		message:
			"Remove the phone number: contact details are never sent to the image service.",
	},
	{
		pattern: /(?:^|\s)@[A-Za-z0-9_.]{2,}/,
		message:
			"Remove the social media handle: personal details are never sent to the image service.",
	},
];

/**
 * Control, bidi and zero-width characters: refused, they only hide text.
 * ZWNJ and ZWJ (U+200C, U+200D) are allowed: Devanagari and other scripts
 * need them to join letters.
 */
const HIDDEN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to find them.
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

/**
 * The words to show when `text` must not be sent, else null. Run on every
 * free-text input after trimming.
 */
export function personalDataProblem(text: string): string | null {
	if (HIDDEN.test(text)) return "Remove hidden or control characters.";
	for (const { pattern, message } of PERSONAL_DATA) {
		if (pattern.test(text)) return message;
	}
	return null;
}

/** One line of text: newlines and runs of whitespace become one space. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A sentence fragment safe to join: no trailing full stop of its own. */
const fragment = (text: string) => oneLine(text).replace(/[.\s]+$/, "");

/**
 * The provider prompt for `inputs` under PROMPT_VERSION. Only the inputs'
 * own fields go in: the caller has nothing else to add (no client, no
 * booking, no studio), and that is on purpose.
 */
export function buildPrompt(inputs: GenerationInputs): string {
	const style =
		inputs.style === "custom"
			? fragment(inputs.customStyle ?? "custom tattoo style")
			: STYLE_PRESETS[inputs.style].phrase;
	const parts = [
		`Original tattoo design concept artwork, ${style}`,
		inputs.subject ? `Subject: ${fragment(inputs.subject)}` : null,
		`Concept: ${fragment(inputs.concept)}`,
		inputs.style === "lettering" && inputs.lettering
			? `The lettering reads exactly "${oneLine(inputs.lettering).replaceAll('"', "'")}"`
			: null,
		PALETTES[inputs.palette].phrase,
		ORIENTATIONS[inputs.orientation].phrase,
		DETAIL_LEVELS[inputs.detail].phrase,
		inputs.bodyArea !== "any"
			? `Proportioned for ${BODY_AREAS[inputs.bodyArea].phrase}, shown flat as a drawing`
			: null,
		"Isolated artwork centred on a plain white background with generous margins",
		"Clean composition with clear, legible linework and balanced negative space",
		"Presented as a flat 2D design sheet for an artist to review",
		inputs.style === "lettering"
			? "No other text, no watermark, no signature"
			: "No text, no watermark, no signature",
		"No human body, no skin, no person, no tattoo mockup, no photograph",
	];
	return `${parts.filter((part): part is string => Boolean(part)).join(". ")}.`;
}

/** The image size for `orientation`. */
export const sizeOf = (orientation: OrientationKey) => ({
	width: ORIENTATIONS[orientation].width,
	height: ORIENTATIONS[orientation].height,
	aspectRatio: ORIENTATIONS[orientation].aspectRatio,
});

/** A short human label for a generation's inputs ("Fine line · forearm"). */
export function inputsLabel(inputs: GenerationInputs): string {
	const style =
		inputs.style === "custom" && inputs.customStyle
			? oneLine(inputs.customStyle)
			: STYLE_PRESETS[inputs.style].label;
	return inputs.bodyArea === "any"
		? style
		: `${style} · ${BODY_AREAS[inputs.bodyArea].label.toLowerCase()}`;
}

/** The choices the form offers, as plain data for the page. */
export function promptChoices() {
	const list = <T extends Record<string, { label: string }>>(record: T) =>
		Object.entries(record).map(([value, { label }]) => ({ value, label }));
	return {
		styles: list(STYLE_PRESETS),
		palettes: list(PALETTES),
		orientations: list(ORIENTATIONS),
		details: list(DETAIL_LEVELS),
		bodyAreas: list(BODY_AREAS),
		limits: LIMITS,
	};
}
