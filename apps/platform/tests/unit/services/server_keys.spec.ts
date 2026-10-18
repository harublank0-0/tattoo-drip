import { test } from "@japa/runner";
import { checkServerKeys } from "#services/server_keys";
import env from "#start/env";

const KEY = "STOREFRONT_SERVER_KEYS";
const ONE = "a".repeat(43);
const TWO = `${"b".repeat(42)}=`;

test.group("STOREFRONT_SERVER_KEYS at boot", () => {
	test("one key or two, trimmed, as a Secret that never prints", ({
		assert,
	}) => {
		for (const production of [false, true]) {
			assert.deepEqual(
				checkServerKeys(KEY, ` ${ONE} `, production)?.release(),
				[ONE],
			);
			const both = checkServerKeys(KEY, `${ONE} , ${TWO}`, production);
			assert.deepEqual(both?.release(), [ONE, TWO]);
			assert.notInclude(String(both), ONE);
			assert.notInclude(JSON.stringify({ both }), ONE);
		}
	});

	test("each key follows the storefront's rule", ({ assert }) => {
		for (const key of [
			"a".repeat(32),
			"a".repeat(256),
			`${"a".repeat(256)}==`,
			"Az09-._~+/".repeat(4),
		]) {
			assert.deepEqual(checkServerKeys(KEY, key, true)?.release(), [key]);
		}
	});

	test("refuses a short, odd or third key and an empty entry, never echoing a value", ({
		assert,
	}) => {
		for (const value of [
			"a".repeat(31),
			"a".repeat(257),
			`${"a".repeat(32)}===`,
			`${"a".repeat(20)} ${"b".repeat(20)}`,
			`${"a".repeat(32)}é`,
			`${ONE},`,
			`,${ONE}`,
			`${ONE},,${TWO}`,
			`${ONE},${TWO},${"c".repeat(40)}`,
			`${ONE};${TWO}`,
		]) {
			let message = "";
			try {
				checkServerKeys(KEY, value, false);
			} catch (error) {
				message = (error as Error).message;
			}
			assert.match(
				message,
				/STOREFRONT_SERVER_KEYS is invalid: it must be one or two keys/,
				value,
			);
			assert.notInclude(message, value);
		}
	});

	test("optional outside production, required in production", ({ assert }) => {
		for (const value of [undefined, "", "  "]) {
			assert.isUndefined(checkServerKeys(KEY, value, false));
			assert.throws(
				() => checkServerKeys(KEY, value, true),
				/STOREFRONT_SERVER_KEYS is required in production/,
			);
		}
	});

	test("the test environment has two keys (.env.test)", ({ assert }) => {
		assert.lengthOf(env.get("STOREFRONT_SERVER_KEYS")?.release() ?? [], 2);
	});
});
