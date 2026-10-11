import type { ApplicationService } from "@adonisjs/core/types";
import type { Database } from "@adonisjs/lucid/database";
import { Adapter, BaseModel } from "@adonisjs/lucid/orm";
import type {
	LucidModel,
	ModelAdapterOptions,
} from "@adonisjs/lucid/types/model";
import { currentClient } from "#services/db_context";

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
	}
}
