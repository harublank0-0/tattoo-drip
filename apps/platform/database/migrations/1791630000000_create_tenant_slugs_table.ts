import { BaseSchema } from "@adonisjs/lucid/schema";

const TENANT = "(select app_tenant_id())";
const USER = "(select app_user_id())";

/**
 * Every slug a tenant has held, its current one included (TAT-24). The
 * unique slug is one namespace for the whole platform: once a tenant has
 * used a slug, no other tenant can ever get it, so an old link never lands
 * on someone else's studio. The index enforces that without any
 * cross-tenant read.
 *
 * The tenants_register_slug trigger writes the rows whenever a tenant is
 * created or its slug changes; app code never does. RLS has SELECT and
 * INSERT policies only, so the app role can neither change nor delete a
 * row. Releasing a slug is a deliberate operations step as the owner role.
 * The key to tenants is NO ACTION, so a hard purge of a tenant has to
 * release its slugs first.
 *
 * The CHECK is the shape slugs have always had, so every existing slug is
 * copied as it is; the stricter rules for new slugs live in
 * #modules/tenancy/slugs. The (tenant_id, id) unique index also serves
 * lookups by tenant_id.
 */
export default class extends BaseSchema {
	protected tableName = "tenant_slugs";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table.uuid("tenant_id").notNullable().references("id").inTable("tenants");
			table.string("slug", 63).notNullable().unique();
			table
				.timestamp("created_at", { useTz: true })
				.notNullable()
				.defaultTo(this.now());
			table.unique(["tenant_id", "id"]);
		});

		const statements = [
			"alter table tenant_slugs add constraint tenant_slugs_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$')",
			"insert into tenant_slugs (tenant_id, slug, created_at) select id, slug, created_at from tenants",
			// Invoker rights: under the app role RLS applies, and the tenants
			// policies already require the tenant's own context for these writes.
			// search_path is pinned and tables are schema-qualified.
			`create function tenants_register_slug() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
	if not exists (
		select 1 from public.tenant_slugs s where s.slug = new.slug and s.tenant_id = new.id
	) then
		insert into public.tenant_slugs (tenant_id, slug) values (new.id, new.slug);
	end if;
	return null;
end
$$`,
			"create trigger tenants_register_slug after insert or update of slug on tenants for each row execute function tenants_register_slug()",
			"alter table tenant_slugs enable row level security",
			// As tenants_select: the current tenant, or a tenant the user is a
			// live member of (resolving an old slug on the dashboard).
			`create policy tenant_slugs_select on tenant_slugs for select using (tenant_id = ${TENANT} or tenant_id in (select tenant_id from tenant_memberships where user_id = ${USER} and deleted_at is null))`,
			`create policy tenant_slugs_insert on tenant_slugs for insert with check (tenant_id = ${TENANT})`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop trigger tenants_register_slug on tenants");
		this.schema.raw("drop function tenants_register_slug()");
		this.schema.dropTable(this.tableName);
	}
}
