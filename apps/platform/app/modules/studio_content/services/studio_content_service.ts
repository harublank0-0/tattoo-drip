import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { ContentLimitError } from "#modules/studio_content/errors";
import {
	MAX_FAQ_ENTRIES,
	MAX_POLICY_SECTIONS,
} from "#modules/studio_content/limits";
import StudioFaqEntry from "#modules/studio_content/models/studio_faq_entry";
import StudioPolicySection from "#modules/studio_content/models/studio_policy_section";
import Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;
export type FaqEntry = { question: string; answer: string };
export type PolicySection = { title: string; text: string };

/**
 * A studio's own FAQ entries and policy sections
 * (docs/superpowers/specs/2026-11-06-studio-faq-and-policies-design.md).
 * Each list is read in its order and saved whole: the save locks the
 * studio's row, so two saves never interleave, then replaces the rows with
 * positions 0..n-1. Saving the policies dates them
 * (`tenants.policies_updated_at`) when the list differs from the stored
 * one. Every query is scoped to the tenant.
 */
export default class StudioContentService {
	async faq(tenant: TenantRef): Promise<FaqEntry[]> {
		const rows = await StudioFaqEntry.query()
			.where("tenant_id", tenant.id)
			.orderBy("position");
		return rows.map(({ question, answer }) => ({ question, answer }));
	}

	async policySections(tenant: TenantRef): Promise<PolicySection[]> {
		const rows = await StudioPolicySection.query()
			.where("tenant_id", tenant.id)
			.orderBy("position");
		return rows.map(({ title, text }) => ({ title, text }));
	}

	async saveFaq(
		tenant: TenantRef,
		entries: readonly FaqEntry[],
	): Promise<void> {
		if (entries.length > MAX_FAQ_ENTRIES) throw new ContentLimitError("faq");
		await withTransaction(async (trx) => {
			await lockStudio(trx, tenant);
			await StudioFaqEntry.query({ client: trx })
				.where("tenant_id", tenant.id)
				.delete();
			for (const [position, { question, answer }] of entries.entries()) {
				await StudioFaqEntry.create(
					{ tenantId: tenant.id, position, question, answer },
					{ client: trx },
				);
			}
		});
	}

	async savePolicies(
		tenant: TenantRef,
		sections: readonly PolicySection[],
	): Promise<{ changed: boolean }> {
		if (sections.length > MAX_POLICY_SECTIONS) {
			throw new ContentLimitError("policies");
		}
		return withTransaction(async (trx) => {
			await lockStudio(trx, tenant);
			const stored = await StudioPolicySection.query({ client: trx })
				.where("tenant_id", tenant.id)
				.orderBy("position");
			const changed =
				stored.length !== sections.length ||
				stored.some(
					(row, n) =>
						row.title !== sections[n].title || row.text !== sections[n].text,
				);
			if (!changed) return { changed: false };
			await StudioPolicySection.query({ client: trx })
				.where("tenant_id", tenant.id)
				.delete();
			for (const [position, { title, text }] of sections.entries()) {
				await StudioPolicySection.create(
					{ tenantId: tenant.id, position, title, text },
					{ client: trx },
				);
			}
			await trx.rawQuery(
				"update tenants set policies_updated_at = now() where id = ?",
				[tenant.id],
			);
			return { changed: true };
		});
	}
}

/** Holds the studio's row until the save ends: a second save of either list waits. */
async function lockStudio(trx: TransactionClientContract, tenant: TenantRef) {
	await Tenant.query({ client: trx })
		.where("id", tenant.id)
		.select("id")
		.forUpdate()
		.firstOrFail();
}
