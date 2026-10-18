import { DateTime } from "luxon";
import {
	CHANNEL_TEXT,
	type ContactVia,
	MESSAGE_LABELS,
} from "#modules/notifications/messages";

/**
 * How long ago `at` was, for people: "today", "yesterday" or "N days ago",
 * counting calendar days in the studio's timezone (a slightly fast clock
 * still says today).
 */
export function daysAgoText(
	at: DateTime,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	const days = Math.round(
		now
			.setZone(timezone)
			.startOf("day")
			.diff(at.setZone(timezone).startOf("day"), "days").days,
	);
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	return `${days} days ago`;
}

/**
 * When the client was last contacted, for people: "contacted today",
 * "contacted yesterday", "contacted 3 days ago" or "never contacted".
 */
export function contactedText(
	at: DateTime | null,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	return at ? `contacted ${daysAgoText(at, timezone, now)}` : "never contacted";
}

/**
 * The last contact for people (TAT-52): contactedText plus the channel and
 * the message, "contacted today on WhatsApp (Quote)"; "contacted today" for
 * "Mark contacted"; "never contacted" without a time.
 */
export function lastContactText(
	at: DateTime | null,
	timezone: string,
	via: ContactVia,
	now: DateTime = DateTime.now(),
): string {
	if (!at) return "never contacted";
	const channel = via.channel ? ` ${CHANNEL_TEXT[via.channel]}` : "";
	const kind = via.kind ? ` (${MESSAGE_LABELS[via.kind]})` : "";
	return `${contactedText(at, timezone, now)}${channel}${kind}`;
}
