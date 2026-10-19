import { MultipartFile } from "@adonisjs/core/bodyparser";
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import {
	ARTIST_MESSAGE,
	intakeValidator,
} from "#modules/inquiries/validators/intake";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { PHONE_MESSAGE } from "#validators/phone";

const REQUIRED = "This field is required.";
const ARTIST_ID = "0195f3a0-0000-7000-8000-000000000051";

/** What the body parser hands over: strings, null for empty fields. */
const body = (over: Record<string, unknown> = {}) => ({
	idea: "A fine-line peony with two leaves",
	placement: "Left forearm",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	preferredArtistId: null,
	budget: null,
	sourceChannel: "instagram",
	contactName: "Maya Gurung",
	contactPhone: "9812345678",
	contactEmail: null,
	...over,
});

/** The body without these fields, as when a form leaves them out. */
const without = (...fields: string[]) =>
	Object.fromEntries(
		Object.entries(body()).filter(([key]) => !fields.includes(key)),
	);

/** A parsed upload, as the validator sees it. */
function upload(clientName: string, size = 1000) {
	const file = new MultipartFile(
		{ fieldName: "referenceImages", clientName, headers: {} },
		{},
	);
	file.size = size;
	file.extname = clientName.split(".").pop();
	file.state = "consumed";
	return file;
}

/** Field → message of a refused body, or {} when it passes. */
async function problems(data: Record<string, unknown>) {
	try {
		await intakeValidator.validate(data);
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

test.group("intakeValidator", () => {
	test("a complete body passes, with the phone in E.164 and empty fields null", async ({
		assert,
	}) => {
		const output = await intakeValidator.validate(
			body({
				preferredArtistId: ARTIST_ID,
				budget: "NPR 15000",
				contactEmail: "maya@example.com",
			}),
		);

		assert.equal(output.contactPhone, "+9779812345678");
		assert.equal(output.preferredArtistId, ARTIST_ID);
		assert.equal(output.budget, "NPR 15000");
		assert.equal(output.contactEmail, "maya@example.com");
		assert.equal(output.sourceChannel, "instagram");
		assert.isNull((await intakeValidator.validate(body())).contactEmail);
	});

	test("each required field is required, and blank counts as missing", async ({
		assert,
	}) => {
		const messages: Record<string, string> = {
			idea: REQUIRED,
			placement: REQUIRED,
			approximateSize: REQUIRED,
			preferredDates: REQUIRED,
			sourceChannel: "Choose how you found the studio.",
			contactName: REQUIRED,
			contactPhone: PHONE_MESSAGE,
		};
		for (const [field, message] of Object.entries(messages)) {
			assert.deepEqual(
				await problems(without(field)),
				{ [field]: message },
				`${field} missing`,
			);
		}
		for (const field of [
			"idea",
			"placement",
			"approximateSize",
			"preferredDates",
			"contactName",
		]) {
			assert.deepEqual(
				await problems(body({ [field]: "   " })),
				{ [field]: REQUIRED },
				`${field} blank`,
			);
		}
	});

	test("the optional fields may be left out", async ({ assert }) => {
		assert.deepEqual(
			await problems(without("preferredArtistId", "budget", "contactEmail")),
			{},
		);
	});

	test("each text field takes its column's length and not one more", async ({
		assert,
	}) => {
		for (const [field, max] of [
			["idea", 4000],
			["placement", 120],
			["approximateSize", 120],
			["preferredDates", 500],
			["budget", 120],
			["contactName", 120],
		] as const) {
			assert.deepEqual(
				await problems(body({ [field]: "x".repeat(max) })),
				{},
				`${field} at ${max}`,
			);
			assert.deepEqual(
				await problems(body({ [field]: "x".repeat(max + 1) })),
				{ [field]: `Use at most ${max} characters.` },
				`${field} over ${max}`,
			);
		}
		assert.deepEqual(await problems(body({ contactPhone: "9".repeat(41) })), {
			contactPhone: "Use at most 40 characters.",
		});
		assert.deepEqual(
			await problems(body({ contactEmail: `${"m".repeat(250)}@example.com` })),
			{ contactEmail: "Use at most 254 characters." },
		);
	});

	test("a NUL character is refused", async ({ assert }) => {
		assert.deepEqual(await problems(body({ idea: "A peony\u0000" })), {
			idea: "Remove the unsupported characters.",
		});
	});

	test("phone forms become E.164; a bad phone gets the phone message", async ({
		assert,
	}) => {
		for (const typed of [
			"981-234-5678",
			"+977 981 234 5678",
			"009779812345678",
			"9779812345678",
		]) {
			assert.equal(
				(await intakeValidator.validate(body({ contactPhone: typed })))
					.contactPhone,
				"+9779812345678",
				typed,
			);
		}
		assert.deepEqual(await problems(body({ contactPhone: "12345" })), {
			contactPhone: PHONE_MESSAGE,
		});
	});

	test("a bad email, an unknown channel and a malformed artist id", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(body({ contactEmail: "maya-at-example" })),
			{
				contactEmail: "Enter a valid email address, or leave it empty.",
			},
		);
		assert.deepEqual(await problems(body({ sourceChannel: "tv" })), {
			sourceChannel: "Choose how you found the studio.",
		});
		assert.deepEqual(await problems(body({ preferredArtistId: "42" })), {
			preferredArtistId: ARTIST_MESSAGE,
		});
	});

	test("up to 5 images of up to 10 MB with an image extension", async ({
		assert,
	}) => {
		const five = Array.from({ length: 5 }, (_, i) => upload(`ref-${i}.png`));
		assert.lengthOf(
			(await intakeValidator.validate(body({ referenceImages: five })))
				.referenceImages ?? [],
			5,
		);

		assert.deepEqual(
			await problems(body({ referenceImages: [...five, upload("ref-5.jpg")] })),
			{ referenceImages: "Attach up to 5 images." },
		);
		assert.deepEqual(
			await problems(
				body({ referenceImages: [upload("big.png", 10 * 1024 * 1024 + 1)] }),
			),
			{ "referenceImages.0": "Use images of 10 MB or less." },
		);
		assert.deepEqual(
			await problems(
				body({ referenceImages: [upload("ok.webp"), upload("moving.gif")] }),
			),
			{ "referenceImages.1": IMAGE_FORMAT_MESSAGE },
		);
	});

	test("a challengeToken field is dropped: the token travels in a header (TAT-55)", async ({
		assert,
	}) => {
		const submission = await intakeValidator.validate(
			body({ challengeToken: "t".repeat(5000) }),
		);

		assert.notProperty(submission, "challengeToken");
	});
});
