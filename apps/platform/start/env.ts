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
import { checkServerKeys } from "#services/server_keys";
import { checkStorefrontUrl } from "#services/storefront_url";
import { checkTrustProxy } from "#services/trust_proxy";

const env = await Env.create(new URL("../", import.meta.url), {
	// Node
	NODE_ENV: Env.schema.enum(["development", "production", "test"] as const),
	PORT: Env.schema.number(),
	HOST: Env.schema.string({ format: "host" }),
	LOG_LEVEL: Env.schema.string(),

	// App
	APP_KEY: Env.schema.secret(),
	APP_URL: Env.schema.string({ format: "url", tld: false }),
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

	// Mail (Mailpit in development; any provider's SMTP endpoint in production)
	MAIL_MAILER: Env.schema.enum(["smtp"] as const),
	MAIL_FROM_NAME: Env.schema.string(),
	MAIL_FROM_ADDRESS: Env.schema.string({ format: "email" }),
	SMTP_HOST: Env.schema.string({ format: "host" }),
	SMTP_PORT: Env.schema.number(),
	SMTP_USERNAME: Env.schema.string.optional(),
	SMTP_PASSWORD: Env.schema.string.optional(),
});

// In production the dashboard's origin is https and off the studio pages'
// domain (TAT-9): its __Host- session cookie needs both. Checked once both
// settings are read, since it compares them.
checkAppOrigin(
	env.get("APP_URL"),
	env.get("STOREFRONT_URL"),
	env.get("NODE_ENV") === "production",
);

export default env;
