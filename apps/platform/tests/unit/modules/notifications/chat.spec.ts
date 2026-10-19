import { test } from "@japa/runner";
import { chatMessage, contactLinks } from "#modules/notifications/chat";

test.group("Chat messages", () => {
	test("the text is percent-encoded as UTF-8, newlines and reserved characters included", ({
		assert,
	}) => {
		const text = "नमस्ते Sita,\nतपाईंको सत्र 🙏 #1 + ? & =";

		const message = chatMessage(text, "+9779812345678");

		assert.equal(message.text, text);
		assert.equal(
			message.whatsappUrl,
			"https://wa.me/9779812345678?text=%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87%20Sita%2C%0A%E0%A4%A4%E0%A4%AA%E0%A4%BE%E0%A4%88%E0%A4%82%E0%A4%95%E0%A5%8B%20%E0%A4%B8%E0%A4%A4%E0%A5%8D%E0%A4%B0%20%F0%9F%99%8F%20%231%20%2B%20%3F%20%26%20%3D",
		);
		assert.equal(new URL(message.whatsappUrl).searchParams.get("text"), text);
		assert.equal(message.viberUrl, "viber://chat?number=%2B9779812345678");
	});

	test("the address is the stored number, whatever the text says", ({
		assert,
	}) => {
		const url = new URL(
			chatMessage(
				"Call +1 555 0100 or open https://evil.example/?a=1#x",
				"+9779812345678",
			).whatsappUrl,
		);

		assert.equal(url.host, "wa.me");
		assert.equal(url.pathname, "/9779812345678");
		assert.deepEqual([...url.searchParams.keys()], ["text"]);
		assert.equal(url.hash, "");
	});

	test("plain links open a chat or a call without a message", ({ assert }) => {
		assert.deepEqual(contactLinks("+9779812345678"), {
			whatsappUrl: "https://wa.me/9779812345678",
			viberUrl: "viber://chat?number=%2B9779812345678",
			callUrl: "tel:+9779812345678",
		});
	});
});
