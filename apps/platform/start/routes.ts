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
import { middleware } from "#start/kernel";

router.on("/").renderInertia("home", {}).as("home");

router
	.group(() => {
		router.get("signup", [controllers.NewAccount, "create"]);
		router.post("signup", [controllers.NewAccount, "store"]);

		router.get("login", [controllers.Session, "create"]);
		router.post("login", [controllers.Session, "store"]);
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
			})
			.prefix("/inbox")
			.use(middleware.role({ allow: ["owner"] }));

		/**
		 * Projects: owners, and the artist assigned to the project
		 * (ProjectService.findFor gives anyone else a 404). Every projects
		 * route goes in this group (a test checks).
		 */
		router
			.group(() => {
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
			})
			.prefix("/projects")
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
