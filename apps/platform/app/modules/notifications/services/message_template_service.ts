import {
	DEFAULT_TEMPLATES,
	MESSAGE_KINDS,
	type MessageKind,
	normalizeTemplate,
} from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * A studio's chat message texts (TAT-52). A row exists only for a message
 * the studio changed; every other one is the default in code, so improving
 * a default reaches every studio that never edited it.
 */
export default class MessageTemplateService {
	/** The studio's six texts: its own where it wrote one, else the default. One query. */
	async textsFor(tenant: TenantRef): Promise<Record<MessageKind, string>> {
		const rows = await MessageTemplate.query().where("tenant_id", tenant.id);
		const own = new Map(rows.map((row) => [row.kind, row.body]));
		return Object.fromEntries(
			MESSAGE_KINDS.map((kind) => [
				kind,
				own.get(kind) ?? DEFAULT_TEMPLATES[kind],
			]),
		) as Record<MessageKind, string>;
	}

	/**
	 * Saves the six texts (messageTemplatesValidator checked them), each
	 * normalized: one equal to the default removes the studio's row, any
	 * other is stored in place. One transaction.
	 */
	async save(
		tenant: TenantRef,
		texts: Record<MessageKind, string>,
	): Promise<void> {
		await withTransaction(async (trx) => {
			for (const kind of MESSAGE_KINDS) {
				const body = normalizeTemplate(texts[kind]);
				if (body === DEFAULT_TEMPLATES[kind]) {
					await MessageTemplate.query({ client: trx })
						.where("tenant_id", tenant.id)
						.where("kind", kind)
						.delete();
					continue;
				}
				await trx.rawQuery(
					`insert into message_templates (tenant_id, kind, body, created_at, updated_at)
					 values (?, ?, ?, now(), now())
					 on conflict (tenant_id, kind) do update
					 set body = excluded.body, updated_at = now()
					 where message_templates.body is distinct from excluded.body`,
					[tenant.id, kind, body],
				);
			}
		});
	}
}
