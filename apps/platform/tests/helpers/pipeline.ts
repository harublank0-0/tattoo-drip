import Client from "#modules/clients/models/client";

type TenantRef = { id: string };

let sequence = 0;
const next = () => ++sequence;

/**
 * A fresh E.164 phone, unique for the whole test run.
 */
export const nextPhone = () => `+97798${String(next()).padStart(8, "0")}`;

type ClientOver = Partial<
	Pick<Client, "name" | "phone" | "email" | "notes" | "anonymizedAt">
>;

/**
 * A client with a unique phone. Call it inside `inTenant(tenant, …)`: the
 * factories use the models, which join the ambient transaction.
 */
export function makeClient(tenant: TenantRef, over: ClientOver = {}) {
	return Client.create({
		tenantId: tenant.id,
		name: `Client ${next()}`,
		phone: nextPhone(),
		...over,
	});
}
