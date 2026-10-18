/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from "@adonisjs/core/services/router";
import { controllers } from "#generated/controllers";
import { ARTIST_SLUG } from "#modules/artists/validators/artist";
import { ACCOUNT_TOKEN } from "#modules/identity/account_tokens";
import { DEPOSIT_TOKEN } from "#modules/payments/deposit_links";
import { middleware } from "#start/kernel";
import {
	throttleAccountLinks,
	throttleResetEmail,
	throttleResetRequest,
	throttleSignup,
} from "#start/limiter";

router.on("/").renderInertia("home", {}).as("home");

router
	.group(() => {
		router.get("signup", [controllers.NewAccount, "create"]);
		router
			.post("signup", [controllers.NewAccount, "store"])
			.use(throttleSignup);

		router.get("login", [controllers.Session, "create"]);
		router.post("login", [controllers.Session, "store"]);

		/**
		 * Password reset (TAT-18). Asking for a link counts per client
		 * address, then per address named; the link and the new password
		 * count per client address. The link's token lives in the session,
		 * never in a page's URL.
		 */
		router
			.get("forgot-password", [controllers.PasswordReset, "create"])
			.as("password_reset.create");
		router
			.post("forgot-password", [controllers.PasswordReset, "store"])
			.use([throttleResetRequest, throttleResetEmail])
			.as("password_reset.store");
		router
			.get("forgot-password/sent", [controllers.PasswordReset, "sent"])
			.as("password_reset.sent");
		router
			.get("reset-password/:token", [controllers.PasswordReset, "link"])
			.where("token", ACCOUNT_TOKEN)
			.use(throttleAccountLinks)
			.as("password_reset.link");
		router
			.get("reset-password", [controllers.PasswordReset, "edit"])
			.as("password_reset.edit");
		router
			.post("reset-password", [controllers.PasswordReset, "update"])
			.use(throttleAccountLinks)
			.as("password_reset.update");
	})
	.use(middleware.guest());

/**
 * Pages of one tenant. The tenant middleware checks the user's membership
 * on every request and 404s anyone else; read the tenant with
 * tenantContext(ctx). Every tenant route goes in this group (a test checks).
 */
