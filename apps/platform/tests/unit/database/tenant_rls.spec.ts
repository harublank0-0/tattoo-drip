import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

test.group("tenant RLS migration helpers", () => {
	test("enableTenantRls enables RLS, adds the composite-key target and the standard policy", ({
		assert,
	}) => {
		assert.deepEqual(enableTenantRls("quotes"), [
			"alter table quotes enable row level security",
			"alter table quotes add constraint quotes_tenant_id_id_unique unique (tenant_id, id)",
			"create policy tenant_isolation on quotes for all using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()))",
		]);
	});

	test("disableTenantRls undoes it in reverse order", ({ assert }) => {
		assert.deepEqual(disableTenantRls("quotes"), [
			"drop policy tenant_isolation on quotes",
			"alter table quotes drop constraint quotes_tenant_id_id_unique",
			"alter table quotes disable row level security",
		]);
	});

	test("tenantReference builds a composite foreign key through tenant_id", ({
		assert,
	}) => {
		const sql = db
			.connection()
			.schema.createTable("probe_child", (table) => {
				table.uuid("id").primary();
				table.uuid("tenant_id").notNullable();
				table.uuid("parent_id").notNullable();
				tenantReference(table, "parent_id", "probe_parent");
			})
			.toQuery();

		assert.match(
			sql,
			/foreign key \("tenant_id", "parent_id"\) references "probe_parent" \("tenant_id", "id"\) on delete CASCADE/i,
		);
	});
});
