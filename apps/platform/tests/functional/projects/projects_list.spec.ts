import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const list = (query = "") => `/t/black-needle/projects${query}`;

type Row = { clientName: string; status: string; noSession: boolean };

test.group("Projects list", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the active projects with their details and counts", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant, "asha");
			const sita = await makeClient(tenant, { name: "Sita Rai" });
			const ram = await makeClient(tenant, { name: "Ram Thapa" });
			const maya = await makeClient(tenant, { name: "Maya Gurung" });
			await makeProject(tenant, sita, {
				status: "quoted",
				artistId: artist.id,
				lastContactedAt: DateTime.now().minus({ days: 2 }),
			});
			const booked = await makeProject(tenant, ram, { status: "booked" });
			await makeProject(tenant, maya, { status: "booked" });
			await makeSession(tenant, booked, artist);
			await makeProject(tenant, maya, { status: "declined" });
		});

		const response = await client.get(list()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("projects/index");
		const props = response.inertiaProps;
		assert.equal(props.filter, "active");
		assert.deepEqual(props.counts.active, 3);
		assert.deepEqual(props.counts.closed, 1);
		assert.equal(props.counts.byStatus.booked, 2);
		assert.equal(props.counts.byStatus.on_hold, 0);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 3 });

		const rows = props.projects as (Row & {
			artistName: string | null;
			contactedText: string;
		})[];
		const sitaRow = rows.find(({ clientName }) => clientName === "Sita Rai");
		assert.deepInclude(sitaRow, {
			status: "quoted",
			artistName: "Sita",
			contactedText: "contacted 2 days ago",
			noSession: false,
		});
		const bookedRows = rows.filter(({ status }) => status === "booked");
		assert.sameDeepMembers(
			bookedRows.map(({ clientName, noSession }) => ({
				clientName,
				noSession,
			})),
			[
				{ clientName: "Ram Thapa", noSession: false },
				{ clientName: "Maya Gurung", noSession: true },
			],
		);
	});

	test("filters by closed or one status; junk falls back to active", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeProject(tenant, customer, { status: "quoted" });
			await makeProject(tenant, customer, { status: "cancelled" });
		});
		const statuses = async (query: string) => {
			const props = (await client.get(list(query)).withInertia().loginAs(owner))
				.inertiaProps;
			return {
				filter: props.filter,
				statuses: (props.projects as Row[]).map(({ status }) => status),
			};
		};

		assert.deepEqual(await statuses("?status=closed"), {
			filter: "closed",
			statuses: ["cancelled"],
		});
		assert.deepEqual(await statuses("?status=quoted"), {
			filter: "quoted",
			statuses: ["quoted"],
		});
		assert.deepEqual(await statuses("?status=bogus&page=abc"), {
			filter: "active",
			statuses: ["quoted"],
		});
		assert.deepEqual(await statuses("?page=99"), {
			filter: "active",
			statuses: [],
		});
	});

	test("an artist sees only their own projects", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const customer = await makeClient(tenant, { name: "Theirs" });
			const other = await makeClient(tenant, { name: "Not theirs" });
			await makeProject(tenant, customer, { artistId: profile.id });
			await makeProject(tenant, other);
		});

		const props = (await client.get(list()).withInertia().loginAs(asha))
			.inertiaProps;
		assert.deepEqual(
			(props.projects as Row[]).map(({ clientName }) => clientName),
			["Theirs"],
		);
		assert.equal(props.counts.active, 1);
	});
});
