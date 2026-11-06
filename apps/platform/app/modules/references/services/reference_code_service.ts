import ReferenceCode from "#modules/references/models/reference_code";
import {
	claimFreeCode,
	newReferenceCode,
} from "#modules/references/reference_codes";
import type Tenant from "#modules/tenancy/models/tenant";
import { currentClient, withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * Draws a studio's new reference codes. A claim runs in the caller's
 * transaction (the request's), and refuses to run without one: a rolled-back
 * intake or link gives its code back. Each draw is its own savepoint, so a
 * collision leaves the caller's transaction usable.
 */
export default class ReferenceCodeService {
	/**
	 * A new code, registered for the studio. A code the studio already
	 * holds is drawn again, up to REFERENCE_TRIES times; then the unique
	 * violation surfaces.
	 */
	async claim(tenant: TenantRef): Promise<string> {
		// Outside a transaction a draw would commit on its own, and the caller's
		// failure could no longer give the code back.
		if (!currentClient()) {
			throw new Error(
				"ReferenceCodeService.claim must run inside a transaction",
			);
		}
		return claimFreeCode(
			(code) =>
				withTransaction(() =>
					ReferenceCode.create({ tenantId: tenant.id, code }),
				),
			() => this.newCode(),
		);
	}

	/** A new code. Protected, so a test can force a collision. */
	protected newCode(): string {
		return newReferenceCode();
	}
}
