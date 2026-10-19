import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	firstName,
	KIND_PLACEHOLDERS,
	MAX_TEMPLATE_LENGTH,
	MESSAGE_KINDS,
	normalizeTemplate,
	PLACEHOLDER_HELP,
	PLACEHOLDERS,
	renderMessage,
	sampleValues,
	templateProblem,
} from "#modules/notifications/messages";

const SAMPLE = sampleValues({
	name: "Black Needle",
	address: "Thamel, Kathmandu",
});

test.group("renderMessage", () => {
	test("fills each new default with its values", ({ assert }) => {
		assert.equal(
			renderMessage(
				"inquiry_received",
				DEFAULT_TEMPLATES.inquiry_received,
				SAMPLE,
			),
			"Hi Sita, thank you for your tattoo inquiry to Black Needle. We have your idea and will reply here soon.",
		);
		assert.equal(
			renderMessage(
				"booking_confirmation",
				DEFAULT_TEMPLATES.booking_confirmation,
				SAMPLE,
			),
			"Hi Sita, your session at Black Needle is booked for Mon 2 Nov 2026, 15:45–17:45 with Asha. Reply here if you need to change it.",
		);
		assert.equal(
			renderMessage(
				"session_reminder",
				DEFAULT_TEMPLATES.session_reminder,
				SAMPLE,
			),
			"Hi Sita, a reminder of your session at Black Needle on Mon 2 Nov 2026, 15:45–17:45 with Asha. See you soon!",
		);
		assert.match(
			renderMessage("aftercare", DEFAULT_TEMPLATES.aftercare, SAMPLE),
			/^Hi Sita, thank you for your tattoo at Black Needle! For the next two weeks: /,
		);
	});

	test("a value is never read again as a placeholder", ({ assert }) => {
		assert.equal(
			renderMessage("quote", "Hi {client_name}, {price}", {
				client_name: "{deposit_link} $& <b>",
				price: "NPR 1",
			}),
			"Hi {deposit_link} $& <b>, NPR 1",
		);
	});

	test("a name the kind doesn't use stays as typed", ({ assert }) => {
		assert.equal(
			renderMessage("quote", "{deposit_link} {price} {Price} {}", {
				price: "NPR 1",
				deposit_link: "https://x.test",
			}),
			"{deposit_link} NPR 1 {Price} {}",
		);
	});

	test("an empty value removes the placeholder and one space before it", ({
		assert,
	}) => {
		assert.equal(
			renderMessage(
				"booking_confirmation",
				"Hi {client_name}! See you {session_time}{studio_address} at {studio_address}.",
				{ client_name: "", session_time: "Mon" },
			),
			"Hi! See you Mon at.",
		);
		assert.equal(
			renderMessage("quote", "Hi {client_name}, here", {}),
			"Hi, here",
		);
	});

	test("line breaks and other scripts pass through", ({ assert }) => {
		assert.equal(
			renderMessage("aftercare", "नमस्ते {client_name}!\n{studio_name} 🙏", {
				client_name: "सीता",
				studio_name: "Black Needle",
			}),
			"नमस्ते सीता!\nBlack Needle 🙏",
		);
	});
});

test.group("templateProblem", () => {
	test("every default is a valid message", ({ assert }) => {
		for (const kind of MESSAGE_KINDS) {
			assert.isNull(templateProblem(kind, DEFAULT_TEMPLATES[kind]), kind);
		}
	});

	test("only the kind's own placeholders, and nothing else in braces", ({
		assert,
	}) => {
		assert.equal(
			templateProblem("inquiry_received", "Hi {client_name}, {price}"),
			"{price} can't be used here. This message can use {client_name}, {studio_name}.",
		);
		for (const typo of [
			"{client name}",
			"{Client_Name}",
			"{}",
			"{ client_name }",
		]) {
			assert.match(
				templateProblem("aftercare", `Hi ${typo}`) ?? "",
				/can't be used here/,
				typo,
			);
		}
		assert.isNull(
			templateProblem(
				"session_reminder",
				"{client_name} {studio_name} {artist_name} {session_time} {studio_address}",
			),
		);
	});

	test("a brace that is not part of a placeholder is refused", ({ assert }) => {
		const stray =
			"Remove the stray { or }: every brace must be part of a placeholder such as {client_name}.";
		for (const text of [
			"Hi {client_name",
			"Hi {client_name}}",
			"Hi {{client_name}}",
			"Hi client_name}",
			"Hi {",
		]) {
			assert.equal(templateProblem("aftercare", text), stray, text);
		}
		// A complete wrong placeholder keeps its own message.
		assert.match(
			templateProblem("aftercare", "Hi {price}") ?? "",
			/can't be used here/,
		);
		assert.isNull(
			templateProblem("aftercare", "Hi {client_name}, {studio_name} (ok)"),
		);
	});

	test("the deposit link message keeps its link", ({ assert }) => {
		assert.equal(
			templateProblem("deposit_link", "Hi {client_name}, pay {amount}."),
			"Keep {deposit_link}: it is the link the client pays on.",
		);
		assert.isNull(templateProblem("deposit_link", "Pay here: {deposit_link}"));
	});

	test("1 to 1,000 characters once trimmed, a line ending counted once", ({
		assert,
	}) => {
		assert.equal(
			templateProblem("aftercare", "   \r\n  "),
			"Write the message, or reset it to the default.",
		);
		assert.isNull(
			templateProblem("aftercare", "x".repeat(MAX_TEMPLATE_LENGTH)),
		);
		assert.equal(
			templateProblem("aftercare", "x".repeat(MAX_TEMPLATE_LENGTH + 1)),
			"Use at most 1,000 characters.",
		);
		// 500 lines typed in a browser arrive with \r\n: 999 characters stored.
		assert.isNull(
			templateProblem("aftercare", Array(500).fill("x").join("\r\n")),
		);
		// An emoji is one character, as Postgres counts it.
		assert.isNull(
			templateProblem("aftercare", "🙏".repeat(MAX_TEMPLATE_LENGTH)),
		);
	});

	test("refuses NUL", ({ assert }) => {
		assert.equal(
			templateProblem("aftercare", "Hi\u0000"),
			"Remove the unsupported characters.",
		);
	});
});

test.group("message helpers", () => {
	test("normalizeTemplate stores \\n line endings, trimmed", ({ assert }) => {
		assert.equal(normalizeTemplate("  Hi\r\nthere\rnow\n "), "Hi\nthere\nnow");
	});

	test("firstName is the first word, or nothing", ({ assert }) => {
		assert.equal(firstName("  Sita   Rai "), "Sita");
		assert.equal(firstName("   "), "");
		assert.equal(firstName("सीता राई"), "सीता");
	});

	test("every placeholder is explained and used by some message", ({
		assert,
	}) => {
		const used = new Set(
			MESSAGE_KINDS.flatMap((kind) => KIND_PLACEHOLDERS[kind]),
		);
		assert.deepEqual([...used].sort(), [...PLACEHOLDERS].sort());
		for (const name of PLACEHOLDERS) assert.isString(PLACEHOLDER_HELP[name]);
	});

	test("sample values use the studio's own name and address", ({ assert }) => {
		assert.equal(SAMPLE.studio_name, "Black Needle");
		assert.equal(SAMPLE.studio_address, "Thamel, Kathmandu");
		assert.equal(sampleValues({ name: "X", address: null }).studio_address, "");
	});
});
