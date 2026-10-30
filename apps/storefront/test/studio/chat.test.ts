import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { chatLinks } from "../../src/studio/chat.ts";
import { studioViewModel } from "../../src/studio/view-model.ts";
import { EMPTY_STUDIO, STUDIO } from "./fixtures.ts";

const studio = studioViewModel(STUDIO);

describe("chatLinks", () => {
	test("WhatsApp says what the client was looking at; Viber is the plain chat", () => {
		assert.deepEqual(chatLinks(studio, null), {
			whatsapp:
				"https://wa.me/9779812345678?text=Hi%2C%20I'm%20asking%20about%20a%20tattoo",
			viber: "viber://chat?number=%2B9779812345678",
		});
		assert.equal(
			chatLinks(studio, "Sita Rai")?.whatsapp,
			"https://wa.me/9779812345678?text=Hi%2C%20I'm%20asking%20about%20Sita%20Rai",
		);
		assert.equal(
			chatLinks(studio, "Sita Rai")?.viber,
			"viber://chat?number=%2B9779812345678",
		);
		const arjun = chatLinks(studio, "अर्जुन थापा");
		assert.ok(arjun);
		const text = new URL(arjun.whatsapp).searchParams.get("text");
		assert.equal(text, "Hi, I'm asking about अर्जुन थापा");
	});

	test("no valid phone, no chat links", () => {
		assert.equal(chatLinks(studioViewModel(EMPTY_STUDIO), "Sita Rai"), null);
	});
});
