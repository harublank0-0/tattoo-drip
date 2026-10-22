import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import type Client from "#modules/clients/models/client";
import type Inquiry from "#modules/inquiries/models/inquiry";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import { proofFor } from "#tests/helpers/payments";
import {
	makeClient,
	makeDepositLink,
	makeInquiry,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Fixtures for specs that compare a page with what WaitingService.work gives
 * (Today's page since TAT-107, the Projects list since TAT-109).
 */

export const KTM = "Asia/Kathmandu";
export const SITA_THAPA = "सीता थापा";

/** The studio's date `days` from today (yyyy-MM-dd). */
export const dayIn = (days: number) =>
	DateTime.fromISO(todayIn(KTM), { zone: "utc" })
		.plus({ days })
		.toFormat("yyyy-MM-dd");

/** A studio with an owner, Asha (an artist member linked to her profile) and Sita (a profile without an account). */
export async function studio(slug = "today-107", name = "Today Ink") {
	const { owner, tenant } = await studioWithOwner(slug, name);
	const asha = await artistIn(tenant, `asha@${slug}.example`);
	const profiles = await inTenant(tenant, async () => ({
		ashaProfile: await Artist.create({
			tenantId: tenant.id,
			name: "Asha",
			slug: "asha",
			userId: asha.id,
		}),
		sitaProfile: await Artist.create({
			tenantId: tenant.id,
			name: "Sita",
			slug: "sita",
		}),
	}));
	return { owner, tenant, asha, ...profiles };
}

/**
 * One of each thing Today groups, `copies` times over (each with a client of
 * its own): a screenshot to check, a request, a price to send, a price
 * ending tomorrow, an unpaid deposit whose link is four days old, a booked
 * project with no session, and a price the client has yet to answer. Call
 * it inside `inTenant(tenant, …)`.
 */
export async function seedGroups(
	tenant: { id: string },
	preferredArtistId: string | null = null,
	copies = 1,
	label = "",
) {
	const made = {
		proof: [] as TattooProject[],
		inquiry: [] as Inquiry[],
		price: [] as TattooProject[],
		ending: [] as TattooProject[],
		deposit: [] as TattooProject[],
		booked: [] as TattooProject[],
		sent: [] as TattooProject[],
		clients: [] as Client[],
	};
	const project = async (status: ProjectStatus, name: string) => {
		const client = await makeClient(tenant, { name: `${label}${name}` });
		made.clients.push(client);
		return makeProject(tenant, client, { status });
	};
	for (let at = 0; at < copies; at++) {
		const n = `${at + 1}`;
		const proof = await project("deposit_pending", `Proof ${n}`);
		await makeQuote(tenant, proof);
		await proofFor(tenant, proof);
		made.proof.push(proof);

		const requester = await makeClient(tenant, {
			name: `${label}${SITA_THAPA}`,
		});
		made.clients.push(requester);
		made.inquiry.push(
			await makeInquiry(tenant, requester, {
				contactName: `${label}${SITA_THAPA}`,
				preferredArtistId,
			}),
		);

		made.price.push(await project("reviewing", `Price ${n}`));

		const ending = await project("quoted", `Ending ${n}`);
		await makeQuote(tenant, ending, {
			expiresAt: expiresAtFor(dayIn(1), KTM),
		});
		made.ending.push(ending);

		const deposit = await project("deposit_pending", `Deposit ${n}`);
		await makeQuote(tenant, deposit);
		await makeDepositLink(tenant, deposit, {
			updatedAt: DateTime.utc().minus({ days: 4 }),
		});
		made.deposit.push(deposit);

		made.booked.push(await project("booked", `Booked ${n}`));

		const sent = await project("quoted", `Sent ${n}`);
		await makeQuote(tenant, sent);
		made.sent.push(sent);
	}
	return made;
}
