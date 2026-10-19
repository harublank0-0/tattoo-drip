import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { BaseMail } from "@adonisjs/mail";
import SendMailJob from "#jobs/send_mail_job";
import { dispatchInTransaction } from "#services/queue";
import env from "#start/env";

/**
 * Queues `email` for the worker inside `trx` (TAT-52): what mail.sendLater
 * does (start/mail.ts queues a SendMailJob), except that the job exists only
 * if `trx` commits. A TenantJob uses it to send one email per row it
 * inserts, so a retried job never sends twice. The mail class never sets
 * `from`: config/mail.ts adds it when the worker sends.
 */
export async function sendMailInTransaction(
	email: BaseMail,
	trx: TransactionClientContract,
): Promise<void> {
	await email.build();
	await dispatchInTransaction(
		SendMailJob.dispatch({
			mailerName: env.get("MAIL_MAILER"),
			mailMessage: email.message.toObject(),
		}),
		trx,
	);
}
