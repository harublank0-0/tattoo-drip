import { test } from "@japa/runner";
import {
	DEPOSIT_LIMITS,
	depositLimitKeys,
} from "#modules/payments/deposit_limits";
import { clientAddress, digest } from "#services/rate_limits";

const TOKEN = "T".repeat(43);
const IP = "203.0.113.7";

test.group("Deposit rate limits", () => {
	test("reads per 10 minutes, uploads per hour, per address and per token", ({
		assert,
	}) => {
		assert.deepEqual(DEPOSIT_LIMITS, {
			read: {
				perAddress: { requests: 120, duration: "10 mins" },
				perToken: { requests: 60, duration: "10 mins" },
			},
			submit: {
				perAddress: { requests: 20, duration: "1 hour" },
				perToken: { requests: 10, duration: "1 hour" },
			},
		});
	});

	test("the keys are digests: no address and no token in them", ({
		assert,
	}) => {
		const keys = depositLimitKeys("read", IP, TOKEN);

		assert.deepEqual(keys, {
			perAddress: `deposit_read_ip_${digest(IP)}`,
			perToken: `deposit_read_token_${digest(TOKEN)}`,
		});
		for (const key of Object.values(keys)) {
			assert.notInclude(key, IP);
			assert.notInclude(key, TOKEN);
			assert.isAtMost(key.length, 255);
		}
	});

	test("reads and uploads count apart; one IPv6 /64 is one address", ({
		assert,
	}) => {
		assert.notEqual(
			depositLimitKeys("read", IP, TOKEN).perToken,
			depositLimitKeys("submit", IP, TOKEN).perToken,
		);
		assert.equal(
			depositLimitKeys("read", "2001:db8:1:2::1", TOKEN).perAddress,
			depositLimitKeys("read", "2001:db8:1:2:ffff::9", TOKEN).perAddress,
		);
		assert.equal(
			depositLimitKeys("read", "2001:db8:1:2::1", TOKEN).perAddress,
			`deposit_read_ip_${digest(clientAddress("2001:db8:1:2::1"))}`,
		);
	});
});
