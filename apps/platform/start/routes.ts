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
 * on every request and 404s anyone else; read the tenant from ctx.tenant.
 */
router
	.group(() => {
		router.on("/").renderInertia("dashboard", {}).as("tenant.dashboard");
	})
	.prefix("/t/:tenant")
	.use([middleware.auth(), middleware.tenant()]);

router
	.group(() => {
		router
			.on("/dashboard")
			.renderInertia("dashboard", {})
			.as("dashboard")
			.use(middleware.onboarded());
		router.post("logout", [controllers.Session, "destroy"]);

		router.get("onboarding", [controllers.Onboarding, "create"]);
		router.post("onboarding", [controllers.Onboarding, "store"]);
	})
	.use(middleware.auth());
