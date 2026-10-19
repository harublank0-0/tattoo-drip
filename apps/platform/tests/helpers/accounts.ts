import type queue from "@adonisjs/queue/services/main";
import type { ApiResponse } from "@japa/api-client";
import type { SendMailPayload } from "#jobs/send_mail_job";
import {
	hashAccountToken,
	type TokenPurpose,
} from "#modules/identity/account_tokens";
import { dbClient } from "#services/db_context";
import { parseSetCookie, setCookieLines } from "#tests/helpers/cookies";

type Fake = ReturnType<typeof queue.fake>;

/** One email a faked queue holds: its recipient, subject and template data. */
export type QueuedMail = {
	to: string;
	subject: string;
	data: Record<string, unknown>;
};

/** The emails a faked queue holds (SendMailJob payloads), in order. */
export function queuedMails(fake: Fake): QueuedMail[] {
	return fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "SendMailJob")
		.map(({ job }) => {
			const { message, views } = (job.payload as SendMailPayload).mailMessage;
			return {
				to: String(message.to?.[0]),
				subject: String(message.subject),
				data: (views.html?.data ?? {}) as Record<string, unknown>,
			};
		});
}

/** The token at the end of an account link (…/verify-email/<token>). */
export function tokenOf(url: unknown): string {
	return String(url).split("/").at(-1) ?? "";
}

/** Moves an account token's expiry into the past, as time would. */
export function expireToken(userId: string, purpose: TokenPurpose) {
	return dbClient().rawQuery(
		"update account_tokens set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where user_id = ? and purpose = ?",
		[userId, purpose],
	);
}

/** The token with its last character changed: the same shape, another token. */
export function altered(token: string): string {
	return `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
}

/** The names of the cookies a response sets, sorted. */
export function cookieNames(response: ApiResponse): string[] {
	return setCookieLines(response.headers()["set-cookie"])
		.map((line) => parseSetCookie(line).name)
		.sort();
}

/** The flow id of a token's row, which a form posts back (a zero id when the token has no row). */
export async function flowOf(token: string): Promise<string> {
	const { rows } = await dbClient().rawQuery(
		"select id from account_tokens where token_hash = ?",
		[hashAccountToken(token)],
	);
	return (rows[0]?.id as string | undefined) ?? NO_FLOW;
}

/** A well-formed flow id that no row has. */
export const NO_FLOW = "00000000-0000-0000-0000-000000000000";
