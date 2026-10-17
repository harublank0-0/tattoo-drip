import { randomUUID } from "node:crypto";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositLinkService from "#modules/payments/services/deposit_link_service";
import DepositPageService from "#modules/payments/services/deposit_page_service";
import DepositService from "#modules/payments/services/deposit_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";

type TenantRef = { id: string };

/** An owner: the services never read the user for owners, so any id will do. */
export const OWNER = { userId: randomUUID(), role: "owner" as const };

/**
 * The deposit services wired as the container does. Pass an ImageService
 * that records or fails its stores.
 */
export function depositServices(images: ImageService = new ImageService()) {
	const artists = new ArtistService(images);
	const quotes = new QuoteService();
	const deposits = new DepositService(quotes);
	const projects = new ProjectService(
		artists,
		quotes,
		deposits,
		new SessionService(artists, deposits),
	);
	const methods = new PaymentMethodService(images);
	const links = new DepositLinkService(projects, quotes, deposits, methods);
	const pages = new DepositPageService(
		links,
		projects,
		quotes,
		deposits,
		methods,
		artists,
		images,
	);
	return { images, artists, quotes, deposits, projects, methods, links, pages };
}

/**
 * What a deposit link needs in `tenant`: an eSewa method shown on the
 * deposit page (ID 9801234567, name "Black Needle") and a deposit_pending
 * project for Sita Rai with a fixed quote (NPR 15,000; deposit NPR 3,000,
 * i.e. 300,000 paisa) valid for two weeks. Call it inside
 * `inTenant(tenant, …)`.
 */
export async function depositReady(
	tenant: TenantRef,
	quote: Parameters<typeof makeQuote>[2] = {},
) {
	const method = await new PaymentMethodService(new ImageService()).create(
		tenant,
		{
			kind: "esewa",
			label: "eSewa",
			accountNumber: "9801234567",
			accountName: "Black Needle",
			showOnDepositPage: true,
		},
	);
	const client = await makeClient(tenant, { name: "Sita Rai" });
	const project = await makeProject(tenant, client, {
		status: "deposit_pending",
	});
	return {
		method,
		client,
		project,
		quote: await makeQuote(tenant, project, quote),
	};
}
