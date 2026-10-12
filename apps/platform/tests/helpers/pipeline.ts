import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import Payment from "#modules/payments/models/payment";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";

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

type ProjectOver = Partial<
	Pick<
		TattooProject,
		"artistId" | "inquiryId" | "brief" | "notes" | "status" | "lastContactedAt"
	>
>;

/**
 * A project for `client`. Pass `inquiryId` for one accepted from an inquiry.
 */
export function makeProject(
	tenant: TenantRef,
	client: Client,
	over: ProjectOver = {},
) {
	return TattooProject.create({
		tenantId: tenant.id,
		clientId: client.id,
		brief: "A small fine-line moth on the forearm",
		status: "reviewing",
		...over,
	});
}

type ReferenceImageOver = Partial<
	Pick<
		ReferenceImage,
		"inquiryId" | "projectId" | "imageKey" | "width" | "height" | "position"
	>
>;

/**
 * A reference image. Pass `inquiryId` and/or `projectId`: with neither the
 * database refuses it, which a test relies on.
 */
export function makeReferenceImage(
	tenant: TenantRef,
	over: ReferenceImageOver = {},
) {
	return ReferenceImage.create({
		tenantId: tenant.id,
		imageKey: `tenants/${tenant.id}/reference_image/${randomUUID()}.webp`,
		width: 800,
		height: 600,
		position: 0,
		...over,
	});
}

type QuoteOver = Partial<
	Pick<
		Quote,
		| "version"
		| "kind"
		| "fixedPrice"
		| "hourlyRate"
		| "estimatedMinutes"
		| "depositAmount"
		| "currency"
		| "expiresAt"
	>
>;

/**
 * A fixed-price quote (NPR 15,000 with a NPR 3,000 deposit, in paisa) valid
 * for two weeks. For an hourly one pass `kind: "hourly"`, `fixedPrice: null`,
 * `hourlyRate` and `estimatedMinutes`.
 */
export function makeQuote(
	tenant: TenantRef,
	project: TattooProject,
	over: QuoteOver = {},
) {
	return Quote.create({
		tenantId: tenant.id,
		projectId: project.id,
		version: 1,
		kind: "fixed",
		fixedPrice: 1_500_000,
		depositAmount: 300_000,
		currency: "NPR",
		expiresAt: DateTime.utc().plus({ days: 14 }),
		...over,
	});
}

type PaymentOver = Partial<
	Pick<
		Payment,
		| "kind"
		| "amount"
		| "currency"
		| "method"
		| "proofImageKey"
		| "proofImageWidth"
		| "proofImageHeight"
		| "status"
		| "verifiedByUserId"
		| "verifiedAt"
	>
>;

/**
 * A submitted cash deposit of NPR 3,000 (300,000 paisa). To make a decided
 * payment pass `status`, `verifiedAt` and `verifiedByUserId` together: the
 * database checks they agree.
 */
export function makePayment(
	tenant: TenantRef,
	project: TattooProject,
	over: PaymentOver = {},
) {
	return Payment.create({
		tenantId: tenant.id,
		projectId: project.id,
		kind: "deposit",
		amount: 300_000,
		currency: "NPR",
		method: "cash",
		status: "submitted",
		...over,
	});
}
