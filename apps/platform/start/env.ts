/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from "@adonisjs/core/env";
import { checkAppOrigin } from "#services/app_origin";
import { checkChallengeSecret } from "#services/challenge_secret";
import {
	checkBflApiUrl,
	checkBflKey,
	checkBflModel,
	checkCreditsPerImage,
	checkDesignLabProvider,
	checkDesignLabSettings,
	checkMaxVariations,
	checkMonthlyLimit,
	designLabProvider,
} from "#services/design_lab_settings";
import {
	checkAdminEmails,
	checkCredentialsKey,
	checkPaybridgeKey,
	checkPaymentSettings,
	checkStudioPaymentMode,
	checkWebhookSecret,
} from "#services/payment_settings";
import { checkPlatformOrigins } from "#services/platform_origins";
import { checkServerKeys } from "#services/server_keys";
import { checkStorageSettings } from "#services/storage_settings";
import { checkStorefrontUrl } from "#services/storefront_url";
import { checkTrustProxy } from "#services/trust_proxy";

const env = await Env.create(new URL("../", import.meta.url), {
	// Node
	NODE_ENV: Env.schema.enum(["development", "production", "test"] as const),
	PORT: Env.schema.number(),
	// Video angles: how many times a worker puts a job it lost (stalled) back
	// in its queue before failing it (the queue's default is 1). The video
	// worker sets 3 (deploy/compose.yml): a transcode is long, and a restart
	// mid-job should not cost the video.
	QUEUE_MAX_STALLED_COUNT: Env.schema.number.optional(),
	HOST: Env.schema.string({ format: "host" }),
	LOG_LEVEL: Env.schema.string(),

	// App
	APP_KEY: Env.schema.secret(),
	APP_URL: Env.schema.string({ format: "url", tld: false }),
	// The public API's origin (Discover D01), e.g. https://api.example.com.
	// Unset, the API is served from APP_URL's host, as before. Set to another
	// host, that host serves /api only. The storefront's API_URL names the same
	// origin. Checked with DISCOVER_URL below.
	API_URL: (_key: string, value?: string) => value?.trim() || undefined,
	// The Discover site's origin (Discover D01), e.g. https://example.com: a
	// browser origin the API allows, never the dashboard's or the API's host.
	// Unset until Discover is deployed (docs/discover/domain-migration.md).
	DISCOVER_URL: (_key: string, value?: string) => value?.trim() || undefined,
	// The studio pages' origin with {tenant} for the slug, e.g.
	// https://{tenant}.example.com: deposit links are built from it (TAT-65).
	// Required in production; unset in development and tests it is
	// http://{tenant}.localhost:3000 (TAT-12's dev host).
	STOREFRONT_URL: (key: string, value?: string) =>
		checkStorefrontUrl(key, value, process.env.NODE_ENV === "production"),
	// The storefront server's key(s) (TAT-38): one, or two while rotating
	// (old,new). Only makes its server-side calls count per visitor.
	// Required in production; unset elsewhere, no key is accepted.
	STOREFRONT_SERVER_KEYS: (key: string, value?: string) =>
		checkServerKeys(key, value, process.env.NODE_ENV === "production"),
	// Discover's server key(s) (D11): its DISCOVER_SERVER_KEY, or two while
	// rotating. Like the storefront's, it only makes Discover's server-side
	// calls count per visitor. Optional: unset (or a key that doesn't match),
	// Discover's calls count as one anonymous client and a warning is logged.
	DISCOVER_SERVER_KEYS: (key: string, value?: string) =>
		checkServerKeys(key, value, false),
	// The reverse proxy whose X-Forwarded-For the app believes (TAT-38).
	// Required in production; unset elsewhere it is loopback.
	TRUST_PROXY: (key: string, value?: string) =>
		checkTrustProxy(key, value, process.env.NODE_ENV === "production"),
	// The secret key of the studio pages' Cloudflare Turnstile widget: the
	// intake's bot challenge (TAT-55). Required in production; unset in
	// development and tests, the check is off.
	TURNSTILE_SECRET_KEY: (key: string, value?: string) =>
		checkChallengeSecret(key, value, process.env.NODE_ENV === "production"),

	// Session
	SESSION_DRIVER: Env.schema.enum(["cookie", "memory", "database"] as const),

	// Database
	DB_HOST: Env.schema.string({ format: "host" }),
	DB_PORT: Env.schema.number(),
	DB_USER: Env.schema.string(),
	DB_PASSWORD: Env.schema.string.optional(),
	DB_MIGRATION_USER: Env.schema.string(),
	DB_MIGRATION_PASSWORD: Env.schema.string.optional(),
	DB_DATABASE: Env.schema.string(),

	// Photo storage (TAT-27): production keeps both drive disks on Cloudflare
	// R2, two buckets under one account. All six settings, or none: unset in
	// development and tests, photos go to local folders; production refuses
	// to start without them (checked below, once all six are read).
	R2_ACCOUNT_ID: Env.schema.string.optional(),
	R2_ACCESS_KEY_ID: Env.schema.string.optional(),
	R2_SECRET_ACCESS_KEY: Env.schema.secret.optional(),
	R2_PUBLIC_BUCKET: Env.schema.string.optional(),
	R2_PRIVATE_BUCKET: Env.schema.string.optional(),
	R2_PUBLIC_URL: Env.schema.string.optional(),

	// Mail (Mailpit in development; any provider's SMTP endpoint in production)
	MAIL_MAILER: Env.schema.enum(["smtp"] as const),
	MAIL_FROM_NAME: Env.schema.string(),
	MAIL_FROM_ADDRESS: Env.schema.string({ format: "email" }),
	SMTP_HOST: Env.schema.string({ format: "host" }),
	SMTP_PORT: Env.schema.number(),
	SMTP_USERNAME: Env.schema.string.optional(),
	SMTP_PASSWORD: Env.schema.string.optional(),
	// Staff alert emails (TAT-52): unset or true sends them; false keeps the
	// alerts in the dashboard only (until the sending domain exists, TAT-20).
	ALERT_EMAILS: Env.schema.boolean.optional(),

	// Reviews and Fresh ink (slice 1): the client's review page and its public
	// API routes. Off unless true: they stay off until the client content terms
	// (docs/legal/) are legally reviewed. Off, every review route is a 404 and
	// no review link can be made.
	REVIEWS_ENABLED: Env.schema.boolean.optional(),
	// Online payments through PayBridgeNP (docs/payments-paybridgenp.md).
	// TattooDrip's own project, for studios' subscriptions: its secret key and
	// its webhook endpoint's signing secret. Unset, subscription billing is off.
	PAYBRIDGE_SECRET_KEY: checkPaybridgeKey,
	PAYBRIDGE_WEBHOOK_SECRET: checkWebhookSecret,
	// Another API origin (a mock server in development); unset is PayBridgeNP's.
	PAYBRIDGE_API_URL: Env.schema.string.optional({ format: "url", tld: false }),
	// Studios' own customer payments: disabled (default), sandbox or live.
	STUDIO_ONLINE_PAYMENTS: checkStudioPaymentMode,
	// Encrypts studios' PayBridgeNP keys at rest: 32 bytes in base64.
	PAYMENT_CREDENTIALS_KEY: checkCredentialsKey,
	// Accounts that may open /admin (billing, studio payment reviews).
	PLATFORM_ADMIN_EMAILS: checkAdminEmails,

	// AI Design Lab (docs/design-lab.md, #services/design_lab_settings): the
	// image provider (off, preview or bfl), BFL's hosted FLUX API settings
	// (server only: never in props, logs or responses) and each studio's
	// monthly allowance.
	DESIGN_LAB_PROVIDER: checkDesignLabProvider,
	BFL_API_KEY: checkBflKey,
	BFL_API_URL: checkBflApiUrl,
	BFL_MODEL: checkBflModel,
	DESIGN_LAB_MONTHLY_LIMIT: checkMonthlyLimit,
	DESIGN_LAB_MAX_VARIATIONS: checkMaxVariations,
	DESIGN_LAB_CREDITS_PER_IMAGE: checkCreditsPerImage,
});

