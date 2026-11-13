import { Secret } from "@adonisjs/core/helpers";

/**
 * Checks the online-payment settings as start/env.ts reads them
 * (docs/payments-paybridgenp.md). Like the other checks there, it imports
 * nothing from the app and its messages never contain a value.
 */

const SECRET_KEY = /^sk_(?:test|live)_[A-Za-z0-9_-]{8,200}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9_-]{8,200}$/;

/** PAYBRIDGE_SECRET_KEY: TattooDrip's own billing project. Optional: unset, billing is off. */
export function checkPaybridgeKey(
	key: string,
	value: string | undefined,
): Secret<string> | undefined {
	if (!value?.trim()) return undefined;
	if (!SECRET_KEY.test(value.trim())) {
		throw new Error(
			`${key} must be a PayBridgeNP secret key (sk_test_… or sk_live_…), never a publishable key: copy it again from the PayBridgeNP dashboard`,
		);
	}
	return new Secret(value.trim());
}

/** PAYBRIDGE_WEBHOOK_SECRET: the platform webhook endpoint's signing secret. */
export function checkWebhookSecret(
	key: string,
	value: string | undefined,
): Secret<string> | undefined {
	if (!value?.trim()) return undefined;
	if (!WEBHOOK_SECRET.test(value.trim())) {
		throw new Error(
			`${key} must be the webhook endpoint's signing secret (whsec_…), shown once when the endpoint was created`,
		);
	}
	return new Secret(value.trim());
}

export const STUDIO_PAYMENT_MODES = ["disabled", "sandbox", "live"] as const;
export type StudioPaymentMode = (typeof STUDIO_PAYMENT_MODES)[number];

/** STUDIO_ONLINE_PAYMENTS: unset is `disabled`. */
export function checkStudioPaymentMode(
	key: string,
	value: string | undefined,
): StudioPaymentMode {
	const mode = value?.trim() || "disabled";
	if (!(STUDIO_PAYMENT_MODES as readonly string[]).includes(mode)) {
		throw new Error(`${key} must be disabled, sandbox or live`);
	}
	return mode as StudioPaymentMode;
}

/**
 * PAYMENT_CREDENTIALS_KEY: 32 random bytes in base64 (openssl rand -base64
 * 32), the key that encrypts studios' PayBridgeNP credentials at rest. Its
 * own key, not APP_KEY, so rotating APP_KEY never locks the credentials.
 */
export function checkCredentialsKey(
	key: string,
	value: string | undefined,
): Secret<Buffer> | undefined {
	if (!value?.trim()) return undefined;
	const bytes = Buffer.from(value.trim(), "base64");
	if (bytes.length !== 32 || bytes.toString("base64") !== value.trim()) {
		throw new Error(
			`${key} must be 32 random bytes in base64 (openssl rand -base64 32)`,
		);
	}
	return new Secret(bytes);
}

/** PLATFORM_ADMIN_EMAILS: comma-separated account emails, compared after canonicalising. */
export function checkAdminEmails(
	key: string,
	value: string | undefined,
): string[] {
	if (!value?.trim()) return [];
	const emails = value
		.split(",")
		.map((email) =>
			email.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
		)
		.filter(Boolean);
	for (const email of emails) {
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			throw new Error(
				`${key} must list account email addresses, comma-separated`,
			);
		}
	}
	return emails;
}

/**
 * The settings that only make sense together: a webhook secret with the
 * platform key, and the credentials key while studio payments are on.
 */
export function checkPaymentSettings(settings: {
	platformKey: boolean;
	webhookSecret: boolean;
	studioMode: StudioPaymentMode;
	credentialsKey: boolean;
}) {
	if (settings.platformKey && !settings.webhookSecret) {
		throw new Error(
			"PAYBRIDGE_WEBHOOK_SECRET is required with PAYBRIDGE_SECRET_KEY: billing is confirmed by signed webhooks",
		);
	}
	if (settings.studioMode !== "disabled" && !settings.credentialsKey) {
		throw new Error(
			"PAYMENT_CREDENTIALS_KEY is required while STUDIO_ONLINE_PAYMENTS is on: it encrypts each studio's PayBridgeNP key",
		);
	}
}
