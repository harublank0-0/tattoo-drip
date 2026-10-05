import app from "@adonisjs/core/services/app";
import { defineConfig, transports } from "@adonisjs/mail";
import env from "#start/env";

const smtpPort = env.get("SMTP_PORT");
const smtpUsername = env.get("SMTP_USERNAME");
const smtpPassword = env.get("SMTP_PASSWORD");

/**
 * Fail at boot rather than on the first send when only one of the
 * credentials is set.
 */
if (Boolean(smtpUsername) !== Boolean(smtpPassword)) {
	throw new Error("Set both SMTP_USERNAME and SMTP_PASSWORD, or neither");
}

const mailConfig = defineConfig({
	default: env.get("MAIL_MAILER"),

	/**
	 * Every email is sent from the platform's own domain, never from a
	 * tenant's. A tenant's contact address belongs in `replyTo`.
	 */
	from: {
		address: env.get("MAIL_FROM_ADDRESS"),
		name: env.get("MAIL_FROM_NAME"),
	},

	/**
	 * Mailpit in development. In production, any provider's SMTP
	 * endpoint (SES, Resend, Postmark, ...) works by changing the env.
	 * An API transport can be added here and picked with MAIL_MAILER.
	 */
	mailers: {
		smtp: transports.smtp({
			host: env.get("SMTP_HOST"),
			port: smtpPort,
			auth:
				smtpUsername && smtpPassword
					? { type: "login", user: smtpUsername, pass: smtpPassword }
					: undefined,
			/**
			 * Port 465 is TLS from the first byte. On any other port, upgrade
			 * with STARTTLS and refuse to send unencrypted in production.
			 * Mailpit doesn't offer TLS, so it stays off in development.
			 */
			secure: smtpPort === 465,
			requireTLS: app.inProduction,
		}),
	},
});

export default mailConfig;

declare module "@adonisjs/mail/types" {
	export interface MailersList extends InferMailers<typeof mailConfig> {}
}
