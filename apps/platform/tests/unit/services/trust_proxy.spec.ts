import { test } from "@japa/runner";
import { http, trustedProxies } from "#config/app";
import { checkTrustProxy } from "#services/trust_proxy";

const KEY = "TRUST_PROXY";

test.group("TRUST_PROXY at boot", () => {
	test("names, addresses and ranges, normalized", ({ assert }) => {
		assert.equal(checkTrustProxy(KEY, "loopback", true), "loopback");
		assert.equal(
			checkTrustProxy(
				KEY,
				" loopback ,10.0.0.0/8, 2001:db8::/32 ,192.0.2.10 ",
				true,
			),
			"loopback, 10.0.0.0/8, 2001:db8::/32, 192.0.2.10",
		);
		assert.equal(
			checkTrustProxy(KEY, "linklocal, uniquelocal", false),
			"linklocal, uniquelocal",
		);
	});

	test("refuses trusting everyone and anything that isn't a proxy address", ({
		assert,
	}) => {
		for (const value of [
			"true",
			"*",
			"all",
			"0.0.0.0/0",
			"::/0",
			"10.0.0.0/33",
			"fe80::/129",
			"10.0.0.0/8/1",
			"10.0.0.0/x",
			"example.com",
			"loopback,",
			"10.0.0.1:80",
			"[::1]",
		]) {
			assert.throws(
				() => checkTrustProxy(KEY, value, false),
				/TRUST_PROXY must list/,
				value,
			);
		}
	});

	test("optional outside production, required in production", ({ assert }) => {
		for (const value of [undefined, "", " "]) {
			assert.isUndefined(checkTrustProxy(KEY, value, false));
			assert.throws(
				() => checkTrustProxy(KEY, value, true),
				/TRUST_PROXY is required in production/,
			);
		}
	});

	test("unset (as in tests), the app trusts loopback only", ({ assert }) => {
		assert.isTrue(http.trustProxy("127.0.0.1", 0));
		assert.isTrue(http.trustProxy("::1", 0));
		assert.isFalse(http.trustProxy("10.1.2.3", 0));
	});

	test("a list is believed entry by entry (proxy-addr takes a string as one entry)", ({
		assert,
	}) => {
		const trust = trustedProxies(
			"loopback, 10.0.0.0/8, 2001:db8::/32, 192.0.2.10",
		);
		for (const ip of [
			"127.0.0.1",
			"::1",
			"10.1.2.3",
			"2001:db8::5",
			"192.0.2.10",
		]) {
			assert.isTrue(trust(ip, 0), ip);
		}
		for (const ip of [
			"192.0.2.11",
			"203.0.113.1",
			"172.16.0.1",
			"2001:db9::1",
		]) {
			assert.isFalse(trust(ip, 0), ip);
		}
		const local = trustedProxies("linklocal, uniquelocal");
		assert.isTrue(local("169.254.1.1", 0));
		assert.isTrue(local("192.168.1.1", 0));
		assert.isFalse(local("127.0.0.1", 0));
	});
});
