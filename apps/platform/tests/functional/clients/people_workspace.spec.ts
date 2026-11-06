import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ClientService from "#modules/clients/services/client_service";
import ProjectService from "#modules/projects/services/project_service";
import SessionService from "#modules/scheduling/services/session_service";
import { makeClient, makeProject, makeSession } from "#tests/helpers/pipeline";
import { inTenant, inTenantAs } from "#tests/helpers/tenants";
import { KTM, studio } from "#tests/helpers/waiting_fixtures";

type Who = Parameters<ReturnType<ApiClient["get"]>["loginAs"]>[0];

const local = (days: number, hour: number) =>
	DateTime.now().setZone(KTM).plus({ days }).startOf("day").set({ hour });

async function propsOf(client: ApiClient, url: string, user: Who) {
	const response = await client.get(url).withInertia().loginAs(user);
	response.assertStatus(200);
	return response.inertiaProps as Record<string, unknown>;
}

/** A studio with a client who has a session to come, and one who doesn't. */
async function people(slug: string) {
	const s = await studio(slug);
	const made = await inTenant(s.tenant, async () => {
		const coming = await makeClient(s.tenant, {
			name: "Coming Soon",
			email: "coming@example.com",
		});
		const past = await makeClient(s.tenant, { name: "Long Ago" });
		const comingProject = await makeProject(s.tenant, coming, {
			status: "booked",
			artistId: s.ashaProfile.id,
		});
		const pastProject = await makeProject(s.tenant, past, {
			status: "completed",
			artistId: s.sitaProfile.id,
		});
		return {
			coming,
			past,
			comingProject,
			pastProject,
			next: await makeSession(s.tenant, comingProject, s.ashaProfile, {
				startsAt: local(2, 14),
				endsAt: local(2, 16),
			}),
			later: await makeSession(s.tenant, comingProject, s.ashaProfile, {
				startsAt: local(9, 10),
				endsAt: local(9, 12),
			}),
			done: await makeSession(s.tenant, pastProject, s.sitaProfile, {
				startsAt: local(-20, 10),
				endsAt: local(-20, 12),
				status: "completed",
			}),
		};
	});
	return { ...s, ...made };
}

type Row = { id: string; name: string; nextSessionText: string | null };

test.group("Clients workspace (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("each row has the client's next session, and the filter keeps those with one", async ({
		client,
		assert,
	}) => {
		const s = await people("people-list");

		const all = await propsOf(client, "/t/people-list/clients", s.owner);
		const rows = all.clients as Row[];
		const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
		assert.equal(all.filter, "all");
		assert.match(byName["Coming Soon"].nextSessionText ?? "", /14:00–16:00$/);
		assert.isNull(byName["Long Ago"].nextSessionText);

		const upcoming = await propsOf(
			client,
			"/t/people-list/clients?filter=upcoming",
			s.owner,
		);
		assert.equal(upcoming.filter, "upcoming");
		assert.deepEqual(
			(upcoming.clients as Row[]).map(({ name }) => name),
			["Coming Soon"],
		);
		assert.equal((upcoming.page as { total: number }).total, 1);

		// An unknown filter is everyone.
		const unknown = await propsOf(
			client,
			"/t/people-list/clients?filter=vip",
			s.owner,
		);
		assert.equal(unknown.filter, "all");
	});

	test("search finds a client by email too, and keeps the filter", async ({
		client,
		assert,
	}) => {
		const s = await people("people-search");
		const found = await propsOf(
			client,
			"/t/people-search/clients?q=coming%40example&filter=upcoming",
			s.owner,
		);
		assert.deepEqual(
			(found.clients as Row[]).map(({ name }) => name),
			["Coming Soon"],
		);
		const none = await propsOf(
			client,
			"/t/people-search/clients?q=coming%40example&filter=upcoming&page=1",
			s.owner,
		);
		assert.lengthOf(none.clients as Row[], 1);
	});

	test("a client's profile lists their sessions, every status, newest first", async ({
		client,
		assert,
	}) => {
		const s = await people("people-profile");
		const props = await propsOf(
			client,
			`/t/people-profile/clients/${s.coming.id}`,
			s.owner,
		);
		const sessions = props.sessions as {
			id: string;
			status: string;
			artistName: string;
			upcoming: boolean;
			date: string;
		}[];

		assert.deepEqual(
			sessions.map(({ id }) => id),
			[s.later.id, s.next.id],
		);
		assert.isTrue(sessions[0].upcoming);
		assert.equal(sessions[0].artistName, "Asha");
		assert.equal(sessions[1].date, local(2, 14).toFormat("yyyy-MM-dd"));
		assert.isFalse(props.sessionsCapped);

		const other = await propsOf(
			client,
			`/t/people-profile/clients/${s.past.id}`,
			s.owner,
		);
		assert.deepEqual(
			(other.sessions as { id: string; status: string }[]).map(
				({ id, status }) => [id, status],
			),
			[[s.done.id, "completed"]],
		);
	});

	test("the clients pages stay owners only", async ({ client }) => {
		const s = await people("people-roles");
		for (const url of [
			"/t/people-roles/clients?filter=upcoming",
			`/t/people-roles/clients/${s.coming.id}`,
		]) {
			const response = await client.get(url).withInertia().loginAs(s.asha);
			response.assertStatus(404);
		}
	});

	test("the new reads never cross studios", async ({ assert }) => {
		const a = await people("people-iso-a");
		const b = await people("people-iso-b");
		const sessions = await app.container.make(SessionService);
		const projects = await app.container.make(ProjectService);
		const clients = await app.container.make(ClientService);

		await inTenantAs(b.tenant, b.owner, async () => {
			// B asking about A's rows gets nothing.
			assert.deepEqual(
				await sessions.historyFor(a.tenant, [a.comingProject.id], 50),
				[],
			);
			assert.equal(
				(await projects.idsByClient(a.tenant, [a.coming.id])).size,
				0,
			);
			assert.equal(
				(
					await sessions.upcomingByArtist(a.tenant, {
						from: DateTime.now(),
						to: DateTime.now().plus({ days: 30 }),
					})
				).size,
				0,
			);
			const listed = await clients.list(b.tenant, {
				search: "",
				page: 1,
				within: projects.clientsOf(
					b.tenant,
					sessions.projectsWithUpcoming(b.tenant),
				),
			});
			assert.deepEqual(
				listed.clients.map(({ id }) => id),
				[b.coming.id],
			);
		});
		// The positive control: A sees its own.
		await inTenantAs(a.tenant, a.owner, async () => {
			assert.lengthOf(
				await sessions.historyFor(a.tenant, [a.comingProject.id], 50),
				2,
			);
		});
	});
});

