import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import TattooProject, {
	PROJECT_STATUSES,
} from "#modules/projects/models/tattoo_project";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newProject = (
	tenantId: string,
	clientId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	client_id: clientId,
	brief: "A small moth",
	...over,
});

/** A client, its inquiry and an artist in `tenant`. */
const parentsIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		return {
			client,
			inquiry: await makeInquiry(tenant, client),
			artist: await makeArtist(tenant),
		};
	});

async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return { a, b, mine: await parentsIn(a), theirs: await parentsIn(b) };
}

test.group("tattoo_projects table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project links only to its own tenant's client, artist and inquiry; a null artist or inquiry is not checked", async ({
		assert,
	}) => {
		const { a, mine, theirs } = await twoTenants();
		const rejects = (
			over: Record<string, unknown>,
			clientId: string,
			message: RegExp,
		) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"tattoo_projects",
							newProject(a.id, clientId, over),
						),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				{},
				theirs.client.id,
				/tattoo_projects_tenant_id_client_id_foreign/,
			);
			await rejects(
				{ artist_id: theirs.artist.id },
				mine.client.id,
				/tattoo_projects_tenant_id_artist_id_foreign/,
			);
			await rejects(
				{ inquiry_id: theirs.inquiry.id },
				mine.client.id,
				/tattoo_projects_tenant_id_inquiry_id_foreign/,
			);
			await insertRow(trx, "tattoo_projects", newProject(a.id, mine.client.id));
		});
	});

	test("a client, artist or inquiry with a project cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(
				trx,
				"tattoo_projects",
				newProject(a.id, mine.client.id, {
					artist_id: mine.artist.id,
					inquiry_id: mine.inquiry.id,
				}),
			);
			for (const [table, id, constraint] of [
				// The client is also the inquiry's client, so either key may be named.
				[
					"clients",
					mine.client.id,
					/(inquiries|tattoo_projects)_tenant_id_client_id_foreign/,
				],
				[
					"artists",
					mine.artist.id,
					/tattoo_projects_tenant_id_artist_id_foreign/,
				],
				[
					"inquiries",
					mine.inquiry.id,
					/tattoo_projects_tenant_id_inquiry_id_foreign/,
				],
			] as const) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							inner.rawQuery(`delete from ${table} where id = ?`, [id]),
						),
					constraint,
				);
			}
		});
	});

	test("status only takes its listed values", async ({ assert }) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"tattoo_projects",
							newProject(a.id, mine.client.id, { status: "inquiry" }),
						),
					),
				/tattoo_projects_status_check/,
			);
		});
	});

	test("an inquiry becomes at most one live project; deleting the project frees it; projects without an inquiry are unlimited", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const fromInquiry = () =>
			newProject(a.id, mine.client.id, { inquiry_id: mine.inquiry.id });

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const first = idOf(
				await insertRow(trx, "tattoo_projects", fromInquiry()),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "tattoo_projects", fromInquiry()),
					),
				/tattoo_projects_inquiry_live_unique/,
			);
			await updateRow(trx, "tattoo_projects", first, {
				deleted_at: new Date(),
			});
			await insertRow(trx, "tattoo_projects", fromInquiry());
			await insertRow(trx, "tattoo_projects", newProject(a.id, mine.client.id));
			await insertRow(trx, "tattoo_projects", newProject(a.id, mine.client.id));
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from tattoo_projects where tenant_id = ?",
				[a.id],
			);
			assert.equal(rows[0].n, 4);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "tattoo_projects", async (tenant) => {
			const client = await inTenant(tenant, () => makeClient(tenant));
			return newProject(tenant.id, client.id);
		});
	});
});

test.group("TattooProject model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a new project starts in reviewing, records contact, soft-deletes and restores", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			// create() leaves unset columns undefined; reload to see the database's values.
			await project.refresh();
			assert.equal(project.status, "reviewing");
			assert.isNull(project.artistId);
			assert.isNull(project.inquiryId);

			project.merge({ lastContactedAt: DateTime.utc(), notes: "Called back" });
			await project.save();
			const reloaded = await TattooProject.findOrFail(project.id);
			assert.isNotNull(reloaded.lastContactedAt);
			assert.equal(reloaded.notes, "Called back");

			await project.softDelete();
			assert.isEmpty(await TattooProject.query().where("tenant_id", tenant.id));
			await project.restore();
			assert.lengthOf(
				await TattooProject.query().where("tenant_id", tenant.id),
				1,
			);
		});
	});

	test("soft-deleting a project frees its inquiry for a new one", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const first = await makeProject(tenant, client, {
				inquiryId: inquiry.id,
			});
			await first.softDelete();

			const second = await makeProject(tenant, client, {
				inquiryId: inquiry.id,
			});

			assert.notEqual(second.id, first.id);
		});
	});

	test("every project status in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const status of PROJECT_STATUSES) {
				await makeProject(tenant, client, { status });
			}
			assert.lengthOf(
				await TattooProject.query().where("tenant_id", tenant.id),
				PROJECT_STATUSES.length,
			);
		});
	});
});
