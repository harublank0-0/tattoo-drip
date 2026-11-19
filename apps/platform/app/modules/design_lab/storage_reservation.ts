import {
	releaseStorage,
	reserveStorageFor,
} from "#modules/storage/reservations";

const MB = 1048576;

/**
 * What a concept is taken to need until it is stored (the storage meter):
 * an estimate, since its size is known only once the provider delivers it.
 */
export const DESIGN_STORAGE_ESTIMATE = 8 * MB;

/** A concept's reservation lasts as long as a generation may run, and more. */
const DESIGN_RESERVATION_MINUTES = 60;

/** One reservation per generation attempt. */
export function designReservationKey(
	generationId: string,
	attempt: number,
): string {
	return `reserve:design:${generationId}:${attempt}`;
}

/**
 * Holds the studio's storage for these generation attempts' concepts, all or
 * none (StorageFullError when they don't fit, with STORAGE_ENFORCEMENT on).
 * The runner's stored concept replaces each one, and a failed attempt
 * releases it (GenerationRunner).
 */
export function reserveDesignStorage(
	tenantId: string,
	attempts: readonly { generationId: string; attempt: number }[],
): Promise<string[]> {
	return reserveStorageFor({
		tenantId,
		purpose: "design_concept",
		minutes: DESIGN_RESERVATION_MINUTES,
		items: attempts.map((item) => ({
			key: designReservationKey(item.generationId, item.attempt),
			bytes: DESIGN_STORAGE_ESTIMATE,
		})),
	});
}

/** Releases a generation attempt's reservation (it failed). Best effort. */
export function releaseDesignStorage(
	tenantId: string,
	generationId: string,
	attempt: number,
): Promise<void> {
	return releaseStorage(tenantId, designReservationKey(generationId, attempt));
}
