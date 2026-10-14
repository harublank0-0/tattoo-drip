import { compose } from "@adonisjs/core/helpers";
import { hasMany } from "@adonisjs/lucid/orm";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { LucidModel } from "@adonisjs/lucid/types/model";
import type { HasMany } from "@adonisjs/lucid/types/relations";
import { DateTime } from "luxon";
import { TenantSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import PaymentMethod from "#modules/payments/models/payment_method";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectSession from "#modules/scheduling/models/project_session";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { withTransaction } from "#services/db_context";

export const TENANT_TYPES = ["studio", "independent"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

/**
 * Default for new tenants; the pilot studios are in Nepal.
 */
export const DEFAULT_TIMEZONE = "Asia/Kathmandu";

/**
 * Models that are soft-deleted with their tenant: each has `tenant_id` and
 * `deleted_at`. Quotes and payments have no `deleted_at` and are left alone:
 * they are not hidden and stay readable by direct queries, so list them
 * through a live project. A function, not a constant: TenantMembership
 * imports this file, so reading the class while the module loads fails
 * whenever the membership model is imported first.
 */
const cascade = (): LucidModel[] => [
	TenantMembership,
	PaymentMethod,
	Artist,
	Client,
	Inquiry,
	TattooProject,
	ReferenceImage,
	ProjectSession,
];

/**
 * A business on the platform. Read and change tenants through
 * TenancyService, not from other modules directly.
 */
export default class Tenant extends compose(TenantSchema, withSoftDeletes) {
	declare type: TenantType;

	@hasMany(() => TenantMembership)
	declare memberships: HasMany<typeof TenantMembership>;

	/**
	 * Soft-deletes the tenant and, in the same transaction, its live
	 * memberships, payment methods, artists, clients, inquiries, projects,
	 * reference images and sessions, so nothing keeps pointing at a deleted
	 * tenant.
	 */
	override async softDelete(trx?: TransactionClientContract) {
		const run = async (client: TransactionClientContract) => {
			// Update queries skip the soft-delete hooks: filter live rows here,
			// so rows removed earlier keep their original deleted_at.
			for (const model of cascade()) {
				await model
					.query({ client })
					.where("tenant_id", this.id)
					.whereNull("deleted_at")
					.update({ deleted_at: DateTime.utc().toSQL() });
			}
			await super.softDelete(client);
		};

		if (trx) await run(trx);
		else await withTransaction(run);
	}
}
