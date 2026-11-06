import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * An inquiry's style, colour and notes as their own fields, and one
 * reference code from the request to its deposit
 * (docs/superpowers/specs/2026-11-06-inquiry-details-and-reference-design.md).
 *
 * The four new `inquiries` columns are frozen once submitted, like every
 * column the guard does not name; `notes` is the client's free text, so it
 * joins the scrub list the anonymising update may clear. Older inquiries
 * keep no reference: the guard forbids a backfill.
 *
 * `reference_codes` holds every code a studio has used (an inquiry's, or a
 * deposit link's that came from no inquiry), so a code is unique per studio
 * across both. It starts with every deposit link's code.
 *
 * The lists are copied, not imported: a migration must not change when the
 * app's lists do.
 */
const COLOURS = ["black-grey", "colour", "undecided"];
const STYLE_SHAPE = "^[a-z0-9]+(-[a-z0-9]+)*$";
const CODE_FORMAT = "^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$";

/** The guard's free columns since the last-contact migration (TAT-52). */
const FREE = [
	"status",
	"decided_at",
	"deleted_at",
	"updated_at",
	"anonymized_at",
	"last_contacted_at",
	"last_contact_channel",
	"last_contact_kind",
];
const SCRUB_TAT_37 = [
	"contact_name",
	"contact_phone",
	"contact_email",
	"idea",
	"placement",
	"approximate_size",
	"preferred_dates",
	"budget",
];

/**
 * inquiries_guard_update with `scrub` as the columns the anonymising update
 * may clear. Otherwise the body verbatim: the pinned search_path, the
 * fail-closed check and the one-shot scrub.
 */
const guard = (scrub: string[]) => `
create or replace function inquiries_guard_update() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array[${FREE.map((column) => `'${column}'`).join(", ")}];
	scrub text[] := array[${scrub.map((column) => `'${column}'`).join(", ")}];
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

export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("inquiries", (table) => {
			table.string("style", 40).nullable();
			table.string("colour", 20).nullable();
			table.text("notes").nullable();
			table.string("reference_code", 6).nullable();
			table.unique(["tenant_id", "reference_code"]);
		});
		this.schema.raw(
			`alter table inquiries add constraint inquiries_style_shape check (style ~ '${STYLE_SHAPE}')`,
		);
		this.schema.raw(
			`alter table inquiries add constraint inquiries_colour_known check (colour in (${COLOURS.map((c) => `'${c}'`).join(", ")}))`,
		);
		this.schema.raw(
			"alter table inquiries add constraint inquiries_notes_length check (char_length(notes) <= 1000)",
		);
		this.schema.raw(
			`alter table inquiries add constraint inquiries_reference_code_format check (reference_code ~ '${CODE_FORMAT}')`,
		);
		this.schema.raw(guard([...SCRUB_TAT_37, "notes"]));

		this.schema.createTable("reference_codes", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("code", 6).notNullable();
			table
				.timestamp("created_at", { useTz: true })
				.notNullable()
				.defaultTo(this.now());
			// What a collision hits; also the tenant_id index.
			table.unique(["tenant_id", "code"]);
		});
		this.schema.raw(
			`alter table reference_codes add constraint reference_codes_code_format check (code ~ '${CODE_FORMAT}')`,
		);
		for (const sql of enableTenantRls("reference_codes")) this.schema.raw(sql);
		this.schema.raw(
			"insert into reference_codes (tenant_id, code, created_at) select tenant_id, reference_code, created_at from deposit_links",
		);
	}

	async down() {
		for (const sql of disableTenantRls("reference_codes")) this.schema.raw(sql);
		this.schema.dropTable("reference_codes");
		this.schema.raw(guard(SCRUB_TAT_37));
		for (const name of [
			"inquiries_style_shape",
			"inquiries_colour_known",
			"inquiries_notes_length",
			"inquiries_reference_code_format",
		]) {
			this.schema.raw(`alter table inquiries drop constraint ${name}`);
		}
		this.schema.alterTable("inquiries", (table) => {
			table.dropUnique(["tenant_id", "reference_code"]);
			table.dropColumn("style");
			table.dropColumn("colour");
			table.dropColumn("notes");
			table.dropColumn("reference_code");
		});
	}
}
