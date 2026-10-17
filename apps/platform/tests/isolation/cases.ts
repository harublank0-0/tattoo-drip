import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import PaymentMethod from "#modules/payments/models/payment_method";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import Tenant from "#modules/tenancy/models/tenant";
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
		| "newInquiry"
		| "client";
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
		method: "GET",
		pattern: "/t/:tenant/projects",
		actor: "owner",
		ownStatus: 200,
		snapshot: projectRows,
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
];
