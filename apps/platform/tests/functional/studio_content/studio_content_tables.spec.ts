import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow, updateRow } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * The studio's own FAQ entries and policy sections (spec:
 * docs/superpowers/specs/2026-11-06-studio-faq-and-policies-design.md), and
 * the trigger that dates the policies when a Good to know policy text
 * changes.
 */

const faqRow = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	position: 0,
	question: "Do you take walk-ins?",
	answer: "On Sundays.",
	...over,
});
const policyRow = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	position: 0,
	title: "Cancellations",
	text: "Tell us a day before.",
	...over,
});

test.group("studio_faq_entries and studio_policy_sections", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an entry needs its question and answer within their lengths, a position from 0 to 19, unique per studio", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const bad: [Record<string, unknown>, RegExp][] = [
			[{ question: "   " }, /studio_faq_entries_question_filled/],
			[{ answer: "" }, /studio_faq_entries_answer_filled/],
			[{ question: "q".repeat(201) }, /too long|value too long/],
			[{ answer: "a".repeat(2001) }, /too long|value too long/],
			[{ position: 20 }, /studio_faq_entries_position_range/],
			[{ position: -1 }, /studio_faq_entries_position_range/],
		];
		await withDbContext({ tenantId: tenant.id }, async () => {
			for (const [over, error] of bad) {
				await assert.rejects(
					() =>
						withTransaction((trx) =>
							insertRow(trx, "studio_faq_entries", faqRow(tenant.id, over)),
						),
					error,
				);
			}
			await withTransaction((trx) =>
				insertRow(
					trx,
					"studio_faq_entries",
					faqRow(tenant.id, { position: 19, answer: "a".repeat(2000) }),
				),
			);
			await withTransaction((trx) =>
				insertRow(trx, "studio_faq_entries", faqRow(tenant.id)),
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						insertRow(trx, "studio_faq_entries", faqRow(tenant.id)),
					),
				/studio_faq_entries_tenant_id_position_unique/,
			);
		});
	});

	test("a policy section needs its title and text within their lengths, a position from 0 to 11, unique per studio", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const bad: [Record<string, unknown>, RegExp][] = [
			[{ title: " " }, /studio_policy_sections_title_filled/],
			[{ text: "" }, /studio_policy_sections_text_filled/],
			[{ title: "t".repeat(81) }, /too long|value too long/],
			[{ text: "t".repeat(4001) }, /too long|value too long/],
			[{ position: 12 }, /studio_policy_sections_position_range/],
		];
		await withDbContext({ tenantId: tenant.id }, async () => {
			for (const [over, error] of bad) {
				await assert.rejects(
					() =>
						withTransaction((trx) =>
							insertRow(
								trx,
								"studio_policy_sections",
								policyRow(tenant.id, over),
							),
						),
					error,
				);
			}
			await withTransaction((trx) =>
				insertRow(
					trx,
					"studio_policy_sections",
					policyRow(tenant.id, { position: 11, text: "t".repeat(4000) }),
				),
			);
			await withTransaction((trx) =>
				insertRow(trx, "studio_policy_sections", policyRow(tenant.id)),
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						insertRow(trx, "studio_policy_sections", policyRow(tenant.id)),
					),
				/studio_policy_sections_tenant_id_position_unique/,
			);
		});
	});

	test("changing the deposit policy, age rule or walk-ins dates the policies; other changes and same-value saves don't", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const datedAt = () =>
			withDbContext({ tenantId: tenant.id }, async (trx) => {
				const { rows } = await trx.rawQuery(
					"select policies_updated_at as at from tenants where id = ?",
					[tenant.id],
				);
				return rows[0].at as Date | null;
			});
		const update = (set: Record<string, unknown>) =>
			withDbContext({ tenantId: tenant.id }, (trx) =>
				updateRow(trx, "tenants", tenant.id, set),
			);

		// now() is the transaction's time, so each check first puts the date
		// back to a fixed day and sees whether the change moved it.
		const OLD = new Date("2020-01-01T00:00:00Z");
		const moves = async (set: Record<string, unknown>) => {
			await update({ policies_updated_at: OLD });
			await update(set);
			return (await datedAt())?.getTime() !== OLD.getTime();
		};

		assert.isNull(await datedAt());
		await update({ intro: "A new introduction" });
		assert.isNull(await datedAt(), "the intro is no policy");

		assert.isTrue(await moves({ walk_ins_text: "Sundays only" }), "walk-ins");
		assert.isFalse(
			await moves({ walk_ins_text: "Sundays only" }),
			"same value",
		);
		assert.isTrue(await moves({ age_rule_text: "18 and over" }), "age rule");
		assert.isTrue(
			await moves({ deposit_policy: "30% to book" }),
			"deposit policy",
		);
		assert.isFalse(await moves({ intro: "Another introduction" }), "intro");
	});

	test("row-level security on studio_faq_entries", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "studio_faq_entries", async (tenant) =>
			faqRow(tenant.id),
		);
	});

	test("row-level security on studio_policy_sections", async ({ assert }) => {
		await assertRowLevelSecurity(
			assert,
			"studio_policy_sections",
			async (tenant) => policyRow(tenant.id),
		);
	});
});
