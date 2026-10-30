import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	asciiDigits,
	FIELD_ORDER,
	INTAKE_LIMITS,
	type IntakeValues,
	initialValues,
	normalizePhone,
	REQUIRED_FIELDS,
	SOURCE_CHANNELS,
	validateIntake,
} from "../../src/intake/rules.ts";

const SITA_ID = "0199f000-0000-7000-8000-000000000048";
const RULES = { studioName: "Black Needle", artistIds: [SITA_ID] };
const VALID: IntakeValues = {
	idea: "A fine-line peony with two leaves",
	placement: "Left forearm",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	preferredArtistId: "",
	budget: "",
	sourceChannel: "instagram",
	contactName: "Asha Gurung",
	contactPhone: "98-1234-5678",
	contactEmail: "",
};

const CONTRACT = readFileSync(
	new URL("../../../../packages/types/openapi.yaml", import.meta.url),
	"utf8",
);

/** The lines of InquiryInput's property `name` in the contract. */
function contractProperty(name: string): string {
	const start = CONTRACT.indexOf("\n    InquiryInput:");
	const end = CONTRACT.indexOf("\n    InquiryForm:", start);
	assert.ok(start > 0 && end > start, "InquiryInput in openapi.yaml");
	const lines = CONTRACT.slice(start, end).split("\n");
	const at = lines.findIndex((line) => line.startsWith(`        ${name}:`));
	assert.ok(at >= 0, `InquiryInput.${name} in openapi.yaml`);
	const own = [lines[at]];
	for (const line of lines.slice(at + 1)) {
		if (!line.startsWith("          ")) break;
		own.push(line);
	}
	return own.join("\n");
}

describe("normalizePhone (a copy of the platform's)", () => {
	// The table of apps/platform/tests/unit/validators/phone.spec.ts.
	for (const [input, expected] of [
		["9812345678", "+9779812345678"],
		["98-1234-5678", "+9779812345678"],
		["01 4123456", "+97714123456"],
		["+977 981 234 5678", "+9779812345678"],
		["00977 9812345678", "+9779812345678"],
		["9779812345678", "+9779812345678"],
		["977-1-4123456", "+97714123456"],
		["+1 (415) 555-0100", "+14155550100"],
	] as const) {
		test(`"${input}" becomes ${expected}`, () => {
			assert.equal(normalizePhone(input), expected);
		});
	}

	for (const input of [
		"",
		"12345",
		"98123456781234567",
		"call me",
		"+0 123 456 789",
	]) {
		test(`"${input}" is not a phone number`, () => {
			assert.equal(normalizePhone(input), undefined);
		});
	}
});

describe("asciiDigits", () => {
	test("turns Devanagari digits into ASCII ones and leaves the rest", () => {
		assert.equal(asciiDigits("९८१२३४५६७८"), "9812345678");
		assert.equal(asciiDigits("+९७७ ९८-१२३४"), "+977 98-1234");
		assert.equal(asciiDigits("98 1234"), "98 1234");
	});
});

