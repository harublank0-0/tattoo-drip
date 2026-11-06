import ReferenceCode from "#modules/references/models/reference_code";
import {
	newReferenceCode,
	REFERENCE_TRIES,
} from "#modules/references/reference_codes";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;

const CODE_TAKEN = "reference_codes_tenant_id_code_unique";

/**
 * Draws a studio's new reference codes. A claim runs in the caller's
 * transaction (the request's): a rolled-back intake or link gives its code
 * back. Each draw is its own savepoint, so a collision leaves the caller's
 * transaction usable.
 */
export default class ReferenceCodeService {
	/**
	 * A new code, registered for the studio. A code the studio already
	 * holds is drawn again, up to REFERENCE_TRIES times; then the unique
	 * violation surfaces.
	 */
	async claim(tenant: TenantRef): Promise<string> {
		for (let attempt = 1; ; attempt++) {
			const code = this.newCode();
			try {
				await withTransaction(() =>
					ReferenceCode.create({ tenantId: tenant.id, code }),
				);
				return code;
			} catch (error) {
				if (
					attempt >= REFERENCE_TRIES ||
					!isUniqueViolation(error, CODE_TAKEN)
				) {
					throw error;
				}
			}
		}
	}

	/** A new code. Protected, so a test can force a collision. */
	protected newCode(): string {
		return newReferenceCode();
	}
}
