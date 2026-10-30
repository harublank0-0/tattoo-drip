import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import User from "#models/user";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService from "#modules/artists/services/artist_service";
import FlashDesign from "#modules/flash/models/flash_design";
import ImageService from "#modules/media/services/image_service";
import MessageTemplate from "#modules/notifications/models/message_template";
import StaffAlert from "#modules/notifications/models/staff_alert";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import InvitationService from "#modules/tenancy/services/invitation_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
import { depositServices } from "#tests/helpers/deposits";
import {
	makeInquiry,
	makePayment,
	makeProject,
	makeQuote,
	makeReferenceImage,
	makeSession,
	seedPipeline,
} from "#tests/helpers/pipeline";

/**
 * A fresh studio and its owner. The owner's email comes from the slug, so
 * one test can set up several studios.
 */
export async function studioWithOwner(
	slug = "black-needle",
	name = "Black Needle",
) {
	const owner = await User.create({
		email: `owner@${slug}.example`,
		password: "secret-password",
	});
	const tenant = await new TenancyService().createTenant(owner, {
		type: "studio",
		name,
		slug,
		timezone: "Asia/Kathmandu",
	});
	// A created model holds only what was assigned: read the columns the
	// database defaulted (the page look, TAT-56) like a loaded tenant has.
	await inTenant(tenant, () => tenant.refresh());
	return { owner, tenant };
}

/**
 * A user with the artist role in `tenant`.
 */
export async function artistIn(tenant: Tenant, email = "artist@example.com") {
	const user = await User.create({ email, password: "secret-password" });
	await inTenant(tenant, () =>
		TenantMembership.create({
			tenantId: tenant.id,
			userId: user.id,
			role: "artist",
		}),
	);
	return user;
}

/**
 * Runs `fn` in `tenant`'s context, so row-level security lets its rows
 * through. Use it for any direct model read or write in a test.
 */
export function inTenant<T>(tenant: { id: string }, fn: () => Promise<T>) {
	return withDbContext({ tenantId: tenant.id }, () => fn());
}

/**
 * Runs `fn` as `user` with no tenant: what a signed-in user sees on
 * /dashboard (their own studios and memberships).
 */
export function inUser<T>(user: { id: string }, fn: () => Promise<T>) {
	return withDbContext({ userId: user.id }, () => fn());
}

/**
 * Runs `fn` as `user` inside `tenant`: what a member sees on a tenant page.
 */
export function inTenantAs<T>(
	tenant: { id: string },
	user: { id: string },
	fn: () => Promise<T>,
) {
	return withDbContext({ tenantId: tenant.id, userId: user.id }, () => fn());
}

const paymentMethods = new PaymentMethodService(new ImageService());
const artists = new ArtistService(new ImageService());
const invitations = new InvitationService(artists);
const depositLinks = depositServices().links;