describe("validateIntake", () => {
	test("accepts a whole inquiry", () => {
		assert.deepEqual(validateIntake(VALID, RULES), {});
	});

	test("asks for each required answer, in words that fit it", () => {
		const blank = {
			...VALID,
			idea: " ",
			placement: "",
			approximateSize: "\n",
			preferredDates: "",
			sourceChannel: "",
			contactName: "  ",
			contactPhone: "",
		} satisfies IntakeValues;

		assert.deepEqual(validateIntake(blank, RULES), {
			idea: "Describe the tattoo you'd like.",
			placement: "Say where on your body it goes.",
			approximateSize: "Give a rough size.",
			preferredDates: "Say when would suit you.",
			sourceChannel: "Choose how you found Black Needle.",
			contactName: "Enter your name.",
			contactPhone: "Enter your WhatsApp or Viber number.",
		});
	});

	test("lets the optional answers stay empty", () => {
		assert.deepEqual(
			validateIntake(
				{ ...VALID, budget: " ", contactEmail: "", preferredArtistId: "" },
				RULES,
			),
			{},
		);
	});

	test("takes each field up to its column's length, and no more", () => {
		for (const field of [
			"idea",
			"placement",
			"approximateSize",
			"preferredDates",
			"budget",
			"contactName",
		] as const) {
			const max = INTAKE_LIMITS[field];
			assert.equal(
				validateIntake({ ...VALID, [field]: "a".repeat(max) }, RULES)[field],
				undefined,
				field,
			);
			assert.equal(
				validateIntake({ ...VALID, [field]: "a".repeat(max + 1) }, RULES)[
					field
				],
				`Use at most ${max} characters.`,
				field,
			);
		}
		assert.equal(
			validateIntake(
				{ ...VALID, contactPhone: `98${" ".repeat(37)}12345678` },
				RULES,
			).contactPhone,
			"Use at most 40 characters.",
		);
		assert.equal(
			validateIntake(
				{ ...VALID, contactEmail: `${"a".repeat(243)}@example.com` },
				RULES,
			).contactEmail,
			"Use at most 254 characters.",
		);
	});

	test("counts what is left after trimming, as the API does", () => {
		assert.equal(
			validateIntake({ ...VALID, placement: ` ${"a".repeat(120)} ` }, RULES)
				.placement,
			undefined,
		);
	});

	test("refuses a NUL character anywhere", () => {
		for (const field of [
			"idea",
			"placement",
			"budget",
			"contactName",
		] as const) {
			assert.equal(
				validateIntake({ ...VALID, [field]: "fine\u0000line" }, RULES)[field],
				"Remove the unsupported characters.",
				field,
			);
		}
	});

	test("reads phone numbers the way the API does", () => {
		for (const phone of [
			"9812345678",
			"+977 981 234 5678",
			"01 4123456",
			"९८१२३४५६७८",
			"+1 (415) 555-0100",
		]) {
			assert.equal(
				validateIntake({ ...VALID, contactPhone: phone }, RULES).contactPhone,
				undefined,
				phone,
			);
		}
		for (const phone of ["12345", "call me", "+0 123 456 789"]) {
			assert.equal(
				validateIntake({ ...VALID, contactPhone: phone }, RULES).contactPhone,
				"Enter a phone number, like 9812345678 or +977 1 4123456.",
				phone,
			);
		}
	});

	test("takes an email or none", () => {
		assert.equal(
			validateIntake({ ...VALID, contactEmail: "asha@example.com" }, RULES)
				.contactEmail,
			undefined,
		);
		for (const email of ["asha", "asha@", "a b@example.com"]) {
			assert.equal(
				validateIntake({ ...VALID, contactEmail: email }, RULES).contactEmail,
				"Enter a valid email address, or leave it empty.",
				email,
			);
		}
	});

	test("takes an artist from the list, or no preference", () => {
		assert.equal(
			validateIntake({ ...VALID, preferredArtistId: SITA_ID }, RULES)
				.preferredArtistId,
			undefined,
		);
		assert.equal(
			validateIntake(
				{
					...VALID,
					preferredArtistId: "0199f000-0000-7000-8000-000000000099",
				},
				RULES,
			).preferredArtistId,
			"Choose an artist from the list, or No preference.",
		);
	});

	test("takes only the contract's source channels", () => {
		for (const channel of SOURCE_CHANNELS) {
			assert.equal(
				validateIntake({ ...VALID, sourceChannel: channel }, RULES)
					.sourceChannel,
				undefined,
			);
		}
		assert.equal(
			validateIntake(
				{
					...VALID,
					sourceChannel: "twitter" as IntakeValues["sourceChannel"],
				},
				RULES,
			).sourceChannel,
			"Choose how you found Black Needle.",
		);
	});

	test("knows every field, in the form's order", () => {
		assert.deepEqual([...FIELD_ORDER], Object.keys(VALID));
	});

	test("starts empty, with the artist an artist's page asks for", () => {
		assert.deepEqual(initialValues(null), {
			idea: "",
			placement: "",
			approximateSize: "",
			preferredDates: "",
			preferredArtistId: "",
			budget: "",
			sourceChannel: "",
			contactName: "",
			contactPhone: "",
			contactEmail: "",
		});
		assert.equal(initialValues(SITA_ID).preferredArtistId, SITA_ID);
		// A flash request starts with the design's idea and size (TAT-129).
		assert.deepEqual(
			initialValues(SITA_ID, {
				idea: "The Moth flash",
				approximateSize: "About 3 in",
			}),
			{
				...initialValues(null),
				idea: "The Moth flash",
				approximateSize: "About 3 in",
				preferredArtistId: SITA_ID,
			},
		);
		assert.deepEqual(initialValues(SITA_ID, null), initialValues(SITA_ID));
	});
});

describe("pinned to the contract (packages/types/openapi.yaml)", () => {
	test("each limit is InquiryInput's maxLength", () => {
		for (const [field, max] of Object.entries(INTAKE_LIMITS)) {
			assert.match(
				contractProperty(field),
				new RegExp(`maxLength: ${max}\\b`),
				field,
			);
		}
	});

	test("the source channels are the contract's, in its order", () => {
		const match = /\n {4}SourceChannel:\n[\s\S]*?enum: \[([^\]]*)\]/.exec(
			CONTRACT,
		);
		assert.ok(match, "SourceChannel's enum");
		assert.deepEqual(
			match[1].split(",").map((value) => value.trim()),
			[...SOURCE_CHANNELS],
		);
	});

	test("the required fields are the contract's", () => {
		const match = /\n {4}InquiryInput:[\s\S]*?required: \[([^\]]*)\]/.exec(
			CONTRACT,
		);
		assert.ok(match, "InquiryInput's required list");
		assert.deepEqual(
			match[1]
				.split(",")
				.map((value) => value.trim())
				.sort(),
			[...REQUIRED_FIELDS].sort(),
		);
	});
});
