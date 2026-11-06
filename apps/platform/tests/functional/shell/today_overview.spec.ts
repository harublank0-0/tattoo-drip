import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	makeClient,
	makeInquiry,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { KTM, studio } from "#tests/helpers/waiting_fixtures";

type Who = Parameters<ReturnType<ApiClient["get"]>["loginAs"]>[0];
type Metric = { key: string; label: string; value: string; detail: string };
type Upcoming = {
	count: number;
	days: number;
	from: string;
	rows: {
		id: string;
		date: string;
		dayText: string;
		startText: string;
		artistName: string | null;
		project: { id: string; clientName: string | null } | null;
	}[];
};

async function propsOf(client: ApiClient, slug: string, user: Who) {
	const response = await client
		.get(`/t/${slug}/today`)
		.withInertia()
		.loginAs(user);
	response.assertStatus(200);
	response.assertInertiaComponent("today/index");
	return response.inertiaProps;
}

const metric = (props: Record<string, unknown>, key: string) =>
	(props.metrics as Metric[]).find((item) => item.key === key);

/** A local time `days` from today, in Kathmandu (the fixtures' studio). */
const local = (days: number, hour: number, minute = 0) =>
	DateTime.now()
		.setZone(KTM)
		.plus({ days })
		.startOf("day")
		.set({ hour, minute });

