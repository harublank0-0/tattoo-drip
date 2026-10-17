import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import type ProjectSession from "#modules/scheduling/models/project_session";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/** Whose sessions a calendar shows. */
export type CalendarScope =
	| { kind: "studio" }
	| { kind: "artist"; artist: Artist }
	| { kind: "unlinked" };

/** One session, with what the member may see around it. */
export type CalendarEntry = {
	session: ProjectSession;
	/** The session's artist; null when their profile was deleted. */
	artistName: string | null;
	/** Null when the member can't open the project (ProjectService.findManyFor). */
	project: { id: string; brief: string; clientName: string | null } | null;
};

export type Calendar = {
	scope: CalendarScope;
	/** Owners: the studio's live artists, by name (the picker). Artists: none. */
	artists: Artist[];
	entries: CalendarEntry[];
};

/**
 * The calendar's read (TAT-50): whose sessions a member sees in a window,
 * and how much of each project. One query per module, whatever the number
 * of sessions. Owners see the whole studio or one live artist; an artist
 * member sees only the live profile linked to them, and a client and brief
 * only for projects they may open.
 */
@inject()
export default class CalendarService {
	constructor(
		private artists: ArtistService,
		private sessions: SessionService,
		private projects: ProjectService,
		private clients: ClientService,
	) {}

	/**
	 * The calendar for `member` between `from` and `to`. `artistId` (the
	 * page's `?artist=`) must be a live artist of the tenant for an owner and
	 * the member's own profile for an artist; anything else, a malformed id
	 * included, throws E_ROW_NOT_FOUND (a 404). It is compared with the
	 * artist list in memory, so it never reaches the database.
	 */
	async load(
		tenant: TenantRef,
		member: Member,
		{
			artistId,
			from,
			to,
		}: { artistId: string | null; from: DateTime; to: DateTime },
	): Promise<Calendar> {
		const all = await this.artists.list(tenant);
		const scope = scopeFor(all, member, artistId);
		const artists = member.role === "owner" ? all : [];
		if (scope.kind === "unlinked") return { scope, artists, entries: [] };

		const sessions = await this.sessions.listInRange(tenant, {
			from,
			to,
			artistId: scope.kind === "artist" ? scope.artist.id : null,
		});
		const projects = await this.projects.findManyFor(
			tenant,
			member,
			unique(sessions.map(({ projectId }) => projectId)),
		);
		const clients = await this.clients.findMany(
			tenant,
			unique(projects.map(({ clientId }) => clientId)),
		);
		const artistName = new Map(all.map(({ id, name }) => [id, name]));
		const clientName = new Map(clients.map(({ id, name }) => [id, name]));
		const details = new Map(
			projects.map((project) => [
				project.id,
				{
					id: project.id,
					brief: project.brief,
					clientName: clientName.get(project.clientId) ?? null,
				},
			]),
		);

		return {
			scope,
			artists,
			entries: sessions.map((session) => ({
				session,
				artistName: artistName.get(session.artistId) ?? null,
				project: details.get(session.projectId) ?? null,
			})),
		};
	}
}

/** Whose calendar `member` asked for, or E_ROW_NOT_FOUND. */
function scopeFor(
	all: Artist[],
	member: Member,
	artistId: string | null,
): CalendarScope {
	if (member.role === "owner") {
		if (artistId === null) return { kind: "studio" };
		const artist = all.find(({ id }) => id === artistId);
		if (!artist) throw new lucidErrors.E_ROW_NOT_FOUND();
		return { kind: "artist", artist };
	}
	const mine = all.find(({ userId }) => userId === member.userId);
	if (artistId !== null && artistId !== mine?.id) {
		throw new lucidErrors.E_ROW_NOT_FOUND();
	}
	return mine ? { kind: "artist", artist: mine } : { kind: "unlinked" };
}

function unique(ids: string[]): string[] {
	return [...new Set(ids)];
}
