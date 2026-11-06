import { ReferenceCodeSchema } from "#database/schema";

/**
 * A reference code a studio holds (an inquiry's, or a deposit link's that
 * came from no inquiry): one row per code, so a code is unique per studio
 * across both. Written only by ReferenceCodeService.claim; never updated.
 */
export default class ReferenceCode extends ReferenceCodeSchema {}
