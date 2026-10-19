import { mock } from "node:test";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import {
	AUTH_LIMITS,
	clearLoginFailures,
	emailCountKey,
	loginEmailKey,
	loginIpKey,
	throttleLogin,
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

test.group("Auth limits: refunds", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));
	group.each.teardown(() => mock.timers.reset());

	test("a refund that lands after its window ended leaves the new window alone", async ({
		assert,
	}) => {
		const ip = "203.0.113.70";
		const email = "ink@example.com";
		mock.timers.enable({ apis: ["Date"], now: Date.now() });

		const user = await throttleLogin(ip, email, async () => {
			// A slow credential check: its window ends, a new one opens and
			// takes five failures, then the check succeeds.
			mock.timers.tick(16 * 60 * 1000);
			for (let i = 0; i < 5; i++) {
				await throttleLogin(ip, email, async () => {
					throw new Error("wrong password");
				}).catch(() => {});
			}
			return "user";
		});

		assert.equal(user, "user");
		const address = await limiter
			.use({ ...AUTH_LIMITS.loginPerIp })
			.get(loginIpKey(ip));
		const account = await limiter
			.use({ ...AUTH_LIMITS.loginPerEmail })
			.get(loginEmailKey(email));
		assert.equal(address?.consumed, 5);
		assert.equal(account?.consumed, 5);
	});
});

test.group("Auth limits: account emails (TAT-18)", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));

	test("an address's count ignores case and spaces and holds only a digest", ({
		assert,
	}) => {
		const key = emailCountKey(" Ink@Example.com ");

		assert.match(key, /^[A-Za-z0-9_-]{43}$/);
		assert.notInclude(key, "example");
		assert.equal(key, emailCountKey("ink@example.com"));
		assert.equal(loginEmailKey("ink@example.com"), `login_email_${key}`);
	});

	test("the key follows canonicalEmail: ASCII case folds, other letters keep theirs", ({
		assert,
	}) => {
		// Two accounts whose addresses differ only in non-ASCII case are two
		// accounts (ruling 8), so they must not share a count.
		assert.notEqual(
			emailCountKey("Éva@example.com"),
			emailCountKey("éva@example.com"),
		);
		assert.notEqual(
			emailCountKey("bob@Éxample.com"),
			emailCountKey("bob@éxample.com"),
		);
		assert.equal(
			emailCountKey("EVA@example.com"),
			emailCountKey("eva@example.com"),
		);
		// Typed whitespace of any kind is cleaned first, as the validator does.
		assert.equal(
			emailCountKey(" \tEva@Example.com\n"),
			emailCountKey("eva@example.com"),
		);
	});

	test("a completed reset clears the login failures of the stored address, and nothing else", async ({
		assert,
	}) => {
		const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
		const perIp = limiter.use({ ...AUTH_LIMITS.loginPerIp });
		await perEmail.increment(loginEmailKey("ink@example.com"), 5);
		await perEmail.increment(loginEmailKey("other@example.com"), 2);
		await perIp.increment(loginIpKey("203.0.113.80"), 4);

		await clearLoginFailures("ink@example.com");

		assert.isNull(await perEmail.get(loginEmailKey("ink@example.com")));
		assert.equal(
			(await perEmail.get(loginEmailKey("other@example.com")))?.consumed,
			2,
		);
		assert.equal((await perIp.get(loginIpKey("203.0.113.80")))?.consumed, 4);
	});
});
