import logger from "@adonisjs/core/services/logger";
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import sharp from "sharp";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import ImageService from "#modules/media/services/image_service";
import Tenant from "#modules/tenancy/models/tenant";

/** Three demo inquiries; fixed phones, so a second run reuses the clients. */
const DEMOS = [
	{
		phone: "+9779800000011",
		name: "Demo Sita",
		idea: "A small koi swimming up the calf, black and grey with a little red.",
		placement: "Calf",
		size: "About 12 cm",
		dates: "Weekends in November",
		budget: null,
		namesArtist: true,
		colours: [
			[180, 120, 200],
			[90, 160, 200],
		],
	},
	{
		phone: "+9779800000012",
		name: "Demo Ram",
		idea: "Mountain outline across the shoulder blades, fine line.",
		placement: "Upper back",
		size: "Palm-sized",
		dates: "Any evening",
		budget: "NPR 20,000",
		namesArtist: false,
		colours: [[230, 170, 90]],
	},
	{
		phone: "+9779800000013",
		name: "Demo Gita",
		idea: "Tiny lotus on the ankle, matching my sister's.",
		placement: "Ankle",
		size: "5 cm",
		dates: "Early December",
		budget: null,
		namesArtist: false,
		colours: [
			[120, 190, 140],
			[200, 100, 100],
		],
	},
] as const;

/**
 * Development only: gives every tenant the three demo inquiries below (`new`,
 * with generated placeholder references stored like real uploads), whatever
 * else the tenant already has. A demo whose phone already has an inquiry in
 * that tenant, accepted or not, is skipped, so a second run adds nothing.
 * Run as the owner role: `pnpm seed:dev`.
 */
export default class DemoInquiriesSeeder extends BaseSeeder {
	static environment = ["development"];

	async run() {
		const client = this.client;
		// Writes pass `{ connection }`, not `{ client }`: a model instance keeps
		// only a transaction client, so a plain `{ client }` would silently
		// write as the app role and fail row-level security. Queries
		// (`Model.query({ client })`) do honor the client.
		const images = new ImageService();
		for (const tenant of await Tenant.query({ client })) {
			const artist = await Artist.query({ client })
				.where("tenant_id", tenant.id)
				.orderBy("name")
				.first();
			for (const demo of DEMOS) {
				const person =
					(await Client.query({ client })
						.where("tenant_id", tenant.id)
						.where("phone", demo.phone)
						.first()) ??
					(await Client.create(
						{ tenantId: tenant.id, name: demo.name, phone: demo.phone },
						{ connection: client.connectionName },
					));
				const existing = await Inquiry.query({ client })
					.where("tenant_id", tenant.id)
					.where("client_id", person.id)
					.first();
				if (existing) {
					continue;
				}
				const inquiry = await Inquiry.create(
					{
						tenantId: tenant.id,
						clientId: person.id,
						idea: demo.idea,
						placement: demo.placement,
						approximateSize: demo.size,
						preferredDates: demo.dates,
						preferredArtistId: demo.namesArtist ? (artist?.id ?? null) : null,
						budget: demo.budget,
						sourceChannel: "instagram",
						contactName: person.name,
						contactPhone: person.phone,
						contactEmail: null,
						status: "new",
					},
					{ connection: client.connectionName },
				);
				for (const [position, [r, g, b]] of demo.colours.entries()) {
					const bytes = await sharp({
						create: {
							width: 640,
							height: 480,
							channels: 3,
							background: { r, g, b },
						},
					})
						.jpeg()
						.toBuffer();
					const stored = await images.storeBytes(bytes, {
						tenant,
						purpose: "reference_image",
					});
					await ReferenceImage.create(
						{
							tenantId: tenant.id,
							inquiryId: inquiry.id,
							imageKey: stored.key,
							width: stored.width,
							height: stored.height,
							position,
						},
						{ connection: client.connectionName },
					);
				}
			}
			logger.info(`/t/${tenant.slug}/inbox`);
		}
	}
}
