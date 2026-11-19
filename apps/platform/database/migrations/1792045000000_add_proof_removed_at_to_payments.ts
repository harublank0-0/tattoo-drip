import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The guard before this migration (1791660000000's, with the note rule),
 * which down() restores verbatim.
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
 * The guard with the removed-screenshot rule (the storage meter, spec
 * ruling 7): `proof_removed_at` is set once, by the owner's removal of a
 * decided payment's screenshot, in the same update that clears the proof,
 * and never changes again. Everything else is 1791660000000's guard.
 */
const GUARD_WITH_PROOF_REMOVAL = `
create or replace function payments_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array['status', 'verified_by_user_id', 'verified_at', 'updated_at', 'proof_image_key', 'proof_image_width', 'proof_image_height', 'note', 'proof_removed_at'];
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
	-- The studio removed the screenshot (the storage meter): set once, only
	-- in the update that clears a proof the payment had.
	if new.proof_removed_at is distinct from old.proof_removed_at
		and (old.proof_removed_at is not null or new.proof_removed_at is null
			or old.proof_image_key is null or new.proof_image_key is not null) then
		raise exception 'payments_guard: proof_removed_at is set only when the proof is removed';
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
 * When the studio deleted a payment's deposit screenshot to free storage
 * (the storage meter): the payment keeps its amount, date and verification
 * and says "Screenshot removed by the studio".
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("payments", (table) => {
			table.timestamp("proof_removed_at", { useTz: true }).nullable();
		});
		this.schema.raw(
			"alter table payments add constraint payments_proof_removed check (proof_removed_at is null or proof_image_key is null)",
		);
		this.schema.raw(GUARD_WITH_PROOF_REMOVAL);
	}

	async down() {
		this.schema.raw(GUARD_WITH_NOTE);
		this.schema.raw(
			"alter table payments drop constraint payments_proof_removed",
		);
		this.schema.alterTable("payments", (table) => {
			table.dropColumn("proof_removed_at");
		});
	}
}
