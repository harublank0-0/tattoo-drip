import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import {
	loginValidator,
	newPasswordValidator,
	passwordResetRequestValidator,
	signupValidator,
} from "#validators/user";

/** Field → message of a refused body, or {} when it passes. */
async function problems(
	validator: { validate(data: unknown): Promise<unknown> },
	data: Record<string, unknown>,
) {
	try {
		await validator.validate(data);
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

/** Words a person at a front desk would never say. */
const JARGON = [
	"field",
	"fullName",
	"passwordConfirmation",
	"must be",
	"defined",
	"string",
	"regex",
];

const GOOD = {
	fullName: "Aarav Shrestha",
	email: "aarav@example.com",
	password: "secret-password",
	passwordConfirmation: "secret-password",
};

test.group("Account form messages (TAT-100)", () => {
	test("an empty signup gives three short messages and names no field", async ({
		assert,
	}) => {
		// What the body parser hands over for a form left blank: null.
		const found = await problems(signupValidator, {
			fullName: null,
			email: null,
			password: null,
			passwordConfirmation: null,
		});

		assert.deepEqual(found, {
			email: "Enter your email.",
			password: "Enter your password.",
			passwordConfirmation: "Type your password again.",
		});
	});

	test("the name is optional: left blank it passes", async ({ assert }) => {
		assert.deepEqual(
			await problems(signupValidator, { ...GOOD, fullName: null }),
			{},
		);
	});

	test("a short password, a wrong address and a mismatch each say what to do", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(signupValidator, {
				...GOOD,
				email: "not-an-email",
				password: "short",
				passwordConfirmation: "other",
			}),
			{
				email: "Enter a valid email address.",
				password: "Use 8 to 128 characters.",
				passwordConfirmation: "Type the same password again.",
			},
		);
	});

	test("a password over 128 characters gets the same range hint", async ({
		assert,
	}) => {
		const long = "x".repeat(129);
		assert.deepEqual(
			await problems(signupValidator, {
				...GOOD,
				password: long,
				passwordConfirmation: long,
			}),
			{ password: "Use 8 to 128 characters." },
		);
	});

	test("128 characters pass, for a password manager's long password (TAT-95)", async ({
		assert,
	}) => {
		const long = "x".repeat(128);
		assert.deepEqual(
			await problems(signupValidator, {
				...GOOD,
				password: long,
				passwordConfirmation: long,
			}),
			{},
		);
	});

	test("a very long name is refused kindly", async ({ assert }) => {
		assert.deepEqual(
			await problems(signupValidator, { ...GOOD, fullName: "A".repeat(256) }),
			{ fullName: "Use 255 characters or fewer." },
		);
	});

	test("an empty login asks for the email and the password", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(loginValidator, { email: null, password: null }),
			{ email: "Enter your email.", password: "Enter your password." },
		);
	});

	test("asking for a reset link without an address says so", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(passwordResetRequestValidator, { email: null }),
			{ email: "Enter your email." },
		);
		assert.deepEqual(
			await problems(passwordResetRequestValidator, { email: "nope" }),
			{ email: "Enter a valid email address." },
		);
	});

	test("a new password from a reset link follows the same wording", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(newPasswordValidator, {
				password: null,
				passwordConfirmation: null,
			}),
			{
				password: "Enter your password.",
				passwordConfirmation: "Type your password again.",
			},
		);
		assert.deepEqual(
			await problems(newPasswordValidator, {
				password: "short",
				passwordConfirmation: "other",
			}),
			{
				password: "Use 8 to 128 characters.",
				passwordConfirmation: "Type the same password again.",
			},
		);
	});

	test("no message of any account form carries a field name or validator wording", async ({
		assert,
	}) => {
		const bodies: Record<string, unknown>[] = [
			{},
			{
				fullName: null,
				email: null,
				password: null,
				passwordConfirmation: null,
			},
			{ fullName: 12, email: 7, password: 3, passwordConfirmation: 4 },
			{
				fullName: ["a"],
				email: ["a"],
				password: ["a"],
				passwordConfirmation: ["a"],
			},
			{ ...GOOD, email: "x".repeat(260) + "@example.com" },
			{ ...GOOD, fullName: "A".repeat(256), password: "short" },
			{ ...GOOD, passwordConfirmation: "different-password" },
		];
		for (const validator of [
			signupValidator,
			loginValidator,
			passwordResetRequestValidator,
			newPasswordValidator,
		]) {
			for (const data of bodies) {
				for (const [field, message] of Object.entries(
					await problems(validator, data),
				)) {
					for (const word of JARGON) {
						assert.notInclude(
							message.toLowerCase(),
							word.toLowerCase(),
							`${field}: "${message}" (body ${JSON.stringify(data)})`,
						);
					}
				}
			}
		}
	});
});
