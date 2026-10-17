import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import Artist from "#modules/artists/models/artist";
import { todayIn } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const KTM = "Asia/Kathmandu";
const BRIEF = "A small fine-line moth on the forearm";
const calendarUrl = (query = "") => `/t/black-needle/calendar${query}`;

type Row = {
	id: string;
	startText: string;
	endText: string;
	status: string;
	project: unknown;
};
type Day = { date: string; label: string; sessions: Row[] };

/** `time` on `day` in Kathmandu (the test studios' zone). */
const at = (day: string, time: string) =>
	DateTime.fromISO(`${day}T${time}`, { zone: KTM });

/** yyyy-MM-dd, `days` after `date`. */
const plusDays = (date: string, days: number) =>
	DateTime.fromISO(date).plus({ days }).toFormat("yyyy-MM-dd");

/** Ram and Sita, and Maya's booked project assigned to Sita. */
async function studio() {
	const { owner, tenant } = await studioWithOwner();
	const parts = await inTenant(tenant, async () => {
		const ram = await Artist.create({
			tenantId: tenant.id,
			name: "Ram",
			slug: "ram",
		});
		const sita = await makeArtist(tenant);
		const maya = await makeClient(tenant, { name: "Maya Gurung" });
		const project = await makeProject(tenant, maya, {
			artistId: sita.id,
			status: "booked",
		});
		return { ram, sita, project };
	});
	return { owner, tenant, ...parts };
}

/** An artist member with a live profile ("Asha") linked to their account. */
async function linkedArtist(tenant: Tenant) {
	const user = await artistIn(tenant, "asha@example.com");
	const profile = await inTenant(tenant, () =>
		Artist.create({
			tenantId: tenant.id,
			name: "Asha",
			slug: "asha",
			userId: user.id,
		}),
	);
	return { user, profile };
}

