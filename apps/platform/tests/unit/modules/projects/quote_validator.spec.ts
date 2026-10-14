import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import { expiresAtFor } from "#modules/projects/quotes";
import {
	type QuoteForm,
	quoteValidator,
	toQuoteInput,
} from "#modules/projects/validators/quote";

const KTM = "Asia/Kathmandu";
// 20:00 UTC is already 15 Oct in Kathmandu (UTC+5:45).
const NOW = DateTime.fromISO("2026-10-14T20:00:00Z");

/** The field → message map a validation error carries, or {} if it passes. */
async function problems(work: () => unknown) {
	try {
		await work();
		return {};
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			return Object.fromEntries(
				(error.messages as { field: string; message: string }[]).map(
					({ field, message }) => [field, message],
				),
			);
		}
		throw error;
	}
}

/** What the body parser hands over: strings, and null for empty fields. */
const body = (over: Record<string, unknown> = {}) => ({
	kind: "fixed",
	fixedPrice: "15000",
	hourlyRate: null,
	estimatedHours: null,
	depositAmount: "3000",
	expiresOn: "2026-10-28",
	...over,
});

const form = (over: Partial<QuoteForm> = {}): QuoteForm => ({
	kind: "fixed",
	fixedPrice: 15_000,
	hourlyRate: null,
	estimatedHours: null,
	depositAmount: 3_000,
	expiresOn: "2026-10-28",
	...over,
});

test.group("quoteValidator", () => {
	test("accepts a fixed and an hourly quote", async ({ assert }) => {
		assert.deepEqual(await problems(() => quoteValidator.validate(body())), {});
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(
					body({
						kind: "hourly",
						fixedPrice: null,
						hourlyRate: "3000",
						estimatedHours: "4.5",
					}),
				),
			),
			{},
		);
	});

	test("rejects separators, decimals and out-of-range rupees", async ({
		assert,
	}) => {
		const price = "Enter whole rupees from 1 to 1,00,00,000.";
		for (const fixedPrice of ["15,000", "1500.5", "0", "10000001"]) {
			assert.deepEqual(
				await problems(() => quoteValidator.validate(body({ fixedPrice }))),
				{ fixedPrice: price },
				fixedPrice,
			);
		}
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(body({ kind: "hourly", hourlyRate: "100001" })),
			),
			{ hourlyRate: "Enter whole rupees from 1 to 1,00,000 an hour." },
		);
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(
					body({ kind: "hourly", estimatedHours: "0.1" }),
				),
			),
			{ estimatedHours: "Enter hours from 0.25 to 100." },
		);
	});

	test("needs a deposit, a kind and a date", async ({ assert }) => {
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(
					body({
						kind: "per-cm",
						depositAmount: null,
						expiresOn: "28/10/2026",
					}),
				),
			),
			{
				kind: "Choose fixed or hourly.",
				depositAmount: "Enter the deposit in whole rupees (0 for none).",
				expiresOn: "Pick the last day the quote is valid.",
			},
		);
	});
});

test.group("toQuoteInput", () => {
	test("converts a fixed quote to paisa and the expiry instant", ({
		assert,
	}) => {
		const input = toQuoteInput(form(), KTM, NOW);

		assert.deepInclude(input, {
			kind: "fixed",
			fixedPrice: 1_500_000,
			depositAmount: 300_000,
		});
		assert.equal(
			input.expiresAt.toMillis(),
			expiresAtFor("2026-10-28", KTM).toMillis(),
		);
	});

	test("converts an hourly quote to paisa and minutes", ({ assert }) => {
		const input = toQuoteInput(
			form({
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 3_000,
				estimatedHours: 4.75,
				depositAmount: 0,
			}),
			KTM,
			NOW,
		);

		assert.deepInclude(input, {
			kind: "hourly",
			hourlyRate: 300_000,
			estimatedMinutes: 285,
			depositAmount: 0,
		});
	});

	test("needs the fields of the chosen kind", async ({ assert }) => {
		assert.deepEqual(
			await problems(() => toQuoteInput(form({ fixedPrice: null }), KTM, NOW)),
			{ fixedPrice: "Enter the price." },
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ kind: "hourly", fixedPrice: 15_000 }), KTM, NOW),
			),
			{
				hourlyRate: "Enter the hourly rate.",
				estimatedHours: "Enter the estimated hours.",
			},
		);
	});

	test("takes quarter hours only", async ({ assert }) => {
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(
					form({
						kind: "hourly",
						fixedPrice: null,
						hourlyRate: 3_000,
						estimatedHours: 4.3,
						depositAmount: 0,
					}),
					KTM,
					NOW,
				),
			),
			{ estimatedHours: "Use quarter hours: 0.25, 0.5, 0.75 and so on." },
		);
	});

	test("keeps the deposit within the total", async ({ assert }) => {
		const tooMuch = "The deposit can't be more than the total.";
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ depositAmount: 15_001 }), KTM, NOW),
			),
			{ depositAmount: tooMuch },
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ depositAmount: 15_000 }), KTM, NOW),
			),
			{},
		);
		// 3,000 an hour for 2.5 hours is 7,500.
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(
					form({
						kind: "hourly",
						fixedPrice: null,
						hourlyRate: 3_000,
						estimatedHours: 2.5,
						depositAmount: 7_501,
					}),
					KTM,
					NOW,
				),
			),
			{ depositAmount: tooMuch },
		);
	});

	test("takes a last day from the studio's today to a year ahead", async ({
		assert,
	}) => {
		const range = { expiresOn: "Pick a date from today to a year from now." };
		// It is 15 Oct in Kathmandu although the server says 14 Oct.
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2026-10-15" }), KTM, NOW),
			),
			{},
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2026-10-14" }), KTM, NOW),
			),
			range,
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2027-10-15" }), KTM, NOW),
			),
			{},
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2027-10-16" }), KTM, NOW),
			),
			range,
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2026-02-30" }), KTM, NOW),
			),
			range,
		);
	});
});