checkDesignLabSettings({
	provider: designLabProvider(
		env.get("DESIGN_LAB_PROVIDER"),
		env.get("NODE_ENV") === "production",
	),
	production: env.get("NODE_ENV") === "production",
	apiKey: env.get("BFL_API_KEY") !== undefined,
	model: env.get("BFL_MODEL") !== undefined,
	apiUrl: env.get("BFL_API_URL"),
});

checkPaymentSettings({
	platformKey: env.get("PAYBRIDGE_SECRET_KEY") !== undefined,
	platformSandbox:
		env.get("PAYBRIDGE_SECRET_KEY")?.release().startsWith("sk_test_") === true,
	production: env.get("NODE_ENV") === "production",
	webhookSecret: env.get("PAYBRIDGE_WEBHOOK_SECRET") !== undefined,
	studioMode: env.get("STUDIO_ONLINE_PAYMENTS"),
	credentialsKey: env.get("PAYMENT_CREDENTIALS_KEY") !== undefined,
});

// In production the dashboard's origin is https and off the studio pages'
// domain (TAT-9): its __Host- session cookie needs both. Checked once both
// settings are read, since it compares them.
checkAppOrigin(
	env.get("APP_URL"),
	env.get("STOREFRONT_URL"),
	env.get("NODE_ENV") === "production",
);

// API_URL and DISCOVER_URL: origins of their own shape; Discover on a host of
// its own; in production https and off the studio pages' domain, like APP_URL.
checkPlatformOrigins({
	appUrl: env.get("APP_URL"),
	apiUrl: env.get("API_URL"),
	discoverUrl: env.get("DISCOVER_URL"),
	storefrontTemplate: env.get("STOREFRONT_URL"),
	production: env.get("NODE_ENV") === "production",
});

// All six R2 settings or none; production needs them (TAT-27). Checked once
// all are read, since a partial set is an error.
checkStorageSettings(
	{
		R2_ACCOUNT_ID: env.get("R2_ACCOUNT_ID"),
		R2_ACCESS_KEY_ID: env.get("R2_ACCESS_KEY_ID"),
		R2_SECRET_ACCESS_KEY: env.get("R2_SECRET_ACCESS_KEY")?.release(),
		R2_PUBLIC_BUCKET: env.get("R2_PUBLIC_BUCKET"),
		R2_PRIVATE_BUCKET: env.get("R2_PRIVATE_BUCKET"),
		R2_PUBLIC_URL: env.get("R2_PUBLIC_URL"),
	},
	env.get("NODE_ENV") === "production",
);

export default env;
