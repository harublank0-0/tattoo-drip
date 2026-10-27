import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/** Owners only: any other member gets the same 404 as an unknown URL. */
const OWNERS: readonly MembershipRole[] = ["owner"];

/**
 * Every member. An artist then reaches only their own records: the rule
 * named above each group of entries decides which.
 */
const MEMBERS: readonly MembershipRole[] = ["owner", "artist"];

/**
 * Who may use each /t/:tenant route, by route name (TAT-30): the one
 * definition of what an owner and an artist may do in a studio. Owners may
 * use every route. The role middleware reads this table on every tenant
 * request, before the controller; a route missing here fails loudly. The
 * services named below keep their own record checks.
 *
 * tenant_routes.spec.ts fails for a route without an entry or an entry
 * without a route; role_access.spec.ts sends every route as an artist and
 * pins the list of routes open to artists (ARTIST_ROUTES). Staff roles (V2)
 * are new names in these lists, not a second table.
 */
export const TENANT_ROUTE_ROLES = {
	// The studio's address: every member lands on Today.
	"tenant.dashboard": MEMBERS,
	// Today (TAT-107): an artist sees only their own projects and sessions
	// (WaitingService through ProjectService.listActive, CalendarService.load),
	// never requests, money, the setup or the pilot numbers.
	"tenant.today": MEMBERS,

	// Studio settings.
	"tenant.settings": OWNERS,
	"tenant.settings.profile": OWNERS,
	"tenant.settings.profile.update": OWNERS,
	"tenant.settings.slug.update": OWNERS,
	"tenant.settings.payments": OWNERS,
	"tenant.settings.deposits.update": OWNERS,
	"tenant.settings.payments.create": OWNERS,
	"tenant.settings.payments.store": OWNERS,
	"tenant.settings.payments.update": OWNERS,
	"tenant.settings.payments.edit": OWNERS,
	"tenant.settings.payments.move": OWNERS,
	"tenant.settings.payments.destroy": OWNERS,
	"tenant.settings.messages": OWNERS,
	"tenant.settings.messages.update": OWNERS,
	"tenant.settings.members": OWNERS,
	"tenant.settings.members.invitations.store": OWNERS,
	"tenant.settings.members.invitations.renew": OWNERS,
	"tenant.settings.members.invitations.destroy": OWNERS,
	"tenant.settings.members.role.update": OWNERS,
	"tenant.settings.members.destroy": OWNERS,

	// Artist profiles: owners manage every one; an artist edits only the
	// live profile linked to them, never its link (ArtistService.findEditable,
	// updateOwn).
	"tenant.artists": OWNERS,
	"tenant.artists.mine": MEMBERS,
	"tenant.artists.create": OWNERS,
	"tenant.artists.store": OWNERS,
	"tenant.artists.edit": MEMBERS,
	"tenant.artists.update": MEMBERS,
	"tenant.artists.destroy": OWNERS,

	// The inquiry inbox: reference images stay private to owners until a
	// project is assigned.
	"tenant.inbox.index": OWNERS,
	"tenant.inbox.show": OWNERS,
	"tenant.inbox.accept": OWNERS,
	"tenant.inbox.decline": OWNERS,
	"tenant.inbox.contacted.store": OWNERS,

	// The studio's clients.
	"tenant.clients.index": OWNERS,
	"tenant.clients.show": OWNERS,
	"tenant.clients.edit": OWNERS,
	"tenant.clients.update": OWNERS,

	// Projects: an artist only the projects assigned to their own live
	// artist profile (ProjectService.findFor, re-checked under the row lock
	// by lockFor); booking and scheduling only themselves
	// (BookingService.bookableArtists, SessionService.scheduleFor); on the
	// page, no money at all (TAT-108: the controller builds no paymentsCard
	// for them and words no amount in their schedule hint or flash).
	"tenant.projects.create": MEMBERS,
	"tenant.projects.store": MEMBERS,
	"tenant.projects.index": MEMBERS,
	"tenant.projects.show": MEMBERS,
	"tenant.projects.quotes.store": MEMBERS,
	"tenant.projects.quotes.accept": MEMBERS,
	"tenant.projects.price.store": MEMBERS,
	"tenant.projects.moves.store": MEMBERS,
	"tenant.projects.notes.update": MEMBERS,
	"tenant.projects.contacted.store": MEMBERS,
	"tenant.projects.sessions.store": MEMBERS,
	// Money and who works on a project stay with owners; the services refuse
	// anyone else too (ProjectService.assignArtist, DepositLinkService.issue,
	// PaymentService.requireOwner).
	"tenant.projects.artist.update": OWNERS,
	// Finishing a project and closing its healing check (TAT-111): the
	// money decision stays with owners (ProjectService.requireOwner).
	"tenant.projects.finish.store": OWNERS,
	"tenant.projects.complete.store": OWNERS,
	"tenant.projects.deposit_link.store": OWNERS,
	"tenant.projects.payments.store": OWNERS,
	"tenant.projects.refunds.store": OWNERS,
	"tenant.projects.deposit_outcome.store": OWNERS,

	// Decisions on one payment.
	"tenant.payments.verify": OWNERS,
	"tenant.payments.reject": OWNERS,
	"tenant.payments.reverse": OWNERS,

	// One session: an artist only their own session on a project assigned to
	// their profile (mayChangeSession in #modules/scheduling/outcomes,
	// through SessionService).
	"tenant.sessions.outcome": MEMBERS,
	"tenant.sessions.move": MEMBERS,

	// The calendar: an artist sees their own sessions, with a project's
	// client and brief only when they may open it (CalendarService.load).
	"tenant.calendar.index": MEMBERS,

	// Each member's own alerts (AlertService scopes every read and write).
	"tenant.alerts.index": MEMBERS,
	"tenant.alerts.read": MEMBERS,
	"tenant.alerts.open": MEMBERS,
} as const satisfies Record<string, readonly MembershipRole[]>;

export type TenantRouteName = keyof typeof TENANT_ROUTE_ROLES;

/**
 * The roles that may use the tenant route `name`, or undefined for a name
 * the table doesn't hold (own keys only, so "constructor" is unknown too).
 */
export function rolesFor(
	name: string | undefined,
): readonly MembershipRole[] | undefined {
	if (name === undefined || !Object.hasOwn(TENANT_ROUTE_ROLES, name)) {
		return undefined;
	}
	return TENANT_ROUTE_ROLES[name as TenantRouteName];
}