test.group("Calendar page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner opens today's day view of the whole studio", async ({
		client,
		assert,
	}) => {
		const { owner, ram, sita } = await studio();
		const today = todayIn(KTM);

		const response = await client
			.get(calendarUrl())
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("calendar/index");
		const props = response.inertiaProps;
		assert.include(props, {
			view: "day",
			date: today,
			today,
			timezone: KTM,
			scope: "studio",
			previous: plusDays(today, -1),
			next: plusDays(today, 1),
		});
		assert.deepEqual(props.artistFilter, {
			selected: null,
			artists: [
				{ id: ram.id, name: "Ram" },
				{ id: sita.id, name: "Sita" },
			],
		});
		assert.deepEqual(
			props.days.map(({ date }: Day) => date),
			[today],
		);
	});

	test("a day lists the sessions that take its local time, with what the project page shows", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, ram, sita, project } = await studio();
		const rows = await inTenant(tenant, async () => {
			const koi = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Bikash" }),
				{
					artistId: ram.id,
					status: "booked",
					brief: "Koi fish\nfull sleeve, colour",
				},
			);
			// 00:15 on 3 November in Kathmandu is still 2 November in UTC: not this day.
			await makeSession(tenant, project, sita, {
				startsAt: at("2026-11-03", "00:15"),
				endsAt: at("2026-11-03", "02:00"),
			});
			return {
				koi,
				consultation: await makeSession(tenant, koi, ram, {
					kind: "consultation",
					startsAt: at("2026-11-02", "09:00"),
					endsAt: at("2026-11-02", "09:30"),
				}),
				// 10:00 to 12:00 UTC: 15:45 to 17:45 in Kathmandu.
				tattoo: await makeSession(tenant, project, sita),
			};
		});

		const props = (
			await client
				.get(calendarUrl("?date=2026-11-02"))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.rangeText, "Mon 2 Nov 2026");
		assert.deepEqual(props.days[0].sessions, [
			{
				id: rows.consultation.id,
				startsAt: at("2026-11-02", "09:00").toMillis(),
				endsAt: at("2026-11-02", "09:30").toMillis(),
				startText: "09:00",
				endText: "09:30",
				kind: "consultation",
				status: "scheduled",
				artistName: "Ram",
				project: { id: rows.koi.id, clientName: "Bikash", brief: "Koi fish" },
			},
			{
				id: rows.tattoo.id,
				startsAt: DateTime.utc(2026, 11, 2, 10).toMillis(),
				endsAt: DateTime.utc(2026, 11, 2, 12).toMillis(),
				startText: "15:45",
				endText: "17:45",
				kind: "tattoo",
				status: "scheduled",
				artistName: "Sita",
				project: { id: project.id, clientName: "Maya Gurung", brief: BRIEF },
			},
		]);
	});

	test("a week runs Sunday to Saturday, and a session past midnight shows on both days", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, project } = await studio();
		const late = await inTenant(tenant, () =>
			makeSession(tenant, project, sita, {
				startsAt: at("2026-11-02", "22:30"),
				endsAt: at("2026-11-03", "01:30"),
			}),
		);

		const props = (
			await client
				.get(calendarUrl("?view=week&date=2026-11-04"))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.include(props, {
			view: "week",
			date: "2026-11-04",
			rangeText: "1–7 Nov 2026",
			previous: "2026-10-28",
			next: "2026-11-11",
		});
		assert.deepEqual(
			props.days.map(({ date, label, sessions }: Day) => [
				date,
				label,
				sessions.map(({ id, startText, endText }) => [id, startText, endText]),
			]),
			[
				["2026-11-01", "Sun 1 Nov", []],
				["2026-11-02", "Mon 2 Nov", [[late.id, "22:30", "Tue 01:30"]]],
				["2026-11-03", "Tue 3 Nov", [[late.id, "Mon 22:30", "01:30"]]],
				["2026-11-04", "Wed 4 Nov", []],
				["2026-11-05", "Thu 5 Nov", []],
				["2026-11-06", "Fri 6 Nov", []],
				["2026-11-07", "Sat 7 Nov", []],
			],
		);
	});

	test("cancelled and no-show sessions are left out; a completed one stays and says so", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, project } = await studio();
		const done = await inTenant(tenant, async () => {
			await makeSession(tenant, project, sita, {
				status: "cancelled",
				startsAt: at("2026-11-02", "10:00"),
				endsAt: at("2026-11-02", "11:00"),
			});
			await makeSession(tenant, project, sita, {
				status: "no_show",
				startsAt: at("2026-11-02", "10:00"),
				endsAt: at("2026-11-02", "11:00"),
			});
			return makeSession(tenant, project, sita, {
				status: "completed",
				startsAt: at("2026-11-02", "12:00"),
				endsAt: at("2026-11-02", "13:00"),
			});
		});

		const props = (
			await client
				.get(calendarUrl("?date=2026-11-02"))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.deepEqual(
			props.days[0].sessions.map(({ id, status }: Row) => [id, status]),
			[[done.id, "completed"]],
		);
	});

	test("an unknown view or date is today's day view; an empty artist is the whole studio", async ({
		client,
		assert,
	}) => {
		const { owner } = await studio();
		const today = todayIn(KTM);

		for (const query of [
			"?view=month&date=2026-02-30",
			"?view=week&view=day&date=soon",
			"?artist=",
		]) {
			const response = await client
				.get(calendarUrl(query))
				.withInertia()
				.loginAs(owner);
			response.assertStatus(200);
			assert.include(
				response.inertiaProps,
				{ view: "day", date: today, scope: "studio" },
				query,
			);
		}
	});

	test("a date at the ends of the year range is today, not an error", async ({
		client,
		assert,
	}) => {
		const { owner } = await studio();
		const today = todayIn(KTM);

		for (const date of ["9999-12-28", "9999-12-31", "0000-01-03"]) {
			for (const view of ["week", "day"]) {
				const response = await client
					.get(calendarUrl(`?view=${view}&date=${date}`))
					.withInertia()
					.loginAs(owner);
				response.assertStatus(200);
				assert.include(response.inertiaProps, { view, date: today }, date);
			}
		}
	});

	test("an owner can show one artist's sessions", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, ram, sita, project } = await studio();
		const rams = await inTenant(tenant, async () => {
			await makeSession(tenant, project, sita);
			return makeSession(tenant, project, ram, {
				startsAt: at("2026-11-02", "09:00"),
				endsAt: at("2026-11-02", "10:00"),
			});
		});

		const props = (
			await client
				.get(calendarUrl(`?date=2026-11-02&artist=${ram.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.scope, "artist");
		assert.equal(props.artistFilter.selected, ram.id);
		assert.deepEqual(
			props.days[0].sessions.map(({ id }: Row) => id),
			[rams.id],
		);
	});

	test("another studio's artist, a deleted artist or a malformed id is a 404", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await studio();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, async () => {
			const artist = await makeArtist(other);
			// Studio B's session on the day studio A looks at.
			await makeSession(
				other,
				await makeProject(other, await makeClient(other)),
				artist,
			);
			return artist;
		});
		const gone = await inTenant(tenant, async () => {
			const artist = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await artist.softDelete();
			return artist;
		});

		// The controls: this studio's artist opens, and studio B's session is
		// not on this studio's calendar.
		const own = await client
			.get(calendarUrl(`?date=2026-11-02&artist=${sita.id}`))
			.withInertia()
			.loginAs(owner);
		own.assertStatus(200);
		const whole = await client
			.get(calendarUrl("?date=2026-11-02"))
			.withInertia()
			.loginAs(owner);
		assert.deepEqual(whole.inertiaProps.days[0].sessions, []);

		for (const id of [theirs.id, gone.id, "not-a-uuid"]) {
			const response = await client
				.get(calendarUrl(`?artist=${id}`))
				.withInertia()
				.loginAs(owner);
			response.assertStatus(404);
		}
	});

	test("a repeated artist names no artist: a 404 for owners and artists, even for one's own id", async ({
		client,
	}) => {
		const { owner, tenant, ram, sita } = await studio();
		const { user, profile } = await linkedArtist(tenant);

		for (const [member, query] of [
			[owner, `?artist=${ram.id}&artist=${sita.id}`],
			[owner, `?artist=${ram.id}&artist=${ram.id}`],
			[user, `?artist=${profile.id}&artist=${profile.id}`],
			[user, `?artist=${profile.id}&artist=${sita.id}`],
		] as const) {
			const response = await client
				.get(calendarUrl(query))
				.withInertia()
				.loginAs(member);
			response.assertStatus(404);
		}
	});

	test("an artist sees only their own sessions, and no details of a project that isn't theirs", async ({
		client,
		assert,
	}) => {
		const { tenant, sita, project } = await studio();
		const { user, profile } = await linkedArtist(tenant);
		const rows = await inTenant(tenant, async () => {
			const nimas = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Nima" }),
				{ artistId: profile.id, status: "booked" },
			);
			// Sita's project, with a client and brief of its own to look for.
			const hers = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Hidden Client" }),
				{
					artistId: sita.id,
					status: "booked",
					brief: "Sita's private dragon design",
				},
			);
			// Sita's own session: not on Asha's calendar.
			await makeSession(tenant, project, sita);
			return {
				nimas,
				hers,
				own: await makeSession(tenant, nimas, profile, {
					startsAt: at("2026-11-02", "10:00"),
					endsAt: at("2026-11-02", "11:00"),
				}),
				// Booked with Asha, then the project went to Sita: the time stays Asha's.
				reassigned: await makeSession(tenant, hers, profile, {
					startsAt: at("2026-11-02", "12:00"),
					endsAt: at("2026-11-02", "13:00"),
				}),
			};
		});

		const response = await client
			.get(calendarUrl("?date=2026-11-02"))
			.withInertia()
			.loginAs(user);

		response.assertStatus(200);
		const props = response.inertiaProps;
		assert.equal(props.scope, "artist");
		assert.isNull(props.artistFilter);
		assert.deepEqual(
			props.days[0].sessions.map(({ id, project: details }: Row) => [
				id,
				details,
			]),
			[
				[rows.own.id, { id: rows.nimas.id, clientName: "Nima", brief: BRIEF }],
				[rows.reassigned.id, null],
			],
		);
		// Nothing of Sita's project is anywhere in the page, not only in the row.
		const page = JSON.stringify(props);
		for (const hidden of [
			rows.hers.id,
			"Hidden Client",
			"private dragon",
			project.id,
			"Maya",
		]) {
			assert.notInclude(page, hidden);
		}
		const own = await client
			.get(calendarUrl(`?artist=${profile.id}`))
			.withInertia()
			.loginAs(user);
		own.assertStatus(200);
		const sitas = await client
			.get(calendarUrl(`?artist=${sita.id}`))
			.withInertia()
			.loginAs(user);
		sitas.assertStatus(404);
	});

	test("an artist without a profile gets an explanation, not an error", async ({
		client,
		assert,
	}) => {
		const { tenant, sita, project } = await studio();
		await inTenant(tenant, () => makeSession(tenant, project, sita));
		const user = await artistIn(tenant, "ram@example.com");

		const response = await client
			.get(calendarUrl("?date=2026-11-02"))
			.withInertia()
			.loginAs(user);

		response.assertStatus(200);
		assert.equal(response.inertiaProps.scope, "unlinked");
		assert.isNull(response.inertiaProps.artistFilter);
		assert.deepEqual(response.inertiaProps.days[0].sessions, []);
		// Sita's session is in the database, and nothing of it is in the page.
		const page = JSON.stringify(response.inertiaProps);
		assert.notInclude(page, project.id);
		assert.notInclude(page, "Maya");
		const other = await client
			.get(calendarUrl(`?artist=${sita.id}`))
			.withInertia()
			.loginAs(user);
		other.assertStatus(404);
	});

	test("Book session shows for owners and for artists with a profile", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		const { user } = await linkedArtist(tenant);
		const unlinked = await artistIn(tenant, "ram@example.com");
		const canBook = async (member: User) =>
			(await client.get(calendarUrl()).withInertia().loginAs(member))
				.inertiaProps.canBook;

		assert.isTrue(await canBook(owner));
		assert.isTrue(await canBook(user));
		assert.isFalse(await canBook(unlinked));
	});

	test("Book session is left out for an owner whose studio has no artist yet", async ({
		client,
		assert,
	}) => {
		// The page already says to add an artist first: no button beside that line.
		const { owner } = await studioWithOwner();

		const response = await client
			.get(calendarUrl())
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		assert.isFalse(response.inertiaProps.canBook);
		assert.deepEqual(response.inertiaProps.artistFilter, {
			selected: null,
			artists: [],
		});
	});
});
