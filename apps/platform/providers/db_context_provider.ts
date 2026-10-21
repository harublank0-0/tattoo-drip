import type { ApplicationService } from "@adonisjs/core/types";
import type { Database } from "@adonisjs/lucid/database";
import { Adapter, BaseModel } from "@adonisjs/lucid/orm";
import type {
	LucidModel,
	ModelAdapterOptions,
} from "@adonisjs/lucid/types/model";
import { currentClient } from "#services/db_context";
import { assertRestrictedDbRole } from "#services/db_role_guard";

/**
 * Lucid's adapter, except that inside a request or job transaction every
 * model query uses that transaction. Instances loaded before it (such as
 * `auth.user`) keep the plain pool client in `$options.client`, so a plain
 * client is replaced; an explicit transaction client still wins, and
 * models on another connection are left alone.
 */
export class ContextAdapter extends Adapter {
	constructor(private database: Database) {
		super(database);
	}

	override modelConstructorClient(
		modelConstructor: LucidModel,
		options?: ModelAdapterOptions,
	) {
		const ambient = currentClient();
		if (ambient && !options?.client?.isTransaction) {
			const connection =
				options?.connection ??
				modelConstructor.connection ??
				this.database.primaryConnectionName;
			if (connection === ambient.connectionName) return ambient;
		}
		return super.modelConstructorClient(modelConstructor, options);
	}
}

/** The ace commands that refuse to run as a role that bypasses RLS. */
const GUARDED_COMMANDS = new Set(["queue:work", "metrics:pilot"]);

export default class DbContextProvider {
	constructor(protected app: ApplicationService) {}

	/**
	 * After the database provider, which installs the stock adapter.
	 */
	async boot() {
		const db = await this.app.container.make("lucid.db");
		BaseModel.$adapter = new ContextAdapter(db);

		// Ace starts the app before it knows which command runs (and
		// bin/console.ts has already consumed process.argv), so the worker is
		// recognized once its command has loaded. That is still before the
		// command is created, so a refusal ends the process like a failed boot.
		// metrics:pilot (TAT-70) is guarded too: it reads each studio's numbers
		// on the default connection and relies on RLS to keep them its own.
		if (this.app.getEnvironment() === "console") {
			const ace = await this.app.container.make("ace");
			ace.loaded(async (command) => {
				if (GUARDED_COMMANDS.has(command.commandName)) await this.assertRole();
			});
		}
	}

	/**
	 * Refuses to serve, work or test as a role that bypasses RLS: the web
	 * server (`node ace serve`, bin/server.ts) and the test runner are guarded
	 * here, the worker (`queue:work`) and `metrics:pilot` by the hook boot()
	 * registers. This is start(), not ready(): the HTTP server and the test
	 * run begin between the two, and a ready() refusal would leave the server
	 * listening.
	 *
	 * Exempt: `node ace codegen`, which warms the app up in the web environment
	 * in "warmup" mode (it never starts, and skips provider shutdown, so a
	 * pooled connection would keep it alive), and every other ace command
	 * (build, list:routes, ...) because they run in the console environment.
	 * Migrations run as the owner on purpose. A "warmup" app cannot serve or
	 * run tests: Application.start() throws for it.
	 */
	async start() {
		if (this.app.getMode() !== "run") return;
		const environment = this.app.getEnvironment();
		if (environment === "web" || environment === "test")
			await this.assertRole();
	}

	private async assertRole() {
		const db = await this.app.container.make("lucid.db");
		try {
			await assertRestrictedDbRole(db.connection());
		} catch (error) {
			// A refusal ends in an error, not a clean shutdown, and the open
			// pool and dev tooling would keep the process alive.
			await this.app.terminate();
			throw error;
		}
	}
}
