import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import {
	hashToken,
	newReferenceCode,
	newTokenNonce,
	tokenFor,
} from "#modules/payments/deposit_links";
import DepositLink from "#modules/payments/models/deposit_link";
import Payment from "#modules/payments/models/payment";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectSession from "#modules/scheduling/models/project_session";

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
		| "createdAt"
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
		| "artistId"
		| "inquiryId"
		| "brief"
		| "notes"
		| "status"
		| "lastContactedAt"
		| "createdAt"
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
		| "correctsPaymentId"
		| "note"
		| "createdAt"
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

type DepositLinkOver = Partial<Pick<DepositLink, "expiresAt" | "updatedAt">>;

/**
 * A working deposit link for `project`, valid for 30 days, without the
 * rules `DepositLinkService.issue` checks (a project in any state can have
 * one). `updatedAt` says when it was made, as a new link moves it
 * (TAT-107): the model sets it itself, so it is written afterwards.
 */
export async function makeDepositLink(
	tenant: TenantRef,
	project: TattooProject,
	{ updatedAt, ...over }: DepositLinkOver = {},
) {
	const nonce = newTokenNonce();
	const link = await DepositLink.create({
		tenantId: tenant.id,
		projectId: project.id,
		referenceCode: newReferenceCode(),
		tokenNonce: nonce,
		tokenHash: hashToken(tokenFor(nonce)),
		expiresAt: DateTime.utc().plus({ days: 30 }),
		...over,
	});
	if (updatedAt) {
		await DepositLink.query()
			.where("id", link.id)
			.update({ updated_at: updatedAt.toSQL() });
		await link.refresh();
	}
	return link;
}

/**
 * One of everything in `tenant`: a client with an accepted inquiry that
 * became a project, the inquiry's reference image (attached to the project
 * too), a fixed quote and a submitted payment. Call it inside
 * `inTenant(tenant, …)`.
 */
export async function seedPipeline(tenant: TenantRef) {
	const client = await makeClient(tenant);
	const inquiry = await makeInquiry(tenant, client, {
		status: "accepted",
		decidedAt: DateTime.utc(),
	});
	const project = await makeProject(tenant, client, { inquiryId: inquiry.id });
	const referenceImage = await makeReferenceImage(tenant, {
		inquiryId: inquiry.id,
		projectId: project.id,
	});
	const quote = await makeQuote(tenant, project);
	const payment = await makePayment(tenant, project);
	return { client, inquiry, project, referenceImage, quote, payment };
}

type SessionOver = Partial<
	Pick<ProjectSession, "kind" | "startsAt" | "endsAt" | "status">
>;

/**
 * A scheduled tattoo session for `artist` in `project`, two hours long from
 * 10:00 UTC on 2 November 2026. The database refuses two active sessions of
 * one artist that overlap, so pass `startsAt` and `endsAt` for a second one.
 */
export function makeSession(
	tenant: TenantRef,
	project: TattooProject,
	artist: Artist,
	over: SessionOver = {},
) {
	return ProjectSession.create({
		tenantId: tenant.id,
		projectId: project.id,
		artistId: artist.id,
		kind: "tattoo",
		startsAt: DateTime.utc(2026, 11, 2, 10),
		endsAt: DateTime.utc(2026, 11, 2, 12),
		status: "scheduled",
		...over,
	});
}

/**
 * How many live clients, projects, quotes and sessions `tenant` has: a
 * refused booking must leave every count as it was. Call it inside
 * `inTenant(tenant, …)`, or the counts are 0 whatever happened.
 */
export async function pipelineCounts(tenant: TenantRef) {
	return {
		clients: (await Client.query().where("tenant_id", tenant.id)).length,
		projects: (await TattooProject.query().where("tenant_id", tenant.id))
			.length,
		quotes: (await Quote.query().where("tenant_id", tenant.id)).length,
		sessions: (await ProjectSession.query().where("tenant_id", tenant.id))
			.length,
	};
}
