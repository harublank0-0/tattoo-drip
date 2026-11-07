import { test } from "@japa/runner";
import { apiOnlyHosts, checkPlatformOrigins } from "#services/platform_origins";

const LIVE = {
	appUrl: "https://tattoodrip.app",
	storefrontTemplate: "https://{tenant}.tattoodrip.page",
	production: true,
};
const SPLIT = {
	...LIVE,
	appUrl: "https://app.tattoodrip.app",
	apiUrl: "https://api.tattoodrip.app",
	discoverUrl: "https://tattoodrip.app",
};

test.group("API_URL and DISCOVER_URL at boot (Discover D01)", () => {
	test("the live layout (neither set) and the D11 layout pass", ({
		assert,
	}) => {
		assert.doesNotThrow(() => checkPlatformOrigins(LIVE));
		assert.doesNotThrow(() => checkPlatformOrigins(SPLIT));
		// The API may stay on the dashboard's host.
		assert.doesNotThrow(() =>
			checkPlatformOrigins({
				...LIVE,
				apiUrl: "https://tattoodrip.app",
			}),
		);
	});

	test("development and loopback rehearsals pass over http", ({ assert }) => {
		assert.doesNotThrow(() =>
			checkPlatformOrigins({
				appUrl: "http://app.localhost:3333",
				apiUrl: "http://api.localhost:3333",
				discoverUrl: "http://localhost:3100",
				storefrontTemplate: "http://{tenant}.localhost:3000",
				production: false,
			}),
		);
	});

	test("anything but a bare origin is refused, in every environment", ({
		assert,
	}) => {
		for (const production of [false, true]) {
			for (const [key, value] of [
				["API_URL", "api.tattoodrip.app"],
				["API_URL", "ftp://api.tattoodrip.app"],
				["API_URL", "https://api.tattoodrip.app/api/v1"],
				["API_URL", "https://api.tattoodrip.app?x=1"],
				["API_URL", "https://api.tattoodrip.app/?"],
				["API_URL", "https://api.tattoodrip.app#x"],
				["API_URL", "https://user:secret@api.tattoodrip.app"],
				["DISCOVER_URL", "tattoodrip.app"],
				["DISCOVER_URL", "https://tattoodrip.app/discover"],
			] as const) {
				const settings = {
					...SPLIT,
					production,
					[key === "API_URL" ? "apiUrl" : "discoverUrl"]: value,
				};
				let message = "";
				assert.throws(
					() => {
						try {
							checkPlatformOrigins(settings);
						} catch (error) {
							message = (error as Error).message;
							throw error;
						}
					},
					new RegExp(`${key} must be an http\\(s\\) origin`),
				);
				// The value may hold a secret: never echoed.
				assert.notInclude(message, "secret", value);
			}
		}
	});

	test("Discover never shares the dashboard's or the API's host", ({
		assert,
	}) => {
		for (const production of [false, true]) {
			for (const discoverUrl of [
				"https://app.tattoodrip.app",
				"https://api.tattoodrip.app",
				"https://APP.tattoodrip.app.",
			]) {
				assert.throws(
					() => checkPlatformOrigins({ ...SPLIT, production, discoverUrl }),
					/DISCOVER_URL \(.+\) must be a host of its own/,
					discoverUrl,
				);
			}
		}
	});

	test("in production both must be https", ({ assert }) => {
		assert.throws(
			() =>
				checkPlatformOrigins({
					...SPLIT,
					apiUrl: "http://api.tattoodrip.app",
				}),
			/API_URL must be an https origin in production/,
		);
		assert.throws(
			() =>
				checkPlatformOrigins({
					...SPLIT,
					discoverUrl: "http://tattoodrip.app",
				}),
			/DISCOVER_URL must be an https origin in production/,
		);
	});

	test("in production neither may sit on, under or above the studio pages' domain", ({
		assert,
	}) => {
		for (const [key, field, value] of [
			["API_URL", "apiUrl", "https://api.tattoodrip.page"],
			["API_URL", "apiUrl", "https://tattoodrip.page"],
			["DISCOVER_URL", "discoverUrl", "https://discover.tattoodrip.page"],
			["DISCOVER_URL", "discoverUrl", "https://page"],
		] as const) {
			assert.throws(
				() => checkPlatformOrigins({ ...SPLIT, [field]: value }),
				new RegExp(`${key} \\(.+\\) and the studio pages .* separate domains`),
				value,
			);
		}
		// Outside production the domains are not compared (the dev default
		// puts everything on localhost).
		assert.doesNotThrow(() =>
			checkPlatformOrigins({
				...SPLIT,
				production: false,
				apiUrl: "https://api.tattoodrip.page",
			}),
		);
	});
});

test.group("apiOnlyHosts (Discover D01)", () => {
	test("none in the live layout", ({ assert }) => {
		assert.deepEqual([...apiOnlyHosts(LIVE)], []);
		assert.deepEqual(
			[...apiOnlyHosts({ ...LIVE, apiUrl: "https://tattoodrip.app" })],
			[],
		);
	});

	test("the API's own host and Discover's, in lower case without the port or trailing dot", ({
		assert,
	}) => {
		assert.sameMembers(
			[
				...apiOnlyHosts({
					appUrl: "http://app.localhost:3333",
					apiUrl: "http://API.localhost.:3333",
					discoverUrl: "http://localhost:3100",
				}),
			],
			["api.localhost", "localhost"],
		);
		assert.sameMembers(
			[...apiOnlyHosts(SPLIT)],
			["api.tattoodrip.app", "tattoodrip.app"],
		);
	});
});
