import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Deposit links (TAT-65): one per project, the bearer link to its public
 * deposit page. The token itself is never stored: `token_nonce` derives it
 * with APP_KEY (tokenFor in #modules/payments/deposit_links), and
 * `token_hash`, its SHA-256 in hex, is what a request is looked up by. A
 * new link replaces the nonce, the hash and the expiry in place; the
 * reference code stays. Not soft-deleted: a link is a credential, not a
 * record, and a deleted project's link is dead because the deposit page
 * loads only live projects.
 */
export default class extends BaseSchema {
	protected tableName = "deposit_links";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			// What the client writes in the payment remark; grants nothing.
			table.string("reference_code", 6).notNullable();
			table.string("token_nonce", 22).notNullable();
			table.string("token_hash", 64).notNullable();
			table.timestamp("expires_at", { useTz: true }).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects");
			table.unique(["tenant_id", "project_id"]);
			table.unique(["tenant_id", "reference_code"]);
			// Global: a request is looked up by the hash (and its path's tenant).
			table.unique(["token_hash"]);
			table.index(["tenant_id"]);
		});

		this.schema.raw(
			"alter table deposit_links add constraint deposit_links_reference_code_format check (reference_code ~ '^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$')",
		);
		this.schema.raw(
			"alter table deposit_links add constraint deposit_links_token_nonce_format check (token_nonce ~ '^[A-Za-z0-9_-]{22}$')",
		);
		this.schema.raw(
			"alter table deposit_links add constraint deposit_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
