import { test } from "@japa/runner";
import {
	AUTH_LIMITS,
	loginEmailKey,
	loginIpKey,
} from "#modules/identity/services/auth_limits";

test.group("Auth limits", () => {
	test("one address can't lock an account on its own", ({ assert }) => {
		// With equal fixed windows, one email window overlaps at most two
		// windows of one address, so that address adds at most 2 × 10 failures.
		assert.equal(
			AUTH_LIMITS.loginPerEmail.duration,
			AUTH_LIMITS.loginPerIp.duration,
		);
		assert.isAbove(
			AUTH_LIMITS.loginPerEmail.requests,
			2 * AUTH_LIMITS.loginPerIp.requests,
		);
	});

	test("keys hold digests, never the email or address", ({ assert }) => {
		const email = loginEmailKey(" Ink@Example.com ");
		const ip = loginIpKey("203.0.113.7");

		assert.match(email, /^login_email_[A-Za-z0-9_-]{43}$/);
		assert.match(ip, /^login_ip_[A-Za-z0-9_-]{43}$/);
		assert.notInclude(email, "example");
		assert.notInclude(ip, "203.0.113");
		assert.equal(email, loginEmailKey("ink@example.com"));
		assert.equal(ip, loginIpKey("::ffff:203.0.113.7"));
		assert.equal(loginIpKey("2001:db8:1:2::1"), loginIpKey("2001:db8:1:2::2"));
		assert.notEqual(
			loginIpKey("2001:db8:1:2::1"),
			loginIpKey("2001:db8:1:3::1"),
		);
	});
});
