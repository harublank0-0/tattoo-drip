import type { CreateInquiryInput } from "@tattoo-drip/sdk";
import { asciiDigits, type IntakeValues } from "./rules.ts";

/**
 * The SDK input for one attempt (TAT-57): the contract's field names, values
 * trimmed, empty optional answers left out, the phone with ASCII digits but
 * otherwise as typed (the API stores E.164), the photos in the tray's order
 * and the honeypot input's own value. createSubmitter adds the challenge
 * token per attempt. Call it only after validateIntake passed.
 */
export function toInquiryInput(
	values: IntakeValues,
	referenceImages: readonly File[],
	honeypot: string,
): CreateInquiryInput {
	if (values.sourceChannel === "") {
		throw new Error("toInquiryInput() needs answers validateIntake passed.");
	}
	const optional = (value: string) => value.trim() || undefined;
	return {
		idea: values.idea.trim(),
		placement: values.placement.trim(),
		approximateSize: values.approximateSize.trim(),
		preferredDates: values.preferredDates.trim(),
		preferredArtistId: optional(values.preferredArtistId),
		budget: optional(values.budget),
		sourceChannel: values.sourceChannel,
		contactName: values.contactName.trim(),
		contactPhone: asciiDigits(values.contactPhone).trim(),
		contactEmail: optional(values.contactEmail),
		referenceImages: [...referenceImages],
		honeypot,
	};
}
