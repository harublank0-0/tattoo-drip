import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import {
	updateDepositSettingsValidator,
	updateProfileValidator,
} from "#modules/tenancy/validators/tenant";

/**
 * What the body parser hands over: empty fields are already null
 * (convertEmptyStringsToNull).
 */
const profile = {
	name: "Black Needle Tattoo",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "98-1234-5678",
	contactEmail: "hello@blackneedle.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: null,
};

/**
 * The fields a validator rejects, or [] if it passes.
 */
async function rejectedFields(
	validator: { validate: (data: unknown) => Promise<unknown> },
	data: unknown,
) {
	try {
		await validator.validate(data);
		return [];
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			return (error.messages as { field: string }[]).map(({ field }) => field);
		}
		throw error;
	}
}

test.group("updateProfileValidator", () => {
	test("accepts a profile and stores the phone in E.164", async ({
		assert,
	}) => {
		const output = await updateProfileValidator.validate(profile);

		assert.equal(output.contactPhone, "+9779812345678");
		assert.isNull(output.facebookUrl);
	});

	test("stores the canonical time zone name", async ({ assert }) => {
		const output = await updateProfileValidator.validate({
			...profile,
			timezone: "asia/katmandu",
		});

		assert.equal(output.timezone, "Asia/Kathmandu");
	});

	test("drops slug, type and tenantId", async ({ assert }) => {
		const output = await updateProfileValidator.validate({
			...profile,
			slug: "stolen",
			type: "independent",
			tenantId: "0199c0de-0000-7000-8000-000000000001",
		});

		assert.notProperty(output, "slug");
		assert.notProperty(output, "type");
		assert.notProperty(output, "tenantId");
	});

	for (const [field, value] of [
		["name", "B"],
		["timezone", "Mars/Olympus_Mons"],
		["intro", "x".repeat(1001)],
		["contactPhone", "12345"],
		["contactEmail", "not-an-email"],
		["address", "x".repeat(301)],
		["instagramUrl", "http://instagram.com/blackneedle"],
		["websiteUrl", "blackneedle.example"],
	] as const) {
		test(`rejects ${field} = "${value.slice(0, 40)}"`, async ({ assert }) => {
			assert.deepEqual(
				await rejectedFields(updateProfileValidator, {
					...profile,
					[field]: value,
				}),
				[field],
			);
		});
	}
});

test.group("updateDepositSettingsValidator", () => {
	test("accepts a whole percentage sent as text", async ({ assert }) => {
		const output = await updateDepositSettingsValidator.validate({
			defaultDepositPercent: "30",
			depositPolicy: "Deposits hold your date.",
		});

		assert.strictEqual(output.defaultDepositPercent, 30);
	});

	test("accepts 0, 100 and no default", async ({ assert }) => {
		for (const value of [0, 100, null]) {
			const output = await updateDepositSettingsValidator.validate({
				defaultDepositPercent: value,
				depositPolicy: null,
			});
			assert.strictEqual(output.defaultDepositPercent, value);
		}
	});

	for (const value of ["101", "-1", "12.5", "half"]) {
		test(`rejects a deposit of "${value}"`, async ({ assert }) => {
			assert.deepEqual(
				await rejectedFields(updateDepositSettingsValidator, {
					defaultDepositPercent: value,
					depositPolicy: null,
				}),
				["defaultDepositPercent"],
			);
		});
	}

	test("rejects a policy over 2000 characters", async ({ assert }) => {
		assert.deepEqual(
			await rejectedFields(updateDepositSettingsValidator, {
				defaultDepositPercent: null,
				depositPolicy: "x".repeat(2001),
			}),
			["depositPolicy"],
		);
	});
});