/** One studio seeded as each of twoStudios' studios is (see twoStudios); for tests that need only one. */
export async function seededStudio(slug: string, name: string) {
	const { owner, tenant } = await studioWithOwner(slug, name);
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const paymentMethod = await inTenant(tenant, async () => {
		const first = await paymentMethods.create(tenant, {
			kind: "cash",
			label: `${name} cash`,
		});
		// A second one, so moving the first changes the list: with only one
		// a "move" is a no-op even when it leaks.
		await paymentMethods.create(tenant, {
			kind: "cash",
			label: `${name} tips`,
		});
		return first;
	});
	// The same slug in both studios on purpose: it is unique per tenant.
	const artistProfile = await inTenant(tenant, () =>
		artists.create(
			tenant,
			{
				name: `${name} Sita`,
				slug: "sita",
				bio: null,
				visible: true,
				acceptingInquiries: true,
				acceptingFlash: true,
				closedMessage: null,
				linkToMe: false,
				styles: [],
				instagramUrl: null,
				facebookUrl: null,
				tiktokUrl: null,
			},
			owner,
		),
	);
	// A visible artist who takes no inquiries, with a slug only this studio
	// has, for the public artist route (TAT-44): with both studios' "sita",
	// B's slug under A's path would answer A's own artist.
	const closedArtist = await inTenant(tenant, () =>
		artists.create(
			tenant,
			{
				name: `${name} Mira`,
				slug: `${slug}-mira`,
				bio: null,
				visible: true,
				acceptingInquiries: false,
				acceptingFlash: true,
				closedMessage: `${name} Mira is booked until March.`,
				linkToMe: false,
				styles: [],
				instagramUrl: null,
				facebookUrl: null,
				tiktokUrl: null,
			},
			owner,
		),
	);
	// A cover photo and a logo for the studio (TAT-116, TAT-56, TAT-123) and two work
	// photos for the artist, with made-up keys (the drive ignores a delete of a
	// missing file). Two photos, so that a move changes something.
	await inTenant(tenant, async () => {
		tenant.merge({
			coverImageKey: `tenants/${tenant.id}/studio_cover/${randomUUID()}.640-960-1280-1600.jpg`,
			coverImageWidth: 2048,
			coverImageHeight: 1536,
			logoImageKey: `tenants/${tenant.id}/studio_logo/${randomUUID()}.320.png`,
			logoImageWidth: 600,
			logoImageHeight: 200,
			// TAT-123: the dark tile and an icon, so the public isolation suite
			// covers an icon URL and the tile switch's isolation case changes a row.
			logoTile: "dark",
			logoIconKey: `tenants/${tenant.id}/studio_icon/${randomUUID()}.32.png`,
		});
		await tenant.save();
	});
	const [workPhoto] = await inTenant(tenant, async () => [
		await seedWorkPhoto(tenant, artistProfile),
		await seedWorkPhoto(tenant, artistProfile),
	]);
	const flashDesign = await inTenant(tenant, () =>
		seedFlashDesign(tenant, artistProfile, name),
	);
	const pipeline = await inTenant(tenant, () => seedPipeline(tenant));
	// A second project waiting for the client's answer, for the accept route.
	const quoted = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "quoted",
		});
		return { project, quote: await makeQuote(tenant, project) };
	});
	// A new inquiry with one reference image, for the inbox routes.
	const newInquiry = await inTenant(tenant, async () => {
		const inquiry = await makeInquiry(tenant, pipeline.client);
		await makeReferenceImage(tenant, { inquiryId: inquiry.id });
		return inquiry;
	});
	// An unread alert of the owner about the new inquiry, for the alerts
	// routes (TAT-52).
	const alert = await inTenant(tenant, () =>
		StaffAlert.create({
			tenantId: tenant.id,
			userId: owner.id,
			kind: "new_inquiry",
			inquiryId: newInquiry.id,
		}),
	);
	// The studio's own aftercare text, so the settings page's isolation
	// snapshot reads a real row: a studio that never edited its messages has
	// none (TAT-52).
	const messageTemplate = await inTenant(tenant, () =>
		MessageTemplate.create({
			tenantId: tenant.id,
			kind: "aftercare",
			body: `Hi {client_name}, thank you for choosing ${name}. Take care of it!`,
		}),
	);
	// Sunday to Friday 11:00 to 20:00 and one closed day 20 to 21 days out, so
	// the Good to know settings routes' snapshots read real rows (TAT-128).
	const openingHours = new OpeningHoursService();
	const closedDay = await inTenant(tenant, async () => {
		await openingHours.replaceWeek(
			tenant,
			(["sun", "mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({
				day,
				opens: "11:00",
				closes: "20:00",
			})),
		);
		const today = DateTime.now().setZone(tenant.timezone);
		return openingHours.addClosure(
			tenant,
			{
				startsOn: today.plus({ days: 20 }).toFormat("yyyy-MM-dd"),
				endsOn: today.plus({ days: 21 }).toFormat("yyyy-MM-dd"),
				note: `${name} closed day`,
			},
			today.toFormat("yyyy-MM-dd"),
		);
	});
	// A project booked directly with no price, for the price route (TAT-66).
	const pricelessProject = await inTenant(tenant, () =>
		makeProject(tenant, pipeline.client, { status: "booked" }),
	);
	// The payment routes (TAT-66): a booked project holding a verified
	// deposit (refund, reverse), and a cancelled one whose deposit still
	// needs its outcome.
	const paid = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "booked",
		});
		await makeQuote(tenant, project);
		const payment = await makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
			verifiedByUserId: owner.id,
		});
		return { project, payment };
	});
	const closedPaidProject = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "cancelled",
		});
		await makeQuote(tenant, project);
		await makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
			verifiedByUserId: owner.id,
		});
		return project;
	});
	// A deposit_pending project with its deposit link, and the eSewa method
	// the deposit page shows, for the deposit routes (TAT-65).
	const deposit = await inTenant(tenant, async () => {
		const method = await paymentMethods.create(tenant, {
			kind: "esewa",
			label: `${name} eSewa`,
			accountNumber: "9801234567",
			accountName: name,
			showOnDepositPage: true,
		});
		const project = await makeProject(tenant, pipeline.client, {
			status: "deposit_pending",
		});
		await makeQuote(tenant, project);
		const { link, token } = await depositLinks.issue(
			tenant,
			{ userId: owner.id, role: "owner" },
			project,
		);
		return { method, project, link, token };
	});
	// A scheduled tattoo session on a booked project, for the session routes
	// (TAT-85): 60 days out, clear of the booking case's day (30 days out).
	const scheduled = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "booked",
			artistId: artistProfile.id,
		});
		const startsAt = DateTime.now().plus({ days: 60 }).startOf("hour");
		const session = await makeSession(tenant, project, artistProfile, {
			startsAt,
			endsAt: startsAt.plus({ hours: 2 }),
		});
		return { project, session };
	});
	// The finish routes (TAT-111): an in-progress project assigned to
	// artistProfile whose tattoo session was done a week ago (clear of the
	// session cases' days, 30 to 62 days out), and a project in its healing
	// check. Neither has a quote, so nothing is owed and a finish needs no
	// confirmed amount.
	const finishing = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "in_progress",
			artistId: artistProfile.id,
		});
		const endsAt = DateTime.now().minus({ days: 7 }).startOf("hour");
		await makeSession(tenant, project, artistProfile, {
			startsAt: endsAt.minus({ hours: 2 }),
			endsAt,
			status: "completed",
		});
		const healing = await makeProject(tenant, pipeline.client, {
			status: "healing_check",
			artistId: artistProfile.id,
		});
		return { project, healing };
	});
	// A pending invitation and the artist's membership row, for the members
	// routes (TAT-33).
	const invitation = await inTenant(tenant, async () => {
		const made = await invitations.invite(tenant, owner, {
			email: `invitee@${slug}.example`,
			role: "artist",
			artistId: null,
		});
		return TenantInvitation.findOrFail(made.id);
	});
	const artistMembership = await inTenant(tenant, () =>
		TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("user_id", artist.id)
			.firstOrFail(),
	);
	return {
		tenant,
		owner,
		artist,
		paymentMethod,
		artistProfile,
		closedArtist,
		pipeline,
		// The :id resources of the project routes' isolation cases.
		project: pipeline.project,
		quotedProject: quoted.project,
		quotedQuote: quoted.quote,
		pricelessProject,
		// The payment routes' :id resources (TAT-66).
		payment: pipeline.payment,
		paidProject: paid.project,
		verifiedPayment: paid.payment,
		closedPaidProject,
		// The :id resource of the inbox routes' isolation cases.
		newInquiry,
		// The :id resource of the alerts routes' isolation cases (TAT-52).
		alert,
		// The studio's own aftercare text (TAT-52): the messages settings
		// routes' snapshot.
		messageTemplate,
		// The Good to know settings routes' :id resource (TAT-128); the
		// studio also has Sunday to Friday hours, which the snapshot reads.
		closedDay,
		// The :id resource of the clients routes' isolation cases.
		client: pipeline.client,
		// The deposit routes' resources (TAT-65): the project for the
		// dashboard's :id, the raw token and the code for the public API.
		depositMethod: deposit.method,
		depositProject: deposit.project,
		depositToken: deposit.token,
		depositReferenceCode: deposit.link.referenceCode,
		// The session routes' :id resource (TAT-85) and its project.
		sessionProject: scheduled.project,
		session: scheduled.session,
		// The finish routes' :id resources (TAT-111).
		finishProject: finishing.project,
		healingProject: finishing.healing,
		// The members routes' :id resources (TAT-33).
		invitation,
		artistMembership,
		// The work photo routes' :id resource (TAT-116): the artist profile's
		// first photo (it has a second one).
		workPhoto,
		// The flash routes' :id resource and the public flash reads' (TAT-129):
		// a shown design of the artist profile.
		flashDesign,
	};
}

