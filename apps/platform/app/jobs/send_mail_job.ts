import logger from "@adonisjs/core/services/logger";
import mail from "@adonisjs/mail/services/main";

import type {
	MailersList,
	MessageBodyTemplates,
	NodeMailerMessage,
} from "@adonisjs/mail/types";
import { Job } from "@adonisjs/queue";
import type { JobOptions } from "@adonisjs/queue/types";

export type SendMailPayload = {
	mailerName: keyof MailersList;
	mailMessage: {
		message: NodeMailerMessage;
		views: MessageBodyTemplates;
	};
	sendConfig?: unknown;
};

export default class SendMailJob extends Job<SendMailPayload> {
	/**
	 * A failed row keeps the whole payload, including links that work like
	 * passwords (email verification, password reset). failed() already logs
	 * what identifies the email, so keep failed mail rows for one day, not
	 * the default seven. Retries still come from config/queue.ts.
	 */
	static options: JobOptions = {
		removeOnFail: { age: "1d" },
	};

	async execute(): Promise<void> {
		const { mailerName, mailMessage, sendConfig } = this.payload;

		await mail.use(mailerName).sendCompiled(mailMessage, sendConfig);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const {
			mailerName,
			mailMessage: { message },
		} = this.payload;

		const { to, from, subject } = message;

		logger.error(
			{
				err: error,
				mailerName,
				jobId,
				to,
				from,
				subject,
			},
			"Sending email failed.",
		);
	}
}
