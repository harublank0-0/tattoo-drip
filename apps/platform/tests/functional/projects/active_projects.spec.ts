import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { ACTIVE_STATUSES } from "#modules/projects/moves";
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { makeClient, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);

const ago = (days: number) => DateTime.utc().minus({ days });

/** A studio with a project in every status (oldest status first), two artist profiles and an artist member linked to the first. */
async function studio() {
	const { owner, tenant } = await studioWithOwner();
	const user = await artistIn(tenant, "asha@example.com");
	const parts = await inTenant(tenant, async () => {
		const asha = await Artist.create({
			tenantId: tenant.id,
			name: "Asha",
			slug: "asha",
			userId: user.id,
		});
		const sita = await Artist.create({
			tenantId: tenant.id,
			name: "Sita",
			slug: "sita",
		});
		const client = await makeClient(tenant);
		const byStatus = {} as Record<ProjectStatus, string>;
		let age = PROJECT_STATUSES.length;
		for (const status of PROJECT_STATUSES) {
			const project = await makeProject(tenant, client, {
				status,
				// Alternate the artist so each owns some of every kind.
				artistId: age % 2 === 0 ? asha.id : sita.id,
				createdAt: ago(age),
			});
			byStatus[status] = project.id;
			age -= 1;
		}
		return { asha, sita, byStatus };
	});
	const ownerMember: Member = { userId: owner.id, role: "owner" };
	const ashaMember: Member = { userId: user.id, role: "artist" };
	return { tenant, user, ownerMember, ashaMember, ...parts };
}

test.group("ProjectService.listActive", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner gets every live project that isn't closed, oldest first", async ({
		assert,
	}) => {
		const { tenant, ownerMember, byStatus } = await studio();
		const found = await inTenant(tenant, () =>
			projects.listActive(tenant, ownerMember),
		);
		const expected = PROJECT_STATUSES.filter((status) =>
			ACTIVE_STATUSES.includes(status),
		).map((status) => byStatus[status]);
		assert.deepEqual(
			found.map(({ id }) => id),
			expected,
		);
		assert.deepEqual(
			found.map(({ status }) => status),
			PROJECT_STATUSES.filter((status) => ACTIVE_STATUSES.includes(status)),
		);
		for (const closed of ["declined", "cancelled", "completed"] as const) {
			assert.notInclude(
				found.map(({ id }) => id),
				byStatus[closed],
			);
		}
	});

	test("an artist gets only the active projects assigned to their own profile", async ({
		assert,
	}) => {
		const { tenant, ashaMember, asha, byStatus } = await studio();
		const found = await inTenant(tenant, () =>
			projects.listActive(tenant, ashaMember),
		);
		assert.isAbove(found.length, 0);
		for (const project of found) {
			assert.equal(project.artistId, asha.id);
			assert.include(ACTIVE_STATUSES, project.status);
		}
		const everyActive = ACTIVE_STATUSES.map((status) => byStatus[status]);
		assert.isBelow(found.length, everyActive.length);
	});

	test("an artist member without a profile gets nothing", async ({
		assert,
	}) => {
		const { tenant } = await studio();
		const stranger: Member = {
			userId: (await artistIn(tenant, "ram@example.com")).id,
			role: "artist",
		};
		assert.deepEqual(
			await inTenant(tenant, () => projects.listActive(tenant, stranger)),
			[],
		);
	});

	test("a deleted project is not active work", async ({ assert }) => {
		const { tenant, ownerMember, byStatus } = await studio();
		const found = await inTenant(tenant, async () => {
			const gone = await TattooProject.findOrFail(byStatus.reviewing);
			await gone.softDelete();
			return projects.listActive(tenant, ownerMember);
		});
		assert.notInclude(
			found.map(({ id }) => id),
			byStatus.reviewing,
		);
	});

	test("another studio's projects never come back", async ({ assert }) => {
		const a = await studio();
		const { owner, tenant: other } = await studioWithOwner(
			"red-ink",
			"Red Ink",
		);
		await inTenant(other, async () =>
			makeProject(other, await makeClient(other), { status: "reviewing" }),
		);
		const otherOwner: Member = { userId: owner.id, role: "owner" };
		// Studio B's context asking for studio A's projects: row-level
		// security hides them, and the tenant filter asks for A's alone.
		assert.deepEqual(
			await inTenant(other, () => projects.listActive(a.tenant, otherOwner)),
			[],
		);
		// And A's own read doesn't include B's.
		const mine = await inTenant(a.tenant, () =>
			projects.listActive(a.tenant, a.ownerMember),
		);
		assert.isTrue(mine.every(({ tenantId }) => tenantId === a.tenant.id));
	});
});
