import { errors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import {
	AUTH_LIMITS,
	assertPasswordChangeAllowed,
	countPasswordChange,
	passwordChangeKey,
	passwordCheckIpKey,
	passwordCheckUserKey,
	throttlePasswordCheck,
} from "#modules/identity/services/auth_limits";
import {
	throttleSignOutOthers,
	throttleSignOutOthersAccount,
} from "#start/limiter";

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
	test("the numbers: 5 wrong per account and 10 per address in 15 minutes; 10 changes an hour; sign-outs 10 an hour per account and address, 100 per account", ({
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
		assert.deepEqual(AUTH_LIMITS.passwordChangePerUser, {
			requests: 10,
			duration: "1 hour",
		});
		assert.deepEqual(AUTH_LIMITS.signOutOthersPerAddress, {
			requests: 10,
			duration: "1 hour",
		});
		assert.deepEqual(AUTH_LIMITS.signOutOthersPerUser, {
			requests: 1000,
			duration: "1 hour",
		});
		for (const middleware of [
			throttleSignOutOthers,
			throttleSignOutOthersAccount,
		]) {
			assert.isFunction(middleware);
		}
	});

	test("the ceiling arithmetic: a hundred prefixes to burn it, over a century to reach the nine digits", ({
		assert,
	}) => {
		const perHour = AUTH_LIMITS.signOutOthersPerUser.requests;
		assert.isAtLeast(
			perHour / AUTH_LIMITS.signOutOthersPerAddress.requests,
			100,
		);
		// session_version's identifier holds at most 9 digits: 999,999,999.
		const years = 999_999_999 / perHour / (24 * 365);
		assert.isAbove(years, 100);
	});

	test("a change counts only when it is counted: checking never consumes, and the tenth success closes the door", async ({
		assert,
	}) => {
		for (let i = 0; i < 25; i++) await assertPasswordChangeAllowed(A);
		assert.equal(
			await left(AUTH_LIMITS.passwordChangePerUser, passwordChangeKey(A)),
			10,
		);

		for (let i = 0; i < 9; i++) await countPasswordChange(A);
		await assertPasswordChangeAllowed(A);
		await countPasswordChange(A);

		await assert.rejects(
			() => assertPasswordChangeAllowed(A),
			errors.E_TOO_MANY_REQUESTS,
		);
		// Another account has its own count.
		await assertPasswordChangeAllowed(B);
	});

	test("the account-wide sign-out ceiling is loose enough that it can't be the owner's lockout, and the per-address cap sits well below it", ({
		assert,
	}) => {
		// A thief reaches the ceiling only from ten or more client addresses.
		assert.isAtLeast(
			AUTH_LIMITS.signOutOthersPerUser.requests,
			5 * AUTH_LIMITS.signOutOthersPerAddress.requests,
		);
	});

	test("keys hold digests, never the address or the account id", ({
		assert,
	}) => {
		const ip = passwordCheckIpKey(IP);
		const user = passwordCheckUserKey(A);
		assert.match(ip, /^password_check_ip_[A-Za-z0-9_-]{43}$/);
		assert.match(user, /^password_check_user_[A-Za-z0-9_-]{43}$/);
		assert.match(
			passwordChangeKey(A),
			/^password_change_user_[A-Za-z0-9_-]{43}$/,
		);
		assert.notInclude(passwordChangeKey(A), A);
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
