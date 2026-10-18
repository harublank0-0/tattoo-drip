import { randomUUID } from "node:crypto";
import ImageService from "#modules/media/services/image_service";
import PaymentService from "#modules/payments/services/payment_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import SessionService from "#modules/scheduling/services/session_service";
import { depositServices } from "#tests/helpers/deposits";
import { makePayment } from "#tests/helpers/pipeline";

/** depositServices() plus the session and payment services (TAT-66). */
export function paymentServices(images: ImageService = new ImageService()) {
	const base = depositServices(images);
	const sessions = new SessionService(base.artists, base.deposits);
	const payments = new PaymentService(base.projects, base.quotes, sessions);
	return { ...base, sessions, payments };
}

/** The member a studio's owner acts as. */
export const ownerMember = (owner: { id: string }) => ({
	userId: owner.id,
	role: "owner" as const,
});

/**
 * A deposit screenshot waiting for the studio: a submitted NPR 3,000
 * (300,000 paisa) eSewa deposit with a proof key in `tenant`'s
 * payment_proof folder (no file behind it). Call it inside
 * `inTenant(tenant, …)`.
 */
export function proofFor(
	tenant: { id: string },
	project: TattooProject,
	over: Parameters<typeof makePayment>[2] = {},
) {
	return makePayment(tenant, project, {
		method: "esewa",
		proofImageKey: `tenants/${tenant.id}/payment_proof/${randomUUID()}.webp`,
		proofImageWidth: 600,
		proofImageHeight: 800,
		...over,
	});
}
