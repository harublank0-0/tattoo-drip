import { test } from "@japa/runner";

test.group("Page head", () => {
	test("the title says Tattoo Drip", async ({ client, assert }) => {
		const html = (await client.get("/login")).text();
		assert.include(html, "<title data-inertia>Tattoo Drip</title>");
	});

	test("links the manifest, icons and theme colors", async ({
		client,
		assert,
	}) => {
		const html = (await client.get("/login")).text();
		for (const tag of [
			'<link rel="manifest" href="/manifest.webmanifest" />',
			'<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />',
			'<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
			'<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />',
			'<meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)" />',
			'<meta name="apple-mobile-web-app-title" content="Tattoo Drip" />',
			"viewport-fit=cover",
		]) {
			assert.include(html, tag);
		}
	});
});
