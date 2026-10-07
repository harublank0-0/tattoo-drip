/*
|--------------------------------------------------------------------------
| Mail messenger
|--------------------------------------------------------------------------
|
| mail.sendLater hands every email to SendMailJob, so it is stored in
| queue_jobs and sent by the worker (pnpm worker) instead of in-process.
|
*/

import mail from "@adonisjs/mail/services/main";
import type { MailersList } from "@adonisjs/mail/types";
import SendMailJob from "#jobs/send_mail_job";

mail.setMessenger((mailer) => ({
	queue: (mailMessage, sendConfig) =>
		SendMailJob.dispatch({
			// The mail library types the name as a plain string; it is always
			// one of the mailers in config/mail.ts.
			mailerName: mailer.name as keyof MailersList,
			mailMessage,
			sendConfig,
		}).run(),
}));
