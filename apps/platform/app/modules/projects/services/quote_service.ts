import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { DateTime } from "luxon";
import Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;
type ProjectRef = Pick<TattooProject, "id">;

/**
 * A new quote version in stored units: paisa and whole minutes. The
 * currency is always NPR for now.
 */
export type NewQuote =
	| {
			kind: "fixed";
			fixedPrice: number;
			depositAmount: number;
			expiresAt: DateTime;
	  }
	| {
			kind: "hourly";
			hourlyRate: number;
			estimatedMinutes: number;
			depositAmount: number;
			expiresAt: DateTime;
	  };

/**
 * The way to read a project's quotes and add a version. Quotes are history:
 * this class only inserts, so "the price, deposit and expiry never change"
 * and "history is never deleted" hold. Every call is scoped to the tenant.
 * The status moves that go with quotes live in ProjectService.
 */
export default class QuoteService {
	/** The project's current quote (its highest version), or null. */
	async current(tenant: TenantRef, project: ProjectRef): Promise<Quote | null> {
		return Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();
	}

	/** Every version of the project's quote, newest first. */
	async history(tenant: TenantRef, project: ProjectRef): Promise<Quote[]> {
		return Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc");
	}

	/**
	 * Inserts the project's next version (1 for the first). The caller holds
	 * the project's row lock (ProjectService), so two saves cannot take the
	 * same version; the `(project_id, version)` unique key backs that up.
	 */
	async create(
		trx: TransactionClientContract,
		tenant: TenantRef,
		project: ProjectRef,
		input: NewQuote,
	): Promise<Quote> {
		const latest = await Quote.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();

		return Quote.create(
			{
				tenantId: tenant.id,
				projectId: project.id,
				version: (latest?.version ?? 0) + 1,
				kind: input.kind,
				fixedPrice: input.kind === "fixed" ? input.fixedPrice : null,
				hourlyRate: input.kind === "hourly" ? input.hourlyRate : null,
				estimatedMinutes:
					input.kind === "hourly" ? input.estimatedMinutes : null,
				depositAmount: input.depositAmount,
				currency: "NPR",
				expiresAt: input.expiresAt,
			},
			{ client: trx },
		);
	}
}
