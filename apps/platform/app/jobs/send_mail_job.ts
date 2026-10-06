import logger from "@adonisjs/core/services/logger";
import mail from "@adonisjs/mail/services/main";

import type {
	MailersList,
	MessageBodyTemplates,
	NodeMailerMessage,
} from "@adonisjs/mail/types";
import { Job } from "@adonisjs/queue";

export type SendMailPayload = {
	mailerName: keyof MailersList;
	mailMessage: {
		message: NodeMailerMessage;
		views: MessageBodyTemplates;
	};
	sendConfig?: unknown;
};

export default class SendMailJob extends Job<SendMailPayload> {
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
