import { ClientVideoReservationSchema } from "#database/schema";

/**
 * A client video's signed upload not finished yet (finding 7): it holds one
 * of the post's places for its hour, so the signs outstanding never exceed
 * the places left. Deleted when the video is added, or once expired.
 */
export default class ClientVideoReservation extends ClientVideoReservationSchema {}
