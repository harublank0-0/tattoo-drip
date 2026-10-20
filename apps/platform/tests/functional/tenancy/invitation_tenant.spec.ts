import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { hashAccountToken } from "#modules/identity/account_tokens";
import { dbClient, withDbContext } from "#services/db_context";
import { idOf, insertRow, sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * What the function answers for `hash`, as the app role with no context. It
 * sees every studio's committed rows (the dev database's too), so the
 * "unknown" hash below is one no row can have.
 */
async function lookup(hash: string | null) {
	// A bound null isn't a typed binding value, so null is written inline.
	const { rows } =
		hash === null
			? await sql({}, "select public.invitation_tenant(null) as id")
			: await sql({}, "select public.invitation_tenant(?) as id", [hash]);
	return rows[0].id as string | null;
}

/** An invitation row in `tenant` with this token's hash; gives its id. */
async function invitationFor(tenant: { id: string }, token: string) {
	const result = await withDbContext({ tenantId: tenant.id }, (trx) =>
		insertRow(trx, "tenant_invitations", {
			tenant_id: tenant.id,
			email: `ink-${token.length}@fn-33.example`,
			role: "artist",
			token_hash: hashAccountToken(token),
			expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		}),
	);
	return idOf(result);
}

test.group("invitation_tenant() (TAT-33)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives the studio of an invitation's token hash, though the app role alone sees no invitation", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("fn-live-33");
		await invitationFor(tenant, "fn-live-33-token");

		const { rows } = await sql(
			{},
			"select count(*)::int as n from tenant_invitations",
		);
		assert.equal(rows[0].n, 0);
		assert.equal(await lookup(hashAccountToken("fn-live-33-token")), tenant.id);
	});

	test("answers for an expired invitation too: the page says it expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("fn-expired-33");
		const id = await invitationFor(tenant, "fn-expired-33-token");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenant_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 minute' where id = ?",
				[id],
			),
		);

		assert.equal(
			await lookup(hashAccountToken("fn-expired-33-token")),
			tenant.id,
		);
	});

	test("null for an unknown hash, a deleted studio and null", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("fn-gone-33");
		await invitationFor(tenant, "fn-gone-33-token");
		await inTenant(tenant, () => tenant.softDelete());

		assert.isNull(await lookup(hashAccountToken("nobody-has-this-token-33")));
		assert.isNull(await lookup(hashAccountToken("fn-gone-33-token")));
		assert.isNull(await lookup(null));
	});
});
