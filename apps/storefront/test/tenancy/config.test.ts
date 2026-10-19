import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	parseStorefrontConfig,
	tenantOrigin,
} from "../../src/tenancy/config.ts";

const DEV = {
	API_URL: "http://localhost:3333",
	STOREFRONT_URL: "http://{tenant}.localhost:3000",
};
const PROD = {
	API_URL: "https://api.tattoodrip.app",
	STOREFRONT_URL: "https://{tenant}.tattoodrip.com",
};

/** The message parseStorefrontConfig throws for `env`. */
function failure(env: Record<string, string | undefined>): string {
	try {
		parseStorefrontConfig(env);
	} catch (error) {
		return (error as Error).message;
	}
	assert.fail("expected the settings to be refused");
}

describe("parseStorefrontConfig", () => {
	test("reads the development settings", () => {
		assert.deepEqual(parseStorefrontConfig(DEV), {
			apiUrl: "http://localhost:3333",
			protocol: "http:",
			baseHost: "localhost",
			port: ":3000",
		});
	});

	test("reads the production settings", () => {
		assert.deepEqual(parseStorefrontConfig(PROD), {
			apiUrl: "https://api.tattoodrip.app",
			protocol: "https:",
			baseHost: "tattoodrip.com",
			port: "",
		});
	});

	test("trims, lowercases and allows one trailing slash", () => {
		const config = parseStorefrontConfig({
			API_URL: " https://API.TattooDrip.app/ ",
			STOREFRONT_URL: " https://{tenant}.TattooDrip.com/ ",
		});
		assert.equal(config.apiUrl, "https://api.tattoodrip.app");
		assert.equal(config.baseHost, "tattoodrip.com");
	});

	test("drops the scheme's default port", () => {
		assert.equal(
			parseStorefrontConfig({
				...PROD,
				STOREFRONT_URL: "https://{tenant}.tattoodrip.com:443",
			}).port,
			"",
		);
		assert.equal(
			parseStorefrontConfig({
				...DEV,
				STOREFRONT_URL: "http://{tenant}.localhost:80",
			}).port,
			"",
		);
	});

	test("allows http for an API on this machine", () => {
		for (const apiUrl of ["http://127.0.0.1:3333", "http://[::1]:3333"]) {
			assert.equal(
				parseStorefrontConfig({ ...DEV, API_URL: apiUrl }).apiUrl,
				apiUrl,
			);
		}
	});

	test("names every variable that is not set", () => {
		for (const env of [{}, { API_URL: "", STOREFRONT_URL: "  " }]) {
			const message = failure(env);
			assert.match(message, /API_URL is not set/);
			assert.match(message, /STOREFRONT_URL is not set/);
			assert.match(message, /\.env\.local\.example/);
		}
	});

	test("refuses an API_URL that isn't an https origin, without echoing it", () => {
		for (const apiUrl of [
			"api.tattoodrip.app",
			"ftp://api.tattoodrip.app",
			"http://api.tattoodrip.app",
			"https://api.tattoodrip.app/api",
			"https://api.tattoodrip.app?x=1",
			"https://api.tattoodrip.app#x",
			"https://user:secret@api.tattoodrip.app",
		]) {
			const message = failure({ ...PROD, API_URL: apiUrl });
			assert.match(message, /API_URL is invalid/, apiUrl);
			assert.doesNotMatch(message, /STOREFRONT_URL/, apiUrl);
			assert.ok(!message.includes(apiUrl), apiUrl);
			assert.ok(!message.includes("secret"), apiUrl);
		}
	});

	test("refuses a STOREFRONT_URL without {tenant} as its first label, without echoing it", () => {
		for (const storefrontUrl of [
			"https://tattoodrip.com",
			"https://{tenant}tattoodrip.com",
			"https://www.{tenant}.tattoodrip.com",
			"https://{tenant}.tattoodrip.com/studio",
			"https://{tenant}.tattoodrip.com?x=1",
			"http://{tenant}.tattoodrip.com",
			"https://{tenant}.127.0.0.1",
			"https://{tenant}.tattoo_drip.com",
			"{tenant}.tattoodrip.com",
			"https://user@{tenant}.tattoodrip.com",
			"https://{tenant}.tattoodrip.com:0",
			"https://{tenant}.tattoodrip.com:99999",
		]) {
			const message = failure({ ...PROD, STOREFRONT_URL: storefrontUrl });
			assert.match(message, /STOREFRONT_URL is invalid/, storefrontUrl);
			assert.ok(!message.includes(storefrontUrl), storefrontUrl);
		}
	});
});

describe("tenantOrigin", () => {
	test("puts the slug in front of the base domain, with the scheme and port", () => {
		assert.equal(
			tenantOrigin(parseStorefrontConfig(DEV), "blackneedle"),
			"http://blackneedle.localhost:3000",
		);
		assert.equal(
			tenantOrigin(parseStorefrontConfig(PROD), "blackneedle"),
			"https://blackneedle.tattoodrip.com",
		);
	});

	test("refuses anything but a stored slug", () => {
		const config = parseStorefrontConfig(PROD);
		for (const slug of ["evil.test/", "Black", "a.b", "", "ab"]) {
			assert.throws(
				() => tenantOrigin(config, slug),
				/stored tenant slug/,
				slug,
			);
		}
	});
});

describe("STOREFRONT_SERVER_KEY", () => {
	const KEY = "test-server-key-0123456789abcdefghijklmnop";

	test("is optional: without one the config has no serverKey", () => {
		for (const value of [undefined, "", "   "]) {
			const config = parseStorefrontConfig({
				...PROD,
				STOREFRONT_SERVER_KEY: value,
			});
			assert.equal("serverKey" in config, false, JSON.stringify(value));
		}
	});

	test("reads a key of token68 characters, trimmed", () => {
		for (const key of [
			KEY,
			"a".repeat(32),
			`${"q".repeat(43)}=`,
			"a".repeat(256),
			`${"a".repeat(256)}==`,
		]) {
			assert.equal(
				parseStorefrontConfig({ ...PROD, STOREFRONT_SERVER_KEY: ` ${key}\n` })
					.serverKey,
				key,
			);
		}
	});

	test("refuses a short, spaced or odd key without echoing it", () => {
		for (const key of [
			"changeme",
			"a".repeat(31),
			"a".repeat(257),
			`${"a".repeat(20)} ${"b".repeat(20)}`,
			`${"a".repeat(32)}é`,
			`${"a".repeat(16)}=${"b".repeat(16)}`,
			`${"a".repeat(32)}"`,
			`${"a".repeat(32)}===`,
			`${"a".repeat(256)}${"=".repeat(50)}`,
		]) {
			const message = failure({ ...PROD, STOREFRONT_SERVER_KEY: key });
			assert.match(message, /STOREFRONT_SERVER_KEY is invalid/, key);
			assert.match(
				message,
				/32 to 256 letters, digits or .* at most two =/,
				key,
			);
			assert.doesNotMatch(message, /API_URL is|STOREFRONT_URL is/, key);
			assert.ok(!message.includes(key), key);
		}
	});

	test("is reported with the other settings' problems", () => {
		const message = failure({ STOREFRONT_SERVER_KEY: "changeme" });
		assert.match(message, /API_URL is not set/);
		assert.match(message, /STOREFRONT_SERVER_KEY is invalid/);
	});
});
