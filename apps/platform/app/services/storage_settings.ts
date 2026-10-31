/**
 * The R2 settings as start/env.ts reads them (TAT-27): where the two drive
 * disks (`public` and `private`, config/drive.ts) keep photos. None of the
 * six set means the local folders, which is for development and tests; all
 * six mean Cloudflare R2, two buckets under one account. Production refuses
 * the local folders, because a photo stored on the server's disk is lost
 * with the server. A partial set is always an error. An error names the
 * setting, never its value: the secret key must not reach a log. Imports
 * nothing from the app.
 */
export const R2_SETTINGS = [
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
	"R2_PUBLIC_BUCKET",
	"R2_PRIVATE_BUCKET",
	"R2_PUBLIC_URL",
] as const;

export type R2Settings = {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	publicBucket: string;
	privateBucket: string;
	/** An https origin ending in a slash: where the public bucket is served. */
	publicUrl: string;
};

export type StorageSettings = { kind: "local" } | ({ kind: "r2" } & R2Settings);

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function checkStorageSettings(
	values: Partial<Record<(typeof R2_SETTINGS)[number], string | undefined>>,
	production: boolean,
): StorageSettings {
	const trimmed = R2_SETTINGS.map((key) => values[key]?.trim() ?? "");
	const missing = R2_SETTINGS.filter((_, index) => trimmed[index] === "");

	if (missing.length === R2_SETTINGS.length) {
		if (production) {
			throw new Error(
				`${R2_SETTINGS.join(", ")} are required in production: photos are never stored on the server's disk`,
			);
		}
		return { kind: "local" };
	}
	if (missing.length > 0) {
		throw new Error(
			`Missing R2 settings: ${missing.join(", ")} (set all six or none)`,
		);
	}

	const [
		accountId,
		accessKeyId,
		secretAccessKey,
		publicBucket,
		privateBucket,
		publicUrl,
	] = trimmed;

	if (!ACCOUNT_ID.test(accountId)) {
		throw new Error(
			"R2_ACCOUNT_ID must be the 32-character account ID (lowercase hex) from the Cloudflare dashboard, not a URL",
		);
	}
	for (const [key, bucket] of [
		["R2_PUBLIC_BUCKET", publicBucket],
		["R2_PRIVATE_BUCKET", privateBucket],
	] as const) {
		if (!BUCKET.test(bucket)) {
			throw new Error(
				`${key} must be an R2 bucket name: 3 to 63 lowercase letters, digits or hyphens, starting and ending with a letter or digit`,
			);
		}
	}
	if (publicBucket === privateBucket) {
		throw new Error(
			"R2_PUBLIC_BUCKET and R2_PRIVATE_BUCKET must be different buckets: the private one must never be served publicly",
		);
	}

	return {
		kind: "r2",
		accountId,
		accessKeyId,
		secretAccessKey,
		publicBucket,
		privateBucket,
		publicUrl: httpsOrigin(publicUrl),
	};
}

function httpsOrigin(value: string): string {
	const url = URL.parse(value);
	if (
		!url ||
		url.protocol !== "https:" ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"R2_PUBLIC_URL must be an https origin with no path, e.g. https://media.tattoodrip.app",
		);
	}
	return `${url.origin}/`;
}
