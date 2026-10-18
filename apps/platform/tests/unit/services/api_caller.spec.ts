import crypto from "node:crypto";
import { mock } from "node:test";
import { test } from "@japa/runner";
import { isPublicAddress, ServerKeys, visitorIp } from "#services/api_caller";

const ONE = "test-key-one-0123456789abcdefghijklmnopqrstuv";
const TWO = "test-key-two-0123456789abcdefghijklmnopqrstuv";

test.group("ServerKeys", (group) => {
	group.each.teardown(() => mock.restoreAll());

	test("either configured key matches; anything else does not", ({
		assert,
	}) => {
		const keys = new ServerKeys([ONE, TWO]);
		assert.equal(keys.check(`Bearer ${ONE}`), "match");
		assert.equal(keys.check(`Bearer ${TWO}`), "match");
		assert.equal(keys.check(`bearer  ${TWO}`), "match");
		assert.equal(keys.check(`Bearer ${ONE}x`), "unknown");
		assert.equal(keys.check(`Bearer ${"z".repeat(43)}`), "unknown");
		for (const header of [
			undefined,
			"",
			"Bearer",
			"Bearer ",
			`Basic ${ONE}`,
			ONE,
			`Bearer ${ONE} extra`,
			`Bearer ${ONE},Bearer ${TWO}`,
			`Bearer ${ONE}é`,
			`Bearer ${"a".repeat(300)}`,
			`Bearer ${"a".repeat(10_000)}`,
		]) {
			assert.equal(keys.check(header), "none", String(header).slice(0, 40));
		}
	});

	test("rotation: a list holds exactly its keys", ({ assert }) => {
		assert.equal(new ServerKeys([TWO]).check(`Bearer ${ONE}`), "unknown");
		assert.equal(new ServerKeys([TWO]).check(`Bearer ${TWO}`), "match");
		assert.equal(new ServerKeys([]).check(`Bearer ${ONE}`), "unknown");
	});

	test("every configured key is compared in constant time, whichever matches", ({
		assert,
	}) => {
		const keys = new ServerKeys([ONE, TWO]);
		const compare = mock.method(crypto, "timingSafeEqual");
		for (const header of [
			`Bearer ${ONE}`,
			`Bearer ${TWO}`,
			`Bearer ${"z".repeat(43)}`,
		]) {
			compare.mock.resetCalls();
			keys.check(header);
			assert.equal(compare.mock.callCount(), 2, header);
			for (const call of compare.mock.calls) {
				assert.lengthOf(call.arguments[0] as Buffer, 32);
				assert.lengthOf(call.arguments[1] as Buffer, 32);
			}
		}
		compare.mock.resetCalls();
		keys.check(`Basic ${ONE}`);
		assert.equal(compare.mock.callCount(), 0);
	});
});

test.group("visitorIp", () => {
	test("a single public IP literal is the visitor", ({ assert }) => {
		for (const [value, expected] of [
			["203.0.113.7", "203.0.113.7"],
			[" 203.0.113.7 ", "203.0.113.7"],
			["2001:db8::1", "2001:db8::1"],
			["8.8.8.8", "8.8.8.8"],
			["::ffff:203.0.113.7", "::ffff:203.0.113.7"],
		]) {
			assert.equal(visitorIp(value), expected, value);
		}
	});

	test("lists, ports, brackets, zones and junk are no visitor", ({
		assert,
	}) => {
		for (const value of [
			undefined,
			"",
			" ",
			"203.0.113.7, 198.51.100.1",
			"203.0.113.7 198.51.100.1",
			"203.0.113.7:443",
			"[2001:db8::1]",
			"fe80::1%eth0",
			"2001:db8::1%1",
			"localhost",
			"203.0.113",
			"x".repeat(46),
		]) {
			assert.isNull(visitorIp(value), String(value));
		}
	});

	test("addresses that can't be a visitor's public address are no visitor", ({
		assert,
	}) => {
		for (const value of [
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"127.0.0.1",
			"169.254.1.1",
			"100.64.0.1",
			"100.127.255.255",
			"0.0.0.0",
			"192.0.0.8",
			"198.18.0.1",
			"224.0.0.1",
			"255.255.255.255",
			"::1",
			"::",
			"fc00::1",
			"fd12:3456::1",
			"fe80::1",
			"ff02::1",
			"::ffff:10.0.0.1",
			"::ffff:127.0.0.1",
			"::ffff:a00:1",
		]) {
			assert.isFalse(isPublicAddress(value), value);
			assert.isNull(visitorIp(value), value);
		}
	});

	test("public neighbours of those ranges are visitors", ({ assert }) => {
		for (const value of [
			"100.128.0.1",
			"172.32.0.1",
			"11.0.0.1",
			"198.20.0.1",
			"2001:4860::8888",
		]) {
			assert.isTrue(isPublicAddress(value), value);
			assert.equal(visitorIp(value), value);
		}
	});
});
