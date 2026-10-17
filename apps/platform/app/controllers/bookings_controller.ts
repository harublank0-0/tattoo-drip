import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { ClientRuleError } from "#modules/clients/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { BookingRuleError } from "#modules/projects/errors";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BookingService, {
	type Booking,
	type DirectBooking,
} from "#modules/projects/services/booking_service";
import {
	bookingValidator,
	toBookingInput,
} from "#modules/projects/validators/booking";
import { toCalendarDate } from "#modules/scheduling/calendar";
import { SessionOverlapError } from "#modules/scheduling/errors";
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
		const max = lastBookableDay(today);
		// The calendar's "Book session" sends the day it shows (TAT-50).
		const wanted = toCalendarDate(ctx.request.qs().date, today);

		return ctx.inertia.render("projects/new", {
			// A member who can't book gets the "not linked" card, not a client's name.
			lookup: artists.length ? await this.lookup(tenant, typed) : null,
			artists: artists.map(({ id, name }) => ({ id, name })),
			isOwner: membership.role === "owner",
			dates: {
				today,
				max,
				initial: wanted >= today && wanted <= max ? wanted : today,
			},
		});
	}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const form = await ctx.request.validateUsing(bookingValidator);
		const booking = toBookingInput(form, tenant.timezone);
		let booked: Booking;
		try {
			booked = await this.bookings.book(tenant, membership, booking);
		} catch (error) {
			return this.refuse(ctx, error, booking);
		}
		const { project, session, client, artist } = booked;

		ctx.session.flash(
			"success",
			`Session booked: ${client.name} with ${artist.name}, ${sessionTimeText(session.startsAt, session.endsAt, tenant.timezone)}.`,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	/**
	 * What the page shows for a refused booking: a field error, or back to
	 * the lookup for a client whose details were deleted. The booking's
	 * savepoint was already rolled back, so these reads are safe and nothing
	 * was saved. Anything else (another studio's client: a 404) goes on up.
	 */
	private async refuse(
		ctx: HttpContext,
		error: unknown,
		booking: DirectBooking,
	) {
		const { tenant, membership } = tenantContext(ctx);
		if (error instanceof SessionOverlapError) {
			const artist = (
				await this.bookings.bookableArtists(tenant, membership)
			).find(({ id }) => id === booking.artistId);
			throw fieldError(
				"startTime",
				`${artist?.name ?? "The artist"} already has a session at that time. Pick another time.`,
				"overlap",
			);
		}
		if (
			error instanceof ClientRuleError &&
			error.reason === "phone_taken" &&
			booking.client.kind === "new"
		) {
			const holder = await this.clients.findByPhone(
				tenant,
				booking.client.phone,
			);
			throw fieldError(
				"phone",
				`This number now belongs to ${holder?.name ?? "another client"}. Check the client and book again.`,
				"unique",
			);
		}
		if (error instanceof BookingRuleError) {
			if (error.reason === "artist_unavailable") {
				throw fieldError(
					"artistId",
					"Choose an artist from the list.",
					"exists",
				);
			}
			ctx.session.flash(
				"error",
				"This client's details were deleted. Look the number up again.",
			);
			return ctx.response
				.redirect()
				.toRoute("tenant.projects.create", { tenant: tenant.slug });
		}
		throw error;
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

/** A field error shown next to `field`, like the validator's own. */
function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}
