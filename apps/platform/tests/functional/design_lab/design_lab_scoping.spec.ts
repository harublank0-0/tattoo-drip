import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import DesignLabService from "#modules/design_lab/services/design_lab_service";
import DesignUsageService from "#modules/design_lab/services/design_usage_service";
import { seedDesignLab } from "#tests/helpers/design_lab";
import { artistIn, inTenantAs, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The service filters behind row-level security (PR checklist): inside
 * studio B's context, where B's Design Lab rows are visible to RLS, every
 * read asked for studio A must find nothing of B's. A query that forgot its
 * tenant filter would return B's rows here, which the HTTP isolation cases
 * cannot show (RLS hides the rows there on its own).
 */
test.group("AI Design Lab service scoping", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("asked for another studio, every read finds nothing of the studio in context", async ({
		assert,
	}) => {
		const a = await studioWithOwner("scope-a", "Scope A");
		const b = await studioWithOwner("scope-b", "Scope B");
		const bArtist = await artistIn(b.tenant, "artist@scope-b.example");
		const bLab = await seedDesignLab(b.tenant, bArtist);
		const lab = await app.container.make(DesignLabService);
		const usage = await app.container.make(DesignUsageService);
		const asOwner = { userId: b.owner.id, role: "owner" as const };

		await inTenantAs(b.tenant, b.owner, async () => {
			// The positive control: B's own records, asked for B.
			assert.equal(
				(await lab.findProject(b.tenant, asOwner, bLab.designProject.id)).id,
				bLab.designProject.id,
			);
			assert.lengthOf(
				(
					await lab.listProjects(b.tenant, asOwner, {
						archived: false,
						page: 1,
					})
				).all(),
				1,
			);

			// The same ids, asked for A.
			const project = bLab.designProject;
			assert.lengthOf(
				(
					await lab.listProjects(a.tenant, asOwner, {
						archived: false,
						page: 1,
					})
				).all(),
				0,
			);
			await assert.rejects(
				() => lab.findProject(a.tenant, asOwner, project.id),
				/Row not found/,
			);
			await assert.rejects(
				() => lab.findAsset(a.tenant, asOwner, bLab.designAsset.id),
				/Row not found/,
			);
			assert.deepEqual(await lab.generations(a.tenant, project), []);
			assert.deepEqual(await lab.statuses(a.tenant, project), []);
			assert.equal((await lab.covers(a.tenant, [project.id])).size, 0);
			assert.isFalse(
				await lab.hasGenerated(a.tenant, { ...asOwner, userId: bArtist.id }),
			);
			await assert.rejects(
				() => lab.retry(a.tenant, asOwner, bLab.designGeneration.id, 1),
				/Row not found/,
			);
			// B's settled generation is not counted in A's allowance.
			const allowance = await usage.allowance(a.tenant);
			assert.equal(allowance.used, 0);
			assert.equal(allowance.reserved, 0);
			assert.isFalse(
				await usage.settle(a.tenant, bLab.designGeneration.id, 1, null),
			);
		});
	});
});
