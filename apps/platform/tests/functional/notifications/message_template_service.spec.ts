import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	type MessageKind,
} from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import MessageTemplateService from "#modules/notifications/services/message_template_service";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const templates = new MessageTemplateService();

/** The studio's own rows, by kind. */
const rowsOf = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		(
			await MessageTemplate.query()
				.where("tenant_id", tenant.id)
				.orderBy("kind")
		).map(({ kind, body }) => ({ kind, body })),
	);

test.group("MessageTemplateService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio that wrote nothing gets the six defaults", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("texts-52");

		assert.deepEqual(
			await inTenant(tenant, () => templates.textsFor(tenant)),
			DEFAULT_TEMPLATES,
		);
	});

	test("saving keeps only the texts that differ from the default, normalized", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("texts-save-52");

		await inTenant(tenant, () =>
			templates.save(tenant, {
				...DEFAULT_TEMPLATES,
				aftercare: "  Namaste {client_name}!\r\nTake care.  ",
			}),
		);

		assert.deepEqual(await rowsOf(tenant), [
			{ kind: "aftercare", body: "Namaste {client_name}!\nTake care." },
		]);
		const texts = await inTenant(tenant, () => templates.textsFor(tenant));
		assert.equal(texts.aftercare, "Namaste {client_name}!\nTake care.");
		assert.equal(texts.quote, DEFAULT_TEMPLATES.quote);
	});

	test("saving the default again removes the studio's text; a new text replaces the old", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("texts-reset-52");
		const save = (over: Partial<Record<MessageKind, string>>) =>
			inTenant(tenant, () =>
				templates.save(tenant, { ...DEFAULT_TEMPLATES, ...over }),
			);

		await save({ quote: "Quote: {price}", aftercare: "Bye {client_name}" });
		await save({ quote: "Your quote: {price}" });
		assert.deepEqual(await rowsOf(tenant), [
			{ kind: "quote", body: "Your quote: {price}" },
		]);

		await save({ quote: `${DEFAULT_TEMPLATES.quote}\r\n` });
		assert.deepEqual(await rowsOf(tenant), []);
	});

	test("another studio's context sees none of its texts", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("texts-a-52");
		const { tenant: b } = await studioWithOwner("texts-b-52");
		await inTenant(a, () =>
			templates.save(a, { ...DEFAULT_TEMPLATES, quote: "A's quote: {price}" }),
		);

		// Asked from B's context for A's texts: the tenant filter and RLS both
		// hide them, so B gets the defaults.
		assert.deepEqual(
			await inTenant(b, () => templates.textsFor(a)),
			DEFAULT_TEMPLATES,
		);
		assert.deepEqual(
			await inTenant(b, () => templates.textsFor(b)),
			DEFAULT_TEMPLATES,
		);
	});
});
