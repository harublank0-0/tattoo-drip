import type { Slot } from "@tattoo-drip/sdk";

/**
 * Appointment availability for the booking flow (Prompt 6): the contract the
 * flow needs, and what the platform serves today, which is nothing.
 *
 * The public contract has `listAvailability` (`GET /tenants/{tenant}/
 * availability?artistId=&serviceId=&from=&to=`, the SDK's
 * `client.availability.list`, React's `useAvailability`), tagged V1: the
 * platform has no route for it, and it needs a `serviceId`, whose
 * `listServices` is V1 and unserved too. A slot also needs a way to be held:
 * `createInquiry` takes preferred dates as text only. Until all three exist
 * the flow asks for the days a client would like (calendar.ts) and sends them
 * as text, and the studio answers with a time. Nothing in the flow reads
 * slots, and there is no mock: a made-up slot would read as a real one.
 *
 * To turn slots on, the platform needs (1) `listServices` served, so the flow
 * can say what the session is; (2) `listAvailability` served, computed from
 * the artist's hours, existing sessions, closures and the service's length,
 * clamped to the studio's notice and horizon; and (3) a field on
 * `createInquiry` (or its own operation) that names the slot asked for, held
 * as a request until the studio accepts it. Then an `AvailabilitySource` that
 * reads (2) replaces `NO_AVAILABILITY` and the calendar offers its slots.
 */

/** Where the flow would read an artist's slots from. */
export interface AvailabilitySource {
	/** Whether this platform serves slots at all; false hides every slot control. */
	readonly supported: boolean;
	/** The slots of `artistId` for `serviceId` between two studio dates, inclusive. */
	readonly slots: (query: {
		readonly artistId: string;
		readonly serviceId: string;
		readonly from: string;
		readonly to: string;
	}) => Promise<readonly Slot[]>;
}

/** Today's platform: no slots, so none are offered, ever. */
export const NO_AVAILABILITY: AvailabilitySource = {
	supported: false,
	slots: () => Promise.resolve([]),
};
