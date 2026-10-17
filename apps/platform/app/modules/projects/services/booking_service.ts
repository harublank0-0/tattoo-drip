import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Client from "#modules/clients/models/client";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { BookingRuleError } from "#modules/projects/errors";
import TattooProject from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import type { Member } from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type ProjectSession from "#modules/scheduling/models/project_session";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

/** A price noted at booking, in stored units: paisa and whole minutes. */
export type QuickQuote =
	| { kind: "fixed"; fixedPrice: number }
	| { kind: "hourly"; hourlyRate: number; estimatedMinutes: number };

/** Who is booked: the client the lookup found, or a new one (phone in E.164). */
export type BookingClient =
	| { kind: "existing"; id: string }
	| { kind: "new"; name: string; phone: string; email: string | null };

/** A walk-in, phone or DM booking, in stored units. */
export type DirectBooking = {
	client: BookingClient;
	artistId: string;
	brief: string;
	startsAt: DateTime;
	endsAt: DateTime;
	quote: QuickQuote | null;
};

/** What a booking made. */
export type Booking = {
	project: TattooProject;
	session: ProjectSession;
	client: Client;
	artist: Artist;
};

/**
 * Books a walk-in, phone or DM client in one step (TAT-43): the client, a
 * `booked` project, an optional quick quote and its tattoo session, all in
 * one transaction, so a refusal leaves nothing behind.
 */
@inject()
export default class BookingService {
	constructor(
		private artists: ArtistService,
		private clients: ClientService,
		private quotes: QuoteService,
		private sessions: SessionService,
	) {}

	/**
	 * The live artists `member` may book: every one for an owner (by name),
	 * only the profile linked to them for an artist (none without one).
	 */
	async bookableArtists(
		tenant: Pick<Tenant, "id">,
		member: Member,
	): Promise<Artist[]> {
		const all = await this.artists.list(tenant);
		if (member.role === "owner") return all;
		return all.filter(({ userId }) => userId === member.userId);
	}

	/**
	 * Books it. An artist outside bookableArtists is refused
	 * (BookingRuleError "artist_unavailable") before anything is written.
	 * Then, in one transaction: the client (a found one is used as it is,
	 * never changed; another tenant's or a deleted one is E_ROW_NOT_FOUND;
	 * an anonymized one is "client_unavailable"; a new one goes through
	 * ClientService.create, ClientRuleError "phone_taken" if the number was
	 * taken meanwhile), a `booked` project with no inquiry, the artist set
	 * and `last_contacted_at` now (staff just spoke with the client), the
	 * quick quote if any, and the tattoo session through
	 * SessionService.schedule (SessionOverlapError when the artist is busy).
	 * Any of these errors rolls the whole booking back.
	 *
	 * The quote is version 1 with no deposit (the client is booked now, so
	 * nothing would ask for one) and is valid through the session's day. It
	 * does not go through ProjectService.issueQuote and queues no
	 * ExpireQuoteJob: expiry only acts on quoted, on_hold and
	 * deposit_pending projects, which a booked project never returns to.
	 */
	async book(
		tenant: Pick<Tenant, "id" | "timezone">,
		member: Member,
		booking: DirectBooking,
	): Promise<Booking> {
		const artist = (await this.bookableArtists(tenant, member)).find(
			({ id }) => id === booking.artistId,
		);
		if (!artist) throw new BookingRuleError("artist_unavailable");

		return withTransaction(async (trx) => {
			const client = await this.clientFor(tenant, booking.client);
			const project = await TattooProject.create(
				{
					tenantId: tenant.id,
					clientId: client.id,
					artistId: artist.id,
					inquiryId: null,
					brief: booking.brief,
					status: "booked",
					lastContactedAt: DateTime.now(),
				},
				{ client: trx },
			);
			if (booking.quote) {
				const sessionDay = booking.startsAt
					.setZone(tenant.timezone)
					.toFormat("yyyy-MM-dd");
				await this.quotes.create(trx, tenant, project, {
					...booking.quote,
					depositAmount: 0,
					expiresAt: expiresAtFor(sessionDay, tenant.timezone),
				});
			}
			const session = await this.sessions.schedule(tenant, project, {
				artistId: artist.id,
				kind: "tattoo",
				startsAt: booking.startsAt,
				endsAt: booking.endsAt,
			});
			return { project, session, client, artist };
		});
	}

	/** The booking's client: the found one as it is, or a new one. */
	private async clientFor(
		tenant: Pick<Tenant, "id">,
		choice: BookingClient,
	): Promise<Client> {
		if (choice.kind === "new") {
			return this.clients.create(tenant, {
				name: choice.name,
				phone: choice.phone,
				email: choice.email,
			});
		}
		const client = await this.clients.findFor(tenant, choice.id);
		if (client.anonymizedAt) throw new BookingRuleError("client_unavailable");
		return client;
	}
}
