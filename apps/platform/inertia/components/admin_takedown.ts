/** The value of the takedown select's disabled "Choose a reason" option. */
export const CHOOSE_REASON = "";

/**
 * The reason a takedown form starts on: a reported review's own reason,
 * else none. Starting on the first reason would let one click record
 * "hate", and the client's page would then say it held hateful words.
 */
export function initialReason(
	reasons: { value: string; label: string }[],
	defaultReason?: string,
): string {
	return defaultReason &&
		reasons.some((reason) => reason.value === defaultReason)
		? defaultReason
		: CHOOSE_REASON;
}
