import { errors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import {
	AUTH_LIMITS,
	passwordCheckIpKey,
	passwordCheckUserKey,
	throttlePasswordCheck,
} from "#modules/identity/services/auth_limits";
import { throttleSignOutOthers } from "#start/limiter";

const IP = "203.0.113.150";
const A = "0195f3a0-0000-7000-8000-0000000000a1";
const B = "0195f3a0-0000-7000-8000-0000000000b1";
const C = "0195f3a0-0000-7000-8000-0000000000c1";

/** Points left in a window (the limiter has no remaining(key): read what was consumed). */
async function left(
	limit: { requests: number; duration: string },
	key: string,
) {
	const window = await limiter.use({ ...limit }).get(key);
	return limit.requests - (window?.consumed ?? 0);
}

/** A check that counts how often it ran and answers `right`. */
function check(right: boolean) {
	const state = { ran: 0 };
	return {
		state,
		verify: async () => {
			state.ran += 1;
			return right;
		},
	};
}

// Functional suite: tests/bootstrap.ts empties the memory store before each test.
test.group("Current password checks are counted (TAT-95)", () => {
	test("the numbers: 5 wrong per account and 10 per address in 15 minutes, 10 sign-outs an hour", ({
		assert,
	}) => {
		assert.deepEqual(AUTH_LIMITS.passwordCheckPerUser, {
			requests: 5,
			duration: "15 mins",
		});
		assert.deepEqual(AUTH_LIMITS.passwordCheckPerIp, {
			requests: 10,
			duration: "15 mins",
		});
		assert.deepEqual(AUTH_LIMITS.signOutOthersPerUser, {
			requests: 10,
			duration: "1 hour",
		});
		assert.isFunction(throttleSignOutOthers);
	});

	test("keys hold digests, never the address or the account id", ({
		assert,
	}) => {
		const ip = passwordCheckIpKey(IP);
		const user = passwordCheckUserKey(A);
		assert.match(ip, /^password_check_ip_[A-Za-z0-9_-]{43}$/);
		assert.match(user, /^password_check_user_[A-Za-z0-9_-]{43}$/);
		assert.notInclude(ip, "203.0.113");
		assert.notInclude(user, A);
	});

	test("five wrong checks pass through; the sixth is refused without checking", async ({
		assert,
	}) => {
		const wrong = check(false);
		for (let i = 0; i < 5; i++) {
			assert.isFalse(await throttlePasswordCheck(IP, A, wrong.verify));
		}
		await assert.rejects(
			() => throttlePasswordCheck(IP, A, wrong.verify),
			errors.E_TOO_MANY_REQUESTS,
		);
		assert.equal(wrong.state.ran, 5);
	});

	test("ten wrong checks from one address pass; the eleventh, for a third account, is refused unchecked and not counted against that account", async ({
		assert,
	}) => {
		const wrong = check(false);
		for (let i = 0; i < 5; i++) {
			await throttlePasswordCheck(IP, A, wrong.verify);
			await throttlePasswordCheck(IP, B, wrong.verify);
		}
		await assert.rejects(
			() => throttlePasswordCheck(IP, C, wrong.verify),
			errors.E_TOO_MANY_REQUESTS,
		);
		assert.equal(wrong.state.ran, 10);
		// The address is counted first, so the refused try never touched account C.
		assert.equal(
			await left(AUTH_LIMITS.passwordCheckPerUser, passwordCheckUserKey(C)),
			5,
		);
	});

	test("a right check gives its two points back; wrong ones stay counted", async ({
		assert,
	}) => {
		const wrong = check(false);
		const right = check(true);
		for (let i = 0; i < 4; i++) {
			await throttlePasswordCheck(IP, A, wrong.verify);
		}
		assert.isTrue(await throttlePasswordCheck(IP, A, right.verify));

		assert.equal(
			await left(AUTH_LIMITS.passwordCheckPerUser, passwordCheckUserKey(A)),
			1,
		);
		assert.equal(
			await left(AUTH_LIMITS.passwordCheckPerIp, passwordCheckIpKey(IP)),
			6,
		);
	});

	test("a different account from the same address keeps its own five", async ({
		assert,
	}) => {
		const wrong = check(false);
		for (let i = 0; i < 5; i++) {
			await throttlePasswordCheck(IP, A, wrong.verify);
		}
		assert.isFalse(await throttlePasswordCheck(IP, B, wrong.verify));
	});
});
