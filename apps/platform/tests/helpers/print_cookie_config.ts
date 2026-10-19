/**
 * Boots the app (no server, no preloads, no database) and prints how its
 * real config files set cookies, as one `COOKIE_CONFIG=<json>` line. Japa
 * runs with NODE_ENV=test, so production's half of the cookie policy
 * (TAT-9) can only be seen in a process of its own:
 * production_boot.spec.ts runs this with NODE_ENV=production.
 *
 * It prints the resolved session config and the HTTP cookie defaults, and
 * the Set-Cookie lines the real serializer writes from them for what the
 * app sets: the session cookie (as `session.commit()` does), the cookie
 * store's data cookie, Shield's XSRF-TOKEN and the auth guard's clearing of
 * `remember_web`. A `__Host-` cookie with a Domain or without Secure makes
 * the serializer throw, which fails this process.
 */

await import("reflect-metadata");
const { Ignitor, prettyPrintError } = await import("@adonisjs/core/ignitor");
const { configProvider } = await import("@adonisjs/core");
const { HttpContextFactory, ResponseFactory } = await import(
	"@adonisjs/core/factories/http"
);

const APP_ROOT = new URL("../../", import.meta.url);

const IMPORTER = (filePath: string) => {
	if (filePath.startsWith("./") || filePath.startsWith("../")) {
		return import(new URL(filePath, APP_ROOT).href);
	}
	return import(filePath);
};

type CookieOptions = Record<string, unknown>;

try {
	const app = new Ignitor(APP_ROOT, { importer: IMPORTER })
		.tap((booting) => {
			// As bin/server.ts and bin/console.ts do: the environment is read
			// (and NODE_ENV settled) before the config files load.
			booting.booting(async () => {
				await import("#start/env");
			});
		})
		.createApp("web");
	await app.init();
	await app.boot();

	const session = (await configProvider.resolve(
		app,
		app.config.get("session"),
	)) as unknown as {
		cookieName: string;
		cookie: CookieOptions;
		stores: Record<string, (ctx: unknown, config: unknown) => unknown>;
	};
	const http = app.config.get<{ cookie: CookieOptions }>("app.http");
	const shield = app.config.get<{
		csrf: { cookieOptions?: CookieOptions };
	}>("shield");

	const response = new ResponseFactory()
		.merge({ config: { cookie: http.cookie } })
		.create();
	const ctx = new HttpContextFactory().merge({ response }).create();

	// What session.commit() does with the session id.
	response.cookie(session.cookieName, "a-session-id", session.cookie);
	// The cookie store's data cookie, which is named by the session id.
	(
		session.stores.cookie(ctx, session) as {
			write(sessionId: string, values: object): void;
		}
	).write("a-store-id", { a: 1 });
	// What Shield's CSRF guard does on every dashboard response.
	response.encryptedCookie("XSRF-TOKEN", "a-token", {
		...shield.csrf.cookieOptions,
		httpOnly: false,
	});
	// What the auth guard does on every login and logout.
	response.clearCookie("remember_web");

	const [sessionLine, dataLine, xsrfLine, clearedLine] = [
		response.getHeader("set-cookie"),
	]
		.flat()
		.map(String);

	process.stdout.write(
		`COOKIE_CONFIG=${JSON.stringify({
			inProduction: app.inProduction,
			session: { cookieName: session.cookieName, cookie: session.cookie },
			http: { cookie: http.cookie },
			lines: {
				session: sessionLine,
				data: dataLine,
				xsrf: xsrfLine,
				cleared: clearedLine,
			},
		})}\n`,
		() => process.exit(0),
	);
} catch (error) {
	process.exitCode = 1;
	prettyPrintError(error);
	process.exit(1);
}
