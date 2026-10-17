import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import InquiryService from "#modules/inquiries/services/inquiry_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const projects = new ProjectService(
	artists,
	quotes,
	deposits,
	new SessionService(artists, deposits),
);
const inquiries = new InquiryService(artists, projects);

const idsOf = (list: { id: string }[]) => list.map(({ id }) => id);

test.group("A client's history", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("projects and inquiries for a client, newest first, deleted ones left out", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant);
			const ram = await makeClient(tenant);
			const older = await makeProject(tenant, sita, { brief: "Older" });
			const newer = await makeProject(tenant, sita, { brief: "Newer" });
			const gone = await makeProject(tenant, sita);
			await gone.softDelete();
			await makeProject(tenant, ram);
			const asked = await makeInquiry(tenant, sita);
			const askedAgain = await makeInquiry(tenant, sita);
			await makeInquiry(tenant, ram);

			assert.deepEqual(idsOf(await projects.forClient(tenant, sita.id)), [
				newer.id,
				older.id,
			]);
			assert.deepEqual(idsOf(await inquiries.forClient(tenant, sita.id)), [
				askedAgain.id,
				asked.id,
			]);
		});
	});

	test("per-client counts and dates for a page of clients", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant);
			const ram = await makeClient(tenant);
			const quiet = await makeClient(tenant);
			await makeProject(tenant, sita);
			const latest = await makeProject(tenant, sita);
			await makeInquiry(tenant, ram);
			const ids = [sita.id, ram.id, quiet.id];

			const counts = await projects.countsForClients(tenant, ids);
			assert.equal(counts.get(sita.id), 2);
			assert.isUndefined(counts.get(quiet.id));

			const changes = await projects.lastChangeForClients(tenant, ids);
			assert.equal(
				changes.get(sita.id)?.toMillis(),
				latest.updatedAt?.toMillis(),
			);
			assert.isTrue(DateTime.isDateTime(changes.get(sita.id)));

			const asked = await inquiries.latestForClients(tenant, ids);
			assert.isTrue(DateTime.isDateTime(asked.get(ram.id)));
			assert.isUndefined(asked.get(quiet.id));

			assert.equal((await projects.countsForClients(tenant, [])).size, 0);
			assert.equal((await projects.lastChangeForClients(tenant, [])).size, 0);
			assert.equal((await inquiries.latestForClients(tenant, [])).size, 0);
		});
	});

	test("images on any of the inquiries or projects, each once, deleted ones left out", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, sita, {
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const project = await makeProject(tenant, sita, {
				inquiryId: inquiry.id,
			});
			const direct = await makeProject(tenant, sita);
			const both = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				projectId: project.id,
			});
			const onDirect = await makeReferenceImage(tenant, {
				projectId: direct.id,
			});
			const gone = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 1,
			});
			await gone.softDelete();

			const images = await inquiries.imagesFor(tenant, {
				inquiryIds: [inquiry.id],
				projectIds: [project.id, direct.id],
			});
			assert.sameMembers(idsOf(images), [both.id, onDirect.id]);
			assert.lengthOf(images, 2);
			assert.deepEqual(
				await inquiries.imagesFor(tenant, { inquiryIds: [], projectIds: [] }),
				[],
			);
		});
	});

	test("another tenant finds nothing", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const { client, project, inquiry } = await inTenant(a, async () => {
			const client = await makeClient(a);
			const inquiry = await makeInquiry(a, client);
			const project = await makeProject(a, client);
			await makeReferenceImage(a, { inquiryId: inquiry.id });
			return { client, project, inquiry };
		});

		await inTenant(b, async () => {
			assert.lengthOf(await projects.forClient(b, client.id), 0);
			assert.lengthOf(await inquiries.forClient(b, client.id), 0);
			assert.equal((await projects.countsForClients(b, [client.id])).size, 0);
			assert.lengthOf(
				await inquiries.imagesFor(b, {
					inquiryIds: [inquiry.id],
					projectIds: [project.id],
				}),
				0,
			);
		});
	});
});
