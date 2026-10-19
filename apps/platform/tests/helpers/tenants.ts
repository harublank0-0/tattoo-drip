import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
import { depositServices } from "#tests/helpers/deposits";
import {
	makeInquiry,
	makeProject,
	makeQuote,
	makeReferenceImage,
	seedPipeline,
} from "#tests/helpers/pipeline";

/**
 * A fresh studio and its owner. The owner's email comes from the slug, so
 * one test can set up several studios.
 */
export async function studioWithOwner(
	slug = "black-needle",
	name = "Black Needle",
) {
	const owner = await User.create({
		email: `owner@${slug}.example`,
		password: "secret-password",
	});
	const tenant = await new TenancyService().createTenant(owner, {
		type: "studio",
		name,
		slug,
		timezone: "Asia/Kathmandu",
	});
	return { owner, tenant };
}

/**
 * A user with the artist role in `tenant`.
 */
export async function artistIn(tenant: Tenant, email = "artist@example.com") {
	const user = await User.create({ email, password: "secret-password" });
	await inTenant(tenant, () =>
		TenantMembership.create({
			tenantId: tenant.id,
			userId: user.id,
			role: "artist",
		}),
	);
	return user;
}

/**
 * Runs `fn` in `tenant`'s context, so row-level security lets its rows
 * through. Use it for any direct model read or write in a test.
 */
export function inTenant<T>(tenant: { id: string }, fn: () => Promise<T>) {
	return withDbContext({ tenantId: tenant.id }, () => fn());
}

/**
 * Runs `fn` as `user` with no tenant: what a signed-in user sees on
 * /dashboard (their own studios and memberships).
 */
export function inUser<T>(user: { id: string }, fn: () => Promise<T>) {
	return withDbContext({ userId: user.id }, () => fn());
}

/**
 * Runs `fn` as `user` inside `tenant`: what a member sees on a tenant page.
 */
export function inTenantAs<T>(
	tenant: { id: string },
	user: { id: string },
	fn: () => Promise<T>,
) {
	return withDbContext({ tenantId: tenant.id, userId: user.id }, () => fn());
}

const paymentMethods = new PaymentMethodService(new ImageService());
const artists = new ArtistService(new ImageService());
const depositLinks = depositServices().links;

async function studio(slug: string, name: string) {
	const { owner, tenant } = await studioWithOwner(slug, name);
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const paymentMethod = await inTenant(tenant, async () => {
		const first = await paymentMethods.create(tenant, {
			kind: "cash",
			label: `${name} cash`,
		});
		// A second one, so moving the first changes the list: with only one
		// a "move" is a no-op even when it leaks.
		await paymentMethods.create(tenant, {
			kind: "cash",
			label: `${name} tips`,
		});
		return first;
	});
	// The same slug in both studios on purpose: it is unique per tenant.
	const artistProfile = await inTenant(tenant, () =>
		artists.create(
			tenant,
			{
				name: `${name} Sita`,
				slug: "sita",
				bio: null,
				visible: true,
				acceptingInquiries: true,
				closedMessage: null,
				linkToMe: false,
			},
			owner,
		),
	);
	const pipeline = await inTenant(tenant, () => seedPipeline(tenant));
	// A second project waiting for the client's answer, for the accept route.
	const quoted = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "quoted",
		});
		return { project, quote: await makeQuote(tenant, project) };
	});
	// A new inquiry with one reference image, for the inbox routes.
	const newInquiry = await inTenant(tenant, async () => {
		const inquiry = await makeInquiry(tenant, pipeline.client);
		await makeReferenceImage(tenant, { inquiryId: inquiry.id });
		return inquiry;
	});
	// A deposit_pending project with its deposit link, and the eSewa method
	// the deposit page shows, for the deposit routes (TAT-65).
	const deposit = await inTenant(tenant, async () => {
		const method = await paymentMethods.create(tenant, {
			kind: "esewa",
			label: `${name} eSewa`,
			accountNumber: "9801234567",
			accountName: name,
			showOnDepositPage: true,
		});
		const project = await makeProject(tenant, pipeline.client, {
			status: "deposit_pending",
		});
		await makeQuote(tenant, project);
		const { link, token } = await depositLinks.issue(
			tenant,
			{ userId: owner.id, role: "owner" },
			project,
		);
		return { method, project, link, token };
	});
	return {
		tenant,
		owner,
		artist,
		paymentMethod,
		artistProfile,
		pipeline,
		// The :id resources of the project routes' isolation cases.
		project: pipeline.project,
		quotedProject: quoted.project,
		quotedQuote: quoted.quote,
		// The :id resource of the inbox routes' isolation cases.
		newInquiry,
		// The :id resource of the clients routes' isolation cases.
		client: pipeline.client,
		// The deposit routes' resources (TAT-65): the project for the
		// dashboard's :id, the raw token and the code for the public API.
		depositMethod: deposit.method,
		depositProject: deposit.project,
		depositToken: deposit.token,
		depositReferenceCode: deposit.link.referenceCode,
	};
}

export type Studio = Awaited<ReturnType<typeof studio>>;

/**
 * Two studios, each with an owner, an artist, two payment methods
 * (`paymentMethod` is the first), an artist profile (`artistProfile`) and one
 * of each pipeline record (`pipeline`: client, accepted inquiry, project,
 * reference image, quote and a submitted payment), plus a quoted project
 * (`quotedProject`, `quotedQuote`), a new inquiry with a reference image (`newInquiry`) and a deposit_pending project with its deposit link (`depositProject`, `depositToken`, `depositReferenceCode`) and the eSewa method its page shows (`depositMethod`); `project` is the pipeline's project. Later tickets add seed data
 * for their own tables here, so every isolation case sees it.
 */
export async function twoStudios() {
	return {
		a: await studio("studio-a", "Studio A"),
		b: await studio("studio-b", "Studio B"),
	};
}
