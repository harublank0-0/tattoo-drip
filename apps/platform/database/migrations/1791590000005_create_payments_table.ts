import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * The ledger of money received (TAT-37). Append-only: the guard trigger
 * rejects every DELETE and freezes every column except the decision
 * (`status`, `verified_by_user_id`, `verified_at`), `updated_at` and the
 * proof, which can only be cleared (TAT-42). A decided payment is final.
 * There is no `deleted_at`.
 */
export default class extends BaseSchema {
	protected tableName = "payments";

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
			table
				.enum("kind", ["deposit", "session", "balance", "refund", "correction"])
				.notNullable();
			// Signed paisa: a refund is negative.
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			// The kind of payment method used, not a link to payment_methods: those
			// can be edited or deleted, and the books must not depend on that.
			table
				.enum("method", ["fonepay", "esewa", "khalti", "bank", "cash"])
				.notNullable();
			table.string("proof_image_key", 255).nullable();
			table.integer("proof_image_width").nullable();
			table.integer("proof_image_height").nullable();
			table
				.enum("status", ["submitted", "verified", "rejected"])
				.notNullable()
				.defaultTo("submitted");
			// Set on rejection too: whoever decided.
			table
				.uuid("verified_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("verified_at", { useTz: true }).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "project_id"]);
			// Deleting a user must not scan the whole ledger.
			table.index(["verified_by_user_id"]);
		});

		this.schema.raw(
			"alter table payments add constraint payments_amount_sign check ((kind = 'refund' and amount < 0) or (kind = 'correction' and amount <> 0) or (kind not in ('refund', 'correction') and amount > 0))",
		);
		this.schema.raw(
			"alter table payments add constraint payments_verified_matches_status check ((status = 'submitted') = (verified_at is null))",
		);
		this.schema.raw(
			"alter table payments add constraint payments_unverified_has_no_verifier check (status <> 'submitted' or verified_by_user_id is null)",
		);
		this.schema.raw(
			"alter table payments add constraint payments_proof_all_or_none check ((proof_image_key is null) = (proof_image_width is null) and (proof_image_key is null) = (proof_image_height is null))",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);

		this.schema.raw(`
create function payments_guard() returns trigger language plpgsql as $$
declare
	free text[] := array['status', 'verified_by_user_id', 'verified_at', 'updated_at', 'proof_image_key', 'proof_image_width', 'proof_image_height'];
	changed text;
begin
	if tg_op = 'DELETE' then
		raise exception 'payments_guard: payments are never deleted';
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'payments_guard: % cannot change', changed;
	end if;
	-- The proof can only be cleared (TAT-42), never set to a new value.
	if (new.proof_image_key, new.proof_image_width, new.proof_image_height)
			is distinct from (old.proof_image_key, old.proof_image_width, old.proof_image_height)
		and (new.proof_image_key is not null or new.proof_image_width is not null or new.proof_image_height is not null) then
		raise exception 'payments_guard: proof can only be cleared';
	end if;
	-- A decided payment is final. The one change allowed is the verifier
	-- becoming null, which is what deleting the verifier's account does.
	if old.status <> 'submitted' then
		if new.status is distinct from old.status then
			raise exception 'payments_guard: status cannot change';
		end if;
		if new.verified_at is distinct from old.verified_at then
			raise exception 'payments_guard: verified_at cannot change';
		end if;
		if new.verified_by_user_id is distinct from old.verified_by_user_id and new.verified_by_user_id is not null then
			raise exception 'payments_guard: verified_by_user_id cannot change';
		end if;
	end if;
	return new;
end
$$`);
		this.schema.raw(
			"create trigger payments_guard before update or delete on payments for each row execute function payments_guard()",
		);
	}

	async down() {
		this.schema.raw("drop trigger payments_guard on payments");
		this.schema.raw("drop function payments_guard()");
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
