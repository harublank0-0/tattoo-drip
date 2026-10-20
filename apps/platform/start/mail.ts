/*
|--------------------------------------------------------------------------
| Mail messenger
|--------------------------------------------------------------------------
|
| mail.sendLater hands every email to SendMailJob, so it is stored in
| queue_jobs and sent by the worker (pnpm worker) instead of in-process.
|
*/

import logger from "@adonisjs/core/services/logger";
import mail from "@adonisjs/mail/services/main";
import type { MailersList } from "@adonisjs/mail/types";
import SendMailJob from "#jobs/send_mail_job";
import env from "#start/env";

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

// Said once per process, at boot: alerts still reach the dashboard (TAT-52, TAT-88).
if (env.get("ALERT_EMAILS") === false) {
	logger.warn(
		"Staff alert emails are off (ALERT_EMAILS=false): new inquiries and deposit screenshots alert the dashboard only.",
	);
}
