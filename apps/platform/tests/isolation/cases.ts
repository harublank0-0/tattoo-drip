import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { DEFAULT_TEMPLATES } from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import StaffAlert from "#modules/notifications/models/staff_alert";
import DepositLink from "#modules/payments/models/deposit_link";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment from "#modules/payments/models/payment";
import PaymentMethod from "#modules/payments/models/payment_method";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectSession from "#modules/scheduling/models/project_session";
import Tenant from "#modules/tenancy/models/tenant";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenantSlug from "#modules/tenancy/models/tenant_slug";
import { inTenant, type Studio } from "#tests/helpers/tenants";

/**
 * One entry per /t/:tenant route. The cross-tenant spec runs each as studio
 * A's actor against studio B; the route-coverage guard in
 * tenant_routes.spec.ts fails for a route that has neither an entry here
 * nor an exemption with a reason.
 *
 * The limit: with row-level security on, a service query that forgot its
 * tenant filter still gives a 404 here (RLS alone hides the row), so this
 * table proves the system as a whole. The app-level filters are covered by
 * the service specs that run from the OTHER tenant's context (inTenantAs),
 * e.g. payment_method_service.spec.ts "list and findFor only see the
 * tenant's live methods".
 */
export type IsolationCase = {
	method: "GET" | "POST" | "PUT" | "DELETE";
	/** The route as the router prints it, e.g. /t/:tenant/settings/payments/:id */
	pattern: string;
	/**
	 * The seeded resource (a key of Studio) that the route's :id refers to.
	 * Required for a pattern with an :id; the helper throws without it.
	 */
	resource?:
		| "paymentMethod"
		| "artistProfile"
		| "project"
		| "quotedProject"
		| "pricelessProject"
		| "payment"
		| "verifiedPayment"
		| "paidProject"
		| "closedPaidProject"
		| "depositProject"
		| "session"
		| "sessionProject"
		| "newInquiry"
		| "client"
		| "alert"
		| "invitation"
		| "artistMembership";
	/** Who sends the request. Every settings route is owner-only. */
	actor: "owner" | "artist";
	/** A valid body for writes, built for the studio sending it. */
	body?: (own: Studio) => Record<string, unknown>;
	/** The status the actor gets on its own studio: the positive control. */
	ownStatus: 200 | 302;
	/** Reads the state of the targeted studio that the route could change. */
	snapshot: (target: Studio) => Promise<unknown>;
};

/**
 * Routes with no isolation case, with the reason. Even pages that read
 * nothing get a case, because the 404 for a foreign slug is still worth
 * proving; only a route that is not part of the app belongs here.
 */
export const EXEMPT_ROUTES: Record<string, string> = {
	"GET /t/:tenant/__test/db/settings":
		"Test-only route (tests/support/test_routes.ts, registered by the functional suite). It echoes the session settings and reads no tenant table; the middleware order test covers it.",
};

const none = async () => null;

const tenantRow = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Tenant.findOrFail(target.tenant.id)).serialize(),
	);

const methodRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await PaymentMethod.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("position")
				.orderBy("id")
		).map((method) => method.serialize()),
	);

// Deleted rows included, so an unauthorized soft delete shows.
const artistRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await Artist.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("slug")
				.orderBy("id")
		).map((artist) => artist.serialize()),
	);

const depositLinkRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await DepositLink.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((link) => link.serialize()),
	);

// Projects with their status, deleted ones included, and every quote.
const projectRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((project) => project.serialize()),
		quotes: (
			await Quote.query().where("tenant_id", target.tenant.id).orderBy("id")
		).map((quote) => quote.serialize()),
	}));

// Payments, deposit outcomes and the projects' statuses: what the payment
// routes could change.
const paymentRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		payments: (
			await Payment.query().where("tenant_id", target.tenant.id).orderBy("id")
		).map((payment) => payment.serialize()),
		outcomes: (
			await DepositOutcome.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((outcome) => outcome.serialize()),
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map(({ id, status }) => ({ id, status })),
	}));

// Sessions, deleted ones included, and the projects' statuses: what the
// session routes could change (TAT-85).
const sessionRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		sessions: (
			await ProjectSession.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((session) => session.serialize()),
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map(({ id, status }) => ({ id, status })),
	}));

// Inquiries, projects and reference images, deleted ones included: what
// accepting or declining an inquiry could change.
const inboxRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		inquiries: (
			await Inquiry.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((inquiry) => inquiry.serialize()),
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((project) => project.serialize()),
		images: (
			await ReferenceImage.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((image) => image.serialize()),
	}));

// Clients, deleted ones included: what editing a client could change.
const clientRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await Client.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((client) => client.serialize()),
	);

// What a booking can create: projects, quotes, sessions and clients,
// deleted ones included.
const bookingRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((project) => project.serialize()),
		quotes: (
			await Quote.query().where("tenant_id", target.tenant.id).orderBy("id")
		).map((quote) => quote.serialize()),
		sessions: (
			await ProjectSession.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((session) => session.serialize()),
		clients: (
			await Client.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((client) => client.serialize()),
	}));

