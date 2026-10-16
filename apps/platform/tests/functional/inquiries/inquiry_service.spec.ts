import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import InquiryService, {
	INQUIRIES_PER_PAGE,
} from "#modules/inquiries/services/inquiry_service";
import {
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const inquiries = new InquiryService();

type TenantRef = { id: string };

const ideasOf = (list: { idea: string }[]) => list.map(({ idea }) => idea);

async function inquiryIn(
	tenant: TenantRef,
	over: Parameters<typeof makeInquiry>[2] = {},
) {
	return makeInquiry(tenant, await makeClient(tenant), over);
}

test.group("InquiryService reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("listNew lists live new inquiries, oldest first, and countNew counts them", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await inquiryIn(tenant, { idea: "first" });
			await inquiryIn(tenant, { idea: "second" });
			await inquiryIn(tenant, {
				idea: "accepted",
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const gone = await inquiryIn(tenant, { idea: "deleted" });
			await gone.softDelete();

			const page = await inquiries.listNew(tenant, 1);
			assert.deepEqual(ideasOf(page.inquiries), ["first", "second"]);
			assert.equal(page.total, 2);
			assert.equal(await inquiries.countNew(tenant), 2);
		});
	});

	test("listNew pages by 25", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (let i = 0; i < INQUIRIES_PER_PAGE + 1; i++) {
				await makeInquiry(tenant, client);
			}
			const first = await inquiries.listNew(tenant, 1);
			assert.lengthOf(first.inquiries, INQUIRIES_PER_PAGE);
			assert.equal(first.lastPage, 2);
			assert.lengthOf((await inquiries.listNew(tenant, 2)).inquiries, 1);
		});
	});

	test("listDecided lists accepted and declined, newest decision first", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await inquiryIn(tenant, { idea: "still new" });
			await inquiryIn(tenant, {
				idea: "accepted earlier",
				status: "accepted",
				decidedAt: DateTime.utc().minus({ days: 2 }),
			});
			await inquiryIn(tenant, {
				idea: "declined later",
				status: "declined",
				decidedAt: DateTime.utc().minus({ days: 1 }),
			});

			const page = await inquiries.listDecided(tenant, 1);
			assert.deepEqual(ideasOf(page.inquiries), [
				"declined later",
				"accepted earlier",
			]);
		});
	});

	test("findFor finds the tenant's live inquiry; find returns null otherwise", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			const gone = await inquiryIn(tenant);
			await gone.softDelete();

			assert.equal(
				(await inquiries.findFor(tenant, inquiry.id)).id,
				inquiry.id,
			);
			for (const id of [gone.id, randomUUID()]) {
				await assert.rejects(
					() => inquiries.findFor(tenant, id),
					/Row not found/,
				);
				assert.isNull(await inquiries.find(tenant, id));
			}
		});
	});

	test("images by inquiry or by project, in order; imageCounts per inquiry", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const other = await makeInquiry(tenant, client);
			const project = await makeProject(tenant, client);
			const second = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 1,
			});
			const first = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 0,
			});
			const gone = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 2,
			});
			await gone.softDelete();
			const onProject = await makeReferenceImage(tenant, {
				projectId: project.id,
			});

			assert.deepEqual(
				(await inquiries.images(tenant, { inquiryId: inquiry.id })).map(
					({ id }) => id,
				),
				[first.id, second.id],
			);
			assert.deepEqual(
				(await inquiries.images(tenant, { projectId: project.id })).map(
					({ id }) => id,
				),
				[onProject.id],
			);
			const counts = await inquiries.imageCounts(tenant, [
				inquiry.id,
				other.id,
			]);
			assert.equal(counts.get(inquiry.id), 2);
			assert.isUndefined(counts.get(other.id));
			assert.equal((await inquiries.imageCounts(tenant, [])).size, 0);
		});
	});

	test("another tenant sees none of it", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const inquiry = await inTenant(a, () => inquiryIn(a));

		await inTenant(b, async () => {
			assert.lengthOf((await inquiries.listNew(b, 1)).inquiries, 0);
			assert.equal(await inquiries.countNew(b), 0);
			assert.isNull(await inquiries.find(b, inquiry.id));
		});
	});
});
