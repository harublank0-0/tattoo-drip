import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { test } from "@japa/runner";
import User from "#models/user";
import { SlugTakenError } from "#modules/tenancy/errors";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { STORED_SLUG } from "#modules/tenancy/slugs";
import { type DbContextValues, withDbContext } from "#services/db_context";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL on purpose: the database keeps the registry whatever code writes.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

/** The tenant's registered slugs, as the tenant sees them. */
async function slugsOf(tenant: { id: string }) {
	const { rows } = await sql(
		{ tenantId: tenant.id },
		"select slug from tenant_slugs where tenant_id = ? order by slug",
		[tenant.id],
	);
	return rows.map((row: { slug: string }) => row.slug);
}

/** A rename in the tenant's own context, as any writer could do it. */
function rename(tenant: { id: string }, slug: string) {
	return sql(
		{ tenantId: tenant.id },
		"update tenants set slug = ? where id = ?",
		[slug, tenant.id],
	);
}

function newStudio(email: string, slug: string) {
	return User.create({ email, password: "secret-password" }).then((owner) =>
		new TenancyService().createTenant(owner, {
			type: "studio",
			name: "New Studio",
			slug,
			timezone: "Asia/Kathmandu",
		}),
	);
}

test.group("Slug registry", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creating a tenant registers its slug", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");

		assert.deepEqual(await slugsOf(tenant), ["black-needle"]);
	});

	test("a new slug is registered and the old one kept", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");

		await rename(tenant, "red-ink");

		assert.deepEqual(await slugsOf(tenant), ["black-needle", "red-ink"]);
	});

	test("an update that keeps the slug registers nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("black-needle");

		await sql(
			{ tenantId: tenant.id },
			"update tenants set slug = slug, name = 'Renamed' where id = ?",
			[tenant.id],
		);

		assert.deepEqual(await slugsOf(tenant), ["black-needle"]);
	});

	test("a tenant can go back to its own old slug", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");

		await rename(tenant, "red-ink");
		await rename(tenant, "black-needle");

		assert.deepEqual(await slugsOf(tenant), ["black-needle", "red-ink"]);
	});

	test("another tenant can't take an old slug, by rename or by creating a tenant", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await rename(a.tenant, "studio-a-new");

		await assert.rejects(
			() => rename(b.tenant, "studio-a"),
			/tenant_slugs_slug_unique/,
		);
		await assert.rejects(
			() => newStudio("third@example.com", "studio-a"),
			SlugTakenError,
		);

		assert.deepEqual(await slugsOf(a.tenant), ["studio-a", "studio-a-new"]);
		assert.deepEqual(await slugsOf(b.tenant), ["studio-b"]);
	});

	test("a deleted tenant's current and old slugs stay taken", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("black-needle");
		await rename(tenant, "red-ink");
		await inTenant(tenant, () => tenant.softDelete());

		await assert.rejects(
			() => newStudio("first@example.com", "red-ink"),
			SlugTakenError,
		);
		await assert.rejects(
			() => newStudio("second@example.com", "black-needle"),
			SlugTakenError,
		);
	});

	test("slugs are hidden from other tenants and from users who aren't members", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await rename(a.tenant, "studio-a-new");

		const asB = await sql(
			{ tenantId: b.tenant.id },
			"select slug from tenant_slugs",
		);
		assert.deepEqual(
			asB.rows.map((row: { slug: string }) => row.slug),
			["studio-b"],
		);
		const asStranger = await sql(
			{ userId: b.owner.id },
			"select slug from tenant_slugs where slug = ?",
			["studio-a"],
		);
		assert.lengthOf(asStranger.rows, 0);
		const asMember = await sql(
			{ userId: a.owner.id },
			"select slug from tenant_slugs order by slug",
		);
		assert.deepEqual(
			asMember.rows.map((row: { slug: string }) => row.slug),
			["studio-a", "studio-a-new"],
		);
		const asNobody = await sql({}, "select slug from tenant_slugs");
		assert.lengthOf(asNobody.rows, 0);
	});

	test("the app can neither change nor delete a registered slug", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("black-needle");

		const update = await sql(
			{ tenantId: tenant.id },
			"update tenant_slugs set slug = 'stolen' where tenant_id = ?",
			[tenant.id],
		);
		const remove = await sql(
			{ tenantId: tenant.id },
			"delete from tenant_slugs where tenant_id = ?",
			[tenant.id],
		);

		assert.equal(update.rowCount, 0);
		assert.equal(remove.rowCount, 0);
		assert.deepEqual(await slugsOf(tenant), ["black-needle"]);
	});

	test("a slug can't be registered for another tenant", async ({ assert }) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");

		await assert.rejects(
			() =>
				sql(
					{ tenantId: a.tenant.id },
					"insert into tenant_slugs (tenant_id, slug) values (?, 'sneaky')",
					[b.tenant.id],
				),
			/row-level security policy for table "tenant_slugs"/,
		);
	});

	test("the registry holds only lowercase DNS labels", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");
		const insert = (slug: string) =>
			sql(
				{ tenantId: tenant.id },
				"insert into tenant_slugs (tenant_id, slug) values (?, ?)",
				[tenant.id, slug],
			);

		await assert.rejects(() => insert("Black-Ink"), /tenant_slugs_slug_format/);
		await assert.rejects(() => insert("-ink"), /tenant_slugs_slug_format/);
		await assert.rejects(() => insert("ab"), /tenant_slugs_slug_format/);
		// A raw rename of the current slug goes through the same check.
		await assert.rejects(
			() => rename(tenant, "Black-Needle"),
			/tenant_slugs_slug_format/,
		);
		assert.deepEqual(await slugsOf(tenant), ["black-needle"]);
	});

	test("STORED_SLUG is the shape the registry's CHECK enforces", async ({
		assert,
	}) => {
		// The public API pre-filters path slugs with STORED_SLUG, so it must
		// not drift from the constraint that decides what can be stored.
		const { rows } = await sql(
			{},
			"select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'tenant_slugs_slug_format'",
		);

		assert.lengthOf(rows, 1);
		assert.include(rows[0].definition, STORED_SLUG.source);
	});
});
