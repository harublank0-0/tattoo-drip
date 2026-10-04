import { test } from "@japa/runner";
import edge from "edge.js";

test.group("Email layout", () => {
	test("wraps the body in a full document with title and preheader", async ({
		assert,
	}) => {
		const html = await edge.renderRaw(
			[
				"@email.layout({ title: 'Hello', preheader: 'Preview text' })",
				"<p>Body</p>",
				"@end",
			].join("\n"),
		);

		assert.include(html, "<!DOCTYPE html>");
		assert.include(html, "<title>Hello</title>");
		assert.include(html, "Preview text");
		assert.include(html, "<p>Body</p>");
		assert.include(html, "Tattoo Drip");
	});

	test("leaves the preheader block out when none is given", async ({
		assert,
	}) => {
		const html = await edge.renderRaw(
			["@email.layout({ title: 'Hello' })", "<p>Body</p>", "@end"].join("\n"),
		);

		assert.notInclude(html, "undefined");
		assert.notInclude(html, "display: none");
	});

	test("renders the button as an escaped link", async ({ assert }) => {
		const html = await edge.renderRaw(
			"@!email.button({ href: url, text: 'Go' })",
			{ url: "https://x.test/a?b=1&c=2" },
		);

		assert.include(html, 'href="https://x.test/a?b=1&amp;c=2"');
		assert.include(html, ">Go</a>");
	});
});
