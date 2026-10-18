import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The channels and messages a last contact records (TAT-52). Copied from
 * #modules/notifications/messages, not imported: a migration must not
 * change when the app's lists do.
 */
const CHANNELS = ["whatsapp", "viber", "call", "copy"];
const KINDS = [
	"inquiry_received",
	"quote",
	"deposit_link",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
];

/** TAT-37's free columns, and the three this migration frees as well. */
const FREE_TAT_37 = [
	"status",
	"decided_at",
	"deleted_at",
	"updated_at",
	"anonymized_at",
];
const LAST_CONTACT = [
	"last_contacted_at",
	"last_contact_channel",
	"last_contact_kind",
];

/**
 * inquiries_guard_update with `free` as its free columns. Otherwise TAT-37's
 * body verbatim: the pinned search_path, the fail-closed check and the
 * one-shot scrub.
 */
const guard = (free: string[]) => `
create or replace function inquiries_guard_update() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array[${free.map((column) => `'${column}'`).join(", ")}];
	scrub text[] := array['contact_name', 'contact_phone', 'contact_email', 'idea', 'placement', 'approximate_size', 'preferred_dates', 'budget'];
	changed text;
begin
	if old.anonymized_at is not null and new.anonymized_at is distinct from old.anonymized_at then
		raise exception 'inquiries_guard_update: anonymized_at cannot change';
	end if;
	-- The scrub columns are free only in the update that first sets the marker.
	if old.anonymized_at is null and new.anonymized_at is not null then
		free := free || scrub;
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'inquiries_guard_update: % cannot change', changed;
	end if;
	return new;
end
$$`;

/**
 * When staff last contacted the client, on which channel and with which of
 * the studio's messages (TAT-52): on projects (which had the time since
 * TAT-37) and on inquiries, whose guard trigger frees exactly these three
 * columns; everything submitted stays frozen. Rolling back restores TAT-37's
 * guard first, then drops the columns (and the contacts recorded in them).
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("inquiries", (table) => {
			table.timestamp("last_contacted_at", { useTz: true }).nullable();
		});
		for (const name of ["tattoo_projects", "inquiries"]) {
			this.schema.alterTable(name, (table) => {
				table.enum("last_contact_channel", CHANNELS).nullable();
				table.enum("last_contact_kind", KINDS).nullable();
			});
			this.schema.raw(
				`alter table ${name} add constraint ${name}_last_contact_needs_time check (last_contacted_at is not null or (last_contact_channel is null and last_contact_kind is null))`,
			);
		}
		this.schema.raw(guard([...FREE_TAT_37, ...LAST_CONTACT]));
	}

	async down() {
		this.schema.raw(guard(FREE_TAT_37));
		for (const name of ["tattoo_projects", "inquiries"]) {
			this.schema.raw(
				`alter table ${name} drop constraint ${name}_last_contact_needs_time`,
			);
			this.schema.alterTable(name, (table) => {
				table.dropColumn("last_contact_kind");
				table.dropColumn("last_contact_channel");
			});
		}
		this.schema.alterTable("inquiries", (table) => {
			table.dropColumn("last_contacted_at");
		});
	}
}
