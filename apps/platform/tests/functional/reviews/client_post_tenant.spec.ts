import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ClientPost from "#modules/reviews/models/client_post";
import Tenant from "#modules/tenancy/models/tenant";
import { sql } from "#tests/helpers/sql";
import { inTenant, twoStudios } from "#tests/helpers/tenants";

const lookup = async (id: string) =>
	(await sql({}, "select public.client_post_tenant(?::uuid) as id", [id]))
		.rows[0].id as string | null;

test.group("client_post_tenant()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the live studio holding exactly that post, deleted posts included; nothing for anything else", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const { rows } = await sql(
			{},
			"select count(*)::int as n from client_posts",
		);
		assert.equal(rows[0].n, 0, "the app role alone sees no post");
		assert.equal(await lookup(a.waitingPost.id), a.tenant.id);
		assert.equal(await lookup(b.waitingPost.id), b.tenant.id);
		assert.isNull(await lookup(randomUUID()));
		assert.isNull(
			await lookup(a.clientReview.id),
			"a review's id is not a post's",
		);
		const { rows: nothing } = await sql(
			{},
			"select public.client_post_tenant(null) as id",
		);
		assert.isNull(nothing[0].id, "strict: null in, null out");

		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.waitingPost.id).update({
				deleted_at: new Date(),
				shown_name: "",
			}),
		);
		assert.equal(await lookup(a.waitingPost.id), a.tenant.id);
		await inTenant(b.tenant, async () =>
			(await Tenant.findOrFail(b.tenant.id)).softDelete(),
		);
		assert.isNull(await lookup(b.waitingPost.id), "a deleted studio's");
	});
});
