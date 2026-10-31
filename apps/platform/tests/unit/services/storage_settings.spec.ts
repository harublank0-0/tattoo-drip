import { test } from "@japa/runner";
import { checkStorageSettings } from "#services/storage_settings";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

const VALID = {
	R2_ACCOUNT_ID: ACCOUNT_ID,
	R2_ACCESS_KEY_ID: "access-key-id",
	R2_SECRET_ACCESS_KEY: "secret-access-key",
	R2_PUBLIC_BUCKET: "tattoo-drip-public",
	R2_PRIVATE_BUCKET: "tattoo-drip-private",
	R2_PUBLIC_URL: "https://media.tattoodrip.app",
};

test.group("R2 settings at boot (TAT-27)", () => {
	test("no R2 setting outside production means local folders", ({ assert }) => {
		assert.deepEqual(checkStorageSettings({}, false), { kind: "local" });
		assert.deepEqual(
			checkStorageSettings(
				{
					R2_ACCOUNT_ID: "",
					R2_ACCESS_KEY_ID: "  ",
					R2_SECRET_ACCESS_KEY: "",
					R2_PUBLIC_BUCKET: "  ",
					R2_PRIVATE_BUCKET: "",
					R2_PUBLIC_URL: " ",
				},
				false,
			),
			{ kind: "local" },
		);
	});

	test("production refuses local folders", ({ assert }) => {
		assert.throws(
			() => checkStorageSettings({}, true),
			/are required in production: photos are never stored on the server's disk/,
		);
		assert.throws(
			() => checkStorageSettings({ R2_ACCOUNT_ID: " " }, true),
			/are required in production: photos are never stored on the server's disk/,
		);
	});

	test("some settings without the others name the missing ones", ({
		assert,
	}) => {
		for (const production of [false, true]) {
			assert.throws(
				() =>
					checkStorageSettings(
						{
							R2_ACCOUNT_ID: ACCOUNT_ID,
							R2_PUBLIC_BUCKET: "tattoo-drip-public",
						},
						production,
					),
				/Missing R2 settings: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PRIVATE_BUCKET, R2_PUBLIC_URL \(set all six or none\)/,
			);
		}
	});

	test("all six give the R2 settings, trimmed, the public URL as an origin with a slash", ({
		assert,
	}) => {
		const expected = {
			kind: "r2",
			accountId: ACCOUNT_ID,
			accessKeyId: "access-key-id",
			secretAccessKey: "secret-access-key",
			publicBucket: "tattoo-drip-public",
			privateBucket: "tattoo-drip-private",
			publicUrl: "https://media.tattoodrip.app/",
		};
		assert.deepEqual(
			checkStorageSettings(
				{
					R2_ACCOUNT_ID: ` ${ACCOUNT_ID} `,
					R2_ACCESS_KEY_ID: " access-key-id ",
					R2_SECRET_ACCESS_KEY: " secret-access-key ",
					R2_PUBLIC_BUCKET: " tattoo-drip-public ",
					R2_PRIVATE_BUCKET: " tattoo-drip-private ",
					R2_PUBLIC_URL: " https://media.tattoodrip.app ",
				},
				true,
			),
			expected,
		);
		assert.deepEqual(
			checkStorageSettings(
				{ ...VALID, R2_PUBLIC_URL: "https://media.tattoodrip.app/" },
				false,
			),
			expected,
		);
	});

	test("refuses an account ID that is not 32 hex characters", ({ assert }) => {
		for (const accountId of [
			ACCOUNT_ID.slice(1),
			ACCOUNT_ID.toUpperCase(),
			`https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
		]) {
			assert.throws(
				() =>
					checkStorageSettings({ ...VALID, R2_ACCOUNT_ID: accountId }, true),
				/R2_ACCOUNT_ID must be the 32-character account ID/,
				accountId,
			);
		}
	});

	test("refuses a bad bucket name", ({ assert }) => {
		for (const key of ["R2_PUBLIC_BUCKET", "R2_PRIVATE_BUCKET"] as const) {
			for (const bucket of ["Tattoo_Drip", "ab", "-abc"]) {
				assert.throws(
					() => checkStorageSettings({ ...VALID, [key]: bucket }, true),
					new RegExp(`${key} must be an R2 bucket name`),
					`${key} ${bucket}`,
				);
			}
		}
	});

	test("refuses one bucket for both", ({ assert }) => {
		assert.throws(
			() =>
				checkStorageSettings(
					{ ...VALID, R2_PRIVATE_BUCKET: VALID.R2_PUBLIC_BUCKET },
					true,
				),
			/R2_PUBLIC_BUCKET and R2_PRIVATE_BUCKET must be different buckets/,
		);
	});

	test("refuses a public URL that is not an https origin", ({ assert }) => {
		for (const publicUrl of [
			"http://media.tattoodrip.app",
			"https://media.tattoodrip.app/photos",
			"https://media.tattoodrip.app/?a=1",
			"media.tattoodrip.app",
		]) {
			assert.throws(
				() =>
					checkStorageSettings({ ...VALID, R2_PUBLIC_URL: publicUrl }, true),
				/R2_PUBLIC_URL must be an https origin with no path, e.g. https:\/\/media.tattoodrip.app/,
				publicUrl,
			);
		}
	});

	test("an error never prints the secret", ({ assert }) => {
		const secret = "secret-canary-123";
		const failing = [
			{ R2_ACCOUNT_ID: "nope" },
			{ R2_PUBLIC_BUCKET: "Tattoo_Drip" },
			{ R2_PRIVATE_BUCKET: VALID.R2_PUBLIC_BUCKET },
			{ R2_PUBLIC_URL: "http://media.tattoodrip.app" },
			{ R2_ACCESS_KEY_ID: undefined },
			{ R2_PRIVATE_BUCKET: undefined },
		];
		for (const override of failing) {
			let message = "";
			try {
				checkStorageSettings(
					{ ...VALID, R2_SECRET_ACCESS_KEY: secret, ...override },
					true,
				);
			} catch (error) {
				message = (error as Error).message;
			}
			assert.isNotEmpty(message, JSON.stringify(override));
			assert.notInclude(message, secret);
		}
	});
});
