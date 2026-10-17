import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { todayIn } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BookingService from "#modules/projects/services/booking_service";
import {
	bookingValidator,
	toBookingInput,
} from "#modules/projects/validators/booking";
import { sessionTimeText } from "#modules/scheduling/times";
import type Tenant from "#modules/tenancy/models/tenant";
import { normalizePhone, PHONE_MESSAGE } from "#validators/phone";

/** What the page knows about the number typed in step 1. */
type Lookup =
	| null
	| { state: "invalid"; typed: string; message: string }
	| { state: "found"; phone: string; client: { id: string; name: string } }
	| { state: "new"; phone: string };

/** The longest typed number the page echoes back. */
const MAX_TYPED = 40;

/**
 * Booking a walk-in, phone or DM client in one step (TAT-43): look the
 * phone up, then book. Owners and artists (the projects group); which
 * artists a member may book, and everything the booking writes, is
 * BookingService's.
 */
@inject()
export default class BookingsController {
	constructor(
		private bookings: BookingService,
		private clients: ClientService,
	) {}

	async create(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const artists = await this.bookings.bookableArtists(tenant, membership);
		const phone = ctx.request.qs().phone;
		const typed =
			typeof phone === "string" ? phone.trim().slice(0, MAX_TYPED) : "";
		const today = todayIn(tenant.timezone);

		return ctx.inertia.render("projects/new", {
			lookup: await this.lookup(tenant, typed),
			artists: artists.map(({ id, name }) => ({ id, name })),
			isOwner: membership.role === "owner",
			dates: {
				today,
				max: DateTime.fromISO(today, { zone: "utc" })
					.plus({ years: 1 })
					.toFormat("yyyy-MM-dd"),
			},
		});
	}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const form = await ctx.request.validateUsing(bookingValidator);
		const booking = toBookingInput(form, tenant.timezone);
		const { project, session, client, artist } = await this.bookings.book(
			tenant,
			membership,
			booking,
		);

		ctx.session.flash(
			"success",
			`Session booked: ${client.name} with ${artist.name}, ${sessionTimeText(session.startsAt, session.endsAt, tenant.timezone)}.`,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	/**
	 * The client with the typed number in this studio, if any. Only the name
	 * is shown (artists use the lookup too).
	 */
	private async lookup(
		tenant: Pick<Tenant, "id">,
		typed: string,
	): Promise<Lookup> {
		if (!typed) return null;
		const phone = normalizePhone(typed);
		if (!phone) return { state: "invalid", typed, message: PHONE_MESSAGE };
		const client = await this.clients.findByPhone(tenant, phone);
		return client
			? { state: "found", phone, client: { id: client.id, name: client.name } }
			: { state: "new", phone };
	}
}
