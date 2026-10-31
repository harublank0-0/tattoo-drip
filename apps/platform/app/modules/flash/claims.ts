import type FlashDesign from "#modules/flash/models/flash_design";

/**
 * Whether a one-of-a-kind flash design is claimed, and how that looks from a
 * request or a project that names it (TAT-129). Pure.
 *
 * - `none`: nothing to say (not claimed, or claimed but this record is closed).
 * - `here`: this project is the one that claimed the design.
 * - `taken`: the design is claimed by anything but this record and this record
 *   is still open: "Design taken: offer something similar".
 */
export type ClaimState = "none" | "here" | "taken";

type Claim = Pick<FlashDesign, "claimedAt" | "claimedProjectId">;

/** Claimed, by a project or by hand. */
export function isClaimed(design: Claim): boolean {
	return design.claimedAt !== null;
}

/**
 * The claim as the record `at` sees it. `projectId` is the project asking
 * (null for an inquiry); `open` is whether the record is still open: an
 * inquiry that is `new`, a project that is not in CLOSED_STATUSES. Only open
 * records are told a design is taken; a closed one has nothing to act on. The
 * claiming project is `here` however its own state is.
 */
export function claimStateOf(
	design: Claim,
	at: { projectId: string | null; open: boolean },
): ClaimState {
	if (!isClaimed(design)) return "none";
	if (at.projectId !== null && design.claimedProjectId === at.projectId) {
		return "here";
	}
	return at.open ? "taken" : "none";
}
