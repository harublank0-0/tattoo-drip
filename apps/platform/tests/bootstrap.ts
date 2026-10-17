import { rm } from "node:fs/promises";
import { authApiClient } from "@adonisjs/auth/plugins/api_client";
import { authBrowserClient } from "@adonisjs/auth/plugins/browser_client";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { inertiaApiClient } from "@adonisjs/inertia/plugins/api_client";
import limiter from "@adonisjs/limiter/services/main";
import { dbAssertions } from "@adonisjs/lucid/plugins/db";
import { sessionApiClient } from "@adonisjs/session/plugins/api_client";
import { sessionBrowserClient } from "@adonisjs/session/plugins/browser_client";
import { shieldApiClient } from "@adonisjs/shield/plugins/api_client";
import { apiClient } from "@japa/api-client";
import { assert } from "@japa/assert";
import { browserClient } from "@japa/browser-client";
import { pluginAdonisJS } from "@japa/plugin-adonisjs";
import type { Config } from "@japa/runner/types";

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config["plugins"] = [
	assert(),
	// HTTP requests against the test server: client.get("/login"), plus
	// .withCsrfToken(), .withSession() and .loginAs(user) from the plugins below.
	apiClient(),
	pluginAdonisJS(app),
	dbAssertions(app),
	sessionApiClient(app),
	shieldApiClient(),
	authApiClient(app),
	// .withInertia() requests and response.inertiaProps / assertInertiaComponent.
	inertiaApiClient(app),
	browserClient({ runInSuites: ["browser"] }),
	sessionBrowserClient(app),
	authBrowserClient(app),
];

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
/**
 * Files written to the Drive disks during tests (tmp/storage, see
 * config/drive.ts), removed before and after the run.
 */
const clearTestStorage = () =>
	rm(app.tmpPath("storage"), { recursive: true, force: true });

/**
 * A test's request runs in a savepoint on the test's one connection, so a
 * query that escapes the request transaction (db.from, db.rawQuery,
 * db.transaction, Vine's unique and exists rules) still sees the request's
 * tenant settings and passes. In production it takes a second pooled
 * connection with no settings, sees nothing, and needs two pool slots per
 * request. Make it fail here too: while a request or job transaction is open,
 * asking the db service for the primary connection throws. Other connections
 * (`owner`) and calls outside any transaction are untouched, and so are the
 * models, `dbClient()` and `withTransaction`, which never ask for it.
 */
let removeTripwire: (() => void) | undefined;

async function installDbTripwire() {
	const { currentClient } = await import("#services/db_context");
	const db = await app.container.make("lucid.db");
	const original = db.connection.bind(db);
	const guarded: typeof db.connection = (connection, options) => {
		if (
			(connection === undefined || connection === db.primaryConnectionName) &&
			currentClient()
		) {
			throw new Error(
				"db.connection() called inside a request/job transaction: use withTransaction/dbClient()/models; in production this opens a second connection without the tenant settings",
			);
		}
		return original(connection, options);
	};
	db.connection = guarded;
	removeTripwire = () => {
		// Drops the own property, so the class's method shows through again.
		delete (db as Partial<typeof db>).connection;
	};
}

/**
 * Rate limits use the memory store in tests (config/limiter.ts). It is
 * emptied before every test, so one test's attempts never refuse another's.
 * Only the memory store: clearing the database store would TRUNCATE
 * rate_limits, which the app role may not do.
 */
const resetRateLimits = () => limiter.clear(["memory"]);

export const runnerHooks: Required<Pick<Config, "setup" | "teardown">> = {
	setup: [clearTestStorage, installDbTripwire],
	teardown: [clearTestStorage, () => removeTripwire?.()],
};

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config["configureSuite"] = (suite) => {
	if (["browser", "functional", "e2e"].includes(suite.name)) {
		suite.onGroup((group) =>
			group.tap((groupTest) => groupTest.setup(resetRateLimits)),
		);
		suite.onTest((suiteTest) => suiteTest.setup(resetRateLimits));
		return suite.setup(async () => {
			await import("#tests/support/test_routes");
			return testUtils.httpServer().start();
		});
	}
};
