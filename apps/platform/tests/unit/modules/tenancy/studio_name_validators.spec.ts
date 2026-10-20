import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import {
	createTenantValidator,
	updateProfileValidator,
} from "#modules/tenancy/validators/tenant";

const MESSAGE =
	"The business name can't have line breaks or other hidden control characters.";

const created = {
	type: "studio",
	slug: "black-needle",
	timezone: "Asia/Kathmandu",
};
const profile = { name: "x", timezone: "Asia/Kathmandu", intro: null };

/** The message on `name`, or undefined if the data passes. */
async function nameError(
	validator: { validate: (data: unknown) => Promise<unknown> },
	data: unknown,
): Promise<string | undefined> {
	try {
		await validator.validate(data);
		return undefined;
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			const messages = error.messages as { field: string; message: string }[];
			return messages.find(({ field }) => field === "name")?.message;
		}
		throw error;
	}
}

const validators = [
	["createTenantValidator", createTenantValidator, created],
	["updateProfileValidator", updateProfileValidator, profile],
] as const;

test.group("Studio name (control characters)", () => {
	for (const [label, validator, rest] of validators) {
		test(`${label} accepts ordinary names, Devanagari and joiners`, async ({
			assert,
		}) => {
			for (const name of [
				"Black Needle",
				"Tattoo Point (Thamel) - since 2019",
				"कला स्टुडियो",
				"क्‍ष टैटू",
				"Café Ñandú",
			]) {
				assert.isUndefined(await nameError(validator, { ...rest, name }), name);
			}
		});

		test(`${label} refuses escapes, line breaks, tabs and other controls`, async ({
			assert,
		}) => {
			for (const name of [
				"Evil\u001b[2Jstudio",
				"Two\nlines",
				"Return\rstudio",
				"Tab\tstudio",
				"Nul\u0000studio",
				"C1\u0085studio",
				"Del\u007fstudio",
				"Separator studio",
				"Paragraph studio",
			]) {
				assert.equal(
					await nameError(validator, { ...rest, name }),
					MESSAGE,
					name,
				);
			}
		});
	}
});
