import Client from "#modules/clients/models/client";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/**
 * The way other modules read a tenant's clients. TAT-51 (intake and
 * matching by phone) grows it.
 */
export default class ClientService {
	/** The tenant's live client with this id, or null. */
	async find(tenant: TenantRef, id: string): Promise<Client | null> {
		return Client.query().where("tenant_id", tenant.id).where("id", id).first();
	}
}
