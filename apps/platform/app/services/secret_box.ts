import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import env from "#start/env";

/**
 * Encrypts studios' PayBridgeNP credentials at rest (AES-256-GCM with
 * PAYMENT_CREDENTIALS_KEY, docs/payments-paybridgenp.md). The stored text is
 * `v1.<iv>.<tag>.<ciphertext>` in base64url; the row's id is the additional
 * data, so a ciphertext copied onto another row does not decrypt. Plain
 * values never leave the server: not in props, logs, jobs or errors.
 */

const VERSION = "v1";

export class SecretBoxUnavailableError extends Error {
	constructor() {
		super("PAYMENT_CREDENTIALS_KEY is not set");
	}
}

function key(): Buffer {
	const secret = env.get("PAYMENT_CREDENTIALS_KEY");
	if (!secret) throw new SecretBoxUnavailableError();
	return secret.release();
}

export function sealSecret(plain: string, boundTo: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	cipher.setAAD(Buffer.from(boundTo, "utf8"));
	const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return [
		VERSION,
		iv.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
		body.toString("base64url"),
	].join(".");
}

/** The plain value, or a thrown error for a value that was tampered with or sealed for another row. */
export function openSecret(sealed: string, boundTo: string): string {
	const [version, iv, tag, body] = sealed.split(".");
	if (version !== VERSION || !iv || !tag || body === undefined) {
		throw new Error("Unreadable sealed secret");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(),
		Buffer.from(iv, "base64url"),
	);
	decipher.setAAD(Buffer.from(boundTo, "utf8"));
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(body, "base64url")),
		decipher.final(),
	]).toString("utf8");
}
