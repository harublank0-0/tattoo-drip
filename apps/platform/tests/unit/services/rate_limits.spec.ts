import { createHash } from "node:crypto";
import { test } from "@japa/runner";
import { http } from "#config/app";
import { clientAddress, digest, tryAgainMessage } from "#services/rate_limits";

test.group("clientAddress", () => {
	test("keeps an IPv4 address, also written IPv4-mapped", ({ assert }) => {
		assert.equal(clientAddress("203.0.113.7"), "203.0.113.7");
		assert.equal(clientAddress("::ffff:203.0.113.7"), "203.0.113.7");
		assert.equal(clientAddress("::FFFF:cb00:7107"), "203.0.113.7");
	});

	test("counts an IPv6 address by its /64", ({ assert }) => {
		for (const ip of [
			"2001:db8:1:2::9",
			"2001:db8:1:2:3:4:5:6",
			"2001:DB8:1:2::1",
			"2001:0db8:0001:0002::1",
		]) {
			assert.equal(clientAddress(ip), "2001:db8:1:2::/64", ip);
		}
		assert.equal(clientAddress("2001:db8:1:3::1"), "2001:db8:1:3::/64");
		assert.equal(clientAddress("2001:db8::"), "2001:db8:0:0::/64");
		assert.equal(clientAddress("fe80::1%eth0"), "fe80:0:0:0::/64");
	});

	test("returns anything else as it is", ({ assert }) => {
		assert.equal(clientAddress("unknown"), "unknown");
		assert.equal(clientAddress(""), "");
	});
});

test.group("digest", () => {
	test("is a keyed, fixed-length digest that hides its input", ({ assert }) => {
		const value = digest("ink@example.com");

		assert.match(value, /^[A-Za-z0-9_-]{43}$/);
		assert.equal(digest("ink@example.com"), value);
		assert.notEqual(digest("ink2@example.com"), value);
		assert.notEqual(
			value,
			createHash("sha256").update("ink@example.com").digest("base64url"),
		);
		assert.lengthOf(digest(`${"a".repeat(242)}@example.com`), 43);
	});
});

test.group("tryAgainMessage", () => {
	test("rounds up to whole minutes, at least one", ({ assert }) => {
		assert.equal(
			tryAgainMessage(0),
			"Too many attempts. Try again in 1 minute.",
		);
		assert.equal(
			tryAgainMessage(60),
			"Too many attempts. Try again in 1 minute.",
		);
		assert.equal(
			tryAgainMessage(61),
			"Too many attempts. Try again in 2 minutes.",
		);
		assert.equal(
			tryAgainMessage(899),
			"Too many attempts. Try again in 15 minutes.",
		);
		assert.equal(
			tryAgainMessage(3600),
			"Too many attempts. Try again in 60 minutes.",
		);
	});
});

test.group("Client address trust", () => {
	test("X-Forwarded-For counts only from a loopback proxy", ({ assert }) => {
		assert.isTrue(http.trustProxy("127.0.0.1", 0));
		assert.isTrue(http.trustProxy("::1", 0));
		for (const peer of ["203.0.113.9", "10.0.0.2", "192.168.1.20"]) {
			assert.isFalse(http.trustProxy(peer, 0), peer);
		}
	});
});
