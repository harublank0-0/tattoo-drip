import { compose } from "@adonisjs/core/helpers";
import { hasMany } from "@adonisjs/lucid/orm";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { HasMany } from "@adonisjs/lucid/types/relations";
import { DateTime } from "luxon";
import { TenantSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import PaymentMethod from "#modules/payments/models/payment_method";
import TenantMembership from "#modules/tenancy/models/tenant_membership";

export const TENANT_TYPES = ["studio", "independent"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

/**
 * Default for new tenants; the pilot studios are in Nepal.
 */
export const DEFAULT_TIMEZONE = "Asia/Kathmandu";

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
	 * memberships and payment methods, so nothing keeps pointing at a
	 * deleted tenant.
	 */
	override async softDelete(trx?: TransactionClientContract) {
		const run = async (client: TransactionClientContract) => {
			// Update queries skip the soft-delete hooks: filter live rows here,
			// so members removed earlier keep their original deleted_at.
			await TenantMembership.query({ client })
				.where("tenant_id", this.id)
				.whereNull("deleted_at")
				.update({ deleted_at: DateTime.utc().toSQL() });
			await PaymentMethod.query({ client })
				.where("tenant_id", this.id)
				.whereNull("deleted_at")
				.update({ deleted_at: DateTime.utc().toSQL() });
			await super.softDelete(client);
		};

		if (trx) await run(trx);
		else await db.transaction(run);
	}
}