router
	.group(() => {
		router
			.get("/", [controllers.Dashboard, "tenantHome"])
			.as("tenant.dashboard");

		/**
		 * Studio settings, owners only: artists get the same 404 as an
		 * unknown URL. Every settings route goes in this group (a test
		 * checks).
		 */
		router
			.group(() => {
				router
					.get("/", ({ params, response }) =>
						response
							.redirect()
							.toRoute("tenant.settings.profile", { tenant: params.tenant }),
					)
					.as("tenant.settings");
				router
					.get("profile", [controllers.StudioProfile, "show"])
					.as("tenant.settings.profile");
				router
					.put("profile", [controllers.StudioProfile, "update"])
					.as("tenant.settings.profile.update");
				router
					.put("slug", [controllers.StudioSlug, "update"])
					.as("tenant.settings.slug.update");
				router
					.get("payments", [controllers.PaymentMethods, "index"])
					.as("tenant.settings.payments");
				router
					.put("deposits", [controllers.DepositSettings, "update"])
					.as("tenant.settings.deposits.update");
				router
					.get("payments/new", [controllers.PaymentMethods, "create"])
					.as("tenant.settings.payments.create");
				router
					.post("payments", [controllers.PaymentMethods, "store"])
					.as("tenant.settings.payments.store");
				router
					.put("payments/:id", [controllers.PaymentMethods, "update"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.update");
				router
					.get("payments/:id/edit", [controllers.PaymentMethods, "edit"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.edit");
				router
					.post("payments/:id/move", [controllers.PaymentMethods, "move"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.move");
				router
					.delete("payments/:id", [controllers.PaymentMethods, "destroy"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.destroy");
				// The studio's chat messages (TAT-52). The kind is a body field
				// per message, never a path segment.
				router
					.get("messages", [controllers.MessageTemplates, "show"])
					.as("tenant.settings.messages");
				router
					.put("messages", [controllers.MessageTemplates, "update"])
					.as("tenant.settings.messages.update");
			})
			.prefix("/settings")
			.use(middleware.role({ allow: ["owner"] }));

		/**
		 * Artist profiles, owners only for now: artists get the same 404 as
		 * an unknown URL. TAT-30 opens this area to artists by changing the
		 * allow list. Every artists route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router.get("/", [controllers.Artists, "index"]).as("tenant.artists");
				router
					.get("new", [controllers.Artists, "create"])
					.as("tenant.artists.create");
				router
					.post("/", [controllers.Artists, "store"])
					.as("tenant.artists.store");
				router
					.get(":id/edit", [controllers.Artists, "edit"])
					.where("id", router.matchers.uuid())
					.as("tenant.artists.edit");
				router
					.put(":id", [controllers.Artists, "update"])
					.where("id", router.matchers.uuid())
					.as("tenant.artists.update");
				router
					.delete(":id", [controllers.Artists, "destroy"])
					.where("id", router.matchers.uuid())
					.as("tenant.artists.destroy");
			})
			.prefix("/artists")
			.use(middleware.role({ allow: ["owner"] }));

		/**
		 * The inquiry inbox: owners only (reference images are private to
		 * owners until a project is assigned). Every inbox route goes in this
		 * group (a test checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.Inquiries, "index"])
					.as("tenant.inbox.index");
				router
					.get(":id", [controllers.Inquiries, "show"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.show");
				router
					.post(":id/accept", [controllers.Inquiries, "accept"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.accept");
				router
					.post(":id/decline", [controllers.Inquiries, "decline"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.decline");
				// The inquiry page's chat links record the contact (TAT-52).
				router
					.post(":id/contacted", [controllers.Inquiries, "contacted"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.contacted.store");
			})
			.prefix("/inbox")
			.use(middleware.role({ allow: ["owner"] }));

		/**
		 * Clients: owners only (the role table gives artists their assigned
		 * projects, not the studio's client list). Every clients route goes
		 * in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.Clients, "index"])
					.as("tenant.clients.index");
				router
					.get(":id", [controllers.Clients, "show"])
					.where("id", router.matchers.uuid())
					.as("tenant.clients.show");
				router
					.get(":id/edit", [controllers.Clients, "edit"])
					.where("id", router.matchers.uuid())
					.as("tenant.clients.edit");
				router
					.put(":id", [controllers.Clients, "update"])
					.where("id", router.matchers.uuid())
					.as("tenant.clients.update");
			})
			.prefix("/clients")
			.use(middleware.role({ allow: ["owner"] }));

		/**
		 * Projects: owners, and the artist assigned to the project
		 * (ProjectService.findFor gives anyone else a 404). Booking a session
		 * (new, store) is open to both; BookingService decides which artists a
		 * member may book. Every projects route goes in this group (a test
		 * checks).
		 */
		router
			.group(() => {
				router
					.get("new", [controllers.Bookings, "create"])
					.as("tenant.projects.create");
				router
					.post("/", [controllers.Bookings, "store"])
					.as("tenant.projects.store");
				router
					.get("/", [controllers.Projects, "index"])
					.as("tenant.projects.index");
				router
					.get(":id", [controllers.Projects, "show"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.show");
				router
					.post(":id/quotes", [controllers.Quotes, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.quotes.store");
				router
					.post(":id/quotes/accept", [controllers.Quotes, "accept"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.quotes.accept");
				// A direct booking's price, once (TAT-66).
				router
					.post(":id/price", [controllers.Quotes, "price"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.price.store");
				router
					.post(":id/moves", [controllers.ProjectChanges, "move"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.moves.store");
				router
					.put(":id/notes", [controllers.ProjectChanges, "notes"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.notes.update");
				router
					.post(":id/contacted", [controllers.ProjectChanges, "contacted"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.contacted.store");
				router
					.put(":id/artist", [controllers.ProjectChanges, "artist"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.artist.update");
				// A session on this project (TAT-85): owners, and the assigned
				// artist with their own profile (SessionService.scheduleFor).
				router
					.post(":id/sessions", [controllers.ProjectSessions, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.sessions.store");
				// Owners only: DepositLinkService gives anyone else a 404 (TAT-65).
				router
					.post(":id/deposit-link", [controllers.DepositLinks, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.deposit_link.store");
				// Owners only: PaymentService gives anyone else a 404 (TAT-66).
				router
					.post(":id/payments", [controllers.Payments, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.payments.store");
				router
					.post(":id/refunds", [controllers.Payments, "refund"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.refunds.store");
				router
					.post(":id/deposit-outcome", [controllers.Payments, "outcome"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.deposit_outcome.store");
			})
			.prefix("/projects")
			.use(middleware.role({ allow: ["owner", "artist"] }));

		/**
		 * Decisions on one payment (TAT-66): owners only, and
		 * PaymentService.findFor checks again. Every payments route goes in
		 * this group (a test checks).
		 */
		router
			.group(() => {
				router
					.post(":id/verify", [controllers.Payments, "verify"])
					.where("id", router.matchers.uuid())
					.as("tenant.payments.verify");
				router
					.post(":id/reject", [controllers.Payments, "reject"])
					.where("id", router.matchers.uuid())
					.as("tenant.payments.reject");
				router
					.post(":id/reverse", [controllers.Payments, "reverse"])
					.where("id", router.matchers.uuid())
					.as("tenant.payments.reverse");
			})
			.prefix("/payments")
			.use(middleware.role({ allow: ["owner"] }));

		/**
		 * One session's outcome and time (TAT-85): owners any session, an
		 * artist only their own on a project assigned to them
		 * (SessionService.findChangeable gives anyone else a 404). Every
		 * sessions route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.post(":id/outcome", [controllers.ProjectSessions, "outcome"])
					.where("id", router.matchers.uuid())
					.as("tenant.sessions.outcome");
				router
					.post(":id/move", [controllers.ProjectSessions, "move"])
					.where("id", router.matchers.uuid())
					.as("tenant.sessions.move");
			})
			.prefix("/sessions")
			.use(middleware.role({ allow: ["owner", "artist"] }));

		/**
		 * The calendar: owners (the whole studio or one artist) and artists
		 * (their own sessions); CalendarService decides what each member
		 * sees. Every calendar route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.Calendar, "index"])
					.as("tenant.calendar.index");
			})
			.prefix("/calendar")
			.use(middleware.role({ allow: ["owner", "artist"] }));

		/**
		 * Each member's own alerts (TAT-52): owners and artists; AlertService
		 * scopes every read and write to the member. Every alerts route goes
		 * in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.Alerts, "index"])
					.as("tenant.alerts.index");
				router
					.post("read", [controllers.Alerts, "readAll"])
					.as("tenant.alerts.read");
				router
					.post(":id/open", [controllers.Alerts, "open"])
					.where("id", router.matchers.uuid())
					.as("tenant.alerts.open");
			})
			.prefix("/alerts")
			.use(middleware.role({ allow: ["owner", "artist"] }));
	})
	.prefix("/t/:tenant")
	.use([middleware.auth(), middleware.dbContext(), middleware.tenant()]);

router
	.group(() => {
		router.get("dashboard", [controllers.Dashboard, "show"]).as("dashboard");
		router.post("logout", [controllers.Session, "destroy"]);

		router.get("onboarding", [controllers.Onboarding, "create"]);
		router.post("onboarding", [controllers.Onboarding, "store"]);
	})
	.use([middleware.auth(), middleware.dbContext()]);

/**
 * The public API (TAT-32): stateless and cookieless (the session, CSRF,
 * auth and Inertia middleware skip /api), CORS open without credentials,
 * { data } and { error } envelopes (#services/public_api_errors). Every /api
 * route goes in this group and runs publicApi first (a test checks). Cache
 * a read with middleware.publicCache(); everything else is no-store. Every
 * request is counted per caller before its body (PublicGateMiddleware,
 * router.use) and a studio's reads after publicTenant (apiLimit, TAT-38).
 */
router
	.group(() => {
		/**
		 * One tenant's public data. The tenant is the path's slug, current or
		 * old, matched exactly; handlers run in its database context. Every
		 * route here needs a case in tests/isolation/public_cases.ts (a test
		 * checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.PublicStudio, "show"])
					.use(middleware.publicCache())
					.as("api.v1.studio");
				// The studio's visible artists (TAT-44). A slug of the wrong shape
				// (uppercase, a dot, one character) is the router's 404 without a
				// query; hidden and deleted artists are the handler's 404.
				router
					.get("/artists", [controllers.PublicArtists, "index"])
					.use(middleware.publicCache())
					.as("api.v1.artists.index");
				router
					.get("/artists/:artist", [controllers.PublicArtists, "show"])
					.where("artist", ARTIST_SLUG)
					.use(middleware.publicCache())
					.as("api.v1.artists.show");
				// The intake (TAT-51). intakeGuard counts the address, checks the
				// bot challenge and counts the studio before its multipart body is
				// read (TAT-55); the controller does the honeypot and the phone count.
				// POST stays no-store.
				router
					.post("/inquiries", [controllers.PublicInquiries, "store"])
					.use(middleware.intakeGuard())
					.as("api.v1.inquiries.store");
				// The deposit page through a link's token (TAT-65): 43 base64url
				// characters, anything else is the router's 404 without a query.
				// Rate-limited per address and per token; never cached.
				router
					.get("/deposits/:token", [controllers.PublicDeposits, "show"])
					.where("token", DEPOSIT_TOKEN)
					.use(middleware.depositThrottle())
					.as("api.v1.deposits.show");
				router
					.post("/deposits/:token", [controllers.PublicDeposits, "store"])
					.where("token", DEPOSIT_TOKEN)
					.use(middleware.depositThrottle())
					.as("api.v1.deposits.store");
			})
			.prefix("/tenants/:tenant")
			.use([
				middleware.publicTenant(),
				middleware.apiLimit({ name: "tenantReads" }),
			]);
	})
	.prefix("/api/v1")
	.use(middleware.publicApi());
