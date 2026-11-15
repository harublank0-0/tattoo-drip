/**
 * AI Design Lab's states and their words (docs/design-lab.md). Pure: no
 * imports, so unit tests and the controller share one list.
 */

export const REVIEW_STATES = ["exploring", "decided", "archived"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * A generation's lifecycle. `queued`: accepted and reserved, not yet with the
 * provider. `processing`: the provider has it. The last three are final.
 */
export const GENERATION_STATUSES = [
	"queued",
	"processing",
	"completed",
	"failed",
	"moderated",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const FINAL_STATUSES: readonly GenerationStatus[] = [
	"completed",
	"failed",
	"moderated",
];

export const isFinal = (status: GenerationStatus) =>
	FINAL_STATUSES.includes(status);

/**
 * Why a generation did not complete. Stored on the row; the browser gets the
 * code's words below, never the provider's own text.
 */
export const FAILURE_CODES = [
	// The provider's safety filters refused the request or the image.
	"request_moderated",
	"content_moderated",
	// The provider reported an error, or answered with something unusable.
	"provider_error",
	// The provider refused the request as invalid (our prompt or settings).
	"provider_rejected",
	// TattooDrip's provider account cannot generate (credits or key): ops.
	"provider_unavailable",
	// Busy for longer than the queue waits.
	"rate_limited",
	// No result in time (the worker's deadline, or the stuck sweep).
	"timed_out",
	// The submit's outcome is unknown (a crash or timeout mid-request): never
	// resubmitted automatically, so the provider is never charged twice.
	"submit_unconfirmed",
	// The image came back but could not be downloaded or stored in time.
	"storage_failed",
	// The worker gave up after its retries.
	"worker_failed",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export const MODERATION_CODES: readonly FailureCode[] = [
	"request_moderated",
	"content_moderated",
];

/**
 * Retry is offered for failures that were not about the request itself: a
 * moderated or rejected request would be refused again.
 */
const NOT_RETRYABLE: readonly FailureCode[] = [
	"request_moderated",
	"content_moderated",
	"provider_rejected",
];

export const canRetry = (
	status: GenerationStatus,
	code: FailureCode | null,
	attempt: number,
) =>
	status === "failed" &&
	code !== null &&
	!NOT_RETRYABLE.includes(code) &&
	attempt < MAX_ATTEMPTS;

/** A generation row is retried in place at most this many times in all. */
export const MAX_ATTEMPTS = 5;

export const FAILURE_MESSAGES: Record<FailureCode, string> = {
	request_moderated:
		"The image service's safety filter declined this description. Change the concept and try a new generation.",
	content_moderated:
		"The image service's safety filter withheld the image it made. Change the concept and try a new generation.",
	provider_error:
		"The image service couldn't finish this concept. You can try again.",
	provider_rejected:
		"The image service couldn't use these settings. Change the concept or options and try a new generation.",
	provider_unavailable:
		"Generation is unavailable right now. TattooDrip has been notified; try again later.",
	rate_limited: "The image service was too busy. You can try again.",
	timed_out: "This took too long to finish. You can try again.",
	submit_unconfirmed:
		"We couldn't confirm the request reached the image service. You can try again.",
	storage_failed:
		"The concept was made but couldn't be saved in time. You can try again.",
	worker_failed: "Something went wrong on our side. You can try again.",
};

export const USAGE_STATUSES = ["reserved", "settled", "released"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

/**
 * Safe provider details kept on a generation: never a URL, a key or a prompt.
 * `cost` is the provider's charge in its credits when it reports one.
 */
export type ProviderMeta = {
	cost?: number;
	/** The safety filter's category names on a moderated request (e.g. "Violence"). */
	moderationReasons?: string[];
	seed?: number;
	providerStatus?: string;
};

/** What the browser shows for each status. */
export const STATUS_LABELS: Record<GenerationStatus, string> = {
	queued: "Queued",
	processing: "Generating",
	completed: "Ready",
	failed: "Failed",
	moderated: "Declined by safety filter",
};
