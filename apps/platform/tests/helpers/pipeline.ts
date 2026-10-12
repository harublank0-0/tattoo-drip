import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";

type TenantRef = { id: string };

let sequence = 0;
const next = () => ++sequence;

/**
 * A fresh E.164 phone, unique for the whole test run.
 */
export const nextPhone = () => `+97798${String(next()).padStart(8, "0")}`;

type ClientOver = Partial<
	Pick<Client, "name" | "phone" | "email" | "notes" | "anonymizedAt">
>;

/**
 * A client with a unique phone. Call it inside `inTenant(tenant, …)`: the
 * factories use the models, which join the ambient transaction.
 */
export function makeClient(tenant: TenantRef, over: ClientOver = {}) {
	return Client.create({
		tenantId: tenant.id,
		name: `Client ${next()}`,
		phone: nextPhone(),
		...over,
	});
}

/**
 * An artist profile (the pipeline tables link to it). Call it inside
 * `inTenant(tenant, …)`; slugs are unique per tenant.
 */
export function makeArtist(tenant: TenantRef, slug = "sita") {
	return Artist.create({ tenantId: tenant.id, name: "Sita", slug });
}

type InquiryOver = Partial<
	Pick<
		Inquiry,
		| "idea"
		| "placement"
		| "approximateSize"
		| "preferredDates"
		| "preferredArtistId"
		| "budget"
		| "sourceChannel"
		| "contactName"
		| "contactPhone"
		| "contactEmail"
		| "status"
		| "decidedAt"
		| "anonymizedAt"
	>
>;

/**
 * A new inquiry from `client`, with the client's contact as its snapshot.
 */
export function makeInquiry(
	tenant: TenantRef,
	client: Client,
	over: InquiryOver = {},
) {
	return Inquiry.create({
		tenantId: tenant.id,
		clientId: client.id,
		idea: "A small fine-line moth",
		placement: "Forearm",
		approximateSize: "8 cm",
		preferredDates: "Any weekday in November",
		sourceChannel: "instagram",
		contactName: client.name,
		contactPhone: client.phone,
		contactEmail: client.email,
		status: "new",
		...over,
	});
}
