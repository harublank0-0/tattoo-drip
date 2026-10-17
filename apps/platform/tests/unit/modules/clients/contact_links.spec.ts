import { test } from "@japa/runner";
import { chatLinks, telLink } from "#modules/clients/contact_links";

test.group("Contact links", () => {
	test("WhatsApp prefills a message; Viber takes none", ({ assert }) => {
		assert.deepEqual(chatLinks("+9779812345678", "Hi & bye"), {
			whatsapp: "https://wa.me/9779812345678?text=Hi%20%26%20bye",
			viber: "viber://chat?number=%2B9779812345678",
		});
	});

	test("without a message, WhatsApp just opens the chat", ({ assert }) => {
		assert.deepEqual(chatLinks("+9779812345678"), {
			whatsapp: "https://wa.me/9779812345678",
			viber: "viber://chat?number=%2B9779812345678",
		});
	});

	test("a call link dials the E.164 number", ({ assert }) => {
		assert.equal(telLink("+9779812345678"), "tel:+9779812345678");
	});
});
