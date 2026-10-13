import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { IMAGE_PURPOSES } from "#modules/media/services/image_service";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newImage = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	image_key: `tenants/${tenantId}/reference_image/${randomUUID()}.webp`,
	width: 800,
	height: 600,
	position: 0,
	...over,
});

/** A client, its inquiry and a project in `tenant`. */
const parentsIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		return {
			inquiry: await makeInquiry(tenant, client),
			project: await makeProject(tenant, client),
		};
	});

async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return { a, b, mine: await parentsIn(a), theirs: await parentsIn(b) };
}

test.group("reference_images table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an image attaches to an inquiry, a project or both, never to neither", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "reference_images", newImage(a.id)),
					),
				/reference_images_attached/,
			);
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, { inquiry_id: mine.inquiry.id }),
			);
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, { project_id: mine.project.id }),
			);
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, {
					inquiry_id: mine.inquiry.id,
					project_id: mine.project.id,
				}),
			);
		});
	});

	test("an image links only to its own tenant's inquiry and project", async ({
		assert,
	}) => {
		const { a, theirs } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"reference_images",
							newImage(a.id, { inquiry_id: theirs.inquiry.id }),
						),
					),
				/reference_images_tenant_id_inquiry_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"reference_images",
							newImage(a.id, { project_id: theirs.project.id }),
						),
					),
				/reference_images_tenant_id_project_id_foreign/,
			);
		});
	});

	test("an inquiry or project with an image cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			// mine.project was made without an inquiry, so the only row that
			// references mine.inquiry or mine.project is this image, and each
			// delete can only be refused by the image's key to that parent.
			await insertRow(
				trx,
				"reference_images",
				newImage(a.id, {
					inquiry_id: mine.inquiry.id,
					project_id: mine.project.id,
				}),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from inquiries where id = ?", [
							mine.inquiry.id,
						]),
					),
				/reference_images_tenant_id_inquiry_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from tattoo_projects where id = ?", [
							mine.project.id,
						]),
					),
				/reference_images_tenant_id_project_id_foreign/,
			);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "reference_images", async (tenant) => {
			const { inquiry } = await parentsIn(tenant);
			return newImage(tenant.id, { inquiry_id: inquiry.id });
		});
	});
});

test.group("ReferenceImage model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an inquiry's image is attached to its project when the inquiry is accepted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const image = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 2,
			});
			// create() leaves unset columns undefined; reload to see the database's values.
			await image.refresh();
			assert.isNull(image.projectId);

			const project = await makeProject(tenant, client, {
				inquiryId: inquiry.id,
			});
			image.merge({ projectId: project.id });
			await image.save();

			const reloaded = await ReferenceImage.findOrFail(image.id);
			assert.equal(reloaded.projectId, project.id);
			assert.equal(reloaded.inquiryId, inquiry.id);
			assert.equal(reloaded.position, 2);
		});
	});

	test("a project's own image has no inquiry, and a soft delete hides it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const image = await makeReferenceImage(tenant, {
				projectId: project.id,
			});
			// create() leaves unset columns undefined; reload to see the database's values.
			await image.refresh();
			assert.isNull(image.inquiryId);

			await image.softDelete();

			assert.isEmpty(
				await ReferenceImage.query().where("tenant_id", tenant.id),
			);
		});
	});

	test("reference images are stored on the private disk", ({ assert }) => {
		assert.equal(IMAGE_PURPOSES.reference_image.visibility, "private");
	});
});