test.group("Artists workspace (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("each card counts the artist's scheduled sessions in the next 30 days", async ({
		client,
		assert,
	}) => {
		const s = await people("people-artists");
		const props = await propsOf(client, "/t/people-artists/artists", s.owner);
		const cards = props.artists as {
			name: string;
			upcomingCount: number;
			nextText: string | null;
			hasLogin: boolean;
			styleNames: string[];
		}[];
		const byName = Object.fromEntries(cards.map((card) => [card.name, card]));

		assert.equal(props.upcomingDays, 30);
		assert.equal(byName.Asha.upcomingCount, 2);
		assert.match(byName.Asha.nextText ?? "", /, 14:00$/);
		assert.isTrue(byName.Asha.hasLogin);
		// Sita's only session is done and in the past.
		assert.equal(byName.Sita.upcomingCount, 0);
		assert.isNull(byName.Sita.nextText);
		assert.isFalse(byName.Sita.hasLogin);
	});

	test("a profile's schedule is the artist's own sessions, with no client on a project they can't open", async ({
		client,
		assert,
	}) => {
		const s = await people("people-schedule");
		// Asha covers a session on Sita's project.
		const covering = await inTenant(s.tenant, () =>
			makeSession(s.tenant, s.pastProject, s.ashaProfile, {
				startsAt: local(3, 9),
				endsAt: local(3, 10),
			}),
		);

		const owners = await propsOf(
			client,
			`/t/people-schedule/artists/${s.ashaProfile.id}/edit`,
			s.owner,
		);
		const ownerRows = (
			owners.schedule as {
				sessions: { id: string; project: { clientName: string } | null }[];
			}
		).sessions;
		assert.deepEqual(
			ownerRows.map(({ id }) => id),
			[s.next.id, covering.id, s.later.id],
		);

		const ashas = await propsOf(
			client,
			`/t/people-schedule/artists/${s.ashaProfile.id}/edit`,
			s.asha,
		);
		const rows = (
			ashas.schedule as {
				sessions: { id: string; project: { clientName: string } | null }[];
			}
		).sessions;
		assert.deepEqual(
			rows.map(({ id, project }) => [id, project?.clientName ?? null]),
			[
				[s.next.id, "Coming Soon"],
				[covering.id, null],
				[s.later.id, "Coming Soon"],
			],
		);
		assert.notInclude(JSON.stringify(ashas), "Long Ago");

		// Another artist's profile is still a 404 for Asha.
		const response = await client
			.get(`/t/people-schedule/artists/${s.sitaProfile.id}/edit`)
			.withInertia()
			.loginAs(s.asha);
		response.assertStatus(404);
	});
});
