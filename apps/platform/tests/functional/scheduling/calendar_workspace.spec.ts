import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { AGENDA_DAYS, MONTH_CELL_ROWS } from "#modules/scheduling/calendar";
import ProjectSession from "#modules/scheduling/models/project_session";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import { makeClient, makeProject, makeSession } from "#tests/helpers/pipeline";
import { inTenant } from "#tests/helpers/tenants";
import { KTM, studio } from "#tests/helpers/waiting_fixtures";

type Who = Parameters<ReturnType<ApiClient["get"]>["loginAs"]>[0];
type Row = { id: string; status: string };
type Day = {
	date: string;
	sessions: Row[];
	count: number;
	inMonth: boolean;
	hours: { opens: string; closes: string } | null;
	closure: { note: string | null } | null;
};

const calendar = (slug: string, query: string) => `/t/${slug}/calendar${query}`;

async function propsOf(client: ApiClient, url: string, user: Who) {
	const response = await client.get(url).withInertia().loginAs(user);
	response.assertStatus(200);
	response.assertInertiaComponent("calendar/index");
	return response.inertiaProps as {
		view: string;
		days: Day[];
		selected: Record<string, unknown> | null;
	} & Record<string, unknown>;
}

/** A day `days` from today in Kathmandu, as yyyy-MM-dd, and a time on it. */
const dayFrom = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");
const at = (date: string, hour: number, minute = 0) =>
	DateTime.fromISO(date, { zone: KTM }).set({ hour, minute });

/** A studio with a booked project for Asha and one for Sita. */
async function booked(slug: string) {
	const s = await studio(slug);
	const projects = await inTenant(s.tenant, async () => ({
		ashas: await makeProject(
			s.tenant,
			await makeClient(s.tenant, { name: "Asha's client" }),
			{ status: "booked", artistId: s.ashaProfile.id },
		),
		sitas: await makeProject(
			s.tenant,
			await makeClient(s.tenant, { name: "Sita's client" }),
			{ status: "booked", artistId: s.sitaProfile.id },
		),
	}));
	return { ...s, ...projects };
}

