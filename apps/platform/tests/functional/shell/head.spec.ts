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
			'<meta name="theme-color" content="#f7f3ee" media="(prefers-color-scheme: light)" />',
			'<meta name="theme-color" content="#14110f" media="(prefers-color-scheme: dark)" />',
			'<meta name="apple-mobile-web-app-title" content="Tattoo Drip" />',
			"viewport-fit=cover",
		]) {
			assert.include(html, tag);
		}
	});
});

/**
 * `withPlainCookie` encodes the value, but the browser writes
 * `app_theme=dark` as it is (`useTheme`), so put the raw cookie in the
 * client's jar.
 */
function withRawThemeCookie<T extends object>(request: T, value: string): T {
	(
		request as unknown as {
			cookiesJar: Record<string, { name: string; value: string }>;
		}
	).cookiesJar.app_theme = { name: "app_theme", value };
	return request;
}

test.group("Theme", () => {
	test("a first visit starts on the phone's setting: 'system', resolved by a script before the first paint", async ({
		client,
		assert,
	}) => {
		const html = (await client.get("/login")).text();
		assert.include(html, '<html data-theme="system">');
		// The script sits in <head> before the stylesheet and the app, so the
		// theme is settled before anything paints.
		const script = html.indexOf("prefers-color-scheme: dark)'");
		assert.isAbove(script, -1);
		assert.isBelow(script, html.indexOf("</head>"));
		assert.isBelow(script, html.indexOf("inertia/app.tsx"));
	});

	test("the toggle's choice wins: a theme cookie is rendered as it is", async ({
		client,
		assert,
	}) => {
		for (const theme of ["light", "dark"]) {
			const html = (
				await withRawThemeCookie(client.get("/login"), theme)
			).text();
			assert.include(html, `<html data-theme="${theme}">`);
		}
	});

	test("a theme cookie can't break out of the attribute", async ({
		client,
		assert,
	}) => {
		const html = (
			await withRawThemeCookie(
				client.get("/login"),
				"%22%3E%3Cscript%3Ealert(1)%3C/script%3E",
			)
		).text();
		assert.notInclude(html, "<script>alert(1)</script>");
	});
});