const profileBody = (own: Studio) => ({
	name: `${own.tenant.name} renamed`,
	timezone: "Asia/Kathmandu",
	intro: "",
	contactPhone: "",
	contactEmail: "",
	address: "",
	instagramUrl: "",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
});

// The tenant row and every slug it holds: what changing the address could
// change.
const tenantSlugRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		tenant: (await Tenant.findOrFail(target.tenant.id)).serialize(),
		slugs: (
			await TenantSlug.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("slug")
		).map((row) => row.serialize()),
	}));

// The studio's own message texts (TAT-52): what saving the messages could
// change.
const templateRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await MessageTemplate.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("kind")
		).map((row) => row.serialize()),
	);

// Every member's alerts (TAT-52): what reading or opening one could change.
const alertRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await StaffAlert.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((alert) => alert.serialize()),
	);

// Memberships (removed ones included), invitations and who each profile is
// linked to (TAT-33): what the members routes could change.
const memberRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		memberships: (
			await TenantMembership.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((membership) => membership.serialize()),
		invitations: (
			await TenantInvitation.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((invitation) => invitation.serialize()),
		profiles: (
			await Artist.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map(({ id, userId }) => ({ id, userId })),
	}));

export const isolationCases: IsolationCase[] = [
	{
		method: "GET",
		pattern: "/t/:tenant",
		actor: "owner",
		ownStatus: 302,
		snapshot: none,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings",
		actor: "owner",
		ownStatus: 302,
		snapshot: none,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/profile",
		actor: "owner",
		ownStatus: 200,
		snapshot: tenantRow,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/profile",
		actor: "owner",
		body: profileBody,
		ownStatus: 302,
		snapshot: tenantRow,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/payments",
		actor: "owner",
		ownStatus: 200,
		snapshot: methodRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/deposits",
		actor: "owner",
		body: () => ({
			defaultDepositPercent: "30",
			depositPolicy: "Holds your date.",
		}),
		ownStatus: 302,
		snapshot: tenantRow,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/slug",
		actor: "owner",
		body: (own) => ({ slug: `${own.tenant.slug}-renamed` }),
		ownStatus: 302,
		snapshot: tenantSlugRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/payments/new",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/payments",
		actor: "owner",
		body: () => ({ kind: "cash", label: "Another cash" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/payments/:id",
		resource: "paymentMethod",
		actor: "owner",
		body: () => ({ label: "Renamed" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/payments/:id/edit",
		resource: "paymentMethod",
		actor: "owner",
		ownStatus: 200,
		snapshot: methodRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/payments/:id/move",
		resource: "paymentMethod",
		actor: "owner",
		body: () => ({ direction: "down" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/settings/payments/:id",
		resource: "paymentMethod",
		actor: "owner",
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/artists",
		actor: "owner",
		ownStatus: 200,
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/artists/new",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/artists/mine",
		actor: "owner",
		// The owner has no profile of their own: the list.
		ownStatus: 302,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/artists",
		actor: "owner",
		body: () => ({ name: "Another artist", slug: "another-artist" }),
		ownStatus: 302,
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/artists/:id/edit",
		resource: "artistProfile",
		actor: "owner",
		ownStatus: 200,
		snapshot: artistRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/artists/:id",
		resource: "artistProfile",
		actor: "owner",
		body: (own) => ({
			name: "Renamed artist",
			slug: own.artistProfile.slug,
		}),
		ownStatus: 302,
		snapshot: artistRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/artists/:id",
		resource: "artistProfile",
		actor: "owner",
		ownStatus: 302,
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/projects/:id",
		resource: "project",
		actor: "owner",
		ownStatus: 200,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/quotes",
		resource: "project",
		actor: "owner",
		body: (own) => ({
			// The pipeline's project already has this quote.
			baseQuoteId: own.pipeline.quote.id,
			kind: "fixed",
			fixedPrice: "20000",
			depositAmount: "5000",
			// The test studios' timezone.
			expiresOn: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 14 })
				.toFormat("yyyy-MM-dd"),
		}),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/quotes/accept",
		resource: "quotedProject",
		actor: "owner",
		body: (own) => ({ quoteId: own.quotedQuote.id }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/price",
		resource: "pricelessProject",
		actor: "owner",
		body: () => ({ fixedPrice: "8000" }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/payments",
		resource: "project",
		actor: "owner",
		body: () => ({ kind: "session", method: "cash", amount: "2000" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/refunds",
		resource: "paidProject",
		actor: "owner",
		body: () => ({ method: "cash", amount: "1000" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/deposit-outcome",
		resource: "closedPaidProject",
		actor: "owner",
		body: () => ({ outcome: "kept" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/payments/:id/verify",
		resource: "payment",
		actor: "owner",
		body: () => ({ note: "On the statement" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/payments/:id/reject",
		resource: "payment",
		actor: "owner",
		body: () => ({ note: "Not on the statement" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/payments/:id/reverse",
		resource: "verifiedPayment",
		actor: "owner",
		body: () => ({ note: "Never arrived" }),
		ownStatus: 302,
		snapshot: paymentRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/projects",
		actor: "owner",
		ownStatus: 200,
		snapshot: projectRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/projects/new",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects",
		actor: "owner",
		body: (own) => ({
			clientId: own.client.id,
			artistId: own.artistProfile.id,
			// The test studios' timezone; a month out, so the artist is free.
			date: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 30 })
				.toFormat("yyyy-MM-dd"),
			startTime: "10:00",
			hours: "2",
			brief: "Walk-in: a small rose",
			priceKind: "fixed",
			fixedPrice: "5000",
		}),
		ownStatus: 302,
		snapshot: bookingRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/moves",
		resource: "quotedProject",
		actor: "owner",
		body: () => ({ move: "hold" }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/projects/:id/notes",
		resource: "project",
		actor: "owner",
		body: () => ({ notes: "Called back about sizing." }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/contacted",
		resource: "project",
		actor: "owner",
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/projects/:id/artist",
		resource: "project",
		actor: "owner",
		body: (own) => ({ artistId: own.artistProfile.id }),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/deposit-link",
		resource: "depositProject",
		actor: "owner",
		ownStatus: 302,
		// A new link replaces the nonce, hash and expiry: A's snapshot changes.
		snapshot: depositLinkRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/inbox",
		actor: "owner",
		ownStatus: 200,
		snapshot: inboxRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/inbox/:id",
		resource: "newInquiry",
		actor: "owner",
		ownStatus: 200,
		snapshot: inboxRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/inbox/:id/accept",
		resource: "newInquiry",
		actor: "owner",
		body: () => ({ artistId: "" }),
		ownStatus: 302,
		snapshot: inboxRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/inbox/:id/decline",
		resource: "newInquiry",
		actor: "owner",
		ownStatus: 302,
		snapshot: inboxRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/clients",
		actor: "owner",
		ownStatus: 200,
		snapshot: clientRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/clients/:id",
		resource: "client",
		actor: "owner",
		ownStatus: 200,
		snapshot: clientRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/clients/:id/edit",
		resource: "client",
		actor: "owner",
		ownStatus: 200,
		snapshot: clientRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/clients/:id",
		resource: "client",
		actor: "owner",
		body: (own) => ({
			name: "Renamed client",
			phone: own.client.phone ?? "",
			email: "",
			notes: "",
		}),
		ownStatus: 302,
		snapshot: clientRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/calendar",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/sessions/:id/outcome",
		resource: "session",
		actor: "owner",
		// Cancelling needs no start time, so the session 60 days out takes it.
		body: () => ({ status: "cancelled" }),
		ownStatus: 302,
		snapshot: sessionRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/sessions/:id/move",
		resource: "session",
		actor: "owner",
		// The test studios' timezone; a day after the seeded session.
		body: () => ({
			date: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 61 })
				.toFormat("yyyy-MM-dd"),
			startTime: "13:00",
			hours: "2",
		}),
		ownStatus: 302,
		snapshot: sessionRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/sessions",
		resource: "sessionProject",
		actor: "owner",
		// The studio's own artist, two days after its seeded session.
		body: (own) => ({
			sessionKind: "tattoo",
			sessionArtistId: own.artistProfile.id,
			date: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 62 })
				.toFormat("yyyy-MM-dd"),
			startTime: "10:00",
			hours: "2",
		}),
		ownStatus: 302,
		snapshot: sessionRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/messages",
		actor: "owner",
		ownStatus: 200,
		snapshot: templateRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/messages",
		actor: "owner",
		// Every default but the quote: A's control stores the quote and drops
		// its seeded aftercare text.
		body: () => ({
			...DEFAULT_TEMPLATES,
			quote: "Hi {client_name}, your quote: {price}.",
		}),
		ownStatus: 302,
		snapshot: templateRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/inbox/:id/contacted",
		resource: "newInquiry",
		actor: "owner",
		body: () => ({ channel: "whatsapp", kind: "inquiry_received" }),
		ownStatus: 302,
		snapshot: inboxRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/alerts",
		actor: "owner",
		ownStatus: 200,
		snapshot: alertRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/alerts/read",
		actor: "owner",
		ownStatus: 302,
		snapshot: alertRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/alerts/:id/open",
		resource: "alert",
		actor: "owner",
		ownStatus: 302,
		snapshot: alertRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/members",
		actor: "owner",
		ownStatus: 200,
		snapshot: memberRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/members/invitations",
		actor: "owner",
		body: () => ({ email: "new-member@example.com", role: "artist" }),
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/members/invitations/:id/renew",
		resource: "invitation",
		actor: "owner",
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/settings/members/invitations/:id",
		resource: "invitation",
		actor: "owner",
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/members/:id/role",
		resource: "artistMembership",
		actor: "owner",
		body: () => ({ role: "owner" }),
		ownStatus: 302,
		snapshot: memberRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/settings/members/:id",
		resource: "artistMembership",
		actor: "owner",
		ownStatus: 302,
		snapshot: memberRows,
	},
];
