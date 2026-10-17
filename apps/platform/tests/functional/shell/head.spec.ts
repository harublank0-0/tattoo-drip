import { test } from "@japa/runner";

test.group("Page head", () => {
	test("the title says Tattoo Drip", async ({ client, assert }) => {
		const html = (await client.get("/login")).text();
		assert.include(html, "<title data-inertia>Tattoo Drip</title>");
	});
});
