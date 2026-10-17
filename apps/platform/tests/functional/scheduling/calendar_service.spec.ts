import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ClientService from "#modules/clients/services/client_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import CalendarService, {
	type CalendarEntry,
	type CalendarScope,
} from "#modules/scheduling/services/calendar_service";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);
const calendar = new CalendarService(
	artists,
	sessions,
	projects,
	new ClientService(),
);

const BRIEF = "A small fine-line moth on the forearm";

/** Monday 2 November 2026 in UTC: the window every test reads. */
const day = {
	from: DateTime.utc(2026, 11, 2),
	to: DateTime.utc(2026, 11, 3),
};
const hour = (h: number) => DateTime.utc(2026, 11, 2, h);

/** A scope as one comparable value: "studio", "unlinked" or the artist's id. */
const scopeOf = (scope: CalendarScope) =>
	scope.kind === "artist" ? scope.artist.id : scope.kind;

/**
 * Asha (an artist member linked to her profile), Sita (a profile without
 * an account) and Maya's booked project, assigned to Sita.
 */
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
		const sita = await makeArtist(tenant);
		const maya = await makeClient(tenant, { name: "Maya Gurung" });
		const project = await makeProject(tenant, maya, {
			artistId: sita.id,
			status: "booked",
		});
		return { asha, sita, project };
	});
	const ownerMember: Member = { userId: owner.id, role: "owner" };
	const ashaMember: Member = { userId: user.id, role: "artist" };
	return { tenant, ownerMember, ashaMember, ...parts };
}

test.group("CalendarService scopes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners see the studio or one live artist; artists their own profile", async ({
		assert,
	}) => {
		const { tenant, asha, sita, ownerMember, ashaMember } = await studio();
		const stranger: Member = {
			userId: (await artistIn(tenant, "ram@example.com")).id,
			role: "artist",
		};

		await inTenant(tenant, async () => {
			const load = (member: Member, artistId: string | null) =>
				calendar.load(tenant, member, { artistId, ...day });

			const whole = await load(ownerMember, null);
			assert.equal(scopeOf(whole.scope), "studio");
			assert.deepEqual(
				whole.artists.map(({ name }) => name),
				["Asha", "Sita"],
			);
			assert.equal(scopeOf((await load(ownerMember, sita.id)).scope), sita.id);

			const own = await load(ashaMember, null);
			assert.equal(scopeOf(own.scope), asha.id);
			assert.deepEqual(own.artists, []);
			assert.equal(scopeOf((await load(ashaMember, asha.id)).scope), asha.id);

			// No linked profile: nothing to show, and no error.
			const none = await load(stranger, null);
			assert.equal(scopeOf(none.scope), "unlinked");
			assert.deepEqual(none.entries, []);
		});
	});

	test("any other artist id is not found, malformed ones included", async ({
		assert,
	}) => {
		const { tenant, sita, ownerMember, ashaMember } = await studio();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeArtist(other));
		const stranger: Member = {
			userId: (await artistIn(tenant, "ram@example.com")).id,
			role: "artist",
		};
		const gone = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant, "gone");
			await artist.softDelete();
			return artist;
		});

		await inTenant(tenant, async () => {
			for (const [member, artistId] of [
				[ownerMember, theirs.id],
				[ownerMember, gone.id],
				[ownerMember, "not-a-uuid"],
				[ashaMember, sita.id],
				[stranger, sita.id],
			] as const) {
				await assert.rejects(
					() => calendar.load(tenant, member, { artistId, ...day }),
					/Row not found/,
				);
			}
		});
	});
});

test.group("CalendarService entries", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a session shows its project's client and brief only to members who may open it", async ({
		assert,
	}) => {
		const { tenant, asha, sita, project, ownerMember, ashaMember } =
			await studio();
		const rows = await inTenant(tenant, async () => {
			const nimas = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Nima" }),
				{ artistId: asha.id, status: "booked" },
			);
			return {
				nimas,
				own: await makeSession(tenant, nimas, asha, {
					startsAt: hour(4),
					endsAt: hour(5),
				}),
				// Booked with Asha, then the project went to Sita: the time stays Asha's.
				reassigned: await makeSession(tenant, project, asha, {
					startsAt: hour(6),
					endsAt: hour(7),
				}),
				sitas: await makeSession(tenant, project, sita),
			};
		});
		const maya = { id: project.id, brief: BRIEF, clientName: "Maya Gurung" };
		const nima = { id: rows.nimas.id, brief: BRIEF, clientName: "Nima" };
		const shown = (entries: CalendarEntry[]) =>
			entries.map(({ session, artistName, project: details }) => [
				session.id,
				artistName,
				details,
			]);

		await inTenant(tenant, async () => {
			const owners = await calendar.load(tenant, ownerMember, {
				artistId: null,
				...day,
			});
			assert.deepEqual(shown(owners.entries), [
				[rows.own.id, "Asha", nima],
				[rows.reassigned.id, "Asha", maya],
				[rows.sitas.id, "Sita", maya],
			]);
			const ashas = await calendar.load(tenant, ashaMember, {
				artistId: null,
				...day,
			});
			assert.deepEqual(shown(ashas.entries), [
				[rows.own.id, "Asha", nima],
				[rows.reassigned.id, "Asha", null],
			]);
		});
	});

	test("a deleted artist's sessions stay, without a name", async ({
		assert,
	}) => {
		const { tenant, sita, project, ownerMember } = await studio();
		const session = await inTenant(tenant, () =>
			makeSession(tenant, project, sita),
		);

		await inTenant(tenant, async () => {
			await (await Artist.findOrFail(sita.id)).softDelete();
			const { entries } = await calendar.load(tenant, ownerMember, {
				artistId: null,
				...day,
			});
			assert.deepEqual(
				entries.map(({ session: { id }, artistName }) => [id, artistName]),
				[[session.id, null]],
			);
		});
	});
});