test.group("Calendar workspace (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a month is whole weeks; a busy day lists a few and counts them all", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-month");
		const date = "2026-11-18";
		await inTenant(s.tenant, async () => {
			for (const hour of [9, 11, 13, 15]) {
				await makeSession(s.tenant, s.ashas, s.ashaProfile, {
					startsAt: at(date, hour),
					endsAt: at(date, hour + 1),
				});
			}
		});

		const props = await propsOf(
			client,
			calendar("cal-month", `?view=month&date=${date}`),
			s.owner,
		);

		assert.equal(props.view, "month");
		assert.equal(props.rangeText, "November 2026");
		assert.lengthOf(props.days, 35);
		const busy = props.days.find((day) => day.date === date) as Day;
		assert.equal(busy.count, 4);
		assert.lengthOf(busy.sessions, MONTH_CELL_ROWS);
		assert.isTrue(busy.inMonth);
		assert.isFalse((props.days.at(-1) as Day).inMonth, "5 December");
	});

	test("the list is two weeks from its date", async ({ client, assert }) => {
		const s = await booked("cal-agenda");
		const props = await propsOf(
			client,
			calendar("cal-agenda", "?view=agenda&date=2026-11-06"),
			s.owner,
		);
		assert.lengthOf(props.days, AGENDA_DAYS);
		assert.equal(props.days[0].date, "2026-11-06");
		assert.equal(props.next, "2026-11-20");
	});

	test("the status filter: freed time only when asked for, and then only freed time", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-status");
		const date = dayFrom(3);
		const made = await inTenant(s.tenant, async () => {
			const make = (hour: number, status: string) =>
				makeSession(s.tenant, s.ashas, s.ashaProfile, {
					startsAt: at(date, hour),
					endsAt: at(date, hour + 1),
					status: status as ProjectSession["status"],
				});
			return {
				scheduled: await make(9, "scheduled"),
				cancelled: await make(11, "cancelled"),
				noShow: await make(13, "no_show"),
			};
		});
		const ids = async (status: string) =>
			(
				await propsOf(
					client,
					calendar("cal-status", `?view=day&date=${date}${status}`),
					s.owner,
				)
			).days[0].sessions.map(({ id }) => id);

		assert.deepEqual(await ids(""), [made.scheduled.id]);
		assert.deepEqual(await ids("&status=scheduled"), [made.scheduled.id]);
		assert.deepEqual(await ids("&status=cancelled"), [
			made.cancelled.id,
			made.noShow.id,
		]);
		assert.deepEqual(await ids("&status=completed"), []);
	});

	test("an owner's drawer: the session, its project and client, and what they may do", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-drawer");
		const date = dayFrom(2);
		const session = await inTenant(s.tenant, () =>
			makeSession(s.tenant, s.ashas, s.ashaProfile, {
				startsAt: at(date, 14),
				endsAt: at(date, 16, 30),
			}),
		);

		const props = await propsOf(
			client,
			calendar("cal-drawer", `?view=week&date=${date}&session=${session.id}`),
			s.owner,
		);

		assert.containsSubset(props.selected, {
			id: session.id,
			status: "scheduled",
			artistName: "Asha",
			lengthText: "2 h 30 min",
			project: {
				id: s.ashas.id,
				clientName: "Asha's client",
				status: "booked",
				clientId: s.ashas.clientId,
			},
			// Not started yet: only cancelling, and moving.
			outcomes: ["cancelled"],
			move: { date, startTime: "14:00", hours: 2.5 },
		});

		// A session outside the range shown, or no session at all, opens nothing.
		for (const query of [
			`?view=day&date=${dayFrom(9)}&session=${session.id}`,
			`?view=week&date=${date}&session=01a1b000-0000-7000-8000-000000000000`,
			`?view=week&date=${date}&session=not-an-id`,
		]) {
			assert.isNull(
				(await propsOf(client, calendar("cal-drawer", query), s.owner))
					.selected,
				query,
			);
		}
	});

	test("an artist's drawer: their own session on their project, a covered session without its project, and never another artist's", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-artist");
		const date = dayFrom(2);
		const made = await inTenant(s.tenant, async () => ({
			own: await makeSession(s.tenant, s.ashas, s.ashaProfile, {
				startsAt: at(date, 10),
				endsAt: at(date, 12),
			}),
			// Asha covers a session on Sita's project.
			covering: await makeSession(s.tenant, s.sitas, s.ashaProfile, {
				startsAt: at(date, 14),
				endsAt: at(date, 15),
			}),
			sitas: await makeSession(s.tenant, s.sitas, s.sitaProfile, {
				startsAt: at(date, 10),
				endsAt: at(date, 12),
			}),
		}));
		const drawer = async (id: string) =>
			(
				await propsOf(
					client,
					calendar("cal-artist", `?view=day&date=${date}&session=${id}`),
					s.asha,
				)
			).selected;

		const own = await drawer(made.own.id);
		assert.containsSubset(own, {
			id: made.own.id,
			project: { id: s.ashas.id, clientId: null },
			outcomes: ["cancelled"],
		});
		assert.isNotNull(own?.move);

		const covering = await drawer(made.covering.id);
		assert.containsSubset(covering, {
			id: made.covering.id,
			project: null,
			outcomes: [],
			move: null,
		});

		assert.isNull(await drawer(made.sitas.id));
		const page = await propsOf(
			client,
			calendar("cal-artist", `?view=day&date=${date}&session=${made.sitas.id}`),
			s.asha,
		);
		assert.notInclude(JSON.stringify(page), "Sita's client");
		assert.notInclude(JSON.stringify(page), made.sitas.id);
	});

	test("the drawer's forms go back to the calendar; any other back goes to the project", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-back");
		const date = dayFrom(4);
		const session = await inTenant(s.tenant, () =>
			makeSession(s.tenant, s.ashas, s.ashaProfile, {
				startsAt: at(date, 10),
				endsAt: at(date, 12),
			}),
		);
		const move = (back: string, startTime: string) =>
			client
				.post(`/t/cal-back/sessions/${session.id}/move`)
				.form({ date, startTime, hours: "2", back })
				.withCsrfToken()
				.loginAs(s.owner)
				.redirects(0);

		const calendarBack = `/t/cal-back/calendar?view=week&date=${date}`;
		const toCalendar = await move(calendarBack, "13:00");
		toCalendar.assertStatus(302);
		toCalendar.assertHeader("location", calendarBack);

		for (const [index, back] of [
			"https://evil.example/t/cal-back/calendar",
			"/t/other-studio/calendar?view=day",
			"/t/cal-back/projects",
		].entries()) {
			const response = await move(back, `${14 + index}:00`);
			response.assertStatus(302);
			response.assertHeader("location", `/t/cal-back/projects/${s.ashas.id}`);
		}

		const moved = await inTenant(s.tenant, () =>
			ProjectSession.findOrFail(session.id),
		);
		assert.equal(moved.startsAt.setZone(KTM).toFormat("HH:mm"), "16:00");
	});

	test("a move onto the artist's other session is refused and nothing moves", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-overlap");
		const date = dayFrom(4);
		const { first } = await inTenant(s.tenant, async () => ({
			first: await makeSession(s.tenant, s.ashas, s.ashaProfile, {
				startsAt: at(date, 10),
				endsAt: at(date, 12),
			}),
			second: await makeSession(s.tenant, s.ashas, s.ashaProfile, {
				startsAt: at(date, 14),
				endsAt: at(date, 16),
			}),
		}));
		const back = `/t/cal-overlap/calendar?view=day&date=${date}`;

		const response = await client
			.post(`/t/cal-overlap/sessions/${first.id}/move`)
			.header("referer", `${back}&session=${first.id}`)
			.form({ date, startTime: "15:00", hours: "2", back })
			.withCsrfToken()
			.loginAs(s.owner)
			.redirects(0);

		response.assertStatus(302);
		// Back to the drawer it came from, with the error under its field.
		response.assertHeader("location", `${back}&session=${first.id}`);
		const kept = await inTenant(s.tenant, () =>
			ProjectSession.findOrFail(first.id),
		);
		assert.equal(kept.startsAt.setZone(KTM).toFormat("HH:mm"), "10:00");
	});

	test("each day carries the studio's hours for its weekday and its closed-days entry", async ({
		client,
		assert,
	}) => {
		const s = await booked("cal-hours");
		const hours = new OpeningHoursService();
		// 2 Nov 2026 is a Monday; the week runs 1 to 7 November.
		await inTenant(s.tenant, async () => {
			await hours.replaceWeek(s.tenant, [
				{ day: "mon", opens: "11:00", closes: "19:00" },
				{ day: "tue", opens: "10:00", closes: "18:00" },
			]);
			await hours.addClosure(
				s.tenant,
				{ startsOn: "2026-11-03", endsOn: "2026-11-04", note: "Tihar" },
				"2026-11-01",
			);
		});

		const props = await propsOf(
			client,
			calendar("cal-hours", "?view=week&date=2026-11-02"),
			s.owner,
		);
		const byDate = Object.fromEntries(props.days.map((day) => [day.date, day]));

		assert.isNull(byDate["2026-11-01"].hours);
		assert.deepEqual(byDate["2026-11-02"].hours, {
			opens: "11:00",
			closes: "19:00",
		});
		assert.isNull(byDate["2026-11-02"].closure);
		assert.deepEqual(byDate["2026-11-03"].closure, { note: "Tihar" });
		assert.deepEqual(byDate["2026-11-04"].closure, { note: "Tihar" });
		assert.isNull(byDate["2026-11-05"].closure);
	});
});
