import { ClientRuleError } from "#modules/clients/errors";
import Client from "#modules/clients/models/client";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;

/** Clients per page on the clients list. */
export const CLIENTS_PER_PAGE = 25;

/** The partial unique index: one live client per phone per tenant. */
const PHONE_INDEX = "clients_tenant_phone_live_unique";

export type ClientPage = {
	clients: Client[];
	total: number;
	lastPage: number;
};

/** What an owner can edit on a client (the phone already in E.164). */
export type ClientInput = {
	name: string;
	phone: string;
	email: string | null;
	notes: string | null;
};

/**
 * The way to find, list and edit a tenant's clients (TAT-37, TAT-41).
 * Every call is scoped to the tenant; the clients pages are owners only.
 * Intake (TAT-51) matches by phone with `findByPhone` and never changes a
 * client: only an owner's edit does.
 */
export default class ClientService {
	/** The tenant's live client with this id, or null. */
	async find(tenant: TenantRef, id: string): Promise<Client | null> {
		return Client.query().where("tenant_id", tenant.id).where("id", id).first();
	}

	/**
	 * The tenant's live clients among `ids`, in no particular order (a page
	 * of the projects list looks up its client names in one query).
	 */
	async findMany(tenant: TenantRef, ids: string[]): Promise<Client[]> {
		if (ids.length === 0) return [];
		return Client.query().where("tenant_id", tenant.id).whereIn("id", ids);
	}

	/** The tenant's live client with this id, else E_ROW_NOT_FOUND (a 404). */
	async findFor(tenant: TenantRef, id: string): Promise<Client> {
		return Client.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/** The tenant's live client with this E.164 phone, or null. */
	async findByPhone(tenant: TenantRef, phone: string): Promise<Client | null> {
		return Client.query()
			.where("tenant_id", tenant.id)
			.where("phone", phone)
			.first();
	}

	/**
	 * Live clients, newest first, 25 per page. A search matches part of the
	 * name in any case (literally: `%` and `_` are not wildcards) or, with
	 * at least 3 digits in it, part of the phone's digits however the
	 * number was typed ("981-234", "+977 981…").
	 */
	async list(
		tenant: TenantRef,
		{ search, page }: { search: string; page: number },
	): Promise<ClientPage> {
		const query = Client.query().where("tenant_id", tenant.id);
		const term = search.trim();
		if (term) {
			const digits = term.replace(/\D/g, "");
			// Grouped, so the soft-delete filter appended later still applies to
			// both branches.
			query.where((group) => {
				group.whereRaw("name ilike ? escape '\\'", [`%${escapeLike(term)}%`]);
				if (digits.length >= 3) {
					group.orWhereRaw("replace(phone, '+', '') like ?", [`%${digits}%`]);
				}
			});
		}
		const result = await query
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, CLIENTS_PER_PAGE);
		return {
			clients: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/**
	 * Saves an owner's edit, under the client's row lock. An anonymized
	 * client (TAT-42) is refused ("anonymized"); a phone another live client
	 * of the tenant has is refused ("phone_taken") by the unique index,
	 * caught after the savepoint rolled back. Empty email and notes become
	 * null.
	 */
	async update(
		tenant: TenantRef,
		client: Client,
		input: ClientInput,
	): Promise<Client> {
		if (client.tenantId !== tenant.id) {
			throw new Error(`Client ${client.id} belongs to another tenant`);
		}
		try {
			return await withTransaction(async (trx) => {
				const live = await Client.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("id", client.id)
					.forUpdate()
					.firstOrFail();
				if (live.anonymizedAt) throw new ClientRuleError("anonymized");
				live.merge({
					name: input.name,
					phone: input.phone,
					email: input.email || null,
					notes: input.notes || null,
				});
				await live.save();
				return live;
			});
		} catch (error) {
			if (isUniqueViolation(error, PHONE_INDEX)) {
				throw new ClientRuleError("phone_taken");
			}
			throw error;
		}
	}
}

/** Escapes LIKE's wildcards and its escape character. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