test.group("Today: the overview (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the next seven days hold the sessions after today, none twice, none past the seventh day", async ({
		client,
		assert,
	}) => {
		const s = await studio("overview-days");
		const made = await inTenant(s.tenant, async () => {
			const project = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Ahead" }),
				{ status: "booked", artistId: s.ashaProfile.id },
			);
			const session = (days: number, hour: number, length = 2) =>
				makeSession(s.tenant, project, s.ashaProfile, {
					startsAt: local(days, hour),
					endsAt: local(days, hour).plus({ hours: length }),
				});
			return {
				today: await session(0, 10),
				// Starts late today, ends tomorrow: today's only.
				overnight: await session(0, 23, 2),
				tomorrow: await session(1, 11),
				seventh: await session(7, 9),
				eighth: await session(8, 9),
				cancelled: await makeSession(s.tenant, project, s.sitaProfile, {
					startsAt: local(2, 12),
					endsAt: local(2, 14),
					status: "cancelled",
				}),
			};
		});

		const props = await propsOf(client, "overview-days", s.owner);
		const upcoming = props.upcoming as Upcoming;

		assert.deepEqual(
			props.sessions.rows.map(({ id }: { id: string }) => id),
			[made.today.id, made.overnight.id],
		);
		assert.equal(upcoming.days, 7);
		assert.equal(upcoming.from, local(1, 0).toFormat("yyyy-MM-dd"));
		assert.equal(upcoming.count, 2);
		assert.deepEqual(
			upcoming.rows.map(({ id }) => id),
			[made.tomorrow.id, made.seventh.id],
		);
		const [first] = upcoming.rows;
		assert.equal(first.date, local(1, 11).toFormat("yyyy-MM-dd"));
		assert.equal(
			first.dayText,
			local(1, 11).setLocale("en-GB").toFormat("ccc d LLL"),
		);
		assert.equal(first.startText, "11:00");
		assert.equal(first.artistName, "Asha");
		assert.equal(first.project?.clientName, "Ahead");

		assert.deepEqual(metric(props, "sessions"), {
			key: "sessions",
			label: "Sessions today",
			value: "2",
			detail: metric(props, "sessions")?.detail,
		});
		assert.equal(metric(props, "upcoming")?.value, "2");
		// One of the two artists has a session today.
		assert.deepEqual(metric(props, "artists"), {
			key: "artists",
			label: "Artists in today",
			value: "1 of 2",
			detail: "With a session today",
		});
		assert.match(props.greeting, /^Good (morning|afternoon|evening)$/);
	});

	test("an artist's days ahead are their own sessions, and a project they can't open shows no client", async ({
		client,
		assert,
	}) => {
		const s = await studio("overview-artist");
		const made = await inTenant(s.tenant, async () => {
			const mine = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Mine" }),
				{ status: "booked", artistId: s.ashaProfile.id },
			);
			const sitas = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Sita's client" }),
				{ status: "booked", artistId: s.sitaProfile.id },
			);
			return {
				own: await makeSession(s.tenant, mine, s.ashaProfile, {
					startsAt: local(1, 10),
					endsAt: local(1, 12),
				}),
				// Asha covers a session on Sita's project: its time, no client.
				covering: await makeSession(s.tenant, sitas, s.ashaProfile, {
					startsAt: local(2, 10),
					endsAt: local(2, 12),
				}),
				sitas: await makeSession(s.tenant, sitas, s.sitaProfile, {
					startsAt: local(1, 15),
					endsAt: local(1, 17),
				}),
			};
		});

		const props = await propsOf(client, "overview-artist", s.asha);
		const upcoming = props.upcoming as Upcoming;

		assert.deepEqual(
			upcoming.rows.map(({ id, project }) => [id, project?.clientName ?? null]),
			[
				[made.own.id, "Mine"],
				[made.covering.id, null],
			],
		);
		assert.notInclude(JSON.stringify(props), "Sita's client");
		assert.notInclude(JSON.stringify(props), made.sitas.id);
		assert.deepEqual(
			props.metrics.map(({ key }: Metric) => key),
			["sessions", "needs", "upcoming"],
		);
	});

	test("an artist without a profile has no days ahead", async ({
		client,
		assert,
	}) => {
		const s = await studio("overview-unlinked");
		const stranger = await artistIn(s.tenant, "ram@overview-unlinked.example");

		const props = await propsOf(client, "overview-unlinked", stranger);

		assert.deepEqual(props.upcoming, {
			count: 0,
			days: 7,
			from: local(1, 0).toFormat("yyyy-MM-dd"),
			rows: [],
		});
		assert.equal(metric(props, "upcoming")?.value, "0");
	});

	test("Need you is the sum of the queue's groups", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("overview-needs");
		await inTenant(tenant, async () => {
			await makeProject(
				tenant,
				await makeClient(tenant, { name: "To price" }),
				{
					status: "reviewing",
				},
			);
			await makeInquiry(tenant, await makeClient(tenant, { name: "Asker" }));
		});

		const props = await propsOf(client, "overview-needs", owner);
		const total = (props.needsYou as { count: number }[]).reduce(
			(sum, { count }) => sum + count,
			0,
		);

		const requests = (props.needsYou as { key: string; count: number }[]).find(
			({ key }) => key === "requests",
		)?.count;
		assert.equal(requests, 1);
		assert.isAbove(total, requests ?? 0);
		assert.equal(metric(props, "needs")?.value, String(total));
		assert.equal(
			metric(props, "needs")?.detail,
			`1 request, ${total - 1} project${total - 1 === 1 ? "" : "s"}`,
		);
	});

	test("the days ahead cost no more queries as sessions are added", async ({
		client,
		assert,
	}) => {
		const s = await studio("overview-queries");
		const project = await inTenant(s.tenant, async () =>
			makeProject(s.tenant, await makeClient(s.tenant, { name: "Busy" }), {
				status: "booked",
				artistId: s.ashaProfile.id,
			}),
		);
		const add = (days: number) =>
			inTenant(s.tenant, () =>
				makeSession(s.tenant, project, s.ashaProfile, {
					startsAt: local(days, 10),
					endsAt: local(days, 12),
				}),
			);
		const count = async () => {
			const { result, queries } = await recordQueries(() =>
				client.get("/t/overview-queries/today").withInertia().loginAs(s.owner),
			);
			result.assertStatus(200);
			return queries.length;
		};

		await add(1);
		const few = await count();
		await add(2);
		await add(3);
		const many = await count();

		assert.equal(many, few);
	});
});
