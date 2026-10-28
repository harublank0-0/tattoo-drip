import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-108 fix round: the cards must draw what `placementsOf` says they own, or a control the old
// page offered vanishes where the Next step table does not name it (a held project's quote message,
// Accept and the deposit panel while a screenshot waits). The rule itself is pinned in
// project_page.spec.ts and page_affordances.spec.ts; this pins that the page uses it.
test.group("The cards draw what placementsOf gives them (TAT-108)", () => {
	test("the page computes the placements once and hands them to its cards", async ({
		assert,
	}) => {
		const page = await read("pages/projects/show.tsx");
		assert.include(page, "placementsOf(props)");
		for (const card of ["<QuoteCard", "<PaymentsCard"]) {
			const tag = page.slice(page.indexOf(card));
			assert.include(tag.slice(0, tag.indexOf("/>")), "place={place}", card);
		}
		assert.include(page, "<DepositCard");
		assert.include(page, "<FinishCard");
		assert.include(page, 'place.finish === "card"');
		assert.include(page, 'place.deposit_link === "card"');
		assert.include(page, 'place.schedule === "card"');
		assert.include(page, 'place.resume === "step"');
	});

	test("the Quote card draws the quote's message, Accept, the first quote, set price and Revise when the step does not", async ({
		assert,
	}) => {
		const card = await read("components/quote_card.tsx");
		for (const name of [
			"send_quote",
			"client_accepted",
			"set_price",
			"revise_quote",
			"issue_quote",
		]) {
			assert.include(card, `place.${name} === "card"`, name);
		}
		assert.include(card, "<AcceptQuote");
		assert.include(card, "<ChatMessage");
	});

	test("the Payments card draws the screenshots, the outcome form and the money buttons when the step does not", async ({
		assert,
	}) => {
		const card = await read("components/payments_card.tsx");
		for (const name of [
			"verify_proof",
			"record_outcome",
			"record_payment",
			"record_refund",
		]) {
			assert.include(card, `place.${name} === "card"`, name);
		}
	});

	test("no card decides by `offers` itself", async ({ assert }) => {
		for (const file of [
			"components/quote_card.tsx",
			"components/payments_card.tsx",
			"components/sessions_card.tsx",
			"components/change_card.tsx",
			"components/deposit_panel.tsx",
			"pages/projects/show.tsx",
		]) {
			assert.notMatch(await read(file), /\boffers\(/, file);
		}
	});

	test("the Next step card wraps Revise and the deposit panel in the ids they own", async ({
		assert,
	}) => {
		const card = await read("components/next_step_card.tsx");
		assert.include(card, 'cardId("quote-form", step.anchor)');
		assert.include(card, 'cardId("deposit", step.anchor)');
		// And the cards that draw them when the step does not.
		assert.include(
			await read("components/quote_card.tsx"),
			'cardId("quote-form", nextStep.anchor)',
		);
		assert.include(
			await read("components/deposit_panel.tsx"),
			'cardId("deposit", anchor)',
		);
	});
});
