import { MultipartFile } from "@adonisjs/core/bodyparser";
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import {
	AMOUNT_MESSAGE,
	depositProofValidator,
	METHOD_MESSAGE,
	PROOF_MESSAGE,
} from "#modules/payments/validators/deposit_proof";

/** A parsed upload, as the validator sees it. */
function upload(clientName: string, size = 1000) {
	const file = new MultipartFile(
		{ fieldName: "proof", clientName, headers: {} },
		{},
	);
	file.size = size;
	file.extname = clientName.split(".").pop();
	file.state = "consumed";
	return file;
}

/** What the controller hands over: the multipart strings and the first proof part. */
const body = (over: Record<string, unknown> = {}) => ({
	proof: upload("receipt.png"),
	method: "esewa",
	expectedAmount: "300000",
	...over,
});

const without = (field: string) =>
	Object.fromEntries(Object.entries(body()).filter(([key]) => key !== field));

/** Field → message of a refused body, or {} when it passes. */
async function problems(data: Record<string, unknown>) {
	try {
		await depositProofValidator.validate(data);
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

test.group("depositProofValidator", () => {
	test("a complete body passes, with the amount as a number", async ({
		assert,
	}) => {
		const output = await depositProofValidator.validate(body());

		assert.equal(output.method, "esewa");
		assert.strictEqual(output.expectedAmount, 300_000);
		assert.equal(output.proof.clientName, "receipt.png");
	});

	test("each field is required, with its message", async ({ assert }) => {
		assert.deepEqual(await problems(without("proof")), {
			proof: PROOF_MESSAGE,
		});
		assert.deepEqual(await problems(without("method")), {
			method: METHOD_MESSAGE,
		});
		assert.deepEqual(await problems(without("expectedAmount")), {
			expectedAmount: AMOUNT_MESSAGE,
		});
	});

	test("the method is a kind a deposit page can show", async ({ assert }) => {
		for (const kind of ["fonepay", "esewa", "khalti", "bank"]) {
			assert.deepEqual(await problems(body({ method: kind })), {}, kind);
		}
		for (const kind of ["cash", "paypal", ""]) {
			assert.deepEqual(
				await problems(body({ method: kind })),
				{ method: METHOD_MESSAGE },
				kind,
			);
		}
	});

	test("the amount is whole paisa from 1 to 1,000,000,000", async ({
		assert,
	}) => {
		assert.deepEqual(await problems(body({ expectedAmount: "1" })), {});
		assert.deepEqual(
			await problems(body({ expectedAmount: "1000000000" })),
			{},
		);
		for (const amount of ["0", "-5", "12.5", "abc", "1000000001"]) {
			assert.deepEqual(
				await problems(body({ expectedAmount: amount })),
				{ expectedAmount: AMOUNT_MESSAGE },
				amount,
			);
		}
	});

	test("the screenshot is a JPEG, PNG or WebP of 10 MB at most", async ({
		assert,
	}) => {
		for (const name of ["a.jpg", "a.jpeg", "a.png", "a.webp"]) {
			assert.deepEqual(await problems(body({ proof: upload(name) })), {}, name);
		}
		assert.deepEqual(
			await problems(body({ proof: upload("big.png", 10 * 1024 * 1024 + 1) })),
			{ proof: "Use an image of 10 MB or less." },
		);
		for (const name of ["moving.gif", "photo.heic", "notes.pdf"]) {
			assert.deepEqual(
				await problems(body({ proof: upload(name) })),
				{ proof: IMAGE_FORMAT_MESSAGE },
				name,
			);
		}
	});
});
