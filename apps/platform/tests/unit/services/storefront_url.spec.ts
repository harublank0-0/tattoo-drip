import { test } from "@japa/runner";
import {
	checkStorefrontUrl,
	pointsAtThisMachine,
} from "#services/storefront_url";

const KEY = "STOREFRONT_URL";

test.group("STOREFRONT_URL at boot", () => {
	test("a valid template passes unchanged, in production too", ({ assert }) => {
		for (const value of [
			"https://{tenant}.example.com",
			"http://{tenant}.localhost:3000",
			"https://{tenant}.studios.example.com:8443/ignored",
		]) {
			assert.equal(checkStorefrontUrl(KEY, value, false), value);
			assert.equal(checkStorefrontUrl(KEY, value, true), value);
		}
	});

	test("it is optional outside production (the dev host is the default)", ({
		assert,
	}) => {
		assert.isUndefined(checkStorefrontUrl(KEY, undefined, false));
		assert.isUndefined(checkStorefrontUrl(KEY, "", false));
	});

	test("in production it is required, with a message that says what to set", ({
		assert,
	}) => {
		for (const value of [undefined, ""]) {
			assert.throws(
				() => checkStorefrontUrl(KEY, value, true),
				/STOREFRONT_URL is required in production.*https:\/\/\{tenant\}\.example\.com/,
			);
		}
	});

	test("it must contain {tenant}, be an http(s) URL and vary by studio in its host", ({
		assert,
	}) => {
		const bad: [string, RegExp][] = [
			["https://studios.example.com", /must contain \{tenant\}/],
			["not a url {tenant}", /must be an http\(s\) URL/],
			["ftp://{tenant}.example.com", /must be an http\(s\) URL/],
			["https://example.com/{tenant}", /host/],
			["https://example.com:{tenant}", /must be an http\(s\) URL/],
		];
		for (const [value, message] of bad) {
			for (const production of [false, true]) {
				assert.throws(
					() => checkStorefrontUrl(KEY, value, production),
					message,
					value,
				);
			}
		}
	});
});

test.group("pointsAtThisMachine", () => {
	test("loopback hosts do; a real studio host doesn't", ({ assert }) => {
		assert.isTrue(pointsAtThisMachine("http://{tenant}.localhost:3000"));
		assert.isTrue(pointsAtThisMachine("http://localhost:3000"));
		assert.isTrue(pointsAtThisMachine("http://127.0.0.1:3000"));
		assert.isTrue(pointsAtThisMachine("http://[::1]:3000"));
		assert.isFalse(pointsAtThisMachine("https://{tenant}.example.com"));
		assert.isFalse(
			pointsAtThisMachine("https://{tenant}.localhost.example.com"),
		);
	});
});
