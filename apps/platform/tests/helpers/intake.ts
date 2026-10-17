import type { ApiClient } from "@japa/api-client";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { testImages } from "#tests/helpers/images";
import { inTenant } from "#tests/helpers/tenants";

/**
 * A complete intake form's text fields as a browser sends them: strings,
 * with the phone typed nationally ("9812345678" is stored +9779812345678).
 */
export function intakeFields(
	over: Record<string, string> = {},
): Record<string, string> {
	return {
		idea: "A fine-line peony with two leaves",
		placement: "Left forearm",
		approximateSize: "About 10 cm",
		preferredDates: "Any weekday in November",
		sourceChannel: "instagram",
		contactName: "Maya Gurung",
		contactPhone: "9812345678",
		...over,
	};
}

export type Upload = { name: string; type: string; data: Buffer };

/** A small PNG reference image. */
export async function png(
	name = "reference.png",
	width = 300,
	height = 200,
): Promise<Upload> {
	return { name, type: "image/png", data: await testImages.png(width, height) };
}

/**
 * POST /api/v1/tenants/:slug/inquiries as multipart: the fields, then each
 * upload as its own `referenceImages` part. Not sent yet, so a test can add
 * more (`.file(...)`, `.header(...)`) before awaiting it.
 */
export function postInquiry(
	client: ApiClient,
	slug: string,
	fields: Record<string, string>,
	uploads: Upload[] = [],
) {
	const request = client
		.post(`/api/v1/tenants/${slug}/inquiries`)
		.fields(fields);
	for (const upload of uploads) {
		request.file("referenceImages", upload.data, {
			filename: upload.name,
			contentType: upload.type,
		});
	}
	return request;
}

/** What an intake can change in a studio: its clients (every column), inquiries and reference images. */
export function intakeRows(target: { tenant: { id: string } }) {
	return inTenant(target.tenant, async () => ({
		clients: (await Client.query().orderBy("id")).map((row) => row.serialize()),
		inquiries: (await Inquiry.query().orderBy("id")).map((row) => row.id),
		referenceImages: (await ReferenceImage.query().orderBy("id")).map(
			(row) => row.id,
		),
	}));
}
