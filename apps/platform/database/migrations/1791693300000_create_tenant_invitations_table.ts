import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";

/**
 * Invitations to join a studio (TAT-33). Bound to one email address in its
 * canonical form (the same check as users_email_canonical, copied: a
 * migration never imports app code), with the role the member gets and an
 * optional artist profile to claim. Only the token's SHA-256 is stored,
 * under a unique index; the invitation page finds the row's studio through
 * invitation_tenant() (the next migration). One per studio and address: a
 * new invitation replaces the old one. Not soft-deleted: a credential,
 * deleted when accepted or cancelled, and with a member's removal (theirs
 * and the owner ones they sent); an expired one is not purged, it stays
 * (address included) until it is renewed or cancelled. The roles are
 * MEMBERSHIP_ROLES (copied).
 */
export default class extends BaseSchema {
	protected tableName = "tenant_invitations";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("email", 254).notNullable();
			table.enum("role", ["owner", "artist"]).notNullable();
			table.uuid("artist_id").nullable();
			table.string("token_hash", 64).notNullable().unique();
			table
				.uuid("invited_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("expires_at", { useTz: true }).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "artist_id", "artists");

			// One per studio and address; also the tenant_id index.
			table.unique(["tenant_id", "email"]);
			// The composite key's index.
			table.index(["tenant_id", "artist_id"]);
			// Deleting an account sets its invitations' inviter to null.
			table.index(["invited_by_user_id"]);
		});
		for (const statement of [
			`alter table tenant_invitations add constraint tenant_invitations_email_canonical check (email = translate(btrim(email), '${UPPER}', '${LOWER}'))`,
			"alter table tenant_invitations add constraint tenant_invitations_expires_after_creation check (expires_at > created_at)",
			...enableTenantRls(this.tableName),
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
