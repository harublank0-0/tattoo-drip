import logger from "@adonisjs/core/services/logger";
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import Client from "#modules/clients/models/client";
import TattooProject from "#modules/projects/models/tattoo_project";
import Tenant from "#modules/tenancy/models/tenant";

/** A fixed demo phone, so a second run reuses the client. */
const DEMO_PHONE = "+9779800000001";

/**
 * Development only: gives every tenant without a project a demo client and
 * a `reviewing` project, and prints each project page's path, so the quote
 * builder can be tried before TAT-46 lets staff create projects. Run it as
 * the owner role, which row-level security does not apply to:
 * `pnpm seed:dev`.
 */
export default class DemoProjectSeeder extends BaseSeeder {
	static environment = ["development"];

	async run() {
		const client = this.client;
		for (const tenant of await Tenant.query({ client })) {
			const existing = await TattooProject.query({ client })
				.where("tenant_id", tenant.id)
				.first();
			const project =
				existing ??
				(await TattooProject.create(
					{
						tenantId: tenant.id,
						clientId: (await demoClient(tenant, client)).id,
						brief: "Demo: a small fine-line moth on the forearm",
						status: "reviewing",
					},
					{ client },
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
			{ client },
		)
	);
}
