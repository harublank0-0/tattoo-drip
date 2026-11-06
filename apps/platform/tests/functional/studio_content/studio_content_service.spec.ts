import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { ContentLimitError } from "#modules/studio_content/errors";
import {
	MAX_FAQ_ENTRIES,
	MAX_POLICY_SECTIONS,
} from "#modules/studio_content/limits";
import StudioFaqEntry from "#modules/studio_content/models/studio_faq_entry";
import StudioContentService from "#modules/studio_content/services/studio_content_service";
import Tenant from "#modules/tenancy/models/tenant";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, inTenantAs, studioWithOwner } from "#tests/helpers/tenants";

const content = new StudioContentService();
const entry = (n: number) => ({
	question: `Question ${n}?`,
	answer: `Answer ${n}.`,
});
const section = (n: number) => ({ title: `Section ${n}`, text: `Text ${n}.` });

const datedAt = (tenant: { id: string }) =>
	inTenant(
		tenant,
		async () =>
			(await Tenant.findOrFail(tenant.id)).policiesUpdatedAt?.toMillis() ??
			null,
	);

/** Put the policies date back to a fixed day (now() is the test transaction's time). */
const OLD = Date.parse("2020-01-01T00:00:00Z");
const resetDate = (tenant: { id: string }) =>
	inTenant(tenant, () =>
		Tenant.query()
			.where("id", tenant.id)
			.update({ policies_updated_at: new Date(OLD) }),
	);

test.group("StudioContentService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("saveFaq replaces the list in the order given; faq reads it back in order", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			content.saveFaq(tenant, [entry(1), entry(2), entry(3)]),
		);
		await inTenant(tenant, () => content.saveFaq(tenant, [entry(3), entry(1)]));

		assert.deepEqual(await inTenant(tenant, () => content.faq(tenant)), [
			entry(3),
			entry(1),
		]);
		const positions = await inTenant(tenant, async () =>
			(await StudioFaqEntry.query().orderBy("position")).map((r) => r.position),
		);
		assert.deepEqual(positions, [0, 1]);
	});

	test("savePolicies replaces the list and dates the policies only when the list changed", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const save = (sections: { title: string; text: string }[]) =>
			inTenant(tenant, () => content.savePolicies(tenant, sections));

		assert.deepEqual(await save([section(1), section(2)]), { changed: true });
		assert.isNotNull(await datedAt(tenant));

		await resetDate(tenant);
		assert.deepEqual(await save([section(1), section(2)]), { changed: false });
		assert.equal(
			await datedAt(tenant),
			OLD,
			"an unchanged save keeps the date",
		);

		assert.deepEqual(await save([section(2), section(1)]), { changed: true });
		assert.notEqual(await datedAt(tenant), OLD, "a reorder is a change");

		await resetDate(tenant);
		assert.deepEqual(
			await save([section(2), { ...section(1), text: "Edited." }]),
			{ changed: true },
		);
		assert.notEqual(await datedAt(tenant), OLD, "an edit is a change");

		await resetDate(tenant);
		assert.deepEqual(await save([]), { changed: true });
		assert.notEqual(await datedAt(tenant), OLD, "clearing is a change");
		assert.deepEqual(
			await inTenant(tenant, () => content.policySections(tenant)),
			[],
		);
	});

	test("a list over its limit is refused before anything is written", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () => content.saveFaq(tenant, [entry(1)]));
		await inTenant(tenant, () => content.savePolicies(tenant, [section(1)]));

		const tooManyFaq = Array.from({ length: MAX_FAQ_ENTRIES + 1 }, (_, n) =>
			entry(n),
		);
		const tooManySections = Array.from(
			{ length: MAX_POLICY_SECTIONS + 1 },
			(_, n) => section(n),
		);
		await assert.rejects(
			() => inTenant(tenant, () => content.saveFaq(tenant, tooManyFaq)),
			ContentLimitError,
		);
		await assert.rejects(
			() =>
				inTenant(tenant, () => content.savePolicies(tenant, tooManySections)),
			ContentLimitError,
		);
		assert.deepEqual(await inTenant(tenant, () => content.faq(tenant)), [
			entry(1),
		]);
		assert.deepEqual(
			await inTenant(tenant, () => content.policySections(tenant)),
			[section(1)],
		);
		// The limits themselves are fine.
		await inTenant(tenant, () =>
			content.saveFaq(tenant, tooManyFaq.slice(0, MAX_FAQ_ENTRIES)),
		);
	});

	test("a save locks the studio's row before it replaces the list, so two saves at once never interleave", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const saves: (() => Promise<unknown>)[] = [
			() => content.saveFaq(tenant, [entry(1)]),
			() => content.savePolicies(tenant, [section(1)]),
		];
		for (const save of saves) {
			const { queries } = await recordQueries(() => inTenant(tenant, save));
			const lock = queries.findIndex(
				(sql) => sql.includes('"tenants"') && /for update/i.test(sql),
			);
			const remove = queries.findIndex((sql) => /^delete from/i.test(sql));
			assert.isAtLeast(lock, 0, "the studio's row is locked");
			assert.isBelow(lock, remove, "before the list is replaced");
		}
	});

	test("another studio's lists are invisible and its save touches only its own", async ({
		assert,
	}) => {
		const a = await studioWithOwner("content-a", "Content A");
		const b = await studioWithOwner("content-b", "Content B");
		await inTenant(a.tenant, () => content.saveFaq(a.tenant, [entry(1)]));
		await inTenant(a.tenant, () =>
			content.savePolicies(a.tenant, [section(1)]),
		);

		// Studio A's lists asked for from studio B's context.
		assert.deepEqual(
			await inTenantAs(b.tenant, b.owner, () => content.faq(a.tenant)),
			[],
		);
		assert.deepEqual(
			await inTenantAs(b.tenant, b.owner, () =>
				content.policySections(a.tenant),
			),
			[],
		);
		await inTenantAs(b.tenant, b.owner, () =>
			content.saveFaq(b.tenant, [entry(9)]),
		);
		assert.deepEqual(await inTenant(a.tenant, () => content.faq(a.tenant)), [
			entry(1),
		]);
	});
});
