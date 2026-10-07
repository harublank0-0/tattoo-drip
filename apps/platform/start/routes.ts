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

router
	.group(() => {
		router.on("/dashboard").renderInertia("dashboard", {}).as("dashboard");
		router.post("logout", [controllers.Session, "destroy"]);

		router.get("onboarding", [controllers.Onboarding, "create"]);
		router.post("onboarding", [controllers.Onboarding, "store"]);
	})
	.use(middleware.auth());
