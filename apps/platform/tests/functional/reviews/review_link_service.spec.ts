import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { ReviewLinkRuleError } from "#modules/reviews/errors";
import ReviewLink from "#modules/reviews/models/review_link";
import { hashReviewToken, REVIEW_TOKEN } from "#modules/reviews/review_links";
import { makeProject, makeSession } from "#tests/helpers/pipeline";
import {
	OWNER_MEMBER,
	reviewReady,
	reviewServices,
} from "#tests/helpers/reviews";
import {
	artistIn,
	inTenant,
	inTenantAs,
	studioWithOwner,
	twoStudios,
} from "#tests/helpers/tenants";

test.group("ReviewLinkService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("makes one link per project, shows the same one again, and keeps only its digest", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("rl-one", "RL One");
		const { links } = reviewServices();
		const { project } = await inTenant(tenant, () => reviewReady(tenant));

		const first = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);
		const again = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);

		assert.isTrue(first.created);
		assert.isFalse(again.created);
		assert.equal(again.token, first.token);
		assert.match(first.token, REVIEW_TOKEN);
		assert.equal(
			first.url,
			`http://rl-one.localhost:3000/review#${first.token}`,
		);
		const rows = await inTenant(tenant, () => ReviewLink.query());
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].tokenHash, hashReviewToken(first.token));
		assert.notInclude(JSON.stringify(rows[0].serialize()), first.token);
		assert.equal(rows[0].createdBy, owner.id);
		assert.closeTo(
			rows[0].expiresAt.diff(rows[0].createdAt, "months").months,
			12,
			0.01,
		);
	});

	test("only once the tattoo work is done (ruling 3)", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("rl-done", "RL Done");
		const { links } = reviewServices();
		const booked = await inTenant(tenant, () =>
			reviewReady(tenant, { status: "booked", artistSlug: "a1" }),
		);
		const noSession = await inTenant(tenant, () =>
			reviewReady(tenant, {
				status: "in_progress",
				sessionStatus: "scheduled",
				artistSlug: "a2",
			}),
		);
		const healing = await inTenant(tenant, () =>
			reviewReady(tenant, { status: "healing_check", artistSlug: "a3" }),
		);

		for (const { project } of [booked, noSession]) {
			const refusal = await inTenant(tenant, () =>
				links
					.linkFor(tenant, OWNER_MEMBER(owner.id), project.id)
					.catch((error) => error),
			);
			assert.instanceOf(refusal, ReviewLinkRuleError);
			assert.equal(refusal.reason, "not_done");
		}
		const made = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), healing.project.id),
		);
		assert.isTrue(made.created);
	});

	test("the project's own artist may ask; another artist and another studio get the 404", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const { links } = reviewServices();
		// The seeded review project is assigned to A's artist profile; link
		// the artist member to it so they are that project's artist.
		await inTenant(a.tenant, async () => {
			a.artistProfile.userId = a.artist.id;
			await a.artistProfile.save();
		});
		const asArtist = await inTenantAs(a.tenant, a.artist, () =>
			links.linkFor(
				a.tenant,
				{ userId: a.artist.id, role: "artist" },
				a.reviewProject.id,
			),
		);
		assert.equal(asArtist.token, a.reviewToken);

		const stranger = await artistIn(a.tenant, "stranger@rl.example");
		const strangerRefusal = await inTenantAs(a.tenant, stranger, () =>
			links
				.linkFor(
					a.tenant,
					{ userId: stranger.id, role: "artist" },
					a.reviewProject.id,
				)
				.catch((error) => error),
		);
		assert.equal(strangerRefusal.code, "E_ROW_NOT_FOUND");

		// B's project id from A's context, as A's owner: the 404.
		const crossTenant = await inTenantAs(a.tenant, a.owner, () =>
			links
				.linkFor(a.tenant, OWNER_MEMBER(a.owner.id), b.reviewProject.id)
				.catch((error) => error),
		);
		assert.equal(crossTenant.code, "E_ROW_NOT_FOUND");
		const revoked = await inTenantAs(a.tenant, a.owner, () =>
			links
				.revoke(a.tenant, OWNER_MEMBER(a.owner.id), b.reviewProject.id)
				.catch((error) => error),
		);
		assert.equal(revoked.code, "E_ROW_NOT_FOUND");
		// B's link still works in B.
		assert.isNotNull(
			await inTenant(b.tenant, () => links.resolve(b.tenant, b.reviewToken)),
		);
	});

	test("resolve: this studio's working link only", async ({ assert }) => {
		const { a, b } = await twoStudios();
		const { links } = reviewServices();

		assert.isNotNull(
			await inTenant(a.tenant, () => links.resolve(a.tenant, a.reviewToken)),
		);
		assert.isNull(
			await inTenant(a.tenant, () => links.resolve(a.tenant, b.reviewToken)),
			"B's token under A",
		);
		assert.isNull(
			await inTenant(a.tenant, () => links.resolve(a.tenant, "x".repeat(43))),
			"a guess",
		);
	});

	test("revoke kills the link at once; asking again makes a new one", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("rl-rev", "RL Rev");
		const { links } = reviewServices();
		const { project } = await inTenant(tenant, () => reviewReady(tenant));
		const first = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);

		assert.isTrue(
			await inTenant(tenant, () =>
				links.revoke(tenant, OWNER_MEMBER(owner.id), project.id),
			),
		);
		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, first.token)),
		);
		assert.isFalse(
			await inTenant(tenant, () =>
				links.revoke(tenant, OWNER_MEMBER(owner.id), project.id),
			),
			"nothing left to revoke",
		);
		const second = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);
		assert.isTrue(second.created);
		assert.notEqual(second.token, first.token);
		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, first.token)),
			"the old token stays dead (no replay)",
		);
		assert.lengthOf(await inTenant(tenant, () => ReviewLink.query()), 2);
	});

	test("an expired link stops working, and asking again retires it for a new one", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("rl-exp", "RL Exp");
		const { links } = reviewServices();
		const { project } = await inTenant(tenant, () => reviewReady(tenant));
		const first = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);
		await inTenant(tenant, async () => {
			const row = await ReviewLink.findByOrFail("project_id", project.id);
			row.createdAt = DateTime.now().minus({ months: 13 });
			row.expiresAt = DateTime.now().minus({ months: 1 });
			await row.save();
		});

		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, first.token)),
		);
		const second = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);
		assert.isTrue(second.created);
		const rows = await inTenant(tenant, () =>
			ReviewLink.query().orderBy("created_at"),
		);
		assert.lengthOf(rows, 2);
		assert.isNotNull(rows[0].revokedAt, "the expired link is retired");
		assert.isNull(rows[1].revokedAt);
	});

	test("a deleted project's link is dead", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("rl-del", "RL Del");
		const { links, pages } = reviewServices();
		const { project } = await inTenant(tenant, () => reviewReady(tenant));
		const { token } = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);
		await inTenant(tenant, () => project.softDelete());

		const opened = await inTenant(tenant, () =>
			pages.open(tenant, token).catch((error) => error),
		);
		assert.equal(opened.constructor.name, "ReviewPageNotFoundError");
	});

	test("the project's artist comes from its completed tattoo session when it has none", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("rl-art", "RL Art");
		const { links, pages } = reviewServices();
		const ready = await inTenant(tenant, () => reviewReady(tenant));
		const project = await inTenant(tenant, async () => {
			const unassigned = await makeProject(tenant, ready.client, {
				status: "completed",
			});
			await makeSession(tenant, unassigned, ready.artist, {
				startsAt: DateTime.now().minus({ days: 30 }),
				endsAt: DateTime.now().minus({ days: 30 }).plus({ hours: 1 }),
				status: "completed",
			});
			return unassigned;
		});
		const { token } = await inTenant(tenant, () =>
			links.linkFor(tenant, OWNER_MEMBER(owner.id), project.id),
		);
		const opened = await inTenant(tenant, () => pages.open(tenant, token));
		assert.equal(opened.artistId, ready.artist.id);
		assert.notEqual(opened.link.id, randomUUID());
	});
});
