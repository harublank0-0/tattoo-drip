import router from "@adonisjs/core/services/router";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import StaffAlert from "#modules/notifications/models/staff_alert";
import TattooProject from "#modules/projects/models/tattoo_project";
import { rolesFor, TENANT_ROUTE_ROLES } from "#modules/tenancy/access";
import { caseRequest } from "#tests/helpers/isolation";
import { inTenant, type Studio, seededStudio } from "#tests/helpers/tenants";
import { type IsolationCase, isolationCases } from "#tests/isolation/cases";

/**
 * The routes an artist may use (TAT-30), sorted. A checksum of
 * TENANT_ROUTE_ROLES, not a second definition: nothing in the app reads it.
 * Opening a route to artists is a conscious edit of both files.
 */
const ARTIST_ROUTES = [
	"tenant.alerts.index",
	"tenant.alerts.open",
	"tenant.alerts.read",
	"tenant.artists.edit",
	"tenant.artists.mine",
	"tenant.artists.update",
	"tenant.calendar.index",
	"tenant.dashboard",
	"tenant.projects.contacted.store",
	"tenant.projects.create",
	"tenant.projects.index",
	"tenant.projects.moves.store",
	"tenant.projects.notes.update",
	"tenant.projects.price.store",
	"tenant.projects.quotes.accept",
	"tenant.projects.quotes.store",
	"tenant.projects.sessions.store",
	"tenant.projects.show",
	"tenant.projects.store",
	"tenant.sessions.move",
	"tenant.sessions.outcome",
	"tenant.today",
];

/** The name of the route an isolation case sends. */
function routeName({ method, pattern }: IsolationCase): string {
	const route = Object.values(router.toJSON())
		.flat()
		.find(
			(entry) => entry.pattern === pattern && entry.methods.includes(method),
		);
	if (!route?.name) throw new Error(`No named route ${method} ${pattern}`);
	return route.name;
}

/**
 * A studio whose artist member is linked to its artist profile, with every
 * project of the studio assigned to that profile and an unread alert of the
 * artist's own (the alerts routes' resource). An owner-only route can then
 * refuse the artist only for their role, never for a missing assignment,
 * and every other route has something of the artist's to act on.
 */
async function artistsStudio(): Promise<Studio> {
	const studio = await seededStudio("roles-30", "Roles Thirty");
	const alert = await inTenant(studio.tenant, async () => {
		await Artist.query()
			.where("tenant_id", studio.tenant.id)
			.where("id", studio.artistProfile.id)
			.update({ user_id: studio.artist.id });
		await TattooProject.query()
			.where("tenant_id", studio.tenant.id)
			.update({ artist_id: studio.artistProfile.id });
		return StaffAlert.create({
			tenantId: studio.tenant.id,
			userId: studio.artist.id,
			kind: "new_inquiry",
			inquiryId: studio.newInquiry.id,
		});
	});
	return { ...studio, alert };
}

test.group("What an artist may use (TAT-30)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("artists may use exactly the routes in ARTIST_ROUTES", ({ assert }) => {
		const open = Object.keys(TENANT_ROUTE_ROLES)
			.filter((name) => rolesFor(name)?.includes("artist"))
			.sort();
		assert.deepEqual(open, ARTIST_ROUTES);
	});

	for (const isolationCase of isolationCases) {
		test(`${isolationCase.method} ${isolationCase.pattern} as an artist`, async ({
			client,
			assert,
		}) => {
			const studio = await artistsStudio();
			const name = routeName(isolationCase);
			const allowed = rolesFor(name)?.includes("artist") ?? false;
			const writes = isolationCase.method !== "GET";
			const before = await isolationCase.snapshot(studio);

			const response = await caseRequest(
				client,
				isolationCase,
				studio,
				studio,
				studio.artist,
			);

			if (allowed) {
				// The same positive control the cross-tenant spec gives owners,
				// and a write must have written (a refused form is a 302 too).
				response.assertStatus(isolationCase.ownStatus);
				if (writes) {
					assert.notDeepEqual(
						await isolationCase.snapshot(studio),
						before,
						`${name}: the artist's write changed nothing`,
					);
				}
				return;
			}
			response.assertStatus(404);
			assert.deepEqual(
				await isolationCase.snapshot(studio),
				before,
				`${name}: an owner-only route changed the studio for an artist`,
			);
		});
	}
});
