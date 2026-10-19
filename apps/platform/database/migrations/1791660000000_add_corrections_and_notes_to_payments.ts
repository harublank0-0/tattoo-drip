import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * TAT-37's guard body, which down() restores. Kept verbatim: the pinned
 * search_path, the free columns and the finality rules.
 */
const GUARD_TAT_37 = `
create or replace function payments_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
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
	-- becoming null, and only once that user row is gone: ON DELETE SET NULL
	-- runs after the delete, so the row is invisible to it, while an ordinary
	-- UPDATE with the account still there would erase who decided. The table is
	-- schema-qualified because the search_path is pinned.
	if old.status <> 'submitted' then
		if new.status is distinct from old.status then
			raise exception 'payments_guard: status cannot change';
		end if;
		if new.verified_at is distinct from old.verified_at then
			raise exception 'payments_guard: verified_at cannot change';
		end if;
		if new.verified_by_user_id is distinct from old.verified_by_user_id
			and (new.verified_by_user_id is not null
				or exists (select 1 from public.users where id = old.verified_by_user_id)) then
			raise exception 'payments_guard: verified_by_user_id cannot change';
		end if;
	end if;
	return new;
end
$$`;

/**
 * The guard with the note rule (TAT-66): `note` is written at insert or in
 * the one update that decides a submitted payment, and afterwards can only
 * be cleared (TAT-42), like the proof. Every other column it doesn't name,
 * `corrects_payment_id` included, stays frozen.
 */
const GUARD_WITH_NOTE = `
create or replace function payments_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array['status', 'verified_by_user_id', 'verified_at', 'updated_at', 'proof_image_key', 'proof_image_width', 'proof_image_height', 'note'];
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
	-- The note goes with the decision, or is cleared (TAT-42); nothing else.
	if new.note is distinct from old.note and new.note is not null
		and not (old.status = 'submitted' and new.status <> 'submitted') then
		raise exception 'payments_guard: note cannot change';
	end if;
	-- A decided payment is final. The one change allowed is the verifier
	-- becoming null, and only once that user row is gone: ON DELETE SET NULL
	-- runs after the delete, so the row is invisible to it, while an ordinary
	-- UPDATE with the account still there would erase who decided. The table is
	-- schema-qualified because the search_path is pinned.
	if old.status <> 'submitted' then
		if new.status is distinct from old.status then
			raise exception 'payments_guard: status cannot change';
		end if;
		if new.verified_at is distinct from old.verified_at then
			raise exception 'payments_guard: verified_at cannot change';
		end if;
		if new.verified_by_user_id is distinct from old.verified_by_user_id
			and (new.verified_by_user_id is not null
				or exists (select 1 from public.users where id = old.verified_by_user_id)) then
			raise exception 'payments_guard: verified_by_user_id cannot change';
		end if;
	end if;
	return new;
end
$$`;

/**
 * Run first by up(): before TAT-66 a `correction` named no payment, and
 * nothing in the product inserted one (only tests did), so a database that
 * has one cannot get the "a correction names its payment" rule. Applying
 * stops here, with the whole migration rolled back, instead of failing later
 * on `payments_correction_target`. At this point every correction is one
 * without a target, because the column is new.
 */
export const REFUSE_APPLY_OVER_CORRECTIONS = `
do $$
begin
	if exists (select 1 from payments where kind = 'correction') then
		raise exception 'payments holds correction rows that name no payment, which TAT-66 requires: delete them as the owner role (alter table payments disable trigger payments_guard around the delete) or reset the development database, then migrate again';
	end if;
end
$$`;

/**
 * Run first by down(): the old schema has nowhere to keep which payment a
 * correction reverses, so rolling back over a reversal would drop the link
 * and leave a correction that up() then refuses. The ledger is never rolled
 * back once it holds reversals: reset the development database instead.
 */
export const REFUSE_ROLLBACK_OVER_CORRECTIONS = `
do $$
begin
	if exists (select 1 from payments where kind = 'correction') then
		raise exception 'payments holds reversals: rolling back would drop the payments the reversals name (corrects_payment_id) and the migration could not be applied again; reset the development database instead';
	end if;
end
$$`;

/**
 * Corrections and notes on the ledger (TAT-66). A correction names the
 * payment it reverses: same tenant and project (the composite key), never
 * itself, at most once (the unique index). Only a correction names one. A
 * payment can carry a staff note (payments_guard decides when it may
 * change). The guard's trigger stays bound; only its function is replaced.
 *
 * Both directions refuse to run over existing corrections (see the two
 * statements above): up() because they have no target to give, down()
 * because it would drop the targets of reversals.
 */
export default class extends BaseSchema {
	protected tableName = "payments";

	async up() {
		this.schema.raw(REFUSE_APPLY_OVER_CORRECTIONS);
		this.schema.alterTable(this.tableName, (table) => {
			table.uuid("corrects_payment_id").nullable();
			table.string("note", 500).nullable();
		});
		for (const statement of [
			// The target of the correction's composite key.
			"alter table payments add constraint payments_tenant_project_id_unique unique (tenant_id, project_id, id)",
			"alter table payments add constraint payments_corrects_payment_foreign foreign key (tenant_id, project_id, corrects_payment_id) references payments (tenant_id, project_id, id) on delete no action",
			// One reversal per payment; also the foreign key's index.
			"create unique index payments_corrects_payment_id_unique on payments (corrects_payment_id)",
			"alter table payments add constraint payments_correction_target check ((kind = 'correction') = (corrects_payment_id is not null))",
			"alter table payments add constraint payments_correction_not_itself check (corrects_payment_id <> id)",
			GUARD_WITH_NOTE,
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		this.schema.raw(REFUSE_ROLLBACK_OVER_CORRECTIONS);
		for (const statement of [
			GUARD_TAT_37,
			"alter table payments drop constraint payments_correction_not_itself",
			"alter table payments drop constraint payments_correction_target",
			"drop index payments_corrects_payment_id_unique",
			"alter table payments drop constraint payments_corrects_payment_foreign",
			"alter table payments drop constraint payments_tenant_project_id_unique",
		]) {
			this.schema.raw(statement);
		}
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("note");
			table.dropColumn("corrects_payment_id");
		});
	}
}
