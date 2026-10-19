import logger from "@adonisjs/core/services/logger";
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import Client from "#modules/clients/models/client";
import TattooProject from "#modules/projects/models/tattoo_project";
import Tenant from "#modules/tenancy/models/tenant";

/** A fixed demo phone, so a second run reuses the client. */
const DEMO_PHONE = "+9779800000001";

/**
 * Development only: gives every tenant a demo client and a `reviewing`
 * project for it, whatever else the tenant already has, and prints each
 * project page's path, so the quote builder can be tried without creating
 * one by hand. A tenant whose demo client already has a project is skipped,
 * so a second run adds nothing. Run it as the owner role, which row-level
 * security does not apply to: `pnpm seed:dev`.
 */
export default class DemoProjectSeeder extends BaseSeeder {
	static environment = ["development"];

	async run() {
		const client = this.client;
		// Writes pass `{ connection }`, not `{ client }`: a model instance keeps
		// only a transaction client, so a plain `{ client }` would silently
		// write as the app role and fail row-level security. Queries
		// (`Model.query({ client })`) do honor the client.
		for (const tenant of await Tenant.query({ client })) {
			const demo = await demoClient(tenant, client);
			const existing = await TattooProject.query({ client })
				.where("tenant_id", tenant.id)
				.where("client_id", demo.id)
				.first();
			const project =
				existing ??
				(await TattooProject.create(
					{
						tenantId: tenant.id,
						clientId: demo.id,
						brief: "Demo: a small fine-line moth on the forearm",
						status: "reviewing",
					},
					{ connection: client.connectionName },
				));
			logger.info(`/t/${tenant.slug}/projects/${project.id}`);
		}
	}
}

async function demoClient(tenant: Tenant, client: DemoProjectSeeder["client"]) {
	const found = await Client.query({ client })
		.where("tenant_id", tenant.id)
		.where("phone", DEMO_PHONE)
		.first();
	return (
		found ??
		Client.create(
			{ tenantId: tenant.id, name: "Demo Client", phone: DEMO_PHONE },
			{ connection: client.connectionName },
		)
	);
}
