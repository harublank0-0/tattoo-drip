import { mock } from "node:test";
import { errors as limiterErrors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import {
	countIntake,
	INTAKE_LIMITS,
	intakeLimitKeys,
	intakePhoneKey,
} from "#modules/inquiries/intake_limits";
import { clientAddress, digest } from "#services/rate_limits";

const A = "0195f3a0-0000-7000-8000-0000000000a5";
const B = "0195f3a0-0000-7000-8000-0000000000b5";
const IP = "203.0.113.55";
const PHONE = "+9779812345678";

test.group("Intake rate limits", () => {
	test("20 per address and 60 per studio an hour, 10 per phone a day", ({
		assert,
	}) => {
		assert.deepEqual(INTAKE_LIMITS, {
			perAddress: { requests: 20, duration: "1 hour" },
			perTenant: { requests: 60, duration: "1 hour" },
			perPhone: { requests: 10, duration: "24 hours" },
		});
	});

	test("the keys are per studio and hold no address and no phone", ({
		assert,
	}) => {
		const keys = intakeLimitKeys(A, IP);
		const phone = intakePhoneKey(A, PHONE);

		assert.deepEqual(keys, {
			perAddress: `inquiry_ip_${digest(`${A}:${IP}`)}`,
			perTenant: `inquiry_tenant_${A}`,
		});
		assert.equal(phone, `inquiry_phone_${digest(`${A}:${PHONE}`)}`);
		for (const key of [...Object.values(keys), phone]) {
			assert.notInclude(key, IP);
			assert.notInclude(key, PHONE);
			assert.notInclude(key, PHONE.slice(1));
			assert.isAtMost(key.length, 255);
		}
		assert.notEqual(intakeLimitKeys(B, IP).perAddress, keys.perAddress);
		assert.notEqual(intakeLimitKeys(B, IP).perTenant, keys.perTenant);
		assert.notEqual(intakePhoneKey(B, PHONE), phone);
	});

	test("one IPv6 /64 is one address", ({ assert }) => {
		assert.equal(
			intakeLimitKeys(A, "2001:db8:1:2::1").perAddress,
			intakeLimitKeys(A, "2001:db8:1:2:ffff::9").perAddress,
		);
		assert.equal(
			intakeLimitKeys(A, "2001:db8:1:2::1").perAddress,
			`inquiry_ip_${digest(`${A}:${clientAddress("2001:db8:1:2::1")}`)}`,
		);
	});
});

test.group("Intake rate limits: windows", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));
	group.each.teardown(() => mock.timers.reset());

	for (const [limit, seconds] of [
		["perAddress", 3600],
		["perTenant", 3600],
		["perPhone", 86_400],
	] as const) {
		test(`${limit}: the try after ${INTAKE_LIMITS[limit].requests} is refused until its window ends`, async ({
			assert,
		}) => {
			mock.timers.enable({ apis: ["Date"], now: Date.now() });
			const key = `${limit}_window_spec_55`;
			for (let i = 0; i < INTAKE_LIMITS[limit].requests; i++) {
				await countIntake(limit, key);
			}

			await assert.rejects(
				() => countIntake(limit, key),
				limiterErrors.E_TOO_MANY_REQUESTS,
			);
			mock.timers.tick((seconds - 60) * 1000);
			await assert.rejects(
				() => countIntake(limit, key),
				limiterErrors.E_TOO_MANY_REQUESTS,
			);
			mock.timers.tick(61 * 1000);
			await countIntake(limit, key);
		});
	}
});
