import { test } from "@japa/runner";
import {
	BODY_AREA_KEYS,
	buildPrompt,
	type GenerationInputs,
	inputsLabel,
	PROMPT_VERSION,
	personalDataProblem,
	policyProblem,
	sizeOf,
} from "#modules/design_lab/prompt";
import {
	canRetry,
	FAILURE_CODES,
	FAILURE_MESSAGES,
} from "#modules/design_lab/rules";

const inputs = (
	overrides: Partial<GenerationInputs> = {},
): GenerationInputs => ({
	concept: "A koi fish swimming upward through peonies.",
	style: "japanese",
	customStyle: null,
	subject: "Koi fish",
	lettering: null,
	palette: "black_grey",
	orientation: "portrait",
	detail: "balanced",
	bodyArea: "forearm",
	...overrides,
});

test.group("Design Lab prompt", () => {
	test("v3 says only what to draw: a composition, never a body part, edge or frame", ({
		assert,
	}) => {
		assert.equal(PROMPT_VERSION, "tattoo-concept-v3");
		const prompt = buildPrompt(inputs());
		assert.equal(
			prompt,
			"A single original tattoo design, Japanese irezumi-inspired tattoo style, flowing composition and bold outlines. Subject: Koi fish. Concept: A koi fish swimming upward through peonies. black and grey ink only. vertical composition. moderate detail. Laid out as a tall, narrow vertical composition. Drawn as flat ink artwork on a plain white sheet of paper, with generous white space all around. A free-standing design whose elements fade into the open white paper, giving it an organic, irregular silhouette. Clear, legible linework and balanced negative space, presented as a design sheet for a tattoo artist to review. Purely pictorial artwork.",
		);
		// No placement, body word, enclosing shape or negative list reaches the
		// model: FLUX draws what a prompt names, even after "no".
		for (const bodyArea of BODY_AREA_KEYS) {
			const text = buildPrompt(inputs({ bodyArea }));
			assert.notMatch(
				text,
				/\b(?:body|skin|person|arm|forearm|shoulder|chest|back|ribs?|thigh|calf|hand|neck|ankle|wrist|limb|mockup|photo\w*|stencil|no|edges?|frame\w*|borders?|taper\w*|shaped)\b/i,
				bodyArea,
			);
		}
	});

	test("v2 stays reproducible for the generations made with it", ({
		assert,
	}) => {
		assert.equal(
			buildPrompt(inputs(), "tattoo-concept-v2"),
			"A single original tattoo design, Japanese irezumi-inspired tattoo style, flowing composition and bold outlines. Subject: Koi fish. Concept: A koi fish swimming upward through peonies. black and grey ink only. vertical composition. moderate detail. Shaped as a tall, narrow vertical design that tapers gently, with open, natural edges. Drawn as flat ink artwork on a plain white sheet of paper, centred with generous white margins on every side. The design's own linework forms its outer edge, with clear, legible lines and balanced negative space. Presented as a clean design sheet for a tattoo artist to review. Purely pictorial artwork.",
		);
	});

	test("v1 stays reproducible for the generations made with it", ({
		assert,
	}) => {
		assert.equal(
			buildPrompt(inputs(), "tattoo-concept-v1"),
			"Original tattoo design concept artwork, Japanese irezumi-inspired tattoo style, flowing composition and bold outlines. Subject: Koi fish. Concept: A koi fish swimming upward through peonies. black and grey ink only. vertical composition. moderate detail. Proportioned for a long, narrow forearm placement, shown flat as a drawing. Isolated artwork centred on a plain white background with generous margins. Clean composition with clear, legible linework and balanced negative space. Presented as a flat 2D design sheet for an artist to review. No text, no watermark, no signature. No human body, no skin, no person, no tattoo mockup, no photograph.",
		);
	});

	test("custom styles, lettering and an undecided placement", ({ assert }) => {
		const custom = buildPrompt(
			inputs({
				style: "custom",
				customStyle: "neo-traditional\nstipple",
				bodyArea: "any",
			}),
		);
		assert.include(custom, "tattoo design, neo-traditional stipple. ");
		assert.notInclude(custom, "Laid out as");
		const lettering = buildPrompt(
			inputs({ style: "lettering", lettering: 'Stay "wild"' }),
		);
		assert.include(lettering, `The lettering reads exactly "Stay 'wild'"`);
		assert.include(lettering, "The requested lettering is the only text");
		// Lettering text is only used with the lettering style.
		assert.notInclude(buildPrompt(inputs({ lettering: "Ignored" })), "Ignored");
	});

	test("contact details, links and hidden characters are refused", ({
		assert,
	}) => {
		assert.isNull(personalDataProblem("A rose with 3 thorns and 12 petals"));
		assert.include(personalDataProblem("mail asha@example.com") ?? "", "email");
		assert.include(personalDataProblem("+977 980-123-4567") ?? "", "phone");
		assert.include(personalDataProblem("www.example.com/ref") ?? "", "link");
		assert.include(personalDataProblem("by @asha_ink") ?? "", "handle");
		assert.include(personalDataProblem("rose‮evil") ?? "", "hidden");
		// Dates, spans of years and joined Devanagari are ordinary design text.
		assert.isNull(personalDataProblem("Est. 12.05.2019"));
		assert.isNull(personalDataProblem("1990-2024"));
		assert.isNull(personalDataProblem("\u0915\u094D\u200D\u0937 lettering"));
		assert.include(personalDataProblem("zero\u200Bwidth") ?? "", "hidden");
	});

	test("the content screen refuses explicit content and minors with sexual or violent words, and nothing else", ({
		assert,
	}) => {
		assert.isTrue(policyProblem("explicit sex scene"));
		assert.isTrue(policyProblem("porn star portrait"));
		assert.isTrue(policyProblem("a nude figure", null, "teenager"));
		assert.isTrue(policyProblem("a 12 year old being beaten"));
		// Tattoo art that is dark, nude or about children stays allowed.
		assert.isFalse(policyProblem("memorial piece for my child with roses"));
		assert.isFalse(policyProblem("pin-up nude in traditional style"));
		assert.isFalse(policyProblem("bloody dagger through a skull"));
		assert.isFalse(policyProblem("hardcore punk lettering"));
		assert.isFalse(policyProblem(null, undefined, ""));
	});

	test("sizes fit the hosted models' limits and labels read well", ({
		assert,
	}) => {
		for (const orientation of [
			"portrait",
			"landscape",
			"square",
			"round",
		] as const) {
			const { width, height } = sizeOf(orientation);
			assert.equal(width % 32, 0);
			assert.equal(height % 32, 0);
			assert.isAtMost(Math.max(width, height), 1440);
		}
		assert.equal(inputsLabel(inputs()), "Japanese · forearm");
		assert.equal(inputsLabel(inputs({ bodyArea: "any" })), "Japanese");
	});

	test("retry is offered only for failures not about the request", ({
		assert,
	}) => {
		for (const code of FAILURE_CODES) assert.isString(FAILURE_MESSAGES[code]);
		assert.isTrue(canRetry("failed", "timed_out", 1));
		assert.isTrue(canRetry("failed", "submit_unconfirmed", 1));
		assert.isFalse(canRetry("moderated", "content_moderated", 1));
		assert.isFalse(canRetry("failed", "provider_rejected", 1));
		assert.isFalse(canRetry("completed", null, 1));
		assert.isFalse(canRetry("failed", "timed_out", 5));
	});
});
