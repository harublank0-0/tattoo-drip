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
		if (this.app.getEnvironment() === "console") {
			const ace = await this.app.container.make("ace");
			ace.loaded(async (command) => {
				if (command.commandName === "queue:work") await this.assertRole();
			});
		}
	}

	/**
	 * Refuses to serve or test as a role that bypasses RLS. This is start(),
	 * not ready(): the HTTP server and the test run begin between the two,
	 * and a ready() refusal would leave the server listening. The worker is
	 * guarded by the hook boot() registers. Other ace commands (codegen,
	 * build, migrations) skip it: migrations run as the owner on purpose.
	 */
	async start() {
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
