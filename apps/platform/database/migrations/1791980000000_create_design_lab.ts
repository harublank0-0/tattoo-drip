import { BaseSchema } from "@adonisjs/lucid/schema";
import { enableTenantRls, tenantReference } from "#database/helpers/tenant_rls";
import env from "#start/env";

/**
 * AI Design Lab (docs/design-lab.md): artists' private tattoo concept
 * generation. Four tenant-owned tables, each with RLS and composite tenant
 * keys:
 *
 * - `design_projects` (soft-deleted business record): a studio member's
 *   workspace for one idea, optionally linked to a tattoo project (a
 *   booking) of the same studio. Never holds client data itself.
 * - `design_generations`: one provider request (one image). The validated
 *   structured inputs and the prompt template's version are stored, never
 *   the client's name; the provider's polling URL is sealed with the app's
 *   encryption key and never leaves the server. `step` fences the worker's
 *   runs (see GenerationRunner); `attempt` counts retries of the same row.
 * - `design_assets`: the stored image of a completed generation (the
 *   private `design_concept` purpose), at most one per generation and at
 *   most one selected per design project.
 * - `design_usage_records`: the allowance ledger. One row per generation
 *   attempt: reserved when accepted, settled once the image is stored,
 *   released on a failure or moderation. Never deleted.
 *
 * One SECURITY DEFINER function, `stuck_design_generation_candidates()`
 * (ids only, the database README's rules), feeds the stuck-generation sweep.
 * Its body reads `design_generations.tenant_id`, `id`, `status` and
 * `updated_at`: a migration that drops or retypes one of them must replace
 * the function in the same migration.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.createTable("design_projects", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table
				.uuid("created_by")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL")
				.index();
			table.uuid("tattoo_project_id").nullable();
			table.string("title", 120).notNullable();
			table.text("notes").nullable();
			table.string("review_state", 16).notNullable().defaultTo("exploring");
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();
			table.index(["tenant_id", "deleted_at", "created_at", "id"]);
			table.index(["tenant_id", "tattoo_project_id"]);
		});
		for (const sql of enableTenantRls("design_projects")) this.schema.raw(sql);
		this.schema.raw(`
			alter table design_projects
			add constraint design_projects_tattoo_project_fk
				foreign key (tenant_id, tattoo_project_id)
				references tattoo_projects (tenant_id, id)
				on delete set null (tattoo_project_id),
			add constraint design_projects_title check (char_length(btrim(title)) between 1 and 120),
			add constraint design_projects_notes check (notes is null or char_length(notes) <= 2000),
			add constraint design_projects_review_state check (review_state in ('exploring', 'decided', 'archived'))
		`);

		this.schema.createTable("design_generations", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("design_project_id").notNullable();
			tenantReference(table, "design_project_id", "design_projects");
			table
				.uuid("created_by")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL")
				.index();
			// One submit form's id, and which of its variations this row is.
			table.uuid("request_id").notNullable();
			table.smallint("variant_index").notNullable().defaultTo(0);
			table.string("provider", 32).notNullable();
			table.string("model", 64).notNullable();
			table.string("prompt_version", 32).notNullable();
			table.jsonb("inputs").notNullable();
			table.string("status", 16).notNullable().defaultTo("queued");
			table.string("failure_code", 32).nullable();
			table.smallint("attempt").notNullable().defaultTo(1);
			table.integer("step").notNullable().defaultTo(0);
			table.string("provider_request_id", 128).nullable();
			table.text("polling_url_sealed").nullable();
			table.jsonb("provider_meta").nullable();
			table.timestamp("accepted_at", { useTz: true }).notNullable();
			table.timestamp("submitted_at", { useTz: true }).nullable();
			table.timestamp("finished_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.unique(["tenant_id", "request_id", "variant_index"]);
			table.index(["tenant_id", "design_project_id", "created_at", "id"]);
		});
		for (const sql of enableTenantRls("design_generations"))
			this.schema.raw(sql);
		this.schema.raw(`
			alter table design_generations
			add constraint design_generations_status check (
				status in ('queued', 'processing', 'completed', 'failed', 'moderated')
			),
			add constraint design_generations_failure check (
				(status in ('failed', 'moderated')) = (failure_code is not null)
			),
			add constraint design_generations_finished check (
				(status in ('completed', 'failed', 'moderated')) = (finished_at is not null)
			),
			add constraint design_generations_processing check (
				status <> 'processing'
				or (provider_request_id is not null and polling_url_sealed is not null and submitted_at is not null)
			),
			add constraint design_generations_variant check (variant_index between 0 and 7),
			add constraint design_generations_attempt check (attempt between 1 and 20),
			add constraint design_generations_step check (step >= 0)
		`);
		this.schema.raw(
			"create index design_generations_unfinished on design_generations (updated_at) where status in ('queued', 'processing')",
		);

		this.schema.createTable("design_assets", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("design_project_id").notNullable();
			tenantReference(table, "design_project_id", "design_projects");
			table.uuid("generation_id").notNullable();
			tenantReference(table, "generation_id", "design_generations");
			table.string("image_key", 255).notNullable();
			table.integer("width").notNullable();
			table.integer("height").notNullable();
			table.string("title", 120).nullable();
			table.text("notes").nullable();
			table.timestamp("selected_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.unique(["tenant_id", "generation_id"]);
			table.unique(["tenant_id", "image_key"]);
			table.index(["tenant_id", "design_project_id", "created_at", "id"]);
		});
		for (const sql of enableTenantRls("design_assets")) this.schema.raw(sql);
		this.schema.raw(`
			alter table design_assets
			add constraint design_assets_size check (width between 1 and 8192 and height between 1 and 8192),
			add constraint design_assets_title check (title is null or char_length(btrim(title)) between 1 and 120),
			add constraint design_assets_notes check (notes is null or char_length(notes) <= 2000)
		`);
		this.schema.raw(
			"create unique index design_assets_one_selected on design_assets (tenant_id, design_project_id) where selected_at is not null",
		);

		this.schema.createTable("design_usage_records", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("generation_id").notNullable();
			tenantReference(table, "generation_id", "design_generations");
			table.smallint("attempt").notNullable();
			table
				.uuid("user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL")
				.index();
			table.string("provider", 32).notNullable();
			table.string("model", 64).notNullable();
			table.smallint("units").notNullable().defaultTo(1);
			table.decimal("estimated_credits", 10, 3).nullable();
			table.decimal("actual_credits", 10, 3).nullable();
			table.string("status", 16).notNullable().defaultTo("reserved");
			table.string("release_reason", 32).nullable();
			table.timestamp("reserved_at", { useTz: true }).notNullable();
			table.timestamp("settled_at", { useTz: true }).nullable();
			table.timestamp("released_at", { useTz: true }).nullable();
			table.unique(["tenant_id", "generation_id", "attempt"]);
			table.index(["tenant_id", "reserved_at"]);
		});
		for (const sql of enableTenantRls("design_usage_records"))
			this.schema.raw(sql);
		this.schema.raw(`
			alter table design_usage_records
			add constraint design_usage_records_status check (status in ('reserved', 'settled', 'released')),
			add constraint design_usage_records_settled check ((status = 'settled') = (settled_at is not null)),
			add constraint design_usage_records_released check (
				(status = 'released') = (released_at is not null and release_reason is not null)
			),
			add constraint design_usage_records_units check (units between 1 and 8),
			add constraint design_usage_records_credits check (
				(estimated_credits is null or estimated_credits >= 0)
				and (actual_credits is null or actual_credits >= 0)
			)
		`);

		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		for (const statement of [
			`create function public.stuck_design_generation_candidates()
returns table (tenant_id uuid, generation_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select g.tenant_id, g.id
  from public.design_generations g
  where g.status in ('queued', 'processing')
    and g.updated_at <= statement_timestamp() - interval '30 minutes'
  order by g.updated_at, g.id
  limit 500;
end`,
			"revoke all on function public.stuck_design_generation_candidates() from public",
			`grant execute on function public.stuck_design_generation_candidates() to ${appRole}`,
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		this.schema.raw(
			"drop function public.stuck_design_generation_candidates()",
		);
		this.schema.dropTable("design_usage_records");
		this.schema.dropTable("design_assets");
		this.schema.dropTable("design_generations");
		this.schema.dropTable("design_projects");
	}
}
