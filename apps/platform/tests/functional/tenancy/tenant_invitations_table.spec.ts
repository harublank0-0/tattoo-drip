import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { addArtist } from "#tests/helpers/artists";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

const WEEK = 7 * 24 * 60 * 60 * 1000;
let next = 0;

/** A valid row for `tenantId`; every call gets its own address and hash. */
function row(tenantId: string, over: Record<string, unknown> = {}) {
	next += 1;
	return {
		tenant_id: tenantId,
		email: `invitee-${next}@table-33.example`,
		role: "artist",
		token_hash: String(next).padStart(64, "0"),
		expires_at: new Date(Date.now() + WEEK),
		...over,
	};
}

const insert = (values: Record<string, unknown>) =>
	withTransaction((inner) => insertRow(inner, "tenant_invitations", values));

test.group("tenant_invitations table (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "tenant_invitations", async (tenant) =>
			row(tenant.id),
		);
	});

	test("one invitation per studio and address, and no token hash twice anywhere", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("table-a-33");
		const { tenant: other } = await studioWithOwner("table-b-33");
		const first = row(tenant.id);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await insert(first);
			await assert.rejects(
				() => insert(row(tenant.id, { email: first.email })),
				/tenant_invitations_tenant_id_email_unique/,
			);
		});
		await withDbContext({ tenantId: other.id }, async () => {
			// Another studio may invite the same address…
			await insert(row(other.id, { email: first.email }));
			// …but no two invitations share a token.
			await assert.rejects(
				() => insert(row(other.id, { token_hash: first.token_hash })),
				/tenant_invitations_token_hash_unique/,
			);
		});
	});

	test("the address is canonical, the role known and the expiry after creation", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("table-checks-33");

		await withDbContext({ tenantId: tenant.id }, async () => {
			for (const email of ["Ink@Example.com", " ink@example.com"]) {
				await assert.rejects(
					() => insert(row(tenant.id, { email })),
					/tenant_invitations_email_canonical/,
				);
			}
			await assert.rejects(
				() => insert(row(tenant.id, { role: "staff" })),
				/tenant_invitations_role_check/,
			);
			await assert.rejects(
				() =>
					insert(row(tenant.id, { expires_at: new Date(Date.now() - 60_000) })),
				/tenant_invitations_expires_after_creation/,
			);
		});
	});

	test("the profile to claim must be one of the studio's own", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("table-claim-33");
		const { owner: otherOwner, tenant: other } =
			await studioWithOwner("table-foreign-33");
		const own = await addArtist(tenant, owner);
		const foreign = await addArtist(other, otherOwner);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await insert(row(tenant.id, { artist_id: own.id }));
			await assert.rejects(
				() => insert(row(tenant.id, { artist_id: foreign.id })),
				/tenant_invitations_tenant_id_artist_id_foreign/,
			);
		});
	});
});