/** A shown flash design with a made-up key, NPR 3,000; call it in the tenant's context. */
function seedFlashDesign(
	tenant: Tenant,
	artist: { id: string },
	studioName: string,
) {
	return FlashDesign.create({
		tenantId: tenant.id,
		artistId: artist.id,
		imageKey: `tenants/${tenant.id}/flash_design/${randomUUID()}.320-640-1280.png`,
		width: 1200,
		height: 1200,
		name: `${studioName} Moth`,
		size: "About 3 in",
		price: 300_000,
		currency: "NPR",
		hidden: false,
	});
}

/** A work photo row with a made-up key; call it in the tenant's context. */
function seedWorkPhoto(tenant: Tenant, artist: { id: string }) {
	return ArtistWorkPhoto.create({
		tenantId: tenant.id,
		artistId: artist.id,
		imageKey: `tenants/${tenant.id}/artist_work_photo/${randomUUID()}.320-640-1280.jpg`,
		width: 2048,
		height: 1536,
		alt: null,
	});
}

export type Studio = Awaited<ReturnType<typeof seededStudio>>;

/**
 * Two studios, each with an owner, an artist, two payment methods
 * (`paymentMethod` is the first), an artist profile (`artistProfile`), a visible artist who takes no inquiries with a slug only that studio has (`closedArtist`, `<slug>-mira`) and one
 * of each pipeline record (`pipeline`: client, accepted inquiry, project,
 * reference image, quote and a submitted payment), plus a quoted project
 * (`quotedProject`, `quotedQuote`), a new inquiry with a reference image (`newInquiry`) and a deposit_pending project with its deposit link (`depositProject`, `depositToken`, `depositReferenceCode`) and the eSewa method its page shows (`depositMethod`); `project` is the pipeline's project; a project booked without a price (`pricelessProject`), a booked project holding a verified deposit (`paidProject`, `verifiedPayment`) and a cancelled one holding a deposit without an outcome (`closedPaidProject`); `payment` is the pipeline's submitted payment. A booked project assigned to `artistProfile` with a scheduled tattoo session 60 days out (`sessionProject`, `session`) is the session routes' resource (TAT-85); an unread alert of the owner about the new inquiry (`alert`) is the alerts routes' (TAT-52), and the studio's own aftercare text (`messageTemplate`) is what the messages settings routes' snapshot reads. Sunday to Friday hours and one closed day (`closedDay`) are the Good to know settings routes' (TAT-128). A pending invitation (`invitation`) and the artist's membership row (`artistMembership`) are the members routes' (TAT-33). An in-progress project with a done tattoo session and a project in its healing check, both assigned to `artistProfile` and without a quote (`finishProject`, `healingProject`), are the finish routes' resources (TAT-111). Later tickets add seed data
 * for their own tables here, so every isolation case sees it.
 */
export async function twoStudios() {
	return {
		a: await seededStudio("studio-a", "Studio A"),
		b: await seededStudio("studio-b", "Studio B"),
	};
}
