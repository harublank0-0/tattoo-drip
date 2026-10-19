import { MessageTemplateSchema } from "#database/schema";
import type { MessageKind } from "#modules/notifications/messages";

/**
 * A studio's own text for one of its chat messages (TAT-52). A row exists
 * only for a message the studio changed; the default is DEFAULT_TEMPLATES,
 * and saving it again removes the row. Not soft-deleted. Read and save
 * through MessageTemplateService.
 */
export default class MessageTemplate extends MessageTemplateSchema {
	declare kind: MessageKind;
}
