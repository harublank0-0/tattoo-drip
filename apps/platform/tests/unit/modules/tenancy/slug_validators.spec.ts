import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import {
	changeSlugValidator,
	createTenantValidator,
} from "#modules/tenancy/validators/tenant";

const FORMAT =
	"Use 3 to 63 lowercase letters, numbers and single hyphens, with at least one letter. Don't start or end with a hyphen.";
const RESERVED = "This page link is reserved. Try another one.";

const tenant = {
	name: "Black Needle",
	type: "studio",
	slug: "black-needle",
	timezone: "Asia/Kathmandu",
};

/** The message on `slug`, or undefined if the data passes. */
async function slugError(
	validator: { validate: (data: unknown) => Promise<unknown> },
	data: unknown,
): Promise<string | undefined> {
	try {
		await validator.validate(data);
		return undefined;
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			const messages = error.messages as { field: string; message: string }[];
			return messages.find(({ field }) => field === "slug")?.message;
		}
		throw error;
	}
}

test.group("Slug validators", () => {
	test("store the trimmed, lowercased slug", async ({ assert }) => {
		const created = await createTenantValidator.validate({
			...tenant,
			slug: "  Black-Needle ",
		});
		assert.equal(created.slug, "black-needle");
		assert.deepEqual(
			await changeSlugValidator.validate({ slug: " Red-Ink " }),
			{
				slug: "red-ink",
			},
		);
	});

	for (const [input, message] of [
		["ab", FORMAT],
		["a--b", FORMAT],
		["xn--abc", FORMAT],
		["12345", FORMAT],
		["Kat", FORMAT],
		["www", RESERVED],
		[" ADMIN ", RESERVED],
		["tattoo-drip", RESERVED],
	] as const) {
		test(`refuse ${JSON.stringify(input)}`, async ({ assert }) => {
			assert.equal(
				await slugError(createTenantValidator, { ...tenant, slug: input }),
				message,
			);
			assert.equal(
				await slugError(changeSlugValidator, { slug: input }),
				message,
			);
		});
	}

	test("a missing slug is refused", async ({ assert }) => {
		assert.isDefined(await slugError(changeSlugValidator, {}));
	});

	test("an empty page link is named a page link, never an address (TAT-101)", async ({
		assert,
	}) => {
		for (const [validator, data] of [
			[createTenantValidator, { ...tenant, slug: undefined }],
			[changeSlugValidator, {}],
		] as const) {
			const message = await slugError(validator, data);
			assert.include(message, "page link");
			assert.notInclude(message?.toLowerCase(), "address");
		}
	});
});
