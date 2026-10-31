import { S3Driver } from "@adonisjs/drive/drivers/s3";
import { test } from "@japa/runner";
import {
	checkStorageSettings,
	r2DiskOptions,
} from "#services/storage_settings";

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

test.group("R2 disks (TAT-27)", () => {
	const settings = (() => {
		const checked = checkStorageSettings(VALID, true);
		if (checked.kind !== "r2") throw new Error("the valid settings are R2");
		return checked;
	})();
	const endpoint = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
	const credentials = {
		accessKeyId: "access-key-id",
		secretAccessKey: "secret-access-key",
	};

	test("public disk: the bucket, R2's endpoint, no ACLs and the media origin", ({
		assert,
	}) => {
		assert.deepEqual(r2DiskOptions(settings, "public"), {
			credentials,
			region: "auto",
			endpoint,
			bucket: "tattoo-drip-public",
			visibility: "public",
			supportsACL: false,
			cdnUrl: "https://media.tattoodrip.app/",
		});
	});

	test("private disk: the private bucket and no public URL", ({ assert }) => {
		const options = r2DiskOptions(settings, "private");

		assert.deepEqual(options, {
			credentials,
			region: "auto",
			endpoint,
			bucket: "tattoo-drip-private",
			visibility: "private",
			supportsACL: false,
		});
		assert.notProperty(options, "cdnUrl");
	});

	test("a public URL is on the media origin", async ({ assert }) => {
		const driver = new S3Driver(r2DiskOptions(settings, "public"));

		assert.equal(
			await driver.getUrl("tenants/t1/artist_work_photo/a.jpg"),
			"https://media.tattoodrip.app/tenants/t1/artist_work_photo/a.jpg",
		);
	});

	test("a private signed URL is R2's, for 5 minutes", async ({ assert }) => {
		const driver = new S3Driver(r2DiskOptions(settings, "private"));

		const url = new URL(
			await driver.getSignedUrl("tenants/t1/reference_image/a.jpg", {
				expiresIn: "5 minutes",
			}),
		);

		// The SDK's default is virtual-hosted style, which R2 accepts: the
		// bucket is a subdomain of the account's host, the path is the key.
		assert.equal(
			url.host,
			`tattoo-drip-private.${ACCOUNT_ID}.r2.cloudflarestorage.com`,
		);
		assert.equal(url.pathname, "/tenants/t1/reference_image/a.jpg");
		assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
	});
});
